/* ══════════════════════════════════════════════════════════════════════════
   THE STATUS BAR PREFERENCE (Decision 49)
   packages/web2/src/shell2/statusBarPref.ts

   Jaden: the bottom status bar is toggleable in Settings ("Status bar",
   on/off, default on, persisted). One key, one reader, one writer; the shell
   and the Settings control both subscribe, so flipping it shows or hides the
   bar at once in every mounted view.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

export const STATUS_BAR_KEY = 'sequence.statusBar';

const listeners = new Set<() => void>();

export function readStatusBar(): boolean {
  try {
    return localStorage.getItem(STATUS_BAR_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setStatusBar(on: boolean): void {
  try {
    localStorage.setItem(STATUS_BAR_KEY, on ? '1' : '0');
  } catch {
    /* the bar still follows for this session */
  }
  current = on;
  for (const fn of listeners) fn();
}

let current: boolean | null = null;

function snapshot(): boolean {
  if (current === null) current = readStatusBar();
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether the status bar shows; re-renders when Settings flips it. */
export function useStatusBar(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
