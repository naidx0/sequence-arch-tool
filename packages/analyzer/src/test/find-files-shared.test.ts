/**
 * find_files on a 20,000-file repository: one shared index per repo, a bounded
 * cost for it, and no stalled turn while it builds (review of find-files, items
 * 1 and 4).
 *
 * Before: every agent session's MCP process built and held its own index
 * (~665 MB RSS each at 20,000 files), and a call on a cold index waited up to
 * 4 s before answering by path words anyway.
 */
import { bound } from './load-scale.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeFindFilesHostConnections, findFilesHostStats, findFilesShared } from '../explain/findFilesHost.js';
import { findFiles } from '../explain/findFiles.js';
import { makeBigRepo } from './findFilesBigRepo.js';

const ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'explain', 'findFilesHostMain.js');
const INDEX_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '3000';
/* This suite patches os.tmpdir() per process; every session and host here must agree on one address directory. */
process.env.SEQUENCE_FIND_FILES_HOST_DIR = fs.mkdtempSync(path.join(process.env.SEQUENCE_TEST_REAL_TMPDIR ?? os.tmpdir(), 'seq-ffh-'));
process.env.SEQUENCE_FIND_FILES_LEARN = '0';

const big = makeBigRepo(20_000);
const tiny = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ff-tiny-')));
execFileSync('git', ['init', '-q'], { cwd: tiny });
fs.writeFileSync(path.join(tiny, 'a.ts'), 'export const a = 1;\n');
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: tiny });
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], { cwd: tiny });

after(() => {
  closeFindFilesHostConnections();
  /* The hosts exit 3 s after their last client leaves; the files can go now. */
  fs.rmSync(big, { recursive: true, force: true });
  fs.rmSync(tiny, { recursive: true, force: true });
  setTimeout(() => fs.rmSync(process.env.SEQUENCE_FIND_FILES_HOST_DIR!, { recursive: true, force: true }), 4_000).unref();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function readyStats(root: string, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const s = await findFilesHostStats(root, ENTRY);
    if (s?.ltr) return s;
    if (Date.now() > until) throw new Error(`index not ready in ${ms} ms: ${JSON.stringify(s)}`);
    await sleep(500);
  }
}

/** Another agent session: a separate process asking the same repo, reporting which host answered and its own memory. */
function otherSession(root: string): { pid: number; ranker: string; ownRss: number } {
  const js = `import(${JSON.stringify(pathToFileURL(INDEX_JS).href)}).then(async (A) => {
    const r = await A.findFilesShared(${JSON.stringify(root)}, 'kalomi tenra helper', { entry: ${JSON.stringify(ENTRY)} });
    const s = await A.findFilesHostStats(${JSON.stringify(root)}, ${JSON.stringify(ENTRY)});
    process.stdout.write(JSON.stringify({ pid: s.pid, ranker: r.ranker, ownRss: process.memoryUsage().rss }));
    A.closeFindFilesHostConnections();
  })`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', js], { encoding: 'utf8', env: process.env })) as { pid: number; ranker: string; ownRss: number };
}

test('find_files: a cold call on a 20,000-file repo answers by path words in well under a second, it does not stall the turn for 4 s', async () => {
  const t = performance.now();
  const r = await findFilesShared(big, 'where is the retry delay computed', { entry: ENTRY, noLog: true });
  const wall = performance.now() - t;
  /* Scaled by load (never above 3.5 s, so the old 4 s index wait fails at any load): a cold call returns path-word results without waiting for the build. */
  assert.ok(wall < bound(2_000, 3_500), `first call took ${Math.round(wall)} ms (host spawn included)`);
  assert.equal(r.ranker, 'paths');
  assert.match(r.text, /call find_files again in a few seconds/);
});

test('find_files: in-process, a cold index waits at most 250 ms by default (it waited up to 4 s)', async () => {
  const t = performance.now();
  const r = await findFiles(big, 'retry delay computed', { noLog: true });
  const wall = performance.now() - t;
  /* Scaled by load, ceiling 2.5 s: a cold in-process call does not wait for the build (the old wait was 4 s). */
  assert.ok(wall < bound(1_000, 2_500), `cold call took ${Math.round(wall)} ms`);
  assert.equal(r.ranker, 'paths');
});

test('find_files: several sessions on one repo share ONE index process, and no session holds an index itself', async () => {
  const a = otherSession(big);
  const b = otherSession(big);
  const mine = await findFilesHostStats(big, ENTRY);
  assert.ok(mine, 'the host answers');
  assert.equal(a.pid, mine!.pid, 'session A reached the same host');
  assert.equal(b.pid, mine!.pid, 'session B reached the same host');
  assert.equal(mine!.builds, 1, 'built once');
  for (const s of [a, b]) assert.ok(s.ownRss < 150e6, `a session process holds no index: ${Math.round(s.ownRss / 1e6)} MB`);
});

test('find_files: the shared index for a 20,000-file repo holds under 150 MB live and its process stays under 240 MB, and a warm call is fast', { timeout: 300_000 }, async () => {
  const s = await readyStats(big, 240_000);
  assert.equal(s.files, 20_000);
  await sleep(1_500);
  const settled = (await findFilesHostStats(big, ENTRY))!;
  const empty = (await readyStats(tiny, 60_000))!;
  const live = settled.heapUsed + settled.external - (empty.heapUsed + empty.external);
  const mb = (n: number): number => Math.round(n / 1e6);
  const msg = `index live ${mb(live)} MB; host RSS ${mb(settled.rss)} MB (an empty repo's host ${mb(empty.rss)} MB)`;
  /* Before this review: ~179 MB heap + 34 MB external live, ~665 MB RSS, in EVERY session's process. */
  assert.ok(live < 150e6, msg);
  assert.ok(settled.rss < 240e6, msg);
  const t = performance.now();
  const r = await findFilesShared(big, 'kalomi tenra', { entry: ENTRY, noLog: true });
  assert.equal(r.ranker, 'frozen');
  assert.ok(performance.now() - t < 1_000);
});
