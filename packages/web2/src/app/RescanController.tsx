/* ══════════════════════════════════════════════════════════════════════════
   THE RESCAN CONTROLLER (019-rescan-ui)
   packages/web2/src/app/RescanController.tsx

   Renders nothing. Starts the engine's stale probe, and, when "Refresh the board automatically when files change" is
   on, rescans once a moment after the files stop changing. Paused while an agent turn or run is writing files (the
   edit burst would rescan again and again); it catches up a moment after the work ends.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react';

import { agentRuns } from '../agents/agentRuns';
import { readAutoRefreshEnabled, subscribeAutoRefresh } from '../settings/autoRefreshPreference';
import { useStore } from '../state/connect';
import type { Store } from '../state/store';
import { startExternalStaleProbe } from './externalStaleProbe';
import { AutoRefresh, getRescanState, rescanNow, type RescanDeps } from './rescanRun';

export interface RescanControllerOptions {
  fetchImpl?: typeof fetch;
  pollMs?: number;
  debounceMs?: number;
  maxWaitMs?: number;
  rescanDeps?: RescanDeps;
  /** Test seam: replace the "an agent is writing" signal. */
  isWorking?: (store: Pick<Store, 'getState'>) => boolean;
}

const defaultWorking = (store: Pick<Store, 'getState'>): boolean =>
  store.getState().session.inFlight !== null || agentRuns.get().runs.some((r) => r.status === 'running');

/** Wire the probe and the auto-refresh to a store. Returns the stop function (the component's cleanup). */
export function startRescanController(store: Store, opts: RescanControllerOptions = {}): () => void {
  const stopProbe = startExternalStaleProbe({ store, fetchImpl: opts.fetchImpl, pollMs: opts.pollMs });
  const working = opts.isWorking ?? defaultWorking;
  /* After a failed rescan the same change is not retried on a loop; a different change is. */
  let failedSignature: string | null = null;
  let signature = '';
  const scheduler = new AutoRefresh(
    () => {
      const sig = signature;
      void rescanNow(store, opts.rescanDeps).then((outcome) => {
        if (outcome === 'failed') failedSignature = sig;
      });
    },
    opts.debounceMs,
    opts.maxWaitMs,
  );
  const evaluate = (): void => {
    const repo = store.getState().repo;
    if (repo.phase !== 'stale' || !readAutoRefreshEnabled() || working(store) || getRescanState().kind === 'running') {
      scheduler.cancel();
      if (repo.phase !== 'stale') failedSignature = null;
      return;
    }
    signature = repo.changedPaths.join('|');
    if (signature === failedSignature) return;
    scheduler.note(signature);
  };
  const unsubStore = store.subscribe(evaluate);
  const unsubRuns = agentRuns.subscribe(evaluate);
  const unsubPref = subscribeAutoRefresh(evaluate);
  evaluate();
  return () => {
    unsubStore();
    unsubRuns();
    unsubPref();
    scheduler.cancel();
    stopProbe();
  };
}

export function RescanController(props: RescanControllerOptions = {}) {
  const store = useStore();
  useEffect(() => startRescanController(store, props), [store]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
