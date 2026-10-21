import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedStats } from './stats.mjs';

const rows = (vals, repeats = 1) => vals.flatMap((v, i) => Array.from({ length: repeats }, () => ({ task: `t${i}`, pass: v })));

test('paired difference, mean, SE are recomputable by hand', () => {
  // a: 0 0 0 0 ; b: 1 1 0 0  -> diffs 1 1 0 0, mean .5, sd sqrt(1/3), se = sd/2
  const s = pairedStats(rows([0, 0, 0, 0]), rows([1, 1, 0, 0]), { minN: 4 });
  assert.equal(s.n, 4);
  assert.deepEqual(s.diffs.map((d) => d.diff), [1, 1, 0, 0]);
  assert.equal(s.mean, 0.5);
  assert.ok(Math.abs(s.sd - Math.sqrt(1 / 3)) < 1e-12);
  assert.ok(Math.abs(s.se - Math.sqrt(1 / 3) / 2) < 1e-12);
});

test('verdict: win only if mean diff > 2 SE (positive control)', () => {
  const a = rows(Array(30).fill(0));
  const b = rows([...Array(20).fill(1), ...Array(10).fill(0)]);
  const s = pairedStats(a, b);
  assert.equal(s.verdict, 'win');
  assert.ok(s.mean > 2 * s.se);
});

test('verdict: no difference when the mean is inside 2 SE (negative control)', () => {
  const a = rows([...Array(15).fill(1), ...Array(15).fill(0)]);
  const b = rows([...Array(14).fill(1), 0, 1, ...Array(14).fill(0)]); // one flip each way
  const s = pairedStats(a, b);
  assert.equal(s.verdict, 'no-difference');
});

test('verdict: loss when b is credibly worse', () => {
  const a = rows(Array(30).fill(1));
  const b = rows([...Array(10).fill(1), ...Array(20).fill(0)]);
  assert.equal(pairedStats(a, b).verdict, 'loss');
});

test('verdict: underpowered below n=30 even when every diff is positive', () => {
  const s = pairedStats(rows(Array(10).fill(0)), rows(Array(10).fill(1)));
  assert.equal(s.verdict, 'underpowered');
});

test('repeats are averaged per task, and unpaired tasks are reported not silently dropped', () => {
  const a = [{ task: 'x', pass: 1 }, { task: 'x', pass: 0 }, { task: 'only-a', pass: 1 }];
  const b = [{ task: 'x', pass: 1 }, { task: 'x', pass: 1 }, { task: 'only-b', pass: 1 }];
  const s = pairedStats(a, b, { minN: 1 });
  assert.equal(s.n, 1);
  assert.equal(s.diffs[0].diff, 0.5);
  assert.deepEqual(s.unpaired.sort(), ['only-a', 'only-b']);
});

test('identical arms: mean 0, se 0, no-difference', () => {
  const s = pairedStats(rows(Array(30).fill(1)), rows(Array(30).fill(1)));
  assert.equal(s.mean, 0);
  assert.equal(s.verdict, 'no-difference');
});

test('lower-is-better metrics (claimed-but-failed) flip the verdict: fewer is a win', () => {
  const a = rows(Array(30).fill(1));
  const b = rows([...Array(10).fill(1), ...Array(20).fill(0)]);
  assert.equal(pairedStats(a, b, { better: 'lower' }).verdict, 'win');
  assert.equal(pairedStats(b, a, { better: 'lower' }).verdict, 'loss');
  assert.equal(pairedStats(a, a, { better: 'lower' }).verdict, 'no-difference');
});
