import { describe, expect, it } from 'vitest';

import { createFrameQueue, HIDDEN_DRAIN_MS, type FrameClock } from './frameQueue';

/** A manual clock: frames run when `paint()` is called, timers when time is advanced. */
function fakeClock() {
  let now = 0;
  let hidden = false;
  let seq = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; fn: () => void }>();
  const vis = new Set<() => void>();
  const clock: FrameClock = {
    frame: (fn) => {
      const h = ++seq;
      frames.set(h, fn);
      return h;
    },
    cancelFrame: (h) => void frames.delete(h as number),
    timer: (fn, ms) => {
      const h = ++seq;
      timers.set(h, { at: now + ms, fn });
      return h;
    },
    cancelTimer: (h) => void timers.delete(h as number),
    hidden: () => hidden,
    onVisibility: (fn) => {
      vis.add(fn);
      return () => vis.delete(fn);
    },
  };
  return {
    clock,
    /** A browser paints only while visible. */
    paint() {
      if (hidden) return;
      const due = [...frames.values()];
      frames.clear();
      for (const fn of due) fn();
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
    setHidden(h: boolean) {
      hidden = h;
      for (const fn of vis) fn();
    },
    pendingFrames: () => frames.size,
  };
}

describe('stream events applied once per frame', () => {
  it('applies everything that arrived before a frame in one batch, in order', () => {
    const c = fakeClock();
    const batches: number[][] = [];
    const q = createFrameQueue<number>((items) => batches.push(items), c.clock);
    for (let i = 0; i < 40; i++) q.push(i);
    expect(batches).toEqual([]);
    expect(c.pendingFrames()).toBe(1);
    c.paint();
    expect(batches).toEqual([Array.from({ length: 40 }, (_, i) => i)]);
    c.paint();
    expect(batches.length).toBe(1);
  });

  it('an urgent item goes at once, after what was queued before it', () => {
    const c = fakeClock();
    const batches: string[][] = [];
    const q = createFrameQueue<string>((items) => batches.push(items), c.clock);
    q.push('a');
    q.push('b');
    q.push('approval', true);
    expect(batches).toEqual([['a', 'b', 'approval']]);
    expect(c.pendingFrames()).toBe(0);
  });

  it('while the window is hidden the queue drains on a 250 ms timer, so coming back is not one huge burst', () => {
    const c = fakeClock();
    const batches: number[][] = [];
    const q = createFrameQueue<number>((items) => batches.push(items), c.clock);
    c.setHidden(true);
    /* Just over two seconds of a stream at one event per 10 ms, with no frames at all. */
    let n = 0;
    for (let t = 0; t < 2100; t += 10) {
      q.push(n++);
      c.paint();
      c.advance(10);
    }
    expect(batches.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(HIDDEN_DRAIN_MS / 10 + 1);
    expect(batches.flat()).toEqual(Array.from({ length: n - q.size() }, (_, i) => i));
    /* Back: what is left is at most one drain's worth, and it goes on the next frame. */
    const left = q.size();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(HIDDEN_DRAIN_MS / 10 + 1);
    c.setHidden(false);
    c.paint();
    expect(q.size()).toBe(0);
    expect(batches[batches.length - 1]!.length).toBe(left);
    expect(batches.flat()).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('hidden with no timer pending: nothing is scheduled until something arrives; flush and dispose leave nothing behind', () => {
    const c = fakeClock();
    const batches: number[][] = [];
    const q = createFrameQueue<number>((items) => batches.push(items), c.clock);
    c.setHidden(true);
    c.setHidden(false);
    expect(c.pendingFrames()).toBe(0);
    q.push(1);
    q.flush();
    expect(batches).toEqual([[1]]);
    q.push(2);
    q.dispose();
    c.paint();
    c.advance(1000);
    expect(batches).toEqual([[1]]);
  });
});
