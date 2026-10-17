import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowView } from './FlowView';
import { GridView, gridCellSize } from './GridView';
import { SWITCHER_VIEWS, VIEW_ENABLED, linesOf, readingOrder, shortestPath, viewForShortcut, type ViewBox } from './viewModel';

/* STREAM 3b, SLICE B: the Grid and Flow views read the same boxes and lines
   as the Map. Whether they ship is the registered A/B (lab/log.md). */

const boxes: ViewBox[] = [
  { id: 'svc:a', label: 'a' },
  { id: 'm:a1', label: 'a1', parentId: 'svc:a' },
  { id: 'svc:b', label: 'b' },
  { id: 'svc:c', label: 'c' },
];
const lines = linesOf(boxes, [
  { source: 'm:a1', target: 'svc:b', title: '3 http', merged: 3 },
  { source: 'svc:b', target: 'svc:c' },
  { source: 'svc:c', target: 'svc:c' },
  { source: 'svc:c', target: 'gone' },
]);

describe('the view model', () => {
  it('keeps one line per directed pair between drawn boxes', () => {
    expect(lines.map((l) => `${l.source}->${l.target}:${l.count}`)).toEqual(['m:a1->svc:b:3', 'svc:b->svc:c:1']);
  });

  it('orders a group directly before its members', () => {
    expect(readingOrder([boxes[1]!, boxes[2]!, boxes[0]!]).map((b) => b.id)).toEqual(['svc:b', 'svc:a', 'm:a1']);
  });

  it('walks the shortest directed path, null when there is none', () => {
    expect(shortestPath(lines, 'm:a1', 'svc:c')!.map((l) => l.target)).toEqual(['svc:b', 'svc:c']);
    expect(shortestPath(lines, 'svc:c', 'm:a1')).toBeNull();
    expect(shortestPath(lines, 'svc:b', 'svc:b')).toEqual([]);
  });
});

describe('the Grid view', () => {
  it('puts a count in the row-depends-on-column cell and names members with their group', () => {
    render(<GridView boxes={boxes} lines={lines} />);
    const cell = document.querySelector('td[data-src="m:a1"][data-dst="svc:b"]')!;
    expect(cell.textContent).toBe('3');
    expect(cell.getAttribute('title')).toBe('A / A1 uses B: 3 http');
    expect(document.querySelector('td[data-src="svc:b"][data-dst="m:a1"]')!.textContent).toBe('');
    expect(screen.getAllByTestId('grid-row-label').map((e) => e.textContent)).toEqual(['A', 'A / A1', 'B', 'C']);
  });
});

describe('the Grid fills the pane and explains a cell', () => {
  it('sizes cells to the pane between 18 and 32 px', () => {
    /* Round 7 C.6: up to 56px, so a small board's matrix fills the pane. */
    expect(gridCellSize(800, 700, 11)).toBe(50);
    expect(gridCellSize(760, 760, 5)).toBe(56);
    expect(gridCellSize(800, 700, 50)).toBe(18);
    expect(gridCellSize(180 + 25 * 24, 900, 25)).toBe(24);
  });

  it('a cell with a count is a button that asks for its edges', () => {
    const onCell = vi.fn();
    render(<GridView boxes={boxes} lines={lines} onCell={onCell} />);
    fireEvent.click(screen.getAllByTestId('grid-cell')[0]!);
    expect(onCell).toHaveBeenCalledWith('m:a1', 'svc:b', expect.any(Object));
    expect(screen.getByText('Each row uses the columns marked. Numbers count code links.')).not.toBeNull();
  });
});

describe('the Flow view', () => {
  it('draws one message per hop between lifelines, or says there is no path', () => {
    render(<FlowView boxes={boxes} lines={lines} />);
    expect(screen.getByTestId('flow-hint')).not.toBeNull();
    fireEvent.change(screen.getByTestId('flow-start'), { target: { value: 'm:a1' } });
    fireEvent.change(screen.getByTestId('flow-end'), { target: { value: 'svc:c' } });
    expect(screen.getAllByTestId('flow-lifeline').map((e) => e.getAttribute('data-id'))).toEqual(['m:a1', 'svc:b', 'svc:c']);
    expect(screen.getAllByTestId('flow-message').map((e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`)).toEqual(['m:a1>svc:b', 'svc:b>svc:c']);
    expect(screen.getByTestId('flow-count').textContent).toBe('2 hops');
    fireEvent.change(screen.getByTestId('flow-start'), { target: { value: 'svc:c' } });
    fireEvent.change(screen.getByTestId('flow-end'), { target: { value: 'svc:a' } });
    expect(screen.getByTestId('flow-nopath').textContent).toBe('No path from C to A on this board.');
  });
});

describe('the switcher offers Map and only the views that won their A/B', () => {
  it('Grid, Diff and Hotspots won on 3 of 3 repos and are offered; Flow won on 1 of 3 and is disabled', () => {
    expect(VIEW_ENABLED).toEqual({ map: true, grid: true, flow: false, diff: true, hotspots: true });
    expect(SWITCHER_VIEWS).toEqual(['map', 'grid', 'diff', 'hotspots']);
  });

  it('Ctrl or Cmd plus 1..N picks the Nth view; other keys and modifiers do not', () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(viewForShortcut(k('1', { ctrlKey: true }))).toBe('map');
    expect(viewForShortcut(k('2', { metaKey: true }))).toBe('grid');
    expect(viewForShortcut(k('5', { ctrlKey: true }))).toBeNull();
    expect(viewForShortcut(k('2'))).toBeNull();
    expect(viewForShortcut(k('2', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
