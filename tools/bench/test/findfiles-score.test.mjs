import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSpawnOk, checkpointValid, clusteredSE, outName, sealGuard, sigMark, wilsonCI, wilsonOf,
  bootstrapCI, hashSeed, hitAtK, isAnswerFile, isGenerated, isLockfile, judgeCommit, mean, pairedDiff, precisionOf,
  recallAtK, recallOf, rng, sample, se, subjectNamesPath, tokensOfChars,
} from '../lib/findfiles-score.mjs';

test('hit@k and recall@k', () => {
  const truth = ['a.js', 'b.js'];
  assert.equal(hitAtK(['x', 'a.js', 'y'], truth, 1), 0);
  assert.equal(hitAtK(['x', 'a.js', 'y'], truth, 2), 1);
  assert.equal(hitAtK([], truth, 5), 0);
  assert.equal(recallAtK(['a.js', 'x', 'b.js'], truth, 2), 0.5);
  assert.equal(recallAtK(['a.js', 'x', 'b.js'], truth, 3), 1);
  assert.equal(recallAtK(['a.js'], [], 5), 0);
});

test('closure recall and precision', () => {
  assert.equal(recallOf(['a', 'b', 'z'], ['a', 'b', 'c', 'd']), 0.5);
  assert.equal(recallOf([], []), 1);
  assert.equal(precisionOf(['a', 'b', 'z'], ['a', 'b']), 2 / 3);
  assert.equal(precisionOf([], ['a']), 1);
});

test('seeded rng and sample are reproducible and distinct', () => {
  const a = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, rng(7));
  const b = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, rng(7));
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 4);
  assert.notDeepEqual(a, sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, rng(8)));
  assert.equal(sample([1, 2], 9, rng(1)).length, 2);
  assert.notEqual(hashSeed('flask'), hashSeed('gin'));
});

test('bootstrap CI brackets the mean, is seeded, and collapses on a constant', () => {
  const xs = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1];
  const ci = bootstrapCI(xs, { seed: 3 });
  assert.equal(ci.mean, mean(xs));
  assert.ok(ci.lo <= ci.mean && ci.mean <= ci.hi);
  assert.deepEqual(ci, bootstrapCI(xs, { seed: 3 }));
  const flat = bootstrapCI([1, 1, 1, 1], { seed: 1 });
  assert.equal(flat.lo, 1);
  assert.equal(flat.hi, 1);
  assert.ok(Number.isNaN(bootstrapCI([]).mean));
});

test('paired difference: mean, SE and sign', () => {
  const s = [1, 1, 1, 0, 1, 1, 0, 1];
  const g = [0, 1, 0, 0, 1, 0, 0, 1];
  const d = pairedDiff(s, g, { seed: 5 });
  assert.equal(d.n, 8);
  assert.equal(d.mean, 3 / 8);
  const diffs = s.map((x, i) => x - g[i]);
  assert.ok(Math.abs(d.se - se(diffs)) < 1e-12);
  assert.ok(d.lo <= d.mean && d.mean <= d.hi);
  assert.throws(() => pairedDiff([1], [1, 2]));
  assert.equal(pairedDiff([1, 1], [1, 1]).z, 0);
});

test('lockfile, generated and answer-file classes', () => {
  for (const p of ['package-lock.json', 'a/b/yarn.lock', 'pnpm-lock.yaml', 'go.sum', 'poetry.lock', 'x/Cargo.lock']) assert.ok(isLockfile(p), p);
  for (const p of ['src/lock.ts', 'locksmith.py']) assert.ok(!isLockfile(p), p);
  for (const p of ['dist/a.js', 'a/b.min.js', 'x_pb2.py', 'api.pb.go', 'tests/__snapshots__/a.snap', 'node_modules/x/y.js']) assert.ok(isGenerated(p), p);
  assert.ok(isAnswerFile('src/flask/app.py'));
  assert.ok(!isAnswerFile('CHANGES.rst'));
  assert.ok(!isAnswerFile('package-lock.json'));
  assert.ok(!isAnswerFile('dist/app.js'));
});

test('subject naming a path literally', () => {
  const f = ['src/flask/app.py', 'lib/express.js'];
  assert.ok(subjectNamesPath('fix typo in app.py docstring', f));
  assert.ok(subjectNamesPath('Update src/flask/app.py', f));
  assert.ok(subjectNamesPath('Fix EXPRESS.JS crash', f));
  assert.ok(!subjectNamesPath('fix the app factory crash', f));
  assert.ok(!subjectNamesPath('rename happy.python helper', f));
  assert.ok(!subjectNamesPath('improve wrapper.js handling', ['lib/app.js']));
});

