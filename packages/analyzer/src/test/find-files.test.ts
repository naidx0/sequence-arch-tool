import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dropFindFiles, findFiles, peekFindFilesIndex, warmFindFiles } from '../explain/findFiles.js';
import { createFindFilesLearner, findFilesModelBaseId } from '../explain/findFilesLearn.js';
import { askLtrModel, rankAskFileLtrScored } from '../explain/askLtr.js';
import { hitAtK, trainResidualTrees, treesFromJson, treesToJson, withResidualTrees, type LtrExample } from '../explain/ltrTrain.js';
import { predictLightGbm } from '../explain/lightgbm.js';
import { buildLtrGoldenRepo } from './ltrGoldenRepo.js';

/**
 * find_files (round: prime proposal 2): the trained ranker as an agent tool, and
 * its per-repo retraining from the files the agent actually changed.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function goldenRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-findfiles-')));
  buildLtrGoldenRepo(dir);
  return dir;
}

async function ready(dir: string): Promise<void> {
  warmFindFiles(dir);
  await findFiles(dir, 'warm up', { noLog: true, waitMs: 60_000 });
  const idx = peekFindFilesIndex(dir);
  if (idx?.ltrPending) await idx.ltrPending;
}

test('find_files: the file the question is about comes back first, with a reason and a snippet, inside the budget', async () => {
  const dir = goldenRepo();
  try {
    await ready(dir);
    const r = await findFiles(dir, 'token refresh race in `refreshToken`', { noLog: true });
    assert.equal(r.ranker, 'frozen');
    assert.equal(r.files.length, 5);
    assert.ok(r.ranking.slice(0, 3).includes('src/auth/session.ts'), r.ranking.join(', '));
    const top = r.files.find((f) => f.path === 'src/auth/session.ts')!;
    assert.match(top.reason, /defines `refreshToken`/);
    assert.ok(top.snippet && /refreshToken/.test(top.snippet.content), 'the snippet is the window that holds the question word');
    assert.ok(r.tokens <= 800, `${r.tokens} tokens`);
    assert.equal(r.text.split('\n')[0]!.startsWith('find_files: 5 of '), true);
    for (const f of r.files) assert.ok(!f.reason.includes('\n') && f.reason.length <= 150, f.reason);
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('find_files: k and the token budget are honoured, the tail is dropped with a note and the head is kept', async () => {
  const dir = goldenRepo();
  try {
    await ready(dir);
    const small = await findFiles(dir, 'SessionStore keeps a stale session after logout', { noLog: true, k: 8, budgetTokens: 150 });
    assert.ok(small.tokens <= 150, `${small.tokens} tokens`);
    assert.ok(small.files.length >= 1 && small.files.length < 8, `${small.files.length} files shown`);
    assert.match(small.text, /more omitted for the 150-token budget/);
    assert.deepEqual(small.files.map((f) => f.path), small.ranking.slice(0, small.files.length));
    const three = await findFiles(dir, 'SessionStore keeps a stale session after logout', { noLog: true, k: 3, budgetTokens: 4000 });
    assert.equal(three.files.length, 3);
    assert.equal(three.ranking.length, 3);
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('find_files: warm calls are fast; a cold call never waits past waitMs and says the index is warming', async () => {
  const dir = goldenRepo();
  try {
    const t0 = performance.now();
    const cold = await findFiles(dir, 'parse_config fails on an empty file', { noLog: true, waitMs: 0 });
    assert.ok(performance.now() - t0 < 1500, 'a cold call returns at once');
    assert.ok(cold.ranker === 'paths' || cold.ranker === 'hybrid' || cold.ranker === 'frozen');
    if (cold.ranker !== 'frozen') assert.match(cold.text, /warming/);
    await ready(dir);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) times.push((await findFiles(dir, 'button theme color is wrong', { noLog: true })).ms);
    times.sort((a, b) => a - b);
    assert.ok(times[2]! < 250, `median warm call ${times[2]} ms`);
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('find_files: a directory that is not a git repo answers with no files instead of failing', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-findfiles-nogit-')));
  try {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    const r = await findFiles(dir, 'where is a', { noLog: true, waitMs: 1500 });
    assert.ok(Array.isArray(r.files));
    assert.equal(fs.existsSync(path.join(dir, '.sequence')), false, 'nothing is written outside a git repo');
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('find_files: a symlink that leaves the repo is never read for a snippet', async () => {
  const dir = goldenRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-findfiles-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const topSecretRefreshToken = 1;\n');
    try {
      fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(dir, 'src', 'auth', 'refreshToken.ts'));
    } catch {
      return; // symlinks need privileges on some Windows machines
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'add link');
    await ready(dir);
    const r = await findFiles(dir, 'refreshToken topSecretRefreshToken', { noLog: true, k: 10 });
    assert.ok(!r.text.includes('topSecretRefreshToken'), 'text outside the repo must not reach the answer');
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

/* ───────────────────────── the trainer ───────────────────────── */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Queries whose one true file is the row with the largest feature 22 (cochange): a signal the frozen model underuses here. */
function synthetic(n: number, seed: number, noise = 0): LtrExample[] {
  const r = rng(seed);
  const out: LtrExample[] = [];
  for (let q = 0; q < n; q++) {
    const rows: number[][] = [];
    const labels: number[] = [];
    const truth = Math.floor(r() * 30);
    for (let c = 0; c < 30; c++) {
      const row = Array.from({ length: 39 }, () => r());
      row[1] = c + 1; // f50_rank
      row[22] = c === truth ? 0.9 + 0.1 * r() : r() * 0.8;
      rows.push(row);
      labels.push(noise > 0 ? (r() < noise && c === Math.floor(r() * 30) ? 1 : 0) : c === truth ? 1 : 0);
    }
    if (noise > 0 && !labels.some((l) => l > 0)) labels[0] = 1;
    out.push({ rows, labels });
  }
  return out;
}

