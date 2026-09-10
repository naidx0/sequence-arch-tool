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
  create(mode?: 'work' | 'code'): Promise<WireResult<PostSessionsResponse>>;
  activate(id: string): Promise<WireResult<{ index: SessionIndex }>>;
  /**
   * The stored transcript for one session.
   *
   * The route has always returned `{ chat, meta, boardSeqd }` and no client
   * ever asked for it — which is why a reload showed a blank conversation that
   * was sitting on disk the whole time.
   */
  readSession(id: string, signal?: AbortSignal): Promise<WireResult<GetSessionResponse>>;
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

function sessionCreateBody(mode?: 'work' | 'code'): PostSessionsRequest {
  return mode ? { mode } : {};
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
    create: (mode) =>
      go<PostSessionsResponse>('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionCreateBody(mode)),
      }),
    activate: (id) =>
      go<{ index: SessionIndex }>('/api/sessions/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activateBody(id)),
      }),
    readSession: (id, signal) =>
      go<GetSessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, { signal }),
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
    remove: (id, repoPath) =>
      go<DeleteSessionResponse>(
        repoPath
          ? `/api/sessions/${encodeURIComponent(id)}?repoPath=${encodeURIComponent(repoPath)}`
          : `/api/sessions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
  };
}