const base = { subject: 'fix retry delay computation for sessions', parents: 1, changed: [{ status: 'M', path: 'src/a.py' }], existsAtParent: () => true };
test('judgeCommit filters, each with its reason', () => {
  assert.deepEqual(judgeCommit(base), { ok: true, answer: ['src/a.py'] });
  assert.equal(judgeCommit({ ...base, parents: 2 }).reason, 'merge');
  assert.equal(judgeCommit({ ...base, subject: 'Bump foo from 1 to 2' }).reason, 'bot-or-release-subject');
  assert.equal(judgeCommit({ ...base, subject: 'Release 2.0.1' }).reason, 'bot-or-release-subject');
  assert.equal(judgeCommit({ ...base, subject: 'fix it' }).reason, 'subject<3-words');
  const many = Array.from({ length: 21 }, (_, i) => ({ status: 'M', path: `src/f${i}.py` }));
  assert.equal(judgeCommit({ ...base, changed: many }).reason, 'touches>20-files');
  assert.equal(judgeCommit({ ...base, changed: Array.from({ length: 9 }, (_, i) => ({ status: 'M', path: `src/f${i}.py` })) }).reason, 'answer>8-files');
  assert.equal(judgeCommit({ ...base, changed: [{ status: 'A', path: 'src/new.py' }] }).reason, 'no-indexable-modified-file');
  assert.equal(judgeCommit({ ...base, changed: [{ status: 'M', path: 'pnpm-lock.yaml' }, { status: 'M', path: 'README.md' }] }).reason, 'no-indexable-modified-file');
  assert.equal(judgeCommit({ ...base, existsAtParent: () => false }).reason, 'no-indexable-modified-file');
  assert.equal(judgeCommit({ ...base, subject: 'refactor a.py retry delay logic' }).reason, 'subject-names-a-path');
  /* lockfiles beside real files are dropped from the answer, not from the commit */
  assert.deepEqual(judgeCommit({ ...base, changed: [{ status: 'M', path: 'src/a.py' }, { status: 'M', path: 'poetry.lock' }] }).answer, ['src/a.py']);
});

test('Wilson interval is non-degenerate at 0 and n', () => {
  const all = wilsonCI(50, 50);
  assert.equal(all.mean, 1);
  assert.ok(all.lo > 0.9 && all.lo < 1 && all.hi > 0.999);
  const none = wilsonCI(0, 50);
  assert.ok(none.lo === 0 && none.hi > 0 && none.hi < 0.1);
  const half = wilsonCI(25, 50);
  assert.ok(Math.abs(half.lo - 0.3664) < 1e-3 && Math.abs(half.hi - 0.6336) < 1e-3);
  assert.ok(Number.isNaN(wilsonCI(0, 0).mean));
  assert.equal(wilsonOf([1, 1, 0, 1]).mean, 0.75);
});

test('clustered SE (CR1) exceeds the naive SE when clusters differ, and is NaN with one cluster', () => {
  const vals = [1, 1, 1, 1, 0, 0, 0, 0];
  const ids = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'];
  /* cluster sums of (v - 0.5): +2 and -2 -> sqrt(2 * 8) / 8 = 0.5 */
  assert.ok(Math.abs(clusteredSE(vals, ids) - 0.5) < 1e-12);
  assert.ok(clusteredSE(vals, ids) > se(vals));
  assert.ok(Number.isNaN(clusteredSE(vals, vals.map(() => 'x'))));
  /* balanced within clusters -> sums cancel */
  assert.equal(clusteredSE([1, 0, 1, 0], ['a', 'a', 'b', 'b']), 0);
});

test('sigMark flags differences under 2 SE', () => {
  assert.equal(sigMark(0.1, 0.06), 'n.s.');
  assert.equal(sigMark(0.2, 0.06), '');
  assert.equal(sigMark(0.2, NaN), 'n.s.');
  assert.equal(sigMark(-0.2, 0.06), '');
});

test('partial runs never take the full-run file name', () => {
  assert.equal(outName('bench-findfiles', '2026-10-15', 'json', false), 'bench-findfiles-2026-10-15.json');
  assert.equal(outName('bench-findfiles', '2026-10-15', 'json', true), 'bench-findfiles-2026-10-15-partial.json');
});

test('checkpoints are reused only under the same questions sha and build hash', () => {
  const ck = { stamp: { questions: 'q1', build: 'b1' }, rows: [] };
  assert.ok(checkpointValid(ck, { questions: 'q1', build: 'b1' }));
  assert.ok(!checkpointValid(ck, { questions: 'q2', build: 'b1' }));
  assert.ok(!checkpointValid(ck, { questions: 'q1', build: 'b2' }));
  assert.ok(!checkpointValid([], { questions: 'q1', build: 'b1' }));
  assert.ok(!checkpointValid(null, { questions: 'q1', build: 'b1' }));
});

test('assertSpawnOk throws on spawn errors and exit >= 2 but not on exit 1 (no match)', () => {
  assertSpawnOk({ status: 0 }, 'x');
  assertSpawnOk({ status: 1 }, 'x');
  assert.throws(() => assertSpawnOk({ error: new Error('ENOENT'), status: null }, 'rg'), /rg: ENOENT/);
  assert.throws(() => assertSpawnOk({ status: 2, stderr: 'bad regex' }, 'rg'), /exit 2.*bad regex/);
  assert.throws(() => assertSpawnOk({ status: null, signal: 'SIGKILL' }, 'rg'), /SIGKILL/);
});

test('sealGuard refuses to replace an existing seal without force', () => {
  sealGuard(false, false);
  sealGuard(true, true);
  assert.throws(() => sealGuard(true, false), /sealed/);
});

test('tokens are chars/4 rounded up', () => {
  assert.equal(tokensOfChars(0), 0);
  assert.equal(tokensOfChars(1), 1);
  assert.equal(tokensOfChars(8), 2);
  assert.equal(tokensOfChars(9), 3);
});

test('posixRgPath turns a Windows rg path into the repo-relative forward-slash path', async () => {
  const { posixRgPath } = await import('../lib/findfiles-score.mjs');
  assert.equal(posixRgPath('.\\src\\flask\\app.py'), 'src/flask/app.py');
  assert.equal(posixRgPath('./src/flask/app.py'), 'src/flask/app.py');
  assert.equal(posixRgPath('src/flask/app.py'), 'src/flask/app.py');
});