test('trainer: residual trees learn a signal the frozen model leaves on the table, and the frozen trees are untouched', async () => {
  const base = askLtrModel();
  const train = synthetic(80, 11);
  const test = synthetic(60, 12);
  const trees = await trainResidualTrees(base, train, { rounds: 40 });
  assert.ok(trees.length > 0 && trees.length <= 40);
  const next = withResidualTrees(base, trees);
  assert.equal(base.trees.length, 150, 'the shipped model is not mutated');
  assert.equal(next.trees.length, 150 + trees.length);
  const h1 = (m: typeof base) => test.reduce((s, e) => s + (hitAtK(m, e, 1) ?? 0), 0) / test.length;
  assert.ok(h1(next) > h1(base) + 0.15, `hit@1 ${h1(base)} -> ${h1(next)}`);
  for (const t of trees) assert.ok(t.numLeaves >= 2 && t.numLeaves <= 4);
});

test('trainer: it yields to the event loop every round and stops when cancelled', async () => {
  const base = askLtrModel();
  let yields = 0;
  let stop = false;
  const trees = await trainResidualTrees(base, synthetic(40, 3), {
    rounds: 30,
    yieldNow: async () => {
      yields++;
      if (yields === 5) stop = true;
      await new Promise((r) => setImmediate(r));
    },
    cancelled: () => stop,
  });
  assert.equal(yields, 5);
  assert.equal(trees.length, 5);
});

test('trainer: no query with both a positive and a negative candidate trains nothing', async () => {
  const base = askLtrModel();
  const ex = synthetic(3, 5).map((e) => ({ rows: e.rows, labels: e.labels.map(() => 0) }));
  assert.deepEqual(await trainResidualTrees(base, ex), []);
  assert.deepEqual(await trainResidualTrees(base, []), []);
});

test('trees survive a JSON round trip bit for bit, and a corrupt file is refused', async () => {
  const base = askLtrModel();
  const trees = await trainResidualTrees(base, synthetic(40, 9), { rounds: 6 });
  const back = treesFromJson(JSON.parse(JSON.stringify(treesToJson(trees))), 39)!;
  const row = synthetic(1, 77)[0]!.rows[3]!;
  assert.equal(predictLightGbm(withResidualTrees(base, back), row), predictLightGbm(withResidualTrees(base, trees), row));
  assert.equal(treesFromJson([{ n: 3, f: [99, 1], t: [0, 0], l: [1, -1], r: [-2, -3], v: [0, 0, 0] }], 39), null, 'a feature index past 38');
  assert.equal(treesFromJson([{ n: 3, f: [1, 1], t: [0, 0], l: [5, -1], r: [-2, -3], v: [0, 0, 0] }], 39), null, 'a child past the tree');
  assert.equal(treesFromJson('nope', 39), null);
  assert.equal(treesFromJson([{ n: 2, f: [1], t: [NaN], l: [-1], r: [-2], v: [0, 0] }], 39), null, 'NaN threshold');
});

/* ───────────────────────── learning from the files the agent changed ───────────────────────── */

