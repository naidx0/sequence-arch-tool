/* ══════════════════════════════════════════════════════════════════════════
   FINDINGS F1 AND F3 — A NEW SCAN MUST ARRIVE ON A CLEAN CANVAS.
   packages/web2/src/canvas/repoSwap.test.tsx

   F1: stale annotations survived a rescan or a repo swap because only
   repo/detached reset the canvas slice — `loadRepo` did not — and the
   annotate effect REFUSED to dispatch `{}`, so sentences from scan A sat on
   cards whose ids happened to match in scan B.
   F3: the canvas channel seeds its reducer ONCE, so a selection made in
   repo A walked straight into repo B and the Wave-2 dim effect receded
   everything at boot.

   Both fixes are locked here, against the REAL provider stack in App.tsx's
   order, with `/api/annotate` answered by a table keyed on `scannedAt`.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { annotationsForScan, type Annotations } from './annotateClient.js';
import { CanvasProvider, useCanvas, type CanvasChannel } from './canvasChannel.js';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel.js';
import { seqdFromGraph } from './seqdFromGraph.js';
import { installResizeObserver } from './testResizeObserver.js';
import { summarizeGraph } from '../boot';
import {
  EMPTY_CANVAS,
  StoreProvider,
  createInitialState,
  createStore,
  type Store,
} from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/* The annotate answer table, keyed on the scan the ask belongs to. */
const ANSWERS: Record<string, Annotations> = {};

vi.mock('./annotateClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./annotateClient.js')>();
  return {
    ...actual,
    annotationsForScan: vi.fn(
      async (_fetch: typeof fetch, _signal: AbortSignal | undefined, scannedAt: string) =>
        ANSWERS[scannedAt] ?? {},
    ),
  };
});

const REPO = '/tmp/swap';

function graphWith(scannedAt: string): GetArchGraphResponse {
  return {
    repoName: 'swap',
    scannedAt,
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 12 },
      { id: 'svc:checkout', label: 'checkout', kind: 'service', file: 'src/checkout.ts', line: 41 },
    ],
    edges: [
      {
        id: 'e1',
        srcId: 'svc:gateway',
        dstId: 'svc:checkout',
        kind: 'call',
        confidence: 0.95,
        origin: 'deterministic',
      },
    ],
    nodeDetail: {},
  } as unknown as GetArchGraphResponse;
}

const SCAN_A = graphWith('2026-08-24T00:00:00.000Z');
const SCAN_B = graphWith('2026-08-24T06:00:00.000Z');

const project = (g: GetArchGraphResponse) => seqdFromGraph(g, g.nodeDetail);

function makeStore(hydratedCanvas?: typeof EMPTY_CANVAS): Store {
  const base = createInitialState();
  return createStore({
    project,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
    ...(hydratedCanvas ? { hydrate: { ...base, canvas: hydratedCanvas } } : {}),
  });
}

function load(store: Store, graph: GetArchGraphResponse, at: number): void {
  act(() => {
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: REPO,
        repoName: 'swap',
        graph,
        summary: summarizeGraph(graph),
        scannedAt: graph.scannedAt,
      },
      at,
    });
  });
}

function mounted(store: Store): () => CanvasChannel {
  let channel: CanvasChannel | null = null;
  function Probe() {
    channel = useCanvas();
    return null;
  }
  render(
    /* The provider order is App.tsx's, not a convenient one. */
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return () => channel!;
}

describe('finding F1 — a new scan lands on a clean canvas slice', () => {
  it('(a) scan A’s annotations do not survive loadRepo for scan B, in the STORE', () => {
    const stale = { ...EMPTY_CANVAS, annotations: { 'svc:gateway': ['a sentence from scan A'] } };
    const store = makeStore(stale);
    expect(store.getState().canvas.annotations).toEqual({
      'svc:gateway': ['a sentence from scan A'],
    });

    load(store, SCAN_B, 0);

    expect(store.getState().canvas.annotations).toEqual({});
  });

  it('(b) the reducer receives the {} replace when scan B annotates nothing', async () => {
    ANSWERS[SCAN_B.scannedAt] = {};
    const stale = {
      ...EMPTY_CANVAS,
      annotations: { 'svc:gateway': ['a sentence from an earlier scan'] },
    };
    const store = makeStore(stale);
    const channel = mounted(store);
    expect(channel().canvas.annotations['svc:gateway']).toEqual([
      'a sentence from an earlier scan',
    ]);

    load(store, SCAN_B, 0);

    /* The effect asked for THIS scan and the answer — `{}` — reached the
       reducer wholesale. Asserting the CHANNEL STATE, not pixels: a render
       could hide a slice that never changed. */
    await waitFor(() => {
      expect(vi.mocked(annotationsForScan)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        SCAN_B.scannedAt,
      );
      expect(channel().canvas.annotations).toEqual({});
    });
  });
});

describe('finding F3 — detach with a selection, attach another repo, boot clean', () => {
  it('no DimSpec and no carried selection at scan B’s boot', async () => {
    ANSWERS[SCAN_A.scannedAt] = {};
    ANSWERS[SCAN_B.scannedAt] = {};
    const store = makeStore();
    const channel = mounted(store);

    load(store, SCAN_A, 0);
    await waitFor(() => expect(screen.getAllByTestId('board-node').length).toBeGreaterThan(0));

    /* Select in repo A; the Wave-2 effect answers with a selection dim. */
    act(() => {
      channel().dispatch({ type: 'canvas/select', nodeId: 'svc:gateway', additive: false });
    });
    await waitFor(() => expect(channel().canvas.dim).not.toBeNull());
    expect(channel().canvas.selection.nodeIds).toEqual(['svc:gateway']);

    /* Out of A, into B. The reader never touched B yet: nothing may be lit,
       nothing receded, nothing selected at its boot. */
    act(() => {
      store.dispatch({ type: 'repo/detached' });
    });
    load(store, SCAN_B, 1);
    await waitFor(() => expect(screen.getAllByTestId('board-node').length).toBeGreaterThan(0));

    expect(channel().canvas.dim).toBeNull();
    expect(channel().canvas.selection.nodeIds).toEqual([]);
  });
});
