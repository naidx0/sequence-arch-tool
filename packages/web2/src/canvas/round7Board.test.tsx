/* ROUND 7, SECTION C — Jaden's board walkthrough (lab/specs/round7-walkthrough.md).
   Each block names the item and the owner's words it locks. */
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board, type BoardEdge } from './Board';
import { BoardControlsBody } from './BoardControlsBody';
import type { BoardControlsProps } from './BoardControls';
import type { BoardNode } from './NodeCard';
import { EMPTY_CANVAS } from '../state/initial';
import { canvasReduce, type CanvasAction } from './canvasReduce';
import { FOCUS_MIN_ZOOM, CARD_TITLE_PX, fitViewport } from './camera';
import { NODE_DRAG_THRESHOLD, nextInDirection, nudge } from './boardKeys';
import { BOARD_KEYS } from './boardKeysHint';
import {
  BOARD_LAYOUT_STORAGE_KEY,
  MAX_BOARDS,
  boardLayoutKey,
  readBoardLayout,
  writeBoardLayout,
} from './boardLayoutMemory';
import { ROW_LABEL_H, followRowLabel } from './rowLabels';
import { ORPHAN_LABEL_H } from './layout';
import { FIELD_PITCH, MAX_CELLS, rampText, rampWindow } from './AsciiRamp';
import { installResizeObserver } from './testResizeObserver';

installResizeObserver();

const NODES: BoardNode[] = [
  { id: 'svc:a', label: 'alpha', subtitle: null, present: { kind: 'service', entry: false }, schemaKind: 'service', provenance: 'traced', count: null },
  { id: 'svc:b', label: 'beta', subtitle: null, present: { kind: 'service', entry: false }, schemaKind: 'service', provenance: 'traced', count: null },
  { id: 'svc:c', label: 'gamma', subtitle: null, present: { kind: 'service', entry: false }, schemaKind: 'service', provenance: 'traced', count: null },
];
const EDGES: BoardEdge[] = [{ id: 'e1', source: 'svc:a', target: 'svc:b', proof: 'traced' }];
const POSITIONS = { 'svc:a': { x: 0, y: 0 }, 'svc:b': { x: 400, y: 0 }, 'svc:c': { x: 0, y: 300 } };
const FRAMED = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

function mount(over: Partial<Parameters<typeof Board>[0]> = {}) {
  const dispatched: CanvasAction[] = [];
  const view = render(
    <Board
      canvas={FRAMED}
      nodes={NODES}
      edges={EDGES}
      positions={POSITIONS}
      dispatch={(a) => dispatched.push(a)}
      onGround={vi.fn()}
      {...over}
    />,
  );
  const root = view.container.querySelector('[data-testid="board"]') as HTMLElement;
  return { ...view, root, dispatched };
}

const key = (el: Element, k: string, extra: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
  });

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {}
});

