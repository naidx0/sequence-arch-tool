import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  NO_UNDO_POINT,
  beginTurn,
  readSession,
  revertToTurn,
  shadowGitDir,
  shadowKey,
  skippedFromStderr,
  trackTurnWrites,
  turnFiles,
  undoRevert,
  warmShadow,
  writeTree,
} from '../server/snapshot.js';

/* ══════════════════════════════════════════════════════════════════════════
   S3 UNDER LOAD — the shadow index, its lock, and files another process holds.
   Every repo is a fresh temp dir: no two tests share a shadow.
   ══════════════════════════════════════════════════════════════════════════ */

delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;

const temps: string[] = [];
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A work tree with `n` small files (enough that one `git add` takes a while). */
function tree(n = 1): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-snaplock-')));
  temps.push(dir);
  for (let i = 0; i < n; i++) {
    const sub = path.join(dir, `d${i % 40}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `f${i}.txt`), `file ${i}\n`.repeat(20));
  }
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a original\n');
  return dir;
}

const lockOf = (root: string) => path.join(shadowGitDir(root), 'index.lock');

test('overlapping snapshot calls on one repo all succeed and leave no index.lock (control: the same overlap without the queue collides)', async () => {
  const root = tree(2500);
  await warmShadow(root);
  /* Two spellings of one root (Windows: forward slashes and an upper-case
     drive) are one shadow, so one queue. */
  const other = process.platform === 'win32' ? root.replace(/\\/g, '/').replace(/^[a-z]:/, (d) => d.toUpperCase()) : root;
  assert.equal(shadowKey(other), shadowKey(root));
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(root, `d${i}`, `new${i}.txt`), `${i}\n`);
  const calls = [
    beginTurn(root, 'session-a'),
    beginTurn(other, 'session-b'),
    warmShadow(root),
    beginTurn(other, 'session-c'),
    beginTurn(root, 'session-d'),
    warmShadow(other),
  ];
  const results = await Promise.allSettled(calls);
  assert.deepEqual(results.map((r) => r.status), results.map(() => 'fulfilled'), JSON.stringify(results.filter((r) => r.status === 'rejected')));
  for (const sid of ['session-a', 'session-b', 'session-c', 'session-d']) {
    const t = readSession(root, sid).turns[0]!;
    assert.match(t.tree, /^[0-9a-f]{40}$/, `${sid} has an undo point`);
    assert.equal(t.noUndo, undefined);
  }
  assert.equal(fs.existsSync(lockOf(root)), false, 'no index.lock remains');

  /* CONTROL: the same shadow, the same overlap, as raw git with no queue and
     no retry. git refuses the second writer on the lock: the queue is what
     the passing case above depends on. */
  for (let i = 0; i < 40; i++) fs.appendFileSync(path.join(root, `d${i}`, `f${i}.txt`), 'touched\n');
  const raw = await Promise.all(
    Array.from({ length: 8 }, () =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const c = childProcess.spawn('git', ['--git-dir', shadowGitDir(root), '--work-tree', root, 'add', '--all', '--', '.'], { cwd: root, windowsHide: true });
        let stderr = '';
        c.stderr.on('data', (d) => (stderr += d));
        c.on('close', (code) => resolve({ code, stderr }));
      }),
    ),
  );
  assert.ok(raw.some((r) => r.code !== 0 && /index\.lock/.test(r.stderr)), 'without the queue, writers collide on index.lock');
});

test('a lock that clears after the first try: the call retries and succeeds, and no lock is left', async () => {
  const root = tree();
  await warmShadow(root);
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  fs.writeFileSync(lockOf(root), '');
  /* Another process's git, finishing a moment later. */
  setTimeout(() => fs.rmSync(lockOf(root), { force: true }), 30);
  const t = await writeTree(root);
  assert.match(t, /^[0-9a-f]{40}$/);
  assert.equal(fs.existsSync(lockOf(root)), false);
});

test('a stale lock (older than any git this process lets live) is removed and the call goes on', async () => {
  const root = tree();
  await warmShadow(root);
  fs.writeFileSync(lockOf(root), '');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lockOf(root), old, old);
  const t = await writeTree(root);
  assert.match(t, /^[0-9a-f]{40}$/);
  assert.equal(fs.existsSync(lockOf(root)), false);
});

test("stale-lock cleanup touches only the SHADOW index.lock, never the user's own .git/index.lock", async () => {
  const root = tree();
  /* The user's own repository, with its own stale lock (a crashed git of theirs:
     theirs to clear, never ours). */
  const init = childProcess.spawnSync('git', ['init', '-q', root], { windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const userLock = path.join(root, '.git', 'index.lock');
  fs.writeFileSync(userLock, 'the user\'s lock\n');
  await warmShadow(root);
  fs.writeFileSync(lockOf(root), '');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(userLock, old, old);
  fs.utimesSync(lockOf(root), old, old);
  const userMtime = fs.statSync(userLock).mtimeMs;
  assert.notEqual(path.resolve(userLock), path.resolve(lockOf(root)), 'two different locks');

  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  const t = await beginTurn(root, 'session-locks');
  assert.match(t.tree, /^[0-9a-f]{40}$/, 'the snapshot went through');

  /* Positive control: the cleanup ran, on the shadow. */
  assert.equal(fs.existsSync(lockOf(root)), false, 'the stale shadow lock is removed');
  /* And it left the user's alone: same file, same bytes, same mtime. */
  assert.equal(fs.existsSync(userLock), true, "the user's .git/index.lock is untouched");
  assert.equal(fs.readFileSync(userLock, 'utf8'), "the user's lock\n");
  assert.equal(fs.statSync(userLock).mtimeMs, userMtime);
});

/** Hold a file so nothing else can read it (Windows: share mode None), until released. */
async function holdFile(file: string): Promise<{ release: () => Promise<void> } | null> {
  if (process.platform !== 'win32') {
    if (process.getuid?.() === 0) return null; /* root reads anything */
    fs.chmodSync(file, 0o000);
    return { release: async () => fs.chmodSync(file, 0o644) };
  }
  const ps = childProcess.spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','ReadWrite','None'); [Console]::Out.WriteLine('held'); [Console]::In.ReadLine() | Out-Null; $f.Close()`],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    let out = '';
    ps.stdout.on('data', (d) => {
      out += d;
      if (out.includes('held')) resolve();
    });
    ps.on('exit', (code) => reject(new Error(`powershell exited ${code} before holding the file`)));
  });
  return {
    release: () =>
      new Promise<void>((resolve) => {
        ps.removeAllListeners('exit');
        ps.on('exit', () => resolve());
        ps.stdin.end('\n');
      }),
  };
}

