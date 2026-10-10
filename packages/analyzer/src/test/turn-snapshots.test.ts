import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listTrackedFiles } from '../server/checkpointStore.js';
import { revertHunk, splitHunks } from '../server/gitWorkspace.js';
import {
  beginTurn,
  diffPaths,
  noteTurnDiff,
  readSession,
  revertToTurn,
  shadowGitDir,
  trackTurnWrites,
  turnDiff,
  turnFiles,
  undoRevert,
} from '../server/snapshot.js';

/* S3 — undo anything the agent did. A temp copy of the shopfront fixture is a
   real git repository with one commit (the "user's" repository). Two codex
   turns are replayed into it from the S0 recordings in
   packages/acp/src/test/fixtures/replay/codex/, in the order the frames came:
   turn/started → item/started (fileChange: the write is announced) → the write
   lands → turn/diff/updated. Then: revert to a turn, revert further, undo the
   revert, revert one hunk, asserting files byte for byte. The negative control
   is the user's own index, HEAD, refs and stash, which must not move. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.resolve(HERE, '..', '..', '..');
const REPLAY = path.join(PACKAGES, 'acp', 'src', 'test', 'fixtures', 'replay', 'codex');
const SHOPFRONT = path.join(PACKAGES, 'analyzer', 'test', 'fixtures', 'shopfront');

/** git's own blob id of a file's raw bytes: what codex recorded in its diff's `index` line. */
function blobId(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file);
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

function run(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

interface Frame {
  msg?: { method?: string; params?: any };
}

function frames(name: string, cwd: string): Frame[] {
  const text = fs.readFileSync(path.join(REPLAY, name), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Frame)
    .map((f) => JSON.parse(JSON.stringify(f).split('<CWD>').join(cwd.replace(/\\/g, '\\\\'))) as Frame)
    /* The recordings were made on Windows (`<CWD>\\hello.txt`); on POSIX that substitutes to one file name with a
       backslash in it, beside the repository. Spell the paths with this platform's separator; a no-op on Windows. */
    .map((f) => (path.sep === '\\' ? f : (JSON.parse(JSON.stringify(f), (_k, v) => (typeof v === 'string' && v.startsWith(cwd + '\\') ? cwd + v.slice(cwd.length).replace(/\\/g, '/') : v)) as Frame)));
}

/** The recordings were made against a CRLF checkout (Windows autocrlf): codex's diff names the pre-image blob
    88ae924, which is main.py with CRLF endings. A Linux checkout has LF (blob b37cf10), so the patch would not
    apply. Pin the bytes the recording started from, on every platform. */
function pinRecordedLineEndings(root: string): void {
  const main = path.join(root, 'orders', 'app', 'main.py');
  fs.writeFileSync(main, Buffer.from(fs.readFileSync(main, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8'));
}

/** The user's repository: a copy of shopfront with one commit. */
function userRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3-'));
  fs.cpSync(SHOPFRONT, root, { recursive: true });
  pinRecordedLineEndings(root);
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['config', 'user.email', 'test@example.com']);
  run(root, ['config', 'user.name', 'Test']);
  run(root, ['config', 'commit.gpgsign', 'false']);
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '-m', 'user history']);
  return root;
}

/** What must never move in the user's repository. */
function userState(root: string) {
  return {
    head: run(root, ['rev-parse', 'HEAD']).trim(),
    index: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '.git', 'index'))).digest('hex'),
    refs: run(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    stash: run(root, ['stash', 'list']),
    staged: run(root, ['diff', '--cached', '--name-only']),
  };
}

/** The write lands: codex's own patch, applied outside the user's git directory. */
function land(root: string, patch: string): void {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3-apply-'));
  run(scratch, ['init', '-q']);
  run(root, ['--git-dir', path.join(scratch, '.git'), '--work-tree', root, '-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', '-'], patch);
  fs.rmSync(scratch, { recursive: true, force: true });
}

