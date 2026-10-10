/* ══════════════════════════════════════════════════════════════════════════
   FINDING F8 — ONE SCAN, AT MOST ONE ANNOTATE ASK.
   packages/web2/src/canvas/annotationsOnce.test.tsx

   `ConnectedBoard` mounts per Board↔Whiteboard tab flip, and its effect fired
   POST /api/annotate on every mount while the comment claimed "one ask per
   scan". The ask is now memoised per `scannedAt` at the client, so a remount
   against the same scan cannot refetch.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

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
    repoName: 'once',
    scannedAt,
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 12 },
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
      root: '/tmp/once',
      repoName: 'once',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt,
    },
    at: 0,
  });
  return store;
}

let annotateCalls = 0;
const realFetch = globalThis.fetch;

function stubAnnotate(): void {
  annotateCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/annotate' && (init?.method ?? 'GET') === 'POST') {
      annotateCalls += 1;
      return new Response(
        JSON.stringify({ annotations: { 'svc:gateway': ['one bullet'] }, mode: 'ai' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  clearAnnotationCache();
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

describe('finding F8 — the annotate ask is memoised per scannedAt', () => {
  it('a remount against the SAME scan does not fetch again', async () => {
    stubAnnotate();

    const first = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() =>
      expect(first.canvas().canvas.annotations['svc:gateway']).toEqual(['one bullet']),
    );
    /* The tab flip unmounts the board; the scan on disk has not changed. */
    first.unmount();

    const second = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() =>
      expect(second.canvas().canvas.annotations['svc:gateway']).toEqual(['one bullet']),
    );

    expect(annotateCalls).toBe(1);
  });

  it('a DIFFERENT scan asks again, and so does a cleared cache', async () => {
    stubAnnotate();

    const first = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() => expect(annotateCalls).toBe(1));
    first.unmount();

    const second = mounted(storeFor(graphWith('2026-08-24T09:00:00.000Z')));
    await waitFor(() => expect(annotateCalls).toBe(2));
    second.unmount();

    clearAnnotationCache();
    const third = mounted(storeFor(graphWith('2026-08-24T00:00:00.000Z')));
    await waitFor(() => expect(annotateCalls).toBe(3));
    third.unmount();
  });
});
