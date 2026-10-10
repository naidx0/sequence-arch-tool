/* ══════════════════════════════════════════════════════════════════════════
   A SMALL MULTICLASS GRADIENT-BOOSTED TREE MODEL, PURE TYPESCRIPT
   packages/ink/src/shapeBoost.ts

   The same family as the file ranker (LightGBM-style histogram trees), with a
   softmax objective instead of LambdaRank: one tree per class per round, fit
   to the gradient of the cross-entropy, leaves set by one Newton step.

   CPU only, no dependencies, deterministic (no sampling). Trains on ~50k rows
   x 32 features in seconds; predicts one stroke in microseconds. The model is
   plain JSON so it can ship inside the package and be retrained per user.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TreeNode {
  /** Leaf value when `f` is -1. */
  v: number;
  f: number;
  t: number;
  l: number;
  r: number;
}

/**
 * A tree packed into one number array, root at offset 0. A split is
 * `[feature, threshold, leftOffset, rightOffset]`; a leaf is `[-1, value]`.
 * Packed because the model ships inside the app: an object per node was five
 * times the bytes.
 */
export type PackedTree = number[];

export interface BoostModel {
  version: 1;
  classes: string[];
  features: string[];
  /** Per-class prior (log of class frequency). */
  base: number[];
  lr: number;
  /** trees[round][class]. */
  trees: PackedTree[][];
}

export function packTree(nodes: TreeNode[]): PackedTree {
  const out: number[] = [];
  const emit = (i: number): number => {
    const n = nodes[i]!;
    const at = out.length;
    if (n.f < 0) {
      out.push(-1, n.v);
      return at;
    }
    out.push(n.f, n.t, 0, 0);
    const l = emit(n.l);
    const r = emit(n.r);
    out[at + 2] = l;
    out[at + 3] = r;
    return at;
  };
  emit(0);
  return out;
}

export interface BoostOptions {
  rounds: number;
  lr: number;
  maxDepth: number;
  minLeaf: number;
  bins: number;
  lambda: number;
  /** Called after each round with the round index; return false to stop. */
  onRound?: (round: number, model: BoostModel) => boolean | void;
}

export const DEFAULT_BOOST: BoostOptions = { rounds: 80, lr: 0.15, maxDepth: 4, minLeaf: 20, bins: 48, lambda: 1 };

function treeValue(t: PackedTree, x: readonly number[]): number {
  let o = 0;
  for (;;) {
    const f = t[o]!;
    if (f < 0) return t[o + 1]!;
    o = x[f]! <= t[o + 1]! ? t[o + 2]! : t[o + 3]!;
  }
}

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function boostScores(model: BoostModel, x: readonly number[]): number[] {
  const z = model.base.slice();
  for (const round of model.trees) {
    for (let c = 0; c < z.length; c++) z[c]! += model.lr * treeValue(round[c]!, x);
  }
  return z;
}

export function boostPredict(model: BoostModel, x: readonly number[]): number[] {
  return softmax(boostScores(model, x));
}

/** Quantile bin edges per feature, from the training rows. */
function binEdges(X: number[][], f: number, bins: number): number[] {
  const vals = X.map((r) => r[f]!).sort((a, b) => a - b);
  const edges: number[] = [];
  for (let b = 1; b < bins; b++) {
    const v = vals[Math.floor((b / bins) * (vals.length - 1))]!;
    if (edges.length === 0 || v > edges[edges.length - 1]!) edges.push(v);
  }
  return edges;
}

