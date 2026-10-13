import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { listTasks, applySolution } from './taskset.mjs';
import { runArm, assertSealed } from './task-run.mjs';
import { pairedStats } from './stats.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const tasks = listTasks();

// Fast scripted agents (no agent loop): they prove scoring and stats on the whole sealed set.
const oracle = async (task, dir) => { applySolution(task, dir); return { claimedPass: true, ms: 1, toolCalls: 1 }; };
const idle = async () => ({ claimedPass: true, ms: 1, toolCalls: 0 });
const odd = async (task, dir) => (Number(/^t(\d+)/.exec(task.id)[1]) % 2 ? oracle(task, dir) : idle());
// Cheats: rewrites the test to pass. Scoring restores the test, so this must score 0.
const cheat = async (task, dir) => {
  fs.writeFileSync(path.join(dir, 'test/mod.test.js'), "import test from 'node:test';\ntest('x', () => {});\n");
  return { claimedPass: true, ms: 1, toolCalls: 1 };
};

test('the runner refuses to run when the set no longer matches SEALED.md', () => {
  assert.match(assertSealed(), /^[0-9a-f]{64}$/);
});

test('end to end on the whole set: idle fails every task, oracle passes every task, win verdict and its controls', async () => {
  const a = await runArm({ label: 'idle', tasks, agent: idle });
  const b = await runArm({ label: 'oracle', tasks, agent: oracle });
  assert.equal(a.filter((r) => r.pass).length, 0);
  assert.equal(b.filter((r) => r.pass).length, tasks.length);
  assert.equal(a.every((r) => r.claimedFail === 1), true, 'idle claimed success on every task and failed every task');
  assert.equal(b.every((r) => r.claimedFail === 0), true);
  const win = pairedStats(a, b);
  assert.equal(win.n, tasks.length);
  assert.equal(win.verdict, 'win');
  assert.equal(pairedStats(b, b).verdict, 'no-difference', 'identical arms never win');
  assert.equal(pairedStats(b, a).verdict, 'loss');
  assert.equal(pairedStats(a, b, { key: 'claimedFail', better: 'lower' }).verdict, 'win', 'claimed-but-failed went DOWN, and fewer is better');
});

test('half-solving arm is scored by the test it ran, not by what it claimed', async () => {
  const rows = await runArm({ label: 'odd', tasks, agent: odd });
  const solved = rows.filter((r) => r.pass).length;
  assert.equal(solved, tasks.filter((t) => Number(/^t(\d+)/.exec(t.id)[1]) % 2 === 1).length);
  assert.equal(rows.filter((r) => r.claimedFail).length, tasks.length - solved);
});

test('editing the test file does not score', async () => {
  const rows = await runArm({ label: 'cheat', tasks: tasks.slice(0, 3), agent: cheat });
  assert.deepEqual(rows.map((r) => r.pass), [0, 0, 0]);
  assert.equal(rows.every((r) => r.testsRestored), true);
});

test('the CLI --dry drives the real agent loop with a scripted model (2 tasks)', () => {
  const dist = path.resolve(HERE, '..', '..', '..', 'packages', 'analyzer', 'dist');
  if (!fs.existsSync(path.join(dist, 'server', 'askPipeline.js'))) return; // analyzer not built in this checkout
  const r = spawnSync(process.execPath, [path.join(HERE, 'task-run.mjs'), '--dry', '--limit', '2'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pass rate  null 0\.000  half 0\.500  oracle 1\.000/);
  assert.match(r.stdout, /verdict: underpowered/);
});

test('rows record the seal, and --compare refuses rows from different sets', async () => {
  const rowsA = await runArm({ label: 'a', tasks: tasks.slice(0, 1), agent: idle });
  assert.match(rowsA[0].seal, /^[0-9a-f]{64}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cmp-'));
  try {
    const fa = path.join(dir, 'a.jsonl');
    const fb = path.join(dir, 'b.jsonl');
    fs.writeFileSync(fa, JSON.stringify(rowsA[0]) + '\n');
    fs.writeFileSync(fb, JSON.stringify({ ...rowsA[0], seal: '0'.repeat(64) }) + '\n');
    const bad = spawnSync(process.execPath, [path.join(HERE, 'task-run.mjs'), '--compare', fa, fb], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /different task sets|seal/i);
    const ok = spawnSync(process.execPath, [path.join(HERE, 'task-run.mjs'), '--compare', fa, fa], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--compare refuses rows whose seal is not the CURRENT SEALED.md, and rows with no seal', async () => {
  const [row] = await runArm({ label: 'a', tasks: tasks.slice(0, 1), agent: idle });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cmp2-'));
  try {
    const write = (name, r) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, JSON.stringify(r) + '\n');
      return f;
    };
    const stale = write('stale.jsonl', { ...row, seal: '1'.repeat(64) });
    const none = write('none.jsonl', Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'seal')));
    const good = write('good.jsonl', row);
    const run = (a, b) => spawnSync(process.execPath, [path.join(HERE, 'task-run.mjs'), '--compare', a, b], { encoding: 'utf8' });
    assert.notEqual(run(stale, stale).status, 0, 'two files from the same OLD set are still refused');
    assert.notEqual(run(none, none).status, 0, 'rows without a seal are refused');
    assert.notEqual(run(good, none).status, 0);
    assert.equal(run(good, good).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
