import { fireEvent, render } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board, type BoardEdge } from './Board';
import { canvasReduce, type CanvasAction } from './canvasReduce';
import { EMPTY_CANVAS } from '../state/initial';
import type { BoardNode } from './NodeCard';
import { installResizeObserver } from './testResizeObserver';

installResizeObserver();

/* THE COST OF PANNING. One gesture is many frames; the app store must hear about it once, and the board root must not
   take a custom-property write per frame (a custom property on the root invalidates the style of the whole board). */

const NODES: BoardNode[] = [
  {
    id: 'a',
    label: 'a',
    subtitle: null,
    present: { kind: 'service', entry: false },
    schemaKind: 'service',
    provenance: 'traced',
    count: null,
  },
  {
    id: 'b',
    label: 'b',
    subtitle: null,
    present: { kind: 'storage', entry: false },
    schemaKind: 'datastore',
    provenance: 'declared',
    count: null,
  },
];
const EDGES: BoardEdge[] = [{ id: 'e', source: 'a', target: 'b', proof: 'traced' }];
const POSITIONS = { a: { x: 0, y: 0 }, b: { x: 320, y: 0 } };

function mount() {
  const dispatched: CanvasAction[] = [];
  const canvas = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });
  const view = render(
    <Board
      canvas={canvas}
      nodes={NODES}
      edges={EDGES}
      positions={POSITIONS}
      dispatch={(action) => dispatched.push(action)}
      onGround={() => {}}
      onExplain={() => {}}
    />,
  );
  const root = view.container.querySelector('[data-testid="board"]') as HTMLElement;
  const pane = view.container.querySelector('.react-flow__pane') as HTMLElement;
  const viewport = view.container.querySelector('.react-flow__viewport') as HTMLElement;
  return { ...view, dispatched, root, pane, viewport };
}

/** Records every write of a --board-cam-* custom property on `el`. */
function watchCamVars(el: HTMLElement) {
  const writes: string[] = [];
  const set = el.style.setProperty.bind(el.style);
  el.style.setProperty = (name: string, value: string | null, priority?: string) => {
    if (name.startsWith('--board-cam')) writes.push(name);
    set(name, value, priority);
  };
  return writes;
}

/** A trackpad pan: `frames` wheel events, one per animation frame (panOnScroll is the board's pan gesture). */
function scrollPan(pane: HTMLElement, frames: number) {
  for (let i = 0; i < frames; i += 1) fireEvent.wheel(pane, { deltaX: 6, deltaY: 4 });
}

/** The translate the renderer drew, from `translate(Xpx,Ypx) scale(Z)`. */
function drawn(viewport: HTMLElement) {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(viewport.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

describe('panning moves one layer', () => {
  it('a 60-frame pan moves the viewport element and tells the store at most twice', async () => {
    const { pane, viewport, dispatched, root } = mount();
    const writes = watchCamVars(root);
    const before = viewport.style.transform;

    await act(async () => {
      scrollPan(pane, 60);
      await new Promise((r) => setTimeout(r, 400));
    });

    // the app store heard about it once or twice, not sixty times ...
    const views = dispatched.filter((a) => a.type === 'canvas/viewport');
    expect(views.length).toBeGreaterThanOrEqual(1);
    expect(views.length).toBeLessThanOrEqual(2);
    // the camera really moved (the gesture reached the renderer) ...
    expect(viewport.style.transform).not.toBe(before);
    expect(Math.abs(drawn(viewport)!.x)).toBeGreaterThan(100);
    // ... and the board root took no camera custom-property write per frame.
    expect(writes).toEqual([]);
  });

  it('commits the finished camera, so what reads it after the gesture sees where it ended', async () => {
    const { pane, dispatched, viewport } = mount();
    await act(async () => {
      scrollPan(pane, 10);
      await new Promise((r) => setTimeout(r, 400));
    });
    const last = [...dispatched].reverse().find((a) => a.type === 'canvas/viewport') as
      | Extract<CanvasAction, { type: 'canvas/viewport' }>
      | undefined;
    expect(last?.viewport.x).toBeCloseTo(drawn(viewport)!.x, 5);
    expect(last?.viewport.y).toBeCloseTo(drawn(viewport)!.y, 5);
  });

  it('a camera the store hands down (fit, buttons) still moves the viewport element', () => {
    const { rerender, viewport } = mount();
    const moved = canvasReduce(
      canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 }),
      { type: 'canvas/pan', dx: -137, dy: 42 },
    );
    rerender(
      <Board
        canvas={moved}
        nodes={NODES}
        edges={EDGES}
        positions={POSITIONS}
        dispatch={() => {}}
        onGround={() => {}}
        onExplain={() => {}}
      />,
    );
    expect(drawn(viewport)).toEqual({ x: moved.viewport.x, y: moved.viewport.y });
  });

  it('a zoom gesture keeps the rung and the root scale current without a store write per frame', async () => {
    const { pane, dispatched, root, viewport } = mount();
    await act(async () => {
      for (let i = 0; i < 40; i += 1) fireEvent.wheel(pane, { deltaY: -20, ctrlKey: true, clientX: 400, clientY: 300 });
      await new Promise((r) => setTimeout(r, 400));
    });
    const zoom = Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)![1]);
    expect(zoom).toBeGreaterThan(1);
    // the root's scale follows the gesture (the cards' counter-scale reads it) ...
    expect(Number(root.style.getPropertyValue('--board-cam-z'))).toBeCloseTo(zoom, 5);
    // ... and the store is told on a throttle, then at the end: a handful of writes, never forty.
    const views = dispatched.filter((a) => a.type === 'canvas/viewport');
    expect(views.length).toBeGreaterThanOrEqual(1);
    expect(views.length).toBeLessThanOrEqual(4);
  });
});
