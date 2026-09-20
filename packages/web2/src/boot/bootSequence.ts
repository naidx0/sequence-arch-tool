import type {
  GetArchGraphResponse,
  GetBrowseResponse,
  GetRecentResponse,
  GetStatusResponse,
  GraphSummary,
  PostAttachResponse,
  PostDetachResponse,
} from '@sequence/api-types';

import type { AttachFailure } from '../state/types';
import { classifyAttachFailure } from './attachFailure';

/**
 * ITEM 2.4 — THE BOOT LADDER. Pure, and therefore provable without a server.
 *
 * The item is one line in the plan: "Platform probe → attached hydrate →
 * static-graph fallback." Each arrow is a decision about what the app is
 * ALLOWED TO CLAIM once it has seen an answer, and every one of those decisions
 * lives in this file as a function of the answer. Nothing here opens a socket:
 * the transport is injected, so the ladder can be walked in a test against a
 * dead server, a lying static host, an authenticated server and a real one
 * without any of them existing.
 *
 * THE NON-NEGOTIABLE THIS IMPLEMENTS. `CLAUDE.md`: "Local-first: the app boots
 * and delivers its core with no network and no key." The failure this forbids
 * is not a crash — it is the three quieter ones:
 *
 *   1. A spinner that never resolves, because the probe has no "nothing
 *      answered" branch. Every rung below terminates in a named outcome.
 *   2. A red wall for a server that was never expected to be there. An engine
 *      that is not running is the local-first case working, not a fault.
 *   3. A board painted from a payload nobody checked. `readScannedGraph`
 *      refuses anything that has not proved it is a graph, which is what stops
 *      a static host's `index.html` — served with a 200 for every unknown path
 *      — from becoming an empty architecture diagram.
 *
 * THE THIRD RUNG, EXPLAINED, because "static-graph fallback" is the phrase
 * everyone reads past. `/archgraph.json` is a FILE PATH, not just a route. A
 * server-rendered Sequence answers it from the attached repo; a directory of
 * static files answers it from disk if somebody exported a graph there, and
 * 404s otherwise. So when the platform probe finds no platform, the honest next
 * question is not "should I show an error" but "is there a graph here anyway".
 * If there is, the board paints it and the shell says the engine is not
 * running, so nothing on screen is a lie in either direction: the picture is
 * real and the disabled controls are explained.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT PRODUCE. `ScannedRepo` in the frozen
 * state contract carries `doc: SeqDiagramV1` — the projection the canvas
 * paints, made by `seqdFromGraph`. That projection is not this lane's to write
 * and never was: boot's job is to find out what is there, not to decide how it
 * is drawn. So boot yields {@link ScannedRepoDraft}: everything one scan
 * produced EXCEPT the projection. The store composes the two, using the
 * projector the application bound. Faking a `doc` here would be a diagram this
 * lane invented, which is the one thing the grounding invariant forbids
 * outright.
 */

/* ========================================================================== *
 * THE TRANSPORT SEAM
 * ========================================================================== */

/**
 * What came back, as four cases rather than a thrown exception and a `.ok`.
 *
 * `not-json` is the case that does not exist in most clients and is the one
 * that matters here: a static file host answers EVERY unknown path with
 * `index.html` and a 200. A client that only checks `response.ok` reads that as
 * a successful `/api/status` call, `JSON.parse` throws somewhere downstream,
 * and the honest fact — there is no platform on this origin — is never
 * available to the surface that has to explain it.
 */
export type WireResult<T> =
  | { outcome: 'ok'; status: number; body: T }
  | { outcome: 'error'; status: number; body: unknown }
  | { outcome: 'not-json'; status: number }
  | { outcome: 'unreachable'; message: string };

/**
 * Every call the boot lane may make. An interface rather than a module of
 * functions so a test supplies answers directly, and so the day this package
 * grows the shared `api/client.ts` the plan names, that client can implement
 * this and nothing in the ladder moves.
 */
export interface BootTransport {
  status(): Promise<WireResult<GetStatusResponse>>;
  /** `unknown` on purpose: a payload is not a graph until it has proved it. */
  archGraph(): Promise<WireResult<unknown>>;
  recent(): Promise<WireResult<GetRecentResponse>>;
  browse(path: string | null): Promise<WireResult<GetBrowseResponse>>;
  attach(path: string): Promise<WireResult<PostAttachResponse>>;
  /** Leave the attached repository. See bootClient for why this arrived late. */
  detach(): Promise<WireResult<PostDetachResponse>>;
}

