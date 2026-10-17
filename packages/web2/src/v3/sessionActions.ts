import type { GetSessionResponse, GetSessionsResponse } from '@sequence/api-types';

import type { Store } from '../state/store';
import { rememberPlace } from '../sessions/lastPlaceClient';
import { isPristineChat } from '../sessions/emptyChat';
import { fromCanvasMemory } from '../sessions/canvasMemory';
import { fromChatMemory } from '../sessions/chatMemory';
import { agentRuns, restoreAgentTranscript } from '../agents/agentRuns';
import { forgetChat } from '../agents/chatConfig';
import { clearSessionFlush, flushSessionMemory } from '../sessions/sessionPersist';
import { sessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { boardKeyOf, canvasKeyOf, chatKeyOfTurns, chatKeyOfWire, forgetSnapshot, getSnapshot, markApplied, rememberLeaving, rememberRead, turnCountOfWire } from './sessionSnapshots';

/* The app's one client — see `sessionsClient.ts`. Aliased rather than renamed
   at every use site below, which would be a diff about nothing. */
const defaultClient = sessionsClient;

let loadSeq = 0;
/** The newest read each store has started. */
const latestLoad = new WeakMap<Store, number>();

export async function softLoadSession(
  store: Store,
  sessionId: string,
  repoPath?: string,
  client: SessionsClient = defaultClient,
): Promise<{ outcome: 'ok' } | { outcome: 'error'; message: string }> {
  const mine = ++loadSeq;
  latestLoad.set(store, mine);
  const answer = await client.readSession(sessionId, undefined, repoPath);
  /* A later click has started its own read: this answer is for a chat the reader has left, and
     landing it would pull them back (the read of a slow chat A arriving after B was clicked). */
  if (latestLoad.get(store) !== mine) return { outcome: 'ok' };
  if (answer.outcome !== 'ok') {
    /* The chat is gone (deleted elsewhere): drop the copy, and fall through to the empty view. */
    if (repoPath === undefined && answer.status === 404) forgetSnapshot(sessionId);
    /* A chat already on screen from its snapshot stays through a passing failure; it must not blank. */
    else if (repoPath === undefined && getSnapshot(sessionId)?.applied === store.getState().session.turns) {
      return { outcome: 'error', message: answer.message };
    }
    store.dispatch({
      type: 'session/browse',
      activeId: sessionId,
      turns: [],
      browseRepoPath: repoPath ?? null,
    });
    return { outcome: 'error', message: answer.message };
  }

  /* DRAWN FROM A SNAPSHOT ALREADY (switchFromSnapshot)? Then this read only revalidates: nothing
     moves when the server agrees, and the transcript alone is swapped when it does not. */
  const snap = repoPath === undefined ? getSnapshot(sessionId) : undefined;
  const live = store.getState().session;
  if (snap && snap.applied && snap.drawnFromSnapshot && snap.hasBody && live.activeId === sessionId) {
    if (live.turns !== snap.applied) return { outcome: 'ok' }; /* the reader has moved on this chat; theirs wins */
    const sameChat = chatKeyOfWire(answer.body.chat) === snap.chatKey;
    const sameCanvas = canvasKeyOf(answer.body) === snap.canvasKey;
    const sameBoard = boardKeyOf(answer.body) === snap.boardKey;
    /* The server is BEHIND the reader: what they left is longer and starts with what it has (the
       leave-flush has not landed). Theirs is newer; replacing it would show the older disk copy. */
    const serverCount = turnCountOfWire(answer.body.chat);
    const serverBehind = !sameChat && serverCount < snap.turnCount && chatKeyOfTurns(snap.turns, serverCount) === chatKeyOfWire(answer.body.chat);
    if (sameChat || serverBehind) {
      /* Nothing to swap. Keep what is on screen as the applied copy (the store holds its own array). */
      if (sameChat) rememberRead(sessionId, answer.body, live.turns, true);
      if (sameCanvas && sameBoard) return { outcome: 'ok' };
    } else {
      const fresh = fromChatMemory(restoreAgentTranscript(answer.body.chat));
      store.dispatch({ type: 'session/turns-refresh', activeId: sessionId, turns: fresh });
      /* An ignored refresh (a turn started meanwhile) leaves the old turns on screen: do not file
         them under the new server key, or the next return would think they are current. */
      if (store.getState().session.turns === live.turns) return { outcome: 'ok' };
      rememberRead(sessionId, answer.body, store.getState().session.turns, true);
    }
    applyCanvasAndBoard(store, sessionId, answer.body, !sameCanvas, !sameBoard);
    return { outcome: 'ok' };
  }

  const turns = fromChatMemory(restoreAgentTranscript(answer.body.chat));
  store.dispatch({
    type: 'session/browse',
    activeId: sessionId,
    turns,
    browseRepoPath: repoPath ?? null,
  });
  if (repoPath === undefined) rememberRead(sessionId, answer.body, store.getState().session.turns, true);

  applyCanvasAndBoard(store, sessionId, answer.body, true, true);

  return { outcome: 'ok' };
}

/** The canvas doc and the architecture overlay out of a session read (each only when asked: a revalidation sends what changed). */
function applyCanvasAndBoard(store: Store, sessionId: string, body: Pick<GetSessionResponse, 'canvas' | 'boardSeqd'>, canvas: boolean, board: boolean): void {
  /* Canvas from the session read — do not wait on /api/canvas-doc (active root only).
     `forSession` names the thread this read was FOR, so a reader who moved on
     while it was in flight does not have it landed on them (store.ts). */
  if (canvas && body.canvas) {
    const doc = fromCanvasMemory(body.canvas);
    if (doc.blocks.length > 0 || (doc.charts?.length ?? 0) > 0) {
      store.dispatch({ type: 'session/canvas-hydrated', doc, forSession: sessionId });
    }
  }

  /* Architecture overlay: DocProvider will re-fetch with browseRepoPath; also
     apply immediately when boardSeqd is present so soft switches paint without
     a second RTT. */
  if (board && typeof body.boardSeqd === 'string' && body.boardSeqd.trim()) {
    try {
      window.dispatchEvent(
        new CustomEvent('sequence:board-seqd', {
          detail: { sessionId, boardSeqd: body.boardSeqd },
        }),
      );
    } catch {
      /* ignore — non-DOM environments */
    }
  }
}

/**
 * Draw a chat from its snapshot in this tick, or say there is none. The turns, the canvas the
 * reader last saw (else the one the server sent) and the board overlay go out together, so one
 * click is one commit. The read that follows revalidates (softLoadSession).
 */
function switchFromSnapshot(store: Store, sessionId: string): boolean {
  const snap = getSnapshot(sessionId);
  if (!snap || !snap.hasBody) return false;
  store.dispatch({ type: 'session/browse', activeId: sessionId, turns: snap.turns, browseRepoPath: null });
  markApplied(sessionId, store.getState().session.turns);
  if (snap.canvasDoc) store.dispatch({ type: 'session/canvas-hydrated', doc: snap.canvasDoc, forSession: sessionId });
  applyCanvasAndBoard(store, sessionId, { canvas: snap.canvas, boardSeqd: snap.boardSeqd }, !snap.canvasDoc, true);
  return true;
}

/** The chat being left, as the reader sees it now, for the way back. */
function captureLeaving(store: Store, toId: string): void {
  const s = store.getState().session;
  if (!s.activeId || s.activeId === toId || s.browseRepoPath) return;
  /* Mid-turn or mid-load the live turns are moving, so they are not kept; and whatever older copy
     of this chat is held must go too, or coming back would draw it with no loading cue and without
     the question just asked. The read on return then draws it the long way. */
  if (s.inFlight !== null || s.hydrating) {
    forgetSnapshot(s.activeId);
    return;
  }
  rememberLeaving(s.activeId, s.turns, s.canvasDoc);
}

const warming = new Set<string>();
/** The pointer must rest on a row this long before its chat is read (V3SessionsRail's PREFETCH_HOVER_MS): sweeping down the rail reads nothing. */
export const WARM_HOVER_REST_MS = 80;
/** Reads a warm may have in flight; a chat is 0.9 MB at 500 turns, and each is parsed on the main thread. */
export const MAX_WARM_READS = 2;

/**
 * Read a chat into a snapshot before anyone clicks it (the pointer is on its row, or the page is
 * idle): the click then draws it in its own frame. Nothing is drawn here and nothing is dispatched.
 */
export function warmSnapshot(store: Store, sessionId: string, client: SessionsClient = defaultClient): void {
  if (warming.size >= MAX_WARM_READS || warming.has(sessionId) || getSnapshot(sessionId) || store.getState().session.activeId === sessionId) return;
  warming.add(sessionId);
  void client
    .readSession(sessionId)
    .then((answer) => {
      if (answer.outcome !== 'ok' || getSnapshot(sessionId)) return;
      rememberRead(sessionId, answer.body, fromChatMemory(restoreAgentTranscript(answer.body.chat)), false);
    })
    .finally(() => warming.delete(sessionId));
}

/** The few chats most likely to be opened next, read quietly once the page is idle. */
export function warmRecentSnapshots(store: Store, client: SessionsClient = defaultClient, count = 6): void {
  const s = store.getState().session;
  const next = s.sessions.filter((e) => e.id !== s.activeId).slice(0, count);
  const run = () => next.forEach((e, i) => setTimeout(() => warmSnapshot(store, e.id, client), i * 120));
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

/** Flip the rail highlight before the network returns — keep prior transcript
 *  until softLoad replaces it so switches are not a long empty wait. */
function optimisticSwitch(store: Store, sessionId: string): void {
  /* WHERE HE IS NOW, on disk, so the next launch opens here rather than on the
     home screen (owner, 2026-09-21). Best-effort and unawaited — a switch must
     never wait on a convenience. */
  rememberPlace({ sessionId });
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
  captureLeaving(store, sessionId);
  optimisticSwitch(store, sessionId);
  switchFromSnapshot(store, sessionId);
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
  forgetSnapshot(sessionId);
  /* A deleted chat's agent and model pick go with it (memory and the saved copy). */
  agentRuns.patch((s) => forgetChat(s, sessionId));
  try {
    for (const pad of SESSION_PADS) localStorage.removeItem(`${pad}.${sessionId}`);
  } catch {
    /* storage unavailable */
  }
}

/** The open chat's id when it is a chat nobody has spoken in (of the kind asked for), else null. */
export function emptyChatHere(store: Store, mode?: 'work' | 'code'): string | null {
  const s = store.getState().session;
  const id = s.activeId;
  if (!id || s.turns.length > 0 || s.inFlight !== null || s.browseRepoPath) return null;
  const entry = s.sessions.find((e) => e.id === id);
  if (!entry || !isPristineChat(entry)) return null;
  if (mode && (entry.mode ?? 'work') !== mode) return null;
  if (agentRuns.get().runs.some((r) => r.sessionId === id)) return null;
  return id;
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
  /* AN EMPTY CHAT IS NOT MADE TWICE (sessions/emptyChat.ts): in a chat nobody has said anything in, New chat is already
     where the reader is. */
  const here = emptyChatHere(store, mode);
  if (here) {
    try {
      document.querySelector<HTMLElement>('[data-testid="composer-field"]')?.focus();
    } catch {
      /* no document */
    }
    return { outcome: 'ok', sessionId: here };
  }
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
  captureLeaving(store, sessionId);
  optimisticSwitch(store, sessionId);
  /* A chat seen before is drawn now, in this click; the read below revalidates it. */
  const drawn = switchFromSnapshot(store, sessionId);

  /* Activate and read go out together: the read does not depend on the activate's answer, and
     one after the other they were two round trips on the way to the new transcript. */
  let settled = false;
  const loading = softLoadSession(store, sessionId, undefined, client).finally(() => {
    settled = true;
  });
  const answer = await client.activate(sessionId);
  if (answer.outcome !== 'ok') {
    void loading;
    return { outcome: 'error', message: answer.message };
  }
  store.dispatch({
    type: 'session/index',
    sessions: answer.body.index.sessions,
    activeId: answer.body.index.activeId ?? sessionId,
  });
  /* Keep hydrating until softLoad finishes — index alone must not clear it. */
  if (!drawn && !settled) store.dispatch({ type: 'session/hydrating' });
  return loading;
}

/**
 * Read `GET /api/sessions` once and put its index in the store.
 *
 * ── IT RETURNS THE BODY, AND THAT IS THE POINT ────────────────────────────
 *
 * The response carries TWO things: `index`, the active root's threads, and
 * `repos`, every catalogued root's. This function wants the first; the rail
 * wants both. It used to return `{ outcome: 'ok' }` and keep the rest, so the
 * rail asked the same route a second time for the half it had just thrown
 * away — at mount, and again after every rename, pin and delete.
 *
 * Handing the body back is what makes ONE READ serve both, without a cache and
 * without a second copy of the parsing. The caller decides what it needs out
 * of a response that was fetched once.
 */
export async function listAndHydrateSessions(
  store: Store,
  client: SessionsClient = defaultClient,
  signal?: AbortSignal,
): Promise<
  | { outcome: 'ok'; body: GetSessionsResponse }
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
  return { outcome: 'ok', body: answer.body };
}
