import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardTabs } from '../canvas/boards/BoardTabs';
import { closeAfterEmpty, diffOps, type BoardsIndex } from '../canvas/boards/boardsModel';
import { Whiteboard } from './Whiteboard';
import { normalizeLegacy, type WbItem, type WhiteboardDoc } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

afterEach(cleanup);

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const box = (id: string, x: number, extra: Record<string, unknown> = {}): WbItem =>
  ({ kind: 'shape', id, shape: 'rect', from: { x, y: 0 }, to: { x: x + 10, y: 10 }, ...extra }) as WbItem;

describe('a new group never reuses a saved group id', () => {
  it('60 saved groups g1..g60, then Group: the new id is none of them (the counter restarts at 1 per load)', () => {
    const saved = Array.from({ length: 60 }, (_, i) => box(`far${i}`, 1000 + i * 20, { group: `g${i + 1}` }));
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} agentItems={[box('a', 0), box('b', 30), ...saved]} />);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    for (const [t, x, y] of [['pointerdown', -5, -5], ['pointermove', 50, 20], ['pointerup', 50, 20]] as const) {
      fireEvent(canvas, new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, shiftKey: t === 'pointerdown' }));
    }
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-group'));
    const items = seen[seen.length - 1]!.items;
    const g = items.find((i) => i.id === 'a')!.group!;
    expect(items.find((i) => i.id === 'b')!.group).toBe(g);
    expect(saved.map((i) => i.group)).not.toContain(g);
    expect(items.filter((i) => i.group === g).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('a legacy item is written in the current names', () => {
  it('maps gold..indigo to chart1..6, a shape color to stroke, and an svg markup to svg', () => {
    const shape = normalizeLegacy(box('s', 0, { color: 'gold', fill: 'indigo' }));
    expect(shape).toMatchObject({ stroke: 'chart1', fill: 'chart6' });
    expect('color' in shape).toBe(false);
    expect(normalizeLegacy(box('s', 0, { stroke: 'teal' }))).toMatchObject({ stroke: 'chart4' });
    expect(normalizeLegacy({ kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'x', color: 'bronze' } as WbItem)).toMatchObject({ color: 'chart5' });
    const svg = normalizeLegacy({ kind: 'svg', id: 'v', at: { x: 0, y: 0 }, w: 50, h: 50, markup: '<svg/>' } as WbItem);
    expect(svg).toMatchObject({ svg: '<svg/>' });
    expect('markup' in svg).toBe(false);
    /* an own-theme hex is the agent colour, left alone; current names are left alone */
    expect(normalizeLegacy(box('o', 0, { stroke: '#336699', ownTheme: true }))).toMatchObject({ stroke: '#336699' });
    expect(normalizeLegacy(box('n', 0, { stroke: 'danger' }))).toMatchObject({ stroke: 'danger' });
  });

  it('diffOps sends a changed legacy item in the current names, and sends nothing for one nobody touched', () => {
    const legacy = box('s', 0, { color: 'blue' });
    expect(diffOps([legacy], [legacy])).toEqual([]);
    const moved = { ...legacy, to: { x: 99, y: 10 } } as WbItem;
    const [op] = diffOps([legacy], [moved]);
    expect(op).toMatchObject({ op: 'put', item: { id: 's', stroke: 'chart2' } });
    expect('color' in (op as unknown as { item: object }).item).toBe(false);
  });
});

describe('Fill is only offered where the store keeps a fill', () => {
  const pick = (id: string) => {
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.pointerDown(screen.getAllByTestId('wb-item').find((e) => e.closest('[data-item-id]')?.getAttribute('data-item-id') === id)!);
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
  };
  it('a shape has the Fill row; a sticky does not', () => {
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[box('a', 0), { kind: 'text', id: 's', at: { x: 200, y: 0 }, text: 'n', sticky: true } as WbItem]} />);
    pick('a');
    expect(screen.getByTestId('wb-color-tint')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    pick('s');
    expect(screen.queryByTestId('wb-color-tint')).toBeNull();
  });
});

describe('the Spaces strip says Spaces', () => {
  it('captions and labels itself Spaces on the Spaces surface, Boards elsewhere', () => {
    const index = { version: 1, boards: [{ id: 'architecture', name: 'Architecture', kind: 'architecture', rev: 0, createdAt: '', updatedAt: '' }] } as unknown as BoardsIndex;
    const noop = () => undefined;
    const { container } = render(<BoardTabs index={index} current="architecture" onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} caption="Spaces" />);
    expect(screen.getByTestId('board-tabs').getAttribute('aria-label')).toBe('Spaces');
    expect(container.querySelector('.btag-cap')!.textContent).toBe('Spaces');
    cleanup();
    render(<BoardTabs index={index} current="architecture" onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);
    expect(screen.getByTestId('board-tabs').getAttribute('aria-label')).toBe('Boards');
  });
});

describe('the surface closes only for the project whose Spaces emptied', () => {
  it('a project switched to with none shows "No spaces"; the one that emptied closes', () => {
    expect(closeAfterEmpty(null, 'A', 0)).toEqual({ close: false, had: null });
    const had = closeAfterEmpty(null, 'A', 2);
    expect(had).toEqual({ close: false, had: 'A' });
    expect(closeAfterEmpty(had.had, 'B', 0)).toEqual({ close: false, had: null });
    expect(closeAfterEmpty(had.had, 'A', 0)).toEqual({ close: true, had: null });
    expect(closeAfterEmpty(closeAfterEmpty(had.had, 'A', 0).had, 'A', 0).close).toBe(false);
  });
});
