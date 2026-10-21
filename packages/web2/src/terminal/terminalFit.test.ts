import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clampGrid, createFitScheduler, FIT_DEBOUNCE_MS, MIN_COLS, resizeMessage, type Grid } from './terminalFit';
import { createScreen, resizeScreen, viewScreen, writeScreen } from './terminalScreen';

/*
 * 0.1.8.1 C2 (audit P1-6): "Terminal wraps mid-word and garbles after a narrow resize". Resize 1440 to 780 and back:
 * the prompt and output re-flow cleanly, with no stale fragments.
 */

describe('the fit waits for the layout to settle (debounced, one resize)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a burst of box changes sends the shell ONE resize, for the size the box settled at', () => {
    let box: Grid = { cols: 160, rows: 40 };
    const sent: Grid[] = [];
    const fit = createFitScheduler({ measure: () => box, apply: (g) => sent.push(g) });
    for (const cols of [150, 130, 110, 90, 86]) {
      box = { cols, rows: 40 };
      fit.schedule();
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS / 4);
    }
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    expect(sent).toEqual([{ cols: 86, rows: 40 }]);
  });

  it('an unchanged grid is not sent again; a hidden (0x0) box is never sent', () => {
    let box: Grid | null = { cols: 100, rows: 30 };
    const sent: Grid[] = [];
    const fit = createFitScheduler({ measure: () => box, apply: (g) => sent.push(g) });
    fit.flush();
    fit.flush();
    box = null;
    fit.flush();
    expect(sent).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('never fewer than MIN_COLS columns', () => {
    expect(MIN_COLS).toBeGreaterThanOrEqual(40);
    expect(clampGrid({ cols: 12, rows: 2 })).toEqual({ cols: MIN_COLS, rows: 4 });
    expect(clampGrid({ cols: 0, rows: 10 })).toBeNull();
  });

  it('the resize message is the shape the terminal route reads', () => {
    expect(JSON.parse(resizeMessage(120, 33))).toEqual({ type: 'resize', cols: 120, rows: 33 });
  });
});

describe('the grid re-wraps on a width change (no stale fragments)', () => {
  const LINE = 'echo the quick brown fox jumps over the lazy dog and keeps running across the whole width';

  it('1440 -> 780 -> 1440: a repaint at each width leaves exactly the repainted text', () => {
    const s = createScreen(160, 20);
    writeScreen(s, `$ ${LINE}\r\n${LINE.slice(5)}\r\n$ `);
    /* Narrow, then wide again: the lines read back whole, with nothing doubled. */
    resizeScreen(s, 60, 20);
    const narrow = viewScreen(s).lines.filter((l) => l.trim() !== '');
    expect(narrow.join('\n')).toContain(LINE.slice(5));
    for (const line of narrow) expect(line).not.toMatch(/keepsdog|width of pane/);
    resizeScreen(s, 160, 20);
    const wide = viewScreen(s).lines.filter((l) => l.trim() !== '');
    expect(wide).toEqual([`$ ${LINE}`, LINE.slice(5), '$ ']);
  });

  it('narrowing re-cuts the rows at the new width, so a repaint at that width overwrites them whole', () => {
    const s = createScreen(80, 10);
    writeScreen(s, 'a'.repeat(70) + 'TAIL');
    resizeScreen(s, 40, 10);
    expect(s.lines.slice(0, 2)).toEqual(['a'.repeat(40), 'a'.repeat(30) + 'TAIL']);
    expect(s.cont.slice(0, 2)).toEqual([false, true]);
    /* The cursor kept its place in the line: after TAIL. */
    expect(s.row).toBe(1);
    expect(s.col).toBe(34);
    /* ConPTY's repaint of row 0 at 40 columns leaves nothing behind. */
    writeScreen(s, '\x1b[1;1H' + 'b'.repeat(40));
    expect(s.lines[0]).toBe('b'.repeat(40));
  });

  it('a height change keeps the cursor on its own line (scrolls, never jumps lines)', () => {
    const s = createScreen(40, 10);
    for (let i = 0; i < 9; i++) writeScreen(s, `line ${i}\r\n`);
    writeScreen(s, '$ ');
    resizeScreen(s, 40, 4);
    expect(s.lines[s.top + s.row]).toBe('$ ');
  });
});
