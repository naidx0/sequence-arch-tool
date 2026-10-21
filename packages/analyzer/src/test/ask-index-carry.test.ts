import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { mock, test } from 'node:test';
import { ASK_INDEX_REFRESH_MS, askIndexEvents, readyAskFileIndex, warmAskFileIndex } from '../explain/askFileIndex.js';
import { resolveInRepo } from '../server/jail.js';
import { createRepoServer } from '../server/repoServer.js';

/*
 * 019-P2D: a rescan of the same repo carries the ask index over instead of rebuilding it. Three one-file
 * rescans used to rebuild it three times (a ~130 MB allocation peak each, the engine at 400 MB), and the
 * attach-time context kept the first graph, and with it the first index, alive.
 */

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-carry-')));
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), `export const v${i} = ${i}; // carry fixture ${i}\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'carry-app', version: '1.0.0', main: 'f0.ts' }));
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const files = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));

test('a rescan carries the ready index; a HEAD move, many new files, or an old index rebuild it', async () => {
  const dir = repo();
  const resolve = (p: string) => resolveInRepo(dir, p);
  const paths = files(dir);
  const s1 = {};
  const first = await warmAskFileIndex(s1, dir, paths, resolve);
  assert.ok(first);
  let starts = 0;
  const onStart = (): void => void starts++;
  askIndexEvents.on('start', onStart);
  try {
    const s2 = {};
    assert.equal(await warmAskFileIndex(s2, dir, paths, resolve, {}, s1), first, 'same index object: no rebuild');
    assert.equal(readyAskFileIndex(s2, dir), first);
    assert.equal(starts, 0);
    /* Chained: the third scan carries from the second. */
    const s3 = {};
    assert.equal(await warmAskFileIndex(s3, dir, paths, resolve, {}, s2), first);
    /* Controls: each rule that must rebuild does. */
    const s4 = {};
    const moved = await warmAskFileIndex(s4, dir, paths, resolve, {}, s3, true);
    assert.ok(moved && moved !== first, 'fresh (HEAD moved) rebuilds');
    assert.equal(starts, 1);
    const s5 = {};
    const many = await warmAskFileIndex(s5, dir, [...paths, ...Array.from({ length: 25 }, (_, i) => `new${i}.ts`)], resolve, {}, s4);
    assert.ok(many && many !== moved, 'many files the index never saw rebuild');
    const s6 = {};
    assert.equal(await warmAskFileIndex(s6, dir, [...paths, 'one-new.ts'], resolve, {}, s5), many, 'a few new files do not');
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      mock.timers.tick(ASK_INDEX_REFRESH_MS + 1000);
      const s7 = {};
      const aged = await warmAskFileIndex(s7, dir, paths, resolve, {}, s6);
      assert.ok(aged && aged !== many, 'an index older than the refresh age rebuilds');
    } finally {
      mock.timers.reset();
    }
    /* No ready index to carry (the previous build was cancelled): builds. */
    const lost = {};
    const s8 = {};
    const built = await warmAskFileIndex(s8, dir, paths, resolve, {}, lost);
    assert.ok(built);
  } finally {
    askIndexEvents.off('start', onStart);
  }
});

test('a superseded scan is not retained by the index it handed on', async () => {
  const dir = repo();
  const resolve = (p: string) => resolveInRepo(dir, p);
  const paths = files(dir);
  let s1: object | null = {};
  const ref = new WeakRef(s1);
  const index = await warmAskFileIndex(s1, dir, paths, resolve);
  const s2 = {};
  assert.equal(await warmAskFileIndex(s2, dir, paths, resolve, {}, s1), index);
  s1 = null;
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  for (let i = 0; i < 5 && ref.deref() !== undefined; i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  assert.equal(ref.deref(), undefined, 'the old scan was collected');
  assert.equal(readyAskFileIndex(s2, dir), index, 'and the index lives on through the new scan');
});

test('engine: three one-file rescans do not rebuild the ask index', async () => {
  const dir = repo();
  const store = path.join(dir, '..', `${path.basename(dir)}-store`);
  fs.mkdirSync(store, { recursive: true });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, recentStoreDir: store, browseRoot: path.dirname(dir), askIndexWarm: 'eager', shadowWarm: { delayMs: 10 * 60_000 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const starts: string[] = [];
  const ready: string[] = [];
  const onStart = (root: string): void => void starts.push(root);
  const onReady = (root: string): void => void ready.push(root);
  askIndexEvents.on('start', onStart);
  askIndexEvents.on('ready', onReady);
  const waitFor = async (cond: () => boolean, what: string): Promise<void> => {
    for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(cond(), what);
  };
  try {
    const res = await fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: dir }) });
    assert.equal(res.status, 200, await res.clone().text());
    await waitFor(() => ready.length === 1, 'the attach built the index once');
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(path.join(dir, 'f1.ts'), `\n// touch ${i}\n`);
      const r = await fetch(`${base}/api/scan`, { method: 'POST' });
      assert.equal(r.status, 200, await r.clone().text());
      await r.arrayBuffer();
      await new Promise((r2) => setTimeout(r2, 300));
    }
    assert.equal(starts.length, 1, `three one-file rescans started ${starts.length - 1} extra index builds`);
  } finally {
    askIndexEvents.off('start', onStart);
    askIndexEvents.off('ready', onReady);
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('sendJsonChunked writes exactly the bytes JSON.stringify would, in pieces', async () => {
  const { sendJsonChunked } = await import('../server/repoServer.js');
  const big = Array.from({ length: 1300 }, (_, i) => (i % 7 === 0 ? undefined : { id: `n${i}`, s: 'x"y\n', n: i }));
  const detail: Record<string, unknown> = {};
  for (let i = 0; i < 1300; i++) detail[`k${i}`] = i % 11 === 0 ? undefined : { a: [i], b: null };
  const body = { first: 1, nodes: big, gone: undefined, edges: [], nodeDetail: detail, last: 'é' };
  const writes: string[] = [];
  const res = {
    statusCode: 0,
    setHeader: () => undefined,
    write: (s: string) => (writes.push(s), true),
    end: (s?: string) => void (s !== undefined && writes.push(s)),
    once: () => undefined,
  };
  await sendJsonChunked(res as never, 200, body);
  assert.equal(writes.join(''), JSON.stringify(body));
  assert.ok(writes.length > 6, 'written in pieces');
  assert.equal(res.statusCode, 200);
});
