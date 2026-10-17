import { describe, expect, it } from 'vitest';

import type { WbItem } from '../../whiteboard/whiteboardModel';
import { arrowEnds, diffOps, nextBoardName,
  boardLabel, placeItem, resolveItems, type Box } from './boardsModel';

/* Round 8: the geometry that makes an annotation follow the real system. */

const note: WbItem = { kind: 'text', sticky: true, id: 'n', at: { x: 184, y: 0 }, text: 'why', anchor: 'svc:payments', by: 'agent' };

describe('an anchored mark', () => {
  it('sits at its offset from the node, and follows the node when it moves', () => {
    let box: Box = { x: 100, y: 50, w: 160, h: 64 };
    const at = () => {
      const p = placeItem(note, (id) => (id === 'svc:payments' ? box : null));
      return p && p.kind === 'text' ? p.at : null;
    };
    expect(at()).toEqual({ x: 284, y: 50 });
    box = { ...box, x: 400, y: 300 };
    expect(at()).toEqual({ x: 584, y: 300 });
  });

  it('is not drawn (and is counted) when its node is not on the board', () => {
    const r = resolveItems([note, { kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'free' }], () => null);
    expect(r.items.map((i) => i.id)).toEqual(['t']);
    expect(r.hidden).toBe(1);
  });
});

describe('a bound arrow', () => {
  it('leaves and meets the edges of its targets, and follows them', () => {
    const arrow: WbItem = { kind: 'shape', id: 'a', shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, fromId: 'left', toId: 'right' };
    let right: Box = { x: 300, y: 0, w: 100, h: 40 };
    const find = (id: string) => (id === 'left' ? { x: 0, y: 0, w: 100, h: 40 } : id === 'right' ? right : null);
    const ends = arrowEnds(arrow as Extract<WbItem, { kind: 'shape' }>, find);
    expect(ends.from).toEqual({ x: 104, y: 20 });
    expect(ends.to).toEqual({ x: 294, y: 20 });
    right = { x: 300, y: 300, w: 100, h: 40 };
    const moved = arrowEnds(arrow as Extract<WbItem, { kind: 'shape' }>, find);
    expect(moved.to.y).toBeGreaterThan(250);
  });

  it('binds to a mark on the board before a node of the same id, and keeps its point when a target is gone', () => {
    const items: WbItem[] = [
      { kind: 'shape', id: 'box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
      { kind: 'shape', id: 'a', shape: 'arrow', from: { x: 500, y: 500 }, to: { x: 600, y: 600 }, fromId: 'box', toId: 'ghost' },
    ];
    const r = resolveItems(items, () => null);
    const a = r.items.find((i) => i.id === 'a')!;
    expect(a.kind === 'shape' && a.to).toEqual({ x: 600, y: 600 });
    expect(a.kind === 'shape' && a.from.x).toBeGreaterThan(100);
  });
});

describe('a change becomes ops', () => {
  it('puts what is new or changed, removes what went, and leaves AI-canvas frames alone', () => {
    const a: WbItem = { kind: 'text', id: 'a', at: { x: 0, y: 0 }, text: 'a' };
    const b: WbItem = { kind: 'text', id: 'b', at: { x: 0, y: 0 }, text: 'b' };
    const art: WbItem = { kind: 'artifact', id: 'f', at: { x: 0, y: 0 }, size: { w: 100, h: 100 }, ref: { type: 'chart', index: 0 } };
    expect(diffOps([a, b], [a, b, art])).toEqual([]);
    expect(diffOps([a, b], [{ ...a, text: 'A' }])).toEqual([
      { op: 'put', item: { ...a, text: 'A' } },
      { op: 'remove', id: 'b' },
    ]);
  });

  it('names a new board after the ones there are', () => {
    expect(nextBoardName(null)).toBe('Board');
    const index = { version: 1 as const, boards: [{ id: 'whiteboard', name: 'Whiteboard', kind: 'whiteboard' as const, rev: 0, createdAt: '', updatedAt: '' }] };
    /* The stored default "Whiteboard" is DISPLAYED as Board (0.1.8.1 C9), so the next one is Board 2, not a second "Board". */
    expect(nextBoardName(index)).toBe('Board 2');
    const named = (name: string, id = 'x') => ({ id, name, kind: 'whiteboard' as const, rev: 0, createdAt: '', updatedAt: '' });
    expect(nextBoardName({ version: 1 as const, boards: [named('Board', 'board')] })).toBe('Board 2');
    expect(nextBoardName({ version: 1 as const, boards: [named('Whiteboard', 'whiteboard'), named('Board 2', 'space-2')] })).toBe('Board 3');
    /* a board the person called Whiteboard on another id is theirs, and still counts as that name */
    expect(nextBoardName({ version: 1 as const, boards: [named('Whiteboard', 'mine')] })).toBe('Board');
  });

  it('shows an untouched default Whiteboard as Board, and keeps any name the person chose', () => {
    const b = (id: string, name: string, kind: 'whiteboard' | 'architecture' = 'whiteboard') => ({ id, name, kind });
    expect(boardLabel(b('whiteboard', 'Whiteboard'))).toBe('Board');
    expect(boardLabel(b('whiteboard', 'Roadmap'))).toBe('Roadmap');
    expect(boardLabel(b('mine', 'Whiteboard'))).toBe('Whiteboard');
    expect(boardLabel(b('architecture', 'Architecture', 'architecture'))).toBe('Architecture');
  });
});

describe('a text mark keeps off the connectors, but stays with its shape', () => {
  it('moves at most 24 units to a clear spot, preferring inside its rectangle', async () => {
    const { placeTextMark, linesFromPaths, textMarkBox, TEXT_NUDGE_MAX } = await import('./textPlace');
    const box = textMarkBox({ x: 100, y: 100 }, 'Checkout core');
    expect(placeTextMark(box, linesFromPaths(['M0 300 L400 300']), [])).toEqual({ x: 0, y: 0, plate: false });
    const through = linesFromPaths(['M0 90 L400 90']);
    const d = placeTextMark(box, through, []);
    expect(d.plate).toBe(false);
    expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(TEXT_NUDGE_MAX);
    expect(Math.abs(d.y)).toBeGreaterThan(0);
    /* With an owning rectangle below, the label moves down into it, not up out of it. */
    const owner = { x: 90, y: 75, w: 200, h: 120 };
    const inOwner = placeTextMark(box, through, [], owner);
    expect(inOwner.y).toBeGreaterThan(0);
  });

  it('keeps its place on a plate when nothing within reach is clear', async () => {
    const { placeTextMark, linesFromPaths, textMarkBox } = await import('./textPlace');
    const box = textMarkBox({ x: 100, y: 100 }, 'Checkout core');
    /* Vertical connectors every 10 units across the whole neighbourhood. */
    const comb = linesFromPaths(Array.from({ length: 40 }, (_, i) => `M${i * 10} 0 L${i * 10} 400`));
    expect(placeTextMark(box, comb, [])).toEqual({ x: 0, y: 0, plate: true });
  });
});
