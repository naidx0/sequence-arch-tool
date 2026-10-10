/* ══════════════════════════════════════════════════════════════════════════
   WHICH CLEAN SHAPE, IF ANY, A FREEHAND STROKE STANDS FOR
   packages/ink/src/shapeRecognize.ts

   `recognizeStroke` (index.ts) answers box / line / scribble with hand rules,
   and it has no notion of handwriting: a written "o" is a closed loop that
   fills its box, so it is a box. That is why the whiteboard keeps every stroke
   as raw ink — tidying would turn people's words into rectangles.

   This answers the question the whiteboard needs instead, with a small trained
   model (shapeBoost.ts) over stroke features (shapeFeatures.ts):

     rect | ellipse | diamond | connector   snap the stroke to this clean shape
     ink                                    leave it exactly as drawn

   `ink` is the default and the safe answer: handwriting, a piece of a shape
   drawn in several strokes, an arrowhead drawn on its own, a shape the board
   has no clean form for. A stroke snaps only when the model is at least
   `threshold` sure, so a wrong snap (the thing a person has to undo) is rarer
   than a missed one (the thing they never notice).

   Trained on DiDi (Google's Digital Ink Diagram data, CC BY 4.0): real people
   copying flowcharts by hand. See tools/bench/ink-shape-*.mjs and the study
   README for the sealed measurement.

   PURE. Points in, decision out.
   ══════════════════════════════════════════════════════════════════════════ */

import { boostPredict, type BoostModel } from './shapeBoost.js';
import { resample, shapeFeatures, SHAPE_FEATURE_NAMES, type P } from './shapeFeatures.js';
import { recognizeStroke } from './index.js';

/** What a stroke becomes on the board. */
export type ShapeDecision = 'rect' | 'ellipse' | 'diamond' | 'connector' | 'ink';
export const SHAPE_DECISIONS: readonly ShapeDecision[] = ['rect', 'ellipse', 'diamond', 'connector', 'ink'];

/**
 * The classes the model is trained on. Finer than the decision so the model
 * learns what handwriting and shape pieces look like rather than lumping them.
 */
export const SHAPE_CLASSES = ['rect', 'ellipse', 'diamond', 'arrow', 'text', 'part', 'other', 'connpart'] as const;
export type ShapeClass = (typeof SHAPE_CLASSES)[number];

/** Map a DiDi stroke label (tools/bench/ink-didi-label.mjs) to a training class. */
export function classOfLabel(label: string): ShapeClass | null {
  switch (label) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'text':
    case 'part':
      return label;
    case 'arrow':
    case 'line':
      return 'arrow';
    case 'parallelogram':
    case 'octagon':
      return 'other';
    case 'arrowhead':
    case 'shaft-part':
      return 'connpart';
    default:
      return null;
  }
}

export function decisionOfClass(c: string): ShapeDecision {
  switch (c) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
      return c;
    case 'arrow':
      return 'connector';
    default:
      return 'ink';
  }
}

export interface ShapeResult {
  decision: ShapeDecision;
  /** Probability of the chosen snap (or of the best snap, when the answer is ink). */
  confidence: number;
  /** For rect / ellipse / diamond: the box. For connector: tail → head. */
  from?: P;
  to?: P;
}

export interface RecognizeShapeOptions {
  /** Median bounding-box diagonal of the strokes already on the board. */
  boardDiag?: number;
  /** Snap only at or above this probability. */
  threshold?: number;
  /** When `points` joins several strokes: each stroke's bounding-box diagonal. */
  pieces?: readonly number[];
  /**
   * Multiplies the probability of `ink` before the decision is taken (default 1).
   * Training thins handwriting and adds many 'piece of a shape' rows, so the model
   * leans toward ink; a weight below 1 hands some of that back, chosen on DiDi
   * valid (shapeModelWeights.ts: SHAPE_INK_WEIGHT).
   */
  inkWeight?: number;
}

