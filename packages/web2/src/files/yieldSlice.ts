/* ══════════════════════════════════════════════════════════════════════════
   SLICED WORK — a long pure build that hands the main thread back often
   packages/web2/src/files/yieldSlice.ts

   Opening Files built the function index and the file tree in one call each (120 ms and
   84 ms at 4x CPU throttle, with nothing yielding between them), so the first open dropped
   whole frames. A build written as a generator that `yield`s at cheap points can run to the
   end at once (`runSync`, byte-for-byte the old behaviour) or be driven by `runSliced`,
   which gives the thread back whenever about SLICE_MS of work has gone by.
   ══════════════════════════════════════════════════════════════════════════ */

/** How much work one slice may do before the main thread is handed back (under half a 60 Hz frame). */
export const SLICE_MS = 8;

export type Steps<T> = Generator<void, T, void>;

export interface SliceOptions {
  /** Work allowed between two yields. */
  budgetMs?: number;
  /** The clock; a fake in tests. */
  now?: () => number;
  /** What hands the thread back; a spy in tests. */
  yieldFn?: () => Promise<void>;
  /** An abort between slices rejects with an AbortError. */
  signal?: AbortSignal;
}

/** scheduler.yield where the browser has it, else a MessageChannel turn, else a timer. */
export function yieldToMain(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> }; MessageChannel?: typeof MessageChannel };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof g.MessageChannel === 'function') {
    return new Promise<void>((resolve) => {
      const channel = new g.MessageChannel!();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Run the steps to the end without ever yielding: the plain synchronous answer. */
export function runSync<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Run the steps, handing the thread back whenever `budgetMs` of work has gone by. Same result as `runSync`. */
export async function runSliced<T>(steps: Steps<T>, opts: SliceOptions = {}): Promise<T> {
  const budget = opts.budgetMs ?? SLICE_MS;
  const now = opts.now ?? (() => performance.now());
  const give = opts.yieldFn ?? yieldToMain;
  let sliceStart = now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (now() - sliceStart >= budget) {
      await give();
      if (opts.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      sliceStart = now();
    }
  }
}