/**
 * Every route this lane touches, written down once.
 *
 * They are relative paths, and that is the entire mechanism by which boot
 * cannot reach a third party: a leading single slash can only be resolved
 * against the page's own origin. `bootClient.ts` enforces the property;
 * `boot.test.tsx` asserts it. The list is exported so the assertion is against
 * the same strings the client uses rather than a copy of them.
 */
export const BOOT_ROUTES = [
  '/api/status',
  '/archgraph.json',
  '/api/recent',
  '/api/browse',
  '/api/attach',
  '/api/detach',
] as const;

/* ========================================================================== *
 * WHAT ONE SCAN PRODUCED
 * ========================================================================== */

/**
 * `ScannedRepo` minus the one field this lane cannot honestly fill.
 *
 * See the file header: `doc` is `seqdFromGraph`'s output, and the store — not
 * this lane — applies it, composing
 * `{ ...draft, doc: project(draft.graph), functions: null, tree: null }` in
 * `loadRepo`. The projector is bound in `app/App.tsx` as
 * `(graph) => seqdFromGraph(graph, graph.nodeDetail)`.
 *
 * THE TYPE SURVIVES THE LIFT rather than being deleted by it. A draft is what
 * this lane can honestly produce, and keeping the two shapes distinct is what
 * makes "boot found a graph" and "the store has something to paint" two
 * checkable facts instead of one assumed one.
 */
export interface ScannedRepoDraft {
  root: string;
  repoName: string;
  /** The `/archgraph.json` payload WHOLE, detail map included. */
  graph: GetArchGraphResponse;
  summary: GraphSummary;
  /** `ArchGraph.scannedAt`, which item 1.8 also makes the ETag. */
  scannedAt: string;
}

/* ========================================================================== *
 * THE OUTCOMES
 * ========================================================================== */

/**
 * Whether the platform answered, and what it was asked.
 *
 * `reachable` mirrors `NetSlice.reachable` in the frozen contract, whose own
 * comment is the constraint: "There is no push channel beyond the terminal
 * socket (gap G6), so this is the boot probe's result and not a live connection
 * state." It is a fact with a timestamp, not a status light.
 */
export interface PlatformReport {
  reachable: boolean;
  /** Why we believe that, in one clause, for the message and for a bug report. */
  detail: string;
  at: number;
}

/**
 * Where boot ended. Seven outcomes, each of which the shell renders differently
 * and none of which is "error".
 *
 * `foreign-repo` and `sign-in-required` exist because collapsing them into
 * `unattached` would be a lie of a specific kind: the app would offer to attach
 * a repo on a server that already has one, or would send a user with a login
 * problem to check their network cable.
 */
export type BootOutcome =
  | { kind: 'attached'; repo: ScannedRepoDraft; platform: PlatformReport }
  | { kind: 'unattached'; platform: PlatformReport }
  | { kind: 'foreign-repo'; platform: PlatformReport }
  | { kind: 'sign-in-required'; platform: PlatformReport }
  | { kind: 'static-graph'; repo: ScannedRepoDraft; platform: PlatformReport }
  | { kind: 'no-engine'; platform: PlatformReport }
  | { kind: 'hydrate-failed'; failure: AttachFailure; platform: PlatformReport };

/**
 * HAS THE ENGINE MOVED SINCE THIS OUTCOME WAS SETTLED?
 *
 * Boot is deliberately one-shot - `PlatformReport`'s own comment calls its
 * result "a fact with a timestamp, not a status light", and that framing is
 * right. But a fact with a timestamp goes out of date, and nothing was ever
 * re-asking.
 *
 * MEASURED, on the owner's own run: a tab opened before a repository was
 * attached kept saying `no repo attached` while the engine answered questions
 * from that repository's graph - citing "300 of 1,743 edges", the real figure.
 * The client was not wrong about what it had been told; it had been told once.
 *
 * Three reported symptoms collapse into this one. `GET /api/ai-config` is
 * fetched GATED ON ATTACHMENT (`state/connect.tsx`), so a stale `repo.phase`
 * also means the model label never loads and the composer keeps offering
 * "choose a model in Settings" over a configured provider. The board's "No
 * graph yet" is the third.
 *
 * PURE, and deliberately conservative: an unreachable engine (`null`) is NOT
 * stale. Re-running the ladder because a probe failed would turn a flaky
 * network into a boot loop, and the surface for "the engine stopped answering"
 * is a different one.
 */
