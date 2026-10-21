import assert from 'node:assert';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readFixture } from '@sequence/acp/dist/replay/fixture.js';

import { addAgent } from '../server/agentsStore.js';
import {
  chatChanges,
  chatSlug,
  chatWorktreesRoot,
  clampCap,
  createChatWorktree,
  dryRunMerge,
  hasMergeTreeWriteTree,
  mergeChatWorktree,
  readWorktreeSettings,
  removeChatWorktree,
  suggestSetupCommand,
  writeWorktreeSettings,
  type ChatWorktreeRef,
} from '../server/chatWorktree.js';
import { createRepoServer } from '../server/repoServer.js';
import { beginTurn, shadowGitDir } from '../server/snapshot.js';
import { createSession, readSessionWorktree, readSessionWorktreeRecord } from '../server/sessionsStore.js';

/* ══════════════════════════════════════════════════════════════════════════
   S7 — A CHAT IN ITS OWN WORKTREE. Every repo here is a temp repo; every
   assertion reads git's own answer (status, ls-files, rev-parse, worktree
   list), never the module's return value alone. A real repo's worktrees are
   never touched.
   ══════════════════════════════════════════════════════════════════════════ */

delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const SHOPFRONT = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const FAKE_CODEX = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-app-server', 'codex.mjs');
const REPLAY_CODEX = path.join(REPO_ROOT, 'packages', 'acp', 'dist', 'replay', 'bin', 'codex.js');
const EDIT_FIXTURE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'replay', 'codex', 'edit-with-plan.jsonl');

