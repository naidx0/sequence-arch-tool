import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { gitStatus, gitDiff, gitCommit } from '../server/gitWorkspace.js';

/**
 * Wave 3a locking tests for the Index Changes git APIs. Builds a REAL temp git
 * repo (git is present in this sandbox) and exercises the module + the HTTP
 * routes end-to-end against the live server. Asserts the jail (path escape /
 * `.git/` refusal), the porcelain parse, the diff shape and the commit SHA.
 */

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-git-ws-')));
}

function run(cwd: string, args: string[]): { stdout: string; code: number | null } {
  const r = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', code: r.status };
}

function freshGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-git-repo-'));
  const repo = fs.realpathSync(dir);
  run(repo, ['init', '-q']);
  run(repo, ['config', 'user.email', 'agent@example.com']);
  run(repo, ['config', 'user.name', 'Agent']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# hello\n');
  // A minimal package.json so createRepoServer's scanner accepts the repo
  // (manifest-less repos are a calm 422 — we need a scannable repo to exercise
  // the repo-scoped HTTP routes).
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'git-ws-fixture', version: '0.0.0' }, null, 2) + '\n'
  );
  run(repo, ['add', 'README.md', 'package.json']);
  run(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

async function startRepoServer(
  repoRoot: string,
  userConfigDir: string
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ============================================================ gitStatus ===== */

test('gitStatus: clean tree → empty files + the current branch', async () => {
  const repo = freshGitRepo();
  try {
    const r = await gitStatus(repo);
    assert.strictEqual(r.files.length, 0);
    assert.ok(r.branch === 'main' || r.branch === 'master', `branch was ${r.branch}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitStatus: modified + untracked + deleted files are parsed and classified', async () => {
  const repo = freshGitRepo();
  try {
    fs.writeFileSync(path.join(repo, 'README.md'), '# hello changed\n');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'fresh\n');
    fs.writeFileSync(path.join(repo, 'gone.txt'), 'x\n');
    run(repo, ['add', 'gone.txt']);
    run(repo, ['commit', '-q', '-m', 'add gone']);
    fs.rmSync(path.join(repo, 'gone.txt'));
    const r = await gitStatus(repo);
    const byPath = new Map(r.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('README.md'), 'modified');
    assert.strictEqual(byPath.get('new.txt'), 'untracked');
    assert.strictEqual(byPath.get('gone.txt'), 'deleted');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/* ============================================================== gitDiff ===== */

test('gitDiff: returns a unified diff for a modified file vs HEAD', async () => {
  const repo = freshGitRepo();
  try {
    fs.writeFileSync(path.join(repo, 'README.md'), '# hello changed\n');
    const d = await gitDiff(repo, 'README.md');
    assert.strictEqual(d.path, 'README.md');
    assert.ok(d.diff.includes('diff --git'), `expected a diff header, got: ${d.diff}`);
    assert.ok(d.diff.includes('-# hello'), 'diff shows the removed line');
    assert.ok(d.diff.includes('+# hello changed'), 'diff shows the added line');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitDiff: empty diff for an unchanged file is honest, not an error', async () => {
  const repo = freshGitRepo();
  try {
    const d = await gitDiff(repo, 'README.md');
    assert.strictEqual(d.diff, '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitDiff: refuses a path that escapes the repo root (jail)', async () => {
  const repo = freshGitRepo();
  try {
    await assert.rejects(() => gitDiff(repo, '../etc/passwd'), (e: Error) => {
      assert.match(e.message, /escapes the repo root/);
      return true;
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitDiff: refuses an absolute path (jail)', async () => {
  const repo = freshGitRepo();
  try {
    await assert.rejects(() => gitDiff(repo, '/etc/passwd'), (e: Error) => {
      assert.match(e.message, /escapes the repo root/);
      return true;
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitDiff: refuses a .git/ internal path (reserved)', async () => {
  const repo = freshGitRepo();
  try {
    await assert.rejects(() => gitDiff(repo, '.git/config'), (e: Error) => {
      assert.match(e.message, /reserved/);
      return true;
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/* ============================================================= gitCommit ==== */

test('gitCommit: stages all (no paths) and returns the new HEAD SHA', async () => {
  const repo = freshGitRepo();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(repo, 'README.md'), '# hello changed\n');
    const r = await gitCommit(repo, 'add a and update readme');
    assert.strictEqual(r.ok, true);
    assert.ok(r.commit && /^[0-9a-f]{40}$/.test(r.commit), `expected a 40-char SHA, got ${r.commit}`);
    const log = run(repo, ['log', '--format=%s', '-1']);
    assert.strictEqual(log.stdout.trim(), 'add a and update readme');
    const st = await gitStatus(repo);
    assert.strictEqual(st.files.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitCommit: stages only the named paths (jail-checked), leaves others dirty', async () => {
  const repo = freshGitRepo();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    const r = await gitCommit(repo, 'only a', ['a.txt']);
    assert.strictEqual(r.ok, true);
    assert.ok(r.commit);
    const st = await gitStatus(repo);
    const byPath = new Map(st.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('b.txt'), 'untracked');
    assert.ok(!byPath.has('a.txt'), 'a.txt was committed');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitCommit: a single escaping path aborts the whole request (nothing staged)', async () => {
  const repo = freshGitRepo();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    const r = await gitCommit(repo, 'should not land', ['a.txt', '../escape.txt']);
    assert.strictEqual(r.ok, false);
    assert.match(r.error ?? '', /escapes the repo root/);
    const st = await gitStatus(repo);
    const byPath = new Map(st.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('a.txt'), 'untracked');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitCommit: refuses to stage a .git/ internal path', async () => {
  const repo = freshGitRepo();
  try {
    const r = await gitCommit(repo, 'nope', ['.git/config']);
    assert.strictEqual(r.ok, false);
    assert.match(r.error ?? '', /git-internal/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitCommit: rejects an empty message and an over-long message', async () => {
  const repo = freshGitRepo();
  try {
    const empty = await gitCommit(repo, '   ');
    assert.strictEqual(empty.ok, false);
    assert.match(empty.error ?? '', /non-empty/);
    const long = await gitCommit(repo, 'x'.repeat(2001));
    assert.strictEqual(long.ok, false);
    assert.match(long.error ?? '', /exceeds/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitCommit: nothing to commit → honest ok:false, no SHA', async () => {
  const repo = freshGitRepo();
  try {
    const r = await gitCommit(repo, 'nothing here');
    assert.strictEqual(r.ok, false);
    assert.ok(!r.commit);
    assert.match(r.error ?? '', /nothing to commit/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/* ============================================================ HTTP routes === */

test('HTTP: GET /api/git/status → 200 with branch + files', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
    const res = await fetch(`${base}/api/git/status`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { branch: string; files: { path: string; status: string }[] };
    assert.ok(body.branch === 'main' || body.branch === 'master');
    const byPath = new Map(body.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('README.md'), 'modified');
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: GET /api/git/diff?path=README.md → 200 with unified diff', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
    const res = await fetch(`${base}/api/git/diff?path=README.md`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { path: string; diff: string };
    assert.strictEqual(body.path, 'README.md');
    assert.ok(body.diff.includes('diff --git'));
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: GET /api/git/diff with escaping path → 403', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    const res = await fetch(`${base}/api/git/diff?path=../etc/passwd`);
    assert.strictEqual(res.status, 403);
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: GET /api/git/diff with no path → 400', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    const res = await fetch(`${base}/api/git/diff`);
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: POST /api/git/commit stages all and returns the SHA', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    const res = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'add a' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; commit?: string };
    assert.strictEqual(body.ok, true);
    assert.ok(body.commit && /^[0-9a-f]{40}$/.test(body.commit));
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: POST /api/git/commit with named paths stages only those', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    const res = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'only a', paths: ['a.txt'] }),
    });
    assert.strictEqual(res.status, 200);
    const st = await fetch(`${base}/api/git/status`);
    const stBody = (await st.json()) as { files: { path: string; status: string }[] };
    const byPath = new Map(stBody.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('b.txt'), 'untracked');
    assert.ok(!byPath.has('a.txt'));
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: POST /api/git/commit with an escaping path → 400 and nothing staged', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    const res = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'nope', paths: ['a.txt', '../escape.txt'] }),
    });
    assert.strictEqual(res.status, 400);
    const st = await fetch(`${base}/api/git/status`);
    const stBody = (await st.json()) as { files: { path: string; status: string }[] };
    const byPath = new Map(stBody.files.map((f) => [f.path, f.status]));
    assert.strictEqual(byPath.get('a.txt'), 'untracked', 'a.txt was not staged');
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: POST /api/git/commit with a non-JSON body → 415', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    const res = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'nope',
    });
    assert.strictEqual(res.status, 415);
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: POST /api/git/commit with no message → 400', async () => {
  const repo = freshGitRepo();
  const userDir = tempUserDir();
  const { base, close } = await startRepoServer(repo, userDir);
  try {
    const res = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('HTTP: git APIs 409 when no repo is attached', async () => {
  const userDir = tempUserDir();
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const s = await fetch(`${base}/api/git/status`);
    assert.strictEqual(s.status, 409);
    const d = await fetch(`${base}/api/git/diff?path=README.md`);
    assert.strictEqual(d.status, 409);
    const c = await fetch(`${base}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x' }),
    });
    assert.strictEqual(c.status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
