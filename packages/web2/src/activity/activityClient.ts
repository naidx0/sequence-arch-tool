import type {
  GetAcpAgentsResponse,
  GetAcpAvailableResponse,
  GetProgramRunResponse,
  GetProgramRunsResponse,
  PostProgramRunCancelResponse,
  PostProgramRunResponse,
} from '@sequence/api-types';
import type { Program } from '@sequence/schema';

import { isSameOriginPath, type WireResult } from '../boot';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY LANE'S TRANSPORT
   packages/web2/src/activity/activityClient.ts

   TWO CALLS, AND BOTH ARE ROUTES THAT EXIST TODAY. `server/repoServer.ts` serves
   `GET /api/program/runs` (`programRunner.list(activeRoot())`) and
   `GET /api/program/runs/:runId`. There is no speculative endpoint
   here and no third call invented for a figure the list wanted: if the engine
   does not serve it, the surface says so instead.

   THE SSE FEED IS DELIBERATELY NOT OPENED FROM HERE. `GET
   /api/program/runs/:id/events` is a resumable tail for ONE run, and the
   activity view's question is about N runs at once. Polling the list is the
   honest shape for that question — one request, one answer, no half-applied
   deltas — and the per-run feed belongs to whatever surface tails a single run.

   IT REUSES `WireResult` FROM THE BOOT LANE rather than declaring a second
   four-outcome ladder, for the reason `bootClient.ts` records: v1
   re-implemented `if (!r.ok) throw` at thirty call sites and could not tell a
   refusal from an outage from a route that was never built, "which is why a
   dead engine and a rejected folder looked the same on screen". This surface
   has real refusals to render honestly — `requireRepo` answers 400 when nothing
   is attached, `requireOwner` answers 403 on a hosted bind — and both are
   things a reader can act on, so both must survive the transport.

   THE SAME-ORIGIN RULE IS ENFORCED, NOT DOCUMENTED. Every path below is a
   literal starting with one slash, and {@link assertSameOrigin} throws rather
   than fetching. The way a third-party host gets into a local-first client is
   one convenient absolute URL added months later by somebody who has not read
   this file.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * How long, and how many node visits, a run may have.
 *
 * `PostProgramRunRequest` has carried `timeoutMs` and `maxSteps` since the
 * route was written and NO CLIENT EVER SENT EITHER, so every run this product
 * started was held to the runner's ten-minute, 200-visit defaults and no
 * surface offered a way to say otherwise. The server clamps both, so these are
 * an ask rather than a guarantee - which is why the run record carries back the
 * budgets it was actually held to.
 */
export interface RunBudget {
  timeoutMs?: number;
  maxSteps?: number;
}

export interface ActivityClient {
  /** GET /api/program/runs → `{ runs }`, newest `startedAt` first. */
  runs(signal?: AbortSignal): Promise<WireResult<GetProgramRunsResponse>>;
  /** GET /api/program/runs/:runId → `{ run, events }`; 404 when unrecorded. */
  run(runId: string, signal?: AbortSignal): Promise<WireResult<GetProgramRunResponse>>;

  /*
   * ── THE THREE WRITES, AND WHY THEY WERE MISSING ────────────────────────
   *
   * This client read runs and posted nothing, so the Activity pane was a
   * viewer for work only the CLI could create. The routes have been served
   * the whole time; `ACTIVITY_ROUTES` named one of them.
   *
   * All four return the wire outcome rather than throwing, because a refusal
   * here is a sentence the reader has to see — "ACP is not available" is the
   * server telling them what to fix, and an exception would replace it with a
   * stack trace.
   */

  /** POST /api/program/run → 202 `{ runId, status, startedAt }`. */
  /**
   * `budget` is OPTIONAL and OMITTED WHEN THE READER CHOSE NOTHING, which is
   * the difference between "hold this run to ten minutes" and "the server's
   * own default applies". Sending the default explicitly would look identical
   * on the wire and would move the number out of the engine and into here.
   */
  start(
    program: Program,
    budget?: RunBudget,
    signal?: AbortSignal,
  ): Promise<WireResult<PostProgramRunResponse>>;
  /** POST /api/program/runs/:runId/pause. */
  pause(runId: string, signal?: AbortSignal): Promise<WireResult<unknown>>;
  /** POST /api/program/runs/:runId/resume. */
  resume(runId: string, signal?: AbortSignal): Promise<WireResult<unknown>>;
  /** POST /api/program/runs/:runId/cancel — aborts in-flight work. */
  cancel(runId: string, signal?: AbortSignal): Promise<WireResult<PostProgramRunCancelResponse>>;

