import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ServerController, findFreePort, waitForHealthy, probe } from '../server-control';

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

test('setRepo restarts on the SAME port and attaches the chosen repo (desktop native-picker flow)', async () => {
  const controller = makeController();
  const started = await controller.start();
  const originalPort = started.port;
  try {
    // Simulate the native "Open Repo…" pick: re-point the embedded server.
    const after = await controller.setRepo(TICKETING);
    assert.strictEqual(after.port, originalPort, 'must respawn on the same port so the window URL is stable');
    assert.strictEqual(after.repoDir, TICKETING, 'controller tracks the attached repo');

    // Still 200 on `/`, and now /api/status reports the attached repo.
    assert.strictEqual(await fetchStatus(after.url + '/'), 200);
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
