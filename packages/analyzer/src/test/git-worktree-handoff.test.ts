import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import {
  gitCreateBranch,
  gitHandoffWorktree,
  gitListWorktrees,
  gitRemoveWorktree,
  isValidBranchName,
  worktreesRootFor,
} from '../server/gitWorkspace.js';

/**
 * P12 — WORKTREE HANDOFF. The lock the item names, verbatim: "create a branch
 * through the API, assert `git branch --list` really shows it, then clean up."
 *
 * EVERY assertion here reads git's OWN answer, never our return value. A
 * `gitCreateBranch` that returned `{ok:true, branch:'x'}` and spawned nothing
 * would satisfy a test that asserted on the result object; it cannot satisfy
 * one that asks `git branch --list` afterwards. That is the whole point — the
 * defect class this repo keeps paying for is a surface asserting something the
 * engine never supplied.
 *
 * Every temp repo and every worktree created here is removed in the test's own
 * cleanup, so a run leaves no directory behind.
 */

function git(cwd: string, args: string[]): { stdout: string; stderr: string; code: number | null } {
  const r = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status };
}

/** `git branch --list <name>` — git's own answer, trimmed of its `* ` marker. */
function branchList(repo: string, name?: string): string[] {
  const r = git(repo, name ? ['branch', '--list', name] : ['branch', '--list']);
  return r.stdout
    .split('\n')
    .map((l) => l.replace(/^[*+]?\s*/, '').trim())
    .filter((l) => l !== '');
}

const tempRoots: string[] = [];

function freshGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-wt-repo-'));
  const repo = fs.realpathSync(dir);
  tempRoots.push(path.dirname(repo));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'agent@example.com']);
  git(repo, ['config', 'user.name', 'Agent']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# hello\n');
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'wt-fixture', version: '0.0.0' }, null, 2) + '\n',
  );
  git(repo, ['add', 'README.md', 'package.json']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

/** Remove a repo AND every worktree this test created beside it. */
function cleanupRepo(repo: string): void {
  const root = worktreesRootFor(repo);
  for (const dir of [root, repo]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort — a temp dir left behind is not a test failure */
    }
  }
}

async function startRepoServer(
  repoRoot: string,
): Promise<{ base: string; close: () => Promise<void>; userDir: string }> {
  const userDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-wt-user-')));
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    userDir,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          try {
            fs.rmSync(userDir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          resolve();
        }),
      ),
  };
}

/* ==================== the named lock: branch through the API ============== */

test('POST /api/git/branch creates a branch that `git branch --list` really shows', async () => {
  const repo = freshGitRepo();
  const srv = await startRepoServer(repo);
  try {
    // Before: git itself says the branch does not exist.
    assert.deepEqual(branchList(repo, 'feature/handoff'), []);

    const res = await fetch(`${srv.base}/api/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'feature/handoff' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; branch: string; head?: string };
    assert.equal(body.ok, true);
    assert.equal(body.branch, 'feature/handoff');

    // THE LOCK. git's own answer, not ours.
    assert.deepEqual(branchList(repo, 'feature/handoff'), ['feature/handoff']);

    // And the head it reported is a real commit git can resolve.
    assert.ok(body.head, 'response must carry the commit the branch points at');
    const shown = git(repo, ['rev-parse', 'feature/handoff']).stdout.trim();
    assert.equal(shown, body.head);
  } finally {
    await srv.close();
    cleanupRepo(repo);
  }
});

test('POST /api/git/branch refuses a duplicate rather than silently reporting success', async () => {
  const repo = freshGitRepo();
  const srv = await startRepoServer(repo);
  try {
    const first = await fetch(`${srv.base}/api/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dup' }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${srv.base}/api/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dup' }),
    });
    assert.equal(second.status, 409);
    const body = (await second.json()) as { error: string };
    assert.match(body.error, /already exists/i);
    // git still shows exactly one.
    assert.deepEqual(branchList(repo, 'dup'), ['dup']);
  } finally {
    await srv.close();
    cleanupRepo(repo);
  }
});

test('POST /api/git/branch refuses a hostile ref name BEFORE git is spawned', async () => {
  const repo = freshGitRepo();
  const srv = await startRepoServer(repo);
  try {
    for (const name of ['--upload-pack=touch pwned', '../escape', 'has space', '', 'a..b', 'x.lock']) {
      const res = await fetch(`${srv.base}/api/git/branch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(name)}`);
    }
    // Nothing beyond the initial branch was created.
    assert.deepEqual(branchList(repo), ['main']);
  } finally {
    await srv.close();
    cleanupRepo(repo);
  }
});

/* ==================== the handoff: a real second checkout ================== */

