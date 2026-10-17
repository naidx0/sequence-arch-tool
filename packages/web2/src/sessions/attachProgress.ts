/* ══════════════════════════════════════════════════════════════════════════
   A SWITCH IN FLIGHT SAYS HOW FAR IT IS (019-progress)
   packages/web2/src/sessions/attachProgress.ts

   `POST /api/attach` answers only when the scan ends, so a switch to a big repo was a static screen for 10 to 40 s.
   The engine reports the runtime attach on `GET /api/status` as the additive `attaching` field
   ({ path, phase, done, total, startedAt }; `scanning` stays the startup attach's). While the attach request is
   pending this polls status and holds the latest `attaching` in a tiny store the corner panel reads. Nothing
   else waits on it: the rest of the app stays usable.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';
import type { BootTransport } from '../boot/bootSequence';

export interface SwitchProgress {
  kind: 'attaching';
  path: string;
  phase: 'preparing' | 'scanning';
  done: number;
  total: number;
}
export interface SwitchFailure {
  kind: 'failed';
  path: string;
  message: string;
}
export type SwitchProgressState = SwitchProgress | SwitchFailure | null;

let current: SwitchProgressState = null;
const listeners = new Set<() => void>();
let failTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: SwitchProgressState): void {
  current = next;
  for (const l of listeners) l();
}

export const getSwitchProgress = (): SwitchProgressState => current;
export function subscribeSwitchProgress(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useSwitchProgress = (): SwitchProgressState => useSyncExternalStore(subscribeSwitchProgress, getSwitchProgress, () => null);
export function resetSwitchProgressForTest(): void {
  if (failTimer) clearTimeout(failTimer);
  failTimer = null;
  set(null);
}

/** A plain refusal, shown for a few seconds then dropped. */
export function reportSwitchFailure(path: string, message: string, ms = 8000): void {
  if (failTimer) clearTimeout(failTimer);
  set({ kind: 'failed', path, message });
  failTimer = setTimeout(() => {
    failTimer = null;
    if (current?.kind === 'failed') set(null);
  }, ms);
}

/**
 * Run `work` (the attach request) while polling `/api/status` for its progress. A failed poll just keeps the last numbers.
 */
export async function withAttachProgress<T>(transport: BootTransport, path: string, work: () => Promise<T>, intervalMs = 400): Promise<T> {
  if (failTimer) clearTimeout(failTimer);
  failTimer = null;
  set({ kind: 'attaching', path, phase: 'preparing', done: 0, total: 0 });
  let live = true;
  let polling = false;
  const tick = async (): Promise<void> => {
    if (!live || polling || !transport.status) return;
    polling = true;
    try {
      const r = await transport.status();
      if (!live || r.outcome !== 'ok') return;
      const a = (r.body as { attaching?: { path?: unknown; phase?: unknown; done?: unknown; total?: unknown } }).attaching;
      if (!a) return;
      const done = typeof a.done === 'number' ? a.done : 0;
      const total = typeof a.total === 'number' ? a.total : 0;
      set({ kind: 'attaching', path: typeof a.path === 'string' ? a.path : path, phase: a.phase === 'scanning' ? 'scanning' : 'preparing', done, total });
    } catch {
      /* keep the last numbers */
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  try {
    return await work();
  } finally {
    live = false;
    clearInterval(timer);
    if (current?.kind === 'attaching') set(null);
  }
}
