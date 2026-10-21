#!/usr/bin/env node
/*
 * Multi-stroke grouping, measured on labelled DiDi strokes (ink-didi-label.mjs
 * output, with `elem`): the same drawings replayed stroke by stroke, with their
 * pen times, through (A) the lone-stroke recognizer and (B) the grouping step.
 *
 *   node tools/bench/ink-group-eval.mjs <strokes.jsonl> [--split valid|test|all] [--model weightsModule.js] [--out report.json] [--rounds N]
 *
 * Truth is per stroke, and now GROUP-aware: a node drawn with 2+ outline pieces
 * (label `part`, same `elem`) wants its pieces snapped to that node's shape when the
 * shape is rect / ellipse / diamond; a lone piece, parallelogram/octagon pieces,
 * handwriting, and arrow pieces want ink. Whole-shape and whole-edge strokes keep
 * the old truth. Dropped (label null) strokes are replayed (they shape the pending
 * window, as they would on a board) but not scored.
 *
 * It never trains and never edits a threshold: on `--split test` it is a look.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { metrics, bootstrapDiff } from './ink-shape-lib.mjs';

const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
// --ink <dist dir>: another build of packages/ink (the earlier, lone-stroke model, to measure "before").
const inkDist = path.resolve(opt('--ink', 'packages/ink/dist'));
const loneOnly = args.includes('--lone-only');
const imp = (f) => import(pathToFileURL(path.join(inkDist, f)).href);
const { recognizeShapeWith, classOfLabel, decisionOfClass } = await imp('shapeRecognize.js');
const { medianDiag } = await imp('shapeFeatures.js');
const { settleStrokes } = loneOnly ? {} : await imp('shapeGroup.js');
const split = opt('--split', 'valid');
const outPath = opt('--out', null);
const modelPath = path.resolve(opt('--model', path.join(inkDist, 'shapeModelWeights.js')));
const { SHAPE_MODEL, SHAPE_SNAP_THRESHOLD } = await import(pathToFileURL(modelPath).href);
const rounds = opt('--rounds', null);
let model = SHAPE_MODEL;
if (rounds) {
  const { truncateBoost } = await imp('shapeBoost.js');
  model = truncateBoost(SHAPE_MODEL, Number(rounds));
}
const threshold = Number(opt('--threshold', SHAPE_SNAP_THRESHOLD));
const gthr = opt('--gthr', null);
const inkWeight = Number(opt('--inkw', 1));
const recognize = (pts, o) => recognizeShapeWith(model, pts, { threshold, inkWeight, ...o });

const drawings = new Map();
for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
  if (!line.trim()) continue;
  const s = JSON.parse(line);
  if (split !== 'all' && s.split !== split) continue;
  if (!drawings.has(s.key)) drawings.set(s.key, []);
  drawings.get(s.key).push(s);
}

const BOX = new Set(['rect', 'ellipse', 'diamond']);
function truthOf(strokes) {
  // how many outline pieces each node has
  const parts = new Map();
  for (const s of strokes) if (s.label === 'part' && s.elem) parts.set(s.elem, (parts.get(s.elem) ?? 0) + 1);
  return strokes.map((s) => {
    if (!s.label) return null;
    if (s.label === 'part' && parts.get(s.elem) >= 2 && BOX.has(s.nodeShape)) return s.nodeShape;
    const cls = classOfLabel(s.label);
    return cls ? decisionOfClass(cls) : null;
  });
}

const dump = [];
const arms = { single: { truth: [], pred: [], keys: [] }, grouped: { truth: [], pred: [], keys: [] } };
const extra = { pieceToConnector: { single: 0, grouped: 0 }, pieceToAnySnap: { single: 0, grouped: 0 }, textSnapped: { single: 0, grouped: 0 }, textN: 0 };
const boxes = { n: 0, single: 0, grouped: 0 }; // multi-stroke boxes whose pieces ALL got the right shape
const times = [];
for (const [key, strokes] of drawings) {
  const truth = truthOf(strokes);
  const gs = strokes.map((s, i) => ({ id: i, points: s.x.map((x, j) => ({ x, y: s.y[j] })), t0: s.t[0], t1: s.t[s.t.length - 1] }));
  const grouped = new Array(strokes.length).fill('ink');
  const t0 = performance.now();
  // lone-stroke arm: every stroke decided on its own, with the median size of ALL strokes before it
  const single = new Array(strokes.length).fill('ink');
  if (loneOnly) {
    gs.forEach((g, i) => {
      const bd = i ? medianDiag(gs.slice(0, i).map((x) => x.points)) : undefined;
      single[i] = recognize(g.points, { boardDiag: bd }).decision;
      grouped[i] = single[i];
    });
  } else {
    for (const v of settleStrokes(gs, recognize, gthr ? { threshold: Number(gthr) } : {})) for (const id of v.ids) grouped[id] = v.decision;
    settleStrokes(gs, recognize, { maxRun: 1 }).forEach((v) => (single[v.ids[0]] = v.decision));
  }
  times.push((performance.now() - t0) / strokes.length);
  strokes.forEach((s, i) => {
    if (truth[i] === null) return;
    dump.push({ key, i, label: s.label, truth: truth[i], single: single[i], grouped: grouped[i] });
    for (const [name, pred] of [['single', single], ['grouped', grouped]]) {
      arms[name].truth.push(truth[i]);
      arms[name].pred.push(pred[i]);
      arms[name].keys.push(key);
      if (['part', 'shaft-part', 'arrowhead'].includes(s.label) && truth[i] === 'ink') {
        if (pred[i] === 'connector') extra.pieceToConnector[name]++;
        if (pred[i] !== 'ink') extra.pieceToAnySnap[name]++;
      }
      if (s.label === 'text' && pred[i] !== 'ink') extra.textSnapped[name]++;
    }
    if (s.label === 'text') extra.textN++;
  });
  const byNode = new Map();
  strokes.forEach((s, i) => {
    if (truth[i] && BOX.has(truth[i]) && s.label === 'part') {
      if (!byNode.has(s.elem)) byNode.set(s.elem, []);
      byNode.get(s.elem).push(i);
    }
  });
  for (const idx of byNode.values()) {
    boxes.n++;
    if (idx.every((i) => single[i] === truth[i])) boxes.single++;
    if (idx.every((i) => grouped[i] === truth[i])) boxes.grouped++;
  }
}
const report = { split, strokes: arms.single.truth.length, drawings: drawings.size, threshold, rounds: rounds ?? 'all' };
for (const name of ['single', 'grouped']) {
  const m = metrics(arms[name].truth, arms[name].pred);
  report[name] = { macroF1: m.macroF1, accuracy: m.accuracy, wrongSnapRate: m.wrongSnapRate, snapRecall: m.snapRecall, perDecision: m.perDecision };
}
const wrongCount = (name) => arms[name].truth.filter((t, i) => arms[name].pred[i] !== 'ink' && arms[name].pred[i] !== t).length;
report.wrongSnaps = { single: wrongCount('single'), grouped: wrongCount('grouped') };
report.pieceToConnector = extra.pieceToConnector;
report.pieceToAnySnap = extra.pieceToAnySnap;
report.handwritingSnapped = { single: extra.textSnapped.single / extra.textN, grouped: extra.textSnapped.grouped / extra.textN, n: extra.textN };
report.multiStrokeBoxes = boxes;
const statF1 = (t, p) => metrics(t, p).macroF1;
const statWS = (t, p) => metrics(t, p).wrongSnapRate;
report.diffMacroF1 = bootstrapDiff(arms.grouped.keys, arms.grouped.truth, arms.grouped.pred, arms.single.pred, statF1, 500);
report.diffWrongSnap = bootstrapDiff(arms.grouped.keys, arms.grouped.truth, arms.grouped.pred, arms.single.pred, statWS, 500);
times.sort((a, b) => a - b);
report.msPerStrokeMedian = times[Math.floor(times.length / 2)];
const confusion = {};
for (const d of dump) if (d.grouped !== 'ink' && d.grouped !== d.truth) { const k = `${d.label}:${d.truth}->${d.grouped}`; confusion[k] = (confusion[k] ?? 0) + 1; }
report.wrongSnapKinds = Object.fromEntries(Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 14));
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
  fs.writeFileSync(outPath.replace(/\.json$/, '.preds.json'), JSON.stringify(dump));
}
console.log(JSON.stringify(report, null, 1));
