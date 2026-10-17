import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { writeJson } from '../server/store.js';

import { scanRepo } from '../scan.js';
import { writeAgentMaps } from '../agentMap.js';
import { clearCachedGraph, writeCachedGraph } from '../server/graphCache.js';
import { flushTrackedWrites, isTrackedByGit, primeTrackedSequence, resetTrackedMemo } from '../server/trackedSequence.js';

/**
 * 019-model item 5: a repo that COMMITS files under `.sequence/` must not see the engine rewrite or delete them.
 * The reviewer's report: `graph.json` showed as deleted in git status after using the app.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');

const git =(cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });

function tempRepo(commitSequence: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-tracked-'));
  fs.cpSync(PLAINAPP, root, { recursive: true });
  fs.mkdirSync(path.join(root, '.sequence'), { recursive: true });
  if (commitSequence) {
    fs.writeFileSync(path.join(root, '.sequence', 'graph.json'), '{"committed":"by the person"}\n');
    fs.writeFileSync(path.join(root, '.sequence', 'map-1k.md'), '# my committed map\n');
    fs.mkdirSync(path.join(root, '.sequence', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sequence', 'cache', 'scan-index.v8'), 'committed-index');
    fs.writeFileSync(path.join(root, '.sequence', 'cache', 'facts.v8'), 'committed-facts');
  }
  git(root, 'init', '-q');
  git(root, 'add', '-f', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('019-model: committed .sequence/graph.json and map-1k.md survive a scan write, an invalidation and an agent-map write', async () => {
  resetTrackedMemo();
  const root = tempRepo(true);
  await primeTrackedSequence(root);
  const graph = await scanRepo(root, { cluster: true });
  const before = fs.readFileSync(path.join(root, '.sequence', 'graph.json'), 'utf8');

  writeCachedGraph(root, 'a'.repeat(64), graph);
  writeAgentMaps(root, graph);
  clearCachedGraph(root, path.join(root, 'package.json'));
  clearCachedGraph(root);

  assert.equal(fs.readFileSync(path.join(root, '.sequence', 'graph.json'), 'utf8'), before, 'graph.json is byte for byte the committed one');
  assert.equal(fs.readFileSync(path.join(root, '.sequence', 'map-1k.md'), 'utf8'), '# my committed map\n');
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no').trim(), '', 'git sees nothing changed');
});

test('019-model: a scan leaves committed .sequence/cache/*.v8 files as they are, and writes them when untracked', async () => {
  resetTrackedMemo();
  const tracked = tempRepo(true);
  await primeTrackedSequence(tracked);
  await scanRepo(tracked, { cluster: true, factsCache: true });
  assert.equal(fs.readFileSync(path.join(tracked, '.sequence', 'cache', 'scan-index.v8'), 'utf8'), 'committed-index');
  assert.equal(fs.readFileSync(path.join(tracked, '.sequence', 'cache', 'facts.v8'), 'utf8'), 'committed-facts');
  assert.equal(git(tracked, 'status', '--porcelain', '--untracked-files=no').trim(), '');

  resetTrackedMemo();
  const loose = tempRepo(false);
  await primeTrackedSequence(loose);
  await scanRepo(loose, { cluster: true, factsCache: true });
  /* The control: the same scan on an uncommitted .sequence writes its caches, so the check above can fail. */
  assert.ok(fs.existsSync(path.join(loose, '.sequence', 'cache', 'facts.v8')) || fs.existsSync(path.join(loose, '.sequence', 'cache', 'scan-index.v8')), 'the scan writes a cache when nothing tracks it');
});

test('019-model: control, an untracked .sequence/graph.json is still written and still cleared', async () => {
  resetTrackedMemo();
  const root = tempRepo(false);
  await primeTrackedSequence(root);
  const graph = await scanRepo(root, { cluster: true });
  const file = path.join(root, '.sequence', 'graph.json');
  writeCachedGraph(root, 'b'.repeat(64), graph);
  assert.ok(fs.existsSync(file), 'the cache is written when nothing tracks it');
  clearCachedGraph(root);
  assert.ok(!fs.existsSync(file), 'and removed on invalidation');
});

