/* TEST-ONLY, off unless localStorage 'sequence.bench.blockMs' holds a number: tools/bench/client sets it from
   SEQUENCE_BENCH_BLOCK_MS to prove its overlay-open timing sees a main-thread block (its negative control).
   It lives in LateHosts (loaded after the first frame), not in V3OverlayHost, so it adds nothing to the boot chunk. */
import { useLayoutEffect } from 'react';

import { useAppState } from '../state/connect';

export function BenchOverlayBlock() {
  const kind = useAppState().shell.overlay?.kind;
  useLayoutEffect(() => {
    if (!kind) return;
    let ms = 0;
    try { ms = Number(localStorage.getItem('sequence.bench.blockMs')) || 0; } catch { /* no storage */ }
    for (const end = performance.now() + Math.min(ms, 2000); ms > 0 && performance.now() < end; ) { /* busy */ }
  }, [kind]);
  return null;
}
