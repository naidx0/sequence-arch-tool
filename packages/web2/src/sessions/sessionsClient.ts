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

export function createSessionsClient(fetchImpl: typeof fetch = fetch): SessionsClient {
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
      go<GetSessionResponse>(
        repoPath
          ? `/api/sessions/${encodeURIComponent(id)}?repoPath=${encodeURIComponent(repoPath)}`
          : `/api/sessions/${encodeURIComponent(id)}`,
        { signal },
      ),
    readChat: (id, signal) =>
      go<GetSessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, { signal }),
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
  };
}
