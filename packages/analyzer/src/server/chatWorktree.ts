/* ══════════════════════════════════════════════════════════════════════════
   S7 — A CHAT IN ITS OWN WORKTREE
   packages/analyzer/src/server/chatWorktree.ts

   A chat can be bound to a git worktree: a second checkout of the user's repo
   on its own branch, so an agent works there and the user's checkout, index
   and uncommitted edits are never touched. The work comes back only when the
   person presses Merge.

   WHERE. `<data>/wt/<8-hex>`, under Sequence's own data dir (the user store,
   SEQUENCE_USER_DIR / ~/.sequence), never inside the repo: inside it, the
   scanner, the file watcher and the repo's own S3 snapshots would see a second
   copy and the board would double. The path is short on purpose: a fresh
   install of node_modules under it must stay inside Windows' 260 characters.

   WHAT IS RECORDED. The branch (`sequence/<chat-slug>-<4-hex>`), the base
   commit the worktree was cut from, and the branch the user was on; the chat's
   session index entry holds them (sessionsStore `worktree`). The Diff for the
   chat is the worktree against that base commit, and S3 snapshots key on the
   worktree path, so each worktree has its own shadow git dir.

   MERGE-BACK, in three steps, only on the user's click:
     1. a dry run: the files the chat changed against its base, and whether the
        merge into the user's current branch would conflict. `git merge-tree
        --write-tree` (git 2.38+) computes the whole merge without touching a
        working tree; an older git gets a throwaway detached worktree instead.
        The worktree's uncommitted edits are included through a temporary
        index and a commit object no ref points at, so the dry run changes
        nothing anywhere.
     2. refused, with one line saying why, when the main checkout has
        uncommitted changes (owner rule: never touch uncommitted work) or the
        dry run found conflicts (listed; never auto-resolved).
     3. the worktree's own uncommitted edits are committed on its branch (the
        repo's configured identity, no trailers), then merged or squashed into
        the user's current branch.

   REMOVAL. `git worktree remove` WITHOUT --force (a dirty worktree is
   refused by git and that refusal is reported), then `git branch -d`; `-D`
   only when the caller passes the confirmation the user gave in a dialog that
   named the unmerged commits.

   NOTHING RUNS ON ITS OWN. A fresh worktree has no node_modules; a per-repo
   setup command may be saved (off by default) and is only ever shown, never
   executed by this module.

   No shell anywhere: fixed argv to `git`, `--` before every path or name, and
   every GIT_* variable stripped from the child's environment.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureSequenceIgnoredAsync } from './sequenceIgnore.js';
import { launchTool, projectRootOf, resolveTool } from './toolPath.js';

/** The default cap on live chat worktrees per repo; a setting overrides it. */
export const DEFAULT_WORKTREE_CAP = 8;
/** The cap a setting may not exceed (each worktree is a full checkout on disk). */
export const MAX_WORKTREE_CAP = 64;

const GIT_TIMEOUT_MS = 60_000;

/** What a chat's session index entry records about its worktree. */
export interface ChatWorktreeRef {
  /** The 8-hex directory name under `<data>/wt`. */
  id: string;
  /** Absolute path of the worktree. */
  path: string;
  /** `sequence/<chat-slug>-<4-hex>`. */
  branch: string;
  /** The commit the worktree was cut from: the diff base for the chat. */
  baseCommit: string;
  /** The branch the main checkout was on at creation, or null when detached. */
  baseBranch: string | null;
  createdAt: string;
  /** Set once the work has been merged back. */
  merged?: { at: string; mode: MergeMode; into: string; commit: string };
  /**
   * Set when the worktree was removed. The chat keeps its transcript and this
   * record (so Rewind can say why Revert is off); it is no longer bound, and
   * its next turn runs in the main checkout.
   */
  removedAt?: string;
}

export type MergeMode = 'merge' | 'squash';

export interface Refusal {
  ok: false;
  status: number;
  error: string;
}

/* ───────────────────────────── git ───────────────────────────── */

