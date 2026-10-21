import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveApp } from '../serve.js';
import { scanRepo } from '../scan.js';
import { createRepoServer, startDeferredAttach } from '../server/repoServer.js';

/*
 * 0.1.8.1 B1 (audit H1): the launcher LISTENS before it scans. A slow scan used
 * to keep the socket closed (21-23 s on the monorepo) and, past the desktop's
 * 30 s health timeout, quit the app before a window existed. These lock:
 *   - serveApp resolves and /api/status answers 200 while the scan is still
 *     running, reporting `scanning: {done,total}`;
 *   - the attach then completes on its own and status flips to attached;
 *   - the parse pass reports progress to done === total.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

function portOf(server: http.Server): number {
  const addr = server.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function status(port: number): Promise<{ code: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/status`);
  return { code: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function until<T>(fn: () => Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`condition not met within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function tempRepoCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b1-repo-'));
  fs.cpSync(TICKETING, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.sequence`) });
  return dir;
}

test('B1: serveApp listens and /api/status answers BEFORE a slow startup scan completes', async () => {
  const repo = tempRepoCopy();
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b1-web-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  const prev = process.env.SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS;
  process.env.SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS = '1500';
  const t0 = Date.now();
  let server: http.Server | null = null;
  try {
    server = await serveApp(repo, 0, dist);
    const listenedAfter = Date.now() - t0;
    assert.ok(server.listening, 'serveApp resolves with a listening server');
    assert.ok(listenedAfter < 1500, `listening must not wait for the scan (took ${listenedAfter} ms)`);

    const first = await status(portOf(server));
    assert.strictEqual(first.code, 200, '/api/status answers during the scan');
    assert.strictEqual(first.body.attached, false, 'not attached yet: the scan is still running');
    const scanning = first.body.scanning as { done: number; total: number; path: string } | undefined;
    assert.ok(scanning, `status reports scanning while the startup scan runs: ${JSON.stringify(first.body)}`);
    assert.strictEqual(typeof scanning.done, 'number');
    assert.strictEqual(typeof scanning.total, 'number');
    assert.strictEqual(scanning.path, repo);

    const attached = await until(async () => {
      const s = await status(portOf(server!));
      return s.body.attached === true ? s.body : undefined;
    }, 60_000);
    assert.ok(Date.now() - t0 >= 1500, 'attached only after the simulated slow scan');
    assert.strictEqual(attached.scanning, undefined, 'scanning is gone once attached');
    const graph = await fetch(`http://127.0.0.1:${portOf(server)}/archgraph.json`);
    assert.strictEqual(graph.status, 200, 'the graph is served once the background attach lands');
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS;
    else process.env.SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS = prev;
    if (server) await closeServer(server);
    // Let native watcher close callbacks run while Windows releases the directories.
    await fs.promises.rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(dist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('B1: a deferred server answers status with scanning until startDeferredAttach settles; a bad --repo still reports attachFailure', async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b1-user-'));
  const missing = path.join(userDir, 'no-such-folder');
  const server = await createRepoServer(missing, {
    deferStartupAttach: true,
    startupScanDelayMs: 300,
    userConfigDir: userDir,
    recentStoreDir: userDir,
    browseRoot: userDir,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  try {
    const before = await status(portOf(server));
    assert.deepStrictEqual(before.body, { attached: false }, 'nothing has started before startDeferredAttach');
    const run = startDeferredAttach(server);
    const during = await status(portOf(server));
    assert.ok(during.body.scanning, `scanning while the deferred attach runs: ${JSON.stringify(during.body)}`);
    await run;
    const after = await status(portOf(server));
    assert.strictEqual(after.body.attached, false);
    assert.strictEqual(after.body.scanning, undefined);
    assert.ok(after.body.attachFailure, 'the unreadable folder is reported, not swallowed');
  } finally {
    await closeServer(server);
    await fs.promises.rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('B1: scanRepo onProgress counts parsed files up to done === total', async () => {
  const seen: Array<[number, number]> = [];
  await scanRepo(TICKETING, { onProgress: (done, total) => seen.push([done, total]) });
  assert.ok(seen.length >= 2, 'start and end are reported');
  const [lastDone, lastTotal] = seen[seen.length - 1];
  assert.ok(lastTotal > 0, 'the fixture has source files');
  assert.strictEqual(lastDone, lastTotal, 'the last report is complete');
  assert.deepStrictEqual(seen[0], [0, lastTotal], 'the first report is 0 of total');
});

/* ── review B: the person's latest attach or detach wins over the startup scan ── */

