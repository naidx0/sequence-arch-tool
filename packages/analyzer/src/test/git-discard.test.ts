import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitDiscard } from '../server/gitWorkspace.js';

/**
 * THROWING AWAY A WORKING-TREE CHANGE.
 *
 * Review could show a change and offer nothing to do about it except accept
 * it. A reader who decided a proposal was wrong had to leave for a terminal.
 *
 * This is the ONE genuinely destructive operation in the product: the content
 * is not in the index, not in a commit, and not recoverable by git once it is
 * gone. Every test below is about that.
 */

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-discard-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'const original = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return dir;
}

test('restores a modified tracked file to HEAD', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'const changed = 2;\n');

  const result = await gitDiscard(dir, ['a.ts']);
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(result.discarded, ['a.ts']);
  assert.match(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8'), /original/);
});

test('IT NEVER DISCARDS EVERYTHING', async () => {
  /*
   * An empty list is a caller that lost its argument. Treating it as "the
   * whole tree" would put an afternoon's work one mis-click from deletion,
   * which is why there is no `discard all` anywhere in this product.
   */
  const dir = repo();
  const result = await gitDiscard(dir, []);
  assert.strictEqual(result.ok, false);
  assert.match(result.error!, /never discards everything/i);
});

test('REFUSES AN UNTRACKED FILE rather than deleting it', async () => {
  /*
   * `git checkout --` restores a tracked file from HEAD. For an untracked file
   * there is nothing to restore TO, and the only way to "discard" it is to
   * delete it — a different act with a different blast radius. It says so
   * instead of performing it.
   */
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'new.ts'), 'const brand = 1;\n');

  const result = await gitDiscard(dir, ['new.ts']);
  assert.strictEqual(result.ok, false);
  assert.match(result.error!, /not tracked/i);
  /* And the file is still there. */
  assert.ok(fs.existsSync(path.join(dir, 'new.ts')));
});

test('REFUSES A PATH THAT ESCAPES THE REPOSITORY', async () => {
  /* The same jail every other path-taking route uses. A discard that escaped
     would delete a file outside the repo. */
  const dir = repo();
  const result = await gitDiscard(dir, ['../outside.ts']);
  assert.strictEqual(result.ok, false);
  assert.match(result.error!, /escapes the repository/i);
});

test('one bad path refuses the WHOLE request, changing nothing', async () => {
  /* Partially discarding is worse than refusing: the reader asked for one
     act and would get half of it, with no way to tell which half. */
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a.ts'), 'const changed = 2;\n');

  const result = await gitDiscard(dir, ['a.ts', 'nope.ts']);
  assert.strictEqual(result.ok, false);
  assert.match(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8'), /changed/);
});
