import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLEARED_MS, Whiteboard } from './Whiteboard';

/*
 * 0.1.8.1 C3 (audit P1-4): "Clear board has no undo toast". A "Board cleared, Undo" toast shows for 8 s; Undo and
 * Ctrl+Z restore every shape and stroke.
 */

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
function stroke(el: Element, points: { x: number; y: number }[]) {
  const fire = (type: string, p: { x: number; y: number }) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
  fire('pointerdown', points[0]!);
  for (const p of points.slice(1)) fire('pointermove', p);
  fire('pointerup', points[points.length - 1]!);
}
const SQUIGGLE = [
  { x: 10, y: 10 },
  { x: 22, y: 41 },
  { x: 35, y: 12 },
  { x: 48, y: 44 },
];

/** A board with two strokes and one rectangle. */
function drawThree(wrap?: (board: JSX.Element) => JSX.Element) {
  const board = <Whiteboard repoRoot="r" storage={memoryStore()} />;
  render(wrap ? wrap(board) : board);
  const canvas = screen.getByTestId('wb-canvas');
  fireEvent.click(screen.getByTestId('wb-tool-draw'));
  stroke(canvas, SQUIGGLE);
  stroke(canvas, SQUIGGLE.map((p) => ({ x: p.x + 100, y: p.y })));
  fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
  fireEvent.click(screen.getByTestId('wb-tool-rect'));
  stroke(canvas, [
    { x: 200, y: 200 },
    { x: 260, y: 240 },
  ]);
  const kinds = () => screen.queryAllByTestId('wb-item').map((i) => i.getAttribute('data-kind')).sort();
  expect(kinds()).toEqual(['shape', 'stroke', 'stroke']);
  return kinds;
}
function clear() {
  fireEvent.click(screen.getByTestId('wb-more'));
  fireEvent.click(screen.getByTestId('wb-more-clear'));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Clear board says so, with an Undo (0.1.8.1 C3)', () => {
  it('shows "Board cleared" with Undo; Undo restores every shape and stroke', () => {
    const kinds = drawThree();
    clear();
    expect(kinds()).toEqual([]);
    const toast = screen.getByTestId('wb-cleared');
    expect(toast.textContent).toContain('Board cleared');
    expect(screen.getByTestId('wb-cleared-undo').textContent).toContain('Undo');
    fireEvent.click(screen.getByTestId('wb-cleared-undo'));
    expect(kinds()).toEqual(['shape', 'stroke', 'stroke']);
    expect(screen.queryByTestId('wb-cleared')).toBeNull();
  });

  it('Ctrl+Z restores the board from anywhere on the page while the toast shows', () => {
    const kinds = drawThree();
    clear();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(kinds()).toEqual(['shape', 'stroke', 'stroke']);
  });

  it('the toast stays 8 s, then goes', () => {
    vi.useFakeTimers();
    drawThree();
    clear();
    expect(CLEARED_MS).toBe(8000);
    act(() => {
      vi.advanceTimersByTime(CLEARED_MS - 100);
    });
    expect(screen.getByTestId('wb-cleared')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId('wb-cleared')).toBeNull();
  });
});

describe('the page-level Ctrl+Z belongs to the board on screen only (review N4)', () => {
  it('a board folded away behind a hidden pane is not restored by a Ctrl+Z meant for something else', () => {
    let hide: (() => void) | null = null;
    function Host({ children }: { children: JSX.Element }) {
      const [hidden, setHidden] = useState(false);
      hide = () => setHidden(true);
      return <div hidden={hidden}>{children}</div>;
    }
    const kinds = drawThree((b) => <Host>{b}</Host>);
    clear();
    act(() => hide!());
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(kinds()).toEqual([]);
  });
});
