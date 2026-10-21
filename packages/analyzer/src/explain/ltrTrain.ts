/**
 * Per-repo ranker retraining on the CPU, in plain TypeScript.
 *
 * WHAT. The shipped ranker (askLtrModel.generated.ts) is a frozen LightGBM
 * LambdaRank model. This file continues its boosting on one repository's own
 * labels: every round fits one small regression tree to the LambdaRank
 * gradients of the CURRENT scores (the frozen model's score plus the trees added
 * so far) and appends it. The frozen trees are never touched, so the result is
 * `frozen + a few residual trees`, evaluated by the same {@link predictLightGbm}
 * and always removable.
 *
 * WHY NOT LIGHTGBM. The app ships no Python, and a few hundred queries of ~50
 * candidates x 39 features is milliseconds of work for an exact-greedy
 * histogram learner. Defaults: 4 leaves, learning rate 0.1, at most 15 rounds,
 * min 20 rows per leaf, L2 1.0 (chosen on dev windows, see
 * harness-study/prime/find-files/README.md).
 *
 * LAMBDARANK. Binary relevance (a file the agent kept an edit in = 1), pairs
 * (positive i, negative j) where one of the two sits in the top `trunc` of the
 * current order, |delta NDCG| weights, sigmoid 1, per-query lambda
 * normalisation: LightGBM's `lambdarank` formulas, so the residual is fitted to
 * the same objective the frozen model was trained on.
 *
 * NEVER BLOCKS. The async trainer yields to the event loop after every round
 * (and inside a round for big inputs), so an MCP call that arrives mid-training
 * is answered between two rounds.
 */

import { predictLightGbm, predictLightGbmTree, type LightGbmModel, type LightGbmTree } from './lightgbm.js';

/** One logged query: its candidates' feature rows and which of them were truly edited (1) or not (0). */
export interface LtrExample {
  rows: number[][];
  labels: number[];
}

export interface LtrTrainOptions {
  rounds?: number;
  leaves?: number;
  learningRate?: number;
  minDataInLeaf?: number;
  l2?: number;
  /** LambdaRank truncation level (LightGBM `lambdarank_truncation_level`). */
  trunc?: number;
  bins?: number;
  /** Called between rounds; await a macrotask here to keep the process responsive. */
  yieldNow?: () => Promise<void>;
  /** Polled between rounds; true stops and keeps the trees fitted so far. */
  cancelled?: () => boolean;
}

export const LTR_TRAIN_DEFAULTS = { rounds: 15, leaves: 4, learningRate: 0.1, minDataInLeaf: 20, l2: 1, trunc: 20, bins: 32 } as const;

const DISCOUNT = (i: number): number => 1 / Math.log2(i + 2);

/** LambdaRank gradient and Hessian of every row for the current scores (LightGBM `RankingObjective`, binary gains). */
function lambdaGradients(examples: readonly LtrExample[], scores: readonly Float64Array[], trunc: number): { g: Float64Array[]; h: Float64Array[] } {
  const g: Float64Array[] = [];
  const h: Float64Array[] = [];
  for (let q = 0; q < examples.length; q++) {
    const ex = examples[q]!;
    const n = ex.labels.length;
    const gq = new Float64Array(n);
    const hq = new Float64Array(n);
    g.push(gq);
    h.push(hq);
    const s = scores[q]!;
    let npos = 0;
    for (const l of ex.labels) if (l > 0) npos++;
    if (npos === 0 || npos === n) continue;
    let maxDcg = 0;
    for (let i = 0; i < Math.min(npos, trunc); i++) maxDcg += DISCOUNT(i);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => s[b]! - s[a]! || a - b);
    const rank = new Int32Array(n);
    order.forEach((idx, r) => (rank[idx] = r));
    let sumL = 0;
    for (let a = 0; a < n; a++) {
      if (ex.labels[a]! <= 0) continue;
      for (let b = 0; b < n; b++) {
        if (ex.labels[b]! > 0) continue;
        const ra = rank[a]!;
        const rb = rank[b]!;
        if (ra >= trunc && rb >= trunc) continue;
        const delta = (Math.abs(DISCOUNT(ra) - DISCOUNT(rb)) / maxDcg) || 0;
        const p = 1 / (1 + Math.exp(s[a]! - s[b]!));
        const lam = p * delta;
        const hes = p * (1 - p) * delta;
        gq[a]! += lam;
        gq[b]! -= lam;
        hq[a]! += hes;
        hq[b]! += hes;
        sumL += 2 * lam;
      }
    }
    /* lambdarank_norm: scale so a query's total pull does not grow with its pair count. */
    if (sumL > 0) {
      const f = Math.log2(1 + sumL) / sumL;
      for (let i = 0; i < n; i++) {
        gq[i]! *= f;
        hq[i]! *= f;
      }
    }
  }
  return { g, h };
}

