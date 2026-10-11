/* The shipped shape recognizer: the trained weights plus the snap threshold,
   both chosen on DiDi's train / validation splits (tools/bench/ink-shape-train.mjs).
   Regenerate shapeModelWeights.ts with that script; never edit it by hand. */
import { SHAPE_MODEL, SHAPE_SNAP_THRESHOLD } from './shapeModelWeights.js';
import { recognizeShapeWith, type RecognizeShapeOptions, type ShapeResult } from './shapeRecognize.js';
import type { P } from './shapeFeatures.js';

export { SHAPE_MODEL, SHAPE_SNAP_THRESHOLD };

export function recognizeShape(points: readonly P[], opts: RecognizeShapeOptions = {}): ShapeResult {
  return recognizeShapeWith(SHAPE_MODEL, points, { threshold: SHAPE_SNAP_THRESHOLD, ...opts });
}