function git(cwd: string, args: string[]): string {
  const r = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
const tryGit = (cwd: string, args: string[]): number | null => childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' }).status;

const temps: string[] = [];
function temp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(d);
  return d;
}
after(async () => {
  for (const d of temps.reverse()) {
    for (let i = 0; i < 50; i++) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
});

/** A temp repo with an identity, one commit, `.sequence/` excluded the way S3 excludes it. */
function repo(files: Record<string, string> = { 'a.txt': 'one\ntwo\nthree\n' }, from?: string): string {
  const dir = temp('seq-s7-repo-');
  if (from) fs.cpSync(from, dir, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test Owner']);
  git(dir, ['config', 'user.email', 'owner@example.test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '/.sequence/\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

/** Everything the user could lose: HEAD, the index's entries, and the working tree's status. */
function userState(dir: string): string {
  return [git(dir, ['rev-parse', 'HEAD']), git(dir, ['ls-files', '--stage']), git(dir, ['status', '--porcelain', '--untracked-files=all'])].join('\u0000');
}

/** Deterministic randomness: a counter, so names are predictable in assertions. */
function counterRand(): (n: number) => Buffer {
  let i = 0;
  return (n) => crypto.createHash('sha256').update(String(i++)).digest().subarray(0, n);
}

async function make(dir: string, data: string, title = 'Add a ping endpoint'): Promise<ChatWorktreeRef> {
  const r = await createChatWorktree(dir, { dataDir: data, title, rand: counterRand() });
  assert.ok(r.ok, JSON.stringify(r));
  return r.ref;
}

describe('S7 point 1 — where a worktree lives', () => {
  test('under <data>/wt/<8-hex>, outside the repo, and git lists it there', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const before = userState(dir);
    const ref = await make(dir, data);
    assert.match(path.basename(ref.path), /^[0-9a-f]{8}$/);
    assert.strictEqual(path.dirname(ref.path), fs.realpathSync(chatWorktreesRoot(data)));
    assert.ok(!path.relative(dir, ref.path).split(path.sep).every((s) => s !== '..'), 'the worktree is not inside the repo');
    const listed = git(dir, ['worktree', 'list', '--porcelain']).split(/\r?\n/).filter((l) => l.startsWith('worktree '));
    assert.ok(listed.some((l) => fs.realpathSync(l.slice(9)) === ref.path));
    assert.strictEqual(userState(dir), before, "creating it changed nothing in the user's checkout");
    assert.ok(ref.path.length < 120, `short path: ${ref.path.length} characters`);
  });

  test('refuses a data dir inside the repo (the board would double)', async () => {
    const dir = repo();
    const r = await createChatWorktree(dir, { dataDir: path.join(dir, '.sequence', 'data'), title: 'x' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(git(dir, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
  });
});

describe('S7 point 2 — branch name and base commit', () => {
  test('sequence/<chat-slug>-<4-hex>, cut from HEAD, base recorded', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data, 'Fix the Login page!! (urgent)');
    /* The slug stops at 24 characters on a word boundary. */
    assert.match(ref.branch, /^sequence\/fix-the-login-page-[0-9a-f]{4}$/);
    assert.strictEqual(ref.baseCommit, git(dir, ['rev-parse', 'HEAD']).trim());
    assert.strictEqual(ref.baseBranch, 'main');
    assert.strictEqual(git(ref.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), ref.branch);
    assert.strictEqual(chatSlug('   '), 'chat');
    assert.ok(chatSlug('a'.repeat(40)).length <= 40 && chatSlug('one two three four five six seven').length <= 24);
  });

  test('the chat diff is read against the base commit, uncommitted work included, nothing staged', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'a.txt'), 'one\nTWO\nthree\n');
    fs.writeFileSync(path.join(ref.path, 'new.txt'), 'new\n');
    const wtBefore = userState(ref.path);
    const c = await chatChanges(ref);
    assert.ok(c.ok);
    assert.deepStrictEqual(c.files, [
      { path: 'a.txt', status: 'modified' },
      { path: 'new.txt', status: 'added' },
    ]);
    assert.strictEqual(userState(ref.path), wtBefore, 'reading the diff staged nothing in the worktree');
  });
});

describe('S7 point 3 — the merge dry run', () => {
  test('merge-tree (git 2.38+) reports a clean merge and changes nothing anywhere', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'b.txt'), 'b\n');
    const [mainBefore, wtBefore] = [userState(dir), userState(ref.path)];
    const branchBefore = git(dir, ['rev-parse', ref.branch]);
    const d = await dryRunMerge(dir, ref);
    assert.ok(d.ok, JSON.stringify(d));
    assert.strictEqual(d.method, 'merge-tree');
    assert.deepStrictEqual(d.conflicts, []);
    assert.deepStrictEqual(d.files, [{ path: 'b.txt', status: 'added' }]);
    assert.strictEqual(d.target, 'main');
    assert.strictEqual(userState(dir), mainBefore);
    assert.strictEqual(userState(ref.path), wtBefore);
    assert.strictEqual(git(dir, ['rev-parse', ref.branch]), branchBefore);
  });

  test('lists the conflicting files and stops; the pre-2.38 fallback finds the same', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'a.txt'), 'one\nworktree\nthree\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nmain\nthree\n');
    git(dir, ['commit', '-qam', 'main edits a.txt']);
    const [mainBefore, wtBefore] = [userState(dir), userState(ref.path)];
    const tree = await dryRunMerge(dir, ref);
    const old = await dryRunMerge(dir, ref, { forceFallback: true });
    assert.ok(tree.ok && old.ok);
    assert.deepStrictEqual(tree.conflicts, ['a.txt']);
    assert.deepStrictEqual(old.conflicts, ['a.txt']);
    assert.strictEqual(old.method, 'throwaway-worktree');
    assert.strictEqual(userState(dir), mainBefore);
    assert.strictEqual(userState(ref.path), wtBefore);
    /* The fallback's throwaway worktree is gone again. */
    assert.strictEqual(git(dir, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 2);
  });

  test('the version gate', () => {
    assert.strictEqual(hasMergeTreeWriteTree([2, 37, 9]), false);
    assert.strictEqual(hasMergeTreeWriteTree([2, 38, 0]), true);
    assert.strictEqual(hasMergeTreeWriteTree([3, 0, 0]), true);
  });
});

