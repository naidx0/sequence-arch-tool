import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  gitBranchChanges,
  gitBranches,
  gitSwitch,
  GitEventHub,
  HeadTracker,
  parseOverwriteFiles,
  type GitServerEvent,
} from '../server/gitBranchRoutes.js';
import { gitDiff } from '../server/gitWorkspace.js';
import { createRepoServer } from '../server/repoServer.js';
import { startHeadWatch } from '../server/repoWatch.js';

/*
 * Every repo here is a throwaway in the OS temp dir. No test exports GIT_DIR or
 * GIT_WORK_TREE, so nothing can reach a real repository's config.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function commitAll(root: string, msg: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
}

/** A repo on `main` with a manifest and one source file committed. */
function repo(): string {
  const root = tmp('seq-branch-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  write(root, 'package.json', '{"name":"t","version":"1.0.0"}\n');
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/b.ts', 'export const b = 1;\n');
  write(root, 'src/gone.ts', 'export const gone = 1;\n');
  commitAll(root, 'first');
  return root;
}

const cleanup = (...dirs: string[]): void => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
};

/* ═══ branches ════════════════════════════════════════════════════════════ */

test('GET branches lists ahead/behind against the upstream, the dirty count and remote-only branches', async () => {
  const root = repo();
  const origin = tmp('seq-origin-');
  try {
    git(origin, 'init', '-q', '--bare', '-b', 'main');
    git(root, 'remote', 'add', 'origin', origin);
    git(root, 'push', '-q', '-u', 'origin', 'main');
    // ahead 2
    write(root, 'src/a.ts', 'export const a = 2;\n');
    commitAll(root, 'local one');
    write(root, 'src/a.ts', 'export const a = 3;\n');
    commitAll(root, 'local two');
    // behind 1 (pushed from a second clone)
    const other = tmp('seq-other-');
    git(other, 'clone', '-q', origin, 'c');
    const c = path.join(other, 'c');
    git(c, 'config', 'user.email', 'o@example.com');
    git(c, 'config', 'user.name', 'O');
    git(c, 'config', 'commit.gpgsign', 'false');
    write(c, 'remote.txt', 'r\n');
    commitAll(c, 'remote work');
    git(c, 'push', '-q', 'origin', 'main');
    git(c, 'switch', '-q', '-c', 'only-remote');
    git(c, 'push', '-q', 'origin', 'only-remote');
    git(root, 'fetch', '-q', 'origin');
    cleanup(other);
    // a local feature branch with no upstream, one commit past main
    git(root, 'switch', '-q', '-c', 'feature');
    write(root, 'src/f.ts', 'export const f = 1;\n');
    commitAll(root, 'feature work');
    write(root, 'src/untracked.ts', 'x\n');

    const r = await gitBranches(root);
    assert.equal(r.current, 'feature');
    assert.equal(r.detached, false);
    assert.equal(r.dirty, 1);
    const main = r.branches.find((b) => b.name === 'main')!;
    assert.equal(main.upstream, 'origin/main');
    assert.equal(main.ahead, 2);
    assert.equal(main.behind, 1);
    assert.equal(main.lastCommit.subject, 'local two');
    assert.match(main.lastCommit.sha, /^[0-9a-f]{40}$/);
    assert.ok(!Number.isNaN(Date.parse(main.lastCommit.date)));
    const feature = r.branches.find((b) => b.name === 'feature')!;
    assert.equal(feature.upstream, undefined);
    // no upstream: counted against the default branch (origin/HEAD when git set it on fetch, else main)
    assert.match(feature.against ?? '', /^(origin\/)?main$/);
    assert.equal(feature.ahead, feature.against === 'main' ? 1 : 3);
    assert.equal(feature.behind, feature.against === 'main' ? 0 : 1);
    const remote = r.remoteBranches.map((b) => b.name);
    assert.deepEqual(remote, ['origin/only-remote']);
    assert.equal(r.remoteBranches[0]!.remote, true);
  } finally {
    cleanup(root, origin);
  }
});

test('detached HEAD reports current null and detached true', async () => {
  const root = repo();
  try {
    git(root, 'checkout', '-q', '--detach', 'HEAD');
    const r = await gitBranches(root);
    assert.equal(r.current, null);
    assert.equal(r.detached, true);
  } finally {
    cleanup(root);
  }
});

/* ═══ switch ══════════════════════════════════════════════════════════════ */