  /**
   * GET /api/acp/available — feature-detect before Start (api-types contract).
   * Honest `available:false` is a 200 with a reason; non-local probers get 403.
   */
  acpAvailable(signal?: AbortSignal): Promise<WireResult<GetAcpAvailableResponse>>;
  /** GET /api/acp/agents — registered local agents (empty list is a real answer). */
  acpAgents(signal?: AbortSignal): Promise<WireResult<GetAcpAgentsResponse>>;
}

/** Every route this lane touches, written down once so a test can assert on
 *  the same strings the client uses rather than on a copy of them. */
export const ACTIVITY_ROUTES = [
  '/api/program/runs',
  /* Singular, and NOT a typo: the run LIST is `/api/program/runs` and starting
     one is `/api/program/run`. Two routes one character apart is exactly the
     kind of thing a written-down contract exists to stop being guessed at. */
  '/api/program/run',
  /* P4 preflight — api-types requires feature-detect before offering ACP paths. */
  '/api/acp/available',
  '/api/acp/agents',
] as const;

/**
 * The precondition, as a call. Throws — this is a programmer error, not a wire
 * outcome, and it must not be renderable as one.
 *
 * THE PREDICATE IS THE BOOT LANE'S, NOT A THIRD COPY OF IT.
 * `bootClient.isSameOriginPath` already knows that `//host/x` is
 * protocol-relative and absolute at run time, and that `/\host/x` is parsed as
 * protocol-relative by browsers because a backslash is a slash in the authority
 * position — both being the classic ways past a check that only looks for
 * `https://`. `reviewClient.ts` re-derived that predicate by hand and now
 * carries the third statement of one rule; a rule stated three times is a rule
 * that gets fixed in two places.
 */
export function assertSameOrigin(path: string): string {
  if (!isSameOriginPath(path)) {
    throw new Error(
      `activity may only request same-origin paths; refused ${JSON.stringify(path)}. ` +
        'Production is same-origin and development proxies /api — there is no absolute URL to add.',
    );
  }
  return path;
}

/**
 * A write, sharing the read's outcome ladder.
 *
 * SEPARATE FROM `request` RATHER THAN A FLAG ON IT. A GET that fails is a
 * question nobody answered; a POST that fails may have already done half of
 * something. Keeping them apart means the day one of them needs a retry, the
 * other does not silently get one.
 *
 * A body is optional because pause and resume carry none — the run id is in
 * the path, and a POST with no body is the honest shape for "do this to that".
 */
async function post<T>(
  fetchImpl: typeof fetch,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<WireResult<T>> {
  assertSameOrigin(path);

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal,
    });
  } catch (e) {
    return { outcome: 'unreachable', message: (e as Error).message };
  }

  const status = response.status;

  /* TEXT THEN PARSE, the same discipline the read uses and for the same
     reason: JSON is decided by parsing, not by a content-type header, because
     a static file host answers every unknown path with index.html, a 200 and
     `text/html`. Trusting the header means trusting the server we are trying
     to identify. */
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* A 202 with an empty body is a legitimate acknowledgement, so an
       unparseable body on a SUCCESS is not a failure — only on a refusal,
       where the sentence was the whole point of reading it. */
    if (response.ok) return { outcome: 'ok', status, body: undefined as T };
    return { outcome: 'not-json', status };
  }

  return response.ok
    ? { outcome: 'ok', status, body: parsed as T }
    : { outcome: 'error', status, body: parsed };
}

async function request<T>(
  fetchImpl: typeof fetch,
  path: string,
  signal?: AbortSignal,
): Promise<WireResult<T>> {
  assertSameOrigin(path);

  let response: Response;
  try {
    response = await fetchImpl(path, { method: 'GET', signal });
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  const status = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    /* JSON IS DECIDED BY PARSING, NOT BY THE CONTENT-TYPE HEADER. A static file
       host answers every unknown path with index.html, a 200 and `text/html`;
       trusting the header means trusting the very server we are identifying. */
    return { outcome: 'not-json', status };
  }

  return response.ok
    ? { outcome: 'ok', status, body: body as T }
    : { outcome: 'error', status, body };
}

/**
 * The message a refusal should be rendered as.
 *
 * The engine's refusals all carry `{ error }` (`sendError`), and that sentence
 * is written for a human — "no repository attached". Replacing it with
 * "HTTP 400" would throw away the only part of the response that says what to
 * do next.
 */
