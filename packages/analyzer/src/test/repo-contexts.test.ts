import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bootMarks } from '../server/bootMarks.js';
import { createRepoServer } from '../server/repoServer.js';

/* P14 stage 1: the last three attached repos keep their graph and their watchers, so switching back is O(1)
   when nothing changed, and a change while parked (or a refused watch, or an eviction) takes the full path. */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');

async function start(names = ['a', 'b', 'c', 'd'], gitInit = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ctx-'));
  const repos = names.map((n) => {
    const p = path.join(home, n);
    fs.cpSync(PLAINAPP, p, { recursive: true });
    if (gitInit) {
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: p, windowsHide: true, stdio: 'pipe' });
      git('init', '-q', '-b', 'main');
      git('add', '-A');
      git('commit', '-q', '-m', 'init');
    }
    return p;
  });
  const store = path.join(home, '.sequence-user');
  fs.mkdirSync(store, { recursive: true });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, recentStoreDir: store, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  /** Attach and report which way the graph was obtained. */
  const attach = async (p: string): Promise<'context' | 'full'> => {
    const from = bootMarks().length;
    const res = await fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });
    assert.strictEqual(res.status, 200, await res.clone().text());
    const names = bootMarks().slice(from).map((m) => m.name);
    return names.includes('graphFromContext') ? 'context' : 'full';
  };
  return { repos, base, attach, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

test('switching back to an unchanged repo reuses its context; the first visit and a changed repo do not', async () => {
  const s = await start();
  try {
    const [a, b] = s.repos as [string, string];
    assert.strictEqual(await s.attach(a), 'full', 'first visit scans');
    assert.strictEqual(await s.attach(b), 'full');
    assert.strictEqual(await s.attach(a), 'context', 'back to A with nothing changed');
    const graph = (await (await fetch(`${s.base}/archgraph.json`)).json()) as { repoName: string };
    assert.strictEqual(graph.repoName, path.basename(a), 'the graph served is the repo switched to, not the one just left');
    assert.strictEqual(await s.attach(b), 'context');
    /* A change while B is parked is seen by its own watcher. */
    await s.attach(a);
    fs.writeFileSync(path.join(b, 'added-while-parked.js'), 'module.exports = 1;\n');
    await settle();
    assert.strictEqual(await s.attach(b), 'full', 'a parked repo that changed is re-checked, never trusted');
  } finally {
    await s.close();
  }
});

test('the context cache holds three repos: the fourth evicts the least recently used', async () => {
  const s = await start();
  try {
    const [a, b, c, d] = s.repos as [string, string, string, string];
    for (const p of [a, b, c]) await s.attach(p);
    assert.strictEqual(await s.attach(d), 'full');
    assert.strictEqual(await s.attach(c), 'context', 'C is among the last three');
    assert.strictEqual(await s.attach(a), 'full', 'A was evicted when D arrived');
  } finally {
    await s.close();
  }
});

test('detach parks the repo: attaching it again is O(1)', async () => {
  const s = await start();
  try {
    const [a] = s.repos as [string];
    await s.attach(a);
    await fetch(`${s.base}/api/detach`, { method: 'POST' });
    assert.strictEqual(await s.attach(a), 'context');
  } finally {
    await s.close();
  }
});

test('a fresh attach is not stale after the debounce, and a normal dwell A -> B -> A is still O(1) (the scan raises directory events)', async () => {
  const s = await start(['a', 'b']);
  try {
    const [a, b] = s.repos as [string, string];
    await s.attach(a);
    await settle(1500);
    const g1 = (await (await fetch(`${s.base}/archgraph.json`)).json()) as { stale?: boolean; stalePaths?: string[] };
    assert.strictEqual(g1.stale, undefined, `fresh attach reported stale: ${JSON.stringify(g1.stalePaths)}`);
    await s.attach(b);
    await settle(1500);
    assert.strictEqual(await s.attach(a), 'context', 'unchanged repo after a normal dwell is reused');
  } finally {
    await s.close();
  }
});

test('a branch switch made while a repo is parked forces a full re-check on return', async () => {
  const s = await start(['a', 'b'], true);
  try {
    const [a, b] = s.repos as [string, string];
    await s.attach(a);
    await s.attach(b);
    assert.strictEqual(await s.attach(a), 'context', 'control: unchanged returns O(1)');
    await s.attach(b);
    execFileSync('git', ['checkout', '-q', '-b', 'other'], { cwd: a, windowsHide: true, stdio: 'pipe' });
    await settle();
    assert.strictEqual(await s.attach(a), 'full');
  } finally {
    await s.close();
  }
});
