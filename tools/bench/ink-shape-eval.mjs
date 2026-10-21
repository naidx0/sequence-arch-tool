#!/usr/bin/env node
/*
 * THE ONE LOOK. Score the shipped shape recognizer and its baselines on the
 * sealed DiDi test rows. Refuses to run if the rows' hash differs from sealed.txt.
 *
 *   node tools/bench/ink-shape-eval.mjs <rowsDir> <trainReport.json> <studyDir>
 *
 * Writes <studyDir>/results.json and prints a markdown table.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { recognizeShape } from '../../packages/ink/dist/shapeModel.js';
import { decideByRecognizeStroke, decideByRulesV2 } from '../../packages/ink/dist/shapeRecognize.js';
import { metrics, truthDecision, bootstrapDiff } from './ink-shape-lib.mjs';

const [, , rowsDir, reportPath, studyDir] = process.argv;
if (!studyDir) {
  console.error('usage: ink-shape-eval.mjs <rowsDir> <trainReport.json> <studyDir>');
  process.exit(2);
}
const raw = fs.readFileSync(path.join(rowsDir, 'test.json'));
const hash = crypto.createHash('sha256').update(raw).digest('hex');
const sealed = fs.readFileSync(path.join(studyDir, 'sealed.txt'), 'utf8');
if (!sealed.includes(hash)) {
  console.error(`test rows hash ${hash} is not the sealed one; refusing`);
  process.exit(1);
}
const test = JSON.parse(raw);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rules = report.rulesV2.params;

const keys = test.map((r) => r.key);
const truth = test.map(truthDecision);
const pts = test.map((r) => r.pts.map(([x, y]) => ({ x, y })));
const arms = {
  'all-ink': test.map(() => 'ink'),
  'A recognizeStroke': pts.map((p) => decideByRecognizeStroke(p)),
  'B rules v2': pts.map((p, i) => decideByRulesV2(p, test[i].bd ?? undefined, rules)),
};
const times = [];
arms['C trained'] = pts.map((p, i) => {
  const t = process.hrtime.bigint();
  const d = recognizeShape(p, { boardDiag: test[i].bd ?? undefined }).decision;
  times.push(Number(process.hrtime.bigint() - t) / 1e6);
  return d;
});
times.sort((a, b) => a - b);

const out = { hash, n: test.length, drawings: new Set(keys).size, arms: {}, diffs: {}, timing: {} };
for (const [name, pred] of Object.entries(arms)) out.arms[name] = metrics(truth, pred);
const macro = (t, p) => metrics(t, p).macroF1;
const wrong = (t, p) => metrics(t, p).wrongSnapRate;
const acc = (t, p) => metrics(t, p).accuracy;
for (const base of ['A recognizeStroke', 'B rules v2']) {
  out.diffs[`C - ${base}`] = {
    macroF1: bootstrapDiff(keys, truth, arms['C trained'], arms[base], macro),
    accuracy: bootstrapDiff(keys, truth, arms['C trained'], arms[base], acc),
    wrongSnapRate: bootstrapDiff(keys, truth, arms['C trained'], arms[base], wrong),
  };
}
out.timing = { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)] };
// Confusion for the trained arm and A, truth rows x predicted columns.
const conf = (pred) => {
  const m = {};
  truth.forEach((t, i) => {
    m[t] ??= {};
    m[t][pred[i]] = (m[t][pred[i]] ?? 0) + 1;
  });
  return m;
};
out.confusion = { 'A recognizeStroke': conf(arms['A recognizeStroke']), 'B rules v2': conf(arms['B rules v2']), 'C trained': conf(arms['C trained']) };
// What happens to handwriting specifically (the reason the whiteboard cannot tidy today).
const textIdx = test.map((r, i) => (r.cls === 'text' ? i : -1)).filter((i) => i >= 0);
out.handwritingSnapped = Object.fromEntries(
  Object.entries(arms).map(([k, pred]) => [k, textIdx.filter((i) => pred[i] !== 'ink').length / textIdx.length]),
);
fs.writeFileSync(path.join(studyDir, 'results.json'), JSON.stringify(out, null, 1));

const pct = (v) => (100 * v).toFixed(1);
console.log(`n=${out.n} strokes, ${out.drawings} drawings, sha256 ${hash.slice(0, 16)}`);
console.log('| arm | macro-F1 | accuracy | wrong-snap | snap recall | handwriting snapped |');
console.log('|---|---|---|---|---|---|');
for (const [k, m] of Object.entries(out.arms)) {
  console.log(`| ${k} | ${m.macroF1.toFixed(3)} | ${pct(m.accuracy)} | ${pct(m.wrongSnapRate)} | ${pct(m.snapRecall)} | ${pct(out.handwritingSnapped[k])} |`);
}
for (const [k, d] of Object.entries(out.diffs)) {
  console.log(`${k}: macroF1 ${d.macroF1.mean.toFixed(3)} (SE ${d.macroF1.se.toFixed(3)}), acc ${pct(d.accuracy.mean)} (SE ${pct(d.accuracy.se)}), wrong-snap ${pct(d.wrongSnapRate.mean)} (SE ${pct(d.wrongSnapRate.se)})`);
}
console.log('per decision (C):', JSON.stringify(out.arms['C trained'].perDecision));
console.log('timing', out.timing);
