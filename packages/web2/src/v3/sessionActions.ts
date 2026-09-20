import type { Store } from '../state/store';
import { fromCanvasMemory } from '../sessions/canvasMemory';
import { fromChatMemory } from '../sessions/chatMemory';
import { clearSessionFlush, flushSessionMemory } from '../sessions/sessionPersist';
import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';

const defaultClient = createSessionsClient();

export async function softLoadSession(
  store: Store,
  sessionId: string,
  repoPath?: string,
  client: SessionsClient = defaultClient,
): Promise<{ outcome: 'ok' } | { outcome: 'error'; message: string }> {
  const answer = await client.readSession(sessionId, undefined, repoPath);
  if (answer.outcome !== 'ok') {
    store.dispatch({
      type: 'session/browse',
      activeId: sessionId,
      turns: [],
      browseRepoPath: repoPath ?? null,
    });
    return { outcome: 'error', message: answer.message };
  }
  const turns = fromChatMemory(answer.body.chat);
  store.dispatch({
    type: 'session/browse',
    activeId: sessionId,
    turns,
    browseRepoPath: repoPath ?? null,
  });

  /* Canvas from the session read — do not wait on /api/canvas-doc (active root only).
     `forSession` names the thread this read was FOR, so a reader who moved on
     while it was in flight does not have it landed on them (store.ts). */
  if (answer.body.canvas) {
    const doc = fromCanvasMemory(answer.body.canvas);
    if (doc.blocks.length > 0 || (doc.charts?.length ?? 0) > 0) {
      store.dispatch({ type: 'session/canvas-hydrated', doc, forSession: sessionId });
    }
  }

  /* Architecture overlay: DocProvider will re-fetch with browseRepoPath; also
     apply immediately when boardSeqd is present so soft switches paint without
     a second RTT. */
  if (typeof answer.body.boardSeqd === 'string' && answer.body.boardSeqd.trim()) {
    try {
      window.dispatchEvent(
        new CustomEvent('sequence:board-seqd', {
          detail: { sessionId, boardSeqd: answer.body.boardSeqd },
        }),
      );
    } catch {
      /* ignore — non-DOM environments */
    }
  }

  return { outcome: 'ok' };
}

/** Flip the rail highlight before the network returns — keep prior transcript
 *  until softLoad replaces it so switches are not a long empty wait. */
function optimisticSwitch(store: Store, sessionId: string): void {
  const prev = store.getState().session;
  store.dispatch({
    type: 'session/index',
    sessions: prev.sessions,
    activeId: sessionId,
  });
  store.dispatch({ type: 'session/hydrating' });
}

export async function browseCatalogSession(
  store: Store,
  repoPath: string,
  sessionId: string,
  client: SessionsClient = defaultClient,
): Promise<{ outcome: 'ok' } | { outcome: 'error'; message: string }> {
  /* Flush in the background so soft-open is not held for the full PUT budget. */
  void flushSessionMemory(600);
  clearSessionFlush();
  optimisticSwitch(store, sessionId);
  return softLoadSession(store, sessionId, repoPath, client);
}

/**
 * START A CHAT IN A WORKSPACE SECTION, WITHOUT ATTACHING THAT REPO.
 *
 * Owner walk 2026-09-17: "there should be a start-chat button near each folder
 * workspace so you can start a chat in that workspace." The rail already knows
 * every catalogued root (`GET /api/sessions` → `repos`) and could already
 * soft-open a thread in one; it just had no way to make one. `POST
 * /api/sessions` carries the root now, fenced by the server's
 * `sessionWriteRoot` — the same list the rail rendered from — and the reader
 * lands in the new thread SOFTLY, the way clicking one of its siblings does.
 */