interface Proc {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  env.GIT_TERMINAL_PROMPT = '0';
  return { ...env, ...extra };
}

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<Proc> {
  return new Promise((resolve) => {
    let child: childProcess.ChildProcess;
    const tool = resolveTool('git', [cwd, projectRootOf(cwd)]);
    if (!tool.ok) {
      resolve({ code: -1, stdout: '', stderr: tool.error });
      return;
    }
    try {
      const l = launchTool(tool.path, args);
      child = childProcess.spawn(l.command, l.args, { cwd, env: cleanEnv(extraEnv), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(l.verbatim ? { windowsVerbatimArguments: true } : {}) });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: (e as Error).message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS);
    child.stdout!.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr!.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const why = (r: Proc, fallback: string): string => (r.stderr || r.stdout).trim() || `${fallback} (exit ${r.code})`;

/** `git version` as [major, minor, patch]; read once per process. */
let versionCache: Promise<[number, number, number]> | null = null;
export function gitVersion(): Promise<[number, number, number]> {
  versionCache ??= git(process.cwd(), ['version']).then((r) => {
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(r.stdout);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [0, 0, 0];
  });
  return versionCache;
}

/** `git merge-tree --write-tree` arrived in 2.38. */
export function hasMergeTreeWriteTree([major, minor]: readonly number[]): boolean {
  return major! > 2 || (major === 2 && minor! >= 38);
}

/* ─────────────────────────── naming ─────────────────────────── */

/** Where every chat worktree lives: `<data>/wt`. Pure. */
export function chatWorktreesRoot(dataDir: string): string {
  return path.join(dataDir, 'wt');
}

/** A chat title as a branch-safe slug: lower case, `a-z0-9` words joined by `-`, at most 24 characters. */
export function chatSlug(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 24) break;
    out = next;
  }
  return out || 'chat';
}

const hex = (bytes: number, rand: (n: number) => Buffer): string => rand(bytes).toString('hex');

/** True when `child` is `parent` or inside it, judged on real paths where they exist. */
function within(child: string, parent: string): boolean {
  const real = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const c = real(child);
  const p = real(parent);
  const rel = path.relative(p, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* ─────────────────────────── create ─────────────────────────── */

/** Chat worktrees git lists for this repo (the ones under `<data>/wt`). */
export async function liveChatWorktrees(repoRoot: string, dataDir: string): Promise<{ path: string; branch: string | null }[]> {
  const r = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) return [];
  const root = chatWorktreesRoot(dataDir);
  const out: { path: string; branch: string | null }[] = [];
  let cur: { path: string; branch: string | null } | null = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length), branch: null };
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
  }
  if (cur) out.push(cur);
  return out.filter((w) => within(w.path, root) && path.resolve(w.path) !== path.resolve(root));
}

export interface CreateOptions {
  dataDir: string;
  /** The chat's title, for the branch slug. */
  title: string;
  /** The cap setting (DEFAULT_WORKTREE_CAP when absent). */
  cap?: number;
  /** Randomness, injectable for tests. */
  rand?: (bytes: number) => Buffer;
  now?: () => Date;
}

/**
 * Cut a worktree for a chat from the repo's current HEAD, on a new branch.
 * Creates the directory and the branch and nothing else: no install, no
 * command, no change to the main checkout.
 */