describe('S7 point 4 — merging back', () => {
  test('refused while the main checkout has uncommitted changes; nothing moves', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'b.txt'), 'b\n');
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'mine, uncommitted\n');
    const [mainBefore, wtBefore] = [userState(dir), userState(ref.path)];
    const r = await mergeChatWorktree(dir, ref, { mode: 'merge', message: 'Add b' });
    assert.strictEqual(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && /uncommitted/.test(r.error) && !r.error.includes('\n'));
    assert.strictEqual(userState(dir), mainBefore);
    assert.strictEqual(userState(ref.path), wtBefore, 'the agent edits were not committed either');
  });

  test('a clean merge commits the agent edits on the worktree branch as the repo identity, no trailers, then merges', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'b.txt'), 'b\n');
    const r = await mergeChatWorktree(dir, ref, { mode: 'merge', message: 'Add b' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(r.committedOnBranch);
    const body = git(dir, ['log', '-1', '--format=%an <%ae>%n%B', r.committedOnBranch!]);
    assert.strictEqual(body.trim(), 'Test Owner <owner@example.test>\nAdd b');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'b\n');
    assert.strictEqual(git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length, 3, 'a merge commit');
    assert.strictEqual(git(dir, ['status', '--porcelain', '--untracked-files=all']).trim(), '');
  });

  test('squash lands one commit on the user branch', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'c.txt'), 'c\n');
    const r = await mergeChatWorktree(dir, ref, { mode: 'squash', message: 'Add c' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length, 2, 'one parent: a squash');
    assert.strictEqual(git(dir, ['log', '-1', '--format=%s']).trim(), 'Add c');
  });

  test('a conflict stops the merge with the files listed and nothing changed', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'a.txt'), 'one\nworktree\nthree\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nmain\nthree\n');
    git(dir, ['commit', '-qam', 'main edits a.txt']);
    const [mainBefore, wtBefore] = [userState(dir), userState(ref.path)];
    const r = await mergeChatWorktree(dir, ref, { mode: 'merge', message: 'x' });
    assert.ok(!r.ok && r.status === 409);
    assert.deepStrictEqual(!r.ok && 'conflicts' in r ? r.conflicts : null, ['a.txt']);
    assert.strictEqual(userState(dir), mainBefore);
    assert.strictEqual(userState(ref.path), wtBefore);
    assert.ok(!fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')));
  });
});

