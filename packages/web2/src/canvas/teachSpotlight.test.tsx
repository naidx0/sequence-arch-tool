/* ══════════════════════════════════════════════════════════════════════════
   A LESSON LIGHTS THE BOARD — the client half of teach:step, mounted.
   packages/web2/src/canvas/teachSpotlight.test.tsx

   THE FIRST ATTEMPT WAS REVERTED (604fa893) AND THIS IS WHY THIS FILE EXISTS.
   It shipped with unit tests over the reducer and the event, and nobody ever
   mounted the board with a step in state. Two things were wrong and both were
   invisible from the slice:

     1. The lit ids went to `canvas/dim` RAW. They are grounded — the server
        checks each against the scanned graph — but the graph carries file and
        module nodes and the board paints services, datastores and topics. A
        step citing a file receded every card and lit none.
     2. `ConnectedBoard`'s selection effect dispatched `selectionDim([])`,
        which is null, on mount — clearing a dim it did not author, on exactly
        the navigation the lesson's own work row performs.

   So these tests MOUNT `ConnectedBoard` over a real store and read the canvas
   slice back, which is the smallest thing that would have caught either.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider, useCanvas, type CanvasChannel } from './canvasChannel.js';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel.js';
import { seqdFromGraph } from './seqdFromGraph.js';
import { installResizeObserver } from './testResizeObserver.js';
import { summarizeGraph } from '../boot';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Two drawn services. `file:` nodes are deliberately absent from the board. */
function graph(): GetArchGraphResponse {
  return {
    repoName: 'lesson',
    scannedAt: '2026-09-02T00:00:00.000Z',
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 1 },
      { id: 'svc:orders', label: 'orders', kind: 'service', file: 'src/orders.ts', line: 1 },
    ],
    edges: [],
    nodeDetail: {},
  } as unknown as GetArchGraphResponse;
}

function storeWithStep(step: { caption: string; litNodeIds?: string[] }): Store {
  const g = graph();
  const store = createStore({
    project: (x) => seqdFromGraph(x, x.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/lesson',
      repoName: 'lesson',
      graph: g,
      summary: summarizeGraph(g),
      scannedAt: g.scannedAt,
    },
    at: 0,
  });
  store.dispatch({ type: 'composer/draft', text: 'teach me' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({
    type: 'turn/event',
    event: { type: 'trajectory:start', runId: 'r1', instructionHash: 't' },
    at: 2,
  });
  store.dispatch({ type: 'turn/event', event: { type: 'teach:step', ...step }, at: 3 });
  return store;
}

function mount(store: Store): { canvas: () => CanvasChannel } {
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
  let channel: CanvasChannel | null = null;
  function Probe() {
    channel = useCanvas();
    return null;
  }
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return { canvas: () => channel! };
}

describe('a teach step lights the board it is actually looking at', () => {
  it('lights the drawn nodes, and survives the mount that used to clear it', async () => {
    const { canvas } = mount(
      storeWithStep({ caption: 'The gateway is the door in.', litNodeIds: ['svc:gateway'] }),
    );
    await waitFor(() => {
      const dim = canvas().canvas.dim;
      expect(dim, 'the board is dimmed around the lesson').not.toBeNull();
      expect(dim!.reason).toBe('teach');
      expect(dim!.litNodeIds).toEqual(['svc:gateway']);
    });
  });

  it('keeps only the ids this board draws, dropping the grounded ones it does not', async () => {
    const { canvas } = mount(
      storeWithStep({
        caption: 'Counting lives in one file.',
        litNodeIds: ['svc:orders', 'file:src/counts.ts', 'mod:core'],
      }),
    );
    await waitFor(() => expect(canvas().canvas.dim).not.toBeNull());
    expect(canvas().canvas.dim!.litNodeIds).toEqual(['svc:orders']);
  });

  it('leaves the board ALONE when the step names nothing this board draws', async () => {
    /* The reverted shape. A lesson about a file is still a lesson — its caption
       and its chart carry it — and receding every card to light none points the
       learner at nowhere. */
    const { canvas } = mount(
      storeWithStep({ caption: 'A lesson about one file.', litNodeIds: ['file:src/counts.ts'] }),
    );
    await waitFor(() => expect(canvas().canvas.frame.width).toBeGreaterThanOrEqual(0));
    expect(canvas().canvas.dim, 'nothing drawn ⇒ nothing dimmed').toBeNull();
  });

  it('a step that lights nothing at all dims nothing', async () => {
    // chart.ts: "A chart with no nodeIds is legal (a lesson about softmax has none)."
    const { canvas } = mount(storeWithStep({ caption: 'Softmax turns scores into odds.' }));
    await waitFor(() => expect(canvas().canvas.frame.width).toBeGreaterThanOrEqual(0));
    expect(canvas().canvas.dim).toBeNull();
  });
});