/* ── C.1 "so we can just pick up the boxes" ─────────────────────────────── */
describe('C.1 — pick up the boxes', () => {
  it('a press is a click until it moves 4px, then it is a drag', () => {
    expect(NODE_DRAG_THRESHOLD).toBe(4);
    const src = readFileSync(resolve(__dirname, 'Board.tsx'), 'utf8');
    expect(src).toContain('nodeDragThreshold={NODE_DRAG_THRESHOLD}');
  });

  it('replaces every placed position at once (load a saved layout, or reset)', () => {
    let c = canvasReduce(FRAMED, { type: 'canvas/position', nodeId: 'svc:a', x: 5, y: 6 });
    c = canvasReduce(c, { type: 'canvas/positions', positions: { 'svc:b': { x: 1, y: 2 } } });
    expect(c.positions).toEqual({ 'svc:b': { x: 1, y: 2 } });
    expect(canvasReduce(c, { type: 'canvas/positions', positions: {} }).positions).toEqual({});
  });

  it('remembers placed cards per repository and per level of the Map', () => {
    const top = boardLayoutKey('/r/ml-harness', 's1', []);
    const inside = boardLayoutKey('/r/ml-harness', 's1', ['svc:api']);
    const other = boardLayoutKey('/r/shopfront', 's1', []);
    expect(new Set([top, inside, other]).size).toBe(3);
    expect(boardLayoutKey(null, 's1', [])).toContain('scratch:s1');
    writeBoardLayout(top, { 'svc:a': { x: 10, y: 20 } });
    expect(readBoardLayout(top)).toEqual({ 'svc:a': { x: 10, y: 20 } });
    expect(readBoardLayout(inside)).toEqual({});
    expect(readBoardLayout(other)).toEqual({});
    writeBoardLayout(top, {});
    expect(readBoardLayout(top)).toEqual({});
  });

  it('reads a corrupt or foreign record as nothing placed, and stays bounded', () => {
    window.localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, '{nope');
    expect(readBoardLayout('k')).toEqual({});
    window.localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 9, boards: { k: { a: { x: 1, y: 1 } } } }));
    expect(readBoardLayout('k')).toEqual({});
    for (let i = 0; i < MAX_BOARDS + 5; i++) writeBoardLayout(`k${i}`, { a: { x: i, y: 0 } });
    const stored = JSON.parse(window.localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY)!);
    expect(Object.keys(stored.boards)).toHaveLength(MAX_BOARDS);
    expect(readBoardLayout('k0')).toEqual({});
    expect(readBoardLayout(`k${MAX_BOARDS + 4}`)).toEqual({ a: { x: MAX_BOARDS + 4, y: 0 } });
  });

  it('arrow keys on a focused card move it, Shift further, and the move is a position', () => {
    const { container, dispatched } = mount();
    const hit = container.querySelector('[data-node-id="svc:b"] [data-testid="board-node-select"]') as HTMLElement;
    key(hit, 'ArrowRight');
    key(hit, 'ArrowDown', { shiftKey: true });
    const moves = dispatched.filter((a) => a.type === 'canvas/position');
    expect(moves).toEqual([
      { type: 'canvas/position', nodeId: 'svc:b', x: 408, y: 0 },
      { type: 'canvas/position', nodeId: 'svc:b', x: 400, y: 40 },
    ]);
    expect(nudge({ x: 0, y: 0 }, 'ArrowLeft', false)).toEqual({ x: -8, y: 0 });
  });

  it('a nudge starts from where the reader already put the card', () => {
    const placed = { ...FRAMED, positions: { 'svc:b': { x: 500, y: 100 } } };
    const { container, dispatched } = mount({ canvas: placed });
    const hit = container.querySelector('[data-node-id="svc:b"] [data-testid="board-node-select"]') as HTMLElement;
    key(hit, 'ArrowUp');
    expect(dispatched.find((a) => a.type === 'canvas/position')).toEqual({ type: 'canvas/position', nodeId: 'svc:b', x: 500, y: 92 });
  });

  it('More offers Reset layout, disabled until a card was moved', () => {
    const base = {
      query: '', onQuery: () => {}, matches: null, onFitMatches: () => {}, selectedLabel: null,
      pathStart: null, pathEnd: null, pathNote: null, onPathStart: () => {}, onPathEnd: () => {}, onPathClear: () => {},
      focusLabel: null, proximity: 1, onFocusSelected: () => {}, onFocusClear: () => {}, onProximity: () => {},
      direction: 'auto', onDirection: () => {}, flat: false, onFlat: () => {}, onExport: () => {}, exportNote: null,
    } as unknown as BoardControlsProps;
    const onResetLayout = vi.fn();
    const { rerender } = render(<BoardControlsBody {...base} moved={0} onResetLayout={onResetLayout} />);
    expect((screen.getByTestId('board-reset-layout') as HTMLButtonElement).disabled).toBe(true);
    rerender(<BoardControlsBody {...base} moved={2} onResetLayout={onResetLayout} />);
    const reset = screen.getByTestId('board-reset-layout') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(onResetLayout).toHaveBeenCalledTimes(1);
  });
});

/* ── C.3 "I move that, and then not connected label stays" ──────────────── */
describe('C.3 — the Not connected label follows its cards', () => {
  const box = (id: string, x: number, y: number) => ({ id, x, y, w: 160, h: 80 });
  it('agrees with the layout on the label height', () => {
    expect(ROW_LABEL_H).toBe(ORPHAN_LABEL_H);
  });

  it('one card moved (ML harness: src) takes the label with it', () => {
    const laid = new Map([['src', box('src', 0, 524)]]);
    const now = new Map([['src', box('src', 600, 100)]]);
    expect(followRowLabel({ text: 'Not connected', x: 0, y: 500, count: 1, ids: ['src'] }, now, laid)).toEqual({ x: 600, y: 100 - ROW_LABEL_H, count: 1 });
  });

  it('a card dragged out of a row of three leaves it; the label stays with the two', () => {
    const laid = new Map([
      ['a', box('a', 0, 524)],
      ['b', box('b', 200, 524)],
      ['c', box('c', 400, 524)],
    ]);
    const now = new Map([...laid, ['a', box('a', 900, 0)]]);
    expect(followRowLabel({ text: 'Not connected', x: 0, y: 500, count: 3, ids: ['a', 'b', 'c'] }, now, laid)).toEqual({ x: 200, y: 500, count: 2 });
  });

  it('on the board: dragging the row card moves the painted label', () => {
    const row = [{ text: 'Not connected', x: 0, y: 300 - ROW_LABEL_H, count: 1, ids: ['svc:c'] }];
    const before = mount({ rowLabels: row });
    const at0 = (before.getByTestId('board-row-label') as HTMLElement).style.transform;
    expect(at0).toContain(`translate(0px, ${300 - ROW_LABEL_H + 20}px)`);
    before.unmount();
    const moved = { ...FRAMED, positions: { 'svc:c': { x: 640, y: 40 } } };
    const after = mount({ canvas: moved, rowLabels: row });
    expect((after.getByTestId('board-row-label') as HTMLElement).style.transform).toContain(`translate(640px, ${40 - ROW_LABEL_H + 20}px)`);
    expect(after.getByTestId('board-row-label').textContent).toContain('1');
  });
});

