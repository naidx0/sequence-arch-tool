/* ══════════════════════════════════════════════════════════════════════════
   THE SESSIONS WIRE — /api/sessions
   packages/web2/src/sessions/sessionsClient.ts

   The routes have existed and complete for as long as the panel has said
   "Built in a later wave": GET lists the index, POST creates one, and
   PUT /api/sessions/active switches. Only the surface was missing.

   It follows `settingsClient`'s shape, which follows `reviewClient`'s: a narrow
   interface, a `WireResult` union, `fetch` injected so a test drives it without
   a server. A third client shape in one package would be a third place to get
   the error handling wrong.
   ══════════════════════════════════════════════════════════════════════════ */

import { sharedGet } from '../api/sharedGet';
import type { ChatMemory } from './chatMemory';
import type {
  DeleteSessionResponse,
  GetSessionResponse,
  GoalRunState,
  PostGoalRunRequest,
  PostGoalRunResponse,
  PostGoalRunStopResponse,
  GetSessionsResponse,
  PostSessionsRequest,
  PostSessionsResponse,
  PutActiveSessionRequest,
  PutSessionRequest,
  PutSessionResponse,
  SessionIndex,
  GetRecentResponse,
} from '@sequence/api-types';

export type WireResult<T> =
  | { outcome: 'ok'; body: T }
  | { outcome: 'error'; status: number; message: string };

export interface SessionsClient {
  list(signal?: AbortSignal): Promise<WireResult<GetSessionsResponse>>;
  /**
   * `repoPath` names a catalogued repo OTHER than the active root — the rail's
   * per-workspace "+", which starts a chat in a section without attaching it.
   * Same fence as `update`: the server refuses a path it does not already list
   * in `GET /api/sessions`'s `repos`. Omit ⇒ the active root, exactly as every
   * call site did before the field existed.
   */
  create(mode?: 'work' | 'code', repoPath?: string): Promise<WireResult<PostSessionsResponse>>;
  /** Fork board+canvas into a new empty-transcript session. */
  fork(sourceId: string, mode?: 'work' | 'code'): Promise<WireResult<PostSessionsResponse>>;
  activate(id: string): Promise<WireResult<{ index: SessionIndex }>>;
  /**
   * The stored transcript for one session.
   *
   * The route has always returned `{ chat, meta, boardSeqd }` and no client
   * ever asked for it — which is why a reload showed a blank conversation that
   * was sitting on disk the whole time.
   *
   * `repoPath` names a catalogued repo OTHER than the attached one — soft-read
   * a foreign thread without attaching. Omit ⇒ active root.
   */
  readSession(
    id: string,
    signal?: AbortSignal,
    repoPath?: string,
  ): Promise<WireResult<GetSessionResponse>>;
  /** @deprecated Use `readSession` — the route always returned `boardSeqd` too. */
  readChat(id: string, signal?: AbortSignal): Promise<WireResult<GetSessionResponse>>;
  writeChat(id: string, chat: ChatMemory): Promise<WireResult<unknown>>;
  writeBoardSeqd(id: string, boardSeqd: string): Promise<WireResult<PutSessionResponse>>;
  /**
   * A PATCH despite the verb (the server's own words): rename and pin/unpin go
   * out as `{ title }` / `{ pinned }` and only those fields move. The route has
   * served this since the index existed — `updateSession` in the analyzer's
   * sessionsStore — so the sidebar wires what the backend actually serves.
   *
   * `repoPath` names a repo OTHER than the attached one — the workspace
   * catalog's rows. Omit it and the server writes the active root, exactly as
   * every call site did before the field existed. The server refuses a path it
   * does not already list in `GET /api/sessions`'s `repos`, so this cannot
   * write outside the catalog.
   */
  update(
    id: string,
    patch: PutSessionRequest,
    repoPath?: string,
  ): Promise<WireResult<PutSessionResponse>>;
  /**
   * THE GOAL RUN — read, start, stop.
   *
   * `readGoalRun` is POLLED (`useGoalRun`, 1.5s) rather than streamed, and that
   * is a property of what it asks rather than a shortcut. A run is a PERSISTED
   * ROW, not a sequence of events: the whole state fits in one small object,
   * any window may read it, and a dropped connection costs one poll instead of
   * needing a `since=` cursor to recover. `programsClient` streams because a
   * program run emits events; this one has a state.
   *
   * `startGoalRun` carries the PERMISSION the composer is set to, for the same
   * reason every ask does — the mode is a per-turn choice the person makes, and
   * the server stores no copy of it. A non-Build permission is refused with a
   * 400 and a reason, never downgraded.
   */
  readGoalRun(id: string, signal?: AbortSignal, repoPath?: string): Promise<WireResult<GoalRunState>>;
  startGoalRun(
    id: string,
    body: PostGoalRunRequest,
    repoPath?: string,
  ): Promise<WireResult<PostGoalRunResponse>>;
  stopGoalRun(id: string, repoPath?: string): Promise<WireResult<PostGoalRunStopResponse>>;
  /** DELETE /api/sessions/:id. The engine re-homes `activeId` itself when the
   *  deleted session was the active one; whatever it answers is the new truth.
   *  `repoPath` travels as a query param (a DELETE has no body). */
  remove(id: string, repoPath?: string): Promise<WireResult<DeleteSessionResponse>>;

