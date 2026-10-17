import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shapeFeatures, SHAPE_FEATURE_COUNT, SHAPE_FEATURE_NAMES, resample, medianDiag, type P } from './shapeFeatures.js';
import { trainBoost, boostPredict, compactBoost, truncateBoost, packTree } from './shapeBoost.js';
import { recognizeShape, SHAPE_MODEL, SHAPE_SNAP_THRESHOLD } from './shapeModel.js';
import { recognizeShapeWith, shaftSwings, MAX_SHAFT_SWINGS, decideByRecognizeStroke, decideByRulesV2, classOfLabel, decisionOfClass, RULES_V2_DEFAULT } from './shapeRecognize.js';
import { recognizeStroke } from './index.js';

/* ── stroke builders: a little wobble, deterministic ─────────────────────── */
function wobble(pts: P[], amp: number, seed = 1): P[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
}
function polyline(vertices: P[], perSide = 20): P[] {
  const out: P[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]!;
    const b = vertices[i + 1]!;
    for (let k = 0; k < perSide; k++) out.push({ x: a.x + ((b.x - a.x) * k) / perSide, y: a.y + ((b.y - a.y) * k) / perSide });
  }
  out.push(vertices[vertices.length - 1]!);
  return out;
}
const rect = (x: number, y: number, w: number, h: number) =>
  wobble(polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y: y + 2 }]), 3);
const ellipse = (cx: number, cy: number, a: number, b: number) =>
  wobble(Array.from({ length: 80 }, (_, i) => ({ x: cx + a * Math.cos((i / 78) * 2 * Math.PI), y: cy + b * Math.sin((i / 78) * 2 * Math.PI) })), 3);
const diamond = (cx: number, cy: number, a: number, b: number) =>
  wobble(polyline([{ x: cx, y: cy - b }, { x: cx + a, y: cy }, { x: cx, y: cy + b }, { x: cx - a, y: cy }, { x: cx + 2, y: cy - b + 2 }]), 3);
/** Shaft down to a tip, then one barb up and back, then the other barb. */
const arrow = (x: number, y0: number, y1: number) =>
  wobble(
    polyline([
      { x, y: y0 },
      { x, y: y1 },
      { x: x - 25, y: y1 - 30 },
      { x, y: y1 },
      { x: x + 25, y: y1 - 30 },
    ]),
    2,
  );
/** A handwritten lowercase "o": a small closed loop. */
const letterO = (cx: number, cy: number) => ellipse(cx, cy, 14, 16);

test('features: fixed length, finite, and scale-invariant', () => {
  const a = rect(0, 0, 200, 100);
  const b = a.map((p) => ({ x: p.x * 3, y: p.y * 3 }));
  const fa = shapeFeatures(a);
  const fb = shapeFeatures(b);
  assert.equal(fa.length, SHAPE_FEATURE_COUNT);
  assert.equal(SHAPE_FEATURE_NAMES.length, SHAPE_FEATURE_COUNT);
  assert.ok(fa.every(Number.isFinite));
  fa.forEach((v, i) => {
    assert.ok(Math.abs(v - fb[i]!) < 1e-6, `${SHAPE_FEATURE_NAMES[i]} changed with scale: ${v} vs ${fb[i]}`);
  });
});

test('features: degenerate strokes give a zero row, never NaN', () => {
  for (const pts of [[], [{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 1, y: 1 }]]) {
    const f = shapeFeatures(pts);
    assert.equal(f.length, SHAPE_FEATURE_COUNT);
    assert.ok(f.every((v) => v === 0));
  }
  assert.ok(shapeFeatures([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]).every(Number.isFinite));
});

test('features: logRelDiag reads size against the board', () => {
  const o = letterO(0, 0);
  const i = SHAPE_FEATURE_NAMES.indexOf('logRelDiag');
  assert.equal(shapeFeatures(o)[i], 0);
  assert.ok(shapeFeatures(o, 400)[i]! < -2);
  assert.equal(medianDiag([[{ x: 0, y: 0 }, { x: 3, y: 4 }], [{ x: 0, y: 0 }, { x: 30, y: 40 }], [{ x: 0, y: 0 }, { x: 6, y: 8 }]]), 10);
});

test('resample: n points, ends kept', () => {
  const r = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 11);
  assert.equal(r.length, 11);
  assert.deepEqual(r[0], { x: 0, y: 0 });
  assert.ok(Math.abs(r[5]!.x - 50) < 1e-9);
  assert.ok(Math.abs(r[10]!.x - 100) < 1e-9);
});

test('boost: learns a planted signal, deterministically, and packing/compacting keep the answers', () => {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 600; i++) {
    const a = (i * 37) % 100;
    const b = (i * 53) % 100;
    X.push([a, b, (i * 11) % 7]);
    y.push(a > 60 ? 2 : b > 50 ? 1 : 0);
  }
  const m1 = trainBoost(X, y, ['zero', 'one', 'two'], ['a', 'b', 'noise'], { rounds: 30, minLeaf: 5 });
  const m2 = trainBoost(X, y, ['zero', 'one', 'two'], ['a', 'b', 'noise'], { rounds: 30, minLeaf: 5 });
  assert.deepEqual(m1, m2);
  let right = 0;
  for (let i = 0; i < X.length; i++) {
    const p = boostPredict(m1, X[i]!);
    if (p.indexOf(Math.max(...p)) === y[i]) right++;
  }
  assert.ok(right / X.length > 0.97, `train accuracy ${right / X.length}`);
  const c = compactBoost(truncateBoost(m1, 20), 7);
  assert.equal(c.trees.length, 20);
  for (let i = 0; i < X.length; i += 17) {
    const a = boostPredict(truncateBoost(m1, 20), X[i]!);
    const b = boostPredict(c, X[i]!);
    a.forEach((v, k) => assert.ok(Math.abs(v - b[k]!) < 1e-4));
  }
  // A packed leaf-only tree reads [-1, value]
  assert.deepEqual(packTree([{ v: 0.5, f: -1, t: 0, l: -1, r: -1 }]), [-1, 0.5]);
});

