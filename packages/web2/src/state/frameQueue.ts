/* ══════════════════════════════════════════════════════════════════════════
   STREAM EVENTS, APPLIED ONCE PER FRAME (S6)
   packages/web2/src/state/frameQueue.ts

   A stream can deliver many events between two paints. Applying each one is
   a store update, and each update is a React commit, so a long reply spent
   the main thread re-rendering frames nobody saw. Events now wait in a queue
   that is applied, all at once and in order, on the next animation frame:
   one commit per frame however many events arrived.

   A hidden or minimised window gets no animation frames, so while
   `document.hidden` the queue drains on a ~250 ms timer instead. The queue
   therefore never holds more than that much, and a window that comes back
   does not apply one huge burst. When it becomes visible again the pending
   timer is replaced by the next frame.

   An urgent event (an approval, an error, the turn's end) is applied at once,
   after everything queued before it, so order is kept and nobody waits a
   frame to be asked something.
   ══════════════════════════════════════════════════════════════════════════ */

export const HIDDEN_DRAIN_MS = 250;
/** Where there is no requestAnimationFrame (a test, a worker): a frame's length. */
const FALLBACK_FRAME_MS = 16;

export interface FrameClock {
  frame(fn: () => void): unknown;
  cancelFrame(handle: unknown): void;
  timer(fn: () => void, ms: number): unknown;
  cancelTimer(handle: unknown): void;
  hidden(): boolean;
  /** Called when the window's visibility changes; returns the unsubscribe. */
  onVisibility(fn: () => void): () => void;
}

export function browserFrameClock(): FrameClock {
  const hasRaf = typeof requestAnimationFrame === 'function';
  const doc = typeof document !== 'undefined' ? document : null;
  return {
    frame: (fn) => (hasRaf ? requestAnimationFrame(() => fn()) : setTimeout(fn, FALLBACK_FRAME_MS)),
    cancelFrame: (h) => (hasRaf ? cancelAnimationFrame(h as number) : clearTimeout(h as ReturnType<typeof setTimeout>)),
    timer: (fn, ms) => setTimeout(fn, ms),
    cancelTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    hidden: () => doc?.hidden === true,
    onVisibility: (fn) => {
      if (!doc) return () => {};
      doc.addEventListener('visibilitychange', fn);
      return () => doc.removeEventListener('visibilitychange', fn);
    },
  };
}

export interface FrameQueue<T> {
  /** Queue one item; `urgent` applies it (and everything before it) now. */
  push(item: T, urgent?: boolean): void;
  /** Apply whatever is queued now (the stream ended, however it ended). */
  flush(): void;
  /** Items waiting for the next frame. */
  size(): number;
  dispose(): void;
}

/** `apply` receives every queued item, oldest first, once per frame (or per drain while hidden). */
export function createFrameQueue<T>(apply: (items: T[]) => void, clock: FrameClock = browserFrameClock()): FrameQueue<T> {
  let queue: T[] = [];
  let handle: { kind: 'frame' | 'timer'; h: unknown } | null = null;

  const cancel = (): void => {
    if (!handle) return;
    if (handle.kind === 'frame') clock.cancelFrame(handle.h);
    else clock.cancelTimer(handle.h);
    handle = null;
  };
  const flush = (): void => {
    cancel();
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    apply(items);
  };
  const schedule = (): void => {
    if (handle || queue.length === 0) return;
    handle = clock.hidden() ? { kind: 'timer', h: clock.timer(flush, HIDDEN_DRAIN_MS) } : { kind: 'frame', h: clock.frame(flush) };
  };
  /* Visible again: the 250 ms timer gives way to the next frame (and the other way round). */
  const off = clock.onVisibility(() => {
    if (!handle) return;
    cancel();
    schedule();
  });

  return {
    push(item, urgent = false) {
      queue.push(item);
      if (urgent) flush();
      else schedule();
    },
    flush,
    size: () => queue.length,
    dispose() {
      cancel();
      off();
      queue = [];
    },
  };
}
