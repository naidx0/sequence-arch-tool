/* ══════════════════════════════════════════════════════════════════════════
   REVIEW ROUND 2, FINDING G3 — THE CALL SITE IS THE LOCK.
   cardBox.test.ts pins `annotatedCountForLayout` in isolation; nothing pinned
   the place that actually feeds it into the layout key
   (`ConnectedBoard.tsx`, the `layoutKey` memo). Reverting that one line to a
   raw count of annotated cards passed all 1583 tests — an unlocked fix is one
   revert away from gone. This file renders the REAL ConnectedBoard and asserts
   through observable behaviour — how many times ELK is asked to lay out:

     · below the subtitle rung, an arriving annotation must NOT trigger a
       relayout (the boxes have not changed — finding F6's whole point);
     · at the subtitle rung, it MUST (its card grows one --lh-11 line).
   ══════════════════════════════════════════════════════════════════════════ */

import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

const elkState = vi.hoisted(() => ({ runs: 0 }));

vi.mock('./layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout.js')>();
  return {
    ...actual,
    layoutOffThread: (...args: Parameters<typeof actual.layoutOffThread>) => {
      elkState.runs += 1;
      return actual.layoutOffThread(...args);
    },
  };
});

import { clearAnnotationCache } from './annotateClient.js';
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

function graphWith(scannedAt: string): GetArchGraphResponse {
  return {
    repoName: 'callsite',
    scannedAt,
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 12 },
      { id: 'svc:web', label: 'web', kind: 'service', file: 'src/web.ts', line: 4 },
    ],
    edges: [],
    nodeDetail: {},
  } as unknown as GetArchGraphResponse;
}

function storeFor(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/callsite',
      repoName: 'callsite',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt,
    },
    at: 0,
  });
  return store;
}

let annotateBody: Record<string, string[]> = {};
const realFetch = globalThis.fetch;

function stubAnnotate(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/annotate' && (init?.method ?? 'GET') === 'POST') {
      return new Response(JSON.stringify({ annotations: annotateBody, mode: 'ai' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  clearAnnotationCache();
  annotateBody = {};
});

function mounted(store: Store): { canvas: () => CanvasChannel; unmount: () => void } {
  let channel: CanvasChannel | null = null;
  function Probe() {
    channel = useCanvas();
    return null;
  }
  const drawn = render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return { canvas: () => channel!, unmount: drawn.unmount };
}

/** Let every scheduled layout-key effect fire and settle before counting. */
async function settleLayouts(): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return elkState.runs;
}

describe('finding G3 — the layout key asks the annotated count through the ladder', () => {
  it('an arriving annotation BELOW the subtitle rung spends no relayout', async () => {
    stubAnnotate();
    annotateBody = { 'svc:gateway': ['one bullet'] };

    const board = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() =>
      expect(board.canvas().canvas.annotations['svc:gateway']).toEqual(['one bullet']),
    );
    await settleLayouts();

    /* Zoom out to rung 4 — below the A5.2 subtitle boost (which keeps a real
       glance line through rung 3). The count legitimately changes as the
       ladder drops it; wait out that one relayout. */
    board.canvas().dispatch({
      type: 'canvas/viewport',
      viewport: { x: 0, y: 0, zoom: 0.7 },
    });
    await waitFor(() => expect(board.canvas().canvas.rung).toBe(4));
    await settleLayouts();
    const before = elkState.runs;

    /* A second annotation arrives. Below the boosted subtitle rung no box
       changes, so the layout key must not move and ELK must not be asked again. */
    board.canvas().dispatch({
      type: 'canvas/annotate',
      annotations: {
        'svc:gateway': ['one bullet'],
        'svc:web': ['second bullet'],
      },
    });
    const after = await settleLayouts();

    expect(after).toBe(before);
    board.unmount();
  });

  it('at the SUBTITLE rung an arriving annotation does spend its relayout', async () => {
    stubAnnotate();
    annotateBody = { 'svc:gateway': ['one bullet'] };

    /* Default viewport is zoom 1 — rung 1, the subtitle showing. */
    const board = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() =>
      expect(board.canvas().canvas.annotations['svc:gateway']).toEqual(['one bullet']),
    );
    expect(board.canvas().canvas.rung).toBe(1);
    const before = await settleLayouts();

    board.canvas().dispatch({
      type: 'canvas/annotate',
      annotations: {
        'svc:gateway': ['one bullet'],
        'svc:web': ['second bullet'],
      },
    });

    /* Its card grows a line at this rung — the boxes changed, so the key must
       move and ELK must be asked again. */
    await waitFor(() => expect(elkState.runs).toBe(before + 1));
    board.unmount();
  });
});
