import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitCommit } from '../server/gitWorkspace.js';

/**
 * A SELECTIVE COMMIT MUST COMMIT ONLY WHAT WAS SELECTED.
 *
 * `gitCommit` stages the caller's pathspecs with `git add -- <paths>` and then
 * runs a bare `git commit -m`. A bare commit commits THE WHOLE INDEX - so
 * anything the user had staged themselves, outside this product, was swept
 * into a commit they believed was limited to the files they ticked.
 *
 * This is the failure mode that is worst to discover late: it does not error,
 * it does not look wrong on screen, and the extra work is only visible once
 * the commit is already in history. `git-status-index.test.ts` covers reading
 * the index correctly; nothing covered writing it.
 */

function repo(): { dir: string; git: (...args: string[]) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-selective-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'chosen.ts'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { dir, git };
}

/** Paths touched by HEAD. */
function filesInHead(git: (...args: string[]) => string): string[] {
  return git('show', '--name-only', '--pretty=format:', 'HEAD')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .sort();
}

test('a file the USER staged outside the app is NOT swept into a selective commit', async () => {
  const { dir, git } = repo();

  /* The reader edits two files and stages one of them themselves - in a
     terminal, in their editor, however. That staged file is not something
     they picked in Review. */
  fs.writeFileSync(path.join(dir, 'chosen.ts'), 'const a = 2;\n');
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 2;\n');
  git('add', '--', 'not-chosen.ts');

  /* In Review they tick ONLY `chosen.ts` and commit. */
  const result = await gitCommit(dir, 'just the one file', ['chosen.ts']);
  assert.strictEqual(result.ok, true, result.error);

  assert.deepStrictEqual(
    filesInHead(git),
    ['chosen.ts'],
    'the commit must contain only the selected file',
  );

  /* And the reader's own staged work is still staged, not lost and not
     committed on their behalf. */
  const staged = git('diff', '--cached', '--name-only').trim();
  assert.strictEqual(staged, 'not-chosen.ts', "the user's own staged file is left staged");
});

test('committing every path still works when the caller names them all', async () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'chosen.ts'), 'const a = 3;\n');
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 3;\n');

  const result = await gitCommit(dir, 'both', ['chosen.ts', 'not-chosen.ts']);
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(filesInHead(git), ['chosen.ts', 'not-chosen.ts']);
});

test('with NO pathspecs it still commits everything, which is the documented contract', async () => {
  /* "No caller pathspecs: stage every change." That behaviour is relied on and
     must not change - the fix is about the SELECTIVE path only. */
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'chosen.ts'), 'const a = 4;\n');
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 4;\n');

  const result = await gitCommit(dir, 'everything', []);
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(filesInHead(git), ['chosen.ts', 'not-chosen.ts']);
});

test('a new file that git has never seen can still be committed selectively', async () => {
  /* `git commit -- <path>` refuses a path git does not know, so the staging
     step still has to run first. This is the case that breaks if the fix is
     "drop the add and just pass paths to commit". */
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'brand-new.ts'), 'const c = 1;\n');
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 5;\n');

  const result = await gitCommit(dir, 'add the new one', ['brand-new.ts']);
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(filesInHead(git), ['brand-new.ts']);
});

test('a deleted file can be committed selectively', async () => {
  const { dir, git } = repo();
  fs.rmSync(path.join(dir, 'chosen.ts'));
  fs.writeFileSync(path.join(dir, 'not-chosen.ts'), 'const b = 6;\n');

  const result = await gitCommit(dir, 'remove it', ['chosen.ts']);
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(filesInHead(git), ['chosen.ts']);
  assert.ok(!fs.existsSync(path.join(dir, 'chosen.ts')));
});
