/* ══════════════════════════════════════════════════════════════════════════
   A BOX DRAWN IN SEVERAL STROKES IS ONE BOX
   packages/ink/src/shapeGroup.ts

   `recognizeShape` judges one stroke. People do not always draw one stroke per
   shape: a box is often four sides, an ellipse two halves. Judged one at a
   time, each side is a straight line and snaps to a connector (862 of the 880
   wrong snaps on DiDi's test split were exactly that).

   So the whiteboard does not decide when the pen lifts. It keeps the strokes
   of the last moment in a PENDING window, and decides when the pen has rested
   (GROUP_IDLE_MS) or when nothing more could join. Deciding means:

     1. look for runs of 2+ neighbouring pending strokes that, joined end to
        end, the model reads as ONE rect / ellipse / diamond;
     2. every stroke left over is judged alone, as before.

   Handwriting never joins: a word's letters, joined, are not a clean outline,
   and the model has `ink` for them.

   PURE. The recognizer is passed in (so this file never imports the weights,
   which the app loads lazily); times are plain numbers in milliseconds.
   ══════════════════════════════════════════════════════════════════════════ */

import type { P } from './shapeFeatures.js';
import { medianDiag } from './shapeFeatures.js';
import type { RecognizeShapeOptions, ShapeDecision, ShapeResult } from './shapeRecognize.js';

export type Recognizer = (points: readonly P[], opts: RecognizeShapeOptions) => ShapeResult;

export interface GroupStroke {
  id: number | string;
  points: readonly P[];
  /** Pen-down and pen-up times, milliseconds on any common clock. */
  t0: number;
  t1: number;
}

export interface GroupVerdict {
  /** The strokes this verdict covers, in draw order. One id for a lone stroke. */
  ids: (number | string)[];
  decision: ShapeDecision;
  confidence: number;
  from?: P;
  to?: P;
}

export interface GroupOptions {
  recognize: Recognizer;
  /** Median bounding-box diagonal of the strokes on the board before the pending ones. */
  boardDiag?: number;
  /** A joined run snaps at or above this probability (default GROUP_SNAP_THRESHOLD). */
  threshold?: number;
  idleMs?: number;
  /** Longest run of strokes tried as one shape (1 turns grouping off). */
  maxRun?: number;
}

/**
 * A joined run snaps at or above this probability (a lone stroke uses the model's own
 * threshold). Chosen on DiDi valid: end-to-end macro-F1 is flat from 0.7 to 0.95 and
 * highest at 0.8; fewer wrong snaps come from raising it, fewer boxes from lowering it.
 */
export const GROUP_SNAP_THRESHOLD = 0.8;

/** How long the pen rests before pending strokes are decided. */
export const GROUP_IDLE_MS = 900;
const MAX_RUN = 8;
/** The pending window never holds more than this many strokes (the oldest are decided first). */
export const GROUP_MAX_PENDING = 24;
const CLOSED = new Set<ShapeDecision>(['rect', 'ellipse', 'diamond']);

