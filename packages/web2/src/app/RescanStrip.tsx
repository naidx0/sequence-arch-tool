/* ══════════════════════════════════════════════════════════════════════════
   THE RESCAN NOTICE (019-rescan-ui)
   packages/web2/src/app/RescanStrip.tsx

   One quiet line above the status bar, in plain words, for the three moments the person needs to know:
   - files changed and the automatic refresh is off: "Files changed. Rescan";
   - a rescan they asked for is running;
   - a rescan failed: why, and Rescan again.
   With the automatic refresh on, a stale board is not announced (it is gone in about two seconds); the status bar's
   own item says a refresh is running.
   ══════════════════════════════════════════════════════════════════════════ */

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { useAppState, useStore } from '../state/connect';
import { useAutoRefreshEnabled } from '../settings/autoRefreshPreference';
import { rescanNow, useRescanState } from './rescanRun';

export function RescanStrip() {
  const state = useAppState();
  const store = useStore();
  const rescan = useRescanState();
  const auto = useAutoRefreshEnabled();
  const stale = state.repo.phase === 'stale';
  const attached = stale || state.repo.phase === 'attached';
  if (!attached) return null;

  if (rescan.kind === 'failed') {
    return (
      <div className="s2-open-failure s2-rescan-strip" role="alert" data-testid="rescan-strip" data-state="failed">
        <span>{`The rescan did not finish: ${rescan.message}`}</span>
        <button type="button" className="s2-btn" data-testid="rescan-strip-button" onClick={() => void rescanNow(store)}>
          Rescan
        </button>
      </div>
    );
  }
  if (rescan.kind === 'running' && !auto) {
    return (
      <div className="s2-open-failure s2-rescan-strip" role="status" data-testid="rescan-strip" data-state="running">
        <AsciiSpinner />
        <span>Reading the project again</span>
      </div>
    );
  }
  if (stale && !auto && rescan.kind === 'idle') {
    return (
      <div className="s2-open-failure s2-rescan-strip" role="status" data-testid="rescan-strip" data-state="stale">
        <span>Files changed. The board and Files are out of date.</span>
        <button type="button" className="s2-btn" data-testid="rescan-strip-button" onClick={() => void rescanNow(store)}>
          Rescan
        </button>
      </div>
    );
  }
  return null;
}