export function wireMessage(result: WireResult<unknown>): string {
  switch (result.outcome) {
    case 'ok':
      return '';
    case 'error': {
      const body = result.body as { error?: unknown } | null;
      const named = typeof body?.error === 'string' ? body.error : null;
      return named ?? `the engine refused with HTTP ${result.status}`;
    }
    case 'not-json':
      return `this origin answered HTTP ${result.status} with something that is not JSON — it is not a Sequence engine`;
    case 'unreachable':
      return `nothing answered on this origin — ${result.message}`;
  }
}

/**
 * Is this a run id the ENGINE would have minted?
 *
 * Transcribed from `isRunId` in
 * `packages/analyzer/src/server/programRunStore.ts`, and it is here for the
 * same reason it is there: a run id becomes a URL path segment. The check is a
 * whitelist over the exact alphabet the engine mints — `.`, `/` and `\` are
 * simply not in it — so there is no encoding of a parent directory that
 * survives it. The server refuses too; this refuses before asking, so a
 * malformed id never leaves the browser.
 */
export function isRunId(value: string): boolean {
  return /^run-[0-9a-z]+-[0-9a-f]{8}$/.test(value);
}

export function createActivityClient(injected?: typeof fetch): ActivityClient {
  /*
   * LATE-BOUND, AND THAT IS NOT A STYLE CHOICE.
   *
   * `fetchImpl: typeof fetch = globalThis.fetch` captures whatever was on the
   * global at the moment this MODULE WAS IMPORTED. `DEFAULT_CLIENT` is built
   * at import time, so the app-mounted client held a reference to the original
   * fetch for the life of the page - which is invisible in production and
   * fatal to any test that replaces the global afterwards. Measured: the seam
   * test drove the real form, the real handler and the real client, and every
   * request went to the REAL fetch and came back "nothing answered on this
   * origin".
   *
   * Resolving per call keeps injection working and removes the capture.
   */
  const fetchImpl: typeof fetch = (...args) => (injected ?? globalThis.fetch)(...args);
  return {
    runs: (signal) => request<GetProgramRunsResponse>(fetchImpl, '/api/program/runs', signal),

    run: async (runId, signal) => {
      if (!isRunId(runId)) {
        /* NOT A THROW, AND NOT A FETCH. The surface has one ladder for "the
           engine did not answer with a run", and an id this client refuses to
           send belongs on it in the engine's own vocabulary rather than as an
           exception the pane would have to catch separately. */
        return { outcome: 'error', status: 404, body: { error: `not a run id: ${runId}` } };
      }
      return request<GetProgramRunResponse>(
        fetchImpl,
        `/api/program/runs/${encodeURIComponent(runId)}`,
        signal,
      );
    },

    start: (program, budget, signal) =>
      post<PostProgramRunResponse>(
        fetchImpl,
        '/api/program/run',
        {
          program,
          ...(budget?.timeoutMs !== undefined ? { timeoutMs: budget.timeoutMs } : {}),
          ...(budget?.maxSteps !== undefined ? { maxSteps: budget.maxSteps } : {}),
        },
        signal,
      ),

    /*
     * THE SAME ID GUARD THE READ USES. A run id becomes a URL path segment on
     * the way to a WRITE here, so refusing a malformed one before asking is
     * the same rule applied where it matters more.
     */
    pause: async (runId, signal) => {
      if (!isRunId(runId)) return { outcome: 'error', status: 404, body: { error: `not a run id: ${runId}` } };
      return post<unknown>(fetchImpl, `/api/program/runs/${encodeURIComponent(runId)}/pause`, undefined, signal);
    },

    resume: async (runId, signal) => {
      if (!isRunId(runId)) return { outcome: 'error', status: 404, body: { error: `not a run id: ${runId}` } };
      return post<unknown>(fetchImpl, `/api/program/runs/${encodeURIComponent(runId)}/resume`, undefined, signal);
    },

    cancel: async (runId, signal) => {
      if (!isRunId(runId)) return { outcome: 'error', status: 404, body: { error: `not a run id: ${runId}` } };
      return post<PostProgramRunCancelResponse>(
        fetchImpl,
        `/api/program/runs/${encodeURIComponent(runId)}/cancel`,
        undefined,
        signal,
      );
    },

    acpAvailable: (signal) =>
      request<GetAcpAvailableResponse>(fetchImpl, '/api/acp/available', signal),

    acpAgents: (signal) => request<GetAcpAgentsResponse>(fetchImpl, '/api/acp/agents', signal),
  };
}
