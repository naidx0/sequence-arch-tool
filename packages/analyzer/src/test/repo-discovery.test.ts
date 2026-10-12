import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRepos } from '../server/repoDiscovery.js';

/**
 * Lock for first-run repo discovery. Each test builds its OWN fixture home in
 * os.tmpdir and scans only that; the real home folder is never walked here.
 */

function tempRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-discover-')));
}

/** Make `root/rel` a git repo (a `.git` dir with HEAD + index), optionally aged. */
function makeRepo(root: string, rel: string, ageSec = 0): string {
  const dir = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  for (const f of ['HEAD', 'index']) {
    const p = path.join(dir, '.git', f);
    fs.writeFileSync(p, f === 'HEAD' ? 'ref: refs/heads/main\n' : '');
    const t = (Date.now() - ageSec * 1000) / 1000;
    fs.utimesSync(p, t, t);
  }
  return dir;
}

function names(paths: string[], root: string): string[] {
  return paths.map((p) => path.relative(root, p).split(path.sep).join('/')).sort();
}

test('finds repos breadth-first, ranks by last activity, never descends into a repo', async () => {
  const root = tempRoot();
  makeRepo(root, 'old', 3600);
  makeRepo(root, 'new', 10);
  makeRepo(root, 'projects/mid', 600);
  makeRepo(root, 'new/nested-inside-repo');
  const r = await discoverRepos({ root });
  assert.deepStrictEqual(names(r.repos.map((x) => x.path), root), ['new', 'old', 'projects/mid']);
  assert.deepStrictEqual(r.repos.map((x) => x.name), ['new', 'mid', 'old'], 'newest activity first');
  assert.strictEqual(r.truncated, false);
  assert.ok(r.repos.every((x) => typeof x.lastActive === 'number' && x.recent === false));
  assert.ok(r.repos.every((x) => x.path.startsWith(root + path.sep)), 'inside the root');
});

test('depth: a repo 5 levels down is found; NEGATIVE: one 6 levels down is not', async () => {
  const root = tempRoot();
  makeRepo(root, 'a/b/c/d/five');
  makeRepo(root, 'p/q/r/s/t/six');
  const r = await discoverRepos({ root });
  assert.deepStrictEqual(names(r.repos.map((x) => x.path), root), ['a/b/c/d/five']);
});

test('NEGATIVE: node_modules, AppData, Library and hidden folders are skipped (control: same repo elsewhere is found)', async () => {
  const root = tempRoot();
  makeRepo(root, 'node_modules/pkg');
  makeRepo(root, 'app/node_modules/dep');
  makeRepo(root, 'AppData/Local/thing');
  makeRepo(root, 'Library/thing');
  makeRepo(root, '.cache/thing');
  makeRepo(root, '.hidden/thing');
  makeRepo(root, 'modules/pkg');
  const r = await discoverRepos({ root });
  assert.deepStrictEqual(names(r.repos.map((x) => x.path), root), ['modules/pkg']);
});

test('a worktree (.git FILE) counts as a repo', async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'wt'));
  fs.writeFileSync(path.join(root, 'wt', '.git'), 'gitdir: elsewhere\n');
  const r = await discoverRepos({ root });
  assert.deepStrictEqual(names(r.repos.map((x) => x.path), root), ['wt']);
  assert.strictEqual(typeof r.repos[0].lastActive, 'number');
});

test('a link loop is not followed and terminates with no duplicates', async () => {
  const root = tempRoot();
  makeRepo(root, 'real/repo');
  fs.symlinkSync(root, path.join(root, 'real', 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = await discoverRepos({ root });
  assert.deepStrictEqual(names(r.repos.map((x) => x.path), root), ['real/repo']);
});

test('recent repos come first (in recent order), even an older or out-of-walk one', async () => {
  const root = tempRoot();
  makeRepo(root, 'fresh', 1);
  const oldRecent = makeRepo(root, 'stale', 99_999);
  const deepRecent = makeRepo(root, 'a/b/c/d/e/f/deep', 50_000);
  const notRepo = path.join(root, 'plain');
  fs.mkdirSync(notRepo);
  const r = await discoverRepos({ root, recent: [deepRecent, oldRecent, notRepo] });
  assert.deepStrictEqual(r.repos.map((x) => [x.name, x.recent]), [
    ['deep', true],
    ['stale', true],
    ['fresh', false],
  ]);
});

test('caps: result count and time budget mark the result truncated', async () => {
  const root = tempRoot();
  for (let i = 0; i < 5; i++) makeRepo(root, `r${i}`);
  const capped = await discoverRepos({ root, maxResults: 3 });
  assert.strictEqual(capped.repos.length, 3);
  assert.strictEqual(capped.truncated, true);
  const full = await discoverRepos({ root });
  assert.strictEqual(full.repos.length, 5);
  assert.strictEqual(full.truncated, false);
  const timed = await discoverRepos({ root, budgetMs: 0 });
  assert.strictEqual(timed.truncated, true);
});

test('an unreadable or missing root yields nothing, not a throw', async () => {
  const r = await discoverRepos({ root: path.join(tempRoot(), 'does-not-exist') });
  assert.deepStrictEqual(r.repos, []);
});
