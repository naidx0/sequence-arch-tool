import type {
  GetCheckpointsResponse,
  GetGitDiffResponse,
  GetGitStatusResponse,
  PostCheckpointPlanResponse,
  PostCheckpointResponse,
  PostCheckpointRestoreResponse,
  PostGitCommitResponse,
  PutFileResponse,
  RestoreScope,
} from '@sequence/api-types';
import type { FunctionGraph } from '@sequence/schema';

import type { WireResult } from '../boot';
import { checkpointSessionId } from './writeSession';

/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW LANE'S TRANSPORT — item 5.2
   packages/web2/src/review/reviewClient.ts

   Five calls, and every one of them is a route that exists today. There is no
   speculative endpoint here: the three scopes the engine cannot serve
   (`reviewScopes.ts`) are refused in the model, not attempted on the wire.

   IT REUSES `WireResult` FROM THE BOOT LANE RATHER THAN DECLARING A SECOND
   FOUR-OUTCOME LADDER. That type separates "nothing answered", "something
   answered that is not JSON", "the server refused" and "here is the body", and
   `bootClient.ts` records why: v1 re-implemented `if (!r.ok) throw` at thirty
   call sites and could not tell a refusal from an outage from a route that was
   never built, "which is why a dead engine and a rejected folder looked the
   same on screen". A second ladder in this file would be the same defect
   arriving by a different road — and this surface has MORE refusals to render
   honestly than boot does, not fewer: 403 reserved root, 403 outside the
   program.md allowlist, 409 decision-record exists, 413 over MAX_FILE_BYTES.

   THE SAME-ORIGIN RULE IS ALSO INHERITED, AND IT IS ENFORCED, NOT DOCUMENTED.
   Every path below is a literal starting with one slash. `assertSameOrigin`
   throws rather than fetching, because the way a third-party host gets into a
   local-first client is one convenient absolute URL added months later by
   somebody who has not read this file.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReviewClient {
  /** GET /api/git/status → `{branch, files:[{path,status}]}`. */
  status(signal?: AbortSignal): Promise<WireResult<GetGitStatusResponse>>;
  /**
   * GET /api/git/diff?path=&scope=… → `{path, diff}`. The diff may be EMPTY.
   *
   * `scope` says WHAT the diff is against. Omitting it means `worktree`, which
   * is what this route did before it could answer anything else. `commit` needs
   * a `rev` and `branch` needs a `base`; the server 400s without them rather
   * than falling back to the working tree, because answering a question the
   * caller did not ask — with a diff that looks right — is worse than refusing.
   */
  diff(
    path: string,
    signal?: AbortSignal,
    scope?: { kind: 'worktree' | 'staged' } | { kind: 'commit'; rev: string } | { kind: 'branch'; base: string },
  ): Promise<WireResult<GetGitDiffResponse>>;
  /** PUT /api/file → `{ok, path}`. A whole-file replace, not a patch. */
  writeFile(path: string, content: string): Promise<WireResult<PutFileResponse>>;
  /** POST /api/git/commit → `{ok, commit?}`. `paths` IS the selective stage. */
  /**
   * GET /api/checkpoints - every checkpoint for THIS browser's session.
   *
   * The id comes from `checkpointSessionId()` (active chat when wired, else
   * write-session) so conversation restore can find the transcript (B3.3).
   */
  checkpoints(signal?: AbortSignal): Promise<WireResult<GetCheckpointsResponse>>;
  /**
   * POST /api/checkpoint/plan - what a restore WOULD touch. Touches nothing.
   *
   * Separate from `restore` deliberately: the engine's rule is that no route
   * acts without stating first, and a panel with only `restore` would have to
   * act in order to find out what acting would do.
   */
  planRestore(seq: number, scope: RestoreScope, signal?: AbortSignal): Promise<WireResult<PostCheckpointPlanResponse>>;
  /**
   * POST /api/checkpoint - freeze the session's current state as a restore point.
   *
   * NOTHING CALLED THIS, and that made the whole rewind surface a lie: writes
   * were tracked, `/api/checkpoints` answered `{checkpoints: []}` forever, and
   * the panel said "No checkpoints yet" to every real user - under copy
   * promising one is taken before a turn edits files.
   */
  checkpoint(label: string): Promise<WireResult<PostCheckpointResponse>>;
  /** POST /api/checkpoint/restore - the same plan, AND what it then did. */
  restore(seq: number, scope: RestoreScope): Promise<WireResult<PostCheckpointRestoreResponse>>;
  /**
   * POST /api/git/discard -> `{ok, discarded}`. THROWS THE CHANGE AWAY.
   *
   * The one genuinely destructive call in this client: the content is not in
   * the index, not in a commit, and not recoverable by git once it is gone.
   * The server refuses an empty list rather than guessing destructively, and
   * the caller confirms before reaching this.
   *
   * The route shipped and no client half was ever written - so the Revert
   * control sat disabled behind a tooltip saying "No route discards a
   * working-tree change", which stopped being true the day the route landed.
   */
  discard(paths: string[]): Promise<WireResult<{ ok: boolean; discarded: string[] }>>;
  commit(message: string, paths: string[]): Promise<WireResult<PostGitCommitResponse>>;
  /**
   * GET /api/git/revisions → what a reviewer can NAME.
   *
   * The commit and branch scopes have had routes since the diff learned
   * `?scope=`; what they lacked was a way to choose. This is the list.
   */
  revisions(signal?: AbortSignal): Promise<WireResult<GitRevisionsResponse>>;
  /** GET /api/functions → the FunctionGraph the impact panel needs. */
  functions(signal?: AbortSignal): Promise<WireResult<{ functionGraph: FunctionGraph }>>;
}