test('switch moves HEAD, can create from a start point, and a no-op reports changed false', async () => {
  const root = repo();
  try {
    git(root, 'branch', 'other');
    const r = await gitSwitch(root, { branch: 'other' });
    assert.ok(r.ok);
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'other');
    const again = await gitSwitch(root, { branch: 'other' });
    assert.ok(again.ok && again.changed === false);
    const made = await gitSwitch(root, { branch: 'brand/new', create: true, from: 'main' });
    assert.ok(made.ok && made.created);
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'brand/new');
    const dup = await gitSwitch(root, { branch: 'main', create: true });
    assert.ok(!dup.ok && dup.status === 409 && dup.reason === 'exists');
    const missing = await gitSwitch(root, { branch: 'nope' });
    assert.ok(!missing.ok && missing.status === 404);
  } finally {
    cleanup(root);
  }
});

test('switch with a dirty tree that would be overwritten returns 409 dirty and does nothing', async () => {
  const root = repo();
  try {
    git(root, 'switch', '-q', '-c', 'other');
    write(root, 'src/a.ts', 'export const a = "other";\n');
    commitAll(root, 'other edits a');
    git(root, 'switch', '-q', 'main');
    write(root, 'src/a.ts', 'export const a = "uncommitted";\n');
    const headBefore = git(root, 'rev-parse', 'HEAD').trim();

    const r = await gitSwitch(root, { branch: 'other' });
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.reason, 'dirty');
    assert.deepEqual(r.files, ['src/a.ts']);
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
    assert.equal(git(root, 'rev-parse', 'HEAD').trim(), headBefore);
    assert.equal(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'export const a = "uncommitted";\n');
  } finally {
    cleanup(root);
  }
});

test('non-conflicting local changes are carried across a switch, never discarded', async () => {
  const root = repo();
  try {
    git(root, 'branch', 'other');
    write(root, 'src/b.ts', 'export const b = "kept";\n');
    const r = await gitSwitch(root, { branch: 'other' });
    assert.ok(r.ok);
    assert.equal(fs.readFileSync(path.join(root, 'src/b.ts'), 'utf8'), 'export const b = "kept";\n');
  } finally {
    cleanup(root);
  }
});

test('hostile branch names are refused before git runs', async () => {
  const root = repo();
  try {
    const before = git(root, 'for-each-ref').trim();
    for (const name of ['--orphan', '--orphan=x', '-f', ';rm -rf /', '..', 'a..b', 'x y', '@{-1}', 'a:b', '', '/abs', 'ok.lock']) {
      for (const create of [false, true]) {
        const r = await gitSwitch(root, { branch: name, create });
        assert.ok(!r.ok && r.status === 400, `accepted ${JSON.stringify(name)} create=${create}`);
      }
    }
    for (const bad of [42, null, undefined, ['main'], { toString: () => 'main' }]) {
      const r = await gitSwitch(root, { branch: bad as never });
      assert.ok(!r.ok && r.status === 400);
    }
    const flagFrom = await gitSwitch(root, { branch: 'fine', create: true, from: '--upload-pack=x' });
    assert.ok(!flagFrom.ok && flagFrom.status === 400);
    const fromWithoutCreate = await gitSwitch(root, { branch: 'main', from: 'HEAD' });
    assert.ok(!fromWithoutCreate.ok && fromWithoutCreate.status === 400);
    assert.equal(git(root, 'for-each-ref').trim(), before, 'no ref was created');
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  } finally {
    cleanup(root);
  }
});

test('parseOverwriteFiles reads git’s tab-indented list', () => {
  const err = 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts\n\tdir/b c.ts\nPlease commit your changes or stash them before you switch branches.\nAborting\n';
  assert.deepEqual(parseOverwriteFiles(err), ['src/a.ts', 'dir/b c.ts']);
  assert.deepEqual(parseOverwriteFiles('fatal: nope\n'), []);
});

/* ═══ HEAD tracker + watcher (spy rescan) ═════════════════════════════════ */

