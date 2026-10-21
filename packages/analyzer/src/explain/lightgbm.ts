/**
 * A LightGBM text-model evaluator (the `model.txt` that `Booster.save_model`
 * writes), in plain TypeScript with no dependencies. It covers what prediction
 * needs: per tree `split_feature`, `threshold`, `decision_type` (numerical and
 * categorical splits, default-left and the None / Zero / NaN missing types),
 * `left_child` / `right_child` (a negative child `~c` is leaf `c`),
 * `leaf_value`, and `cat_boundaries` / `cat_threshold` for categorical splits.
 * The raw score is the sum of the trees' leaf values in file order, exactly as
 * LightGBM's `PredictRaw` adds them (shrinkage is already folded into the
 * leaf values). Linear trees and multiclass models are refused.
 *
 * The decision rules follow LightGBM's `Tree::NumericalDecision` and
 * `Tree::CategoricalDecision` (include/LightGBM/tree.h, v4).
 */

export interface LightGbmTree {
  numLeaves: number;
  splitFeature: Int32Array;
  threshold: Float64Array;
  decisionType: Uint8Array;
  leftChild: Int32Array;
  rightChild: Int32Array;
  leafValue: Float64Array;
  catBoundaries?: Int32Array;
  catThreshold?: Uint32Array;
}

export interface LightGbmModel {
  featureNames: string[];
  objective: string;
  trees: LightGbmTree[];
}

const CATEGORICAL_MASK = 1;
const DEFAULT_LEFT_MASK = 2;
const MISSING_NONE = 0;
const MISSING_ZERO = 1;
const MISSING_NAN = 2;
/* kZeroThreshold = 1e-35f */
const ZERO_THRESHOLD = Math.fround(1e-35);

function nums(v: string | undefined): number[] {
  if (v === undefined || v.trim() === '') return [];
  return v.trim().split(/\s+/).map((s) => {
    /* LightGBM writes inf / -inf / nan for extreme thresholds. */
    if (/^[+]?inf(inity)?$/i.test(s)) return Infinity;
    if (/^-inf(inity)?$/i.test(s)) return -Infinity;
    if (/^[+-]?nan$/i.test(s)) return NaN;
    const n = Number(s);
    if (Number.isNaN(n)) throw new Error(`lightgbm: bad number ${JSON.stringify(s)}`);
    return n;
  });
}

function keyValues(block: string): Map<string, string> {
  const kv = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return kv;
}

/** Parse a LightGBM text model. Throws on a shape this evaluator cannot run. */
export function parseLightGbmModel(text: string): LightGbmModel {
  const endTrees = text.indexOf('\nend of trees');
  const body = endTrees >= 0 ? text.slice(0, endTrees) : text;
  const blocks = body.split(/\r?\n(?=Tree=\d+\r?\n)/);
  const header = keyValues(blocks[0]!);
  if (header.get('tree') === undefined && !blocks[0]!.startsWith('tree')) throw new Error('lightgbm: not a text model');
  const numClass = Number(header.get('num_class') ?? '1');
  const perIter = Number(header.get('num_tree_per_iteration') ?? '1');
  if (numClass !== 1 || perIter !== 1) throw new Error('lightgbm: only single-output models are supported');
  const featureNames = (header.get('feature_names') ?? '').trim().split(/\s+/).filter(Boolean);
  const trees: LightGbmTree[] = [];
  for (const block of blocks.slice(1)) {
    const kv = keyValues(block);
    if (kv.get('is_linear') !== undefined && kv.get('is_linear')!.trim() !== '0') throw new Error('lightgbm: linear trees are not supported');
    const numLeaves = Number(kv.get('num_leaves'));
    const leafValue = Float64Array.from(nums(kv.get('leaf_value')));
    if (!(numLeaves >= 1) || leafValue.length !== numLeaves) throw new Error('lightgbm: bad tree (num_leaves / leaf_value)');
    const inner = numLeaves - 1;
    const tree: LightGbmTree = {
      numLeaves,
      splitFeature: Int32Array.from(nums(kv.get('split_feature'))),
      threshold: Float64Array.from(nums(kv.get('threshold'))),
      decisionType: Uint8Array.from(nums(kv.get('decision_type'))),
      leftChild: Int32Array.from(nums(kv.get('left_child'))),
      rightChild: Int32Array.from(nums(kv.get('right_child'))),
      leafValue,
    };
    for (const a of [tree.splitFeature, tree.threshold, tree.decisionType, tree.leftChild, tree.rightChild]) {
      if (a.length !== inner) throw new Error('lightgbm: bad tree (internal node arrays)');
    }
    if (Number(kv.get('num_cat') ?? '0') > 0) {
      tree.catBoundaries = Int32Array.from(nums(kv.get('cat_boundaries')));
      tree.catThreshold = Uint32Array.from(nums(kv.get('cat_threshold')));
    }
    for (const f of tree.splitFeature) {
      if (featureNames.length > 0 && (f < 0 || f >= featureNames.length)) throw new Error(`lightgbm: split on unknown feature ${f}`);
    }
    trees.push(tree);
  }
  if (trees.length === 0) throw new Error('lightgbm: no trees');
  return { featureNames, objective: (header.get('objective') ?? '').trim(), trees };
}

function numericalDecision(t: LightGbmTree, node: number, value: number): number {
  const dt = t.decisionType[node]!;
  const missing = (dt >> 2) & 3;
  let v = value;
  if (Number.isNaN(v) && missing !== MISSING_NAN) v = 0;
  if ((missing === MISSING_ZERO && v >= -ZERO_THRESHOLD && v <= ZERO_THRESHOLD) || (missing === MISSING_NAN && Number.isNaN(v))) {
    return dt & DEFAULT_LEFT_MASK ? t.leftChild[node]! : t.rightChild[node]!;
  }
  return v <= t.threshold[node]! ? t.leftChild[node]! : t.rightChild[node]!;
}

function categoricalDecision(t: LightGbmTree, node: number, value: number): number {
  if (Number.isNaN(value)) return t.rightChild[node]!;
  const iv = Math.trunc(value);
  if (iv < 0) return t.rightChild[node]!;
  const ci = Math.trunc(t.threshold[node]!);
  const lo = t.catBoundaries![ci]!;
  const n = t.catBoundaries![ci + 1]! - lo;
  const word = Math.floor(iv / 32);
  if (word >= n) return t.rightChild[node]!;
  return (t.catThreshold![lo + word]! >>> iv % 32) & 1 ? t.leftChild[node]! : t.rightChild[node]!;
}

/** One tree's leaf value for a feature row. */
export function predictLightGbmTree(t: LightGbmTree, row: ArrayLike<number>): number {
  if (t.numLeaves <= 1) return t.leafValue[0]!;
  let node = 0;
  while (node >= 0) {
    const v = row[t.splitFeature[node]!] ?? 0;
    node = t.decisionType[node]! & CATEGORICAL_MASK ? categoricalDecision(t, node, v) : numericalDecision(t, node, v);
  }
  return t.leafValue[~node]!;
}

/** The model's raw score (no sigmoid / softmax): trees summed in file order from 0. */
export function predictLightGbm(model: LightGbmModel, row: ArrayLike<number>): number {
  let out = 0;
  for (const t of model.trees) out += predictLightGbmTree(t, row);
  return out;
}

export { MISSING_NONE as LIGHTGBM_MISSING_NONE, MISSING_ZERO as LIGHTGBM_MISSING_ZERO, MISSING_NAN as LIGHTGBM_MISSING_NAN };