/* ── C.4 "shouldn't zoom out that hard when you expand" ─────────────────── */
describe('C.4 — opening a node frames it readably', () => {
  it('a focus fit never goes below a 12px painted title', () => {
    expect(FOCUS_MIN_ZOOM * CARD_TITLE_PX).toBeGreaterThanOrEqual(12.2);
    const huge = { x: 0, y: 0, width: 6000, height: 4000 };
    const plain = fitViewport(huge, { width: 800, height: 600 })!;
    const focus = fitViewport(huge, { width: 800, height: 600 }, null, null, FOCUS_MIN_ZOOM)!;
    expect(plain.zoom).toBeLessThan(FOCUS_MIN_ZOOM);
    expect(focus.zoom).toBeCloseTo(FOCUS_MIN_ZOOM, 6);
    /* Small content is still centred, at most 100%. */
    const small = fitViewport({ x: 0, y: 0, width: 200, height: 100 }, { width: 800, height: 600 }, null, null, FOCUS_MIN_ZOOM)!;
    expect(small.zoom).toBe(1);
    expect(small.x).toBe(300);
  });

  it('when the expanded arrangement lands, the board frames THAT node, eased, not the whole board', () => {
    const dispatched: CanvasAction[] = [];
    let canvas = FRAMED;
    let key2 = 'repo|a';
    let focusRequest: { id: string | null; seq: number } | null = null;
    const props = () => ({
      canvas,
      nodes: NODES,
      edges: EDGES,
      positions: POSITIONS,
      dispatch: (a: CanvasAction) => dispatched.push(a),
      onGround: vi.fn(),
      attachFitKey: key2,
      focusRequest,
    });
    const view = render(<Board {...props()} />);
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'laying-out' });
    act(() => view.rerender(<Board {...props()} />));
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'idle' });
    act(() => view.rerender(<Board {...props()} />));
    const first = dispatched.filter((a) => a.type === 'canvas/fit') as Array<Extract<CanvasAction, { type: 'canvas/fit' }>>;
    expect(first.at(-1)!.minZoom).toBeUndefined();

    /* The reader expands svc:c: a request, then a new arrangement. */
    dispatched.length = 0;
    focusRequest = { id: 'svc:c', seq: 1 };
    key2 = 'repo|b';
    act(() => view.rerender(<Board {...props()} />));
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'laying-out' });
    act(() => view.rerender(<Board {...props()} />));
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'idle' });
    act(() => view.rerender(<Board {...props()} />));
    const fits = dispatched.filter((a) => a.type === 'canvas/fit') as Array<Extract<CanvasAction, { type: 'canvas/fit' }>>;
    expect(fits.length).toBeGreaterThanOrEqual(1);
    for (const fit of fits) {
      expect(fit.minZoom).toBe(FOCUS_MIN_ZOOM);
      expect(fit.bounds!.x).toBe(0);
      expect(fit.bounds!.y).toBe(300);
    }
    expect(view.container.querySelector('[data-testid="board"]')!.getAttribute('data-cam-animating')).toBe('true');
  });

  it('the eased camera is at most 250ms and stands still under reduced motion', () => {
    const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.board-scope\.board\[data-cam-animating\],\s*\.board-scope\.board\[data-cam-animating\] \.react-flow__viewport\s*\{\s*transition: none;/);
    const tokens = readFileSync(resolve(__dirname, '../tokens/graphite.css'), 'utf8');
    const ms = Number(tokens.match(/--seq-dur-cam:\s*(\d+)ms/)![1]);
    expect(ms).toBeLessThanOrEqual(250);
  });
});

