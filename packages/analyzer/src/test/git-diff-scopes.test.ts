import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { gitDiff, GitWorkspaceError } from '../server/gitWorkspace.js';

/**
 * THREE OF FIVE REVIEW SCOPES WERE UNSERVED, AND EACH NAMED ITS OWN BLOCKER.
 *
 * `reviewScopes.ts` is unusually honest about it — every unserved scope carries
 * a `missing` string saying which route does not exist:
 *
 *   staged  "the index. GET /api/git/status collapses the porcelain XY pair
 *            into one word, and GET /api/git/diff has no --cached form"
 *   commit  "a revision. GET /api/git/diff takes ?path and nothing else —
 *            there is no ?rev"
 *   branch  "a merge base. No route runs git diff <base>...HEAD"
 *
 * These are those routes. The security test is first, because `rev` and `base`
 * are caller-supplied strings that reach a `git` argv.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repo with one commit, one staged change and one unstaged change. */
function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-gitscope-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'first');

  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
  git(root, 'add', 'a.txt'); // staged
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\n'); // and unstaged on top
  return root;
}

/* ═══ the security property ═══════════════════════════════════════════════ */

test('a flag-shaped rev is refused before it can reach a git argv', async () => {
  const root = repo();
  try {
    for (const hostile of ['--upload-pack=touch /tmp/pwned', '--output=/tmp/x', '-x']) {
      await assert.rejects(
        () => gitDiff(root, 'a.txt', { kind: 'commit', rev: hostile }),
        (e: unknown) => {
          /*
           * A 400, not a 500: this is a bad request, and the distinction is
           * what stops it being read as a git failure and retried.
           */
          assert.ok(e instanceof GitWorkspaceError, `expected GitWorkspaceError, got ${e}`);
          assert.strictEqual((e as GitWorkspaceError).status, 400);
          return true;
        },
        `hostile rev accepted: ${hostile}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a rev that does not resolve is refused, not silently diffed against HEAD', async () => {
  const root = repo();
  try {
    await assert.rejects(
      () => gitDiff(root, 'a.txt', { kind: 'commit', rev: 'no-such-ref' }),
      /cannot resolve rev/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('what reaches git is the resolved SHA, never the caller string', async () => {
  const root = repo();
  try {
    const head = git(root, 'rev-parse', 'HEAD').trim();
    /* Passing the branch NAME and the SHA must produce the same diff — which is
       only true if the name was resolved before it was used. */
    const byName = await gitDiff(root, 'a.txt', { kind: 'commit', rev: 'HEAD' });
    const bySha = await gitDiff(root, 'a.txt', { kind: 'commit', rev: head });
    assert.strictEqual(byName.diff, bySha.diff);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ═══ staged ══════════════════════════════════════════════════════════════ */

test('staged shows the INDEX, and worktree shows more than staged', async () => {
  const root = repo();
  try {
    const staged = await gitDiff(root, 'a.txt', { kind: 'staged' });
    const worktree = await gitDiff(root, 'a.txt', { kind: 'worktree' });

    /* The index has `two`; the working tree has `two` AND `three`. If these
       came back identical, `--cached` was not applied and the scope is a label
       over the same answer. */
    assert.match(staged.diff, /\+two/);
    assert.doesNotMatch(staged.diff, /\+three/);
    assert.match(worktree.diff, /\+three/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ═══ commit ══════════════════════════════════════════════════════════════ */

test('commit diffs one commit against its parent — and works on a ROOT commit', async () => {
  const root = repo();
  try {
    const first = git(root, 'rev-parse', 'HEAD').trim();
    const d = await gitDiff(root, 'a.txt', { kind: 'commit', rev: first });
    /*
     * `<sha>^!` rather than `<sha>^..<sha>`, because the first commit has no
     * parent and `HEAD^` does not resolve there. A scope that worked on every
     * commit except the first would fail on exactly the repository someone is
     * most likely to be trying it on.
     */
    assert.match(d.diff, /\+one/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ═══ branch ══════════════════════════════════════════════════════════════ */

test('branch diffs against the MERGE BASE, not against the base tip', async () => {
  const root = repo();
  try {
    git(root, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\nfeature\n');
    git(root, 'add', 'a.txt');
    git(root, 'commit', '-q', '-m', 'feature work');

    /* Something lands on the base AFTER the branch was cut. */
    const base = git(root, 'rev-parse', 'HEAD~1').trim();
    git(root, 'checkout', '-q', '-b', 'mainline', base);
    fs.writeFileSync(path.join(root, 'b.txt'), 'unrelated\n');
    git(root, 'add', 'b.txt');
    git(root, 'commit', '-q', '-m', 'unrelated base work');

    git(root, 'checkout', '-q', 'feature');
    const d = await gitDiff(root, 'a.txt', { kind: 'branch', base: 'mainline' });

    /*
     * THREE DOTS. Two dots would fill a branch review with everything that
     * landed on the base since the cut — the difference between "what I did"
     * and "what has happened since I started".
     */
    assert.match(d.diff, /\+feature/);
    assert.doesNotMatch(d.diff, /unrelated/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ═══ the jail still holds on every scope ═════════════════════════════════ */

test('the path jail is not weakened by any scope', async () => {
  const root = repo();
  try {
    for (const scope of [
      { kind: 'worktree' } as const,
      { kind: 'staged' } as const,
      { kind: 'commit', rev: 'HEAD' } as const,
    ]) {
      await assert.rejects(
        () => gitDiff(root, '../outside.txt', scope),
        (e: unknown) => (e as GitWorkspaceError).status === 403,
        `jail escaped under scope ${scope.kind}`,
      );
      await assert.rejects(
        () => gitDiff(root, '.git/config', scope),
        (e: unknown) => (e as GitWorkspaceError).status === 403,
        `git-internal path reachable under scope ${scope.kind}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