function bounds(points: readonly P[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Would `next` belong to the same moment of drawing as the pending strokes? */
export function joinsPending(pending: readonly GroupStroke[], next: GroupStroke, idleMs = GROUP_IDLE_MS): boolean {
  if (pending.length === 0) return false;
  const last = pending[pending.length - 1]!;
  if (next.t0 - last.t1 > idleMs) return false;
  const all: P[] = [];
  for (const s of pending) for (const p of s.points) all.push(p);
  const u = bounds(all);
  const n = bounds(next.points);
  const diag = Math.max(Math.hypot(u.x1 - u.x0, u.y1 - u.y0), Math.hypot(n.x1 - n.x0, n.y1 - n.y0));
  const gapX = Math.max(0, u.x0 - n.x1, n.x0 - u.x1);
  const gapY = Math.max(0, u.y0 - n.y1, n.y0 - u.y1);
  return Math.hypot(gapX, gapY) <= 0.35 * diag;
}

/** True when pending is a lone, confidently closed shape: nothing can join it, so decide now. */
export function decidesAtOnce(pending: readonly GroupStroke[], opts: GroupOptions): boolean {
  if (pending.length !== 1) return false;
  const r = opts.recognize(pending[0]!.points, { boardDiag: opts.boardDiag });
  return CLOSED.has(r.decision);
}

function dist(a: P, b: P): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Strokes joined in draw order. */
function joinInOrder(run: readonly GroupStroke[]): P[] {
  const out: P[] = [];
  for (const s of run) for (const p of s.points) out.push(p);
  return out;
}

/** Strokes joined by nearest endpoint, flipping a stroke when its far end is nearer. */
function joinByChain(run: readonly GroupStroke[]): P[] {
  const left = run.slice(1).map((s) => s.points);
  const out: P[] = [...run[0]!.points];
  while (left.length > 0) {
    const tail = out[out.length - 1]!;
    let bi = 0;
    let bd = Infinity;
    let flip = false;
    left.forEach((pts, i) => {
      const a = dist(tail, pts[0]!);
      const b = dist(tail, pts[pts.length - 1]!);
      if (a < bd) [bi, bd, flip] = [i, a, false];
      if (b < bd) [bi, bd, flip] = [i, b, true];
    });
    const pts = left.splice(bi, 1)[0]!;
    for (const p of flip ? [...pts].reverse() : pts) out.push(p);
  }
  return out;
}

/**
 * The largest pen jump between a run's strokes when they are laid end to end by
 * nearest ends, as a share of the run's size. The sides of one box meet (or
 * nearly); strokes from two separate shapes need a jump across the gap between
 * them, so a run with a big jump is never read as one shape.
 */
export function runGapFrac(run: readonly GroupStroke[]): number {
  if (run.length < 2) return 0;
  const left = run.slice(1).map((s) => s.points);
  let head = run[0]!.points[0]!;
  let tail = run[0]!.points[run[0]!.points.length - 1]!;
  let worst = 0;
  while (left.length > 0) {
    // Attach the stroke with the nearest end to either open end of the chain.
    let bi = 0;
    let bd = Infinity;
    let next: { head: P; tail: P } = { head, tail };
    left.forEach((pts, i) => {
      const s0 = pts[0]!;
      const s1 = pts[pts.length - 1]!;
      const options: [number, { head: P; tail: P }][] = [
        [dist(tail, s0), { head, tail: s1 }],
        [dist(tail, s1), { head, tail: s0 }],
        [dist(head, s1), { head: s0, tail }],
        [dist(head, s0), { head: s1, tail }],
      ];
      for (const [d, ends] of options) if (d < bd) [bi, bd, next] = [i, d, ends];
    });
    left.splice(bi, 1);
    worst = Math.max(worst, bd);
    ({ head, tail } = next);
  }
  const d = diagOf(joinInOrder(run));
  return d > 0 ? worst / d : Infinity;
}

/** A run whose strokes jump more than this share of its size apart is not one shape. */
export const GROUP_MAX_GAP = 0.2;

function diagOf(points: readonly P[]): number {
  const b = bounds(points);
  return Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
}

/** Every contiguous run of 2..maxRun pending strokes: [start, length]. Longest first. */
export function candidateRuns(n: number, maxRun = MAX_RUN): [number, number][] {
  const out: [number, number][] = [];
  for (let len = Math.min(maxRun, n); len >= 2; len--) for (let start = 0; start + len <= n; start++) out.push([start, len]);
  return out;
}

/** The two ways a run's strokes are laid end to end (draw order, nearest ends). */
export function joinRun(run: readonly GroupStroke[]): P[][] {
  return [joinInOrder(run), joinByChain(run)];
}

/**
 * Split a drawing into the moments the pen was working in: a stroke joins the
 * previous moment if it came soon enough and close enough (`joinsPending`).
 */
export function clusterStrokes<T extends GroupStroke>(strokes: readonly T[], idleMs = GROUP_IDLE_MS): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const s of strokes) {
    if (cur.length > 0 && (!joinsPending(cur, s, idleMs) || cur.length >= GROUP_MAX_PENDING)) {
      out.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Decide the pending strokes. Returns one verdict per group, in draw order of
 * each group's first stroke; every pending stroke appears in exactly one.
 */
export function decideGroup(pending: readonly GroupStroke[], opts: GroupOptions): GroupVerdict[] {
  const n = pending.length;
  const recognize = opts.recognize;
  const base: RecognizeShapeOptions = { boardDiag: opts.boardDiag };
  const single = pending.map((s) => recognize(s.points, base));
  const used = new Array<boolean>(n).fill(false);
  const verdicts: { first: number; v: GroupVerdict }[] = [];
  const diags = pending.map((s) => diagOf(s.points));

  for (const [start, len] of candidateRuns(n, opts.maxRun ?? MAX_RUN)) {
    let free = true;
    for (let k = start; k < start + len; k++) if (used[k]) free = false;
    if (!free) continue;
    // A run that already holds a complete shape is that shape plus something else.
    let holdsShape = false;
    for (let k = start; k < start + len; k++) if (CLOSED.has(single[k]!.decision)) holdsShape = true;
    if (holdsShape) continue;
    const run = pending.slice(start, start + len);
    if (runGapFrac(run) > GROUP_MAX_GAP) continue;
    let best: ShapeResult | null = null;
    for (const joined of joinRun(run)) {
      const r = recognize(joined, {
        ...base,
        pieces: diags.slice(start, start + len),
        threshold: opts.threshold ?? GROUP_SNAP_THRESHOLD,
      });
      if (CLOSED.has(r.decision) && (!best || r.confidence > best.confidence)) best = r;
    }
    if (!best) continue;
    for (let k = start; k < start + len; k++) used[k] = true;
    verdicts.push({
      first: start,
      v: { ids: run.map((s) => s.id), decision: best.decision, confidence: best.confidence, from: best.from, to: best.to },
    });
  }
  for (let k = 0; k < n; k++) {
    if (used[k]) continue;
    const r = single[k]!;
    verdicts.push({ first: k, v: { ids: [pending[k]!.id], decision: r.decision, confidence: r.confidence, from: r.from, to: r.to } });
  }
  verdicts.sort((a, b) => a.first - b.first);
  return verdicts.map((x) => x.v);
}

/**
 * Replay a whole drawing the way the whiteboard sees it: strokes arrive in
 * order, pending strokes are decided after a rest, when the next stroke cannot
 * join, or at once for a lone closed shape. The app and the benchmark both
 * call this, so what is measured is what ships.
 */
export function settleStrokes(strokes: readonly GroupStroke[], recognize: Recognizer, extra: Partial<GroupOptions> = {}): GroupVerdict[] {
  const out: GroupVerdict[] = [];
  let pending: GroupStroke[] = [];
  const before: (readonly P[])[] = [];
  let pendingBase = 0;
  const boardDiagOf = (): number | undefined => (pendingBase > 0 ? medianDiag(before.slice(0, pendingBase)) : undefined);
  const flush = (): void => {
    if (pending.length === 0) return;
    out.push(...decideGroup(pending, { recognize, boardDiag: boardDiagOf(), ...extra }));
    pending = [];
    pendingBase = before.length;
  };
  for (const s of strokes) {
    if (pending.length > 0 && (!joinsPending(pending, s, extra.idleMs) || pending.length >= GROUP_MAX_PENDING)) flush();
    pending.push(s);
    before.push(s.points);
    if (decidesAtOnce(pending, { recognize, boardDiag: boardDiagOf(), ...extra })) flush();
  }
  flush();
  return out;
}
