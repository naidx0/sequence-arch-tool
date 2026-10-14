import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 0.1.8.1 review S6 and N3. S6: with the 40-column minimum, a pane narrower than the grid must scroll sideways, not
 * wrap words the shell never wrapped: the text block is exactly the grid's width. N3: a new socket is told its size
 * ONCE (the open and the observer's first fit each used to send one).
 */

const resizes: Array<[number, number]> = [];
vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async () => ({ sendInput: () => {}, resize: (c: number, r: number) => resizes.push([c, r]), close: () => {}, readyState: 1 })),
  };
});

import { TerminalPane } from './TerminalPane';
import { MIN_COLS } from './terminalFit';

let roCallback: (() => void) | null = null;
let box = { width: 0, height: 0 };
beforeEach(() => {
  resizes.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  /* A laid-out pane: 300 px wide (about 41 columns of 7.2 px), 400 tall. */
  box = { width: 300, height: 400 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: box.width, height: box.height, left: 0, top: 0, right: box.width, bottom: box.height, x: 0, y: 0, toJSON() {} }) as DOMRect,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a narrow terminal (review S6)', () => {
  it('the text block is the grid wide (--term-cols columns of 1ch), so a narrower pane scrolls instead of re-wrapping', async () => {
    const css = readFileSync(path.join(__dirname, '../v3/v3.css'), 'utf8');
    expect(css).toMatch(/\.terminal-grid \{\s*display: block;\s*width: calc\(var\(--term-cols, 80\) \* 1ch\);/);
    expect(css).toMatch(/\.terminal-pane-surface,\s*\.v3-terminal pre \{[^}]*overflow: auto;/);
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    const grid = screen.getByTestId('terminal-grid');
    expect(screen.getByTestId('terminal-pane-surface').contains(grid)).toBe(true);
    const cols = Number(grid.style.getPropertyValue('--term-cols'));
    expect(cols).toBeGreaterThanOrEqual(MIN_COLS);
  });
});

describe('a new socket hears its size once (review N3)', () => {
  it('the open fits through the observer\'s fitter: one resize, and the observer\'s first fit does not repeat it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<TerminalPane repoRoot="/repo" />);
      await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
      act(() => roCallback?.());
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(resizes).toHaveLength(1);
      expect(resizes[0]![0]).toBeGreaterThanOrEqual(MIN_COLS);
    } finally {
      vi.useRealTimers();
    }
  });
});
