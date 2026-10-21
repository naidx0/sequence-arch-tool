/* Phase 2A follow-ups: process-tree kill, env scrubbing by pattern, per-platform process readers, the
   conditional graph poll, measureWindow, and the settle timeout. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  cleanEnv, cleanupNow, freshHome, graphMeta, killTree, measureWindow, parseProcStat, parsePsLine, parseVmRss, parseWinProc,
  readProc, settleWithin, trackTree, waitQuiet,
} from '../lib/scanBenchLib.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return fn(); };
const detached = process.platform !== 'win32';

/** A parent node process that spawns a grandchild and prints "<parentPid> <grandchildPid>". */
async function spawnTree() {
  const script = `const { spawn } = require('node:child_process');
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(process.pid + ' ' + g.pid); setInterval(() => {}, 1000);`;
  const p = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'], detached });
  const line = await new Promise((resolve) => { let b = ''; p.stdout.on('data', (d) => { b += d; if (b.includes('\n')) resolve(b); }); });
  const [parent, grand] = line.trim().split(' ').map(Number);
  return { p, parent, grand };
}

/* -- M1: the whole sampler tree dies, on every exit path ------------------ */

test('M1: killTree kills the process and its children, not just the process', async () => {
  const { p, parent, grand } = await spawnTree();
  try {
    assert.ok(alive(parent) && alive(grand));
    killTree(parent, { detached });
    assert.ok(await until(() => !alive(parent) && !alive(grand), 3000), `parent alive=${alive(parent)} grandchild alive=${alive(grand)}`);
  } finally {
    for (const pid of [parent, grand]) if (alive(pid)) process.kill(pid, 'SIGKILL');
    p.kill('SIGKILL');
  }
});

test('M1: a tracked tree is killed by cleanupNow (the bench exit, SIGINT and SIGTERM path); an untracked one is left alone', async () => {
  const a = await spawnTree();
  const b = await spawnTree();
  const untrackB = trackTree(b.parent, { detached });
  trackTree(a.parent, { detached });
  untrackB();
  try {
    cleanupNow();
    assert.ok(await until(() => !alive(a.parent) && !alive(a.grand), 3000), 'tracked tree survived cleanupNow');
    assert.ok(alive(b.parent) && alive(b.grand), 'an untracked tree must not be touched');
  } finally {
    killTree(b.parent, { detached });
    killTree(a.parent, { detached });
    for (const pid of [a.parent, a.grand, b.parent, b.grand]) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

/* -- L5: env scrubbing derived by pattern --------------------------------- */

test('L5: cleanEnv strips credential-shaped and git-redirecting variables by pattern, and keeps the rest', () => {
  const planted = [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_SSH_COMMAND',
    'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'SOME_SERVICE_KEY', 'DEPLOY_TOKEN',
    'DB_PASSWORD', 'APP_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'npm_config__authToken', 'npm_config_//registry.npmjs.org/:_authToken',
    'npm_config_token', 'NPM_CONFIG_TOKEN', 'CLAUDE_CODE_SSE_PORT', 'GITHUB_ENV',
  ];
  const keep = ['KEEP_ME', 'NODE_ENV', 'SystemRoot', 'TEMP', 'npm_config_registry', 'npm_config_cache', 'MONKEY', 'KEYBOARD'];
  const env = Object.fromEntries([...planted, ...keep].map((k) => [k, 'v']));
  const out = cleanEnv(env, '/h', 'linux', '/b');
  for (const k of planted) assert.equal(k in out, false, `${k} survived`);
  for (const k of keep) assert.equal(out[k], 'v', `${k} was dropped`);
  assert.equal(out.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(out.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal('GIT_DIR' in cleanEnv({ GIT_DIR: '/x' }, 'C:\\h', 'win32', 'C:\\b'), false);
});

/* -- settle detection: per-platform readers ------------------------------- */

test('settle: the linux parsers read ticks from /proc/<pid>/stat (comm may hold spaces and parens) and VmRSS from status', () => {
  const stat = '4242 (node (a b)) S 1 4242 4242 0 -1 4194560 100 0 0 0 150 50 0 0 20 0 11 0 5000 1000000 2000 18446744073709551615';
  assert.equal(parseProcStat(stat), 200);
  assert.equal(parseVmRss('Name:\tnode\nVmPeak:\t 999 kB\nVmRSS:\t  123456 kB\nThreads:\t11\n'), 123456);
  assert.equal(parseVmRss('Name:\tnode\n'), null);
});

test('settle: the macOS parser reads "rss time" from ps, including hours and days', () => {
  assert.deepEqual(parsePsLine('  12345   0:03.45\n'), { rssKb: 12345, ticks: 345 });
  assert.deepEqual(parsePsLine('800 1:02:03'), { rssKb: 800, ticks: 372300 });
  assert.deepEqual(parsePsLine('800 2-00:00:01'), { rssKb: 800, ticks: 17_280_100 });
  assert.equal(parsePsLine('ps: illegal option'), null);
});

test('settle: the win32 parser reads "<WorkingSet bytes> <cpu ms>" from PowerShell (ticks are 100 Hz)', () => {
  assert.deepEqual(parseWinProc('104857600 2500\r\n'), { rssKb: 102400, ticks: 250 });
  assert.deepEqual(parseWinProc('2048 12.5'), { rssKb: 2, ticks: 1.25 });
  assert.equal(parseWinProc(''), null);
  assert.equal(parseWinProc('Get-Process : Cannot find a process'), null);
});

test('settle: readProc reads a real live process on THIS platform (rss and cpu ticks), and null for a dead pid', async () => {
  const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const gone = new Promise((r) => p.once('exit', r));
  try {
    await new Promise((r) => setTimeout(r, 300));
    const a = readProc(p.pid);
    assert.ok(a && a.rss > 1000, `rss ${a?.rss}`);
    assert.equal(typeof a.ticks, 'number');
    assert.ok(Number.isFinite(a.ticks));
  } finally {
    p.kill('SIGKILL');
  }
  await gone;
  assert.equal(readProc(p.pid), null);
});

/* -- the settle timeout --------------------------------------------------- */

test('settle timeout: settleWithin gives up after ms, returns true as soon as CPU is quiet, and waitQuiet records the timeout', async () => {
  let t = 0;
  const clock = { now: () => t, wait: async (ms) => { t += ms; } };
  const busy = { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 250, cpu: 80, rss: 1 })) };
  assert.equal(await settleWithin(busy, 10_000, clock), false);
  assert.ok(t >= 10_000, 'it must wait the whole budget before giving up');
  t = 0;
  const quiet = { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 250, cpu: 0.2, rss: 1 })) };
  assert.equal(await settleWithin(quiet, 10_000, clock), true);
  assert.equal(t, 0);
  const timeouts = [];
  const lines = [];
  assert.equal(await waitQuiet('path ii', () => settleWithin(busy, 2000, clock), timeouts, (l) => lines.push(l)), false);
  assert.deepEqual(timeouts, ['path ii']);
  assert.match(lines.join(), /path ii/);
});

