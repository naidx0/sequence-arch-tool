import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rememberCanvasForFlush, clearSessionFlush } from '../sessions/sessionPersist';
import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore } from '../state/store';
import { createNewChat, clearSessionPads } from './sessionActions';

/**
 * NEW CHAT OPENED ONTO THE PREVIOUS THREAD'S AI CANVAS.
 *
 * Owner walk 2026-09-17: "when you make a new chat it forks automatically off
 * the old chat … it brings the same exact drawing from previously." The
 * reported shape is one reader, one click, and a fresh thread that shows a
 * block titled "Clean AI Canvas Design" it never made. Three defects added up
 * to it and each has a case here that only it can fail.
 */

const OLD = 'session-old';
const NEW = 'session-new-a1b2';

function fakeClient(order: string[]): SessionsClient {
  return {
    create: vi.fn(async () => {
      order.push('POST /api/sessions');
      return {
        outcome: 'ok' as const,
        body: {
          index: {
            version: 1 as const,
            activeId: NEW,
            sessions: [
              { id: NEW, title: '', createdAt: 'x', updatedAt: 'x' },
              { id: OLD, title: 'Old', createdAt: 'x', updatedAt: 'x' },
            ],
          },
          session: { id: NEW, chat: { version: 1, sessionId: NEW, turns: [] }, meta: {} },
        },
      };
    }),
    readSession: vi.fn(async () => ({
      outcome: 'ok' as const,
      body: { chat: { version: 1, sessionId: NEW, turns: [] }, meta: {}, boardSeqd: '' },
    })),
  } as unknown as SessionsClient;
}

describe('createNewChat does not fork the previous thread', () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    clearSessionFlush();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        order.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('flushes the OLD canvas, to the OLD session by id, BEFORE the new session is created', async () => {
    /* Defect 1: the flush was fire-and-forget and named no session, so its
       PUT was still in flight when POST moved `activeId` — and the old blocks
       landed in the new thread's canvas.json. */
    rememberCanvasForFlush(
      { blocks: [{ id: 'b1', type: 'markdown', payload: '# Clean AI Canvas Design', status: 'landed' }] },
      OLD,
    );
    const store = createStore();
    const client = fakeClient(order);

    const result = await createNewChat(store, client, 'work');

    expect(result.outcome).toBe('ok');
    const flushAt = order.indexOf(`PUT /api/sessions/${OLD}`);
    const createAt = order.indexOf('POST /api/sessions');
    expect(flushAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(flushAt);
    /* And never the anonymous route that resolves "active" server-side. */
    expect(order.some((line) => line.includes('/api/canvas-doc'))).toBe(false);
  });

  it('never renders a state where the NEW id holds the OLD canvas', async () => {
    /* Defect 2: `session/index` flipped `activeId` one dispatch before
       `session/browse` emptied the canvas. In that render the AI Canvas
       re-keyed its SeqDraw pad to the new id while still holding the old
       artifacts, and its append effect wrote them there for good. */
    const store = createStore();
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: OLD, title: 'Old', createdAt: 'x', updatedAt: 'x' }],
      activeId: OLD,
    });
    store.dispatch({
      type: 'session/canvas-hydrated',
      doc: { blocks: [{ id: 'b1', type: 'markdown', payload: '# Clean AI Canvas Design', status: 'landed' }] },
      /* A hydration names the thread it was read FOR; one for a thread the
         reader already left is dropped (`state/canvasIdentity.test.tsx`). */
      forSession: OLD,
    });
    expect(store.getState().session.canvasDoc.blocks.length).toBe(1);

    const seen: { activeId: string | null; blocks: number }[] = [];
    const unsubscribe = store.subscribe(() => {
      const s = store.getState().session;
      seen.push({ activeId: s.activeId, blocks: s.canvasDoc.blocks.length });
    });

    await createNewChat(store, fakeClient(order), 'work');
    unsubscribe();

    expect(seen.length).toBeGreaterThan(0);
    const leaked = seen.filter((snap) => snap.activeId === NEW && snap.blocks > 0);
    expect(leaked).toEqual([]);
    expect(store.getState().session.activeId).toBe(NEW);
    expect(store.getState().session.canvasDoc.blocks).toEqual([]);
  });

  it('leaves the composer empty — a draft belongs to the thread it was typed in', async () => {
    /*
     * Owner: "press new chat, still can't type." A field that opens already
     * holding the previous thread's sentence reads exactly like a field that
     * will not take input — and `session/browse` cleared the transcript, the
     * canvas, the board and the files focus while leaving the draft alone.
     */
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'half a question about the gateway' });
    store.dispatch({
      type: 'composer/mention',
      mention: {
        query: 'gate',
        from: 0,
        to: 5,
        status: 'searching',
        results: [],
        activeIndex: 0,
      },
    });
    expect(store.getState().composer.draft).not.toBe('');
    expect(store.getState().composer.mention).not.toBeNull();

    await createNewChat(store, fakeClient(order), 'work');

    expect(store.getState().composer.draft).toBe('');
    expect(store.getState().composer.mention).toBeNull();
  });

  it('and an ordinary switch between existing threads clears it too', () => {
    /* New Chat is one door to `session/browse`; every rail click is another,
       and a fix that only covered the first would leave the report half
       standing. */
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'typed in thread A' });
    store.dispatch({ type: 'session/browse', activeId: OLD, turns: [], browseRepoPath: null });
    expect(store.getState().composer.draft).toBe('');
  });

  it('forgets any client-side pads a recycled id may have left behind', async () => {
    /* Defect 3: ids recycled every 2 h 46 m and the three localStorage pads
       outlived their threads, so a fresh id could open onto a dead thread's
       drawing. The engine now adds a random tail; the client clears anyway. */
    localStorage.setItem(`sequence.seqdraw.${NEW}`, '{"stale":true}');
    localStorage.setItem(`sequence.whiteboard.${NEW}`, '{"stale":true}');
    localStorage.setItem(`sequence.arch-scratch.${NEW}`, '{"stale":true}');

    await createNewChat(createStore(), fakeClient(order), 'work');

    expect(localStorage.getItem(`sequence.seqdraw.${NEW}`)).toBeNull();
    expect(localStorage.getItem(`sequence.whiteboard.${NEW}`)).toBeNull();
    expect(localStorage.getItem(`sequence.arch-scratch.${NEW}`)).toBeNull();
  });

  it('clearSessionPads is what Delete calls, and it clears exactly that id', () => {
    localStorage.setItem(`sequence.seqdraw.${OLD}`, 'a');
    localStorage.setItem(`sequence.seqdraw.${NEW}`, 'b');
    clearSessionPads(OLD);
    expect(localStorage.getItem(`sequence.seqdraw.${OLD}`)).toBeNull();
    expect(localStorage.getItem(`sequence.seqdraw.${NEW}`)).toBe('b');
  });
});