export function bootIsStale(outcome: BootOutcome, status: GetStatusResponse | null): boolean {
  if (status === null) return false;

  const engineAttached = status.attached === true;
  const clientAttached = outcome.kind === 'attached';
  if (engineAttached !== clientAttached) return true;

  /*
   * Same answer to "is anything attached", different repository. Switching
   * repositories from another window leaves this one describing the old one,
   * which is the same lie in a shape the boolean cannot see.
   */
  const engineRoot = 'root' in status ? status.root : undefined;
  if (engineAttached && outcome.kind === 'attached' && typeof engineRoot === 'string') {
    return engineRoot !== outcome.repo.root;
  }
  return false;
}

/* ========================================================================== *
 * THE LADDER
 * ========================================================================== */

/**
 * Walk the three rungs and stop at the first one that answers.
 *
 * Total: every path returns a {@link BootOutcome}, and there is no throw. A
 * boot sequence that can throw has a state — "it broke before it decided
 * anything" — that no surface has been given words for, and the surface that
 * ends up rendering it is a blank page.
 */
export async function runBoot(transport: BootTransport, now = Date.now): Promise<BootOutcome> {
  /* ── Rung 1: the platform probe ────────────────────────────────────────── */
  const probe = await transport.status();

  if (probe.outcome === 'ok') {
    const platform: PlatformReport = {
      reachable: true,
      detail: 'the engine answered GET /api/status',
      at: now(),
    };

    if (!probe.body.attached) return { kind: 'unattached', platform };

    /*
     * `{ attached: true }` with no name and no root is the authenticated
     * non-owner answer (`repoServer.ts`, the /api/status arm). The withholding
     * is deliberate — it is a leak fix — so the client must handle the narrow
     * shape rather than assume the wide one. /archgraph.json would 403 for this
     * caller, so hydrating is not an option and pretending to be attached would
     * put a repo name on screen that the shell does not have.
     */
    const owned = probe.body as { repoName?: unknown; root?: unknown };
    if (typeof owned.repoName !== 'string' || typeof owned.root !== 'string') {
      return { kind: 'foreign-repo', platform };
    }

    /* ── Rung 2: the attached hydrate ────────────────────────────────────── */
    const graphAnswer = await transport.archGraph();
    if (graphAnswer.outcome === 'ok') {
      const graph = readScannedGraph(graphAnswer.body);
      if (graph !== null) {
        return {
          kind: 'attached',
          platform,
          repo: {
            root: owned.root,
            repoName: owned.repoName,
            graph,
            summary: summarizeGraph(graph),
            scannedAt: graph.scannedAt,
          },
        };
      }
      /* Attached, 200, and not a graph. Nothing sensible remains to paint, and
       * "the graph route answered with something else" is a real fact worth
       * saying rather than a blank canvas. */
      return {
        kind: 'hydrate-failed',
        platform,
        failure: {
          kind: 'transport',
          status: graphAnswer.status,
          message: 'the graph route answered with something that is not a graph',
        },
      };
    }

    return {
      kind: 'hydrate-failed',
      platform,
      failure: classifyWireFailure(graphAnswer),
    };
  }

  if (probe.outcome === 'error') {
    const platform: PlatformReport = {
      reachable: true,
      detail: `the engine answered ${probe.status} to GET /api/status`,
      at: now(),
    };
    /*
     * It ANSWERED. `/api/status` is in the server's SENSITIVE_EXACT set, so 401
     * means auth is on and this browser has no session — a login problem, not a
     * network one, and the two send the user to completely different places.
     */
    if (probe.status === 401 || probe.status === 403) {
      return { kind: 'sign-in-required', platform };
    }
    /* Any other status from /api/status means something is listening but it is
     * not a Sequence platform speaking the contract. Fall through to the static
     * rung: a plain file host answering 404 here may still serve a graph. */
  }

  /* ── Rung 3: the static-graph fallback ─────────────────────────────────── */
  const platform: PlatformReport = {
    reachable: false,
    detail:
      probe.outcome === 'unreachable'
        ? `nothing answered on this origin (${probe.message})`
        : probe.outcome === 'not-json'
          ? 'this origin answered GET /api/status with something that is not JSON'
          : `this origin answered ${probe.status} to GET /api/status`,
    at: now(),
  };

  const staticAnswer = await transport.archGraph();
  if (staticAnswer.outcome === 'ok') {
    const graph = readScannedGraph(staticAnswer.body);
    if (graph !== null) {
      return {
        kind: 'static-graph',
        platform,
        repo: {
          /* A file has no session and no attach record, so the only two names
           * available are the ones the scan wrote into the graph itself. */
          root: graph.repoRoot,
          repoName: graph.repoName,
          graph,
          summary: summarizeGraph(graph),
          scannedAt: graph.scannedAt,
        },
      };
    }
  }

  return { kind: 'no-engine', platform };
}

