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

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    const phase = opts.store.getState().repo.phase;
    if (phase !== 'attached' && phase !== 'stale') return;
    inFlight = true;
    try {
      const res = await fetchImpl('/api/status', { headers: { accept: 'application/json' } });
      if (stopped || !res.ok) return;
      const body = (await res.json()) as GetStatusResponse;
      if (!body.attached || !('root' in body) || body.stale !== true) return;
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
  let id: ReturnType<typeof setInterval> | undefined;
  const begin = (): void => {
    id = setInterval(() => {
      void tick();
    }, pollMs);
    void tick();
  };
  const first = delay > 0 ? setTimeout(begin, delay) : (begin(), undefined);

  return () => {
    stopped = true;
    if (first !== undefined) clearTimeout(first);
    if (id !== undefined) clearInterval(id);
  };
}
