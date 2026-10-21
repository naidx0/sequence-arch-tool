import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheSize, clearMapCache, isClearableCacheFile } from '../server/mapCache.js';
import { createRepoServer, startDeferredAttach } from '../server/repoServer.js';

/*
 * APP-15: "Clear map cache" removes ONLY what a scan regenerates. `.sequence/` also holds the person's own work
 * (boards, sessions, memory notes, snapshots, skills, settings): an allow-list test plants all of it and proves it
 * survives. Positive control: the regenerable files ARE removed, so a "nothing deleted" bug cannot pass.
 */

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function put(root: string, rel: string, size = 10): string {
  const p = path.join(root, '.sequence', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x'.repeat(size));
  return p;
}

const REGENERABLE = ['graph.json', 'functions.json', 'map.md', 'map-1k.md', 'map-16k.md'];
const USER_DATA = [
  'board.json',
  /* Written by a model call that costs the person tokens to repeat: kept. */
  'explain.json',
  'annotations.json',
  'chat-memory.json',
  'sessions/index.json',
  'sessions/s1/board.md',
  'sessions/s1/graph.json',
  'sessions/s1/attachments/pic.png',
  'memory/NOTES.md',
  'checkpoints/s1/snap.json',
  'skills/my-skill/SKILL.md',
  'policies/rule.json',
  'permissions.json',
  'hooks.json',
  'mcp.json',
  'ai.json',
  'spec.json',
  'agents-block.md',
  'components/mine/index.json',
];

test('APP-15: clear removes every regenerable file and leaves every planted user-data file', () => {
  const root = tmp('seq-app15-');
  try {
    const gone = REGENERABLE.map((f) => put(root, f, 100));
    const kept = USER_DATA.map((f) => put(root, f, 7));
    const out = clearMapCache(root);
    for (const p of gone) assert.ok(!fs.existsSync(p), `removed ${p}`);
    for (const p of kept) assert.ok(fs.existsSync(p), `kept ${p}`);
    assert.deepStrictEqual([...out.removed].sort(), [...REGENERABLE].sort());
    assert.strictEqual(out.freedBytes, 100 * REGENERABLE.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('APP-15: the allow-list refuses every user-data name and accepts every regenerable one', () => {
  for (const f of REGENERABLE) assert.ok(isClearableCacheFile(f), `${f} is clearable`);
  for (const f of USER_DATA) assert.ok(!isClearableCacheFile(f), `${f} is not clearable`);
  assert.ok(!isClearableCacheFile('graph.json/../board.json'));
});

test('APP-15: a cache-named directory and a symlink out are never followed or removed recursively', () => {
  const root = tmp('seq-app15-link-');
  const outside = tmp('seq-app15-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep');
    fs.mkdirSync(path.join(root, '.sequence', 'functions.json'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sequence', 'functions.json', 'inner.txt'), 'inner');
    try {
      fs.symlinkSync(outside, path.join(root, '.sequence', 'graph.json'), 'dir');
    } catch {
      /* no symlink rights on this machine: the directory case still runs */
    }
    clearMapCache(root);
    assert.ok(fs.existsSync(path.join(outside, 'precious.txt')));
    assert.ok(fs.existsSync(path.join(root, '.sequence', 'functions.json', 'inner.txt')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('APP-15: cacheSize counts the whole .sequence folder and says how much of it Clear would free', () => {
  const root = tmp('seq-app15-size-');
  try {
    assert.deepStrictEqual(cacheSize(root), { bytes: 0, clearableBytes: 0 });
    put(root, 'graph.json', 1000);
    put(root, 'map.md', 24);
    put(root, 'board.json', 500);
    put(root, 'sessions/s1/board.md', 40);
    assert.deepStrictEqual(cacheSize(root), { bytes: 1564, clearableBytes: 1024 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function start(repo: string | null, startupScanDelayMs?: number) {
  const userDir = tmp('seq-app15-user-');
  const server = await createRepoServer(repo, {
    webDist: undefined,
    browseRoot: path.dirname(repo ?? os.tmpdir()),
    userConfigDir: userDir,
    recentStoreDir: userDir,
    startupScanDelayMs,
    deferStartupAttach: startupScanDelayMs !== undefined,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

function makeRepo(prefix: string): { top: string; repo: string } {
  const top = tmp(prefix);
  const repo = path.join(top, 'proj');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx\n');
  return { top, repo };
}

test('APP-15: GET /api/cache-size and POST /api/cache/clear over HTTP, user data surviving', async () => {
  const { top, repo } = makeRepo('seq-app15-http-');
  const s = await start(repo);
  try {
    for (let i = 0; i < 100; i++) {
      const st = (await (await fetch(`${s.base}/api/status`)).json()) as { attached: boolean; scanning?: unknown };
      if (st.attached && !st.scanning) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const board = put(repo, 'board.json', 33);
    const planted = put(repo, 'functions.json', 2000);
    const size = (await (await fetch(`${s.base}/api/cache-size`)).json()) as { bytes: number; clearableBytes: number };
    assert.ok(size.clearableBytes >= 2000, `clearable ${size.clearableBytes}`);
    assert.ok(size.bytes >= size.clearableBytes + 33);

    const cleared = await fetch(`${s.base}/api/cache/clear`, { method: 'POST' });
    assert.strictEqual(cleared.status, 200);
    assert.ok(!fs.existsSync(planted), 'regenerable file removed');
    assert.ok(fs.existsSync(board), 'board kept');
    const after = (await (await fetch(`${s.base}/api/cache-size`)).json()) as { clearableBytes: number };
    assert.strictEqual(after.clearableBytes, 0);
  } finally {
    await s.close();
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('APP-15: clear is refused with 409 while a scan runs, and with no project open', async () => {
  const { top, repo } = makeRepo('seq-app15-409-');
  const s = await start(repo, 2500);
  const none = await start(null);
  try {
    const marker = put(repo, 'graph.json', 5);
    const run = startDeferredAttach(s.server);
    const busy = await fetch(`${s.base}/api/cache/clear`, { method: 'POST' });
    assert.strictEqual(busy.status, 409);
    assert.match(((await busy.json()) as { error: string }).error, /reading the project/);
    assert.ok(fs.existsSync(marker), 'nothing removed while scanning');
    await run;
    assert.strictEqual((await fetch(`${none.base}/api/cache/clear`, { method: 'POST' })).status, 409);
    assert.strictEqual((await fetch(`${none.base}/api/cache-size`)).status, 200);
  } finally {
    await s.close();
    await none.close();
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('review: clear is refused with 409 while a user Rescan runs (POST /api/scan), and nothing is removed', async (t) => {
  const { top, repo } = makeRepo('seq-app15-rescan-');
  for (let i = 0; i < 600; i++) {
    fs.mkdirSync(path.join(repo, 'src', `d${i % 20}`), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', `d${i % 20}`, `f${i}.ts`), `export const v${i} = ${i};\nexport function f${i}() { return v${i}; }\n`);
  }
  const s = await start(repo);
  try {
    for (let i = 0; i < 200; i++) {
      const st = (await (await fetch(`${s.base}/api/status`)).json()) as { attached: boolean; scanning?: unknown };
      if (st.attached && !st.scanning) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const marker = put(repo, 'functions.json', 50);
    let scanDone = false;
    const scan = fetch(`${s.base}/api/scan`, { method: 'POST' }).then(async (r) => {
      await r.arrayBuffer();
      scanDone = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    const busy = await fetch(`${s.base}/api/cache/clear`, { method: 'POST' });
    const finishedBeforeAnswer = scanDone;
    await scan;
    if (finishedBeforeAnswer) return t.skip('the scan finished before the clear arrived on this machine');
    assert.strictEqual(busy.status, 409, 'a user Rescan is a scan too');
    assert.ok(fs.existsSync(marker), 'nothing removed while the rescan runs');
  } finally {
    await s.close();
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