interface Binned {
  /** edges[f]: ascending split values; a row goes left of edge e when value <= edges[f][e]. */
  edges: Float64Array[];
  /** bin[f][row]: index of the first edge >= value, or edges.length for the last bin. */
  bin: Uint8Array[];
  nrows: number;
}

function binRows(X: readonly ArrayLike<number>[], nfeat: number, nbins: number): Binned {
  const nrows = X.length;
  const edges: Float64Array[] = [];
  const bin: Uint8Array[] = [];
  for (let f = 0; f < nfeat; f++) {
    const vals = new Float64Array(nrows);
    for (let i = 0; i < nrows; i++) vals[i] = X[i]![f] ?? 0;
    const sorted = Float64Array.from(vals).sort();
    const uniq: number[] = [];
    for (const v of sorted) if (uniq.length === 0 || v !== uniq[uniq.length - 1]) uniq.push(v);
    let e: number[];
    if (uniq.length <= nbins) e = uniq.slice(0, -1);
    else {
      e = [];
      for (let b = 1; b < nbins; b++) {
        const v = sorted[Math.min(nrows - 1, Math.floor((b * nrows) / nbins))]!;
        if (e.length === 0 || v > e[e.length - 1]!) e.push(v);
      }
      if (e.length && e[e.length - 1]! >= uniq[uniq.length - 1]!) e.pop();
    }
    const ef = Float64Array.from(e);
    edges.push(ef);
    const col = new Uint8Array(nrows);
    for (let i = 0; i < nrows; i++) {
      const v = vals[i]!;
      let lo = 0;
      let hi = ef.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v <= ef[mid]!) hi = mid;
        else lo = mid + 1;
      }
      col[i] = lo;
    }
    bin.push(col);
  }
  return { edges, bin, nrows };
}

interface TNode {
  feature?: number;
  threshold?: number;
  left?: TNode;
  right?: TNode;
  value: number;
  rows: Int32Array;
  split?: { feature: number; bin: number; gain: number; gl: number; hl: number; gr: number; hr: number };
}

function leafValue(G: number, H: number, l2: number, lr: number): number {
  return (lr * G) / (H + l2);
}

function bestSplit(node: TNode, B: Binned, g: Float64Array, h: Float64Array, minData: number, l2: number): void {
  const rows = node.rows;
  let G = 0;
  let H = 0;
  for (const r of rows) {
    G += g[r]!;
    H += h[r]!;
  }
  const parent = (G * G) / (H + l2);
  let best: TNode['split'];
  for (let f = 0; f < B.edges.length; f++) {
    const ne = B.edges[f]!.length;
    if (ne === 0) continue;
    const gs = new Float64Array(ne + 1);
    const hs = new Float64Array(ne + 1);
    const cs = new Int32Array(ne + 1);
    const col = B.bin[f]!;
    for (const r of rows) {
      const b = col[r]!;
      gs[b]! += g[r]!;
      hs[b]! += h[r]!;
      cs[b]!++;
    }
    let gl = 0;
    let hl = 0;
    let cl = 0;
    for (let b = 0; b < ne; b++) {
      gl += gs[b]!;
      hl += hs[b]!;
      cl += cs[b]!;
      const cr = rows.length - cl;
      if (cl < minData || cr < minData) continue;
      const gr = G - gl;
      const hr = H - hl;
      const gain = (gl * gl) / (hl + l2) + (gr * gr) / (hr + l2) - parent;
      if (gain > 1e-12 && (!best || gain > best.gain)) best = { feature: f, bin: b, gain, gl, hl, gr, hr };
    }
  }
  node.split = best;
}