export async function createChatInRepo(
  store: Store,
  repoPath: string,
  client: SessionsClient = defaultClient,
  mode?: 'work' | 'code',
): Promise<{ outcome: 'ok'; sessionId: string } | { outcome: 'error'; message: string }> {
  const answer = await client.create(mode, repoPath);
  if (answer.outcome !== 'ok') {
    return { outcome: 'error', message: answer.message };
  }
  const sessionId = answer.body.session.id;
  /* A fresh id may be a recycled one — clear its pads before anything can
     open onto a dead thread's drawing (see `clearSessionPads`). */
  clearSessionPads(sessionId);
  const browsed = await browseCatalogSession(store, repoPath, sessionId, client);
  if (browsed.outcome !== 'ok') {
    return { outcome: 'error', message: browsed.message };
  }
  return { outcome: 'ok', sessionId };
}

export function onSessionSwitched(store: Store, sessionId: string, client: SessionsClient = defaultClient): void {
  optimisticSwitch(store, sessionId);
  void softLoadSession(store, sessionId, undefined, client);
}

/** The three origin-wide localStorage pads a session id owns on the client. */
const SESSION_PADS = ['sequence.whiteboard', 'sequence.seqdraw', 'sequence.arch-scratch'] as const;

/**
 * Forget the client-side pads for one session id.
 *
 * Called for a freshly minted id (New Chat) and a deleted one. The pads are
 * keyed by id alone, never by root, and the engine used to recycle ids every
 * 2 h 46 m — so a new thread could open onto a dead thread's drawing.
 */
export function clearSessionPads(sessionId: string): void {
  try {
    for (const pad of SESSION_PADS) localStorage.removeItem(`${pad}.${sessionId}`);
  } catch {
    /* storage unavailable */
  }
}

export async function createNewChat(
  store: Store,
  client: SessionsClient = defaultClient,
  mode?: 'work' | 'code',
): Promise<{ outcome: 'ok'; sessionId: string } | { outcome: 'error'; message: string }> {
  /*
   * NEW CHAT IS NOT A FORK, AND THE OLD CANVAS FOLLOWED IT ANYWAY.
   *
   * Owner, 2026-09-17: "when you make a new chat it forks automatically off
   * the old chat … it brings the same exact drawing from previously." Three
   * things conspired, and this function owned the first:
   *
   *   1. The flush was fire-and-forget, and its canvas write named no session
   *      (`PUT /api/canvas-doc` resolves "active" AFTER reading the body). So
   *      the old thread's blocks were still in flight when `POST /api/sessions`
   *      moved `activeId` — and they landed in the NEW thread's canvas.json,
   *      over the empty one the server had just written. The flush is awaited
   *      now (bounded — a hung PUT still cannot hold the door), and the canvas
   *      write itself carries its session id (`sessionPersist.ts`).
   *   2. `session/index` moved `activeId` one dispatch before `session/browse`
   *      cleared the canvas doc. In the render between them the AI Canvas
   *      re-keyed its SeqDraw pad to the new id while still holding the old
   *      artifacts, and its append effect persisted them there. `browse` now
   *      goes first: it moves the id and empties the surfaces in one state.
   *   3. Ids recycled every 2 h 46 m and the pads outlived their threads —
   *      `sessionsStore.uniqueSessionId` now always adds a random tail, and
   *      the pads for a fresh id are cleared here regardless.
   */
  await flushSessionMemory(600);
  clearSessionFlush();
  const answer = await client.create(mode);
  if (answer.outcome !== 'ok') {
    return { outcome: 'error', message: answer.message };
  }
  const sessionId = answer.body.session.id;
  clearSessionPads(sessionId);
  /* Hard empty surfaces — never carry the previous thread's board/canvas/marks.
     `browse` FIRST: it flips `activeId` and clears the canvas in one dispatch. */
  store.dispatch({ type: 'session/browse', activeId: sessionId, turns: [], browseRepoPath: null });
  store.dispatch({
    type: 'session/index',
    sessions: answer.body.index.sessions,
    activeId: answer.body.index.activeId ?? sessionId,
  });
  store.dispatch({ type: 'session/hydrating' });
  try {
    window.dispatchEvent(
      new CustomEvent('sequence:board-seqd', {
        detail: {
          sessionId,
          boardSeqd: JSON.stringify({
            version: 1,
            kind: 'service-flow',
            title: 'Local workspace',
            grounded: { graphId: `scratch:${sessionId}` },
            nodes: [],
            edges: [],
          }),
        },
      }),
    );
  } catch {
    /* non-DOM */
  }
  void softLoadSession(store, sessionId, undefined, client);
  return { outcome: 'ok', sessionId };
}

