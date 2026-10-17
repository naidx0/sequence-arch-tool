/* ══════════════════════════════════════════════════════════════════════════
   THE SWITCH PANEL (019-progress)
   packages/web2/src/sessions/SwitchProgress.tsx

   A small corner panel while another workspace is being opened: the folder, "Reading N of M files…", a bar. It does
   not cover the app (the old repo stays usable while the new one is read). A refusal replaces it with a plain
   sentence for a few seconds. The loader and the line are the boot surface's own.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

import { ActivityLoader } from '../shell2/ActivityLoader';
import { useStoreIfAny } from '../state/connect';
import { scanningLine } from '../boot/bootSequence';
import { useSwitchProgress } from './attachProgress';
import '../boot/boot.css';

const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const never = (): (() => void) => () => {};

export function SwitchProgress() {
  const s = useSwitchProgress();
  const store = useStoreIfAny();
  /* The Open project dialog prints the same progress itself (boot/AttachDialog.tsx): not twice. */
  const dialogOpen = useSyncExternalStore(store ? store.subscribe : never, () => store?.getState().shell.overlay?.kind === 'attach', () => false);
  if (!s) return null;
  if (s.kind === 'attaching' && dialogOpen) return null;
  if (s.kind === 'failed') {
    return (
      <div className="switch-progress switch-progress-failed" role="alert" data-testid="switch-progress-failed">
        <p className="switch-progress-t">{`Could not open ${folderName(s.path)}`}</p>
        <p className="switch-progress-n">{s.message}</p>
      </div>
    );
  }
  const pct = s.total > 0 ? Math.min(1, s.done / s.total) : null;
  return (
    <div className="switch-progress" role="status" aria-live="polite" data-testid="switch-progress">
      <ActivityLoader variant="cell" />
      <div className="switch-progress-body">
        <p className="switch-progress-t">{`Opening ${folderName(s.path)}`}</p>
        <p className="switch-progress-n" data-testid="switch-progress-line">
          {scanningLine({ done: s.done, total: s.total, path: s.path })}
        </p>
        {pct !== null ? <progress className="switch-progress-bar" max={1} value={pct} aria-label="Files read" /> : null}
      </div>
    </div>
  );
}