/* -- L3 / measureWindow: the conditional poll against a real HTTP server --- */

function graphServer() {
  const state = { scannedAt: new Date(Date.now() - 60_000).toISOString(), n: 0, full: 0, notModified: 0 };
  const server = http.createServer((req, res) => {
    if (req.url !== '/archgraph.json') { res.statusCode = 404; res.end(); return; }
    const etag = `"g${state.n}"`;
    if (req.headers['if-none-match'] === etag) { state.notModified++; res.statusCode = 304; res.setHeader('etag', etag); res.end(); return; }
    state.full++;
    res.setHeader('etag', etag);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ scannedAt: state.scannedAt, nodes: [{ id: 'a' }, { id: 'b' }] }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

test('L3: graphMeta sends If-None-Match and a 304 costs no body; a changed graph comes back whole', async () => {
  const { server, state, base } = await graphServer();
  try {
    const first = await graphMeta(base, null);
    assert.equal(first.nodes, 2);
    assert.equal(first.etag, '"g0"');
    assert.deepEqual(await graphMeta(base, first.etag), { unchanged: true });
    assert.equal(state.full, 1);
    assert.equal(state.notModified, 1);
    state.n = 1;
    state.scannedAt = new Date().toISOString();
    const next = await graphMeta(base, first.etag);
    assert.equal(next.etag, '"g1"');
    assert.notEqual(next.scannedAt, first.scannedAt);
    assert.equal(await graphMeta('http://127.0.0.1:1', null), null);
  } finally {
    server.close();
  }
});

test('measureWindow: waits on the conditional poll for the new graph, downloads the graph only twice, and judges the window', async () => {
  const { server, state, base } = await graphServer();
  let stopped = 0;
  let killed = 0;
  const startSampler = async () => ({
    stop: async () => {
      stopped++;
      const samples = [];
      for (let s = Date.now() - 20_000; s < Date.now(); s += 20) samples.push([s, 3, 'ok']);
      return { samples, skippedAt: [] };
    },
    kill: async () => { killed++; },
  });
  try {
    const row = await measureWindow({
      label: 'ii', base, requireBefore: true, startSampler, minScanMs: 0, p95Max: 50,
      trigger: async () => { await new Promise((r) => setTimeout(r, 400)); state.n = 1; state.scannedAt = new Date().toISOString(); },
    });
    assert.equal(row.verdict, 'PASS', row.reasons.join());
    assert.equal(row.nodes, 2);
    assert.ok(row.scanMs >= 400);
    assert.equal(state.full, 2, 'the graph is downloaded once before and once after, never per poll');
    assert.equal(stopped, 1);
    assert.equal(killed, 0);
  } finally {
    server.close();
  }
});

test('measureWindow: a scan that never produces a new graph is INCONCLUSIVE, and a failing trigger kills the sampler', async () => {
  const { server, base } = await graphServer();
  let killed = 0;
  const startSampler = async () => ({ stop: async () => ({ samples: [], skippedAt: [] }), kill: async () => { killed++; } });
  try {
    const row = await measureWindow({ label: 'ii', base, requireBefore: true, startSampler, minScanMs: 0, p95Max: 50, trigger: async () => {}, giveUpMs: 600, pollMs: 100 });
    assert.equal(row.verdict, 'INCONCLUSIVE');
    await assert.rejects(measureWindow({ label: 'ii', base, requireBefore: true, startSampler, trigger: async () => { throw new Error('scan 500'); } }), /scan 500/);
    assert.equal(killed, 1);
  } finally {
    server.close();
  }
});

/* -- fresh HOME ------------------------------------------------------------ */

test('fresh HOME: the engine env points HOME, USERPROFILE and the user store at the rep\'s own dir, never the real home', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fh2-'));
  try {
    const repo = path.join(work, 'pinned');
    fs.mkdirSync(repo);
    const fh = freshHome(work, repo, 'x');
    const out = cleanEnv({ HOME: os.homedir(), USERPROFILE: os.homedir() }, fh.home, 'win32', 'C:\\b');
    assert.equal(out.HOME, fh.home);
    assert.equal(out.USERPROFILE, fh.home);
    assert.notEqual(path.resolve(out.HOME), path.resolve(os.homedir()));
    assert.ok(path.resolve(fh.userDir).startsWith(path.resolve(fh.home) + path.sep));
    assert.ok(path.resolve(fh.repo).startsWith(path.resolve(fh.home) + path.sep));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
