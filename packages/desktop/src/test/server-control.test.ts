import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AttachStalledError, LISTENING_PREFIX, ServerController, findFreePort, onListeningLine, waitForAttach, waitForHealthy, probe } from '../server-control';

/**
 * These tests exercise the RUNNABLE heart of the desktop app WITHOUT Electron:
 * they really spawn the built analyzer CLI as a child process, wait for it to
 * answer 200 on `/`, drive a repo switch, and kill it — exactly what the Electron
 * main process does, minus the window. No `electron` import anywhere, so this
 * runs green in CI where the Electron binary cannot be downloaded.
 *
 * Requires `pnpm --filter @sequence/analyzer build` (and the web dist) to have
 * run first — the standing gate runs `pnpm build` before `pnpm test`.
 */

// dist/test -> dist -> desktop -> packages -> <repo root>
const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const WEB_DIST = path.join(REPO_ROOT, 'packages', 'web2', 'dist');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

/**
 * A PRIVATE USER STORE FOR THE SPAWNED CHILD.
 *
 * `node --test` sets `NODE_TEST_CONTEXT` in this process, `ServerController`
 * spawns the CLI with `{...process.env}`, and the child inherits it — at which
 * point the analyzer's `userStoreDir()` guard REFUSES to resolve the real
 * `~/.sequence` and exits immediately. The health probe then reports
 * `ECONNREFUSED` at ~460 ms and the test reads as "the server would not start",
 * which is the one thing that was not wrong.
 *
 * The guard is right — the child really would have written to a live user store,
 * and it exists because a hand-rolled `node --test` once did exactly that. So the
 * fix is the one its own message names: give the child a temp directory. Nothing
 * about the guard is relaxed.
 *
 * Found by `tools/ci/counting-gate.mjs`, which runs every package rather than the
 * three the standing gate names; `@sequence/desktop` had been failing unseen.
 */
const CHILD_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-desktop-test-'));

/** A controller wired at the real built CLI, run under the test's own Node. */
function makeController(overrides: Partial<ConstructorParameters<typeof ServerController>[0]> = {}) {
  return new ServerController({
    cliPath: CLI_PATH,
    webDist: WEB_DIST,
    nodeExecPath: process.execPath,
    healthTimeoutMs: 30000,
    pollIntervalMs: 100,
    env: { SEQUENCE_USER_DIR: CHILD_USER_DIR },
    ...overrides,
  });
}