describe('S7 point 5 — removal', () => {
  test('unmerged commits are refused and named; confirming exactly them deletes with -D', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'd.txt'), 'd\n');
    git(ref.path, ['add', '-A']);
    git(ref.path, ['commit', '-qm', 'agent work']);
    const sha = git(ref.path, ['rev-parse', 'HEAD']).trim();
    const refused = await removeChatWorktree(dir, data, ref);
    assert.ok(!refused.ok && refused.status === 409);
    assert.deepStrictEqual(!refused.ok && 'unmerged' in refused ? refused.unmerged : null, [{ sha, subject: 'agent work' }]);
    assert.ok(fs.existsSync(ref.path) && tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref.branch}`]) === 0);
    /* A confirmation that does not name every unmerged commit is no confirmation. */
    const partial = await removeChatWorktree(dir, data, ref, { confirmUnmerged: ['0'.repeat(40)] });
    assert.ok(!partial.ok);
    const done = await removeChatWorktree(dir, data, ref, { confirmUnmerged: [sha] });
    assert.ok(done.ok && done.forcedBranchDelete);
    assert.ok(!fs.existsSync(ref.path));
    assert.notStrictEqual(tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref.branch}`]), 0);
  });

  test('after a merge it removes with -d and no confirmation', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'e.txt'), 'e\n');
    assert.ok((await mergeChatWorktree(dir, ref, { mode: 'merge', message: 'Add e' })).ok);
    const done = await removeChatWorktree(dir, data, ref);
    assert.ok(done.ok && !done.forcedBranchDelete, JSON.stringify(done));
  });

  test('a dirty worktree is kept (no --force), and a path Sequence did not make is refused', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    fs.writeFileSync(path.join(ref.path, 'wip.txt'), 'not committed\n');
    const kept = await removeChatWorktree(dir, data, ref);
    assert.ok(!kept.ok && kept.status === 409);
    assert.ok(fs.existsSync(path.join(ref.path, 'wip.txt')));
    const outside = await removeChatWorktree(dir, data, { ...ref, path: dir });
    assert.ok(!outside.ok && outside.status === 403);
    assert.ok(fs.existsSync(path.join(dir, 'a.txt')));
  });

  test('a worktree WINDOWS STILL HOLDS is removed, not refused', async () => {
    /*
     * THE LOCK, made the way Windows makes it: another process is using the
     * directory. A process whose working directory IS the worktree holds a
     * handle on it, and Windows cannot delete a directory that has an open
     * handle — which is exactly what git reports as "failed to delete
     * '<path>': Permission denied" and then gives up on.
     *
     * The holder leaves after a moment, the way a scanner, an editor or the
     * agent that was working in that directory does. What must NOT happen is
     * that the user's click on Remove is refused for it (409), because the
     * lock was never about their work.
     *
     * On POSIX an open directory does not block a delete, so the removal there
     * succeeds without any of this; the lock is a Windows fact, and this test
     * is the lock.
     */
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    const holder = childProcess.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { cwd: ref.path, stdio: 'ignore' });
    try {
      const done = await removeChatWorktree(dir, data, ref);
      assert.ok(done.ok, JSON.stringify(done));
      assert.ok(!fs.existsSync(ref.path), 'the worktree directory is gone');
      assert.notStrictEqual(tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref.branch}`]), 0, 'and so is its branch');
      assert.strictEqual(git(dir, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1, 'git does not list it any more');
    } finally {
      holder.kill();
    }
  });
});

/** Every directory under `dir` named `name`, at any depth. */
function dirsNamed(dir: string, name: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name === name) out.push(p);
      walk(p);
    }
  };
  walk(dir);
  return out;
}

describe('S7 removal ruling — the Rewind history goes with the worktree', () => {
  test('after removal no shadow git dir remains anywhere under <data> (control: one exists before)', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    const ref = await make(dir, data);
    /* An agent turn snapshotted in the worktree, as run-node does. */
    await beginTurn(ref.path, 'chat-1');
    fs.writeFileSync(path.join(ref.path, 'f.txt'), 'f\n');
    assert.ok(fs.existsSync(path.join(shadowGitDir(ref.path), 'HEAD')));
    assert.strictEqual(dirsNamed(data, 'snapshots').length, 1, 'control: the shadow dir is under <data> while the worktree lives');
    assert.ok((await mergeChatWorktree(dir, ref, { mode: 'merge', message: 'Add f' })).ok);
    const done = await removeChatWorktree(dir, data, ref);
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepStrictEqual(dirsNamed(data, 'snapshots'), []);
    assert.ok(!fs.existsSync(ref.path));
    assert.ok(!fs.existsSync(path.join(dir, '.sequence', 'snapshots')), 'nothing moved into the main checkout either');
  });

  test('over HTTP the chat keeps its record as removed and is no longer bound', async () => {
    const dir = repo();
    const store = temp('seq-s7-store-');
    const { base, close } = await serve(dir, store);
    try {
      const id = createSession(dir).id;
      assert.strictEqual((await post(base, `/api/sessions/${id}/worktree`)).status, 200);
      const removed = await post(base, `/api/sessions/${id}/worktree`, {}, 'DELETE');
      assert.strictEqual(removed.status, 200, JSON.stringify(removed.json));
      assert.strictEqual(readSessionWorktree(dir, id), null, 'unbound: the next turn runs in the main checkout');
      const record = readSessionWorktreeRecord(dir, id);
      assert.ok(record?.removedAt);
      const got = await fetch(`${base}/api/sessions/${id}/worktree`).then((r) => r.json() as Promise<{ worktree: { removedAt?: string } | null }>);
      assert.ok(got.worktree?.removedAt, 'GET answers the removed record, so Rewind can say why Revert is off');
      assert.strictEqual((await post(base, `/api/sessions/${id}/worktree/dry-run`)).status, 404);
    } finally {
      await close();
    }
  });
});

describe('S7 points 6 and 7 — the setup command and the cap', () => {
  test('a setup command is off by default, saved per repo, suggested from the lockfile, never run', async () => {
    const dir = repo({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });
    const data = temp('seq-s7-data-');
    assert.deepStrictEqual(readWorktreeSettings(data, dir), { cap: 8, setupCommand: null });
    assert.strictEqual(suggestSetupCommand(dir), 'pnpm install');
    /* A command that would leave a mark if anything ran it. */
    const mark = path.join(data, 'ran');
    const cmd = `node -e "require('fs').writeFileSync(${JSON.stringify(mark)}, 'x')"`;
    assert.ok(writeWorktreeSettings(data, dir, { setupCommand: cmd }).ok);
    const ref = await make(dir, data);
    assert.ok(fs.existsSync(ref.path));
    assert.strictEqual(readWorktreeSettings(data, dir).setupCommand, cmd);
    assert.ok(!fs.existsSync(mark), 'creating a worktree ran nothing');
    assert.ok(!fs.existsSync(path.join(ref.path, 'node_modules')));
    assert.ok(!writeWorktreeSettings(data, dir, { setupCommand: 'a\nb' }).ok);
  });

  test('the cap is a setting: 1-64, and creation past it is refused', async () => {
    const dir = repo();
    const data = temp('seq-s7-data-');
    assert.ok(!writeWorktreeSettings(data, dir, { cap: 0 }).ok);
    assert.ok(!writeWorktreeSettings(data, dir, { cap: 65 }).ok);
    assert.ok(writeWorktreeSettings(data, dir, { cap: 2 }).ok);
    assert.strictEqual(clampCap(undefined), 8);
    const cap = readWorktreeSettings(data, dir).cap;
    assert.strictEqual(cap, 2);
    assert.ok((await createChatWorktree(dir, { dataDir: data, title: 'one', cap })).ok);
    assert.ok((await createChatWorktree(dir, { dataDir: data, title: 'two', cap })).ok);
    const third = await createChatWorktree(dir, { dataDir: data, title: 'three', cap });
    assert.ok(!third.ok && third.status === 409 && /limit/.test(third.error));
    assert.strictEqual(git(dir, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PROOF, through the real server: a chat bound to a worktree runs its
   agent there. Two agents, no model:
     - the S0 replay of a recorded codex session (edit-with-plan). The replay
       substitutes its own cwd for the recording's <CWD> and checks every
       client frame; zero divergences means `thread/start` carried the
       worktree. Its recorded diff drives the S3 snapshot.
     - the repo's fake codex, which really writes hello.txt in its thread's cwd.
   Negative controls: the same turn from an unbound chat lands in the main
   checkout, so "untouched" is a check that can fail.
   ══════════════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;

async function serve(root: string, store: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

async function turn(base: string, body: Json): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200, await res.clone().text());
  const events: Json[] = [];
  const text = await res.text();
  for (const line of text.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as Json);
  return events;
}

const post = async (base: string, p: string, body?: unknown, method = 'POST'): Promise<{ status: number; json: Json }> => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: (await r.json()) as Json };
};

describe('S7 proof — an agent turn in a chat worktree, through the server', () => {
  test('the replayed codex session runs in the worktree and S3 snapshots it there (control: unbound chat runs in main)', async () => {
    const dir = repo({}, SHOPFRONT);
    const store = temp('seq-s7-store-');
    const fixture = readFixture(EDIT_FIXTURE);
    const report = path.join(store, 'report.json');
    addAgent(store, { id: 'codex', command: process.execPath, args: [REPLAY_CODEX, '--fixture', EDIT_FIXTURE, '--report', report], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const bound = createSession(dir).id;
      const made = await post(base, `/api/sessions/${bound}/worktree`);
      assert.strictEqual(made.status, 200, JSON.stringify(made.json));
      const ref = readSessionWorktree(dir, bound)!;
      assert.ok(ref && ref.path.startsWith(fs.realpathSync(path.join(store, 'wt'))));
      const mainBefore = userState(dir);

      const events = await turn(base, { agentRef: 'codex', prompt: fixture.header.prompt, permissionMode: 'autoEdit', interactivePermissions: true, chatId: bound });
      assert.ok(events.length > 0);
      const r = JSON.parse(fs.readFileSync(report, 'utf8')) as { divergences: string[]; finished: boolean };
      assert.deepStrictEqual(r.divergences, [], 'every frame matched with <CWD> = the worktree');
      assert.ok(fs.existsSync(path.join(ref.path, '.sequence', 'snapshots', 'git', 'HEAD')), "the worktree's own shadow git dir");
      assert.ok(!fs.existsSync(path.join(dir, '.sequence', 'snapshots')), 'no snapshot in the main checkout');
      assert.strictEqual(userState(dir), mainBefore);

      /* Control: the same recording from an unbound chat diverges unless <CWD>
         is the main checkout, and snapshots there. */
      fs.rmSync(report, { force: true });
      const loose = createSession(dir).id;
      await turn(base, { agentRef: 'codex', prompt: fixture.header.prompt, permissionMode: 'autoEdit', interactivePermissions: true, chatId: loose });
      const r2 = JSON.parse(fs.readFileSync(report, 'utf8')) as { divergences: string[] };
      assert.deepStrictEqual(r2.divergences, []);
      assert.ok(fs.existsSync(path.join(dir, '.sequence', 'snapshots', 'git', 'HEAD')), 'the control snapshots in main');
    } finally {
      await close();
    }
  });

  test("a real write lands only in the worktree; merge-back is clean; a conflict stops with nothing changed (control: unbound writes main)", async () => {
    const dir = repo();
    const store = temp('seq-s7-store-');
    addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const bound = createSession(dir).id;
      assert.strictEqual((await post(base, `/api/sessions/${bound}/worktree`)).status, 200);
      const ref = readSessionWorktree(dir, bound)!;
      const mainBefore = userState(dir);
      await turn(base, { agentRef: 'codex', prompt: 'create hello', permissionMode: 'autoEdit', interactivePermissions: true, chatId: bound });
      assert.strictEqual(fs.readFileSync(path.join(ref.path, 'hello.txt'), 'utf8'), 'hello\n');
      assert.ok(!fs.existsSync(path.join(dir, 'hello.txt')));
      assert.strictEqual(userState(dir), mainBefore, "the user's HEAD, index and working tree are untouched");

      const changes = await fetch(`${base}/api/sessions/${bound}/worktree/changes`).then((r) => r.json() as Promise<Json>);
      assert.deepStrictEqual(changes.files, [{ path: 'hello.txt', status: 'added' }], JSON.stringify(changes));
      const dry = await post(base, `/api/sessions/${bound}/worktree/dry-run`);
      assert.deepStrictEqual([dry.status, dry.json.conflicts], [200, []]);
      assert.strictEqual(userState(dir), mainBefore, 'the dry run changed nothing');

      const merged = await post(base, `/api/sessions/${bound}/worktree/merge`, { mode: 'merge' });
      assert.strictEqual(merged.status, 200, JSON.stringify(merged.json));
      assert.strictEqual(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'hello\n');
      assert.ok(readSessionWorktree(dir, bound)!.merged);

      /* Conflict: a second chat, its agent and the user both change hello.txt. */
      const second = createSession(dir).id;
      assert.strictEqual((await post(base, `/api/sessions/${second}/worktree`)).status, 200);
      const ref2 = readSessionWorktree(dir, second)!;
      fs.writeFileSync(path.join(ref2.path, 'hello.txt'), 'agent says hi\n');
      fs.writeFileSync(path.join(dir, 'hello.txt'), 'owner says hi\n');
      git(dir, ['commit', '-qam', 'owner edit']);
      const [m2, w2] = [userState(dir), userState(ref2.path)];
      const stopped = await post(base, `/api/sessions/${second}/worktree/merge`, { mode: 'squash' });
      assert.strictEqual(stopped.status, 409);
      assert.deepStrictEqual(stopped.json.conflicts, ['hello.txt']);
      assert.strictEqual(userState(dir), m2);
      assert.strictEqual(userState(ref2.path), w2);

      /* Removal over HTTP: refused with the unmerged commit named, then confirmed. */
      const discardRefused = await post(base, `/api/sessions/${second}/worktree`, {}, 'DELETE');
      assert.strictEqual(discardRefused.status, 409, JSON.stringify(discardRefused.json));

      /* Control: an unbound chat's agent writes into the main checkout. */
      fs.rmSync(path.join(dir, 'hello.txt'));
      git(dir, ['commit', '-qam', 'drop hello']);
      const loose = createSession(dir).id;
      await turn(base, { agentRef: 'codex', prompt: 'create hello', permissionMode: 'autoEdit', interactivePermissions: true, chatId: loose });
      assert.ok(fs.existsSync(path.join(dir, 'hello.txt')), 'the control writes main, so the check above can fail');
    } finally {
      await close();
    }
  });

  test('a binding whose directory is gone refuses the turn instead of running in main', async () => {
    const dir = repo();
    const store = temp('seq-s7-store-');
    addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const bound = createSession(dir).id;
      assert.strictEqual((await post(base, `/api/sessions/${bound}/worktree`)).status, 200);
      const ref = readSessionWorktree(dir, bound)!;
      git(dir, ['worktree', 'remove', '--force', ref.path]);
      const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentRef: 'codex', prompt: 'create hello', permissionMode: 'autoEdit', chatId: bound }),
      });
      assert.strictEqual(res.status, 409);
      assert.ok(!fs.existsSync(path.join(dir, 'hello.txt')));
    } finally {
      await close();
    }
  });
});
