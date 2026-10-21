/* The verdict logic of bench:status: a stall must never read as a pass. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanEnv, findOnPath, judgeWindow, makeBinDir, percentile, runFile, scanProblemOf, settledSummary } from '../lib/scanBenchLib.mjs';

// A healthy 120 s window: a 3 ms answer every 20 ms.
const healthy = (from = 0, to = 120_000, step = 20, lat = 3) => {
  const out = [];
  for (let t = from; t < to; t += step) out.push([t, lat, 'ok']);
  return out;
};
const W = { start: 0, end: 120_000 };

test('judgeWindow: a healthy window passes', () => {
  const r = judgeWindow({ samples: healthy(), ...W });
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual([r.failed, r.skipped], [0, 0]);
  assert.equal(r.p95, 3);
});

test('F1: fast errors / non-200s never pull p95 down; any failure FAILs', () => {
  // 970 instant resets plus 30 answers that took 4 s. Counting the resets as latencies makes p95 = 1 ms (old behaviour).
  const bad = Array.from({ length: 970 }, (_, i) => [i * 20, 1, 'bad']);
  const slow = Array.from({ length: 30 }, (_, i) => [20_000 + i * 20, 4000, 'ok']);
  const all = [...bad, ...slow];
  assert.equal(percentile(all.map((x) => x[1]), 0.95), 1, 'the trap: the old accounting reads healthy');
  const r = judgeWindow({ samples: all, ...W });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.failed, 970);
  assert.equal(r.p95, 4000, 'percentiles come from the answered requests only');
});

test('F1: one unanswered request is a FAIL even when every answer was fast', () => {
  const r = judgeWindow({ samples: [...healthy(), [5000, 3000, 'unanswered']], ...W });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.failed, 1);
});

test('F2: a 6.5 s freeze in a 120 s window FAILs even though the in-flight cap hides it from p95', () => {
  // Real sampler shape: at 20 ms ticks the cap of 256 is full after 5.12 s, so only 256 slow samples exist
  // (answered at the end of the freeze, 1.4 to 6.5 s late) and the rest of the freeze is skipped ticks.
  const freezeStart = 50_000;
  const slow = Array.from({ length: 256 }, (_, i) => [freezeStart + i * 20, 6500 - i * 20, 'ok']);
  const skippedAt = Array.from({ length: 6500 / 20 - 256 }, (_, i) => freezeStart + 256 * 20 + i * 20);
  const samples = [...healthy(0, freezeStart), ...healthy(freezeStart + 6500, 120_000), ...slow];
  const p95 = percentile(samples.map((s) => s[1]), 0.95);
  assert.ok(p95 < 50, `the trap: p95 alone is ${p95} ms, which would pass`);
  const r = judgeWindow({ samples, skippedAt, ...W });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.skipped, 6500 / 20 - 256);
  assert.match(r.reasons.join(';'), /skipped/);
});

test('F2: skipped ticks and failures outside the window do not count', () => {
  const r = judgeWindow({ samples: [...healthy(), [-5000, 1, 'bad']], skippedAt: [-10, 130_000], ...W });
  assert.equal(r.verdict, 'PASS');
});

test('F3: an unobserved or too-short scan is INCONCLUSIVE, never PASS; a stall still wins', () => {
  assert.equal(judgeWindow({ samples: healthy(), scanProblem: 'too short', ...W }).verdict, 'INCONCLUSIVE');
  assert.equal(judgeWindow({ samples: healthy(0, 100), start: 0, end: 100 }).verdict, 'INCONCLUSIVE', 'fewer than 10 samples');
  assert.equal(judgeWindow({ samples: healthy(), skippedAt: [10], scanProblem: 'too short', ...W }).verdict, 'FAIL');
});

test('F3: scanProblemOf wants nodes, a changed scannedAt, and a minimum duration', () => {
  const good = { scanMs: 30_000, nodes: 2600, scannedAtBefore: 'a', scannedAtAfter: 'b' };
  assert.equal(scanProblemOf(good), null);
  assert.match(scanProblemOf({ ...good, nodes: 0 }), /no nodes/);
  assert.match(scanProblemOf({ ...good, scannedAtAfter: 'a' }), /did not change/);
  assert.match(scanProblemOf({ ...good, scannedAtAfter: null }), /did not change/);
  assert.match(scanProblemOf({ ...good, scanMs: 900 }), /too short/);
  assert.equal(scanProblemOf({ ...good, scannedAtBefore: null }), null, 'first attach has no earlier graph');
});

test('F4: settledSummary medians only the runs that settled, and says how many', () => {
  const s = settledSummary([{ settled: true, value: 500 }, { settled: false, value: 900 }, { settled: true, value: 520 }]);
  assert.deepEqual([s.nSettled, s.nTotal, s.median, s.min, s.max], [2, 3, 510, 500, 520]);
  const none = settledSummary([{ settled: false, value: 900 }, { settled: false, value: 800 }]);
  assert.deepEqual([none.nSettled, none.nTotal, none.median], [0, 2, null]);
});

test('F6: cleanEnv isolates HOME, drops provider credentials, and PATH is only the private bin dir', () => {
  const env = {
    PATH: '/home/u/.local/bin:/usr/local/bin', HOME: '/home/u', KEEP: '1', OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: 'x',
    OPENROUTER_KEY: 'x', OPENROUTER_API_KEY: 'x', SEQUENCE_AI_MODEL: 'x', MY_API_KEY: 'x',
  };
  const out = cleanEnv(env, '/tmp/h', 'linux', '/tmp/bin');
  assert.equal(out.PATH, '/tmp/bin');
  assert.equal(out.HOME, '/tmp/h');
  assert.equal(out.KEEP, '1');
  assert.deepEqual(Object.keys(out).filter((k) => /API_KEY|OPENROUTER|ANTHROPIC|OPENAI|SEQUENCE_AI/.test(k)), []);
  assert.equal(env.OPENAI_API_KEY, 'x', 'the input is not mutated');
});

test('F6: cleanEnv on win32 sets Path and USERPROFILE and removes the old PATH spelling', () => {
  const out = cleanEnv({ PATH: 'C:\\Users\\u\\bin', SystemRoot: 'C:\\Windows' }, 'C:\\h', 'win32', 'C:\\bench\\bin');
  assert.equal(out.Path, 'C:\\bench\\bin');
  assert.equal(out.PATH, undefined);
  assert.equal(out.USERPROFILE, 'C:\\h');
});

const BANNED = ['claude', 'claude.cmd', 'codex', 'codex.cmd'];
const holdsBanned = (dir) => BANNED.filter((n) => fs.existsSync(path.join(dir, n)));

test('F6: a claude/codex sitting next to node is NOT reachable; node and git still resolve', { skip: process.platform === 'win32' && 'POSIX symlink/PATH shape; the win32 shape is locked by the M2 tests in window.test.mjs' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-pathtest-'));
  try {
    // A fake node dir shaped like /opt/node22/bin or an npm-global folder: node plus a claude and a codex.
    const fakeNodeDir = path.join(tmp, 'nodedir');
    fs.mkdirSync(fakeNodeDir);
    const fakeNode = path.join(fakeNodeDir, 'node');
    fs.symlinkSync(process.execPath, fakeNode);
    for (const n of BANNED) fs.writeFileSync(path.join(fakeNodeDir, n), '#!/bin/sh\necho REAL\n', { mode: 0o755 });
    const callerPath = `${fakeNodeDir}:${process.env.PATH}`;
    const bin = makeBinDir(tmp, { execPath: fakeNode, callerPath });
    const env = cleanEnv({ PATH: callerPath }, tmp, process.platform, bin);
    const dirs = env.PATH.split(path.delimiter);
    assert.deepEqual(dirs, [bin], 'PATH is the private dir alone');
    for (const d of dirs) assert.deepEqual(holdsBanned(d), [], `${d} holds a banned launcher`);
    assert.equal(findOnPath(BANNED, env.PATH), null);
    assert.ok(findOnPath(['node'], env.PATH), 'node resolves');
    assert.ok(findOnPath(['git'], env.PATH), 'git resolves');
    const r = spawnSync('git', ['--version'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const n = spawnSync('node', ['-e', 'process.stdout.write("ok")'], { env, encoding: 'utf8' });
    assert.equal(n.stdout, 'ok');
    const c = spawnSync('claude', ['--version'], { env, encoding: 'utf8' });
    assert.equal(c.error?.code, 'ENOENT', 'claude must not run');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('F6: makeBinDir fails loudly when git is not on the caller PATH', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-pathtest-'));
  try {
    assert.throws(() => makeBinDir(tmp, { callerPath: path.join(tmp, 'empty') }), /git not found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('F10: run files are unique per sha, time and tag, and never the bare legacy name', () => {
  const a = runFile('status-bench', 'a'.repeat(40), new Date('2026-10-14T21:24:05.123Z'), 'iii');
  const b = runFile('status-bench', 'a'.repeat(40), new Date('2026-10-14T21:24:06.123Z'), 'iii');
  assert.notEqual(a, b);
  assert.match(a, /status-bench-aaaaaaaaaaaa-2026-10-14T21-24-05-123Z-iii\.json$/);
  assert.doesNotMatch(a, /status-bench\.json$/);
});
