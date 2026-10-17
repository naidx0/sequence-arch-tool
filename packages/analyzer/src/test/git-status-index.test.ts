import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitStatus } from '../server/gitWorkspace.js';

/**
 * STAGED AND UNSTAGED ARE DIFFERENT FACTS, and the wire could not say so.
 *
 * Porcelain gives TWO letters per file — X for the index, Y for the working
 * tree — and `classifyStatus` collapsed them into one word. So the Staged
 * review scope listed the ENTIRE dirty tree: every file looked identical to
 * it, and a reader clicking Staged saw changes that were not staged at all.
 */

function repo(): { dir: string; git: (...a: string[]) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-status-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'two\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { dir, git };
}

import type { GitStatusFile } from '../server/gitWorkspace.js';

/* Typed as the real result, so the test reads the same shape the product
   does — the loose `{ path: string }` annotation compiled under vitest and
   failed the build, which is `tsc` doing the job vitest cannot. */
const find = (files: GitStatusFile[], p: string): GitStatusFile =>
  files.find((f) => f.path === p)!;

test('a STAGED change is staged and not unstaged', async () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'changed\n');
  git('add', 'a.ts');

  const status = await gitStatus(dir);
  const a = find(status.files, 'a.ts');
  assert.strictEqual(a.staged, true);
  assert.strictEqual(a.unstaged, false);
});

test('an UNSTAGED change is unstaged and not staged', async () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'b.ts'), 'changed\n');

  const status = await gitStatus(dir);
  const b = find(status.files, 'b.ts');
  assert.strictEqual(b.staged, false);
  assert.strictEqual(b.unstaged, true);
});

test('A FILE CAN BE BOTH, which is why one boolean would not do', async () => {
  /*
   * Stage a change, edit it again, and git records `MM`: part of it is in the
   * index and part is not. A single `staged` boolean would have to pick a side
   * and would be wrong about half of these files.
   */
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'staged version\n');
  git('add', 'a.ts');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'and then edited again\n');

  const a = find((await gitStatus(dir)).files, 'a.ts');
  assert.strictEqual(a.staged, true);
  assert.strictEqual(a.unstaged, true);
});

test('an UNTRACKED file is in neither', async () => {
  /* It is not in the index and it is not a change to something tracked. */
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'new.ts'), 'brand new\n');

  const n = find((await gitStatus(dir)).files, 'new.ts');
  assert.strictEqual(n.status, 'untracked');
  assert.strictEqual(n.staged, false);
  assert.strictEqual(n.unstaged, false);
});

test('the collapsed word is unchanged — this ADDS a fact, it does not replace one', async () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'changed\n');
  git('add', 'a.ts');
  assert.strictEqual(find((await gitStatus(dir)).files, 'a.ts').status, 'modified');
});
