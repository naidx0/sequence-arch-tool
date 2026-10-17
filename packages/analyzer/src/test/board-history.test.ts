import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { branchFiles, churn, isSafeRef, parseChurn, parseNameStatus } from '../server/gitHistory.js';

/* The board's Diff and Hotspots views read two things from git: what this
   branch changes against a base, and how often each file changed in the
   window before HEAD. Read-only, fixed argv, reproducible per commit. */

function git(cwd: string, env: Record<string, string>, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-git-history-'));
  git(root, {}, 'init', '-q', '-b', 'main');
  git(root, {}, 'config', 'user.email', 'test@example.com');
  git(root, {}, 'config', 'user.name', 'Test');
  git(root, {}, 'config', 'commit.gpgsign', 'false');
  return root;
}

function commitAt(root: string, iso: string, files: Record<string, string | null>, subject: string) {
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(root, f);
    if (body === null) git(root, {}, 'rm', '-q', f);
    else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
      git(root, {}, 'add', f);
    }
  }
  git(root, { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }, 'commit', '-q', '-m', subject);
}

test('branch-files lists what the branch changes since the merge base, by status', async () => {
  const root = repo();
  try {
    commitAt(root, '2026-09-01T12:00:00Z', { 'a/x.ts': 'x\n', 'a/gone.ts': 'g\n', 'b/y.ts': 'y\n' }, 'base');
    git(root, {}, 'checkout', '-q', '-b', 'feature');
    commitAt(root, '2026-09-02T12:00:00Z', { 'a/x.ts': 'x2\n', 'a/new.ts': 'n\n', 'a/gone.ts': null }, 'work');
    /* main moves on too: its change is not this branch's. */
    git(root, {}, 'checkout', '-q', 'main');
    commitAt(root, '2026-09-03T12:00:00Z', { 'b/y.ts': 'y2\n' }, 'main moves');
    git(root, {}, 'checkout', '-q', 'feature');
    const r = await branchFiles(root, 'main');
    assert.deepStrictEqual(r.files, [
      { path: 'a/gone.ts', status: 'deleted' },
      { path: 'a/new.ts', status: 'added' },
      { path: 'a/x.ts', status: 'modified' },
    ]);
    assert.match(r.mergeBase ?? '', /^[0-9a-f]{40}$/);
    await assert.rejects(branchFiles(root, '--output=/tmp/x'), /not a ref/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('branch-files falls back from a missing main to master, then to a calm "no base" answer (never a raw git error)', async () => {
  const root = repo();
  try {
    /* no commits at all */
    const empty = await branchFiles(root, 'main');
    assert.strictEqual(empty.noBase, true);
    assert.deepStrictEqual(empty.files, []);
    git(root, {}, 'branch', '-m', 'master');
    commitAt(root, '2026-09-01T12:00:00Z', { 'a.ts': '1\n' }, 'base');
    git(root, {}, 'checkout', '-q', '-b', 'feature');
    commitAt(root, '2026-09-02T12:00:00Z', { 'b.ts': '1\n' }, 'work');
    const r = await branchFiles(root, 'main');
    assert.strictEqual(r.base, 'master');
    assert.strictEqual(r.requested, 'main');
    assert.deepStrictEqual(r.files, [{ path: 'b.ts', status: 'added' }]);
    /* the default branch itself, asked for as main: empty diff against master, not an error */
    git(root, {}, 'checkout', '-q', 'master');
    const onMaster = await branchFiles(root, 'main');
    assert.strictEqual(onMaster.base, 'master');
    assert.deepStrictEqual(onMaster.files, []);
    /* neither main nor master, no upstream: no base, empty, flagged */
    git(root, {}, 'branch', '-m', 'trunk');
    const none = await branchFiles(root, 'main');
    assert.strictEqual(none.noBase, true);
    assert.strictEqual(none.base, null);
    assert.deepStrictEqual(none.files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('churn counts commits per file in the days before HEAD, not before today', async () => {
  const root = repo();
  try {
    commitAt(root, '2026-01-01T12:00:00Z', { 'old.ts': '1\n' }, 'long ago');
    commitAt(root, '2026-08-20T12:00:00Z', { 'a.ts': '1\n', 'b.ts': '1\n' }, 'one');
    commitAt(root, '2026-09-10T12:00:00Z', { 'a.ts': '2\n' }, 'two');
    commitAt(root, '2026-09-15T12:00:00Z', { 'a.ts': '3\n', 'old.ts': '2\n' }, 'three');
    const r = await churn(root, 30);
    assert.strictEqual(Date.parse(r.until), Date.parse('2026-09-15T12:00:00Z'));
    assert.strictEqual(r.commits, 3);
    assert.deepStrictEqual(r.files, { 'a.ts': 3, 'b.ts': 1, 'old.ts': 1 });
    const narrow = await churn(root, 10);
    assert.deepStrictEqual(narrow.files, { 'a.ts': 2, 'old.ts': 1 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the parsers: renames, a commit with no files, and refs a caller may not pass', () => {
  assert.deepStrictEqual(parseNameStatus('R087\0a/old.ts\0a/new.ts\0M\0b.ts\0'), [
    { path: 'a/new.ts', status: 'renamed', from: 'a/old.ts' },
    { path: 'b.ts', status: 'modified' },
  ]);
  assert.deepStrictEqual(parseChurn('\x1e\n\na.ts\nb.ts\n\x1e\n\na.ts\n'), { commits: 2, files: { 'a.ts': 2, 'b.ts': 1 } });
  assert.ok(isSafeRef('main') && isSafeRef('origin/main') && isSafeRef('HEAD~30') && isSafeRef('85bb6171'));
  assert.ok(!isSafeRef('-x') && !isSafeRef('a..b') && !isSafeRef('a b') && !isSafeRef('$(rm)') && !isSafeRef(''));
});