function trackerFor(root: string, rescans: string[], events: GitServerEvent[]): HeadTracker {
  return new HeadTracker({
    getRoot: () => root,
    rescan: async (r) => {
      rescans.push(r);
      return 'scan-' + rescans.length;
    },
    emit: (e) => events.push(e),
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Poll (bounded) until `cond` holds; a fixed sleep is a guess that fails under load. */
async function waitFor(cond: () => boolean, what: string, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

test('a switch made OUTSIDE Sequence (plain git in a terminal) is detected and rescans once', async () => {
  const root = repo();
  git(root, 'branch', 'other');
  const rescans: string[] = [];
  const events: GitServerEvent[] = [];
  const tracker = trackerFor(root, rescans, events);
  await tracker.prime();
  const watch = startHeadWatch(root, { debounceMs: 80, onMaybeChanged: () => void tracker.check() });
  try {
    git(root, 'switch', '-q', 'other'); // not through gitSwitch, not through any route
    /* WAIT FOR THE EVENTS, not for a clock: the watcher's debounce plus a git child take as long as the machine makes them. */
    await waitFor(() => events.some((e) => e.type === 'graph:updated'), 'the rescan of the external switch');
    await sleep(250); // then a quiet window for a DUPLICATE; a late one cannot fail what passed
    assert.equal(rescans.length, 1, 'one rescan for one external switch');
    const head = events.find((e) => e.type === 'git:head');
    assert.ok(head && head.type === 'git:head');
    assert.equal(head.branch, 'other');
    assert.equal(head.previous.branch, 'main');
    assert.equal(head.rescan, true);
    assert.match(head.sha ?? '', /^[0-9a-f]{40}$/);
    assert.deepEqual(events.map((e) => e.type), ['git:head', 'graph:updated']);
    // a plain commit on the same branch moves the ref but is NOT a rescan
    write(root, 'src/c.ts', 'c\n');
    commitAll(root, 'on other');
    await waitFor(() => events.filter((e) => e.type === 'git:head').length >= 2, 'the head event of the commit');
    await sleep(250);
    assert.equal(rescans.length, 1, 'a commit does not rescan');
    assert.equal(events.filter((e) => e.type === 'git:head').length, 2);
  } finally {
    watch.stop();
    cleanup(root);
  }
});

test('a switch through gitSwitch + the watcher rescans exactly once (no double scan)', async () => {
  const root = repo();
  git(root, 'branch', 'other');
  const rescans: string[] = [];
  const events: GitServerEvent[] = [];
  const tracker = trackerFor(root, rescans, events);
  await tracker.prime();
  const watch = startHeadWatch(root, { debounceMs: 80, onMaybeChanged: () => void tracker.check() });
  try {
    const r = await gitSwitch(root, { branch: 'other' });
    assert.ok(r.ok);
    // what POST /api/git/switch does after a successful switch (the watcher may have beaten it to it)
    await (await tracker.check()).done;
    await sleep(900); // the watcher fires for the same change
    assert.equal(rescans.length, 1);
    assert.equal(events.filter((e) => e.type === 'git:head').length, 1);
  } finally {
    watch.stop();
    cleanup(root);
  }
});

test('the watcher works in a linked worktree (gitdir is a file)', async () => {
  const root = repo();
  const parent = tmp('seq-wt-');
  const wt = path.join(parent, 'wt');
  git(root, 'worktree', 'add', '-q', '-b', 'wt-branch', wt);
  git(root, 'branch', 'second');
  const rescans: string[] = [];
  const events: GitServerEvent[] = [];
  const tracker = trackerFor(wt, rescans, events);
  await tracker.prime();
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'worktree .git is a file');
  const watch = startHeadWatch(wt, { debounceMs: 80, onMaybeChanged: () => void tracker.check() });
  try {
    git(wt, 'switch', '-q', 'second');
    await waitFor(() => events.some((e) => e.type === 'graph:updated'), 'the rescan of the switch inside the linked worktree');
    await sleep(250);
    assert.equal(rescans.length, 1);
    const head = events.find((e) => e.type === 'git:head');
    assert.ok(head && head.type === 'git:head' && head.branch === 'second' && head.previous.branch === 'wt-branch');
    // and the branch routes work from the worktree too
    const b = await gitBranches(wt);
    assert.equal(b.current, 'second');
    const s = await gitSwitch(wt, { branch: 'wt-branch' });
    assert.ok(s.ok);
  } finally {
    watch.stop();
    git(root, 'worktree', 'remove', '--force', wt);
    cleanup(root, parent);
  }
});

/* ═══ per-branch file status ══════════════════════════════════════════════ */

test('branch-changes: 2 added, 1 modified, 1 deleted vs main, with counts and worktree layers', async () => {
  const root = repo();
  try {
    git(root, 'switch', '-q', '-c', 'feature');
    write(root, 'src/new1.ts', 'a\nb\nc\n');
    write(root, 'src/new2.ts', 'x\n');
    write(root, 'src/a.ts', 'export const a = 1;\nexport const a2 = 2;\n');
    fs.rmSync(path.join(root, 'src/gone.ts'));
    commitAll(root, 'feature');
    // main moves on after the cut: must not appear
    git(root, 'switch', '-q', 'main');
    write(root, 'src/mainonly.ts', 'm\n');
    commitAll(root, 'main moves');
    git(root, 'switch', '-q', 'feature');
    // working tree layers: staged edit, unstaged edit on top, and an untracked file
    write(root, 'src/b.ts', 'export const b = 2;\n');
    git(root, 'add', 'src/b.ts');
    write(root, 'src/b.ts', 'export const b = 3;\nmore\n');
    write(root, 'notes.md', 'untracked\n');

    const r = await gitBranchChanges(root); // default base: main
    assert.equal(r.branch, 'feature');
    assert.equal(r.base, 'main');
    assert.equal(r.noBase, undefined);
    assert.equal(r.mergeBase, git(root, 'merge-base', 'main', 'feature').trim());
    const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
    assert.ok(!('src/mainonly.ts' in by), 'base-only change excluded');

    assert.deepEqual([by['src/new1.ts']!.status, by['src/new1.ts']!.added, by['src/new1.ts']!.removed], ['A', 3, 0]);
    assert.deepEqual([by['src/new2.ts']!.status, by['src/new2.ts']!.added], ['A', 1]);
    assert.deepEqual([by['src/a.ts']!.status, by['src/a.ts']!.added, by['src/a.ts']!.removed], ['M', 1, 0]);
    assert.deepEqual([by['src/gone.ts']!.status, by['src/gone.ts']!.removed], ['D', 1]);
    assert.equal(by['src/new1.ts']!.committed?.status, 'A');
    assert.equal(by['src/new1.ts']!.staged, undefined);

    const b = by['src/b.ts']!;
    assert.equal(b.status, 'M');
    assert.equal(b.committed, undefined);
    assert.equal(b.staged?.status, 'M');
    assert.equal(b.unstaged?.status, 'M');
    assert.deepEqual([b.staged!.added, b.staged!.removed], [1, 1]);
    assert.deepEqual([b.unstaged!.added, b.unstaged!.removed], [2, 1]);

    const n = by['notes.md']!;
    assert.equal(n.untracked, true);
    assert.equal(n.status, 'A');

    const committedOnly = r.files.filter((f) => f.committed).map((f) => f.path).sort();
    assert.deepEqual(committedOnly, ['src/a.ts', 'src/gone.ts', 'src/new1.ts', 'src/new2.ts']);
  } finally {
    cleanup(root);
  }
});

test('branch-changes: a rename is R with its old path, and an unknown base is a 400', async () => {
  const root = repo();
  try {
    git(root, 'switch', '-q', '-c', 'feature');
    git(root, 'mv', 'src/a.ts', 'src/renamed.ts');
    commitAll(root, 'rename');
    const r = await gitBranchChanges(root, 'main');
    const f = r.files.find((x) => x.path === 'src/renamed.ts')!;
    assert.equal(f.status, 'R');
    assert.equal(f.oldPath, 'src/a.ts');
    assert.equal(r.files.length, 1);
    await assert.rejects(() => gitBranchChanges(root, 'no-such-base'), (e: unknown) => (e as { status?: number }).status === 400);
    await assert.rejects(() => gitBranchChanges(root, '--output=x'), (e: unknown) => (e as { status?: number }).status === 400);
  } finally {
    cleanup(root);
  }
});

/* ═══ staged vs unstaged diff (claims-audit 1.5) ══════════════════════════ */

test('unstaged and staged diffs are different texts for a file staged then edited again', async () => {
  const root = repo();
  try {
    write(root, 'src/a.ts', 'export const a = 1;\nSTAGED_LINE\n');
    git(root, 'add', 'src/a.ts');
    write(root, 'src/a.ts', 'export const a = 1;\nSTAGED_LINE\nUNSTAGED_LINE\n');

    const unstaged = (await gitDiff(root, 'src/a.ts', { kind: 'unstaged' })).diff;
    const staged = (await gitDiff(root, 'src/a.ts', { kind: 'staged' })).diff;
    const head = (await gitDiff(root, 'src/a.ts', { kind: 'worktree' })).diff;

    assert.match(unstaged, /\+UNSTAGED_LINE/);
    assert.doesNotMatch(unstaged, /\+STAGED_LINE/);
    assert.match(staged, /\+STAGED_LINE/);
    assert.doesNotMatch(staged, /UNSTAGED_LINE/);
    // the existing HEAD scope keeps meaning "everything" for current callers
    assert.match(head, /\+STAGED_LINE/);
    assert.match(head, /\+UNSTAGED_LINE/);
    assert.notEqual(unstaged, staged);
  } finally {
    cleanup(root);
  }
});

test('branch scope is merge-base to working tree and its base is optional', async () => {
  const root = repo();
  try {
    git(root, 'switch', '-q', '-c', 'feature');
    write(root, 'src/a.ts', 'export const a = 1;\nCOMMITTED\n');
    commitAll(root, 'c');
    write(root, 'src/a.ts', 'export const a = 1;\nCOMMITTED\nUNCOMMITTED\n');
    const d = (await gitDiff(root, 'src/a.ts', { kind: 'branch' })).diff;
    assert.match(d, /\+COMMITTED/);
    assert.match(d, /\+UNCOMMITTED/);
    const d2 = (await gitDiff(root, 'src/a.ts', { kind: 'branch', base: 'main' })).diff;
    assert.equal(d2, d);
  } finally {
    cleanup(root);
  }
});

/* ═══ end to end through the real server ══════════════════════════════════ */

interface Live {
  server: http.Server;
  port: number;
  events: Array<{ event: string; data: Record<string, unknown> }>;
  close: () => Promise<void>;
}

async function boot(root: string): Promise<Live> {
  const store = tmp('seq-store-');
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store, recentStoreDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const events: Live['events'] = [];
  const sse = http.get({ host: '127.0.0.1', port, path: '/api/git/events', headers: { accept: 'text/event-stream' } });
  let buf = '';
  await new Promise<void>((resolve, reject) => {
    sse.on('response', (res) => {
      assert.equal(res.statusCode, 200);
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
        }
      });
      resolve();
    });
    sse.on('error', reject);
  });
  return {
    server,
    port,
    events,
    close: async () => {
      sse.destroy();
      await new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      });
      cleanup(store);
    },
  };
}