test('shipped model: trained on DiDi, 8 classes over the feature row, threshold in range', () => {
  assert.deepEqual(SHAPE_MODEL.features, [...SHAPE_FEATURE_NAMES]);
  assert.equal(SHAPE_MODEL.classes.length, 8);
  assert.ok(SHAPE_MODEL.trees.length >= 10);
  assert.ok(SHAPE_SNAP_THRESHOLD >= 0.3 && SHAPE_SNAP_THRESHOLD <= 0.95);
});

test('shipped model: clean single-stroke shapes snap to what they are', () => {
  assert.equal(recognizeShape(rect(100, 100, 260, 120)).decision, 'rect');
  assert.equal(recognizeShape(ellipse(300, 300, 140, 70)).decision, 'ellipse');
  assert.equal(recognizeShape(diamond(300, 300, 150, 90)).decision, 'diamond');
  assert.equal(recognizeShape(arrow(200, 100, 400)).decision, 'connector');
});

test('shipped model: a handwritten "o" among boxes stays ink, where recognizeStroke calls it a box', () => {
  const o = letterO(500, 500);
  assert.equal(recognizeStroke(o).kind, 'box', 'precondition: the hand rules snap a letter');
  assert.equal(recognizeShape(o, { boardDiag: 300 }).decision, 'ink');
});

test('shipped model: a connector runs from the tail to the TIP, not to where the pen lifted', () => {
  const r = recognizeShape(arrow(200, 100, 400));
  assert.equal(r.decision, 'connector');
  assert.ok(Math.abs(r.to!.y - 400) < 15, `head at ${JSON.stringify(r.to)}`);
  assert.ok(Math.abs(r.from!.y - 100) < 15);
});

test('threshold: at 1.0 nothing snaps; the box geometry is the stroke bounding box', () => {
  const s = rect(100, 100, 260, 120);
  assert.equal(recognizeShapeWith(SHAPE_MODEL, s, { threshold: 1.01 }).decision, 'ink');
  const r = recognizeShape(s);
  assert.ok(Math.abs(r.from!.x - 100) < 5 && Math.abs(r.to!.x - 360) < 5);
  assert.equal(recognizeShape([{ x: 0, y: 0 }, { x: 1, y: 1 }]).decision, 'ink');
});

test('baselines: recognizeStroke read as decisions, rules v2 splits the box and gates by size', () => {
  assert.equal(decideByRecognizeStroke(rect(0, 0, 200, 100)), 'rect');
  assert.equal(decideByRecognizeStroke(ellipse(0, 0, 100, 60)), 'rect');
  assert.equal(decideByRulesV2(ellipse(0, 0, 100, 60), undefined, RULES_V2_DEFAULT), 'ellipse');
  assert.equal(decideByRulesV2(diamond(0, 0, 100, 60), undefined, RULES_V2_DEFAULT), 'diamond');
  assert.equal(decideByRulesV2(letterO(0, 0), 400, { ...RULES_V2_DEFAULT, minRel: 0.3 }), 'ink');
});

test('labels: DiDi labels map to classes and classes to decisions', () => {
  assert.equal(classOfLabel('octagon'), 'other');
  assert.equal(classOfLabel('line'), 'arrow');
  assert.equal(classOfLabel('arrowhead'), 'connpart');
  assert.equal(classOfLabel('nonsense'), null);
  assert.equal(decisionOfClass('arrow'), 'connector');
  assert.equal(decisionOfClass('text'), 'ink');
  assert.equal(decisionOfClass('other'), 'ink');
});

test('a zigzag, a wave or a big handwritten letter is never a connector, even among small writing', () => {
  const zig = (n: number, w: number, h: number): P[] => polyline(Array.from({ length: n + 1 }, (_, i) => ({ x: 100 + (i * w) / n, y: 100 + (i % 2 ? h : 0) })), 8);
  const wave: P[] = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 6, y: 100 + Math.sin(i / 3) * 20 }));
  const bigN = polyline([{ x: 100, y: 200 }, { x: 110, y: 100 }, { x: 104, y: 200 }, { x: 115, y: 180 }], 12);
  for (const [name, pts] of [['zigzag 6', zig(6, 200, 30)], ['zigzag 8', zig(8, 300, 40)], ['zigzag 10', zig(10, 200, 20)], ['wave', wave], ['big N', bigN]] as const) {
    assert.equal(recognizeShape(pts, { boardDiag: 40 }).decision, 'ink', name);
  }
  // An arrow's shaft passes the gate (its head is drawn after the tip and stays near it).
  assert.ok(shaftSwings(arrow(200, 100, 400)) <= MAX_SHAFT_SWINGS);
});