  /**
   * Take a project out of the workspace list.
   *
   * IT EDITS A LIST OF PATHS. Nothing on this path can remove a folder, and
   * the wording wherever it is offered has to make that unmistakable — the
   * owner's word for this is "delete" (2026-09-21).
   */
  removeRepo(repoPath: string): Promise<WireResult<GetRecentResponse>>;

  /**
   * Put the workspace list in this order, front to back.
   *
   * Projects not named are kept behind the ones that are. The rail can only
   * send what it can currently draw, so an order is never a statement about a
   * project on a drive that happens to be unreachable.
   */
  reorderRepos(order: readonly string[]): Promise<WireResult<GetRecentResponse>>;

  /**
   * File a chat under a different project.
   *
   * The transcript, the canvas and the board go with it and the id is kept.
   * A refusal means NOTHING MOVED — the chat is still whole in the project it
   * started in, which is the one promise every failure path here shares.
   */
  moveChat(
    id: string,
    from: string,
    to: string,
  ): Promise<WireResult<{ from: unknown; to: unknown }>>;
}

export const SESSIONS_ROUTES = ['/api/sessions', '/api/sessions/active'] as const;

async function parse<T>(res: Response): Promise<WireResult<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return {
      outcome: 'error',
      status: res.status,
      message: `the server did not answer with JSON (${res.status})`,
    };
  }
  if (!res.ok) {
    const message =
      typeof (body as { error?: unknown } | null)?.error === 'string'
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    return { outcome: 'error', status: res.status, message };
  }
  return { outcome: 'ok', body: body as T };
}

/* ══ THE BODIES ARE TYPED, AND THAT IS THE POINT ═══════════════════════════

   These exist because `JSON.stringify` accepts anything. `activate` used to
   inline `JSON.stringify({ id })` while `PutActiveSessionRequest` declares
   `activeId` and the server 400s on anything else — so every click on a
   session row failed, TypeScript had nothing to check, and the unit test
   asserted the body the client happened to send rather than the body the
   contract requires.

   Naming the type here turns that class of defect into a COMPILE ERROR: rename
   a field in @sequence/api-types and this stops building, rather than shipping
   and 400ing. */

function activateBody(id: string): PutActiveSessionRequest {
  return { activeId: id };
}

function sessionCreateBody(
  mode?: 'work' | 'code',
  forkFromId?: string,
  repoPath?: string,
): PostSessionsRequest {
  const body: PostSessionsRequest = {};
  if (mode) body.mode = mode;
  if (forkFromId) body.forkFromId = forkFromId;
  /* Absent stays absent — an explicit `repoPath: ''` is a 400, the same
     reason `update` spreads rather than always setting the key. */
  if (repoPath) body.repoPath = repoPath;
  return body;
}

/**
 * `/api/sessions/:id/goal-run[/stop]`, with the catalog `repoPath` where the
 * other session calls carry it.
 *
 * Built here rather than inline three times, because the `?repoPath=` half is
 * the easy one to forget on the call nobody exercises — and a goal run started
 * against the ACTIVE root for a thread the person opened from the workspace
 * catalog would work the wrong repository's plan down.
 */
function goalRunUrl(id: string, repoPath?: string, suffix = ''): string {
  const base = `/api/sessions/${encodeURIComponent(id)}/goal-run${suffix}`;
  return repoPath ? `${base}?repoPath=${encodeURIComponent(repoPath)}` : base;
}

/**
 * ── `fetch`, READ WHEN IT IS CALLED AND NOT WHEN THIS MODULE LOADS ────────
 *
 * `createSessionsClient(fetchImpl = fetch)` captured whatever `fetch` was at
 * the moment the factory ran. That was harmless while every call site built a
 * client PER RENDER — "now" was always current — and it broke the instant
 * there was ONE client built at module load: it closed over the global that
 * existed before any test had installed a spy, and before some hosts have
 * finished setting one up.
 *
 * Caught by the boot-read probe rather than by reasoning: with the singleton
 * capturing early, the rail stopped issuing `GET /api/sessions` ALTOGETHER and
 * the read count "improved" from seven to one. A number that gets better
 * because a feature stopped working is the failure mode this whole change is
 * about, arriving in the measurement instead of the product.
 *
 * Late-bound, so the client asks the global what it is at the moment it needs
 * it. Injection is unchanged and is still what tests use.
 */
function liveFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

