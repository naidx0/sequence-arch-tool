/**
 * Locking tests for the per-repo child-process runner.
 *
 * These exist because of H11: the full tier could not finish. All 27 repos ran
 * in ONE Node process, and the run wedged on n8n — 34+ minutes at 102% CPU with
 * RSS flat — while n8n measured alone takes ~148s. The documented `--timeout-ms`
 * could not help, because it was a `Promise.race` that abandoned the loser: Node
 * cannot interrupt a synchronous WASM parse from inside the same process.
 *
 * So two properties must be locked, and neither can be locked by inspecting a
 * result row:
 *
 *  1. **Each repo really gets its own process.** Proved by pid, not by reading
 *     the code that spawns it.
 *  2. **The timeout really kills.** Proved against a child that is spinning in a
 *     SYNCHRONOUS busy loop — the exact shape the old timeout could not touch.
 *     A test that used `await new Promise(() => {})` would pass against the
 *     broken implementation too, and would prove nothing.
 *
 * Plus the honest-failure-row contracts: a killed repo, a crashed child and an
 * unreadable result each become a row naming the repo, not a silent hole.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRepoInChild, runAllRepos, CHILD_MODULE } from '../lib/runner.mjs';
import { failureRow } from '../lib/measure.mjs';

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-runner-test-'));

/** Write a stand-in child module and return its path. */
function fakeChild(name, body) {
  const p = path.join(FIXTURES, `${name}.mjs`);
  fs.writeFileSync(
    p,
    `import fs from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
const job = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--job') + 1], 'utf8'));
${body}
`
  );
  return p;
}

/** A child that reports its own pid inside an otherwise ordinary OK row. */
const PID_CHILD = fakeChild(
  'pid',
  `fs.writeFileSync(out, JSON.stringify({ id: job.row.id, ok: true, elapsedMs: 1, pid: process.pid }));`
);

/**
 * A child that spins the CPU synchronously forever. This is the case the old
 * in-process timeout provably could not stop.
 */
const SPIN_CHILD = fakeChild('spin', `for (;;) { Math.sqrt(Math.random()); }`);

/** A child that exits non-zero having written nothing. */
const CRASH_CHILD = fakeChild('crash', `process.exit(3);`);

/** A child that writes a result file that is not JSON. */
const GARBAGE_CHILD = fakeChild('garbage', `fs.writeFileSync(out, 'not json at all {');`);

const row = (id) => ({ id, sha: 'x'.repeat(40) });
const cfg = (childModule, timeoutMs = 30_000) => ({
  timeoutMs,
  ioDir: path.join(FIXTURES, 'io'),
  childModule,
});

test('every repo is measured in a FRESH process — the whole point of the fix', async () => {
  const a = await runRepoInChild({ row: row('alpha'), dir: '/tmp', opts: {} }, cfg(PID_CHILD));
  const b = await runRepoInChild({ row: row('beta'), dir: '/tmp', opts: {} }, cfg(PID_CHILD));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.ok(Number.isInteger(a.pid) && a.pid > 0, 'child reported no pid');
  assert.notEqual(a.pid, b.pid, 'two repos shared a process — the WASM heap would be shared too');
  assert.notEqual(a.pid, process.pid, 'the repo was measured in the parent, not a child');
});

test('the per-repo timeout KILLS a synchronous busy loop, and says so honestly', async () => {
  const started = Date.now();
  const r = await runRepoInChild({ row: row('spinner'), dir: '/tmp', opts: {} }, cfg(SPIN_CHILD, 1_200));
  const elapsed = Date.now() - started;

  assert.equal(r.ok, false, 'a repo that blew its cap must be a failure row');
  assert.equal(r.error.name, 'RepoTimeoutError');
  assert.match(r.error.message, /spinner/, 'the row must name the repo');
  assert.match(r.error.message, /1200ms per-repo cap/, 'the row must name the cap it blew');
  assert.match(r.error.message, /killed after \d+ms/, 'the row must name the elapsed time');
  assert.equal(r.id, 'spinner');
  assert.equal(r.counts, null);
  assert.ok(r.elapsedMs >= 1_200, `elapsedMs (${r.elapsedMs}) should cover the whole attempt`);
  // The real assertion: control came back at all, and near the cap rather than
  // whenever an infinite loop happened to end (it never does).
  assert.ok(elapsed < 15_000, `the kill did not land — took ${elapsed}ms`);
});