/**
 * Fork: keep board + canvas (+ client whiteboard), empty transcript.
 */
export async function forkChat(
  store: Store,
  sourceId: string,
  client: SessionsClient = defaultClient,
  mode?: 'work' | 'code',
): Promise<{ outcome: 'ok'; sessionId: string } | { outcome: 'error'; message: string }> {
  void flushSessionMemory(600);
  clearSessionFlush();
  const answer = await client.fork(sourceId, mode);
  if (answer.outcome !== 'ok') {
    return { outcome: 'error', message: answer.message };
  }
  const sessionId = answer.body.session.id;
  /* Copy whiteboard / SeqDraw localStorage pads from source → fork. */
  try {
    const wbSrc = localStorage.getItem(`sequence.whiteboard.${sourceId}`);
    if (wbSrc) localStorage.setItem(`sequence.whiteboard.${sessionId}`, wbSrc);
    const sdSrc = localStorage.getItem(`sequence.seqdraw.${sourceId}`);
    if (sdSrc) localStorage.setItem(`sequence.seqdraw.${sessionId}`, sdSrc);
    const scratchSrc = localStorage.getItem(`sequence.arch-scratch.${sourceId}`);
    if (scratchSrc) {
      let next = scratchSrc;
      try {
        const parsed = JSON.parse(scratchSrc) as { grounded?: { graphId?: string } };
        if (parsed?.grounded?.graphId?.startsWith('scratch:')) {
          parsed.grounded.graphId = `scratch:${sessionId}`;
          next = JSON.stringify(parsed);
        }
      } catch {
        /* keep */
      }
      localStorage.setItem(`sequence.arch-scratch.${sessionId}`, next);
    }
  } catch {
    /* storage unavailable */
  }
  store.dispatch({
    type: 'session/index',
    sessions: answer.body.index.sessions,
    activeId: answer.body.index.activeId ?? sessionId,
  });
  store.dispatch({ type: 'session/browse', activeId: sessionId, turns: [], browseRepoPath: null });
  store.dispatch({ type: 'session/hydrating' });
  void softLoadSession(store, sessionId, undefined, client);
  return { outcome: 'ok', sessionId };
}

export async function activateSession(
  store: Store,
  sessionId: string,
  client: SessionsClient = defaultClient,
): Promise<{ outcome: 'ok' } | { outcome: 'error'; message: string }> {
  /* Capture + kick flush, then activate immediately — awaiting 1.5s flush made
     chat switches feel broken (owner 2026-09-14). keepalive still delivers. */
  void flushSessionMemory(600);
  clearSessionFlush();
  optimisticSwitch(store, sessionId);

  const answer = await client.activate(sessionId);
  if (answer.outcome !== 'ok') {
    return { outcome: 'error', message: answer.message };
  }
  store.dispatch({
    type: 'session/index',
    sessions: answer.body.index.sessions,
    activeId: answer.body.index.activeId ?? sessionId,
  });
  /* Keep hydrating until softLoad finishes — index alone must not clear it. */
  store.dispatch({ type: 'session/hydrating' });
  return softLoadSession(store, sessionId, undefined, client);
}

export async function listAndHydrateSessions(
  store: Store,
  client: SessionsClient = defaultClient,
  signal?: AbortSignal,
): Promise<
  | { outcome: 'ok' }
  | { outcome: 'error'; message: string }
> {
  const answer = await client.list(signal);
  if (answer.outcome !== 'ok') {
    return { outcome: 'error', message: answer.message };
  }
  const index = answer.body.index;
  store.dispatch({
    type: 'session/index',
    sessions: index.sessions,
    activeId: typeof index.activeId === 'string' && index.activeId ? index.activeId : null,
  });
  return { outcome: 'ok' };
}