test('learning: a query is labelled with the files changed after it (and kept), not with files that were already edited, and a retrain is logged and guarded', { timeout: 300_000 }, async () => {
  const dir = goldenRepo();
  try {
    const files = git(dir, 'ls-files', 'src').trim().split('\n').filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length >= 12, `${files.length} source files`);
    await ready(dir);
    const learner = createFindFilesLearner(dir, { matureMs: 0, maintainDelayMs: 3_600_000 });
    const model0 = learner.currentModel();
    assert.equal(model0.kind, 'frozen');
    const labelled: string[] = [];
    for (let i = 0; i < 36; i++) {
      const f = files[i % files.length]!;
      const stem = path.basename(f).replace(/\.[^.]+$/, '');
      /* the same rows find_files logs */
      const ranked = rankAskFileLtrScored(peekFindFilesIndex(dir)!, `change the ${stem} behaviour`, askLtrModel());
      learner.recordQuery(`change the ${stem} behaviour`, { cands: ranked.ranked.map((x) => x.path), rows: ranked.ranked.map((x) => x.row) });
      await learner.idle();
      fs.appendFileSync(path.join(dir, f), `\n// edit ${i}\n`);
      const n = await learner.matureNow(Date.now() + 60_000);
      if (n > 0) labelled.push(f);
    }
    const labels = fs.readFileSync(path.join(dir, '.sequence', 'findfiles', 'labels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { files: string[] });
    assert.equal(labels.length, 36);
    /* each query's label is the one file edited after it; files edited before it (dirty at query time) are not in it */
    labels.forEach((l, i) => {
      const f = files[i % files.length]!;
      if (i < files.length) assert.deepEqual(l.files, [f], `query ${i}`);
      else assert.ok(l.files.includes(f), `query ${i} labelled ${l.files.join(',')}`);
      assert.ok(l.files.length <= 8);
    });
    assert.equal(git(dir, 'status', '--porcelain').includes('.sequence'), false, '.sequence/ stays out of git status');
    const rep = await learner.retrainNow({ minLabels: 30, minNew: 10, rounds: 20 });
    assert.ok(rep, 'enough labels: a retrain was attempted');
    assert.equal(rep!.held, 7);
    assert.ok(fs.existsSync(path.join(dir, '.sequence', 'findfiles', 'attempts.jsonl')));
    if (rep!.deployed) {
      assert.ok(rep!.next.hit5 >= rep!.base.hit5 && rep!.next.hit1 >= rep!.base.hit1, 'a deployed model is no worse on the held-out queries');
      assert.equal(createFindFilesLearner(dir).currentModel().kind, 'repo');
    } else {
      assert.equal(createFindFilesLearner(dir).currentModel().kind, 'frozen');
    }
    assert.equal(await learner.retrainNow({ minLabels: 30, minNew: 10 }), null, 'nothing new since the last attempt: no second attempt');
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learning: too few labels, a reverted edit, and a query the agent never acted on train nothing', async () => {
  const dir = goldenRepo();
  try {
    await ready(dir);
    const learner = createFindFilesLearner(dir, { matureMs: 0, maintainDelayMs: 3_600_000 });
    const rec = async (q: string) => {
      const r = rankAskFileLtrScored(peekFindFilesIndex(dir)!, q, askLtrModel());
      learner.recordQuery(q, { cands: r.ranked.map((x) => x.path), rows: r.ranked.map((x) => x.row) });
      await learner.idle();
      return r.ranked[0]!.path;
    };
    const top = await rec('format the feature flag');
    fs.appendFileSync(path.join(dir, top), '\n// tmp\n');
    git(dir, 'checkout', '--', top); // the user reverted it: not an accepted edit
    assert.equal(await learner.matureNow(Date.now() + 60_000), 0);
    await rec('zeta theta');
    assert.equal(await learner.matureNow(Date.now() + 60_000), 0, 'no edit after the query: no label');
    assert.equal(await learner.retrainNow({ minLabels: 1, minNew: 1 }), null);
    assert.equal(learner.currentModel().kind, 'frozen');
    /* a query older than six hours is dropped, not labelled with whatever changed since */
    await rec('button theme color is wrong');
    fs.appendFileSync(path.join(dir, top), '\n// later\n');
    assert.equal(await learner.matureNow(Date.now() + 7 * 3600_000), 0);
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learning: a corrupt model.json, or one trained against another base model, is ignored', async () => {
  const dir = goldenRepo();
  try {
    const d = path.join(dir, '.sequence', 'findfiles');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'model.json'), '{ not json');
    assert.equal(createFindFilesLearner(dir).currentModel().kind, 'frozen');
    fs.writeFileSync(path.join(d, 'model.json'), JSON.stringify({ v: 1, base: 'some-other-model', trees: [] }));
    assert.equal(createFindFilesLearner(dir).currentModel().kind, 'frozen');
    fs.writeFileSync(path.join(d, 'model.json'), JSON.stringify({ v: 1, base: 'x', trees: [{ n: 3, f: [999, 1], t: [0, 0], l: [1, -1], r: [-2, -3], v: [0, 0, 0] }] }));
    assert.equal(createFindFilesLearner(dir).currentModel().kind, 'frozen');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learning: SEQUENCE_FIND_FILES_LEARN=0 logs nothing and trains nothing', async () => {
  const dir = goldenRepo();
  const prev = process.env.SEQUENCE_FIND_FILES_LEARN;
  process.env.SEQUENCE_FIND_FILES_LEARN = '0';
  try {
    const learner = createFindFilesLearner(dir, { matureMs: 0 });
    learner.recordQuery('x', { cands: ['a'], rows: [new Array(39).fill(0)] });
    await learner.idle();
    assert.equal(fs.existsSync(path.join(dir, '.sequence')), false);
    assert.equal(await learner.retrainNow({ minLabels: 1, minNew: 1 }), null);
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_FIND_FILES_LEARN;
    else process.env.SEQUENCE_FIND_FILES_LEARN = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learning: a linked worktree keeps what it learns in the main checkout, which outlives it', async () => {
  const dir = goldenRepo();
  const wt = path.join(os.tmpdir(), `seq-findfiles-wt-${process.pid}`);
  try {
    git(dir, 'worktree', 'add', '--detach', wt);
    const learner = createFindFilesLearner(wt, { storeRoot: dir, matureMs: 0 });
    learner.recordQuery('format the feature flag', { cands: ['src/a.ts'], rows: [new Array(39).fill(0)] });
    await learner.idle();
    assert.ok(fs.existsSync(path.join(dir, '.sequence', 'findfiles', 'queries.jsonl')));
    assert.equal(fs.existsSync(path.join(wt, '.sequence', 'findfiles')), false);
  } finally {
    try { git(dir, 'worktree', 'remove', '--force', wt); } catch { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────── review of find-files, item 5 ───────────── */

test('a model.json whose tree loops back on itself is refused (it passed the range checks and hung every call), and the frozen model answers', async () => {
  const loop = [{ n: 3, f: [1, 2], t: [0, 0], l: [0, -1], r: [-2, -3], v: [0, 0, 0] }];
  assert.equal(treesFromJson(loop, 39), null, 'node 0 is its own child');
  assert.equal(treesFromJson([{ n: 3, f: [1, 2], t: [0, 0], l: [1, -1], r: [-1, -3], v: [0, 0, 0] }], 39), null, 'a leaf reached twice, another never');
  assert.equal(treesFromJson([{ n: 2, f: [1], t: [0], l: [-1], r: [-2], v: [1e9, 0] }], 39), null, 'a leaf value no residual tree can have');
  const dir = goldenRepo();
  try {
    const d = path.join(dir, '.sequence', 'findfiles');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'model.json'), JSON.stringify({ v: 1, base: findFilesModelBaseId(), trees: loop }));
    assert.equal(createFindFilesLearner(dir).currentModel().kind, 'frozen');
    await ready(dir);
    const r = await findFiles(dir, 'format the feature flag', { noLog: true });
    assert.equal(r.ranker, 'frozen');
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learning: a chat worktree and the main checkout share one store, but each labels only its own queries with its own edits', async () => {
  const dir = goldenRepo();
  const wt = path.join(fs.realpathSync(os.tmpdir()), `seq-findfiles-wt2-${process.pid}`);
  try {
    git(dir, 'worktree', 'add', '-q', '--detach', wt);
    const inWt = createFindFilesLearner(wt, { storeRoot: dir, matureMs: 0, maintainDelayMs: 3_600_000 });
    const inMain = createFindFilesLearner(dir, { matureMs: 0, maintainDelayMs: 3_600_000 });
    const files = git(dir, 'ls-files', 'src').trim().split('\n').filter((f) => /\.(ts|tsx)$/.test(f));
    const target = files[0]!;
    inWt.recordQuery('change the first module', { cands: files.slice(0, 10), rows: files.slice(0, 10).map(() => new Array(39).fill(0)) });
    await inWt.idle();
    /* The user edits the main checkout; the chat (in the worktree) changed nothing. */
    fs.appendFileSync(path.join(dir, target), '\n// edited in the main checkout\n');
    assert.equal(await inMain.matureNow(Date.now() + 60_000), 0, "the main checkout's edit is not the worktree query's label");
    assert.equal(await inWt.matureNow(Date.now() + 60_000), 0, 'nothing changed in the worktree');
    const labels = fs.readFileSync(path.join(dir, '.sequence', 'findfiles', 'labels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { files: string[] });
    assert.deepEqual(labels.map((l) => l.files), [[]]);
    /* Now the chat edits the same file in its worktree: that is its label. */
    inWt.recordQuery('change the first module again', { cands: files.slice(0, 10), rows: files.slice(0, 10).map(() => new Array(39).fill(0)) });
    await inWt.idle();
    fs.appendFileSync(path.join(wt, target), '\n// edited by the chat\n');
    assert.equal(await inMain.matureNow(Date.now() + 60_000), 0);
    assert.equal(await inWt.matureNow(Date.now() + 60_000), 1);
  } finally {
    try { git(dir, 'worktree', 'remove', '--force', wt); } catch { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
