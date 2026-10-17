import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { gitBranches, handleGitBranchRoute, HeadTracker, resetGitBranchesCache, type BranchInfo } from '../server/gitBranchRoutes.js';
import { defaultBaseRef } from '../server/gitWorkspace.js';

/*
 * /api/git/branches used to await one `git rev-list` per upstream-less branch in
 * a sequential loop (52-60 s on 338 branches). It is now ONE for-each-ref with
 * `%(ahead-behind:<base>)`, cached per refs fingerprint, shared by concurrent
 * callers, and killed when every caller hangs up. A counting fake `git` (node.exe
 * copied to git.exe, which logs argv and then runs the REAL git) puts numbers on
 * that. Every repo is a throwaway under os.tmpdir(); no test exports GIT_DIR.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** main with a few commits, a bare origin, and many branches of varied shape. */
function fixture(branchCount: number): { root: string; bare: string } {
  const root = tmp('seq-brperf-');
  const bare = tmp('seq-brperf-origin-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(root, 'config', k!, v!);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'c0');
  for (let i = 1; i <= 5; i++) git(root, 'commit', '-q', '--allow-empty', '-m', `main ${i}`);
  git(root, 'remote', 'add', 'origin', bare);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'remote', 'set-head', 'origin', 'main');
  git(root, 'branch', '--set-upstream-to=origin/main', 'main');
  for (let i = 0; i < branchCount; i++) {
    let tip = git(root, 'rev-parse', `main~${i % 5}`).trim();
    const tree = git(root, 'rev-parse', `${tip}^{tree}`).trim();
    for (let c = 0; c < i % 4; c++) tip = git(root, 'commit-tree', tree, '-p', tip, '-m', `b${i} c${c}`).trim();
    git(root, 'update-ref', `refs/heads/feat/b${i}`, tip);
  }
  // Upstream-bearing branches (ahead and behind its upstream), a gone upstream, a remote-only branch.
  git(root, 'push', '-q', 'origin', 'feat/b1');
  git(root, 'branch', '--set-upstream-to=origin/feat/b1', 'feat/b1');
  const b1 = git(root, 'rev-parse', 'feat/b1').trim();
  git(root, 'update-ref', 'refs/heads/feat/b1', git(root, 'commit-tree', `${b1}^{tree}`, '-p', b1, '-m', 'local only on b1').trim());
  git(root, 'push', '-q', 'origin', 'feat/b2');
  git(root, 'branch', '--set-upstream-to=origin/feat/b2', 'feat/b2');
  git(root, 'push', '-q', 'origin', 'feat/b3:refs/heads/remote-only');
  git(root, 'push', '-q', 'origin', 'feat/b3');
  git(root, 'branch', '--set-upstream-to=origin/feat/b3', 'feat/b3');
  git(bare, 'branch', '-D', 'feat/b3');
  git(root, 'fetch', '-q', '--prune');
  return { root, bare };
}

/** The pre-change algorithm, verbatim in behaviour: one awaited rev-list per upstream-less branch. */
async function legacyBranches(root: string): Promise<BranchInfo[]> {
  const base = await defaultBaseRef(root);
  const fmt = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:iso-strict)', '%(contents:subject)'].join('%00') + '%1e';
  const out = git(root, 'for-each-ref', `--format=${fmt}`, 'refs/heads');
  const rows = out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r !== '').map((r) => r.split('\0'));
  const branches: BranchInfo[] = [];
  for (const f of rows) {
    const name = (f[0] ?? '').replace(/^refs\/heads\//, '');
    const upstream = f[2] ?? '';
    let counts: { ahead: number; behind: number } | null = null;
    let against: string | undefined;
    if (upstream !== '') {
      const track = f[3] ?? '';
      if (track === '') counts = { ahead: 0, behind: 0 };
      else if (!/gone/.test(track)) {
        const a = /ahead (\d+)/.exec(track);
        const b = /behind (\d+)/.exec(track);
        counts = { ahead: a ? Number(a[1]) : 0, behind: b ? Number(b[1]) : 0 };
      }
      against = upstream;
    }
    if (counts === null && name !== base && base !== 'HEAD') {
      const lr = git(root, 'rev-list', '--left-right', '--count', `${base}...refs/heads/${name}`);
      const m = /^(\d+)\s+(\d+)/.exec(lr.trim());
      if (m) {
        counts = { ahead: Number(m[2]), behind: Number(m[1]) };
        against = base;
      }
    }
    branches.push({
      name,
      ...(upstream !== '' ? { upstream } : {}),
      ahead: counts?.ahead ?? 0,
      behind: counts?.behind ?? 0,
      ...(against !== undefined ? { against } : {}),
      lastCommit: { sha: f[1] ?? '', date: f[4] ?? '', subject: f[5] ?? '' },
    });
  }
  return branches;
}

