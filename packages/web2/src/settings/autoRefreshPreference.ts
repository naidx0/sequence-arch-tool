/* ══════════════════════════════════════════════════════════════════════════
   "REFRESH THE BOARD AUTOMATICALLY WHEN FILES CHANGE" (019-rescan-ui)
   packages/web2/src/settings/autoRefreshPreference.ts

   ON BY DEFAULT: a rescan takes under a second, so waiting for a click on every edit is the worse default. Only the
   person's choice is stored; 'off' turns it off and anything else, including nothing or a corrupt value, is on.
   Off, the notice and its Rescan button stay (app/RescanStrip.tsx).
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

export const AUTO_REFRESH_KEY = 'sequence.autoRefresh';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/* Storage is the record; this only stands in when storage refuses a write, and wakes the readers on a change. */
let fallback: boolean | null = null;
const listeners = new Set<() => void>();

export function readAutoRefreshEnabled(store: Store | undefined = storage()): boolean {
  if (fallback !== null) return fallback;
  try {
    return store?.getItem(AUTO_REFRESH_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeAutoRefreshEnabled(enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(AUTO_REFRESH_KEY, enabled ? 'on' : 'off');
    fallback = null;
  } catch {
    fallback = enabled;
  }
  for (const l of listeners) l();
}

export function resetAutoRefreshForTest(): void {
  fallback = null;
  for (const l of listeners) l();
}

export function subscribeAutoRefresh(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAutoRefreshEnabled(): boolean {
  return useSyncExternalStore(subscribeAutoRefresh, () => readAutoRefreshEnabled(), () => true);
}
