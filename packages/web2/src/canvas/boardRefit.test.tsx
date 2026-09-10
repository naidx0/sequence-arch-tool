/* ══════════════════════════════════════════════════════════════════════════
   THE CAMERA FOLLOWS THE ARRANGEMENT — two measured defects, one latch.
   packages/web2/src/canvas/boardRefit.test.tsx

   `Board.tsx` fits the camera ONCE per distinct `attachFitKey` and never again,
   so what that key names is exactly what the camera is allowed to follow. It
   named the repository and its scan time — and the repository is not the only
   thing that moves every card on the board.

   BOTH FAILURES WERE DRIVEN IN THE SHIPPED BUNDLE, on this monorepo:

     · Adding workspace panes took the board pane 448 -> 287 -> 206 -> 158px
       wide. The layout re-packs at each quarter-step of the frame's aspect, so
       the cards moved every time — and the viewport kept the transform it had
       been handed at 448px: `scale(0.989316)` still on `.react-flow__viewport`
       at a 158px pane, a 930px-tall column inside a 719px frame, nothing
       re-fitted, no scrollbar and no note. The board simply clipped.
     · Double-clicking a service replaces the document outright — the systems
       layer's arrangement becomes that service's interior, a different
       coordinate space — and the camera did not move. `grep -n "canvas/fit"
       ConnectedBoard.tsx` returned nothing; the only latch was the attach one,
       and it does not mention the opened service.

   WHY THIS TIER CAN ASSERT IT AT ALL. jsdom measures nothing, so the board's
   own ResizeObserver never reports a frame — but `canvas/frame` is an ACTION,
   and `useCanvas()` hands a test the same channel the pane uses. The frame is
   therefore stated rather than measured, which is honest here: the claim under
   test is "what the board does WHEN the frame changes", not "what the frame is".
   ══════════════════════════════════════════════════════════════════════════ */

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider, useCanvas, type CanvasChannel } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/** Two services, one of them with a five-file interior worth opening — the
 *  interior's arrangement has to be genuinely different from the systems
 *  layer's, or 'the camera moved' and 'the camera did not' look the same. */
const GRAPH = {
  repoName: 'refit',
  scannedAt: '2026-08-28T00:00:00.000Z',
  nodes: [
    { id: 'svc:analyzer', label: 'analyzer', kind: 'service', file: 'packages/analyzer', line: 1 },
    { id: 'svc:schema', label: 'schema', kind: 'service', file: 'packages/schema', line: 1 },
    {
      id: 'file:analyzer/scan.ts',
      label: 'scan.ts',
      kind: 'file',
      parentId: 'svc:analyzer',
      file: 'packages/analyzer/src/scan.ts',
      line: 1,
    },
    ...['server.ts', 'explain.ts', 'cli.ts', 'provider.ts'].map((name) => ({
      id: `file:analyzer/${name}`,
      label: name,
      kind: 'file',
      parentId: 'svc:analyzer',
      file: `packages/analyzer/src/${name}`,
      line: 1,
    })),
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function storeFor(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/refit',
      repoName: 'refit',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt,
    },
    at: 0,
  });
  return store;
}

function mounted(): { canvas: () => CanvasChannel; unmount: () => void } {
  let channel: CanvasChannel | null = null;
  function Probe() {
    channel = useCanvas();
    return null;
  }
  const drawn = render(
    <StoreProvider store={storeFor(GRAPH)}>
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

/** Say what the pane is, then let the layout and the fit that follows settle. */
async function frame(board: { canvas: () => CanvasChannel }, width: number, height: number) {
  await act(async () => {
    board.canvas().dispatch({ type: 'canvas/frame', width, height });
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

const camera = (board: { canvas: () => CanvasChannel }) => ({ ...board.canvas().canvas.viewport });

describe('the board re-fits when the pane it is drawn in changes shape', () => {
  it('moves the camera when the frame is reshaped, instead of clipping', async () => {
    const board = mounted();
    await frame(board, 800, 600);
    const wide = camera(board);
    /* The fit ran at all — otherwise the rest of this test is asserting that
       one identity equals another. */
    expect(wide).not.toEqual({ x: 0, y: 0, zoom: 1 });

    await frame(board, 200, 900);
    expect(camera(board)).not.toEqual(wide);
    board.unmount();
  });

  it('does NOT move the camera for a resize that did not reshape the layout', async () => {
    /* The other half, and the reason the key carries the QUANTISED aspect
       rather than the pixel size: the frame's width changes on every pixel of a
       resizer drag, and a camera that re-fits on each of them moves the board
       under the reader's hand while they are still holding the grip. The layout
       re-packs on quarter-steps; the camera follows on the same cadence and no
       finer. */
    const board = mounted();
    await frame(board, 800, 600);
    const before = camera(board);

    await frame(board, 804, 600);
    expect(camera(board)).toEqual(before);
    board.unmount();
  });
});

describe('the camera goes with the reader into a service', () => {
  it('re-fits when a service interior replaces the systems layer', async () => {
    const board = mounted();
    await frame(board, 800, 600);
    const outside = camera(board);

    /* The gesture the product teaches for "go inside this". The card only
       offers it for a node the scan gave an interior, which `svc:analyzer` has
       and `svc:schema` does not. */
    const open = screen.getAllByTestId('board-node-expand')[0]!;
    await act(async () => {
      open.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    await waitFor(() => expect(screen.queryByTestId('board-interior')).not.toBeNull());
    expect(camera(board)).not.toEqual(outside);
    board.unmount();
  });
});
