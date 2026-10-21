/* ══════════════════════════════════════════════════════════════════════════
   FOCUSED OR DETAILED TOOL CALLS
   packages/web2/src/settings/toolDetailPreference.ts

   Focused (the default) folds a run of tool calls into one summary row and keeps a thought to one line; a failed call
   stays its own row. Detailed draws every call as its own card. Only the person's choice is stored: 'detailed' is
   detailed, and anything else, including nothing or a corrupt value, is Focused.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

export const TOOL_DETAIL_KEY = 'sequence.toolDetail';

export type ToolDetail = 'focused' | 'detailed';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/* Storage is the record; this only stands in when storage refuses a write, and wakes the readers on a change. */
let fallback: ToolDetail | null = null;
const listeners = new Set<() => void>();

export function readToolDetail(store: Store | undefined = storage()): ToolDetail {
  if (fallback !== null) return fallback;
  try {
    return store?.getItem(TOOL_DETAIL_KEY) === 'detailed' ? 'detailed' : 'focused';
  } catch {
    return 'focused';
  }
}

export function writeToolDetail(mode: ToolDetail, store: Store | undefined = storage()): void {
  try {
    store?.setItem(TOOL_DETAIL_KEY, mode);
    fallback = null;
  } catch {
    fallback = mode;
  }
  for (const l of listeners) l();
}

export function resetToolDetailForTest(): void {
  fallback = null;
  /* The stored choice goes too: a test that chose Detailed must not hand it to the next test in the file. */
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(TOOL_DETAIL_KEY);
  } catch {
    /* storage refused: nothing was stored */
  }
  for (const l of listeners) l();
}

export function subscribeToolDetail(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useToolDetail(): ToolDetail {
  return useSyncExternalStore(subscribeToolDetail, () => readToolDetail(), () => 'focused' as ToolDetail);
}
