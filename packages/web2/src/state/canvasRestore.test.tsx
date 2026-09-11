import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedChatColumn, StoreProvider } from './connect';
import { createStore } from './store';

/**
 * THE CANVAS COMES BACK — the restore half, which nothing was checking.
 *
 * `sessionPersist.test.ts` proves the SAVE: a flush PUTs to `/api/canvas-doc`.
 * `canvasMemory.test.ts` and `canvasChartPersist.test.ts` prove the pure round
 * trip, `toCanvasMemory` → `fromCanvasMemory`, in isolation.
 *
 * NOTHING PROVED THE WIRING. The restore lives in an effect in `connect.tsx` —
 * fetch `/api/canvas-doc`, `fromCanvasMemory`, dispatch — and the one test that
 * touches that route (`sessionIndexRestore.test.tsx`) stubs it with
 * `blocks: []` so the effect does not blow up, and asserts nothing about it.
 *
 * AN EMPTY STUB CANNOT FAIL. With no blocks in the payload there is nothing to
 * miss, so the whole restore path could be broken — wrong route, dropped
 * dispatch, `fromCanvasMemory` never called — and that test stays green. It is
 * the shape of vacuity this repository keeps paying for: a suite that reports
 * on a path it never exercises.
 *
 * So this stubs a REAL canvas and asserts the content arrives.
 *
 * ── EACH ASSERTION IS REACHABLE ONLY BY THE CASE THAT NAMES IT ───────────
 *
 * The store is created empty and the fetch is the only source of a block, so a
 * pass cannot come from a fixture that was already there. And the `pending`
 * case below is the fail-first control — it went red first, and corrected what
 * it was asserting rather than the code: the restore does not DROP a pending
 * block, it NORMALISES it to landed, so no block can come back still claiming
 * an agent is writing it.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const body = handler(String(url));
      return {
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body,
      } as unknown as Response;
    }),
  );
  return calls;
}

/** A session whose canvas holds real content, as `canvas.json` would on disk. */
const SAVED_CANVAS = {
  version: 1,
  sessionId: 'session-b',
  blocks: [
    { id: 'b1', type: 'markdown', title: 'Plan', payload: '# Step one\n\nDo the thing.', status: 'landed' },
    { id: 'b2', type: 'mermaid', title: 'flow', payload: 'flowchart TD\n a --> b', status: 'landed' },
  ],
};

function routes(canvas: unknown) {
  return (url: string) =>
    url === '/api/sessions'
      ? {
          /* `{ index: … }`, not the bare index — the first version of this file
             sent the inner object and activeId never hydrated. */
          index: {
            version: 1,
            activeId: 'session-b',
            sessions: [
              {
                id: 'session-b',
                title: 'Second',
                mode: 'code',
                createdAt: '2026-09-09T00:00:00.000Z',
                updatedAt: '2026-09-09T01:00:00.000Z',
              },
            ],
          },
        }
      : url.startsWith('/api/chat-memory')
        ? { version: 1, sessionId: 'session-b', turns: [] }
        : url.startsWith('/api/canvas-doc')
          ? canvas
          : url.startsWith('/api/ai-config')
            ? { model: '', origin: 'unconfigured' }
            : null;
}

function mount(canvas: unknown) {
  const calls = stubFetch(routes(canvas));
  const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
  render(
    <StoreProvider store={store}>
      <ConnectedChatColumn />
    </StoreProvider>,
  );
  return { store, calls };
}

describe('the AI Canvas is restored from disk', () => {
  it('asks for the saved canvas at all', async () => {
    /* The precondition. If the route is never fetched, every assertion below
       would be about a document nobody loaded. */
    const { calls } = mount(SAVED_CANVAS);
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/canvas-doc'))).toBe(true));
  });

  it('PUTS THE SAVED BLOCKS BACK IN THE STORE, with their content intact', async () => {
    const { store } = mount(SAVED_CANVAS);

    await waitFor(() => expect(store.getState().session.canvasDoc.blocks.length).toBe(2));

    const blocks = store.getState().session.canvasDoc.blocks;
    /* Content, not just a count — a restore that produced two empty blocks
       would satisfy a length check and lose the document. */
    expect(blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(blocks[0]!.payload).toContain('Step one');
    expect(blocks[0]!.title).toBe('Plan');
    expect(blocks[1]!.type).toBe('mermaid');
    expect(blocks[1]!.payload).toContain('flowchart TD');
  });

  it('A PENDING BLOCK COMES BACK LANDED, never still drawing', async () => {
    /*
     * THE CONTROL, AND IT CORRECTS WHAT I FIRST ASSERTED. I expected a pending
     * block to be dropped on the way in, because `toCanvasMemory` filters
     * `status: 'pending'` on the way out. It is not dropped — `parseBlock`
     * normalises instead: `o.status === 'live' ? 'live' : 'landed'`, so a disk
     * status is never trusted beyond those two.
     *
     * That is the better design and this now asserts it. The failure worth
     * preventing is a restored block still marked pending: the canvas paints
     * "Agent is drawing…" over a turn that ended long ago, with no agent and
     * nothing that will ever resolve it. Normalising makes that unreachable.
     *
     * It stays the fail-first control. If `parseBlock` ever stopped
     * normalising, a pending status would flow straight through from disk and
     * this assertion is what catches it — and it can only pass by reading the
     * real parse, since the fixture below says `pending` outright.
     */
    const { store } = mount({
      ...SAVED_CANVAS,
      blocks: [
        ...SAVED_CANVAS.blocks,
        { id: 'b3', type: 'markdown', payload: 'half-written', status: 'pending' },
      ],
    });

    await waitFor(() => expect(store.getState().session.canvasDoc.blocks.length).toBe(3));
    const b3 = store.getState().session.canvasDoc.blocks.find((b) => b.id === 'b3');
    expect(b3).toBeTruthy();
    expect(b3!.status).toBe('landed');
    /* No block anywhere may come back mid-write. */
    expect(store.getState().session.canvasDoc.blocks.every((b) => b.status !== 'pending')).toBe(true);
  });

  it('an empty saved canvas restores nothing, and says nothing', async () => {
    /* The other exit, reachable only by its own case — so "two blocks arrived"
       above cannot be passing because the restore ignores its input. */
    const { store } = mount({ version: 1, sessionId: 'session-b', blocks: [] });
    await waitFor(() => expect(store.getState().session.activeId).toBe('session-b'));
    expect(store.getState().session.canvasDoc.blocks).toEqual([]);
  });
});
