/* The shape recognizer WITHOUT its weights (`@sequence/ink/shape`).
   The weights are ~170 KB of numbers and only a person who draws needs them, so
   they live behind their own entry (`@sequence/ink/shape-model`) that an app
   loads with a dynamic import() after the first stroke, never at boot. */
export { shapeFeatures, SHAPE_FEATURE_NAMES, SHAPE_FEATURE_COUNT, medianDiag, resample, type P } from './shapeFeatures.js';
export { boostPredict, type BoostModel } from './shapeBoost.js';
export {
  SHAPE_CLASSES,
  SHAPE_DECISIONS,
  recognizeShapeWith,
  type RecognizeShapeOptions,
  type ShapeDecision,
  type ShapeResult,
} from './shapeRecognize.js';
export {
  GROUP_IDLE_MS,
  GROUP_SNAP_THRESHOLD,
  GROUP_MAX_PENDING,
  GROUP_MAX_GAP,
  candidateRuns,
  clusterStrokes,
  decideGroup,
  decidesAtOnce,
  joinRun,
  joinsPending,
  runGapFrac,
  settleStrokes,
  type GroupOptions,
  type GroupStroke,
  type GroupVerdict,
  type Recognizer,
} from './shapeGroup.js';