test('POST /api/git/worktree hands the branch off to a real second working tree', async () => {
  const repo = freshGitRepo();
  const srv = await startRepoServer(repo);
  try {
    const res = await fetch(`${srv.base}/api/git/worktree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'handoff/one' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      branch: string;
      path: string;
      createdBranch: boolean;
    };
    assert.equal(body.ok, true);
    assert.equal(body.branch, 'handoff/one');
    assert.equal(body.createdBranch, true);

    // THE LOCK, part 1 — git knows the branch.
    assert.deepEqual(branchList(repo, 'handoff/one'), ['handoff/one']);

    // THE LOCK, part 2 — a REAL directory on disk with the repo's files in it.
    assert.ok(fs.existsSync(body.path), `worktree dir must exist on disk: ${body.path}`);
    assert.equal(
      fs.readFileSync(path.join(body.path, 'README.md'), 'utf8').replace(/\r\n/g, '\n'),
      '# hello\n',
    );
    // A linked worktree's `.git` is a FILE pointing at the main repo, not a dir.
    assert.ok(fs.statSync(path.join(body.path, '.git')).isFile());

    // THE LOCK, part 3 — git itself lists it, and says it is on that branch.
    const listed = await gitListWorktrees(repo);
    const entry = listed.find((w) => fs.realpathSync(w.path) === fs.realpathSync(body.path));
    assert.ok(entry, 'git worktree list must include the new tree');
    assert.equal(entry.branch, 'handoff/one');

    // And the checked-out HEAD in the worktree really is that branch.
    assert.equal(git(body.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(), 'handoff/one');

    // Clean up through the API, then assert git agrees it is gone.
    const del = await fetch(
      `${srv.base}/api/git/worktree?path=${encodeURIComponent(body.path)}`,
      { method: 'DELETE' },
    );
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(body.path), false, 'removal must delete the directory');
    const after = await gitListWorktrees(repo);
    assert.equal(
      after.some((w) => w.path.replace(/\\/g, '/') === body.path.replace(/\\/g, '/')),
      false,
    );
  } finally {
    await srv.close();
    cleanupRepo(repo);
  }
});

test('DELETE /api/git/worktree refuses a path outside the worktrees root', async () => {
  const repo = freshGitRepo();
  const srv = await startRepoServer(repo);
  try {
    const outside = fs.realpathSync(os.tmpdir());
    const res = await fetch(
      `${srv.base}/api/git/worktree?path=${encodeURIComponent(outside)}`,
      { method: 'DELETE' },
    );
    assert.equal(res.status, 403);
    // And the directory is still there — nothing was removed.
    assert.equal(fs.existsSync(outside), true);
  } finally {
    await srv.close();
    cleanupRepo(repo);
  }
});

/* ==================== module-level behaviour ============================== */

test('gitCreateBranch --from starts the branch at the named commit, per git', async () => {
  const repo = freshGitRepo();
  try {
    const first = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
    fs.writeFileSync(path.join(repo, 'second.txt'), 'two\n');
    git(repo, ['add', 'second.txt']);
    git(repo, ['commit', '-q', '-m', 'second']);
    const second = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
    assert.notEqual(first, second);

    const r = await gitCreateBranch(repo, 'from-first', { from: first });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(branchList(repo, 'from-first'), ['from-first']);
    assert.equal(git(repo, ['rev-parse', 'from-first']).stdout.trim(), first);
  } finally {
    cleanupRepo(repo);
  }
});

test('gitHandoffWorktree reuses an existing branch instead of failing', async () => {
  const repo = freshGitRepo();
  try {
    const made = await gitCreateBranch(repo, 'preexisting');
    assert.equal(made.ok, true, made.error);

    const handoff = await gitHandoffWorktree(repo, 'preexisting');
    assert.equal(handoff.ok, true, handoff.error);
    assert.equal(handoff.createdBranch, false, 'the branch was already there');
    assert.ok(fs.existsSync(path.join(handoff.path!, 'README.md')));

    const removed = await gitRemoveWorktree(repo, handoff.path!);
    assert.equal(removed.ok, true, removed.error);
    assert.equal(fs.existsSync(handoff.path!), false);
  } finally {
    cleanupRepo(repo);
  }
});

test('isValidBranchName rejects what git itself would reject', () => {
  for (const bad of [
    '',
    ' ',
    '-leading-dash',
    'has space',
    'a..b',
    'end.lock',
    'trailing/',
    '/leading',
    'a//b',
    'tilde~1',
    'caret^1',
    'colon:x',
    'question?',
    'star*',
    'bracket[1]',
    'back\\slash',
    'at@{x}',
    '.hidden',
    'ends.',
    'x'.repeat(256),
  ]) {
    assert.equal(isValidBranchName(bad), false, `expected reject: ${JSON.stringify(bad)}`);
  }
  for (const good of ['main', 'feature/handoff', 'fix-123', 'a/b/c', 'v1.2.3', 'UPPER_case']) {
    assert.equal(isValidBranchName(good), true, `expected accept: ${JSON.stringify(good)}`);
  }
});