/* ── C.5 "more keyboard native, hold space, move around even in draw" ──── */
describe('C.5 — keyboard-native board', () => {
  it('arrows walk the selection to the nearest card that way', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 300, y: 10, w: 100, h: 50 },
      { id: 'c', x: 0, y: 300, w: 100, h: 50 },
      { id: 'd', x: 200, y: 400, w: 100, h: 50 },
    ];
    expect(nextInDirection(boxes, null, 'ArrowRight')).toBe('a');
    expect(nextInDirection(boxes, 'a', 'ArrowRight')).toBe('b');
    expect(nextInDirection(boxes, 'a', 'ArrowDown')).toBe('c');
    expect(nextInDirection(boxes, 'a', 'ArrowLeft')).toBeNull();
    const selected = { ...FRAMED, selection: { nodeIds: ['svc:a'], edgeIds: [], anchor: 'svc:a' } };
    const { root, dispatched } = mount({ canvas: selected });
    key(root, 'ArrowRight');
    expect(dispatched).toContainEqual({ type: 'canvas/select', nodeId: 'svc:b', additive: false });
    expect(dispatched.some((a) => a.type === 'canvas/position')).toBe(false);
  });

  it('Esc steps back one level per press: draw, then the selection, then the host', () => {
    const onBack = vi.fn(() => true);
    const onToggleDrawing = vi.fn();
    const selected = { ...FRAMED, selection: { nodeIds: ['svc:a'], edgeIds: [], anchor: 'svc:a' } };
    const drawingView = mount({ canvas: selected, drawing: true, onToggleDrawing, onStroke: () => {}, onBack });
    key(drawingView.root, 'Escape');
    expect(onToggleDrawing).toHaveBeenCalledTimes(1);
    expect(drawingView.dispatched).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
    drawingView.unmount();

    const sel = mount({ canvas: selected, onBack });
    key(sel.root, 'Escape');
    expect(sel.dispatched.map((a) => a.type)).toEqual(['canvas/clear']);
    expect(onBack).not.toHaveBeenCalled();
    sel.unmount();

    const bare = mount({ onBack });
    key(bare.root, 'Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(bare.dispatched).toEqual([]);
  });

  it('holding Space pans, even in Draw: the capture layer lets go until it is released', () => {
    const { root } = mount({ drawing: true, onToggleDrawing: () => {}, onStroke: () => {} });
    const layer = () => screen.getByTestId('board-stroke-layer');
    expect(layer().getAttribute('data-passive')).toBeNull();
    key(root, ' ', { code: 'Space' });
    expect(root.getAttribute('data-space-pan')).toBe('true');
    expect(layer().getAttribute('data-passive')).toBe('true');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
    });
    expect(root.getAttribute('data-space-pan')).toBeNull();
    expect(layer().getAttribute('data-passive')).toBeNull();
    const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
    expect(css).toContain('.board-scope .strokelayer.is-passive { pointer-events: none; cursor: grab; }');
  });

  it('Space typed into a field is the field’s', () => {
    const { root, container } = mount();
    const input = document.createElement('input');
    container.appendChild(input);
    key(input, ' ', { code: 'Space' });
    expect(root.getAttribute('data-space-pan')).toBeNull();
  });

  it('the More menu prints the keys the handler binds', () => {
    const text = BOARD_KEYS.map((k) => `${k.keys} ${k.does}`).join(' | ');
    for (const word of ['Space', 'Arrows', 'Esc', '0', '1', '+']) expect(text).toContain(word);
    const body = readFileSync(resolve(__dirname, 'BoardControlsBody.tsx'), 'utf8');
    expect(body).toContain('BOARD_KEYS.map');
    expect(body).toContain('data-testid="board-keys-hint"');
  });
});

