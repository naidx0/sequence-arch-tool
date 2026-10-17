import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGitDirs } from '../server/repoWatch.js';
import { FULL_ACCESS_FILE, hasFullAccessConsent, recordFullAccessConsent } from '../server/fullAccessConsent.js';
import { HeadTracker, type GitServerEvent } from '../server/gitBranchRoutes.js';
import { ensureSequenceIgnoredAsync, resetSequenceIgnoredCheck, sequenceIgnoreStats } from '../server/sequenceIgnore.js';
import { writeJson } from '../server/store.js';
import { eventually } from './load-scale.js';

/*
 * Phase 2B-2: no git call on the server's event loop. A SLOW FAKE git (node.exe
 * copied to git.exe, whose preload script blocks the CHILD for DELAY ms, then answers) is put first
 * on PATH; a 20 ms timer must keep ticking while each call is in flight. With a
 * synchronous git the timer is starved for the whole delay and ticks stay ~0.
 */

const DELAY_MS = 700;
const HEAD_SHA = 'a'.repeat(40);

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** `hold`: the fake git answers only once the test writes `<dir>/release` (and writes `<dir>/done` when it answers), so "git was still running" is a fact the test controls, not a number of milliseconds. */
function slowGit(hold = false): { dir: string; restore: () => void; release: () => void; finished: () => boolean } {
  const dir = tmp('seq-slowgit-');
  const exe = process.platform === 'win32' ? 'git.exe' : 'git';
  fs.copyFileSync(process.execPath, path.join(dir, exe));
  const script = path.join(dir, 'fake-git.cjs');
  fs.writeFileSync(
    script,
    [
      'const a = process.argv.slice(2);',
      '{',
      "  const gate = process.env.FAKE_HOLD_DIR; const fs = require('fs');",
      "  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
      "  if (gate) { const end = Date.now() + 60000; while (!fs.existsSync(gate + '/release') && Date.now() < end) nap(25); }",
      `  else nap(${DELAY_MS});`,
      "  const j = a.join(' ');",
      "  if (j.includes('--absolute-git-dir')) process.stdout.write(process.env.FAKE_GITDIR + '\\n' + process.env.FAKE_GITDIR + '\\n');",
      "  else if (j.includes('symbolic-ref')) process.stdout.write('refs/heads/main\\n');",
      `  else if (j.includes('rev-parse')) process.stdout.write('${HEAD_SHA}\\n');`,
      "  if (gate) fs.writeFileSync(gate + '/done', '1');",
      '  process.exit(0);',
      '}',
      '',
    ].join('\n'),
  );
  const saved: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    FAKE_GITDIR: process.env.FAKE_GITDIR,
    FAKE_HOLD_DIR: process.env.FAKE_HOLD_DIR,
  };
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  process.env[key] = dir + path.delimiter + (process.env[key] ?? '');
  process.env.NODE_OPTIONS = `--require ${script.replace(/\\/g, '/')}`;
  process.env.FAKE_GITDIR = path.join(dir, 'gitdir');
  if (hold) process.env.FAKE_HOLD_DIR = dir;
  else delete process.env.FAKE_HOLD_DIR;
  return {
    dir,
    release: () => fs.writeFileSync(path.join(dir, 'release'), '1'),
    finished: () => fs.existsSync(path.join(dir, 'done')),
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Run `fn` and count how many 20 ms timer ticks the loop managed meanwhile. */
async function ticksDuring<T>(fn: () => Promise<T>): Promise<{ value: T; ticks: number; ms: number }> {
  let ticks = 0;
  const t = setInterval(() => (ticks += 1), 20);
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ticks, ms: Date.now() - t0 };
  } finally {
    clearInterval(t);
  }
}

function assertLoopFree(r: { ticks: number; ms: number }, what: string): void {
  assert.ok(r.ms >= DELAY_MS - 100, `${what}: the fake git really was slow (${r.ms} ms)`);
  assert.ok(r.ticks >= 10, `${what}: the loop kept answering its timer during slow git (${r.ticks} ticks in ${r.ms} ms)`);
}

