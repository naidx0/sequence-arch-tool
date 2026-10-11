#!/usr/bin/env node
/*
 * Labelled DiDi strokes (ink-didi-label.mjs output) -> feature rows per split.
 *
 *   node tools/bench/ink-shape-data.mjs <strokes.jsonl> <outDir> [--splits train,valid]
 *
 * Writes <outDir>/{split}.json: [{key, i, g?, label, cls, bd, f: number[], pts?}]
 *
 * Two kinds of row:
 *   - a lone stroke (`g` absent): class from the stroke's label;
 *   - a RUN of 2+ neighbouring strokes joined end to end (`g` = run length, `i` = first
 *     stroke), exactly the runs the whiteboard tries after the pen rests
 *     (packages/ink/src/shapeGroup.ts: clusterStrokes, candidateRuns, joinRun). Class:
 *       the node's shape   the run is ALL the outline pieces of one rect / ellipse / diamond
 *       other              all the pieces of a parallelogram / octagon, or a mixed run
 *       text               every stroke is handwriting
 *       part               some but not all pieces of one node's outline
 *     A run holding a stroke the labeller dropped (label null) is skipped.
 *   Handwriting and mixed runs are thinned (1 in 8, by position) so the positives are not drowned.
 *
 * Context feature: a stroke's board size is the median diagonal of the strokes drawn BEFORE it
 * (a run: before its cluster), what the whiteboard knows when the pen rests.
 * `pts` (raw points) is kept for valid and test lone strokes only, for the hand-rule baselines.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { shapeFeatures, medianDiag } from '../../packages/ink/dist/shapeFeatures.js';
import { classOfLabel } from '../../packages/ink/dist/shapeRecognize.js';
import { clusterStrokes, candidateRuns, joinRun } from '../../packages/ink/dist/shapeGroup.js';

const args = process.argv.slice(2);
const [strokesPath, outDir] = args;
if (!outDir) {
  console.error('usage: ink-shape-data.mjs <strokes.jsonl> <outDir> [--splits train,valid]');
  process.exit(2);
}
const splits = (args.includes('--splits') ? args[args.indexOf('--splits') + 1] : 'train,valid,test').split(',');
fs.mkdirSync(outDir, { recursive: true });
const rows = Object.fromEntries(splits.map((s) => [s, []]));
const BOX = new Set(['rect', 'ellipse', 'diamond']);
const diagOf = (pts) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); }
  return Math.hypot(c - a, d - b);
};

function drawingRows(split, strokes) {
  const gs = strokes.map((s, i) => ({ id: i, points: s.x.map((x, j) => ({ x, y: s.y[j] })), t0: s.t[0], t1: s.t[s.t.length - 1] }));
  const before = [];
  const bdAt = gs.map((g) => {
    const bd = before.length ? medianDiag(before) : undefined;
    before.push(g.points);
    return bd;
  });
  gs.forEach((g, i) => {
    const s = strokes[i];
    const cls = s.label ? classOfLabel(s.label) : null;
    if (!cls) return;
    const row = { key: s.key, i, label: s.label, cls, bd: bdAt[i] ?? null, f: shapeFeatures(g.points, bdAt[i]) };
    if (split !== 'train') row.pts = g.points.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
    rows[split].push(row);
  });
  // All outline pieces of each node, to tell a COMPLETE shape from some of its pieces.
  const piecesOf = new Map();
  strokes.forEach((s, i) => {
    if (s.label === 'part' && s.elem) {
      if (!piecesOf.has(s.elem)) piecesOf.set(s.elem, []);
      piecesOf.get(s.elem).push(i);
    }
  });
  for (const cluster of clusterStrokes(gs)) {
    const first = cluster[0].id;
    const bd = bdAt[first];
    for (const [start, len] of candidateRuns(cluster.length)) {
      const run = cluster.slice(start, start + len);
      const idx = run.map((r) => r.id);
      const labs = idx.map((i) => strokes[i].label);
      if (labs.some((l) => !l)) continue;
      let cls;
      if (labs.every((l) => l === 'text')) cls = 'text';
      else if (labs.every((l) => l === 'part') && new Set(idx.map((i) => strokes[i].elem)).size === 1) {
        const elem = strokes[idx[0]].elem;
        const all = piecesOf.get(elem) ?? [];
        const complete = all.length === idx.length && all.every((i) => idx.includes(i));
        const shape = strokes[idx[0]].nodeShape;
        cls = complete ? (BOX.has(shape) ? shape : 'other') : 'part';
      } else cls = 'other';
      if ((cls === 'text' || cls === 'other') && (first + start * 7 + len) % 8 !== 0) continue;
      if (cls === 'part' && (first + start * 5 + len) % 2 !== 0) continue;
      const diags = run.map((r) => diagOf(r.points));
      for (const joined of joinRun(run)) {
        rows[split].push({ key: strokes[idx[0]].key, i: idx[0], g: len, label: cls, cls, bd: bd ?? null, f: shapeFeatures(joined, bd, diags) });
      }
    }
  }
}

let cur = null;
let curSplit = null;
let buf = [];
const flush = () => {
  if (buf.length && rows[curSplit]) drawingRows(curSplit, buf);
  buf = [];
};
const rl = readline.createInterface({ input: fs.createReadStream(strokesPath) });
for await (const line of rl) {
  if (!line.trim()) continue;
  const s = JSON.parse(line);
  if (s.key !== cur) {
    flush();
    cur = s.key;
    curSplit = s.split;
  }
  buf.push(s);
}
flush();
for (const [split, r] of Object.entries(rows)) {
  fs.writeFileSync(path.join(outDir, `${split}.json`), JSON.stringify(r));
  const by = {};
  for (const x of r) by[(x.g ? 'run:' : '') + x.cls] = (by[(x.g ? 'run:' : '') + x.cls] ?? 0) + 1;
  console.log(split, r.length, JSON.stringify(by));
}
