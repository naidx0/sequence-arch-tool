import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { gitRevisions } from '../server/gitWorkspace.js';

/**
 * WHAT A REVIEWER CAN NAME.
 *
 * `GET /api/git/diff` grew `?scope=commit&rev=` and `?scope=branch&base=`, and
 * the review pane still could not use either: it had no way to NAME a revision
 * or a base, and a Commit scope that always meant HEAD is the worktree scope
 * wearing another word. This is the list it picks from.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-revs-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

function commit(root: string, file: string, subject: string) {
  fs.writeFileSync(path.join(root, file), `${subject}\n`);
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', subject);
}

test('a repo with no commits has no revisions — a real answer, not an error', async () => {
  const root = repo();
  try {
    const r = await gitRevisions(root);
    /* Every repository starts here, and throwing would make an empty one look
       broken to a pane that is only trying to populate a picker. */
    assert.deepStrictEqual(r.commits, []);
    assert.deepStrictEqual(r.branches, []);
    /* Before the first commit you ARE on a branch — it just has nothing on it.
       The name is whatever `init.defaultBranch` is here, so this asserts that
       one is reported rather than which. */
    assert.ok(typeof r.head === 'string' && r.head.length > 0, `expected a branch, got ${r.head}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('commits come back newest first, with the short sha a person types', async () => {
  const root = repo();
  try {
    commit(root, 'a.txt', 'first');
    commit(root, 'b.txt', 'second');
    const r = await gitRevisions(root);
    assert.deepStrictEqual(r.commits.map((c) => c.subject), ['second', 'first']);
    for (const c of r.commits) {
      assert.match(c.sha, /^[0-9a-f]{40}$/);
      assert.ok(c.shortSha.length >= 7 && c.sha.startsWith(c.shortSha));
      /* ISO-8601 from git's own %aI, never re-derived from a locale string —
         a date a picker sorts by has to be sortable. */
      assert.match(c.at, /^\d{4}-\d{2}-\d{2}T/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a subject containing newlines and tabs survives intact', async () => {
  const root = repo();
  try {
    /*
     * THE REASON THE SEPARATORS ARE CONTROL CHARACTERS. A commit subject can
     * contain anything a person can type — a pipe, a tab, the delimiter you
     * were about to choose — and a parser that split on a printable character
     * would mangle exactly the commits whose messages are worth reading.
     */
    const nasty = 'fix: a|b\tc "quoted" and $dollar';
    fs.writeFileSync(path.join(root, 'x.txt'), 'x\n');
    git(root, 'add', 'x.txt');
    git(root, 'commit', '-q', '-m', nasty);

    const r = await gitRevisions(root);
    assert.strictEqual(r.commits[0]!.subject, nasty);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('branches are listed and sorted, and HEAD names the one it is on', async () => {
  const root = repo();
  try {
    commit(root, 'a.txt', 'first');
    git(root, 'branch', 'zeta');
    git(root, 'branch', 'alpha');
    const r = await gitRevisions(root);
    assert.deepStrictEqual(r.branches, ['alpha', 'master', 'zeta']);
    assert.strictEqual(r.head, 'master');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a detached HEAD is null, not a sha', async () => {
  const root = repo();
  try {
    commit(root, 'a.txt', 'first');
    commit(root, 'b.txt', 'second');
    git(root, 'checkout', '-q', 'HEAD~1');
    const r = await gitRevisions(root);
    /*
     * "On a branch called 4f2a1c" is a sentence that sends someone looking for
     * a branch that does not exist. Null is the truth.
     */
    assert.strictEqual(r.head, null);
    assert.ok(r.commits.length > 0, 'a detached HEAD still has history');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the count is bounded on the way in', async () => {
  const root = repo();
  try {
    for (let i = 0; i < 5; i += 1) commit(root, `f${i}.txt`, `commit ${i}`);
    assert.strictEqual((await gitRevisions(root, 2)).commits.length, 2);
    /* A caller asking for a hundred thousand is asking for a response nobody
       scrolls and a spawn nobody waits for. */
    assert.ok((await gitRevisions(root, 1_000_000)).commits.length <= 100);
    assert.ok((await gitRevisions(root, -5)).commits.length >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
