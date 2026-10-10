/* ══════════════════════════════════════════════════════════════════════════
   S5, LOADED OFF THE BOOT PATH
   packages/web2/src/shell/LateBoot.tsx

   The attention watcher (AttentionHost) is not needed to draw the first
   frame, and the boot bundle is ratcheted (tools/measure/perf-ratchet.json).
   This stub loads it (LateHosts.tsx) once the app has settled, well after
   the boot window closes: a notification can wait 2.5 s. The keys cannot,
   and are eager (KeysHost.tsx in V3Shell). The watcher
   starts with `seed: 'runs'`, so an approval already waiting then is still
   announced once the window is in the background.
   ══════════════════════════════════════════════════════════════════════════ */

import { lazy, Suspense, useEffect, useState } from 'react';

const LateHosts = lazy(() => import('./LateHosts'));

export function LateBoot({ afterMs = 2500 }: { afterMs?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(setOn, afterMs, true);
    return () => clearTimeout(t);
  }, [afterMs]);
  return on ? (
    <Suspense>
      <LateHosts />
    </Suspense>
  ) : null;
}
