import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { askIndexEvents } from '../explain/askFileIndex.js';

/**
 * S-new5: the server wiring of the ask index (repoServer warmAskIndexFor):
 * a scan starts the background build, a rescan cancels the build in flight and
 * starts another, and closing the server cancels it and `serverSettled` waits.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repo(files: number, bytes: number): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-srv-')));
  git(dir, 'init', '-q');
  const line = '{"order": "queue", "retry": "backoff", "status": "pending"},\n';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'srv-app', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), "module.exports = require('./fixture-0.json');\n");
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(dir, `fixture-${i}.json`), `[\n${line.repeat(Math.ceil(bytes / line.length))}{}]\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'fixtures');
  return dir;
}

type Ev = { type: string; root: string; at: number };
function record(): { events: Ev[]; stop: () => void; next: (type: string, root: string, ms?: number) => Promise<void> } {
  const events: Ev[] = [];
  const handlers: [string, (...a: unknown[]) => void][] = ['start', 'ready', 'cancelled', 'ltr'].map((type) => [type, (root: unknown) => events.push({ type, root: String(root), at: Date.now() })]);
  for (const [t, h] of handlers) askIndexEvents.on(t, h);
  return {
    events,
    stop: () => handlers.forEach(([t, h]) => askIndexEvents.off(t, h)),
    next: (type, root, ms = 60_000) => {
      const p = new Promise<void>((resolve, reject) => {
        const seen = events.filter((e) => e.type === type && e.root === root).length;
        const t0 = Date.now();
        const poll = () => {
          if (events.filter((e) => e.type === type && e.root === root).length > seen) resolve();
          else if (Date.now() - t0 > ms) reject(new Error(`no ${type} for ${root} in ${ms} ms: ${JSON.stringify(events)}`));
          else setTimeout(poll, 10);
        };
        poll();
      });
      /* A wait the test never reaches (an earlier assertion failed) must not surface as an unhandled rejection. */
      p.catch(() => undefined);
      return p;
    },
  };
}

function post(port: number, p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

async function start(dir: string, store: string): Promise<{ server: http.Server; port: number }> {
  // These tests are about a build that is IN FLIGHT when a rescan lands; the server debounces the start by default.
  process.env.SEQUENCE_ASK_WARM_DELAY_MS = '0';
  const server = await createRepoServer(dir, { webDist: undefined, browseRoot: store, recentStoreDir: store, userConfigDir: store, askIndexWarm: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return { server, port: typeof addr === 'object' && addr ? addr.port : 0 };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((r) => {
    server.close(() => r());
    (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  });
}

test('a scan warms the index in the background (HYB first, then LTR); a rescan cancels the build in flight and builds again', async () => {
  const dir = repo(500, 40_000);
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-srv-store-')));
  const rec = record();
  const firstStart = rec.next('start', dir);
  const { server, port } = await start(dir, store);
  try {
    await firstStart;
    /* Rescan while the first build is still reading 20 MB of fixtures. */
    const cancelled = rec.next('cancelled', dir);
    const ready = rec.next('ready', dir);
    const ltr = rec.next('ltr', dir);
    assert.equal(await post(port, '/api/scan'), 200);
    await cancelled;
    await ready;
    await ltr;
    const types = rec.events.filter((e) => e.root === dir).map((e) => e.type);
    assert.deepEqual(types.slice(0, 2), ['start', 'start'], types.join(','));
    assert.ok(types.indexOf('cancelled') < types.indexOf('ready'), types.join(','));
    assert.ok(types.indexOf('ready') < types.indexOf('ltr'), 'the LTR stage lands after the index is serving');
  } finally {
    rec.stop();
    await close(server);
    await serverSettled(server);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test('closing the server cancels the build in flight, and serverSettled waits for it', async () => {
  const dir = repo(500, 40_000);
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-srv-store-')));
  const rec = record();
  const started = rec.next('start', dir);
  const { server } = await start(dir, store);
  try {
    await started;
    await close(server);
    await serverSettled(server);
    const types = rec.events.filter((e) => e.root === dir).map((e) => e.type);
    assert.ok(types.includes('cancelled'), `settled only after the build was cancelled: ${types.join(',')}`);
    assert.ok(!types.includes('ready'));
  } finally {
    rec.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});
