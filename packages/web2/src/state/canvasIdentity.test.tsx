/* ══════════════════════════════════════════════════════════════════════════
   CANVAS IDENTITY — the doc belongs to a thread, and says so
   packages/web2/src/state/canvasIdentity.test.tsx

   Owner walk 2026-09-17, on the installed app:

     (a) "whenever I switch from chats, the chart / canvas drawing
          disappeared — I don't want it to disappear unless I tell it to"
     (b) "when I click on another chat, the canvas plotting kind of takes
          priority — the AI Canvas pane takes over — I never told it to"

   TWO SYMPTOMS, ONE RACE. `optimisticSwitch` (v3/sessionActions.ts) flips
   `activeId` to B so the rail highlight does not wait on the network, and
   `softLoadSession` replaces `canvasDoc` only when the read comes back. In
   between there is at least one render where thread A's doc is the doc and B
   is the id — and the persistence effects in `state/connect.tsx` keyed on
   `activeId` alone. So B's canvas.json got A's chart written into it (b), and
   the flush on the NEXT switch carried the wrong doc back over A (a).

   These tests drive the store through that exact order, with a fake disk, and
   assert on the BYTES each thread's file ends up holding — not on a render.
   A test that only looked at what was on screen would have passed against the
   defect, because on screen the chart was there; it was in the wrong file.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SeqChart } from '@sequence/schema';

import { clearSessionFlush, peekSessionFlush } from '../sessions/sessionPersist';
import { createStore, StoreProvider, type Store } from '../state';
import { ConnectedChatColumn } from './connect';
import type { CanvasDoc, CanvasDocBlock } from './types';

const A = 'session-aaaa';
const B = 'session-bbbb';

const BLOCK: CanvasDocBlock = {
  id: 'blk-a1',
  type: 'markdown',
  title: 'A plan',
  payload: '# Thread A only',
  status: 'landed',
};

const CHART: SeqChart = {
  version: 1,
  kind: 'bar',
  title: 'Thread A only',
  items: [{ id: 'i1', label: 'one', value: 1 }],
};

/** The server's canvas.json, per session id — what a PUT actually lands on. */
type Disk = Record<string, { blocks: unknown[]; charts: unknown[] }>;