async function deferredServer(delayMs: number): Promise<{ server: http.Server; port: number; startRepo: string; otherRepo: string; top: string }> {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b1-race-')));
  const startRepo = path.join(top, 'start');
  const otherRepo = path.join(top, 'other');
  fs.cpSync(TICKETING, startRepo, { recursive: true, filter: (src) => !src.includes(`${path.sep}.sequence`) });
  fs.cpSync(TICKETING, otherRepo, { recursive: true, filter: (src) => !src.includes(`${path.sep}.sequence`) });
  const userDir = path.join(top, 'user');
  fs.mkdirSync(userDir);
  const server = await createRepoServer(startRepo, {
    webDist: undefined,
    deferStartupAttach: true,
    startupScanDelayMs: delayMs,
    browseRoot: top,
    userConfigDir: userDir,
    recentStoreDir: userDir,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { server, port: portOf(server), startRepo, otherRepo, top };
}

test('review B: a detach during the startup scan is not undone when the scan finishes', async () => {
  const s = await deferredServer(800);
  try {
    const run = startDeferredAttach(s.server);
    assert.ok((await status(s.port)).body.scanning, 'scanning');
    const d = await fetch(`http://127.0.0.1:${s.port}/api/detach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(d.status, 200);
    assert.strictEqual((await status(s.port)).body.scanning, undefined, 'the scan is no longer reported');
    await run;
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual((await status(s.port)).body, { attached: false }, 'still detached after the startup attach settled');
  } finally {
    await closeServer(s.server);
    await fs.promises.rm(s.top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('review B: an attach the person makes during the startup scan is the one that stays', async () => {
  const s = await deferredServer(800);
  try {
    const run = startDeferredAttach(s.server);
    const a = await fetch(`http://127.0.0.1:${s.port}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: s.otherRepo }) });
    assert.strictEqual(a.status, 200, await a.clone().text());
    await run;
    const st = (await status(s.port)).body as { attached: boolean; root: string };
    assert.strictEqual(st.attached, true);
    assert.strictEqual(st.root, fs.realpathSync(s.otherRepo), 'the person\'s repo, not the startup one');
  } finally {
    await closeServer(s.server);
    await fs.promises.rm(s.top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('review B: an attach in the gap BEFORE the startup attach begins is not overwritten by it', async () => {
  const s = await deferredServer(0);
  try {
    const a = await fetch(`http://127.0.0.1:${s.port}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: s.otherRepo }) });
    assert.strictEqual(a.status, 200, await a.clone().text());
    await startDeferredAttach(s.server);
    const st = (await status(s.port)).body as { attached: boolean; root: string };
    assert.strictEqual(st.root, fs.realpathSync(s.otherRepo));
  } finally {
    await closeServer(s.server);
    await fs.promises.rm(s.top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/* ── review B (pre-existing): the bundled server finds and runs the HTML worker ── */

test('review B: the one-file server bundle has its HTML converter worker beside it, and it converts', async () => {
  const { htmlWorkerFile } = await import('../server/netFetch.js');
  const bundle = path.resolve(here, '..', 'sequence-server.cjs');
  assert.ok(fs.existsSync(bundle), 'the analyzer build wrote the server bundle');
  const file = htmlWorkerFile(pathToFileURL(bundle).href);
  assert.strictEqual(file, path.resolve(here, '..', 'sequence-html-worker.cjs'), 'found beside the bundle');
  const { Worker } = await import('node:worker_threads');
  const out = await new Promise<string>((resolve, reject) => {
    const w = new Worker(file!, { workerData: { html: '<h1>Title</h1><p>Body text</p>', opts: {} } });
    w.once('message', (m) => resolve(String(m)));
    w.once('error', reject);
  });
  assert.match(out, /Title/);
  assert.match(out, /Body text/);
  /* The unbuilt layout still finds its own worker. */
  assert.ok(htmlWorkerFile(pathToFileURL(path.resolve(here, '..', 'server', 'netFetch.js')).href)?.endsWith('htmlMarkdownWorker.js'));
});
