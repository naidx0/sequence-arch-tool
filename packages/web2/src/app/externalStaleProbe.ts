/**
 * P5 — poll GET /api/status for external disk changes → repo/stale.
 *
 * The engine's fs.watch marks the graph stale; this is the client half that
 * notices without auto-rescanning. Retry on the rail still owns the rescan.
 */

import type { GetStatusResponse } from '@sequence/api-types';

import type { Store } from '../state/store';

/* 1 s: a local GET, and with the auto-refresh on the page follows an edit in about three seconds in all. */
export const EXTERNAL_STALE_POLL_MS = 1000;
/* The probe's first ask waits this long at the real poll rate: boot has just read /api/status, the stale marker is sticky, and a
   poll inside the boot window is one more request (and a count that moves with the window edge) for an answer nobody can act on yet. */
export const STALE_PROBE_QUIET_MS = 3000;
/* Idle back-off: the first few answers with nothing changed keep the 1 s rate (an edit is followed in about three seconds), then the
   gap doubles up to this many times the poll rate (1 s becomes 5 s). A stale answer, a return to the tab or a repo change resets it. */
export const STALE_PROBE_FAST_ASKS = 5;
export const STALE_PROBE_MAX_FACTOR = 5;

export interface ExternalStaleProbeOptions {
  store: Store;
  /** Inject fetch (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Poll interval; override in tests. */
  pollMs?: number;
  /** Wait before the first ask; 0 when `pollMs` is overridden. */
  startDelayMs?: number;
  /** Clock for `repo/stale.at`. */
  now?: () => number;
}

/**
 * Start polling while a repo is attached. Returns a stop function.
 * Safe when detached — each tick no-ops until phase is attached|stale.
 */
export function startExternalStaleProbe(opts: ExternalStaleProbeOptions): () => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? EXTERNAL_STALE_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  let stopped = false;
  let inFlight = false;
  /* Consecutive answers that said nothing changed. */
  let idle = 0;
  const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const gapMs = (): number =>
    idle < STALE_PROBE_FAST_ASKS ? pollMs : Math.min(pollMs * STALE_PROBE_MAX_FACTOR, pollMs * 2 ** (idle - STALE_PROBE_FAST_ASKS + 1));

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    const phase = opts.store.getState().repo.phase;
    if (phase !== 'attached' && phase !== 'stale') return;
    inFlight = true;
    try {
      const res = await fetchImpl('/api/status', { headers: { accept: 'application/json' } });
      if (stopped || !res.ok) return;
      const body = (await res.json()) as GetStatusResponse;
      if (!body.attached || !('root' in body) || body.stale !== true) {
        idle += 1;
        return;
      }
      idle = 0;
      /* Already stale for the same reason — still refresh paths if the engine
         named more. Prefer external for watch-driven markers; write-driven
         client stale keeps its reason until rescan. */
      const current = opts.store.getState().repo;
      if (current.phase === 'stale' && current.reason !== 'external') {
        /* Client already knows from its own write; do not overwrite the cause. */
        return;
      }
      const paths = Array.isArray(body.stalePaths)
        ? body.stalePaths.filter((p): p is string => typeof p === 'string')
        : [];
      opts.store.dispatch({
        type: 'repo/stale',
        reason: 'external',
        changedPaths: paths,
        at: now(),
      });
    } catch {
      /* Probe is best-effort; a downed engine is said elsewhere. */
    } finally {
      inFlight = false;
    }
  };

  const delay = opts.startDelayMs ?? (opts.pollMs === undefined ? STALE_PROBE_QUIET_MS : 0);
  let id: ReturnType<typeof setTimeout> | undefined;
  /* One ask, then the next after the current gap. Hidden: no ask and no timer; coming back asks at once. */
  const loop = (): void => {
    id = undefined;
    if (stopped || !visible()) return;
    void tick().finally(() => {
      if (!stopped && id === undefined && visible()) id = setTimeout(loop, gapMs());
    });
  };
  const wake = (): void => {
    if (stopped || !visible()) return;
    idle = 0;
    if (id !== undefined) clearTimeout(id);
    loop();
  };
  let unsubStore: (() => void) | undefined;
  let lastPhase = opts.store.getState().repo.phase;
  const begin = (): void => {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
    if (typeof window !== 'undefined') window.addEventListener('focus', wake);
    /* A different repo phase (attach, stale, rescan landing) is news: ask at the fast rate again. */
    unsubStore = opts.store.subscribe(() => {
      const next = opts.store.getState().repo.phase;
      if (next !== lastPhase) {
        lastPhase = next;
        idle = 0;
      }
    });
    loop();
  };
  const first = delay > 0 ? setTimeout(begin, delay) : (begin(), undefined);

  return () => {
    stopped = true;
    if (first !== undefined) clearTimeout(first);
    if (id !== undefined) clearTimeout(id);
    unsubStore?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
    if (typeof window !== 'undefined') window.removeEventListener('focus', wake);
  };
}
