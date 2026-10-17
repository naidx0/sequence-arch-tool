/* ══════════════════════════════════════════════════════════════════════════
   FITTING THE GRID TO THE PANE, ONCE THE LAYOUT HAS SETTLED
   packages/web2/src/terminal/terminalFit.ts

   0.1.8.1 C2 (audit P1-6): "the terminal wraps mid-word and garbles after a
   narrow resize". The pane told the shell its size on every ResizeObserver
   callback, so a window drag from 1440 to 780 px sent the pty a resize per
   frame, and ConPTY repainted at each intermediate width on top of a grid that
   had already moved on. Now:

     - the fit is DEBOUNCED: measured once the box has held still for
       FIT_DEBOUNCE_MS, and the shell hears one resize, for the settled size;
     - the grid never goes below MIN_COLS columns (a sliver of a pane scrolls
       sideways rather than wrapping every word);
     - a resize is sent only when the grid actually changed;
     - the page coming back into view re-measures (a hidden tab measures 0x0
       and is skipped, so its size can be stale when it is shown again).
   ══════════════════════════════════════════════════════════════════════════ */

/** How long the pane's box must hold still before the grid is fitted and the shell is told. */
export const FIT_DEBOUNCE_MS = 120;
/** The fewest columns the grid is ever given. */
export const MIN_COLS = 40;
/** The fewest rows the grid is ever given. */
export const MIN_ROWS = 4;

export interface Grid {
  cols: number;
  rows: number;
}

/** A measured grid held to the minimums; null for a box with no size (a hidden pane). */
export function clampGrid(m: Grid | null): Grid | null {
  if (!m || !(m.cols > 0) || !(m.rows > 0)) return null;
  return { cols: Math.max(MIN_COLS, Math.floor(m.cols)), rows: Math.max(MIN_ROWS, Math.floor(m.rows)) };
}

/** The message the terminal socket sends the pty for a new size (packages/analyzer terminal route). */
export function resizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: 'resize', cols, rows });
}

export interface FitScheduler {
  /** The box may have changed: fit once it has been still for the debounce. */
  schedule: () => void;
  /** Fit now (the socket just opened, or the page came back into view). */
  flush: () => void;
  /** The size the shell was last told, or null before the first fit. */
  last: () => Grid | null;
  /** Forget what was told (a new socket has been told nothing yet). */
  reset: () => void;
  cancel: () => void;
}

export interface FitSchedulerOptions {
  measure: () => Grid | null;
  /** Tell the shell. `false` means nobody heard it (no socket yet), so the same grid is told again next time. */
  apply: (grid: Grid) => boolean | void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createFitScheduler({
  measure,
  apply,
  delayMs = FIT_DEBOUNCE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}: FitSchedulerOptions): FitScheduler {
  let timer: unknown = null;
  let told: Grid | null = null;
  const fit = () => {
    timer = null;
    const grid = clampGrid(measure());
    if (!grid) return;
    if (told && told.cols === grid.cols && told.rows === grid.rows) return;
    if (apply(grid) !== false) told = grid;
  };
  return {
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(fit, delayMs);
    },
    flush() {
      if (timer !== null) clearTimer(timer);
      fit();
    },
    last: () => told,
    reset() {
      told = null;
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
