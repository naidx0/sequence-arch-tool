import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { GROUP_IDLE_MS } from '@sequence/ink/shape';
import { mouseStroke, outlines } from '../../../ink/src/mouseSim';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider, useDoc } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import { SNAP_MODE_KEY } from '../whiteboard/snapPreference';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   SKETCH READS WITH THE TRAINED, GROUPED SHAPE MODEL
   A box drawn in four strokes used to be four scribbles, because the board
   asked the old hand-rule recognizer about one stroke at a time. The strokes
   here are a MOUSE's (`mouseStroke`), on a 60 Hz clock, with the pen resting
   between them; only the rests are faked.
   ══════════════════════════════════════════════════════════════════════════ */

const GRAPH = {
  repoName: 'sketch',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', path: 'src/g.ts', line: 1 },
    { id: 'svc:orders', label: 'orders', kind: 'service', path: 'src/o.ts', line: 1 },
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

type DocChannel = ReturnType<typeof useDoc>;
let channel: DocChannel | null = null;
function Probe() {
  channel = useDoc();
  return null;
}

function mount() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/sketch',
      repoName: 'sketch',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
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
  fireEvent.click(screen.getByTestId('board-draw-toggle'));
  return screen.getByTestId('board-stroke-layer');
}

let clock = 5000;

/** One mouse stroke on a clock; `restMs` of rest after it. */
function stroke(layer: Element, outline: { x: number; y: number }[], seed: number, restMs = 200) {
  const pts = mouseStroke(outline, { pxPerSample: 8, jitter: 0.6, seed }, 0);
  const fire = (type: string, p: { x: number; y: number }, t: number) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y });
    Object.defineProperty(ev, 'timeStamp', { value: clock + t });
    fireEvent(layer, ev);
  };
  fire('pointerdown', pts[0]!, pts[0]!.t);
  for (const p of pts.slice(1)) fire('pointermove', p, p.t);
  const last = pts[pts.length - 1]!;
  fire('pointerup', last, last.t);
  clock += last.t + restMs;
}