function growTree(B: Binned, g: Float64Array, h: Float64Array, leaves: number, minData: number, l2: number, lr: number): TNode {
  const all = new Int32Array(B.nrows);
  for (let i = 0; i < B.nrows; i++) all[i] = i;
  let G = 0;
  let H = 0;
  for (let i = 0; i < B.nrows; i++) {
    G += g[i]!;
    H += h[i]!;
  }
  const root: TNode = { value: leafValue(G, H, l2, lr), rows: all };
  bestSplit(root, B, g, h, minData, l2);
  const open: TNode[] = [root];
  for (let nl = 1; nl < leaves; nl++) {
    let pick: TNode | undefined;
    for (const n of open) if (n.split && (!pick || n.split.gain > pick.split!.gain)) pick = n;
    if (!pick) break;
    const sp = pick.split!;
    const col = B.bin[sp.feature]!;
    const lrows: number[] = [];
    const rrows: number[] = [];
    for (const r of pick.rows) (col[r]! <= sp.bin ? lrows : rrows).push(r);
    pick.feature = sp.feature;
    pick.threshold = B.edges[sp.feature]![sp.bin]!;
    pick.left = { value: leafValue(sp.gl, sp.hl, l2, lr), rows: Int32Array.from(lrows) };
    pick.right = { value: leafValue(sp.gr, sp.hr, l2, lr), rows: Int32Array.from(rrows) };
    pick.split = undefined;
    open.splice(open.indexOf(pick), 1, pick.left, pick.right);
    bestSplit(pick.left, B, g, h, minData, l2);
    bestSplit(pick.right, B, g, h, minData, l2);
  }
  return root;
}

/** A grown tree as the LightGBM-shaped arrays {@link predictLightGbmTree} reads. */
function flatten(root: TNode): LightGbmTree {
  const splitFeature: number[] = [];
  const threshold: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const leafVal: number[] = [];
  const walk = (n: TNode): number => {
    if (n.feature === undefined) {
      leafVal.push(n.value);
      return ~(leafVal.length - 1);
    }
    const id = splitFeature.length;
    splitFeature.push(n.feature);
    threshold.push(n.threshold!);
    left.push(0);
    right.push(0);
    left[id] = walk(n.left!);
    right[id] = walk(n.right!);
    return id;
  };
  walk(root);
  return {
    numLeaves: leafVal.length,
    splitFeature: Int32Array.from(splitFeature),
    threshold: Float64Array.from(threshold),
    decisionType: new Uint8Array(splitFeature.length),
    leftChild: Int32Array.from(left),
    rightChild: Int32Array.from(right),
    leafValue: Float64Array.from(leafVal),
  };
}

/**
 * Residual boosting on top of `base`. Returns the NEW trees only (append them to
 * `base.trees` for the retrained model). Empty when no query has both a
 * positive and a negative candidate.
 */
export async function trainResidualTrees(base: LightGbmModel, examples: readonly LtrExample[], opts: LtrTrainOptions = {}): Promise<LightGbmTree[]> {
  const o = { ...LTR_TRAIN_DEFAULTS, ...opts };
  const usable = examples.filter((e) => e.rows.length > 0 && e.labels.some((l) => l > 0) && e.labels.some((l) => l <= 0));
  if (usable.length === 0) return [];
  const X: number[][] = [];
  const offsets: number[] = [];
  for (const e of usable) {
    offsets.push(X.length);
    for (const r of e.rows) X.push(r);
  }
  const nfeat = base.featureNames.length || X[0]!.length;
  const B = binRows(X, nfeat, o.bins);
  const scores = usable.map((e) => Float64Array.from(e.rows, (r) => predictLightGbm(base, r)));
  const trees: LightGbmTree[] = [];
  const gAll = new Float64Array(X.length);
  const hAll = new Float64Array(X.length);
  for (let round = 0; round < o.rounds; round++) {
    if (opts.cancelled?.()) break;
    const { g, h } = lambdaGradients(usable, scores, o.trunc);
    usable.forEach((_, q) => {
      gAll.set(g[q]!, offsets[q]!);
      hAll.set(h[q]!, offsets[q]!);
    });
    const root = growTree(B, gAll, hAll, o.leaves, o.minDataInLeaf, o.l2, o.learningRate);
    if (root.feature === undefined) break;
    const tree = flatten(root);
    trees.push(tree);
    usable.forEach((e, q) => {
      for (let i = 0; i < e.rows.length; i++) scores[q]![i]! += predictLightGbmTree(tree, e.rows[i]!);
    });
    await opts.yieldNow?.();
  }
  return trees;
}