function req(port: number, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      { host: '127.0.0.1', port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      (res) => {
        let t = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : null }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('server: POST /api/git/switch rescans the board once; a terminal switch rescans too', async () => {
  const root = repo();
  git(root, 'branch', 'other');
  git(root, 'branch', 'third');
  const live = await boot(root);
  try {
    const before = (await req(live.port, 'GET', '/archgraph.json')).json.scannedAt as string;

    const branches = await req(live.port, 'GET', '/api/git/branches');
    assert.equal(branches.status, 200);
    assert.equal(branches.json.current, 'main');

    const sw = await req(live.port, 'POST', '/api/git/switch', { branch: 'other' });
    assert.equal(sw.status, 200, JSON.stringify(sw.json));
    assert.equal(sw.json.branch, 'other');
    assert.equal(sw.json.rescan, true);
    await waitFor(() => live.events.some((e) => e.event === 'graph:updated'), 'the rescan of the switch');
    await sleep(500); // the watcher's late echo of the same change, which must not emit again
    const heads = live.events.filter((e) => e.event === 'git:head');
    const updated = live.events.filter((e) => e.event === 'graph:updated');
    assert.equal(heads.length, 1, JSON.stringify(live.events));
    assert.equal(updated.length, 1, JSON.stringify(live.events));
    assert.equal(heads[0]!.data.branch, 'other');
    const after = (await req(live.port, 'GET', '/archgraph.json')).json.scannedAt as string;
    assert.notEqual(after, before, 'the served graph is the new scan');

    // dirty refusal over HTTP
    git(root, 'switch', '-q', 'third');
    await waitFor(() => live.events.some((e) => e.event === 'graph:updated' && e.data.branch === 'third'), 'the rescan of the terminal switch to third');
    await sleep(300); // the watcher's echo of the same change
    live.events.length = 0;
    write(root, 'src/a.ts', 'export const a = 100;\n');
    git(root, 'add', 'src/a.ts');
    git(root, 'commit', '-q', '-m', 'third edits a');
    git(root, 'switch', '-q', 'other');
    await waitFor(() => live.events.some((e) => e.event === 'graph:updated' && e.data.branch === 'other'), 'the rescan of the terminal switch back to other');
    await sleep(300);
    write(root, 'src/a.ts', 'export const a = "wip";\n');
    live.events.length = 0;
    const refused = await req(live.port, 'POST', '/api/git/switch', { branch: 'third' });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.reason, 'dirty');
    assert.deepEqual(refused.json.files, ['src/a.ts']);
    await sleep(600);
    assert.deepEqual(live.events, [], 'a refused switch emits nothing');

    // injection over HTTP
    const bad = await req(live.port, 'POST', '/api/git/switch', { branch: '--orphan' });
    assert.equal(bad.status, 400);

    // outside switch (the throwaway repo, run directly with git)
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
    git(root, 'checkout', '-q', '--', 'src/a.ts');
    live.events.length = 0;
    git(root, 'switch', '-q', 'main');
    await waitFor(() => live.events.some((e) => e.event === 'graph:updated'), 'the rescan of the terminal switch to main');
    await sleep(500);
    assert.equal(live.events.filter((e) => e.event === 'git:head').length, 1, JSON.stringify(live.events));
    assert.equal(live.events.filter((e) => e.event === 'graph:updated').length, 1);
    assert.equal(live.events.find((e) => e.event === 'git:head')!.data.branch, 'main');
  } finally {
    await live.close();
    cleanup(root);
  }
});

test('server: branch-changes and diff scopes are served', async () => {
  const root = repo();
  const live = await boot(root);
  try {
    git(root, 'switch', '-q', '-c', 'feature');
    write(root, 'src/new.ts', 'n\n');
    commitAll(root, 'n');
    await sleep(1500);
    const ch = await req(live.port, 'GET', '/api/git/branch-changes');
    assert.equal(ch.status, 200);
    assert.equal(ch.json.base, 'main');
    assert.deepEqual(ch.json.files.map((f: { path: string }) => f.path), ['src/new.ts']);
    write(root, 'src/a.ts', 'export const a = 1;\nS\n');
    git(root, 'add', 'src/a.ts');
    write(root, 'src/a.ts', 'export const a = 1;\nS\nU\n');
    const u = await req(live.port, 'GET', '/api/git/diff?path=src/a.ts&scope=unstaged');
    const s = await req(live.port, 'GET', '/api/git/diff?path=src/a.ts&scope=staged');
    const b = await req(live.port, 'GET', '/api/git/diff?path=src/a.ts&scope=branch');
    assert.equal(u.status, 200);
    assert.match(u.json.diff, /\+U/);
    assert.doesNotMatch(u.json.diff, /\+S\n/);
    assert.match(s.json.diff, /\+S/);
    assert.doesNotMatch(s.json.diff, /\+U/);
    assert.match(b.json.diff, /\+U/);
    const bogus = await req(live.port, 'GET', '/api/git/diff?path=src/a.ts&scope=nonsense');
    assert.equal(bogus.status, 400);
  } finally {
    await live.close();
    cleanup(root);
  }
});

/* ═══ review round 1 ══════════════════════════════════════════════════════ */

test('an attached SUBDIRECTORY resolves the repo: head, branch-changes relative to it, switch rescans', async () => {
  const root = repo();
  const sub = path.join(root, 'app');
  write(root, 'app/a.ts', '1\n');
  write(root, 'other/z.ts', '1\n');
  commitAll(root, 'app');
  git(root, 'branch', 'second');
  git(root, 'switch', '-q', '-c', 'feat');
  write(root, 'app/b.ts', '2\n');
  write(root, 'other/y.ts', '2\n');
  commitAll(root, 'feat work');
  write(root, 'app/a.ts', '1\n2\n');
  const rescans: string[] = [];
  const events: GitServerEvent[] = [];
  const tracker = trackerFor(sub, rescans, events);
  await tracker.prime();
  const watch = startHeadWatch(sub, { debounceMs: 80, onMaybeChanged: () => void tracker.check() });
  try {
    const b = await gitBranches(sub);
    assert.equal(b.current, 'feat');
    assert.match(b.sha ?? '', /^[0-9a-f]{40}$/);
    const r = await gitBranchChanges(sub, 'main');
    assert.deepEqual(
      r.files.map((f) => `${f.path}:${f.status}`),
      ['a.ts:M', 'b.ts:A'],
      'relative to the attached root, outside files dropped',
    );
    // terminal switch from the subdirectory
    git(sub, 'switch', '-q', 'second');
    await waitFor(() => events.some((e) => e.type === 'graph:updated'), 'the rescan of the switch from the subdirectory');
    await sleep(250);
    assert.equal(rescans.length, 1);
    assert.ok(events.some((e) => e.type === 'git:head' && e.branch === 'second'));
    // switch through the function, then the route's check
    const s = await gitSwitch(sub, { branch: 'feat' });
    assert.ok(s.ok);
    await (await tracker.check()).done;
    await sleep(250); // the watcher's echo of the same change, which must not rescan again
    assert.equal(rescans.length, 2);
  } finally {
    watch.stop();
    cleanup(root);
  }
});

test('a tag with the same name as the branch does not confuse current or the no-op switch', async () => {
  const root = repo();
  try {
    git(root, 'tag', 'v1');
    git(root, 'switch', '-q', '-c', 'v1');
    const b = await gitBranches(root);
    assert.equal(b.current, 'v1');
    const s = await gitSwitch(root, { branch: 'v1' });
    assert.ok(s.ok && s.changed === false && s.branch === 'v1');
  } finally {
    cleanup(root);
  }
});

test('an unborn repo lists its index and untracked files as added', async () => {
  const root = tmp('seq-unborn-');
  try {
    git(root, 'init', '-q', '-b', 'main');
    write(root, 'src/a.ts', 'a\nb\n');
    git(root, 'add', 'src/a.ts');
    write(root, 'src/u.ts', 'u\n');
    const r = await gitBranchChanges(root);
    assert.equal(r.head, null);
    assert.equal(r.noBase, true);
    const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
    assert.equal(by['src/a.ts']!.status, 'A');
    assert.equal(by['src/a.ts']!.staged?.status, 'A');
    assert.equal(by['src/a.ts']!.added, 2);
    assert.equal(by['src/u.ts']!.untracked, true);
    assert.equal(by['src/u.ts']!.status, 'A');
  } finally {
    cleanup(root);
  }
});

test('a new branch may not be named refs/...', async () => {
  const root = repo();
  try {
    const r = await gitSwitch(root, { branch: 'refs/heads/main', create: true });
    assert.ok(!r.ok && r.status === 400);
    assert.equal(git(root, 'for-each-ref', '--format=%(refname)').trim(), 'refs/heads/main');
  } finally {
    cleanup(root);
  }
});

test('an untracked file has an all-added diff (worktree, unstaged and branch scopes)', async () => {
  const root = repo();
  try {
    write(root, 'src/fresh.ts', 'line one\nline two\n');
    for (const kind of ['worktree', 'unstaged', 'branch'] as const) {
      const d = (await gitDiff(root, 'src/fresh.ts', { kind })).diff;
      assert.match(d, /new file mode/, kind);
      assert.match(d, /\+line one/, kind);
      assert.match(d, /\+line two/, kind);
    }
    // a tracked, unchanged file stays empty
    assert.equal((await gitDiff(root, 'src/b.ts', { kind: 'unstaged' })).diff, '');
  } finally {
    cleanup(root);
  }
});

test('GitEventHub drops streams whose owner no longer matches after a re-attach', () => {
  const mk = () => {
    let ended = false;
    const res = {
      statusCode: 0,
      setHeader: () => undefined,
      flushHeaders: () => undefined,
      write: () => true,
      end: () => {
        ended = true;
      },
      on: () => undefined,
    };
    const req = { on: () => undefined };
    return { res, req, ended: () => ended };
  };
  const hub = new GitEventHub();
  const a = mk();
  const b = mk();
  hub.attach(a.req as never, a.res as never, 'alice');
  hub.attach(b.req as never, b.res as never, 'bob');
  hub.dropNotOwnedBy(null);
  assert.equal(hub.size, 2, 'unowned (local) keeps everyone');
  hub.dropNotOwnedBy('bob');
  assert.equal(a.ended(), true);
  assert.equal(b.ended(), false);
  assert.equal(hub.size, 1);
});

test('server.close() ends SSE streams even while a client is attached', async () => {
  const root = repo();
  const live = await boot(root);
  const t0 = Date.now();
  await new Promise<void>((r) => live.server.close(() => r()));
  assert.ok(Date.now() - t0 < 5000, 'close() must not wait on the SSE client');
  cleanup(root);
});