async function rest(ms = GROUP_IDLE_MS + 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const titles = () => screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');

beforeEach(async () => {
  window.localStorage.clear();
  /* The lazy modules load once, for real; only the rests are faked. */
  await import('../whiteboard/snapSession');
  await import('@sequence/ink/shape-model');
  await import('./inkToEdit.js');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe('Sketch on the architecture board', () => {
  it('a four-stroke box becomes one node', async () => {
    const layer = mount();
    const before = titles().length;
    const o = outlines.rect(100, 100, 240, 150);
    for (let i = 0; i < 4; i += 1) stroke(layer, [o[i]!, o[i + 1]!], 10 + i);
    /* Still resting: nothing yet, and above all no node for a SIDE. */
    await rest(300);
    expect(titles().filter((t) => t === 'New service')).toHaveLength(0);
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Reading the drawing/);
    await rest();
    expect(titles().filter((t) => t === 'New service')).toHaveLength(1);
    expect(titles()).toHaveLength(before + 1);
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Added a service/);
  });

  it.each([
    ['an arrow', outlines.arrow(150, 300, 650, 300)],
    ['a bare line', outlines.line(150, 300, 650, 300)],
  ])('a line between two cards becomes an edge (%s)', async (_name, outline) => {
    const layer = mount();
    const ids = ['svc:gateway', 'svc:orders'];
    /* jsdom has no layout: say which card is under which side of the screen. */
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = (x: number) => ({
      closest: () => ({ getAttribute: () => (x < 400 ? ids[0] : ids[1]) }),
    });
    stroke(layer, outline, 3);
    await rest();
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Connected them/);
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('a drawn edge never reuses the id of one already in the document (the counter restarts with the page)', async () => {
    const layer = mount();
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = (x: number) => ({
      closest: () => ({ getAttribute: () => (x < 400 ? 'svc:gateway' : 'svc:orders') }),
    });
    /* A drawn edge restored from the session, as after a reload. */
    act(() => {
      channel!.dispatch({ type: 'doc/add-edge', id: 'draw:e1', from: 'svc:orders', to: 'svc:gateway', family: 'call' });
    });
    stroke(layer, outlines.arrow(150, 300, 650, 300), 3);
    await rest();
    const ids = channel!.session.doc!.edges.map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('a bare line drawn right after a box still connects: the box offer must not cancel the line', async () => {
    const layer = mount();
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = (x: number) => ({
      closest: () => ({ getAttribute: () => (x < 400 ? 'svc:gateway' : 'svc:orders') }),
    });
    const o = outlines.rect(100, 100, 240, 150);
    for (let i = 0; i < 4; i += 1) stroke(layer, [o[i]!, o[i + 1]!], 10 + i);
    stroke(layer, outlines.line(150, 500, 650, 500), 3);
    await rest();
    expect(titles().filter((t) => t === 'New service')).toHaveLength(1);
    expect(channel!.session.doc!.edges).toHaveLength(1);
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Connected them/);
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });

  describe('a slow model load (CPU load): the give-up waits for the model', () => {
    /* The model "arrives" LOAD_MS after the first stroke, past the old 1050 ms give-up. */
    const LOAD_MS = 1500;
    async function slowLoad() {
      const { SnapSession } = await import('../whiteboard/snapSession');
      const proto = SnapSession.prototype as unknown as { load: () => Promise<unknown> };
      const orig = proto.load;
      let gate: Promise<void> | null = null;
      vi.spyOn(proto, 'load').mockImplementation(function (this: unknown) {
        gate ??= new Promise<void>((res) => setTimeout(res, LOAD_MS));
        return gate.then(() => orig.call(this));
      });
    }

    it('a 4-stroke box is still one service, never "not a box"', async () => {
      await slowLoad();
      const layer = mount();
      const before = titles().length;
      const o = outlines.rect(100, 100, 240, 150);
      for (let i = 0; i < 4; i += 1) stroke(layer, [o[i]!, o[i + 1]!], 10 + i);
      await rest(1300);
      /* The old rules must not have run on the box's sides while the model loads. */
      expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Reading the drawing/);
      await rest(3000);
      expect(titles().filter((t) => t === 'New service')).toHaveLength(1);
      expect(titles()).toHaveLength(before + 1);
      expect(screen.getByTestId('board-ink-note').textContent).not.toMatch(/not a box/);
    });

    it('a bare line between two cards still connects once the model is ready', async () => {
      await slowLoad();
      const layer = mount();
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = (x: number) => ({
        closest: () => ({ getAttribute: () => (x < 400 ? 'svc:gateway' : 'svc:orders') }),
      });
      stroke(layer, outlines.line(150, 300, 650, 300), 3);
      await rest(1300);
      expect(channel!.session.doc!.edges).toHaveLength(0);
      await rest(3000);
      expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Connected them/);
      expect(channel!.session.doc!.edges).toHaveLength(1);
      delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    });
  });

  it('shape reading switched off while the pen is resting adds nothing', async () => {
    const layer = mount();
    const before = titles().length;
    const o = outlines.rect(100, 100, 240, 150);
    for (let i = 0; i < 4; i += 1) stroke(layer, [o[i]!, o[i + 1]!], 10 + i);
    window.localStorage.setItem(SNAP_MODE_KEY, 'off');
    await rest();
    expect(titles()).toHaveLength(before);
  });

  it('the inlined idle window equals the shape package idle window', () => {
    expect(GROUP_IDLE_MS).toBe(900);
  });

  it('handwriting stays ink: strokes like letters add nothing', async () => {
    const layer = mount();
    const before = titles().length;
    for (let i = 0; i < 6; i += 1) {
      const x = 150 + i * 18;
      stroke(
        layer,
        i % 2 === 0
          ? [{ x, y: 170 }, { x: x + 9, y: 170 }, { x: x + 9, y: 190 }, { x, y: 190 }, { x, y: 171 }]
          : [{ x, y: 168 }, { x: x + 2, y: 192 }],
        20 + i,
        120,
      );
    }
    await rest();
    expect(titles()).toHaveLength(before);
    expect(titles()).not.toContain('New service');
  });

  it('switched off in Settings, Sketch adds nothing and says why', async () => {
    window.localStorage.setItem(SNAP_MODE_KEY, 'off');
    const layer = mount();
    const before = titles().length;
    stroke(layer, outlines.rect(100, 100, 240, 150), 9);
    await rest();
    expect(titles()).toHaveLength(before);
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/off in Settings/i);
  });
});