/**
 * ── THE ONE CLIENT, AND WHY A FACTORY IS NOT ENOUGH ───────────────────────
 *
 * `createSessionsClient()` returns a NEW OBJECT every call. That is right for
 * a factory and it was wrong in two places that called it FROM A RENDER:
 * `V3Shell`'s body and `V3SessionsRail`'s default parameter (a default is
 * re-evaluated on every render, not once).
 *
 * The rail's mount effect lists `client` in its dependencies — correctly, a
 * different client is a different server. So a fresh object per render meant a
 * fresh dependency per render, and the effect re-ran on every V3Shell render
 * that had nothing to do with sessions: a repo slice settling, a pane
 * measuring, a chrome tab moving. Measured at boot, 2026-09-20: the effect ran
 * THREE TIMES and issued six `GET /api/sessions` between them, before the
 * reader had done anything.
 *
 * A singleton rather than a `useMemo` at each site, because "which server am I
 * talking to" is a property of the app and not of a component. The factory
 * stays exported and is what tests use to inject a `fetch`; this is the one
 * the product runs on.
 */
export const sessionsClient: SessionsClient = createSessionsClientImpl(liveFetch);

export function createSessionsClient(fetchImpl: typeof fetch = liveFetch): SessionsClient {
  return createSessionsClientImpl(fetchImpl);
}

function createSessionsClientImpl(fetchImpl: typeof fetch): SessionsClient {
  const go = async <T>(url: string, init?: RequestInit): Promise<WireResult<T>> => {
    try {
      return await parse<T>(await fetchImpl(url, init));
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { outcome: 'error', status: 0, message: 'cancelled' };
      }
      return { outcome: 'error', status: 0, message: (e as Error).message };
    }
  };

  /* A plain GET of one session: concurrent readers share it (api/sharedGet.ts). */
  const goShared = async <T>(url: string, signal?: AbortSignal): Promise<WireResult<T>> => {
    try {
      return await parse<T>(await sharedGet(url, signal, fetchImpl));
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { outcome: 'error', status: 0, message: 'cancelled' };
      }
      return { outcome: 'error', status: 0, message: (e as Error).message };
    }
  };

  return {
    list: (signal) =>
      go<GetSessionsResponse>('/api/sessions', { signal, headers: { accept: 'application/json' } }),
    create: (mode, repoPath) =>
      go<PostSessionsResponse>('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionCreateBody(mode, undefined, repoPath)),
      }),
    fork: (sourceId, mode) =>
      go<PostSessionsResponse>('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionCreateBody(mode, sourceId)),
      }),
    activate: (id) =>
      go<{ index: SessionIndex }>('/api/sessions/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activateBody(id)),
      }),
    readSession: (id, signal, repoPath) =>
      goShared<GetSessionResponse>(
        repoPath
          ? `/api/sessions/${encodeURIComponent(id)}?repoPath=${encodeURIComponent(repoPath)}`
          : `/api/sessions/${encodeURIComponent(id)}`,
        signal,
      ),
    readChat: (id, signal) => goShared<GetSessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, signal),
    writeBoardSeqd: (id, boardSeqd) =>
      go<PutSessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardSeqd }),
      }),
    writeChat: (id, chat) =>
      go<unknown>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        /* The server reads `chat` off the body and patches only what it was
           given, so sending the transcript alone cannot clobber `meta` or the
           stored board. */
        body: JSON.stringify({ chat }),
      }),
    update: (id, patch, repoPath) =>
      go<PutSessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        /* Spread rather than always setting the key: a body carrying
           `repoPath: undefined` is byte-identical after JSON.stringify, but an
           explicit `repoPath: ''` would be a 400. Absent stays absent. */
        body: JSON.stringify(repoPath ? { ...patch, repoPath } : patch),
      }),
    readGoalRun: (id, signal, repoPath) =>
      go<GoalRunState>(goalRunUrl(id, repoPath), { signal, headers: { accept: 'application/json' } }),
    startGoalRun: (id, body, repoPath) =>
      go<PostGoalRunResponse>(goalRunUrl(id, repoPath), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    stopGoalRun: (id, repoPath) =>
      go<PostGoalRunStopResponse>(goalRunUrl(id, repoPath, '/stop'), { method: 'POST' }),
    remove: (id, repoPath) =>
      go<DeleteSessionResponse>(
        repoPath
          ? `/api/sessions/${encodeURIComponent(id)}?repoPath=${encodeURIComponent(repoPath)}`
          : `/api/sessions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),

    removeRepo: (repoPath) =>
      go<GetRecentResponse>('/api/recent', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: repoPath }),
      }),

    moveChat: (id, from, to) =>
      go<{ from: unknown; to: unknown }>('/api/sessions/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, from, to }),
      }),

    reorderRepos: (order) =>
      go<GetRecentResponse>('/api/recent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: [...order] }),
      }),
  };
}