async function fetchStatus(url: string): Promise<number> {
  return probe(url, 3000);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Sanity that the prerequisite build artifacts exist, so a missing build fails
// loudly here rather than as a confusing spawn error deep in a later test.
test('prerequisite: the built analyzer CLI and web dist exist', () => {
  assert.ok(fs.existsSync(CLI_PATH), `analyzer CLI must be built: ${CLI_PATH}`);
  assert.ok(fs.existsSync(path.join(WEB_DIST, 'index.html')), `web dist must be built: ${WEB_DIST}`);
});

test('findFreePort returns a port that is actually bindable, twice distinct', async () => {
  const a = await findFreePort();
  const b = await findFreePort();
  assert.ok(Number.isInteger(a) && a > 0 && a < 65536, `port a in range: ${a}`);
  assert.ok(Number.isInteger(b) && b > 0 && b < 65536, `port b in range: ${b}`);
  // Prove `a` is really free by binding it.
  await new Promise<void>((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(a, '127.0.0.1', () => srv.close(() => resolve()));
  });
});

test('waitForHealthy aborts fast when the process is already dead (isAlive=false)', async () => {
  const start = Date.now();
  await assert.rejects(
    () => waitForHealthy('http://127.0.0.1:1/', { timeoutMs: 5000, intervalMs: 50, isAlive: () => false }),
    /exited before it became healthy/
  );
  assert.ok(Date.now() - start < 2000, 'should not wait for the full timeout when the child is dead');
});

test('ServerController.start spawns the real CLI (no repo), serves 200 on /, then stop() kills it', async () => {
  const controller = makeController();
  const status = await controller.start();
  try {
    assert.match(status.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'url is a localhost URL');
    assert.strictEqual(status.repoDir, null, 'no repo attached on a bare start');

    // The heart of it: a REAL 200 from the spawned child on `/`.
    assert.strictEqual(await fetchStatus(status.url + '/'), 200, 'GET / must be 200');

    // And the home-screen state endpoint reports "no repo".
    const st = await getJson(status.url + '/api/status');
    assert.strictEqual(st.status, 200);
    assert.deepStrictEqual(st.body, { attached: false });
  } finally {
    await controller.stop();
  }

  // After stop the port must no longer answer.
  await assert.rejects(() => probe(status.url + '/', 1500), 'server should be gone after stop()');
});

test('S1: a server that dies on its own is started again ONCE on the same port; a second crash soon after goes to the restart dialog', async () => {
  const respawned: string[] = [];
  const crashes: { code: number | null; signal: NodeJS.Signals | null }[] = [];
  let resolveRespawn!: () => void;
  const respawn = new Promise<void>((r) => (resolveRespawn = r));
  let resolveDialog!: () => void;
  const dialog = new Promise<void>((r) => (resolveDialog = r));
  const controller = makeController({
    onRespawned: (s) => {
      respawned.push(s.url);
      resolveRespawn();
    },
    onUnexpectedExit: (info) => {
      crashes.push(info);
      resolveDialog();
    },
  });
  const status = await controller.start();
  try {
    const first = controller.childPid;
    assert.ok(first, 'a child is running');
    process.kill(first, 'SIGKILL');
    await respawn;
    assert.deepStrictEqual(respawned, [status.url], 'back on the same URL');
    assert.deepStrictEqual(crashes, [], 'no dialog for the first crash');
    assert.notStrictEqual(controller.childPid, first, 'a new process');
    assert.strictEqual(await fetchStatus(status.url + '/'), 200, 'and it serves');

    process.kill(controller.childPid!, 'SIGKILL');
    await dialog;
    assert.strictEqual(crashes.length, 1, 'the second crash inside the window goes to the dialog');
    assert.deepStrictEqual(respawned, [status.url], 'and is not respawned');
  } finally {
    await controller.stop();
  }
});

test('setRepo restarts on the SAME port and attaches the chosen repo (desktop native-picker flow)', async () => {
  const controller = makeController();
  const started = await controller.start();
  const originalPort = started.port;
  try {
    // Simulate the native "Open Repo…" pick: re-point the embedded server.
    const after = await controller.setRepo(TICKETING);
    assert.strictEqual(after.port, originalPort, 'must respawn on the same port so the window URL is stable');
    assert.strictEqual(after.repoDir, TICKETING, 'controller tracks the attached repo');

    // Still 200 on `/`, and — once the background scan lands (B1: the engine
    // listens before it reads the repo) — /api/status reports the attached repo.
    assert.strictEqual(await fetchStatus(after.url + '/'), 200);
    await controller.waitUntilAttached();
    const st = await getJson(after.url + '/api/status');
    assert.strictEqual(st.status, 200);
    const body = st.body as { attached?: boolean; root?: string };
    assert.strictEqual(body.attached, true, 'repo should be attached after setRepo');
    assert.ok(typeof body.root === 'string' && body.root.length > 0, 'status reports a repo root');

    // The scanned graph is really being served now.
    const graph = await getJson(after.url + '/archgraph.json');
    assert.strictEqual(graph.status, 200, 'attached server serves the scanned graph');
    const g = graph.body as { nodes?: unknown[] };
    assert.ok(Array.isArray(g.nodes) && g.nodes.length > 0, 'scanned graph has nodes');
  } finally {
    await controller.stop();
  }
});

test('setRepo attaches in the RUNNING engine: the server child is not killed (a goal run keeps going across a switch)', async () => {
  const controller = makeController();
  const started = await controller.start();
  const pid = controller.childPid;
  assert.ok(pid !== null, 'the engine child is up');
  try {
    const after = await controller.setRepo(TICKETING);
    assert.strictEqual(controller.childPid, pid, 'same child process: setRepo did not kill and respawn the engine');
    assert.strictEqual(after.port, started.port);
    assert.strictEqual(after.repoDir, TICKETING, 'controller tracks the attached repo');
    const st = await getJson(after.url + '/api/status');
    const body = st.body as { attached?: boolean; root?: string };
    assert.strictEqual(body.attached, true, 'the repo is attached in the same engine');
  } finally {
    await controller.stop();
  }
});

test('setRepo falls back to a respawn when the running engine refuses the attach', async () => {
  const controller = makeController({ attachFetch: (async () => new Response('{}', { status: 403 })) as typeof fetch });
  await controller.start();
  const pid = controller.childPid;
  try {
    const after = await controller.setRepo(TICKETING);
    assert.notStrictEqual(controller.childPid, pid, 'a refused attach restarts the engine on the repo, as before');
    assert.strictEqual(after.repoDir, TICKETING);
    await controller.waitUntilAttached();
  } finally {
    await controller.stop();
  }
});

test('setRepo shows the opening screen BEFORE the attach request goes out, and does not return until the scan is done', async () => {
  const order: string[] = [];
  const slowAttach = (async () => {
    order.push('attach request');
    await new Promise((r) => setTimeout(r, 400));
    order.push('scan done');
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const controller = makeController({ attachFetch: slowAttach });
  await controller.start();
  const pid = controller.childPid;
  try {
    const after = await controller.setRepo(TICKETING, { onAttaching: () => order.push('opening screen') });
    order.push('setRepo returned');
    assert.deepStrictEqual(order, ['opening screen', 'attach request', 'scan done', 'setRepo returned']);
    assert.strictEqual(controller.childPid, pid, 'the engine was not restarted');
    assert.strictEqual(after.repoDir, TICKETING);
  } finally {
    await controller.stop();
  }
});

test('a hung attach times out into the defined fallback: the engine is restarted on the folder', async () => {
  const logs: string[] = [];
  const hung = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
  const controller = makeController({ attachFetch: hung, attachTimeoutMs: 300, onLog: (l) => logs.push(l) });
  await controller.start();
  const pid = controller.childPid;
  try {
    const t0 = Date.now();
    const after = await controller.setRepo(TICKETING);
    assert.notStrictEqual(controller.childPid, pid, 'the hung attach fell back to a respawn');
    assert.strictEqual(after.repoDir, TICKETING);
    assert.ok(Date.now() - t0 < 25_000, 'bounded, not waiting on the hung request');
    assert.ok(logs.some((l) => /did not finish in 300 ms/.test(l)), 'the log says why');
    await controller.waitUntilAttached();
  } finally {
    await controller.stop();
  }
});

test('start rejects (and does not hang) when the CLI path does not exist', async () => {
  const controller = makeController({
    cliPath: path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'does-not-exist.js'),
    healthTimeoutMs: 8000,
    pollIntervalMs: 100,
  });
  await assert.rejects(() => controller.start(), /exited before it became healthy|did not become healthy/);
  // Nothing left running to clean up, but stop() must be safe to call regardless.
  await controller.stop();
});

/* ── READY ON THE LISTENING LINE, WITH THE POLL AS FALLBACK ──────────────── */

test('onListeningLine finds the line across split chunks and CRLF, and ignores look-alikes', async () => {
  let push!: (c: string) => void;
  const seen = onListeningLine((fn) => (push = fn));
  push('  Sequence\r\nSEQUENCE_LISTENING_NOT http://x\r\nSEQUENCE_LIS');
  push('TENING http://127.0.0.1:5');
  push('1234\r\n  more\n');
  assert.strictEqual(await seen, 'http://127.0.0.1:51234');
  assert.strictEqual(LISTENING_PREFIX, 'SEQUENCE_LISTENING');
});

/** A stand-in CLI: binds after 300 ms and serves 200 on `/`, printing the line or not. */
function fakeCli(printLine: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fake-cli-'));
  const file = path.join(dir, 'cli.js');
  const lines = [
    "const http = require('node:http');",
    "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
    "const s = http.createServer((q, r) => { r.statusCode = 200; r.end('ok'); });",
    "setTimeout(() => s.listen(port, '127.0.0.1', () => {",
    printLine ? "  console.log('SEQUENCE_LISTENING http://127.0.0.1:' + port);" : '',
    '}), 300);',
  ];
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

test('ready on the listening line, long before the next poll would have looked', async () => {
  const logs: string[] = [];
  const controller = makeController({ cliPath: fakeCli(true), webDist: undefined, pollIntervalMs: 5000, onLog: (l) => logs.push(l) });
  try {
    const t0 = Date.now();
    await controller.start();
    const took = Date.now() - t0;
    /* The first probe fails (nothing bound yet) and the next one is 5 s away,
       so readiness under 3 s can only have come from the line. */
    assert.ok(took < 3000, `ready in ${took} ms`);
    assert.ok(logs.includes('[server] ready (listening line)'), logs.join('\n'));
    assert.strictEqual(await fetchStatus(controller.url + '/'), 200);
  } finally {
    await controller.stop();
  }
});

test('a CLI that never prints the line is still found by the poll', async () => {
  const logs: string[] = [];
  const controller = makeController({ cliPath: fakeCli(false), webDist: undefined, pollIntervalMs: 50, onLog: (l) => logs.push(l) });
  try {
    await controller.start();
    assert.ok(logs.includes('[server] ready (health poll)'), logs.join('\n'));
  } finally {
    await controller.stop();
  }
});

test('the bundled server entry (what main.ts runs when present) starts under the controller', async () => {
  const entry = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'sequence-server-entry.cjs');
  assert.ok(fs.existsSync(entry), `the analyzer build writes ${entry}`);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-desktop-v8-'));
  const logs: string[] = [];
  /* The Node 20 path Electron takes, forced on this Node. */
  const controller = makeController({
    cliPath: entry,
    pollIntervalMs: 5000,
    env: { SEQUENCE_USER_DIR: CHILD_USER_DIR, SEQUENCE_COMPILE_CACHE: cache, SEQUENCE_COMPILE_CACHE_MODE: 'cachedData' },
    onLog: (l) => logs.push(l),
  });
  try {
    await controller.start(TICKETING);
    assert.ok(logs.includes('[server] ready (listening line)'), logs.join('\n'));
    await controller.waitUntilAttached();
    const st = await getJson(controller.url + '/api/status');
    assert.strictEqual((st.body as { attached?: boolean }).attached, true, JSON.stringify(st.body));
    assert.strictEqual(await fetchStatus(controller.url + '/'), 200);
  } finally {
    await controller.stop();
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('the desktop runs the bundled entry when present, and caches renderer code from the first load', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'desktop', 'src', 'main.ts'), 'utf8');
  assert.match(src, /'sequence-server-entry\.cjs'/);
  assert.match(src, /fs\.existsSync\(entry\) \? entry : path\.join\(dist, 'cli\.js'\)/);
  assert.match(src, /SEQUENCE_COMPILE_CACHE: path\.join\(app\.getPath\('userData'\)/);
  assert.match(src, /v8CacheOptions: 'bypassHeatCheck'/);
});

test('the real analyzer CLI prints the listening line and readiness comes from it', async () => {
  const logs: string[] = [];
  const controller = makeController({ pollIntervalMs: 5000, onLog: (l) => logs.push(l) });
  try {
    await controller.start();
    assert.ok(logs.some((l) => l.includes(`${LISTENING_PREFIX} ${controller.url}`)), logs.join('\n'));
    assert.ok(logs.includes('[server] ready (listening line)'), logs.join('\n'));
    assert.strictEqual(await fetchStatus(controller.url + '/'), 200);
  } finally {
    await controller.stop();
  }
});

/* ── 0.1.8.1 B1: A SLOW SCAN IS NEVER A FAILED START ────────────────────────
   The audit (H1): the engine scanned before it listened, so a scan longer than
   the 30 s health timeout killed the child and main.ts showed "Sequence failed
   to start" and quit — on every launch, because the last repo is re-attached.
   Here the scan is made slower than the health timeout on purpose. */

test('B1: a startup scan slower than the health timeout never takes the failed-to-start path', async () => {
  const unexpected: unknown[] = [];
  const progress: { done: number; total: number }[] = [];
  const controller = makeController({
    healthTimeoutMs: 4000,
    env: { SEQUENCE_USER_DIR: CHILD_USER_DIR, SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS: '7000' },
    onUnexpectedExit: (info) => unexpected.push(info),
  });
  try {
    const t0 = Date.now();
    const status = await controller.start(TICKETING);
    assert.ok(Date.now() - t0 < 4000, 'ready on listen, inside the health timeout');
    const during = await getJson(status.url + '/api/status');
    const body = during.body as { attached?: boolean; scanning?: { done: number; total: number } };
    assert.strictEqual(body.attached, false, 'still reading the repo');
    assert.ok(body.scanning, `status carries scanning during the scan: ${JSON.stringify(body)}`);

    const final = await controller.waitUntilAttached((p) => progress.push(p));
    assert.ok(Date.now() - t0 >= 7000, 'the wait outlived the health timeout instead of failing');
    assert.strictEqual(final.attached, true, JSON.stringify(final));
    assert.ok(progress.length > 0, 'the boot screen got progress reports');
    assert.deepStrictEqual(unexpected, [], 'no failed-to-start / unexpected-exit path');
    assert.ok(controller.childPid, 'the engine is still running');
  } finally {
    await controller.stop();
  }
});

test('B1: waitForAttach rejects (no hang) once the child is gone', async () => {
  await assert.rejects(
    () => waitForAttach('http://127.0.0.1:1', { intervalMs: 10, isAlive: () => false }),
    /exited during the startup scan/,
  );
});

test('B1: main.ts spawns the engine without waiting, and loads the app when it listens, not after the attach', () => {
  /* contract change (0.1.8.4): the spawn is issued BEFORE createWindow() (they overlap), and the app no longer waits for
     the startup read; the attach is watched in the background (boot-early.test.ts holds the behaviour). */
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'desktop', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const boot = src.slice(src.indexOf('async function bootstrap()'));
  const created = boot.indexOf('createWindow();');
  const started = boot.indexOf('startEngine({');
  assert.ok(created > 0 && started > 0 && started < created, 'the engine spawn is issued before createWindow() in bootstrap');
  assert.match(boot, /loadAppWhenAttached\(/, 'the app URL is loaded through openAppOnListening');
  assert.match(src, /settled: \(\) => controller\.waitUntilAttached\(/, 'the attach is still watched, in the background');
  assert.doesNotMatch(src, /await controller\.waitUntilAttached/, 'but nothing awaits it before the app loads');
  assert.doesNotMatch(src, /waitUntilAttached\([^)]*timeout/i, 'the attach wait has no deadline');
});

/* ── review B: the attach wait has no deadline, but it does not spin forever ── */

/** A status server that answers each probe from `script` (the last answer repeats). */
async function scriptedStatus(script: Array<Record<string, unknown>>): Promise<{ url: string; close: () => Promise<void>; probes: () => number }> {
  let i = 0;
  const http = await import('node:http');
  const server = http.createServer((_req, res) => {
    const body = script[Math.min(i, script.length - 1)]!;
    i += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, probes: () => i, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('review B: a slow scan that keeps counting is waited out, far past both limits', async () => {
  const steps = Array.from({ length: 40 }, (_, n) => ({ attached: false, scanning: { done: n * 10, total: 400 } }));
  const s = await scriptedStatus([...steps, { attached: true }]);
  let t = 0;
  try {
    const body = await waitForAttach(s.url, { intervalMs: 1, noAnswerMs: 50, stalledMs: 50, now: () => (t += 30) });
    assert.strictEqual(body.attached, true);
    assert.ok(t > 1000, 'the fake clock ran far past both limits');
  } finally {
    await s.close();
  }
});

test('review B: a count that stops moving while total > 0 is reported, not spun on', async () => {
  const s = await scriptedStatus([{ attached: false, scanning: { done: 12, total: 400 } }]);
  let t = 0;
  try {
    await assert.rejects(
      () => waitForAttach(s.url, { intervalMs: 1, stalledMs: 120_000, now: () => (t += 10_000) }),
      (e: Error) => e instanceof AttachStalledError && /stopped at 12 of 400 files/.test(e.message),
    );
  } finally {
    await s.close();
  }
});

test('review B: the counting phase before a total is known (total 0) is not a stall', async () => {
  const counting = Array.from({ length: 20 }, () => ({ attached: false, scanning: { done: 0, total: 0 } }));
  const s = await scriptedStatus([...counting, { attached: true }]);
  let t = 0;
  try {
    const body = await waitForAttach(s.url, { intervalMs: 1, stalledMs: 50, now: () => (t += 30) });
    assert.strictEqual(body.attached, true);
  } finally {
    await s.close();
  }
});

test('review B: an engine that stops answering is reported after the no-answer limit', async () => {
  const s = await scriptedStatus([{ attached: false, scanning: { done: 1, total: 10 } }]);
  await s.close();
  let t = 0;
  await assert.rejects(
    () => waitForAttach(s.url, { intervalMs: 1, noAnswerMs: 60_000, now: () => (t += 20_000) }),
    (e: Error) => e instanceof AttachStalledError && /has not answered for 60 s/.test(e.message),
  );
});
