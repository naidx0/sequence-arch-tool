/* ══════════════════════════════════════════════════════════════════════════
   SIDE-BY-SIDE DIFF — the pure half (round 9, ask 31: DeepSeek harness study)
   packages/web2/src/review/diffSplit.ts

   DeepSeek's review tab defaults to side-by-side with no wrap, remembers the
   choice, and falls back to ONE column for a diff that only adds or only
   deletes (nothing to put on the other side). Both columns move together.
   This file is the arithmetic and the remembered choice; DiffView draws it.

   The pairing is the one every split viewer uses: a run of removed lines is
   laid against the run of added lines that follows it, row by row, the shorter
   side padded with empty cells; context lines sit on both sides.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

import type { DiffFileChange, DiffLine } from './diffModel';

export type DiffViewMode = 'unified' | 'split';

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Lay removed runs against the added runs that follow them. Total: no input throws. */
export function pairHunkLines(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = (): void => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i += 1) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === 'del') dels.push(line);
    else if (line.kind === 'add') adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

/** A file whose diff only adds, or only removes, has nothing to set against
 *  itself: it is drawn in one column in either mode. */
export function isOneSided(file: Pick<DiffFileChange, 'hunks'>): boolean {
  let adds = 0;
  let dels = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') adds += 1;
      else if (line.kind === 'del') dels += 1;
    }
  }
  return adds === 0 || dels === 0;
}

/** The mode a file is actually drawn in, given the person's choice. */
export function effectiveMode(file: Pick<DiffFileChange, 'hunks'>, chosen: DiffViewMode): DiffViewMode {
  return chosen === 'split' && !isOneSided(file) ? 'split' : 'unified';
}

/* ── the remembered choice ───────────────────────────────────────────────── */

/** The same key the review dock already writes, so the two agree. */
export const DIFF_VIEW_KEY = 'sequence.review.view';
export const DIFF_WRAP_KEY = 'sequence.review.wrap';

export interface DiffPrefs {
  view: DiffViewMode;
  wrap: boolean;
}

function read(storage: Pick<Storage, 'getItem'> | null): DiffPrefs {
  let view: DiffViewMode = 'unified';
  let wrap = false;
  try {
    const v = storage?.getItem(DIFF_VIEW_KEY);
    if (v === 'unified' || v === 'split') view = v;
    wrap = storage?.getItem(DIFF_WRAP_KEY) === 'on';
  } catch {
    /* storage can throw (private window, blocked site data): the defaults stand */
  }
  return { view, wrap };
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let current: DiffPrefs | null = null;
const listeners = new Set<() => void>();

function snapshot(): DiffPrefs {
  if (current === null) current = read(browserStorage());
  return current;
}

export const diffPrefs = {
  get: snapshot,
  set(next: Partial<DiffPrefs>): void {
    current = { ...snapshot(), ...next };
    try {
      const s = browserStorage();
      s?.setItem(DIFF_VIEW_KEY, current.view);
      s?.setItem(DIFF_WRAP_KEY, current.wrap ? 'on' : 'off');
    } catch {
      /* the choice still holds for this session */
    }
    for (const l of listeners) l();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Tests: forget the cached read so the next get() reads storage again. */
  reset(): void {
    current = null;
  },
};

export function useDiffPrefs(): DiffPrefs {
  return useSyncExternalStore(diffPrefs.subscribe, diffPrefs.get, diffPrefs.get);
}