function fakeServer(disk: Disk, seen: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push(`${method} ${url}`);
    const put = /^\/api\/sessions\/([^/?]+)$/.exec(url);
    if (method === 'PUT' && put) {
      const id = decodeURIComponent(put[1]!);
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        canvas?: { blocks?: unknown[]; charts?: unknown[] };
      };
      if (body.canvas) {
        disk[id] = {
          blocks: body.canvas.blocks ?? [],
          charts: body.canvas.charts ?? [],
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    if (method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    /* Every GET the column makes on mount (/api/sessions, /api/canvas-doc,
       the transcript) answers 404: this test owns the store's session state
       outright, and a boot hydrate landing on top of it would be a second
       author of the thing under test. */
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** The two dispatches `optimisticSwitch` makes, in its order: id THEN nothing
 *  else. This is the window the defect lived in, so the test reproduces it
 *  rather than calling the helper (which would also need a live client). */
function optimisticSwitchTo(store: Store, id: string): void {
  const prev = store.getState().session;
  store.dispatch({ type: 'session/index', sessions: prev.sessions, activeId: id });
  store.dispatch({ type: 'session/hydrating' });
}

function browseInto(store: Store, id: string): void {
  store.dispatch({ type: 'session/browse', activeId: id, turns: [], browseRepoPath: null });
}

function storeOnThreadA(): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [
      { id: A, title: 'Thread A', createdAt: 'x', updatedAt: 'x' },
      { id: B, title: 'Thread B', createdAt: 'x', updatedAt: 'x' },
    ],
    activeId: A,
  });
  browseInto(store, A);
  store.dispatch({
    type: 'session/canvas-hydrated',
    doc: { blocks: [BLOCK], charts: [CHART] } as CanvasDoc,
    forSession: A,
  });
  return store;
}

describe('a canvas doc names the thread it belongs to', () => {
  let disk: Disk;
  let seen: string[];

  beforeEach(() => {
    disk = {};
    seen = [];
    clearSessionFlush();
    vi.stubGlobal('fetch', fakeServer(disk, seen));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSessionFlush();
  });

  it("switching A → B never writes A's canvas into B, and B opens empty", async () => {
    const store = storeOnThreadA();
    expect(store.getState().session.canvasDoc.forSession).toBe(A);

    await act(async () => {
      render(
        <StoreProvider store={store}>
          <ConnectedChatColumn />
        </StoreProvider>,
      );
    });

    /* The premise: A's own file was written, so "B's file is empty" below is
       a statement about the fence and not about a PUT that never fires. */
    expect(disk[A]?.blocks).toHaveLength(1);
    expect(disk[A]?.charts).toHaveLength(1);

    /* THE RACE. `activeId` is B while `canvasDoc` is still A's. */
    await act(async () => {
      optimisticSwitchTo(store, B);
    });
    expect(store.getState().session.canvasDoc.forSession).toBe(A);
    expect(store.getState().session.activeId).toBe(B);
    expect(disk[B]).toBeUndefined();
    /* And the flush snapshot did not quietly take A's doc under B's id — the
       write that used to land on the NEXT switch rather than this one. */
    expect(peekSessionFlush().canvasSessionId).not.toBe(B);

    /* The read comes back and B takes the surface. */
    await act(async () => {
      browseInto(store, B);
    });
    expect(store.getState().session.canvasDoc.blocks).toEqual([]);
    expect(store.getState().session.canvasDoc.forSession).toBe(B);
    expect(disk[B]?.blocks ?? []).toHaveLength(0);
    expect(disk[B]?.charts ?? []).toHaveLength(0);
  });

  it("coming back to A finds A's chart, and A's file still holds it", async () => {
    const store = storeOnThreadA();
    await act(async () => {
      render(
        <StoreProvider store={store}>
          <ConnectedChatColumn />
        </StoreProvider>,
      );
    });
    /* Two acts, so the render where `activeId` is B and the doc is still A's
       actually happens — batching both dispatches into one would skip the
       window the defect lived in and the test would pass against it. */
    await act(async () => {
      optimisticSwitchTo(store, B);
    });
    await act(async () => {
      browseInto(store, B);
    });

    /* Back to A — the same two-step, then the read from disk. */
    await act(async () => {
      optimisticSwitchTo(store, A);
    });
    await act(async () => {
      browseInto(store, A);
      store.dispatch({
        type: 'session/canvas-hydrated',
        doc: {
          blocks: disk[A]!.blocks as CanvasDocBlock[],
          charts: disk[A]!.charts as SeqChart[],
        } as CanvasDoc,
        forSession: A,
      });
    });

    expect(store.getState().session.canvasDoc.blocks).toHaveLength(1);
    expect(store.getState().session.canvasDoc.charts).toHaveLength(1);
    expect(store.getState().session.canvasDoc.forSession).toBe(A);
    /* "Do not let it disappear": the trip through B did not blank A's file. */
    expect(disk[A]?.blocks).toHaveLength(1);
    expect(disk[A]?.charts).toHaveLength(1);
    expect(disk[B]?.blocks ?? []).toHaveLength(0);
  });

  it('drops a hydration for a thread the reader has already left', () => {
    /* Two switches in quick succession leave two reads in flight. The slower
       one is an answer to a question nobody is asking any more, and it used to
       land on whichever thread happened to be showing when it arrived. */
    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [
        { id: A, title: 'Thread A', createdAt: 'x', updatedAt: 'x' },
        { id: B, title: 'Thread B', createdAt: 'x', updatedAt: 'x' },
      ],
      activeId: A,
    });
    browseInto(store, A);
    optimisticSwitchTo(store, B);
    browseInto(store, B);

    store.dispatch({
      type: 'session/canvas-hydrated',
      doc: { blocks: [BLOCK], charts: [CHART] } as CanvasDoc,
      forSession: A,
    });

    expect(store.getState().session.canvasDoc.blocks).toEqual([]);
    expect(store.getState().session.canvasDoc.forSession).toBe(B);

    /* Each exit needs a case that produces only it: the SAME dispatch for the
       thread that IS current is accepted, so the assertion above is the guard
       firing and not `canvas-hydrated` being inert. */
    store.dispatch({
      type: 'session/canvas-hydrated',
      doc: { blocks: [BLOCK], charts: [CHART] } as CanvasDoc,
      forSession: B,
    });
    expect(store.getState().session.canvasDoc.blocks).toHaveLength(1);
  });
});
