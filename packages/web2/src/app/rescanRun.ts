/* ══════════════════════════════════════════════════════════════════════════
   THE RESCAN (019-rescan-ui)
   packages/web2/src/app/rescanController.ts

   Three things the Index rail's Retry used to own and nothing owns now:
   1. one rescan at a time, whoever asks (the notice, Ctrl+K, the auto-refresh);
   2. the state of that rescan, for the notice and the status bar;
   3. the auto-refresh scheduler: files changed, wait for the burst to end, rescan once.

   The probe (externalStaleProbe.ts) sets `repo.phase === 'stale'` from the engine's own report; this file acts on it.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

import type { Store } from '../state/store';
import { rescanRepo, type RescanResult } from './rescanClient';

export type RescanState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'failed'; message: string };

const IDLE: RescanState = { kind: 'idle' };
let current: RescanState = IDLE;
const listeners = new Set<() => void>();
let inFlight: Promise<'ok' | 'failed' | 'skipped'> | null = null;

function set(next: RescanState): void {
  current = next;
  for (const l of listeners) l();
}

export const getRescanState = (): RescanState => current;
export function subscribeRescan(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useRescanState = (): RescanState => useSyncExternalStore(subscribeRescan, getRescanState, () => IDLE);
export function resetRescanForTest(): void {
  inFlight = null;
  set(IDLE);
}

export interface RescanDeps {
  rescan?: typeof rescanRepo;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type RescanStore = Pick<Store, 'getState' | 'dispatch'>;

/**
 * Rescan the attached project and load the result. One at a time: a second ask while one runs joins it. Skipped (and
 * says so) when nothing is attached. The board keeps painting the old graph until the new one lands.
 */
export function rescanNow(store: RescanStore, deps: RescanDeps = {}): Promise<'ok' | 'failed' | 'skipped'> {
  if (inFlight) return inFlight;
  const phase = store.getState().repo.phase;
  if (phase !== 'attached' && phase !== 'stale') return Promise.resolve('skipped');
  const run = deps.rescan ?? rescanRepo;
  const now = deps.now ?? Date.now;
  set({ kind: 'running', done: 0, total: 0 });
  inFlight = (async (): Promise<'ok' | 'failed'> => {
    let result: RescanResult;
    try {
      result = await run(deps.fetchImpl, undefined, (p) => set({ kind: 'running', done: p.done, total: p.total }));
    } catch (error) {
      result = { outcome: 'failed', status: null, message: (error as Error).message || 'the rescan did not finish' };
    }
    if (result.outcome === 'ok') {
      store.dispatch({ type: 'repo/loaded', draft: result.draft, at: now() });
      set(IDLE);
      return 'ok';
    }
    set({ kind: 'failed', message: result.message });
    return 'failed';
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const AUTO_REFRESH_DEBOUNCE_MS = 1000;
/** A steady stream of edits cannot hold the refresh off for ever. */
export const AUTO_REFRESH_MAX_WAIT_MS = 6000;

/**
 * Turns "the files changed" notices into ONE rescan: it fires `debounceMs` after the last NEW change (a notice naming
 * the same paths as before does not move it, so the status poll does not push it back), and never later than
 * `maxWaitMs` after the first.
 */
export class AutoRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;
  private lastSignature: string | null = null;

  constructor(
    private readonly run: () => void,
    private readonly debounceMs = AUTO_REFRESH_DEBOUNCE_MS,
    private readonly maxWaitMs = AUTO_REFRESH_MAX_WAIT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  note(signature: string): void {
    const at = this.now();
    if (this.timer === null) this.firstAt = at;
    else if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (this.timer !== null) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.firstAt + this.maxWaitMs - at));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSignature = null;
      this.run();
    }, wait);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.lastSignature = null;
  }
}
