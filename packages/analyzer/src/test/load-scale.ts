/**
 * HOW MUCH SLOWER IS THIS MACHINE THAN A QUIET ONE, RIGHT NOW.
 *
 * A wall-clock bound in a test is a claim about the code on an idle machine. The
 * counting gate runs four test files at once next to whatever other lanes are
 * running, so the same code takes 2x to 10x longer and a tight bound fails a
 * correct program. `loadScale()` times a fixed CPU workload (the best of three,
 * so one descheduled slice does not read as load) against the time it takes on
 * an idle machine and returns a factor >= 1. Bounds are written as
 * `base * loadScale()`: a quiet machine keeps the original bound exactly, and a
 * loaded one moves it with the load. A quadratic or blocking bug still misses
 * by orders of magnitude, not by the factor of 2 to 10 load adds.
 *
 * Measured at each call, never cached: load changes during a file's run.
 */
const IDLE_MS = 60; // the workload below on a quiet machine (best of many runs, 2026-10-12, Windows, Node 24)

function spin(): number {
  let x = 0;
  for (let i = 0; i < 6_000_000; i++) x = (x + Math.sqrt(i)) % 1000003;
  return x;
}

/** Past this the machine is not 'loaded', it is unusable; a bound that grows further would pass real regressions. */
const MAX_SCALE = 2.5;

export function loadScale(): number {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    spin();
    best = Math.min(best, performance.now() - t0);
  }
  const forced = Number(process.env.SEQUENCE_TEST_LOAD_SCALE);
  /* A forced value skips the cap: it exists to show that the hard ceilings in bound() hold at any load. */
  if (Number.isFinite(forced) && forced > 0) return forced;
  return Math.min(MAX_SCALE, Math.max(1, best / IDLE_MS));
}

/**
 * `base` scaled by load, but never above `ceiling`. The ceiling is the value of the regression the test
 * guards (a 4 s wait, an 8 s grace), so no load can make a bound loose enough to pass it.
 */
export function bound(base: number, ceiling: number): number {
  return Math.min(ceiling, base * loadScale());
}

/**
 * Wait until `ready()` holds, polling every 25 ms, for at most `ms` (default 20 s).
 * Returns whether it held. Replaces `sleep(N)` followed by an assertion: the fixed
 * sleep is a bet that N ms is enough, and on a loaded machine it is not. The caller
 * still makes the same assertion afterwards, so a state that never arrives still fails.
 */
export async function eventually(ready: () => boolean | Promise<boolean>, ms = 20_000): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      if (await ready()) return true;
    } catch {
      /* not there yet */
    }
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}