/** Every route this lane touches, written down once so a test can assert on
 *  the same strings the client uses rather than on a copy of them. */
/** The shape `GET /api/git/revisions` answers with. */
export interface GitRevisionsResponse {
  commits: { sha: string; shortSha: string; subject: string; at: string }[];
  branches: string[];
  head: string | null;
}

export const REVIEW_ROUTES = [
  '/api/git/status',
  '/api/git/diff',
  '/api/git/commit',
  '/api/file',
  '/api/git/revisions',
  '/api/functions',
] as const;

/**
 * A relative, same-origin path or nothing.
 *
 * `//host/x` is protocol-relative and absolute at run time, and `/\host/x` is
 * parsed as protocol-relative by browsers because a backslash is a slash in
 * the authority position. Both are the classic ways past a check that only
 * looks for `https://`.
 */
function assertSameOrigin(path: string): string {
  const ok =
    path.startsWith('/') &&
    !(path.length > 1 && (path[1] === '/' || path[1] === '\\')) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(path);
  if (!ok) {
    throw new Error(
      `review may only request same-origin paths; refused ${JSON.stringify(path)}. ` +
        'Production is same-origin and development proxies /api — there is no absolute URL to add.',
    );
  }
  return path;
}

interface Init {
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(
  fetchImpl: typeof fetch,
  path: string,
  init: Init = { method: 'GET' },
): Promise<WireResult<T>> {
  assertSameOrigin(path);

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
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
    /* JSON IS DECIDED BY PARSING, NOT BY THE CONTENT-TYPE HEADER. A static
       file host answers every unknown path with index.html, a 200 and
       `text/html`; trusting the header means trusting the very server we are
       trying to identify. */
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
 * is written for a human — "path targets a reserved git-internal path", "a
 * decision record already exists and is never overwritten". Replacing it with
 * "HTTP 403" would throw away the only part of the response that says what to
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

export function createReviewClient(fetchImpl: typeof fetch = globalThis.fetch): ReviewClient {
  return {
    status: (signal) =>
      request<GetGitStatusResponse>(fetchImpl, '/api/git/status', { method: 'GET', signal }),

    /* The path is a repo-relative string chosen by git, and it travels as an
       ENCODED query parameter so it can never become part of the request's own
       host — which is what keeps the path being reviewed from defeating the
       same-origin guard above. */
    diff: (path, signal, scope) => {
      const q = new URLSearchParams({ path });
      if (scope && scope.kind !== 'worktree') {
        q.set('scope', scope.kind);
        if (scope.kind === 'commit') q.set('rev', scope.rev);
        if (scope.kind === 'branch') q.set('base', scope.base);
      }
      return request<GetGitDiffResponse>(fetchImpl, `/api/git/diff?${q.toString()}`, {
        method: 'GET',
        signal,
      });
    },

    revisions: (signal) =>
      request<GitRevisionsResponse>(fetchImpl, '/api/git/revisions?limit=20', {
        method: 'GET',
        signal,
      }),

    /*
     * THE sessionId IS WHAT MAKES A WRITE UNDOABLE, and it was missing.
     *
     * The engine takes a PRE-write baseline of every file it is about to
     * change — but only when the request names a session, because callers
     * written before checkpoints existed must keep behaving identically.
     * This client never named one, so the server-side session check was
     * false on every write, no baseline was ever taken, and the whole
     * checkpoint store stayed empty while every write reported success.
     */
    writeFile: (path, content) =>
      request<PutFileResponse>(fetchImpl, '/api/file', {
        method: 'PUT',
        body: { path, content, sessionId: checkpointSessionId() },
      }),

    checkpoints: (signal) =>
      request<GetCheckpointsResponse>(
        fetchImpl,
        `/api/checkpoints?sessionId=${encodeURIComponent(checkpointSessionId())}`,
        { method: 'GET', signal },
      ),

    checkpoint: (label) =>
      request<PostCheckpointResponse>(fetchImpl, '/api/checkpoint', {
        method: 'POST',
        body: { sessionId: checkpointSessionId(), label },
      }),

    planRestore: (seq, scope, signal) =>
      request<PostCheckpointPlanResponse>(fetchImpl, '/api/checkpoint/plan', {
        method: 'POST',
        body: { sessionId: checkpointSessionId(), seq, scope },
        signal,
      }),

    restore: (seq, scope) =>
      request<PostCheckpointRestoreResponse>(fetchImpl, '/api/checkpoint/restore', {
        method: 'POST',
        body: { sessionId: checkpointSessionId(), seq, scope },
      }),

    discard: (paths) =>
      request<{ ok: boolean; discarded: string[] }>(fetchImpl, '/api/git/discard', {
        method: 'POST',
        body: { paths },
      }),

    commit: (message, paths) =>
      request<PostGitCommitResponse>(fetchImpl, '/api/git/commit', {
        method: 'POST',
        body: { message, paths },
      }),

    functions: (signal) =>
      request<{ functionGraph: FunctionGraph }>(fetchImpl, '/api/functions', {
        method: 'GET',
        signal,
      }),
  };
}
