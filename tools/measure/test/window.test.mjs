/* Control flow of a measured window, process lifecycle, and the Windows PATH shape. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanEnv, freshHome, judgeWindow, makeBinDir, runWindow, scanProblemOf, waitQuiet } from '../lib/scanBenchLib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib', 'scanBenchLib.mjs');
const SAMPLER = path.join(HERE, '..', 'lib', 'statusSampler.mjs');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return fn(); };
const firstLine = (child) => new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(buf.split('\n')[0]); });
  child.on('exit', () => reject(new Error(`exited before printing: ${buf}`)));
});

/* ── M1: the sampler never outlives its parent ──────────────────────────── */

test('M1: a forked sampler exits within 2 s when its parent dies without calling stop', async () => {
  const script = `
    const { fork } = require('node:child_process');
    const c = fork(${JSON.stringify(SAMPLER)}, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    c.once('message', () => { c.send({ cmd: 'start', url: 'http://127.0.0.1:1/api/status', intervalMs: 20 }); console.log(c.pid); });
    setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const childPid = Number(await firstLine(parent));
  try {
    assert.ok(alive(childPid), 'the sampler is running while its parent lives');
    parent.kill('SIGKILL');
    assert.ok(await until(() => !alive(childPid), 2000), 'the sampler is still alive 2 s after its parent died');
  } finally {
    parent.kill('SIGKILL');
    if (alive(childPid)) process.kill(childPid, 'SIGKILL');
  }
});

/* ── L4: temp dirs go on SIGTERM / SIGINT too ───────────────────────────── */

for (const sig of ['SIGTERM', 'SIGINT']) {
  test(`L4: a registered temp dir is removed when the bench gets ${sig}`, async () => {
    const script = `
      import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
      import { registerCleanup } from ${JSON.stringify(pathToFileURL(LIB).href)};
      const d = registerCleanup(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sigtest-')));
      fs.writeFileSync(path.join(d, 'x'), '1');
      console.log(d); setInterval(() => {}, 1000);
      setTimeout(() => process.emit(${JSON.stringify(sig)}), 100);`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const dir = await firstLine(p);
    try {
      assert.ok(fs.existsSync(dir));
      // Windows cannot deliver SIGTERM to a node process (it is a hard kill), so the child emits the signal itself:
      // the handler the bench installed is what is under test, on every platform.
      const exited = new Promise((r) => p.on('exit', r));
      const code = await exited;
      assert.equal(code, sig === 'SIGINT' ? 130 : 143);
      assert.equal(fs.existsSync(dir), false, 'temp dir left behind');
    } finally {
      p.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/* ── runWindow: capture before, wait for the engine, always stop the sampler ── */

function harness({ before, afterSeq, triggerMs = 30_000, throwInTrigger = false }) {
  let t = 1_000_000;
  const log = [];
  const metas = [...afterSeq];
  const h = {
    log, now: () => t, wait: async (ms) => { t += ms; log.push(['wait', ms]); },
    startSampler: async () => {
      log.push(['startSampler']);
      return {
        stop: async () => {
          log.push(['stop']);
          const samples = [];
          for (let s = 1_000_000; s < t; s += 20) samples.push([s, 3, 'ok']);
          return { samples, skippedAt: [] };
        },
        kill: async () => { log.push(['kill']); },
      };
    },
    getMeta: async (etag) => {
      log.push(['getMeta', etag]);
      if (log.filter((l) => l[0] === 'getMeta').length === 1) return before;
      return metas.length > 1 ? metas.shift() : metas[0];
    },
    trigger: async () => {
      log.push(['trigger']);
      t += triggerMs;
      if (throwInTrigger) throw new Error('boom');
    },
  };
  return h;
}
const iso = (ms) => new Date(ms).toISOString();
const prior = { scannedAt: iso(900_000), nodes: 5, etag: 'e0' };
const fresh = { scannedAt: iso(1_005_000), nodes: 5, etag: 'e1' };
const same = { unchanged: true };

test('runWindow: the graph is captured BEFORE the sampler and the trigger, and the window waits for the new scannedAt', async () => {
  const h = harness({ before: prior, afterSeq: [same, same, same, fresh] });
  const row = await runWindow({ label: 'ii', ...h, requireBefore: true });
  const order = h.log.map((l) => l[0]).filter((n) => n !== 'wait');
  assert.deepEqual(order.slice(0, 3), ['getMeta', 'startSampler', 'trigger']);
  assert.equal(h.log[0][1], null, 'the first call is the unconditional capture');
  assert.equal(h.log.find((l, i) => i > 0 && l[0] === 'getMeta')[1], 'e0', 'later polls are conditional on the captured ETag');
  assert.ok(row.scanMs >= 30_000 + 3 * 250, `window ended at ${row.scanMs} ms, before the engine's signal`);
  assert.equal(row.verdict, 'PASS');
  assert.ok(h.log.some((l) => l[0] === 'stop'));
  assert.ok(!h.log.some((l) => l[0] === 'kill'));
});

test('runWindow: a graph that never changes is INCONCLUSIVE after the give-up, not PASS', async () => {
  const h = harness({ before: prior, afterSeq: [same] });
  const row = await runWindow({ label: 'ii', ...h, requireBefore: true, giveUpMs: 5000 });
  assert.equal(row.verdict, 'INCONCLUSIVE');
  assert.match(row.reasons.join(), /no nodes|did not change/);
});

test('L2: a scannedAt older than the trigger does not count as the new scan', async () => {
  const stale = { scannedAt: iso(999_000), nodes: 5, etag: 'e9' };
  const row = await runWindow({ label: 'ii', ...harness({ before: prior, afterSeq: [stale] }), requireBefore: true });
  assert.equal(row.verdict, 'INCONCLUSIVE');
  assert.match(row.reasons.join(), /older than the trigger/);
});

test('L2: no pre-trigger graph on a rescan path is INCONCLUSIVE; attach (first graph) is allowed', async () => {
  const rescan = await runWindow({ label: 'ii', ...harness({ before: null, afterSeq: [fresh] }), requireBefore: true });
  assert.equal(rescan.verdict, 'INCONCLUSIVE');
  assert.match(rescan.reasons.join(), /before the trigger/);
  const attach = await runWindow({ label: 'i', ...harness({ before: null, afterSeq: [fresh] }), requireBefore: false });
  assert.equal(attach.verdict, 'PASS');
  assert.equal(scanProblemOf({ scanMs: 9000, nodes: 3, scannedAtBefore: 'x', scannedAtAfter: 'not a date', startedAtMs: 1 }) !== null, true);
});

test('M1: a throwing trigger still kills the sampler and rejects with the error', async () => {
  const h = harness({ before: prior, afterSeq: [fresh], throwInTrigger: true });
  await assert.rejects(runWindow({ label: 'ii', ...h, requireBefore: true }), /boom/);
  assert.ok(h.log.some((l) => l[0] === 'kill'), 'sampler was not killed');
  assert.ok(!h.log.some((l) => l[0] === 'stop'));
});

/* ── F5: a settle timeout is recorded ───────────────────────────────────── */

test('F5: waitQuiet records and logs a timeout, and stays silent when the engine settles', async () => {
  const timeouts = [];
  const lines = [];
  assert.equal(await waitQuiet('path iii', async () => false, timeouts, (l) => lines.push(l)), false);
  assert.deepEqual(timeouts, ['path iii']);
  assert.match(lines.join(), /did not go quiet/);
  assert.equal(await waitQuiet('path iv', async () => true, timeouts, (l) => lines.push(l)), true);
  assert.deepEqual(timeouts, ['path iii']);
});

/* ── F7: a fresh HOME and user dir per rep ──────────────────────────────── */

test('F7: freshHome gives each rep its own HOME and user dir, moves the repo in, and leaves caches behind', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fh-'));
  try {
    const repo0 = path.join(work, 'pinned');
    fs.mkdirSync(path.join(repo0, '.sequence'), { recursive: true });
    fs.writeFileSync(path.join(repo0, 'a.ts'), 'x');
    const a = freshHome(work, repo0, '1');
    fs.mkdirSync(path.join(a.repo, '.sequence'));
    fs.writeFileSync(path.join(a.userDir, 'recent.json'), '[]');
    const b = freshHome(work, a.repo, '2');
    assert.notEqual(a.home, b.home);
    assert.notEqual(a.userDir, b.userDir);
    assert.ok(b.repo.startsWith(b.home + path.sep), 'repo lives inside the new HOME (the attach jail)');
    assert.equal(fs.existsSync(a.repo), false, 'the repo moved, it was not copied');
    assert.equal(fs.readFileSync(path.join(b.repo, 'a.ts'), 'utf8'), 'x');
    assert.equal(fs.existsSync(path.join(b.repo, '.sequence')), false, 'the previous rep\'s cache is gone');
    assert.equal(fs.existsSync(path.join(b.userDir, 'recent.json')), false, 'the previous rep\'s user store is gone');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

/* ── L1: short freezes are visible ──────────────────────────────────────── */

test('L1: a 700 ms freeze keeps the p95 verdict PASS but is reported as the longest stall with a warning', () => {
  const samples = [];
  for (let t = 0; t < 120_000; t += 20) samples.push([t, 3, 'ok']);
  samples.push([60_000, 700, 'ok']);
  const r = judgeWindow({ samples, start: 0, end: 120_000 });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.longestStallMs, 700);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(judgeWindow({ samples: samples.slice(0, -1), start: 0, end: 120_000 }).warnings, []);
});

/* ── L5: env scrubbing ──────────────────────────────────────────────────── */

test('L5: cleanEnv also drops launcher, cloud and git-config variables, and forces an empty git config', () => {
  const env = {
    CLAUDE_CODE_EXECUTABLE: '/x/claude', SEQUENCE_CLAUDE_BRIDGE: '1', CLAUDE_CODE_OAUTH_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's', AWS_PROFILE: 'p',
    GH_TOKEN: 't', GITHUB_TOKEN: 't', CLOUDSDK_CORE_PROJECT: 'p', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'k', KEEP_ME: 'ok',
  };
  const out = cleanEnv(env, '/h', 'linux', '/b');
  for (const k of Object.keys(env)) if (k !== 'KEEP_ME') assert.equal(k in out, false, `${k} survived`);
  assert.equal(out.KEEP_ME, 'ok');
  assert.equal(out.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(out.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(cleanEnv({}, 'C:\\h', 'win32', 'C:\\b').GIT_CONFIG_GLOBAL, 'NUL');
});

/* ── M2: the win32 PATH is git's own dir plus a dir with only node.exe ───── */

function fakeWin(extraInGitDir = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-win-'));
  const gitCmd = path.join(tmp, 'Git', 'cmd');
  const nodeDir = path.join(tmp, 'nodejs');
  fs.mkdirSync(gitCmd, { recursive: true });
  fs.mkdirSync(nodeDir);
  fs.writeFileSync(path.join(gitCmd, 'git.exe'), 'MZ');
  for (const n of extraInGitDir) fs.writeFileSync(path.join(gitCmd, n), 'MZ');
  fs.writeFileSync(path.join(nodeDir, 'node.exe'), 'MZnode');
  for (const n of ['claude.cmd', 'codex.cmd', 'npm.cmd']) fs.writeFileSync(path.join(nodeDir, n), '@echo REAL');
  return { tmp, gitCmd, nodeDir };
}

test('M2: on win32 PATH is git\'s own dir plus a private dir holding only node.exe (no .cmd shims, no Node folder)', () => {
  const { tmp, gitCmd, nodeDir } = fakeWin();
  try {
    const callerPath = [nodeDir, gitCmd].join(';');
    const value = makeBinDir(tmp, { platform: 'win32', execPath: path.join(nodeDir, 'node.exe'), callerPath });
    const [first, second, ...rest] = value.split(';');
    assert.equal(rest.length, 0);
    assert.equal(first, gitCmd);
    assert.deepEqual(fs.readdirSync(second), ['node.exe']);
    assert.notEqual(second, nodeDir);
    assert.ok(![first, second].includes(nodeDir), 'the Node install folder must not be on PATH');
    for (const d of [first, second]) assert.deepEqual(fs.readdirSync(d).filter((n) => /^(claude|codex)/i.test(n)), []);
    const env = cleanEnv({ PATH: callerPath }, 'C:\\h', 'win32', value);
    assert.equal(env.Path, value);
    assert.equal(env.PATH, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M2: on win32 a git directory that also holds claude or codex is refused', () => {
  const { tmp, gitCmd, nodeDir } = fakeWin(['claude.cmd']);
  try {
    assert.throws(() => makeBinDir(tmp, { platform: 'win32', execPath: path.join(nodeDir, 'node.exe'), callerPath: gitCmd }), /refusing to put it on PATH/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
