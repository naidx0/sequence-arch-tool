/* ══════════════════════════════════════════════════════════════════════════
   A MOUSE (OR TRACKPAD) HAND, FOR TESTS
   packages/ink/src/mouseSim.ts

   The shape model learned from a pen on a tablet. People on Sequence draw with
   a mouse or a trackpad: sparse samples when they move fast, whole-pixel
   positions, a hand that wanders a little and cuts corners. This turns a clean
   outline into the stroke such a hand would leave, so a test can ask whether
   the recognizer still reads it. Deterministic (seeded).

   Not exported from the package index: test support only.
   ══════════════════════════════════════════════════════════════════════════ */

import type { P } from './shapeFeatures.js';

export interface MouseOptions {
  /** Distance between samples in px: ~3 slow, ~10 normal, ~30 a fast flick. */
  pxPerSample: number;
  /** White jitter in px (a steady mouse ~0.4, a trackpad on a lap ~1.5). */
  jitter: number;
  seed?: number;
  /** Fraction of a closed outline actually drawn before the pen lifts (0.97 leaves a small gap; 1.04 overshoots). */
  drawn?: number;
}

export interface TimedP extends P {
  t: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lengthOf(path: readonly P[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return n;
}

function at(path: readonly P[], s: number): P {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + d >= s || i === path.length - 1) {
      const u = d > 0 ? Math.min(1, Math.max(0, (s - acc) / d)) : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    acc += d;
  }
  return { ...path[path.length - 1]! };
}

/** The clean outline as the stroke a mouse hand would draw, with a 60 Hz clock. */
export function mouseStroke(outline: readonly P[], o: MouseOptions, startMs = 0): TimedP[] {
  const rand = rng(o.seed ?? 1);
  const total = lengthOf(outline) * (o.drawn ?? 1);
  const diag = Math.hypot(
    Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x)),
    Math.max(...outline.map((p) => p.y)) - Math.min(...outline.map((p) => p.y)),
  );
  // A slow wander of the whole hand: two sines a little over 1% of the size.
  const amp = 0.012 * diag;
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  const out: TimedP[] = [];
  let s = 0;
  let t = startMs;
  let last: P | null = null;
  while (s <= total + 1e-6) {
    const base = at(outline, Math.min(s, lengthOf(outline)));
    const wander = {
      x: amp * Math.sin((s / diag) * 5.1 + p1) + 0.5 * amp * Math.sin((s / diag) * 13 + p2),
      y: amp * Math.cos((s / diag) * 4.3 + p2) + 0.5 * amp * Math.sin((s / diag) * 11 + p1),
    };
    const p = {
      x: Math.round(base.x + wander.x + (rand() - 0.5) * 2 * o.jitter),
      y: Math.round(base.y + wander.y + (rand() - 0.5) * 2 * o.jitter),
    };
    if (!last || p.x !== last.x || p.y !== last.y) {
      out.push({ ...p, t: Math.round(t - startMs) });
      last = p;
    }
    // Speed varies by +-40% from sample to sample; the clock ticks at 60 Hz with a little slop.
    s += o.pxPerSample * (0.6 + 0.8 * rand());
    t += 16.7 + (rand() - 0.5) * 4;
  }
  return out;
}

/** Clean outlines the tests draw. */
export const outlines = {
  rect(x: number, y: number, w: number, h: number): P[] {
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
  },
  ellipse(cx: number, cy: number, a: number, b: number, n = 72): P[] {
    return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + a * Math.cos((i / n) * 2 * Math.PI), y: cy + b * Math.sin((i / n) * 2 * Math.PI) }));
  },
  diamond(cx: number, cy: number, a: number, b: number): P[] {
    return [{ x: cx, y: cy - b }, { x: cx + a, y: cy }, { x: cx, y: cy + b }, { x: cx - a, y: cy }, { x: cx, y: cy - b }];
  },
  arrow(x0: number, y0: number, x1: number, y1: number): P[] {
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const head = 0.14 * Math.hypot(x1 - x0, y1 - y0);
    const barb = (da: number): P => ({ x: x1 - head * Math.cos(ang + da), y: y1 - head * Math.sin(ang + da) });
    return [{ x: x0, y: y0 }, { x: x1, y: y1 }, barb(0.45), { x: x1, y: y1 }, barb(-0.45)];
  },
  line(x0: number, y0: number, x1: number, y1: number): P[] {
    return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  },
};
