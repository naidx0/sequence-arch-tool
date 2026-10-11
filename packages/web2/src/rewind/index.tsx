/* The rewind lane's door. The overlay host imports the panel from here.

   THE PANEL LOADS WHEN IT OPENS, not at boot (perf ratchet, bootJsBytes):
   `RewindPanel` here is a lazy wrapper with the same props, so the host's
   import is unchanged. The model is not re-exported for the same reason;
   tests import it from './rewindModel' directly. */
import { lazy, Suspense } from 'react';

import type { RewindPanelProps } from './RewindPanel';

const Panel = lazy(() => import('./RewindPanel.js').then((m) => ({ default: m.RewindPanel })));

export function RewindPanel(props: RewindPanelProps) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}

export type { RewindPanelProps } from './RewindPanel';
