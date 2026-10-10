/* Shared metric helpers for the ink shape study (train, eval). */
import { decisionOfClass } from '../../packages/ink/dist/shapeRecognize.js';

export const DECISIONS = ['rect', 'ellipse', 'diamond', 'connector', 'ink'];

export function truthDecision(row) {
  return decisionOfClass(row.cls);
}

/** Metrics over parallel arrays of truth and predicted decisions. */
export function metrics(truth, pred) {
  const n = truth.length;
  let correct = 0;
  let wrongSnap = 0;
  let snapTruth = 0;
  let snapHit = 0;
  const f1 = {};
  for (let i = 0; i < n; i++) {
    if (truth[i] === pred[i]) correct++;
    if (pred[i] !== 'ink' && pred[i] !== truth[i]) wrongSnap++;
    if (truth[i] !== 'ink') {
      snapTruth++;
      if (pred[i] === truth[i]) snapHit++;
    }
  }
  let macro = 0;
  for (const d of DECISIONS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i++) {
      if (pred[i] === d && truth[i] === d) tp++;
      else if (pred[i] === d) fp++;
      else if (truth[i] === d) fn++;
    }
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    f1[d] = { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0, n: tp + fn };
    macro += f1[d].f1;
  }
  return {
    n,
    macroF1: macro / DECISIONS.length,
    accuracy: correct / n,
    wrongSnapRate: wrongSnap / n,
    snapRecall: snapTruth ? snapHit / snapTruth : 0,
    perDecision: f1,
  };
}

/** Deterministic PRNG for the bootstrap. */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster bootstrap by drawing: resample whole drawings (a person's strokes in
 * one drawing are not independent). Returns the SE of `stat(truth, predA) -
 * stat(truth, predB)` and of each side.
 */
export function bootstrapDiff(keys, truth, predA, predB, stat, reps = 1000, seed = 7) {
  const byKey = new Map();
  keys.forEach((k, i) => {
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  });
  const clusters = [...byKey.values()];
  const rnd = mulberry32(seed);
  const diffs = [];
  for (let r = 0; r < reps; r++) {
    const t = [];
    const a = [];
    const b = [];
    for (let c = 0; c < clusters.length; c++) {
      const idx = clusters[Math.floor(rnd() * clusters.length)];
      for (const i of idx) {
        t.push(truth[i]);
        a.push(predA[i]);
        b.push(predB[i]);
      }
    }
    diffs.push(stat(t, a) - stat(t, b));
  }
  const mean = diffs.reduce((x, y) => x + y, 0) / reps;
  const sd = Math.sqrt(diffs.reduce((x, y) => x + (y - mean) ** 2, 0) / (reps - 1));
  return { mean, se: sd, clusters: clusters.length };
}