function geometry(points: readonly P[], decision: ShapeDecision): { from?: P; to?: P } {
  if (decision === 'ink' || points.length === 0) return {};
  if (decision === 'connector') {
    // Tail at the start, head at the point farthest from it: a head drawn after
    // the shaft doubles back, so the last point is not the tip.
    const R = resample(points, 64);
    let far = R[R.length - 1]!;
    let farD = -1;
    for (const p of R) {
      const d = Math.hypot(p.x - R[0]!.x, p.y - R[0]!.y);
      if (d > farD) {
        farD = d;
        far = p;
      }
    }
    return { from: { ...R[0]! }, to: { ...far } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { from: { x: minX, y: minY }, to: { x: maxX, y: maxY } };
}

/**
 * How many times the pen swings back the other way on its way from the tail to
 * the tip. A shaft is straight, bends one way (an arc) or swings back once (an S); a zigzag or
 * a wave swings again and again. The head is drawn after the tip, so it does not
 * count, and a pen that comes most of the way back to the tail after the tip
 * (the second leg of a "V" or an "N") was writing, not pointing: Infinity.
 * Without this the model, among small writing, read those as connectors.
 */
export function shaftSwings(points: readonly P[]): number {
  // Coarse enough that a hand's tremor on a short stroke is not a swing.
  let span = 0;
  for (const p of points) span = Math.max(span, Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y));
  const R = resample(points, Math.max(8, Math.min(24, Math.round(span / 10))));
  let farI = 0;
  let farD = -1;
  R.forEach((p, i) => {
    const d = Math.hypot(p.x - R[0]!.x, p.y - R[0]!.y);
    if (d > farD) [farD, farI] = [d, i];
  });
  if (!(farD > 0)) return Infinity;
  for (let i = farI + 1; i < R.length; i++) {
    if (Math.hypot(R[i]!.x - R[0]!.x, R[i]!.y - R[0]!.y) < 0.5 * farD) return Infinity;
  }
  // Signed turning, step by step; a bend is 0.8 rad (about 45 degrees) or more turned one way.
  let swings = 0;
  let acc = 0;
  let lastBend = 0;
  for (let i = 2; i <= farI; i++) {
    const a = Math.atan2(R[i - 1]!.y - R[i - 2]!.y, R[i - 1]!.x - R[i - 2]!.x);
    const b = Math.atan2(R[i]!.y - R[i - 1]!.y, R[i]!.x - R[i - 1]!.x);
    let d = b - a;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (acc !== 0 && Math.sign(d) !== Math.sign(acc)) acc = 0;
    acc += d;
    if (Math.abs(acc) >= 0.8) {
      const dir = Math.sign(acc);
      if (lastBend !== 0 && dir !== lastBend) swings += 1;
      lastBend = dir;
      acc = 0;
    }
  }
  return swings;
}

/** A connector's shaft may swing back at most this often (an S-curve swings once). */
export const MAX_SHAFT_SWINGS = 1;

/** The trained recognizer. `model` is the shipped one unless a caller retrained it. */
export function recognizeShapeWith(
  model: BoostModel,
  points: readonly P[],
  opts: RecognizeShapeOptions = {},
): ShapeResult {
  if (points.length < 3) return { decision: 'ink', confidence: 0 };
  const probs = boostPredict(model, shapeFeatures(points, opts.boardDiag, opts.pieces));
  const threshold = opts.threshold ?? DEFAULT_SNAP_THRESHOLD;
  // Sum class probabilities into decisions, so 'text' + 'part' + ... all vote ink.
  const byDecision = new Map<ShapeDecision, number>();
  model.classes.forEach((c, i) => {
    const d = decisionOfClass(c);
    byDecision.set(d, (byDecision.get(d) ?? 0) + probs[i]!);
  });
  const inkW = opts.inkWeight ?? 1;
  let best: ShapeDecision = 'ink';
  let bestP = -1;
  let bestScore = -1;
  for (const [d, p] of byDecision) {
    const score = d === 'ink' ? p * inkW : p;
    if (score > bestScore) {
      best = d;
      bestP = p;
      bestScore = score;
    }
  }
  if (best !== 'ink' && bestP < threshold) return { decision: 'ink', confidence: bestP };
  if (best === 'connector' && shaftSwings(points) > MAX_SHAFT_SWINGS) return { decision: 'ink', confidence: bestP };
  return { decision: best, confidence: bestP, ...geometry(points, best) };
}

/** Used when the caller passes none; the shipped value is `SHAPE_SNAP_THRESHOLD` (shapeModel.ts). */
const DEFAULT_SNAP_THRESHOLD = 0.5;

/* ── THE BASELINES THE MODEL IS MEASURED AGAINST ─────────────────────────── */

/** Today's recognizer, read in the decision vocabulary: box → rect, line → connector. */
export function decideByRecognizeStroke(points: readonly P[]): ShapeDecision {
  const r = recognizeStroke(points.map((p) => ({ x: p.x, y: p.y })));
  return r.kind === 'box' ? 'rect' : r.kind === 'line' ? 'connector' : 'ink';
}

/** Knobs of the extended hand rules; tuned on the training split only. */
export interface RulesV2Params {
  /** Strokes smaller than this fraction of the board's median stroke are ink (handwriting). */
  minRel: number;
  /** An open stroke is an arrow when its farthest-from-start point is at least this far along it... */
  arrowFarIdx: number;
  /** ...and the pen ends within this fraction of the stroke's diagonal of that tip. */
  arrowBack: number;
}

export const RULES_V2_DEFAULT: RulesV2Params = { minRel: 0, arrowFarIdx: 0.6, arrowBack: 0.35 };

const FI = Object.fromEntries(SHAPE_FEATURE_NAMES.map((n, i) => [n, i])) as Record<(typeof SHAPE_FEATURE_NAMES)[number], number>;

/**
 * Rules v2: the best hand rules I could write in an afternoon, as a fair
 * opponent. recognizeStroke, plus: a size gate against handwriting, the box
 * split into rect / ellipse / diamond by which outline fits best, and an
 * arrow rule for an open stroke whose head doubles back near its tip.
 */
export function decideByRulesV2(points: readonly P[], boardDiag: number | undefined, p: RulesV2Params): ShapeDecision {
  const f = shapeFeatures(points, boardDiag);
  if (boardDiag && boardDiag > 0 && f[FI.logRelDiag]! < Math.log(Math.max(p.minRel, 1e-9))) return 'ink';
  const base = decideByRecognizeStroke(points);
  if (base === 'rect') {
    const e = f[FI.resEllipse]!;
    const b = f[FI.resBox]!;
    const d = f[FI.resDiamond]!;
    if (b <= e && b <= d) return 'rect';
    if (e <= d) return 'ellipse';
    return 'diamond';
  }
  if (base === 'connector') return 'connector';
  if (points.length >= 3 && f[FI.farIdx]! >= p.arrowFarIdx && f[FI.farToEnd]! <= p.arrowBack && f[FI.closure]! > 0.3) {
    return 'connector';
  }
  return 'ink';
}
