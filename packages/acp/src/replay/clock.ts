/* ══════════════════════════════════════════════════════════════════════════
   A CLOCK A TEST CAN MOVE, AND A WAIT THAT IS NOT A SLEEP
   packages/acp/src/replay/clock.ts

   T3 Code's rule (packages/shared/src/DrainableWorker.ts, AGENTS.md): tests
   wait for queues to drain, never for time to pass. A replay keeps the
   recorded gaps between frames (a long silent tool is a long gap) on a
   ManualClock, so a 25-second silence costs a test nothing and is still a
   25-second silence to anything that reads the clock.

   `settle()` yields to the event loop until nothing more happens: streams
   deliver their data, readline splits its lines, promise chains run. It is
   bounded and it never waits on wall time.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReplayClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** Time that moves only when told to. */
export class ManualClock implements ReplayClock {
  private t: number;
  private seq = 0;
  private timers: Timer[] = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const timer = { id: ++this.seq, at: this.t + Math.max(0, ms), fn };
    this.timers.push(timer);
    this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  /** Timers not yet fired. */
  get pending(): number {
    return this.timers.length;
  }

  /** When the next timer fires, or null. */
  nextAt(): number | null {
    return this.timers[0]?.at ?? null;
  }

  /** Move time forward by `ms`, firing every timer that comes due, in order. */
  advance(ms: number): void {
    this.advanceTo(this.t + ms);
  }

  advanceTo(at: number): void {
    for (;;) {
      const next = this.timers[0];
      if (!next || next.at > at) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = Math.max(this.t, at);
  }

  /** Fire the next timer only (moving time to it). False when none is pending. */
  step(): boolean {
    const next = this.timers[0];
    if (!next) return false;
    this.advanceTo(next.at);
    return true;
  }
}

/** The real clock, for a replay played at recorded speed (or as fast as possible with speed 0). */
export const systemClock: ReplayClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** One turn of the event loop: I/O callbacks and promise jobs run, no time passes. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Yield until `version()` stops changing for `quiet` consecutive turns.
 * `version` is any counter the caller bumps on activity.
 */
export async function settle(version: () => number, quiet = 3, maxTurns = 10_000): Promise<void> {
  let last = version();
  let still = 0;
  for (let i = 0; i < maxTurns; i++) {
    await tick();
    const v = version();
    if (v === last) {
      still += 1;
      if (still >= quiet) return;
    } else {
      last = v;
      still = 0;
    }
  }
  throw new Error(`settle: still busy after ${maxTurns} turns of the event loop`);
}