export async function createChatWorktree(repoRoot: string, opts: CreateOptions): Promise<{ ok: true; ref: ChatWorktreeRef } | Refusal> {
  const rand = opts.rand ?? crypto.randomBytes;
  const top = await git(repoRoot, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { ok: false, status: 400, error: 'This folder is not a git repository, so a chat cannot have its own worktree.' };
  const root = chatWorktreesRoot(opts.dataDir);
  if (within(root, repoRoot)) {
    return { ok: false, status: 400, error: 'Sequence\'s data folder is inside this repository; a worktree there would be scanned as a second copy.' };
  }
  const head = await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const baseCommit = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(baseCommit)) {
    return { ok: false, status: 409, error: 'The repository has no commit yet; make a first commit before starting a chat in a worktree.' };
  }
  const cap = clampCap(opts.cap);
  const live = await liveChatWorktrees(repoRoot, opts.dataDir);
  if (live.length >= cap) {
    return { ok: false, status: 409, error: `This repository already has ${live.length} chat worktrees, the limit set in Settings (${cap}). Merge or remove one first.` };
  }
  const sym = await git(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const baseBranch = sym.code === 0 && sym.stdout.trim() ? sym.stdout.trim() : null;

  fs.mkdirSync(root, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = hex(4, rand);
    const dir = path.join(root, id);
    const branch = `sequence/${chatSlug(opts.title)}-${hex(2, rand)}`;
    if (fs.existsSync(dir)) continue;
    const taken = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (taken.code === 0) continue;
    const added = await git(repoRoot, ['worktree', 'add', '-b', branch, '--', dir, baseCommit]);
    if (added.code !== 0) return { ok: false, status: 500, error: why(added, 'git worktree add failed') };
    const ref: ChatWorktreeRef = {
      id,
      path: fs.realpathSync(dir),
      branch,
      baseCommit,
      baseBranch,
      createdAt: (opts.now ?? (() => new Date()))().toISOString(),
    };
    return { ok: true, ref };
  }
  return { ok: false, status: 500, error: 'Could not pick an unused worktree name.' };
}

export function clampCap(cap: unknown): number {
  const n = typeof cap === 'number' && Number.isFinite(cap) ? Math.floor(cap) : DEFAULT_WORKTREE_CAP;
  return Math.min(MAX_WORKTREE_CAP, Math.max(1, n));
}

/* ─────────────────────────── changes ─────────────────────────── */

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

const STATUS: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', T: 'modified' };

function parseNameStatus(out: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^([AMDT])\t(.+)$/.exec(line);
    if (m && !m[2]!.startsWith('.sequence/')) files.push({ path: m[2]!, status: STATUS[m[1]!]! });
  }
  return files;
}

/**
 * Stage everything in `wt` except Sequence's own store. NOT an `:(exclude)`
 * pathspec: once `.sequence/` is ignored, naming it in a pathspec makes `git
 * add` refuse ("paths are ignored"). So `.sequence/` is kept in the local
 * exclude (the S3 rule), the add names `.` only, and anything of `.sequence/`
 * that still got in is taken back out of the index (never off the disk).
 */
async function stageAll(wt: string, env: Record<string, string> = {}): Promise<Proc> {
  await ensureSequenceIgnoredAsync(wt);
  const add = await git(wt, ['add', '-A', '--', '.'], env);
  if (add.code !== 0) return add;
  return git(wt, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.sequence'], env);
}

/**
 * The worktree's working state as a commit object, WITHOUT touching its
 * index, HEAD or any ref: a temporary index is filled from HEAD plus every
 * change (untracked files included, `.sequence/` excluded), written as a tree,
 * and wrapped in a commit no ref points at. When nothing changed, HEAD itself.
 */
export async function workingStateCommit(wt: string): Promise<{ ok: true; commit: string; dirty: boolean } | Refusal> {
  const headR = await git(wt, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (headR.code !== 0) return { ok: false, status: 500, error: why(headR, 'cannot read the worktree HEAD') };
  const head = headR.stdout.trim();
  const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-wt-index-')), 'index');
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    const read = await git(wt, ['read-tree', 'HEAD'], env);
    if (read.code !== 0) return { ok: false, status: 500, error: why(read, 'git read-tree failed') };
    const add = await stageAll(wt, env);
    if (add.code !== 0) return { ok: false, status: 500, error: why(add, 'git add failed') };
    const tree = await git(wt, ['write-tree'], env);
    const headTree = await git(wt, ['rev-parse', 'HEAD^{tree}']);
    if (tree.code !== 0) return { ok: false, status: 500, error: why(tree, 'git write-tree failed') };
    if (tree.stdout.trim() === headTree.stdout.trim()) return { ok: true, commit: head, dirty: false };
    /* A throwaway object: a fixed identity so a repo without one can still be
       dry-run. It is never on a ref, so it never reaches the user's history. */
    const who = { GIT_AUTHOR_NAME: 'Sequence dry run', GIT_AUTHOR_EMAIL: 'dry-run@sequence.invalid', GIT_COMMITTER_NAME: 'Sequence dry run', GIT_COMMITTER_EMAIL: 'dry-run@sequence.invalid' };
    const commit = await git(wt, ['commit-tree', tree.stdout.trim(), '-p', head, '-m', 'Sequence merge dry run'], who);
    if (commit.code !== 0) return { ok: false, status: 500, error: why(commit, 'git commit-tree failed') };
    return { ok: true, commit: commit.stdout.trim(), dirty: true };
  } finally {
    fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true });
  }
}

