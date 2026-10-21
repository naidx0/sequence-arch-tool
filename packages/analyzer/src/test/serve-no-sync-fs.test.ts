import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { computePartSignatures, takeFileSnapshot } from '../server/graphCache.js';
import { IGNORE_DIRS } from '../scan.js';
import { readRecent, readRecentAsync, resolveInBrowseRootAsync } from '../server/store.js';
import { resolveInBrowseRoot } from '../server/browse.js';
import { createRepoServer, serverSettled } from '../server/repoServer.js';

/**
 * perf P6-3: serving the graph does no sync filesystem work. A *Sync call on the request path stalls the loop that
 * serves every other request (the profile: sync stat 160 ms and readdir 94 ms around the first /archgraph.json).
 * The spy counts every fs.*Sync call made while the handlers run.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nosync-')));
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nosync-app', version: '1.0.0', main: 'src/app.ts' }));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "import './deep/a';\nexport const app = 1;\n");
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'a.ts'), 'export const a = 1;\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

/** Wrap every fs.*Sync function; `calls` collects names while `armed`. */
function spyOnSyncFs(): { calls: string[]; arm: () => void; disarm: () => void; restore: () => void } {
  const calls: string[] = [];
  let armed = false;
  const saved: [string, unknown][] = [];
  for (const name of Object.keys(fs)) {
    if (!name.endsWith('Sync')) continue;
    const orig = (fs as unknown as Record<string, unknown>)[name];
    if (typeof orig !== 'function') continue;
    saved.push([name, orig]);
    const wrapped = function (this: unknown, ...a: unknown[]) {
      if (armed) calls.push(`${name}(${typeof a[0] === 'string' ? path.basename(a[0]) : ''})`);
      return (orig as (...x: unknown[]) => unknown).apply(this, a);
    };
    try {
      (fs as unknown as Record<string, unknown>)[name] = wrapped;
    } catch {
      /* read-only binding: not spied */
    }
  }
  return {
    calls,
    arm: () => (armed = true),
    disarm: () => (armed = false),
    restore: () => {
      for (const [name, orig] of saved) (fs as unknown as Record<string, unknown>)[name] = orig;
    },
  };
}

function get(port: number, p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      })
      .on('error', reject);
  });
}

test('the signature walk (the first-fetch cost) makes no sync stat or readdir', async () => {
  const dir = repo();
  const spy = spyOnSyncFs();
  try {
    spy.arm();
    const sigs = await computePartSignatures(dir);
    spy.disarm();
    assert.ok(sigs.signature.length === 64);
    const walk = spy.calls.filter((c) => /^(stat|lstat|readdir)Sync/.test(c));
    assert.deepEqual(walk, [], 'no sync stat/readdir while walking the repo');
    /* Positive control: the spy sees a sync call when one is made. */
    spy.calls.length = 0;
    spy.arm();
    fs.statSync(dir);
    spy.disarm();
    assert.equal(spy.calls.length, 1);
  } finally {
    spy.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('status, archgraph, sessions and boards answer with no sync filesystem call', async () => {
  const dir = repo();
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nosync-store-')));
  const server = await createRepoServer(dir, { webDist: undefined, browseRoot: store, recentStoreDir: store, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const spy = spyOnSyncFs();
  try {
    /* A root's first chat is minted (written, once) by the first sessions read: that one write is not the request path. */
    await get(port, '/api/sessions');
    await new Promise((r) => setTimeout(r, 300));
    /* Then the FIRST fetch of the rest (it builds and caches the archgraph body), and the steady ones. */
    spy.arm();
    for (const p of ['/api/status', '/archgraph.json', '/api/sessions', '/api/boards']) await get(port, p);
    const codes: number[] = [];
    for (const p of ['/api/status', '/archgraph.json', '/api/sessions', '/api/boards']) codes.push(await get(port, p));
    spy.disarm();
    assert.ok(codes.every((c) => c === 200), `statuses ${codes.join(',')}`);
    assert.deepEqual(spy.calls, [], 'the request path made sync fs calls');
  } finally {
    spy.restore();
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});

function syncWalk(dir: string, rel: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) syncWalk(path.join(dir, e.name), childRel, out);
    } else if (e.isFile()) out.push(childRel);
  }
}

test('the async signature walk sees the same files in the same order as the sync walk it replaced', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'skip.js'), '1');
  fs.mkdirSync(path.join(dir, 'zz', 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zz', 'a', 'b', 'c.ts'), 'export {}');
  fs.writeFileSync(path.join(dir, 'aa.ts'), 'export {}');
  fs.writeFileSync(path.join(dir, '.env'), 'A=1');
  try {
    const sigs = await computePartSignatures(dir);
    const snap = takeFileSnapshot(sigs.signature);
    const want: string[] = [];
    syncWalk(dir, '', want);
    assert.ok(want.length >= 6);
    assert.deepEqual(snap?.rels, want);
    assert.ok(!want.some((r) => r.startsWith('node_modules/')) && want.includes('.env'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the async recent list and browse jail answer as the sync ones do', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nosync-home-')));
  const inside = path.join(home, 'proj');
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nosync-out-')));
  fs.mkdirSync(inside);
  fs.writeFileSync(path.join(home, 'file.txt'), 'x');
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nosync-recent-'));
  try {
    for (const t of [inside, home, outside, path.join(home, 'missing'), path.join(home, 'file.txt'), '', path.join(home, '..', path.basename(outside))]) {
      assert.equal(await resolveInBrowseRootAsync(home, t), resolveInBrowseRoot(home, t), `jail on ${JSON.stringify(t)}`);
    }
    fs.writeFileSync(path.join(store, 'recent.json'), JSON.stringify([inside, outside, path.join(home, 'missing'), path.join(home, 'file.txt'), inside, 'relative']));
    for (const br of [undefined, home]) assert.deepEqual(await readRecentAsync(store, br), readRecent(store, br), `recent under ${br}`);
    assert.deepEqual(await readRecentAsync(store, home), [inside]);
  } finally {
    for (const d of [home, outside, store]) fs.rmSync(d, { recursive: true, force: true });
  }
});