test('a child that dies without a result becomes an honest failure row, not a hole', async () => {
  const r = await runRepoInChild({ row: row('crasher'), dir: '/tmp', opts: {} }, cfg(CRASH_CHILD));
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'ChildCrashError');
  assert.match(r.error.message, /crasher/);
  assert.match(r.error.message, /code 3/);
});

test('an unreadable result row is reported, never silently treated as a pass', async () => {
  const r = await runRepoInChild({ row: row('garbage'), dir: '/tmp', opts: {} }, cfg(GARBAGE_CHILD));
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'ChildResultError');
  assert.match(r.error.message, /garbage/);
});

test('a stale row from a previous run is never mistaken for this run’s result', async () => {
  const ioDir = path.join(FIXTURES, 'io');
  fs.mkdirSync(ioDir, { recursive: true });
  fs.writeFileSync(path.join(ioDir, 'crasher.row.json'), JSON.stringify({ id: 'crasher', ok: true }));
  const r = await runRepoInChild({ row: row('crasher'), dir: '/tmp', opts: {} }, cfg(CRASH_CHILD));
  assert.equal(r.ok, false, 'the previous run’s green row was reused');
});

test('runAllRepos keeps manifest order and passes clone errors straight through', async () => {
  const targets = [
    { row: row('one'), dir: '/tmp', cloneError: null },
    { row: row('nope'), dir: null, cloneError: 'git fetch said no' },
    { row: row('two'), dir: '/tmp', cloneError: null },
  ];
  const rows = await runAllRepos(targets, {
    opts: {},
    timeoutMs: 30_000,
    ioDir: path.join(FIXTURES, 'io'),
    childModule: PID_CHILD,
    cloneErrorRow: (t) => ({ id: t.row.id, ok: false, error: { name: 'CloneError', message: t.cloneError } }),
  });
  assert.deepEqual(rows.map((r) => r.id), ['one', 'nope', 'two']);
  assert.equal(rows[1].error.name, 'CloneError');
  assert.notEqual(rows[0].pid, rows[2].pid);
});

test('--concurrency > 1 still returns every row, in manifest order', async () => {
  const targets = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ row: row(id), dir: '/tmp', cloneError: null }));
  const rows = await runAllRepos(targets, {
    opts: {},
    timeoutMs: 30_000,
    concurrency: 3,
    ioDir: path.join(FIXTURES, 'io-par'),
    childModule: PID_CHILD,
    cloneErrorRow: () => assert.fail('no clone errors here'),
  });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(new Set(rows.map((r) => r.pid)).size, 5, 'concurrent repos must not share a process either');
});

/**
 * `results.jsonl` is this gate's evidence trail and other things read it. The
 * key list below is the shape the single-process harness emitted for a failed
 * repo, copied from it verbatim — moving the measurement into a child must not
 * quietly rename or drop a field.
 */
test('a failure row keeps the historical JSONL shape, field for field and in order', () => {
  const r = failureRow({ id: 'x', sha: 'a'.repeat(40) }, '/tmp/x', 42, { name: 'E', message: 'm', stack: null });
  // The historical keys, verbatim. A NEW metric may add a field (U30 added
  // `evidenceResolvedPct`, `stemPlays`, `stemHops`); nothing may rename, drop or
  // reorder one of these, because a reader of an old `results.jsonl` still
  // expects them. So: every historical key present, in the historical order.
  const HISTORICAL = [
    'id', 'sha', 'dir', 'negativeCase', 'why', 'ok', 'elapsedMs', 'rssMb',
    'counts', 'evidencePct', 'fallbackTitlePct', 'dupTitleCount', 'promptChars',
    'promptSize', 'stemFound', 'scoreVsTruth', 'warnings', 'error',
  ];
  const keys = Object.keys(r);
  for (const k of HISTORICAL) assert.ok(keys.includes(k), `failure row lost the ${k} field`);
  assert.deepEqual(keys.filter((k) => HISTORICAL.includes(k)), HISTORICAL, 'historical fields reordered');
  assert.equal(r.ok, false);
  assert.deepEqual(r.warnings, []);
  // Every added field must still be present-and-null, never absent: a consumer
  // must never have to tell "no value" apart from "this harness is older".
  for (const k of ['evidenceResolvedPct', 'stemPlays', 'stemHops']) {
    assert.ok(k in r, `failure row must carry ${k}`);
    assert.equal(r[k], null);
  }
});

test('the real child module exists and is what the runner defaults to', () => {
  assert.ok(fs.existsSync(CHILD_MODULE), `${CHILD_MODULE} is missing`);
  assert.match(CHILD_MODULE, /lib[/\\]child\.mjs$/);
});