/** Files the chat changed against its base commit, uncommitted work included. */
export async function chatChanges(ref: ChatWorktreeRef): Promise<{ ok: true; files: ChangedFile[]; dirty: boolean } | Refusal> {
  const state = await workingStateCommit(ref.path);
  if (!state.ok) return state;
  const diff = await git(ref.path, ['diff', '--name-status', '--no-renames', ref.baseCommit, state.commit]);
  if (diff.code !== 0) return { ok: false, status: 500, error: why(diff, 'git diff failed') };
  return { ok: true, files: parseNameStatus(diff.stdout), dirty: state.dirty };
}

/** The unified diff of one path (or every path) the chat changed, against its base. */
export async function chatDiff(ref: ChatWorktreeRef, onlyPath?: string): Promise<{ ok: true; diff: string } | Refusal> {
  if (onlyPath !== undefined && (onlyPath.startsWith('-') || path.isAbsolute(onlyPath) || onlyPath.split(/[\\/]/).includes('..'))) {
    return { ok: false, status: 400, error: 'path must be relative to the repository' };
  }
  const state = await workingStateCommit(ref.path);
  if (!state.ok) return state;
  const d = await git(ref.path, ['diff', '--no-renames', ref.baseCommit, state.commit, ...(onlyPath ? ['--', onlyPath] : [])]);
  if (d.code !== 0) return { ok: false, status: 500, error: why(d, 'git diff failed') };
  return { ok: true, diff: d.stdout };
}

/* ─────────────────────────── merge ─────────────────────────── */

/** `git status --porcelain` lines of the main checkout (`.sequence/` is Sequence's, not the user's). */
async function uncommitted(repoRoot: string): Promise<string[]> {
  const s = await git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']);
  return s.stdout.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^.. \.sequence\//.test(l));
}

export interface DryRun {
  ok: true;
  /** The user's current branch, the merge target. */
  target: string;
  targetHead: string;
  /** Files the chat changed against its base commit. */
  files: ChangedFile[];
  /** Paths the merge would conflict on; empty when it is clean. */
  conflicts: string[];
  /** Does the worktree hold edits not yet committed on its branch? */
  worktreeDirty: boolean;
  /** Uncommitted changes in the main checkout: a merge is refused while there are any. */
  mainUncommitted: string[];
  /** How the conflicts were computed. */
  method: 'merge-tree' | 'throwaway-worktree';
}

export interface DryRunOptions {
  /** Force the pre-2.38 path (tests). */
  forceFallback?: boolean;
}