test('a file another process holds open: the undo point is saved PARTIAL, names it, and a revert leaves it alone', async () => {
  const root = tree();
  const locked = path.join(root, 'locked.txt');
  fs.writeFileSync(locked, 'locked first\n');
  await warmShadow(root);
  /* Changed since the warm index, so git must open it to snapshot it (an
     unchanged file is taken from the index by its stat data, unread). */
  fs.writeFileSync(locked, 'locked original, longer now\n');
  const held = await holdFile(locked);
  if (!held) return; /* running as root: nothing can be made unreadable */
  let t1;
  try {
    t1 = await beginTurn(root, 'session-held');
  } finally {
    await held.release();
  }
  assert.match(t1.tree, /^[0-9a-f]{40}$/, 'the point is saved');
  assert.deepEqual(t1.skipped, ['locked.txt'], 'and it names the file it could not read');
  assert.equal(t1.noUndo, undefined);

  /* The agent writes both files. */
  await trackTurnWrites(root, 'session-held', ['a.txt', 'locked.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a by the agent\n');
  fs.writeFileSync(locked, 'locked by the agent\n');

  const r = await revertToTurn(root, 'session-held', t1.seq);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'a original\n', 'what the point holds goes back');
  assert.equal(fs.readFileSync(locked, 'utf8'), 'locked by the agent\n', 'the skipped file is left alone');
  assert.deepEqual(r.files, ['a.txt']);
  assert.deepEqual(r.skipped, ['locked.txt']);
  await undoRevert(root, 'session-held');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'a by the agent\n');
});

test('when no tree can be written the turn says "No undo point for this turn", and revert refuses with that reason', async () => {
  const root = tree();
  await warmShadow(root);
  /* A corrupt shadow index: git cannot read it, so no tree can be written. */
  fs.writeFileSync(path.join(shadowGitDir(root), 'index'), 'not an index');
  const t = await beginTurn(root, 'session-none');
  assert.equal(t.tree, '');
  assert.ok(t.noUndo?.startsWith(NO_UNDO_POINT), t.noUndo);
  assert.equal(readSession(root, 'session-none').turns[0]!.noUndo, t.noUndo, 'and it is recorded on the turn');
  await trackTurnWrites(root, 'session-none', ['a.txt']);
  await assert.rejects(revertToTurn(root, 'session-none', t.seq), (e: Error & { status?: number }) => e.message.startsWith(NO_UNDO_POINT) && e.status === 409);
  await assert.rejects(turnFiles(root, 'session-none', t.seq), new RegExp(NO_UNDO_POINT));
});

test('the skipped paths are read from git\'s own stderr', () => {
  const root = path.resolve('/repo');
  const stderr = [
    'error: open("locked.txt"): Permission denied',
    "error: unable to index file 'locked.txt'",
    "error: unable to index file 'sub/x y.txt'",
    'fatal: adding files failed',
  ].join('\n');
  assert.deepEqual(skippedFromStderr(root, stderr), ['locked.txt', 'sub/x y.txt']);
  assert.deepEqual(skippedFromStderr(root, "fatal: Unable to create '/repo/.sequence/snapshots/git/index.lock': File exists."), []);
});