test('resolveGitDirs does not block the event loop while git is slow', async () => {
  const fake = slowGit();
  try {
    const want = path.resolve(process.env.FAKE_GITDIR!);
    const r = await ticksDuring(() => resolveGitDirs(os.tmpdir()));
    assert.deepEqual(r.value, { gitDir: want, commonDir: want });
    assertLoopFree(r, 'resolveGitDirs');
  } finally {
    fake.restore();
  }
});

test('resolveGitDirs resolves null (not a throw) when git fails', async () => {
  const notRepo = tmp('seq-notrepo-');
  try {
    assert.equal(await resolveGitDirs(path.join(notRepo, 'does-not-exist')), null);
  } finally {
    fs.rmSync(notRepo, { recursive: true, force: true });
  }
});

test('hasFullAccessConsent does not block the event loop while git is slow', async () => {
  const proj = tmp('seq-consent-');
  try {
    recordFullAccessConsent(proj); // before the slow git is installed
    assert.ok(fs.existsSync(path.join(proj, '.sequence', FULL_ACCESS_FILE)));
    const fake = slowGit();
    try {
      const r = await ticksDuring(() => hasFullAccessConsent(proj));
      assert.equal(r.value, true, 'fake ls-files prints nothing: untracked, consent counts');
      assertLoopFree(r, 'hasFullAccessConsent');
    } finally {
      fake.restore();
    }
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('HeadTracker.prime and check do not block the event loop while git is slow', async () => {
  const root = tmp('seq-head-');
  const fake = slowGit();
  try {
    const events: GitServerEvent[] = [];
    const tracker = new HeadTracker({ getRoot: () => root, rescan: async () => 'scan', emit: (e) => events.push(e) });
    const primed = await ticksDuring(() => tracker.prime());
    assertLoopFree(primed, 'HeadTracker.prime');
    const checked = await ticksDuring(() => tracker.check());
    assert.equal(checked.value.changed, false, 'HEAD did not move');
    assertLoopFree(checked, 'HeadTracker.check');
    assert.deepEqual(events, []);
  } finally {
    fake.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlapping HeadTracker.check calls emit one git:head for one move', async () => {
  const root = tmp('seq-head2-');
  const fake = slowGit();
  try {
    const events: GitServerEvent[] = [];
    const tracker = new HeadTracker({ getRoot: () => root, rescan: async () => 'scan', emit: (e) => events.push(e) });
    // a baseline that differs from the fake's answer (main at HEAD_SHA)
    const inner = tracker as unknown as { last: unknown; lastRoot: string };
    inner.last = { branch: 'old', sha: 'b'.repeat(40) };
    inner.lastRoot = root;
    const [a, b] = await Promise.all([tracker.check(), tracker.check()]);
    await Promise.all([a.done, b.done]);
    assert.equal([a.changed, b.changed].filter(Boolean).length, 1, 'exactly one of two overlapping checks saw the move');
    assert.equal(events.filter((e) => e.type === 'git:head').length, 1);
  } finally {
    fake.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureSequenceIgnoredAsync does not block the event loop while git is slow', async () => {
  const root = tmp('seq-ign-');
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  resetSequenceIgnoredCheck();
  const fake = slowGit();
  try {
    const r = await ticksDuring(() => ensureSequenceIgnoredAsync(root));
    assertLoopFree(r, 'ensureSequenceIgnoredAsync');
  } finally {
    fake.restore();
    resetSequenceIgnoredCheck();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sequenceIgnore gives git a timeout on both the async and the sync path', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../server/sequenceIgnore.js', import.meta.url)), 'utf8');
  assert.match(src, /GIT_CHECK_TIMEOUT_MS\s*=\s*10_000/);
  assert.ok(/execFile\(\s*'git',\s*CHECK_ARGS\(root\),\s*\{[^}]*timeout: GIT_CHECK_TIMEOUT_MS/.test(src), 'async path passes the timeout to git');
  assert.ok(/spawnSync\('git', CHECK_ARGS\(root\), \{[^}]*timeout: GIT_CHECK_TIMEOUT_MS/.test(src), 'sync path passes the timeout to git');
});

test('the git modules on the request path do not import execFileSync / spawnSync', () => {
  const dir = path.dirname(fileURLToPath(new URL('../server/repoWatch.js', import.meta.url)));
  for (const f of ['repoWatch.js', 'fullAccessConsent.js', 'gitBranchRoutes.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/execFileSync|spawnSync|execSync/.test(src), `${f} has no synchronous child-process call`);
  }
});

test('writeJson to a NEW root does not wait for a slow git (the ignore check runs in the background)', async () => {
  const root = tmp('seq-wj-');
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  resetSequenceIgnoredCheck();
  const fake = slowGit(true);
  try {
    writeJson(root, 'probe.json', { ok: true });
    /* The fake git is HELD until released, so a writeJson that waited for it would never have returned (it would sit until the
       fake's own 60 s limit) and the answer would already be in. Returning with git still unanswered is the whole claim, at any load. */
    assert.equal(fake.finished(), false, 'writeJson returned while git had not answered yet');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.sequence', 'probe.json'), 'utf8')), { ok: true });
    /* the check still happens, once, in the background */
    assert.ok(await eventually(() => sequenceIgnoreStats.gitCalls === 1), 'git was asked, off the loop');
    assert.equal(sequenceIgnoreStats.gitCalls, 1, 'git was asked, off the loop');
    writeJson(root, 'probe2.json', { ok: 2 });
    assert.equal(sequenceIgnoreStats.gitCalls, 1, 'a second write in flight does not spawn a second git');
    fake.release();
    assert.ok(await eventually(() => fake.finished()), 'the held git was released and answered');
  } finally {
    fake.release();
    await eventually(() => fake.finished(), 5000);
    fake.restore();
    resetSequenceIgnoredCheck();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

type Head = { branch: string | null; detached: boolean; sha: string | null };
const headOf = (branch: string): Head => ({ branch, detached: false, sha: branch.padEnd(40, '0') });
function manualReads(): { reads: Array<{ root: string; resolve: (h: Head) => void }>; readHead: (root: string) => Promise<Head> } {
  const reads: Array<{ root: string; resolve: (h: Head) => void }> = [];
  return { reads, readHead: (root) => new Promise<Head>((resolve) => reads.push({ root, resolve })) };
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test('HeadTracker: overlapping checks that finish out of order do not move the baseline backwards', async () => {
  const events: GitServerEvent[] = [];
  const { reads, readHead } = manualReads();
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead });
  const primed = tracker.prime();
  await tick();
  reads[0]!.resolve(headOf('main'));
  await primed;
  const a = tracker.check(); /* started first, reads the OLD head */
  const b = tracker.check(); /* started second, reads the NEW head */
  await tick();
  assert.equal(reads.length, 3);
  reads[2]!.resolve(headOf('feature'));
  const rb = await b;
  reads[1]!.resolve(headOf('main')); /* the older read lands last */
  const ra = await a;
  /* a rescan reads HEAD again: answer whatever is asked until the work is done */
  let finished = false;
  void Promise.all([ra.done, rb.done]).then(() => (finished = true));
  while (!finished) {
    await tick();
    for (const r of reads.splice(3)) r.resolve(headOf('feature'));
  }
  const heads = events.filter((e) => e.type === 'git:head') as Array<Extract<GitServerEvent, { type: 'git:head' }>>;
  assert.deepEqual(heads.map((h) => h.branch), ['feature'], 'one git:head, for the newest read; the stale one is dropped');
  assert.equal(ra.changed, false);
});

test('HeadTracker: a branch switch that lands while prime() is still reading is reported', async () => {
  const events: GitServerEvent[] = [];
  const { reads, readHead } = manualReads();
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead });
  void tracker.prime(); /* attach: not awaited, as repoServer does */
  const checked = tracker.check(); /* the switch route's check, during prime's git */
  /* Git answers in the order the world happened: prime read `main`, then the switch, then the check read `feature`. */
  for (let i = 0; i < 20 && !events.some((e) => e.type === 'git:head'); i++) {
    await tick();
    const next = reads.shift();
    if (next) next.resolve(headOf(reads.length === 0 && i > 0 ? 'feature' : 'main'));
  }
  const r = await checked;
  await r.done;
  const heads = events.filter((e) => e.type === 'git:head') as Array<Extract<GitServerEvent, { type: 'git:head' }>>;
  assert.equal(heads.length, 1, 'the switch was reported');
  assert.equal(heads[0]!.branch, 'feature');
  assert.equal(heads[0]!.previous.branch, 'main');
});

test('HeadTracker: a check that resolves before a late prime is not overwritten by it', async () => {
  const events: GitServerEvent[] = [];
  const { reads, readHead } = manualReads();
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead });
  const primed0 = tracker.prime();
  await tick();
  reads[0]!.resolve(headOf('main'));
  await primed0;
  const slowCheck = tracker.check(); /* reads the old head, slowly */
  await tick();
  const primeAgain = tracker.prime(); /* re-attach: a newer read of the baseline */
  await tick();
  reads[2]!.resolve(headOf('feature')); /* the newer prime lands first */
  await primeAgain;
  reads[1]!.resolve(headOf('main')); /* the older check lands after it */
  const r = await slowCheck;
  await r.done;
  const afterCheck = tracker.check();
  reads[3]!.resolve(headOf('feature'));
  const final = await afterCheck;
  assert.equal(final.changed, false, 'the baseline is still the newest read (feature)');
  assert.deepEqual(events.filter((e) => e.type === 'git:head'), [], 'no stale event announced');
});

test('HeadTracker: a switch whose git read for prime() lands AFTER the switch is still reported to the check that overlapped it', async () => {
  const events: GitServerEvent[] = [];
  let head = headOf('main');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const readHead = async (): Promise<Head> => {
    if (++calls === 1) await gate; /* prime's read: started before the switch, answered after it */
    return { ...head };
  };
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead });
  const primed = tracker.prime();
  head = headOf('feature'); /* the switch route's git checkout */
  const checking = tracker.check();
  release();
  const r = await checking;
  await primed;
  await r.done;
  assert.equal(r.changed, true, 'the check that overlapped the prime reports the possible move');
  assert.ok(events.some((e) => e.type === 'git:head'), JSON.stringify(events));
  assert.ok(events.some((e) => e.type === 'graph:updated'), 'and the board rescans');
  /* only once: the next, unrelated check with nothing moved reports nothing */
  const again = await tracker.check();
  await again.done;
  assert.equal(again.changed, false);
});

test('HeadTracker: the doubt survives when the check that took it finishes after a later check (two checks during a prime)', async () => {
  const events: GitServerEvent[] = [];
  let head = headOf('main');
  let fp = 'ref: refs/heads/main';
  let relPrime!: () => void;
  const gPrime = new Promise<void>((r) => (relPrime = r));
  let relA!: () => void;
  const gA = new Promise<void>((r) => (relA = r));
  let calls = 0;
  const readHead = async (): Promise<Head> => {
    const n = ++calls;
    if (n === 1) await gPrime;
    if (n === 2) await gA; /* the first check's read finishes after the second's */
    return { ...head };
  };
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead, fingerprint: () => fp });
  const primed = tracker.prime(); /* fingerprint taken now: main */
  head = headOf('feature');
  fp = 'ref: refs/heads/feature'; /* the switch commits while prime's git runs */
  const a = tracker.check(); /* watcher */
  const b = tracker.check(); /* route */
  relPrime();
  await primed;
  await tick();
  relA();
  const [ra, rb] = await Promise.all([a, b]);
  await Promise.all([ra.done, rb.done]);
  assert.ok(events.some((e) => e.type === 'git:head'), `the switch was reported: ${JSON.stringify(events)}`);
  assert.ok(events.some((e) => e.type === 'graph:updated'));
});

test('HeadTracker: a check overlapping prime() with HEAD NOT moved reports nothing (no spurious rescan)', async () => {
  const events: GitServerEvent[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const readHead = async (): Promise<Head> => {
    if (++calls === 1) await gate;
    return headOf('main');
  };
  const tracker = new HeadTracker({ getRoot: () => '/r', rescan: async () => 'scan', emit: (e) => events.push(e), readHead, fingerprint: () => 'ref: refs/heads/main' });
  const primed = tracker.prime();
  const checking = tracker.check(); /* the head watcher's first compare, during an attach's prime */
  release();
  const r = await checking;
  await primed;
  await r.done;
  assert.equal(r.changed, false);
  assert.deepEqual(events, []);
});