/** The merge, computed without changing anything. */
export async function dryRunMerge(repoRoot: string, ref: ChatWorktreeRef, opts: DryRunOptions = {}): Promise<DryRun | Refusal> {
  const sym = await git(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const target = sym.stdout.trim();
  if (sym.code !== 0 || !target) return { ok: false, status: 409, error: 'The main checkout is not on a branch, so there is nothing to merge into.' };
  const targetHead = (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const state = await workingStateCommit(ref.path);
  if (!state.ok) return state;
  const diff = await git(repoRoot, ['diff', '--name-status', '--no-renames', ref.baseCommit, state.commit]);
  if (diff.code !== 0) return { ok: false, status: 500, error: why(diff, 'git diff failed') };
  const files = parseNameStatus(diff.stdout);
  const useTree = !opts.forceFallback && hasMergeTreeWriteTree(await gitVersion());
  const conflicts = useTree ? await conflictsByMergeTree(repoRoot, target, state.commit) : await conflictsByThrowaway(repoRoot, target, state.commit);
  if (!Array.isArray(conflicts)) return conflicts;
  return {
    ok: true,
    target,
    targetHead,
    files,
    conflicts,
    worktreeDirty: state.dirty,
    mainUncommitted: await uncommitted(repoRoot),
    method: useTree ? 'merge-tree' : 'throwaway-worktree',
  };
}

async function conflictsByMergeTree(repoRoot: string, target: string, commit: string): Promise<string[] | Refusal> {
  const r = await git(repoRoot, ['merge-tree', '--write-tree', '--name-only', '--no-messages', target, commit]);
  if (r.code === 0) return [];
  if (r.code !== 1) return { ok: false, status: 500, error: why(r, 'git merge-tree failed') };
  /* Line 1 is the tree; the conflicted paths follow, up to the first blank line. */
  const lines = r.stdout.split(/\r?\n/).slice(1);
  const out: string[] = [];
  for (const l of lines) {
    if (l === '') break;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** git before 2.38: merge in a detached throwaway worktree, read the unmerged paths, remove it. */
async function conflictsByThrowaway(repoRoot: string, target: string, commit: string): Promise<string[] | Refusal> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-wt-dry-'));
  fs.rmSync(dir, { recursive: true, force: true });
  const add = await git(repoRoot, ['worktree', 'add', '--detach', '--', dir, target]);
  if (add.code !== 0) return { ok: false, status: 500, error: why(add, 'git worktree add failed') };
  const who = { GIT_AUTHOR_NAME: 'Sequence dry run', GIT_AUTHOR_EMAIL: 'dry-run@sequence.invalid', GIT_COMMITTER_NAME: 'Sequence dry run', GIT_COMMITTER_EMAIL: 'dry-run@sequence.invalid' };
  try {
    const m = await git(dir, ['merge', '--no-commit', '--no-ff', commit], who);
    if (m.code === 0) return [];
    const u = await git(dir, ['diff', '--name-only', '--diff-filter=U']);
    const paths = u.stdout.split(/\r?\n/).filter(Boolean);
    return paths.length ? paths : { ok: false, status: 500, error: why(m, 'git merge failed') };
  } finally {
    /* Ours, detached, and only ever holding the dry merge: --force is right here. */
    await git(repoRoot, ['worktree', 'remove', '--force', '--', dir]);
    /* Whatever is left of it goes here, patiently and without throwing: the
       throwaway is ours, so a directory Windows still holds must never fail
       the dry run the person asked for. */
    await removeDirPatiently(dir);
  }
}

export interface MergeResult {
  ok: true;
  mode: MergeMode;
  into: string;
  /** The main checkout's HEAD after the merge. */
  commit: string;
  /** The commit made on the worktree branch for its uncommitted edits, when there were any. */
  committedOnBranch?: string;
  files: ChangedFile[];
}

/**
 * Merge (or squash) the chat's work into the user's current branch. Refuses,
 * changing nothing, when the main checkout has uncommitted changes or the dry
 * run finds conflicts.
 */
export async function mergeChatWorktree(
  repoRoot: string,
  ref: ChatWorktreeRef,
  opts: { mode: MergeMode; message: string } & DryRunOptions,
): Promise<MergeResult | (Refusal & { conflicts?: string[]; uncommitted?: string[] })> {
  const dry = await dryRunMerge(repoRoot, ref, opts);
  if (!dry.ok) return dry;
  if (dry.mainUncommitted.length) {
    return { ok: false, status: 409, error: 'Your checkout has uncommitted changes; commit or stash them, then merge. Sequence never touches uncommitted work.', uncommitted: dry.mainUncommitted };
  }
  if (dry.conflicts.length) {
    return { ok: false, status: 409, error: `The merge would conflict in ${dry.conflicts.length} file${dry.conflicts.length === 1 ? '' : 's'}; nothing was changed. Resolve them in the chat's worktree first.`, conflicts: dry.conflicts };
  }
  if (!dry.files.length && !dry.worktreeDirty) {
    const ahead = await git(repoRoot, ['rev-list', '--count', `${dry.target}..${ref.branch}`]);
    if (ahead.stdout.trim() === '0') return { ok: false, status: 409, error: 'The chat changed nothing, so there is nothing to merge.' };
  }
  const message = opts.message.replace(/\r/g, '').trim() || `Work from ${ref.branch}`;

  let committedOnBranch: string | undefined;
  if (dry.worktreeDirty) {
    const add = await stageAll(ref.path);
    if (add.code !== 0) return { ok: false, status: 500, error: why(add, 'git add failed in the worktree') };
    /* The repo's configured identity, no trailers. */
    const c = await git(ref.path, ['commit', '-m', message]);
    if (c.code !== 0) return { ok: false, status: 500, error: why(c, 'git commit failed in the worktree') };
    committedOnBranch = (await git(ref.path, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  if (opts.mode === 'merge') {
    const m = await git(repoRoot, ['merge', '--no-ff', '-m', `Merge ${ref.branch}: ${message}`, '--', ref.branch]);
    if (m.code !== 0) {
      await git(repoRoot, ['merge', '--abort']);
      return { ok: false, status: 409, error: `git refused the merge and it was undone: ${why(m, 'git merge failed')}` };
    }
  } else {
    const s = await git(repoRoot, ['merge', '--squash', '--', ref.branch]);
    if (s.code !== 0) {
      /* The checkout was clean a moment ago, so --merge puts back exactly what the squash changed. */
      await git(repoRoot, ['reset', '--merge']);
      return { ok: false, status: 409, error: `git refused the squash and it was undone: ${why(s, 'git merge --squash failed')}` };
    }
    const c = await git(repoRoot, ['commit', '-m', message]);
    if (c.code !== 0) {
      await git(repoRoot, ['reset', '--merge']);
      return { ok: false, status: 500, error: `the squash could not be committed and was undone: ${why(c, 'git commit failed')}` };
    }
  }
  const commit = (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  return { ok: true, mode: opts.mode, into: dry.target, commit, ...(committedOnBranch ? { committedOnBranch } : {}), files: dry.files };
}

/* ─────────────────────────── remove ─────────────────────────── */

export interface UnmergedCommit {
  sha: string;
  subject: string;
}

/** Commits on the chat branch that the user's current branch does not contain. */
export async function unmergedCommits(repoRoot: string, ref: ChatWorktreeRef): Promise<UnmergedCommit[]> {
  const r = await git(repoRoot, ['log', '--format=%H%x09%s', `HEAD..${ref.branch}`, '--']);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha: sha!, subject: rest.join('\t') };
    });
}

export interface RemoveResult {
  ok: true;
  removedPath: string;
  deletedBranch: string;
  /** True when the branch held unmerged commits and the user confirmed deleting them. */
  forcedBranchDelete: boolean;
}

/**
 * A WINDOWS LOCK ON THE WORKTREE DIRECTORY, in git's own words.
 *
 * `git worktree remove` empties the tree and then deletes the directory itself.
 * On Windows that last step fails outright while anything still holds the
 * directory — a scanner, an editor, the agent that was working in it — and git
 * says "failed to delete '<path>': Permission denied". The user is then left
 * with a chat worktree Sequence refuses to remove (409), for a reason that has
 * nothing to do with their work.
 */
const LOCKED_REMOVAL = /permission denied|access is denied|being used by another process|resource busy/i;

/** What a locked directory answers with, on every platform. */
const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

/**
 * Remove a directory, WAITING for whatever holds it.
 *
 * The same shape as the repo's own patient teardown (`tools/measure/lib/
 * teardown.mjs`): the codes a lock answers with are retried with a doubling
 * backoff, and nothing is thrown at the caller. Node's own `fs.rmSync` retry
 * options do not cover this case — a directory that is in use answers EPERM
 * and the synchronous removal gives up on the first try — so the waiting is
 * done here, where it can be seen.
 */
async function removeDirPatiently(dir: string, opts: { retries?: number; delayMs?: number } = {}): Promise<boolean> {
  const retries = opts.retries ?? 5;
  const delayMs = opts.delayMs ?? 200;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return !fs.existsSync(dir);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!code || !LOCK_CODES.has(code)) return false;
      if (attempt <= retries) await new Promise((r) => setTimeout(r, delayMs * 2 ** (attempt - 1)));
    }
  }
  return !fs.existsSync(dir);
}

/**
 * Finish a removal git could not, when the only thing in the way was a lock.
 *
 * BY THE TIME GIT SAYS THIS IT HAS ALREADY UNREGISTERED THE WORKTREE: the
 * directory is the whole remainder, and nothing is left for git to do. So the
 * remainder is removed here, patiently — the user's click on Remove is
 * finished, not refused.
 *
 * ONLY A LOCK IS TAKEN OVER. A refusal — a dirty worktree, which git names
 * "contains modified or untracked files" — is a decision about the user's work,
 * not a lock, and it is reported exactly as it always was. git refuses a dirty
 * worktree BEFORE it deletes anything, so whatever is left here was already
 * clean: nothing uncommitted can be lost by removing it.
 */
async function clearLockedWorktree(dir: string, rm: Proc): Promise<boolean> {
  if (!LOCKED_REMOVAL.test(`${rm.stderr}\n${rm.stdout}`)) return false;
  if (!fs.existsSync(dir)) return true; /* git got there after all */
  return removeDirPatiently(dir);
}

/**
 * Remove a chat's worktree and its branch. Refuses when the branch holds
 * commits the user's branch does not have, unless `confirmUnmerged` lists
 * exactly those commits (the dialog named them); refuses a dirty worktree
 * (git's own refusal, no --force).
 */
export async function removeChatWorktree(
  repoRoot: string,
  dataDir: string,
  ref: ChatWorktreeRef,
  opts: { confirmUnmerged?: readonly string[]; /** Discard uncommitted edits too (best-of-N's "discard the others"). */ discardUncommitted?: boolean } = {},
): Promise<RemoveResult | (Refusal & { unmerged?: UnmergedCommit[] })> {
  const root = chatWorktreesRoot(dataDir);
  if (!within(ref.path, root) || path.resolve(ref.path) === path.resolve(root)) {
    return { ok: false, status: 403, error: 'That path is not a chat worktree Sequence made.' };
  }
  const live = await liveChatWorktrees(repoRoot, dataDir);
  const listed = live.some((w) => within(w.path, ref.path) && within(ref.path, w.path));
  const unmerged = await unmergedCommits(repoRoot, ref);
  const confirmed = new Set(opts.confirmUnmerged ?? []);
  const force = unmerged.length > 0 && unmerged.every((c) => confirmed.has(c.sha));
  if (unmerged.length > 0 && !force) {
    return {
      ok: false,
      status: 409,
      error: `The branch ${ref.branch} has ${unmerged.length} commit${unmerged.length === 1 ? '' : 's'} your branch does not have. Confirm to delete ${unmerged.length === 1 ? 'it' : 'them'}.`,
      unmerged,
    };
  }
  if (listed) {
    const rm = await git(repoRoot, opts.discardUncommitted ? ['worktree', 'remove', '--force', '--', ref.path] : ['worktree', 'remove', '--', ref.path]);
    /* A lock is not a refusal: the worktree goes, and so does the branch. */
    if (rm.code !== 0 && !(await clearLockedWorktree(ref.path, rm))) {
      return { ok: false, status: 409, error: `git kept the worktree: ${why(rm, 'git worktree remove failed')}` };
    }
  }
  /* THE REWIND HISTORY GOES WITH IT (coordinator ruling): rewinding a
     worktree that no longer exists has no target. The worktree's shadow git
     dir lives in `<wt>/.sequence/snapshots`, which git removes with the tree
     (it is ignored, not untracked); whatever a locked file left behind is
     removed here, inside the jail checked above, so nothing is orphaned under
     the data dir. */
  if (fs.existsSync(ref.path)) {
    fs.rmSync(path.join(ref.path, '.sequence'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    try {
      if (fs.readdirSync(ref.path).length === 0) fs.rmdirSync(ref.path);
    } catch {
      /* already gone */
    }
  }
  const del = await git(repoRoot, ['branch', force ? '-D' : '-d', '--', ref.branch]);
  const gone = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref.branch}`]);
  if (del.code !== 0 && gone.code === 0) {
    return { ok: false, status: 409, error: `The worktree was removed but git kept the branch: ${why(del, 'git branch -d failed')}` };
  }
  return { ok: true, removedPath: ref.path, deletedBranch: ref.branch, forcedBranchDelete: force };
}

/* ─────────────────────────── settings ─────────────────────────── */

export interface WorktreeSettings {
  /** Live chat worktrees allowed per repo. */
  cap: number;
  /** The per-repo setup command, or null (off, the default). Never run by Sequence. */
  setupCommand: string | null;
}

/** What the repo's lockfile suggests as a setup command; a suggestion only. */
export function suggestSetupCommand(repoRoot: string): string | null {
  const has = (f: string): boolean => fs.existsSync(path.join(repoRoot, f));
  if (has('pnpm-lock.yaml')) return 'pnpm install';
  if (has('yarn.lock')) return 'yarn install';
  if (has('package-lock.json')) return 'npm ci';
  if (has('bun.lockb') || has('bun.lock')) return 'bun install';
  if (has('uv.lock')) return 'uv sync';
  if (has('poetry.lock')) return 'poetry install';
  if (has('Cargo.lock')) return 'cargo fetch';
  if (has('go.sum')) return 'go mod download';
  return null;
}

const CAP_FILE = 'worktrees.json';
const SETUP_FILE = path.join('.sequence', 'worktree-setup.json');

export function readWorktreeSettings(dataDir: string, repoRoot: string | null): WorktreeSettings {
  let cap = DEFAULT_WORKTREE_CAP;
  try {
    cap = clampCap((JSON.parse(fs.readFileSync(path.join(dataDir, CAP_FILE), 'utf8')) as { cap?: unknown }).cap);
  } catch {
    /* default */
  }
  let setupCommand: string | null = null;
  if (repoRoot) {
    try {
      const v = (JSON.parse(fs.readFileSync(path.join(repoRoot, SETUP_FILE), 'utf8')) as { setupCommand?: unknown }).setupCommand;
      setupCommand = typeof v === 'string' && v.trim() ? v.trim() : null;
    } catch {
      /* off */
    }
  }
  return { cap, setupCommand };
}

/** Validate and save a partial update; returns the settings now in force or a 400. */
export function writeWorktreeSettings(
  dataDir: string,
  repoRoot: string | null,
  patch: unknown,
): { ok: true; settings: WorktreeSettings } | Refusal {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, status: 400, error: 'Body must be a JSON object.' };
  const p = patch as Record<string, unknown>;
  if ('cap' in p) {
    if (typeof p.cap !== 'number' || !Number.isInteger(p.cap) || p.cap < 1 || p.cap > MAX_WORKTREE_CAP) {
      return { ok: false, status: 400, error: `"cap" must be a whole number from 1 to ${MAX_WORKTREE_CAP}.` };
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, CAP_FILE), `${JSON.stringify({ cap: p.cap }, null, 2)}\n`);
  }
  if ('setupCommand' in p) {
    const v = p.setupCommand;
    if (v !== null && (typeof v !== 'string' || v.length > 500 || /[\r\n]/.test(v))) {
      return { ok: false, status: 400, error: '"setupCommand" must be one line of at most 500 characters, or null.' };
    }
    if (!repoRoot) return { ok: false, status: 400, error: 'Attach a repository to set its setup command.' };
    const file = path.join(repoRoot, SETUP_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ setupCommand: typeof v === 'string' && v.trim() ? v.trim() : null }, null, 2)}\n`);
  }
  return { ok: true, settings: readWorktreeSettings(dataDir, repoRoot) };
}

/* For prFlow.ts: the same git runner (no GIT_* from the environment, no prompts) and the same staging rule (`.sequence/` never committed). */
export const runGit = git;
export const stageWorktree = stageAll;
export const gitWhy = why;

/**
 * True when `candidate` is a worktree this repo really manages: it lies under Sequence's own worktree folder
 * (`<data>/wt`) or `git worktree list --porcelain` for `repoRoot` names it. Judged on real paths, so a
 * symlink or a path written into a session index by hand cannot widen a file jail.
 */
export async function isManagedWorktree(repoRoot: string, dataDirs: string[], candidate: string): Promise<boolean> {
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return false;
  }
  const inside = (parent: string): boolean => {
    let p: string;
    try {
      p = fs.realpathSync(parent);
    } catch {
      return false;
    }
    const rel = path.relative(p, real);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (dataDirs.some((d) => inside(chatWorktreesRoot(d)))) return true;
  const r = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) return false;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const w = line.slice('worktree '.length);
    if (!path.isAbsolute(w)) continue;
    try {
      if (fs.realpathSync(w) === real) return true;
    } catch {
      /* a listed worktree that is gone */
    }
  }
  return false;
}