/* ── C.2 "The ASCII on the background also needs to be fixed up" ───────── */
describe('C.2 — the ASCII ramp sits on the field grid', () => {
  it('one glyph per field cell, the window snapped to whole cells', () => {
    const win = rampWindow({ x: 0, y: 0, zoom: 1 }, { width: 790, height: 814 })!;
    expect(FIELD_PITCH).toBe(20);
    expect(win.c0).toBe(0);
    expect(win.cols).toBe(Math.ceil(790 / 20));
    expect(win.r0 * FIELD_PITCH).toBeGreaterThanOrEqual(814 / 2 - FIELD_PITCH);
    const lines = rampText(win).split('\n');
    expect(lines).toHaveLength(win.rows);
    for (const line of lines) expect(line).toHaveLength(win.cols);
    /* Sparse at the top of the ramp, dense at the bottom edge. */
    const ink = (l: string) => l.replace(/[ ·]/g, '').length;
    /* An empty cell is the field's dot, so no glyph ever doubles a dot. */
    expect(rampText(win)).not.toContain(' ');
    expect(ink(lines[0]!)).toBeLessThan(ink(lines.at(-1)!));
    /* The same every time: no seed, no clock. */
    expect(rampText(win)).toBe(rampText({ ...win }));
  });

  it('follows the camera in whole cells and stops past a size cap', () => {
    const panned = rampWindow({ x: -35, y: 0, zoom: 1 }, { width: 400, height: 400 })!;
    expect(panned.c0).toBe(1);
    expect(rampWindow({ x: 0, y: 0, zoom: 0.25 }, { width: 4000, height: 3000 })).toBeNull();
    expect(MAX_CELLS).toBeLessThanOrEqual(12000);
  });

  it('is laid in the field’s ink at the field’s pitch, static', () => {
    const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
    const block = css.match(/\.board-scope \.board-ascii \{[\s\S]*?\}/)![0];
    expect(block).toContain('letter-spacing: calc(var(--board-field-pitch) - 1ch)');
    expect(block).toContain('line-height: var(--board-field-pitch)');
    expect(block).toContain('padding-left: calc((var(--board-field-pitch) - 1ch) / 2)');
    expect(block).toContain('color: var(--board-field-ink)');
    expect(block).not.toMatch(/animation|transition/);
  });

  it('is no longer drawn on the board: the ground is the plain dot field (round 10)', async () => {
    const empty = mount({ nodes: [], edges: [], positions: {}, empty: { icon: 'flow', what: 'Nothing', why: 'Because' } });
    await empty.findByTestId('board-dock');
    expect(empty.queryByTestId('board-ascii')).toBeNull();
  });
});

/* ── C.6 "Icons aren't really centered" / "isn't really transparent enough" ─ */
describe('C.6 — Diff in B\'s language, Grid on glass that fills the pane', () => {
  const views = readFileSync(resolve(__dirname, 'views/views.css'), 'utf8');
  const board = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
  const rule = (css: string, sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at) + 1);
  };

  it('the status glyph is centred in a round chip by grid, not by the font', () => {
    const chip = rule(views, '.board-view .dv-ic');
    expect(chip).toContain('display: inline-grid');
    expect(chip).toContain('place-items: center');
    expect(chip).toContain('border-radius: var(--r-full)');
    expect(chip).toMatch(/width: 20px;[\s\S]*height: 20px;/);
  });

  it('the Diff panel is a glass card, its rows glass, and the compare control is B\'s segmented pill', () => {
    const card = rule(views, '.board-view.diffview');
    expect(card).toContain('background: var(--glass-pane)');
    expect(card).toContain('border-radius: var(--r-18)');
    expect(card).not.toContain('backdrop-filter');
    expect(rule(views, '.board-view .hv-row')).toContain('background: var(--glass-ctl)');
    const src = readFileSync(resolve(__dirname, 'views/DiffView.tsx'), 'utf8');
    expect(src).toContain('className="dv-against bseg"');
    expect(src).toContain("className={`bseg-b${against === 'base' ? ' on' : ''}`}");
  });

  it('opening Diff no longer shrinks the toolbar\'s container (the Map is inset, not the stack)', () => {
    const stack = rule(board, ".board-scope.board-stack[data-view='diff']");
    expect(stack).not.toContain('padding-left');
    expect(rule(board, ".board-scope.board-stack[data-view='diff'] > .board-scope.board")).toContain('margin-left: var(--dv-w)');
  });

  it('the Grid sits on glass over the field and its cells grow to 56px', async () => {
    const grid = rule(views, '.board-view.gridview');
    expect(grid).toContain('background: var(--glass-pane)');
    expect(board).toContain(".board-scope.board-stack[data-view='grid'] .react-flow__viewport,");
    const gridRules = views.slice(views.indexOf('/* ── grid'), views.indexOf('/* ── flow'));
    expect(gridRules).not.toContain('background: var(--surface-1)');
    const { GRID_CELL_MAX, gridCellSize } = await import('./views/GridView');
    expect(GRID_CELL_MAX).toBe(56);
    /* ML harness: five boxes in a 760px pane were 32px cells; now they fill. */
    expect(gridCellSize(760 - 40, 814 - 64 - 54, 5)).toBe(56);
  });
});