export function trainBoost(
  X: number[][],
  y: number[],
  classes: string[],
  features: string[],
  opt: Partial<BoostOptions> = {},
): BoostModel {
  const o = { ...DEFAULT_BOOST, ...opt };
  const n = X.length;
  const K = classes.length;
  const F = features.length;
  const counts = new Array<number>(K).fill(1);
  for (const c of y) counts[c]! += 1;
  const base = counts.map((c) => Math.log(c / (n + K)));
  const model: BoostModel = { version: 1, classes, features, base, lr: o.lr, trees: [] };

  // Bin every feature once.
  const edges = Array.from({ length: F }, (_, f) => binEdges(X, f, o.bins));
  const B: Uint8Array[] = Array.from({ length: F }, () => new Uint8Array(n));
  for (let f = 0; f < F; f++) {
    const e = edges[f]!;
    for (let i = 0; i < n; i++) {
      const v = X[i]![f]!;
      let lo = 0;
      let hi = e.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v <= e[mid]!) hi = mid;
        else lo = mid + 1;
      }
      B[f]![i] = lo;
    }
  }

  const Z = Array.from({ length: n }, () => base.slice());
  const g = new Float64Array(n);
  const hs = new Float64Array(n);

  for (let round = 0; round < o.rounds; round++) {
    const roundTrees: PackedTree[] = [];
    const probs = Z.map((z) => softmax(z));
    for (let c = 0; c < K; c++) {
      for (let i = 0; i < n; i++) {
        const p = probs[i]![c]!;
        g[i] = p - (y[i] === c ? 1 : 0);
        hs[i] = Math.max(p * (1 - p), 1e-6);
      }
      const nodes: TreeNode[] = [];
      const build = (idx: Int32Array, depth: number): number => {
        let G = 0;
        let Hh = 0;
        for (const i of idx) {
          G += g[i]!;
          Hh += hs[i]!;
        }
        const me = nodes.length;
        nodes.push({ v: -G / (Hh + o.lambda), f: -1, t: 0, l: -1, r: -1 });
        if (depth >= o.maxDepth || idx.length < 2 * o.minLeaf) return me;
        const parentScore = (G * G) / (Hh + o.lambda);
        let best = { gain: 1e-9, f: -1, b: -1 };
        for (let f = 0; f < F; f++) {
          const nb = edges[f]!.length + 1;
          const gH = new Float64Array(nb);
          const hH = new Float64Array(nb);
          const cH = new Int32Array(nb);
          const bf = B[f]!;
          for (const i of idx) {
            const b = bf[i]!;
            gH[b]! += g[i]!;
            hH[b]! += hs[i]!;
            cH[b]! += 1;
          }
          let gl = 0;
          let hl = 0;
          let cl = 0;
          for (let b = 0; b < nb - 1; b++) {
            gl += gH[b]!;
            hl += hH[b]!;
            cl += cH[b]!;
            const cr = idx.length - cl;
            if (cl < o.minLeaf || cr < o.minLeaf) continue;
            const gr = G - gl;
            const hr = Hh - hl;
            const gain = (gl * gl) / (hl + o.lambda) + (gr * gr) / (hr + o.lambda) - parentScore;
            if (gain > best.gain) best = { gain, f, b };
          }
        }
        if (best.f < 0) return me;
        const bf = B[best.f]!;
        const L: number[] = [];
        const Rr: number[] = [];
        for (const i of idx) (bf[i]! <= best.b ? L : Rr).push(i);
        const node = nodes[me]!;
        node.f = best.f;
        node.t = edges[best.f]![best.b]!;
        node.l = build(Int32Array.from(L), depth + 1);
        node.r = build(Int32Array.from(Rr), depth + 1);
        return me;
      };
      build(Int32Array.from({ length: n }, (_, i) => i), 0);
      roundTrees.push(packTree(nodes));
    }
    model.trees.push(roundTrees);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < K; c++) Z[i]![c]! += o.lr * treeValue(roundTrees[c]!, X[i]!);
    }
    if (o.onRound && o.onRound(round, model) === false) break;
  }
  return model;
}

/** Keep the first `rounds` rounds (early stopping chosen on a validation split). */
export function truncateBoost(model: BoostModel, rounds: number): BoostModel {
  return { ...model, trees: model.trees.slice(0, rounds) };
}

/** Round thresholds and leaf values so the shipped JSON stays small. */
export function compactBoost(model: BoostModel, digits = 5): BoostModel {
  const r = (v: number) => Number(v.toPrecision(digits));
  return {
    ...model,
    base: model.base.map(r),
    trees: model.trees.map((round) =>
      round.map((t) => {
        const out = t.slice();
        // Walk the packed tree so only values (never offsets or feature ids) are rounded.
        const walk = (o: number): void => {
          if (out[o]! < 0) {
            out[o + 1] = r(out[o + 1]!);
            return;
          }
          out[o + 1] = r(out[o + 1]!);
          walk(out[o + 2]!);
          walk(out[o + 3]!);
        };
        walk(0);
        return out;
      }),
    ),
  };
}