test('019-model: trackedSequence.ts puts no git on the MAIN thread event loop (a worker thread may block on it)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'server', 'trackedSequence.ts'), 'utf8');
  /* Read the code lines only: comments may mention the calls. */
  const code = src.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
  assert.ok(!code.includes('spawnSync') && !code.includes('execSync('), 'no sync shell call in trackedSequence.ts');
  assert.equal(code.split('execFileSync(').length - 1, 1, 'one blocking git call, in listTrackedSync');
  const guard = code.indexOf('if (!isMainThread');
  assert.ok(guard > 0 && code.indexOf('listTrackedSync(root)', guard) > guard, 'and only a non-main thread reaches it');
  assert.ok(code.includes('execFile('), 'the main thread check is asynchronous');
});

test('019-model: before the tracked set is known, an unignored .sequence write is held back and an ignored one goes ahead', async () => {
  resetTrackedMemo();
  const root = tempRepo(false);
  const { isTrackedByGit } = await import('../server/trackedSequence.js');
  assert.equal(isTrackedByGit(root, '.sequence/graph.json'), true, 'unknown and not ignored: held back');
  await primeTrackedSequence(root);
  assert.equal(isTrackedByGit(root, '.sequence/graph.json'), false, 'known, untracked: written');
  resetTrackedMemo();
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.sequence/\n');
  assert.equal(isTrackedByGit(root, '.sequence/graph.json'), false, 'unknown but ignored: written');
});

test('019-gate: a cache write held back while git is unknown is REPLAYED once the check resolves (fresh repo, no ignore rule)', async () => {
  resetTrackedMemo();
  const root = tempRepo(false);
  fs.rmSync(path.join(root, '.sequence'), { recursive: true, force: true });
  writeJson(root, 'functions.json', { version: 1, hello: 'first write' });
  await flushTrackedWrites();
  const file = path.join(root, '.sequence', 'functions.json');
  assert.ok(fs.existsSync(file), 'the very first cache write lands once git has answered');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hello, 'first write');
  /* and the latest of several queued writes wins */
  resetTrackedMemo();
  fs.rmSync(file);
  writeJson(root, 'functions.json', { n: 1 });
  writeJson(root, 'functions.json', { n: 2 });
  await flushTrackedWrites();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 2);
});

test('019-gate: a held-back write to a file git TRACKS is never replayed', async () => {
  resetTrackedMemo();
  const root = tempRepo(true);
  const file = path.join(root, '.sequence', 'graph.json');
  writeJson(root, 'graph.json', { version: 1, overwritten: true });
  await flushTrackedWrites();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"committed":"by the person"}\n', 'the committed file is byte for byte as committed');
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no').trim(), '');
});

test('019-gate: every gitignore spelling of .sequence content counts as ignored (no held-back write)', () => {
  const forms = ['.sequence', '.sequence/', '/.sequence', '/.sequence/', '.sequence/*', '.sequence/**'];
  for (const form of forms) {
    resetTrackedMemo();
    const root = tempRepo(false);
    fs.writeFileSync(path.join(root, '.gitignore'), `node_modules
${form}
`);
    assert.equal(isTrackedByGit(root, '.sequence/graph.json'), false, `${form}: ignored, so written at once`);
  }
  /* controls: a rule that does NOT cover .sequence, and no rule at all, still hold the write back */
  for (const form of ['.sequence-old/', 'sequence/', '#.sequence/', '']) {
    resetTrackedMemo();
    const root = tempRepo(false);
    fs.writeFileSync(path.join(root, '.gitignore'), `${form}
`);
    assert.equal(isTrackedByGit(root, '.sequence/graph.json'), true, `"${form}": not an ignore of .sequence`);
  }
});

async function inWorker(root: string, rel: string): Promise<boolean> {
  const mod = pathToFileURL(path.resolve(here, '..', 'server', 'trackedSequence.js')).href;
  const code = `const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.mod).then((m) => parentPort.postMessage(m.isTrackedByGit(workerData.root, workerData.rel)));`;
  return new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: { mod, root, rel } });
    w.once('message', (v) => resolve(v as boolean));
    w.once('error', reject);
  });
}

test('019-gate: a worker thread (cold memo of its own) answers at once and does not hold a write back', async () => {
  const loose = tempRepo(false);
  assert.equal(await inWorker(loose, '.sequence/graph.json'), false, 'untracked: the worker writes');
  const tracked = tempRepo(true);
  assert.equal(await inWorker(tracked, '.sequence/graph.json'), true, 'tracked: the worker leaves it');
});