/** Replay one recorded codex session's turn into `root` through the snapshot API. */
async function replayTurn(root: string, sid: string, fixture: string, opts: { approveDeclined?: boolean } = {}): Promise<string> {
  let turnId = '';
  let lastDiff = '';
  const all = frames(fixture, root);
  /* With a turn diff, the write lands as that diff (after the loop); without
     one, each announced change is an added file whose diff is its content. */
  const hasTurnDiff = all.some((f) => f.msg?.method === 'turn/diff/updated');
  for (const f of all) {
    const m = f.msg?.method;
    const p = f.msg?.params;
    if (m === 'turn/started') {
      turnId = p.turn.id;
      await beginTurn(root, sid, { turnId, label: fixture });
    } else if (m === 'item/started' && p.item.type === 'fileChange') {
      /* Announced before the write lands: track first. */
      await trackTurnWrites(root, sid, p.item.changes.map((c: { path: string }) => c.path), { turnId });
    } else if (m === 'item/completed' && p.item.type === 'fileChange') {
      if (p.item.status === 'declined' && !opts.approveDeclined) continue;
      if (!hasTurnDiff) {
        /* The declined proposal, taken here as approved so the session has a
           second turn. */
        for (const c of p.item.changes) {
          assert.equal(c.kind.type, 'add');
          fs.writeFileSync(c.path, c.diff);
        }
      }
    } else if (m === 'turn/diff/updated') {
      lastDiff = p.diff;
    }
  }
  if (lastDiff) {
    land(root, lastDiff);
    await noteTurnDiff(root, sid, lastDiff, { turnId });
  }
  return turnId;
}