/** `base` with `extra` trees appended: the retrained model. */
export function withResidualTrees(base: LightGbmModel, extra: readonly LightGbmTree[]): LightGbmModel {
  return { ...base, trees: [...base.trees, ...extra] };
}

/** Per query: 1 when a labelled row is the top-scored one / in the top `k`. A query with no positive row is skipped (null). */
export function hitAtK(model: LightGbmModel, ex: LtrExample, k: number): number | null {
  if (!ex.labels.some((l) => l > 0)) return null;
  const s = ex.rows.map((r) => predictLightGbm(model, r));
  /* pick.py's order: score, then F50 rank (feature 1), then input order. */
  const order = s.map((_, i) => i).sort((a, b) => s[b]! - s[a]! || ex.rows[a]![1]! - ex.rows[b]![1]! || a - b);
  return order.slice(0, k).some((i) => ex.labels[i]! > 0) ? 1 : 0;
}

/** Serialisable residual trees (typed arrays become plain arrays). */
export function treesToJson(trees: readonly LightGbmTree[]): unknown[] {
  return trees.map((t) => ({ n: t.numLeaves, f: [...t.splitFeature], t: [...t.threshold], l: [...t.leftChild], r: [...t.rightChild], v: [...t.leafValue] }));
}

/** Inverse of {@link treesToJson}; null when the shape is wrong (a corrupt file must never reach prediction). */
export function treesFromJson(j: unknown, nfeat: number): LightGbmTree[] | null {
  if (!Array.isArray(j)) return null;
  const out: LightGbmTree[] = [];
  for (const t of j as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') return null;
    const { n, f, t: th, l, r, v } = t as { n?: unknown; f?: unknown; t?: unknown; l?: unknown; r?: unknown; v?: unknown };
    const arr = (a: unknown): number[] | null => (Array.isArray(a) && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (a as number[]) : null);
    const F = arr(f), T = arr(th), L = arr(l), R = arr(r), V = arr(v);
    if (typeof n !== 'number' || !F || !T || !L || !R || !V) return null;
    const inner = n - 1;
    if (n < 2 || n > 64 || F.length !== inner || T.length !== inner || L.length !== inner || R.length !== inner || V.length !== n) return null;
    if (F.some((x) => !Number.isInteger(x) || x < 0 || x >= nfeat)) return null;
    for (const c of [...L, ...R]) if (!Number.isInteger(c) || c >= inner || c < -n) return null;
    /* A tree, not a graph: from the root every split and every leaf is reached exactly once. A child pointing back up
       (l[0] = 0) passes the range checks above and would spin predictLightGbmTree forever on every call. */
    const seenNode = new Uint8Array(inner);
    const seenLeaf = new Uint8Array(n);
    const stack = [0];
    while (stack.length) {
      const c = stack.pop()!;
      if (c < 0) {
        if (seenLeaf[~c]++) return null;
        continue;
      }
      if (seenNode[c]++) return null;
      stack.push(L[c]!, R[c]!);
    }
    if (seenNode.some((x) => x !== 1) || seenLeaf.some((x) => x !== 1)) return null;
    if (V.some((x) => Math.abs(x) > 100)) return null;
    out.push({ numLeaves: n, splitFeature: Int32Array.from(F), threshold: Float64Array.from(T), decisionType: new Uint8Array(inner), leftChild: Int32Array.from(L), rightChild: Int32Array.from(R), leafValue: Float64Array.from(V) });
  }
  return out;
}