interface LogEntry {
  ev: 'start' | 'end';
  pid: number;
  args: string[];
  t: number;
}

/**
 * node.exe copied to git.exe, first on PATH. Its preload logs argv to GITLOG and
 * runs the real git (REAL_GIT). GIT_FAIL_AB makes any `ahead-behind` call fail
 * like an old git; GIT_HANG_AB makes it block (so an abort has something to kill).
 */
function countingGit(opts: { failAheadBehind?: boolean; hangAheadBehind?: boolean; slowStatusMs?: number } = {}): { log: () => LogEntry[]; restore: () => void } {
  const realGit = (process.env.PATH ?? process.env.Path ?? '')
    .split(path.delimiter)
    .map((d) => path.join(d, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find((p) => fs.existsSync(p));
  assert.ok(realGit, 'a real git on PATH');
  const dir = tmp('seq-cntgit-');
  const exe = process.platform === 'win32' ? 'git.exe' : 'git';
  fs.copyFileSync(process.execPath, path.join(dir, exe));
  const logFile = path.join(dir, 'log.jsonl');
  fs.writeFileSync(logFile, '');
  const script = path.join(dir, 'fake-git.cjs');
  fs.writeFileSync(
    script,
    [
      "const cp = require('child_process'); const fs = require('fs');",
      // node resolves a bare first argument (the git subcommand) into a script path: undo that.
      "const a = process.argv.slice(1); a[0] = require('path').basename(a[0]);",
      "const j = a.join(' ');",
      "const log = (ev) => fs.appendFileSync(process.env.GITLOG, JSON.stringify({ ev, pid: process.pid, args: a, t: Date.now() }) + '\\n');",
      "log('start');",
      "if (process.env.GIT_FAIL_AB === '1' && j.includes('ahead-behind')) { process.stderr.write('fatal: unknown field name: ahead-behind\\n'); log('end'); process.exit(128); }",
      "if (process.env.GIT_HANG_AB === '1' && j.includes('ahead-behind')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); }",
      "if (a[0] === 'status' && Number(process.env.GIT_SLOW_STATUS) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.GIT_SLOW_STATUS));",
      "const r = cp.spawnSync(process.env.REAL_GIT, a, { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '' }, maxBuffer: 1 << 28 });",
      'if (r.stdout && r.stdout.length) fs.writeSync(1, r.stdout);',
      'if (r.stderr && r.stderr.length) fs.writeSync(2, r.stderr);',
      "log('end');",
      'process.exit(r.status === null ? 1 : r.status);',
      '',
    ].join('\n'),
  );
  const keys = ['PATH', 'Path', 'NODE_OPTIONS', 'GITLOG', 'REAL_GIT', 'GIT_FAIL_AB', 'GIT_HANG_AB', 'GIT_SLOW_STATUS'];
  const saved: Record<string, string | undefined> = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const pk = process.platform === 'win32' ? 'Path' : 'PATH';
  process.env[pk] = dir + path.delimiter + (process.env[pk] ?? '');
  process.env.NODE_OPTIONS = `--require ${script.replace(/\\/g, '/')}`;
  process.env.GITLOG = logFile;
  process.env.REAL_GIT = realGit!;
  process.env.GIT_FAIL_AB = opts.failAheadBehind ? '1' : '0';
  process.env.GIT_HANG_AB = opts.hangAheadBehind ? '1' : '0';
  process.env.GIT_SLOW_STATUS = String(opts.slowStatusMs ?? 0);
  return {
    log: () =>
      fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LogEntry),
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const starts = (log: LogEntry[], needle: string): LogEntry[] => log.filter((e) => e.ev === 'start' && e.args.join(' ').includes(needle));
const cleanup = (...dirs: string[]): void => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('branches: same data as the old sequential implementation, with the ahead-behind atom AND without it', async () => {
  const { root, bare } = fixture(14);
  try {
    resetGitBranchesCache();
    const want = await legacyBranches(root);
    assert.ok(want.length >= 15);
    assert.ok(want.some((b) => b.against === 'origin/main' && (b.ahead > 0 || b.behind > 0)), 'fixture has diverged upstream-less branches');
    assert.ok(want.some((b) => b.upstream !== undefined && b.ahead > 0), 'fixture has an ahead upstream branch');
    const viaAtom = await gitBranches(root);
    assert.deepEqual(viaAtom.branches, want);
    resetGitBranchesCache();
    const viaFallback = await gitBranches(root, { aheadBehind: 'off' });
    assert.deepEqual(viaFallback.branches, want);
    assert.deepEqual(viaFallback.remoteBranches, viaAtom.remoteBranches);
    assert.ok(viaAtom.remoteBranches.some((r) => r.name === 'origin/remote-only'));
    assert.equal(viaAtom.current, 'main');
    assert.equal(viaAtom.dirty, 0);
  } finally {
    cleanup(root, bare);
  }
});

test('branches: the listing is ONE for-each-ref with the atom, and no rev-list at all', async () => {
  const { root, bare } = fixture(14);
  resetGitBranchesCache();
  const fake = countingGit();
  try {
    await gitBranches(root);
    const log = fake.log();
    assert.equal(starts(log, 'rev-list').length, 0, 'no per-branch rev-list');
    assert.equal(starts(log, 'ahead-behind').length, 1, 'one batched call carries every count');
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});

test('branches: a repeat call spawns no ref reads and sees a new branch once refs change', async () => {
  const { root, bare } = fixture(8);
  resetGitBranchesCache();
  const fake = countingGit();
  try {
    const first = await gitBranches(root);
    const before = fake.log().length;
    const second = await gitBranches(root);
    assert.deepEqual(second.branches, first.branches);
    const extra = fake.log().slice(before);
    assert.equal(starts(extra, 'for-each-ref').length, 0, 'cached: no ref listing re-run');
    assert.equal(starts(extra, 'rev-list').length, 0);
    fake.restore();
    git(root, 'branch', 'brand-new', 'main~1');
    const fake2 = countingGit();
    try {
      const third = await gitBranches(root);
      assert.ok(third.branches.some((b) => b.name === 'brand-new'), 'a changed refs set invalidates the cache');
      assert.equal(third.branches.length, first.branches.length + 1);
      assert.ok(starts(fake2.log(), 'for-each-ref').length >= 1);
    } finally {
      fake2.restore();
    }
  } finally {
    cleanup(root, bare);
  }
});

test('branches: concurrent callers share one computation', async () => {
  const { root, bare } = fixture(14);
  resetGitBranchesCache();
  const fake = countingGit();
  try {
    const rs = await Promise.all(Array.from({ length: 6 }, () => gitBranches(root)));
    for (const r of rs) assert.deepEqual(r.branches, rs[0]!.branches);
    const log = fake.log();
    assert.equal(starts(log, 'ahead-behind').length, 1, 'six callers, one batched call');
    assert.equal(starts(log, 'rev-list').length, 0);
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});

test('branches: aborting the only caller kills the running git child and rejects', async () => {
  const { root, bare } = fixture(8);
  resetGitBranchesCache();
  const fake = countingGit({ hangAheadBehind: true });
  try {
    const ac = new AbortController();
    const p = gitBranches(root, { signal: ac.signal });
    let hung: LogEntry | undefined;
    for (let i = 0; i < 400 && hung === undefined; i++) {
      hung = starts(fake.log(), 'ahead-behind')[0];
      if (hung === undefined) await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(hung, 'the batched git call started');
    assert.ok(alive(hung!.pid), 'it is blocked, alive');
    ac.abort();
    await assert.rejects(p, /aborted/);
    let dead = false;
    for (let i = 0; i < 200 && !dead; i++) {
      dead = !alive(hung!.pid);
      if (!dead) await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(dead, 'the git child was killed, not left to finish');
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});

test('branches: one caller hanging up does not kill the work another caller still waits on', async () => {
  const { root, bare } = fixture(8);
  resetGitBranchesCache();
  const fake = countingGit();
  try {
    const ac = new AbortController();
    const quitter = gitBranches(root, { signal: ac.signal });
    const stayer = gitBranches(root);
    ac.abort();
    await assert.rejects(quitter, /aborted/);
    const r = await stayer;
    assert.ok(r.branches.length >= 9);
    assert.equal(starts(fake.log(), 'ahead-behind').length, 1);
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});

test('branches: the route answers 499 for an already-aborted request and never throws', async () => {
  const { root, bare } = fixture(4);
  try {
    const ac = new AbortController();
    ac.abort();
    const tracker = {} as unknown as HeadTracker;
    const r = await handleGitBranchRoute('/api/git/branches', 'GET', new URLSearchParams(), async () => ({}), root, tracker, ac.signal);
    assert.equal(r?.status, 499);
  } finally {
    cleanup(root, bare);
  }
});

test('branches: without the ahead-behind atom, falls back to bounded rev-list and still returns the same data', async () => {
  const { root, bare } = fixture(22);
  resetGitBranchesCache();
  const want = await legacyBranches(root);
  resetGitBranchesCache();
  const fake = countingGit({ failAheadBehind: true });
  try {
    const r = await gitBranches(root);
    assert.deepEqual(r.branches, want, 'an old git that rejects the atom returns the same listing');
    const log = fake.log();
    assert.ok(starts(log, 'rev-list').length > 0, 'it did fall back to rev-list');
    // Concurrency never exceeds the bound.
    const events = log.filter((e) => e.args[0] === 'rev-list').flatMap((e) => [{ t: e.t, d: e.ev === 'start' ? 1 : -1 }]);
    events.sort((a, b) => a.t - b.t || a.d - b.d);
    let cur = 0;
    let max = 0;
    for (const e of events) {
      cur += e.d;
      max = Math.max(max, cur);
    }
    assert.ok(max <= 8, `at most 8 rev-list children at once (saw ${max})`);
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});

test('branches: dirty is always fresh on a direct call; the route may serve a slow status stale, then catches up', async () => {
  const { root, bare } = fixture(4);
  resetGitBranchesCache();
  const fake = countingGit({ slowStatusMs: 400 });
  try {
    // Direct call: a new untracked file shows at once even though status is slow.
    assert.equal((await gitBranches(root)).dirty, 0);
    fs.writeFileSync(path.join(root, 'new.txt'), 'x');
    assert.equal((await gitBranches(root)).dirty, 1, 'direct call counts fresh');
    // Route-style call on a slow status: the expired count is served as it stands...
    resetGitBranchesCache();
    fs.rmSync(path.join(root, 'new.txt'));
    assert.equal((await gitBranches(root, { staleDirty: true })).dirty, 0);
    fs.writeFileSync(path.join(root, 'new.txt'), 'x');
    const t0 = Date.now();
    assert.equal((await gitBranches(root, { staleDirty: true })).dirty, 0, 'stale count, no status wait');
    assert.ok(Date.now() - t0 < 350, `did not wait on the 400 ms status (${Date.now() - t0} ms)`);
    // ...and a later call, after the TTL and the background refresh, sees the file.
    await new Promise((r) => setTimeout(r, 1200));
    await gitBranches(root, { staleDirty: true });
    let seen = 0;
    for (let i = 0; i < 40 && seen !== 1; i++) {
      await new Promise((r) => setTimeout(r, 150));
      seen = (await gitBranches(root, { staleDirty: true })).dirty;
    }
    assert.equal(seen, 1, 'the background refresh caught up');
  } finally {
    fake.restore();
    cleanup(root, bare);
  }
});