test('turn snapshots: revert to a turn, revert further, undo, revert one hunk — byte for byte, user git untouched', async () => {
  const root = userRepo();
  try {
    const sid = 'session-s3-replay';
    const main = path.join(root, 'orders', 'app', 'main.py');
    const notes = path.join(root, 'NOTES.md');
    const hello = path.join(root, 'hello.txt');
    const compose = path.join(root, 'docker-compose.yml');
    const before = userState(root);

    /* The recording started from these exact bytes: codex's diff names the
       pre-image blob of main.py. */
    assert.equal(blobId(main), '88ae924ccd784de511f2253b6d79757413e44aa8');
    const originalMain = fs.readFileSync(main);

    /* Turn 1: edit-with-plan (adds ping() to main.py, creates NOTES.md). */
    await replayTurn(root, sid, 'edit-with-plan.jsonl');
    assert.equal(blobId(main), 'e6c5f8d34ab1cca2a308a90097aedbbddd8e874a', 'main.py is codex\'s recorded post-image');
    assert.equal(blobId(notes), 'cd364ed3559b1f4227c7e6c7ff35fef642ea5715', 'NOTES.md is codex\'s recorded post-image');
    const turn1Main = fs.readFileSync(main);
    const turn1Notes = fs.readFileSync(notes);

    /* The user edits a file by hand between turns. No revert may touch it. */
    fs.appendFileSync(compose, '# a note the user typed\n');
    const userCompose = fs.readFileSync(compose);

    /* Turn 2: file-approval-denied's proposal (hello.txt), taken as approved. */
    await replayTurn(root, sid, 'file-approval-denied.jsonl', { approveDeclined: true });
    assert.equal(fs.readFileSync(hello, 'utf8'), 'hello\n');

    const s = readSession(root, sid);
    assert.deepEqual(
      s.turns.map((t) => [t.seq, t.files.sort()]),
      [
        [1, ['NOTES.md', 'orders/app/main.py']],
        [2, ['hello.txt']],
      ],
    );
    /* The Rewind panel's store saw the agent's writes, with their baselines. */
    assert.deepEqual(listTrackedFiles(root, sid).map((t) => t.path).sort(), ['NOTES.md', 'hello.txt', 'orders/app/main.py']);
    assert.equal(listTrackedFiles(root, sid).find((t) => t.path === 'NOTES.md')!.baseline.blob, undefined, 'NOTES.md did not exist before the session');

    /* What turn 1 changed, from the snapshot. */
    assert.deepEqual(await turnFiles(root, sid, 1), [
      { path: 'NOTES.md', status: 'added' },
      { path: 'hello.txt', status: 'added' },
      { path: 'orders/app/main.py', status: 'modified' },
    ]);

    /* Revert to turn 2: only hello.txt goes. */
    await revertToTurn(root, sid, 2);
    assert.equal(fs.existsSync(hello), false);
    assert.ok(fs.readFileSync(main).equals(turn1Main));
    assert.ok(fs.readFileSync(notes).equals(turn1Notes));
    assert.ok(fs.readFileSync(compose).equals(userCompose));

    /* Revert further, to turn 1: every agent write goes. */
    await revertToTurn(root, sid, 1);
    assert.ok(fs.readFileSync(main).equals(originalMain), 'main.py is the original bytes (CRLF kept)');
    assert.equal(blobId(main), '88ae924ccd784de511f2253b6d79757413e44aa8');
    assert.equal(fs.existsSync(notes), false);
    assert.equal(fs.existsSync(hello), false);
    assert.ok(fs.readFileSync(compose).equals(userCompose), "the user's own edit stays");

    /* Undo the revert: back to after turn 2, every byte. */
    await undoRevert(root, sid);
    assert.equal(blobId(main), 'e6c5f8d34ab1cca2a308a90097aedbbddd8e874a');
    assert.ok(fs.readFileSync(notes).equals(turn1Notes));
    assert.equal(fs.readFileSync(hello, 'utf8'), 'hello\n');
    assert.ok(fs.readFileSync(compose).equals(userCompose));
    await assert.rejects(undoRevert(root, sid), /no revert to undo/);

    /* Revert one hunk of main.py, from the diff "before turn 1". */
    const diff = await turnDiff(root, sid, 1, 'orders/app/main.py');
    const { hunks } = splitHunks(diff);
    assert.equal(hunks.length, 1);
    const stale = await revertHunk(root, diff, 0, '@@ -1,1 +1,1 @@');
    assert.equal(stale.ok, false, 'a header the client did not see is refused');
    assert.ok(fs.readFileSync(main).equals(turn1Main), 'and nothing moved');
    const r = await revertHunk(root, diff, 0, hunks[0]!.header);
    assert.equal(r.ok, true, r.error);
    assert.ok(fs.readFileSync(main).equals(originalMain), 'the hunk is gone, byte for byte');
    assert.ok(fs.readFileSync(notes).equals(turn1Notes), 'another file is untouched');
    assert.equal(fs.readFileSync(hello, 'utf8'), 'hello\n');

    /* A new turn after a revert drops the reverted turns. */
    await revertToTurn(root, sid, 2);
    await beginTurn(root, sid, { label: 'next prompt' });
    assert.deepEqual(readSession(root, sid).turns.map((t) => t.seq), [1, 2]);
    assert.equal(readSession(root, sid).revert, undefined);

    /* NEGATIVE CONTROL: the user's index, HEAD, refs and stash never moved,
       and nothing was staged. */
    assert.deepEqual(userState(root), before);
    /* The shadow repository holds trees only: no commit, no ref. */
    assert.equal(run(root, ['--git-dir', shadowGitDir(root), 'for-each-ref']), '');
    assert.throws(() => run(root, ['--git-dir', shadowGitDir(root), 'rev-parse', '--verify', '-q', 'HEAD']));
    /* The control can fail: staging one file moves the index it watches. */
    run(root, ['add', 'docker-compose.yml']);
    assert.notDeepEqual(userState(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diffPaths reads both sides of every file in a turn diff', () => {
  const d = 'diff --git a/NOTES.md b/NOTES.md\r\nnew file mode 100644\n--- /dev/null\n+++ b/NOTES.md\ndiff --git a/x/old.ts b/x/new.ts\n';
  assert.deepEqual(diffPaths(d).sort(), ['NOTES.md', 'x/new.ts', 'x/old.ts']);
});

test('paths outside the repository, in .git or in .sequence are never tracked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3-jail-'));
  try {
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    const got = await trackTurnWrites(root, 'session-jail', [
      path.join(root, 'a.txt'),
      path.join(os.tmpdir(), 'elsewhere.txt'),
      '../up.txt',
      '.git/config',
      '.sequence/snapshots/x',
    ]);
    assert.deepEqual(got, ['a.txt']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