/**
 * A wire answer as a classified failure. ONE mapping, 2.4's, shared by the
 * hydrate rung and by every call the attach dialog makes.
 *
 * It is exported for that reason and not for convenience: browse, attach and
 * the graph read share a jail and a status vocabulary, so a 403 that reads one
 * way when you browse into a folder and another way when you open it is two
 * products, and the second one is the one the user does not trust.
 */
export function classifyWireFailure(answer: WireResult<unknown>): AttachFailure {
  switch (answer.outcome) {
    case 'error':
      return classifyAttachFailure(answer.status, answer.body);
    case 'not-json':
      return classifyAttachFailure(answer.status, {
        error: 'the response was not JSON',
      });
    case 'unreachable':
      return classifyAttachFailure(null, null, answer.message);
    case 'ok':
      /* Unreachable by construction — every caller checks `ok` first — but the
       * function stays total rather than throwing on a case it cannot meet. */
      return classifyAttachFailure(answer.status, answer.body);
  }
}

/* ========================================================================== *
 * READING A PAYLOAD
 * ========================================================================== */

/**
 * Return the payload as a graph, or `null` if it has not proved it is one.
 *
 * THE CHECK IS STRUCTURAL AND SHALLOW, ON PURPOSE. It is not a validator —
 * `validateGraph` in `@sequence/schema` is that, it is total, and it is the
 * right thing to run once this package depends on the schema. What this
 * function has to stop is narrower and more common: a 200 carrying an HTML
 * document, an error envelope, or an empty object being treated as a graph and
 * painted as an empty board. Checking that `nodes` and `edges` are arrays and
 * that the names the projection reads are strings is enough to separate "a
 * graph with nothing in it" — a real and honest answer — from "not a graph".
 *
 * `nodeDetail` is defaulted to `{}` rather than required, because a raw
 * `archgraph.json` written to disk by the CLI is an `ArchGraph` and has no
 * detail map; `{}` is exactly what the route itself sends when there is none,
 * so this is the platform's own "no detail", not an invention.
 */
export function readScannedGraph(payload: unknown): GetArchGraphResponse | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
  if (!Array.isArray(record.warnings)) return null;
  if (typeof record.repoName !== 'string') return null;
  if (typeof record.repoRoot !== 'string') return null;
  if (typeof record.scannedAt !== 'string') return null;

  const detail = record.nodeDetail;
  const nodeDetail =
    typeof detail === 'object' && detail !== null && !Array.isArray(detail) ? detail : {};

  return { ...record, nodeDetail } as unknown as GetArchGraphResponse;
}

/**
 * The five counts, off the graph.
 *
 * MIRRORS `graphSummary()` IN THE PLATFORM (`repoServer.ts`, cited in
 * `@sequence/api-types` as the definition of `GraphSummary`), and is used only
 * where the platform did not send one: `POST /api/attach` returns the real
 * `graphSummary`, and that answer is preferred over this one wherever it
 * exists. `/archgraph.json` returns no summary at all, so on the hydrate and
 * static rungs there is either this count or no counts, and no counts means a
 * shell that cannot say how big the thing it just loaded is.
 *
 * This is counting, not deciding. The rule in `src/README.md` — "the UI never
 * computes what the analyzer decides" — is about ranking, scoring and
 * inference; `nodes.length` is arithmetic over data the analyzer produced and
 * has exactly one right answer. If a sixth member is ever added to
 * `GraphSummary`, or a member stops being a plain count, this function must
 * stop existing rather than grow a rule of its own.
 */
export function summarizeGraph(graph: {
  nodes: readonly { kind: string }[];
  edges: readonly unknown[];
}): GraphSummary {
  let services = 0;
  let datastores = 0;
  let topics = 0;
  for (const node of graph.nodes) {
    if (node.kind === 'service') services += 1;
    else if (node.kind === 'datastore') datastores += 1;
    else if (node.kind === 'topic') topics += 1;
  }
  return { nodes: graph.nodes.length, edges: graph.edges.length, services, datastores, topics };
}
