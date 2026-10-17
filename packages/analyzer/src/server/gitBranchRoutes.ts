import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import {
  defaultBaseRef,
  isValidBranchName,
  resolveCommit,
  runGit,
  GitWorkspaceError,
} from './gitWorkspace.js';
import { resolveGitDirs, type GitDirs } from './repoWatch.js';

/**
 * Branch workflow for the git interface: list, switch, per-branch file status,
 * and the HEAD tracker that keeps the architecture board in step with whatever
 * branch is checked out.
 *
 * SAFETY. Every git call is `spawn('git', argv)` with a fixed argv, never a
 * shell. A caller-supplied branch name is validated twice (`isValidBranchName`,
 * then `git check-ref-format --branch`) and arrives after `--`. `git switch` is
 * run WITHOUT `--force`/`--discard-changes`/`--merge`, so git itself refuses to
 * overwrite local changes; this module only reports what git refused.
 */

/** Sequence's own runtime tree (`.sequence/`): never a user change worth a symbol. */
export function isSequenceRuntimePath(p: string): boolean {
  return p === '.sequence' || p.startsWith('.sequence/');
}

/* ═══ branches ════════════════════════════════════════════════════════════ */

export interface BranchCommit {
  sha: string;
  subject: string;
  /** ISO 8601 committer date. */
  date: string;
}

export interface BranchInfo {
  name: string;
  upstream?: string;
  /** Commits on this branch that `against` does not have. */
  ahead: number;
  /** Commits on `against` that this branch does not have. */
  behind: number;
  /** What ahead/behind count against: the upstream when it has one, else the default branch. */
  against?: string;
  lastCommit: BranchCommit;
}

export interface RemoteBranchInfo {
  /** `origin/feature`. */
  name: string;
  remote: true;
  lastCommit: BranchCommit;
}

export interface GitBranchesResult {
  /** Checked-out branch, or null when HEAD is detached / unborn. */
  current: string | null;
  detached: boolean;
  /** HEAD's commit (null in a repo with no commits). */
  sha: string | null;
  branches: BranchInfo[];
  /** Remote branches with no local branch of the same name. */
  remoteBranches: RemoteBranchInfo[];
  /** Number of files `git status` reports (staged, unstaged or untracked). */
  dirty: number;
}

const FIELD = '\x00';
const RECORD = '\x1e';

function parseTrack(track: string): { ahead: number; behind: number } | null {
  if (track === '') return { ahead: 0, behind: 0 };
  if (/gone/.test(track)) return null;
  const a = /ahead (\d+)/.exec(track);
  const b = /behind (\d+)/.exec(track);
  return { ahead: a ? Number(a[1]) : 0, behind: b ? Number(b[1]) : 0 };
}

/** `refs/heads` + `refs/remotes`, parsed from one for-each-ref call. */
async function readRefs(root: string, refs: string, signal?: AbortSignal): Promise<string[][]> {
  const fmt = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:iso-strict)', '%(contents:subject)'].join('%00') + '%1e';
  const r = await runGit(root, ['for-each-ref', `--format=${fmt}`, refs], undefined, signal);
  if (r.code !== 0) return [];
  return r.stdout
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec !== '')
    .map((rec) => rec.split(FIELD));
}

/**
 * ONE reading of HEAD, shared by the routes and the tracker.
 *
 * `symbolic-ref --quiet HEAD` and strip `refs/heads/`: NOT `--short`, which
 * prints `heads/v1` when a tag named v1 exists beside the branch. Run through
 * git (never by reading `<root>/.git`) so an attached SUBDIRECTORY of a repo,
 * a linked worktree and a `.git` file all resolve.
 */
function parseHead(symbolicRef: string, sha: string): { branch: string | null; detached: boolean; sha: string | null } {
  const ref = symbolicRef.trim();
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
  const full = /^[0-9a-f]{40,64}$/.test(sha.trim()) ? sha.trim() : null;
  return { branch, detached: branch === null && full !== null, sha: full };
}

export async function headState(root: string): Promise<{ branch: string | null; detached: boolean; sha: string | null }> {
  const sym = await runGit(root, ['symbolic-ref', '--quiet', 'HEAD']);
  const sha = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return parseHead(sym.code === 0 ? sym.stdout : '', sha.code === 0 ? sha.stdout : '');
}

/** Where `root` sits in its repository (it may be a subdirectory of the work tree). */
export interface GitLayout {
  top: string;
  /** `app/` when root is <top>/app, '' at the top. */
  prefix: string;
}

export async function gitLayout(root: string): Promise<GitLayout | null> {
  const r = await runGit(root, ['rev-parse', '--show-toplevel', '--show-prefix']);
  if (r.code !== 0) return null;
  const lines = r.stdout.split(/\r?\n/);
  return { top: (lines[0] ?? '').trim(), prefix: (lines[1] ?? '').trim() };
}

export interface GitBranchesOptions {
  /** Aborting (client hang-up) kills the git children once no other caller waits on the same work. */
  signal?: AbortSignal;
  /** Test seam: 'off' behaves like a git without the `ahead-behind` atom (git < 2.41). */
  aheadBehind?: 'auto' | 'off';
  /**
   * The HTTP route sets this: a slow `git status` (big work tree) is then answered from the last
   * count and refreshed in the background. Off by default, so a direct call always counts fresh.
   */
  staleDirty?: boolean;
}

/** Fallback only: at most this many `rev-list` children at once, for at most this many branches, for at most this long. */
const FALLBACK_CONCURRENCY = 8;
const FALLBACK_MAX_BRANCHES = 120;
const FALLBACK_BUDGET_MS = 8_000;
/**
 * When `git status` itself took longer than DIRTY_SLOW_MS (a big work tree) the count is reused
 * while no ref, HEAD or index file changed, and once it is DIRTY_TTL_MS old it is refreshed in the
 * background: the listing must not wait on a status walk. Smaller repos always get a fresh count.
 */
const DIRTY_TTL_MS = 1_000;
const DIRTY_SLOW_MS = 150;

interface BranchData {
  state: { branch: string | null; detached: boolean; sha: string | null };
  branches: BranchInfo[];
  remoteBranches: RemoteBranchInfo[];
}

const dirsByRoot = new Map<string, GitDirs>();
const layoutByRoot = new Map<string, GitLayout>();
const dataCache = new Map<string, { fp: string; data: BranchData }>();
const dirtyCache = new Map<string, { key: string; at: number; value: number; ms: number; refreshing: boolean }>();
const inflightBranches = new Map<string, { promise: Promise<GitBranchesResult>; ac: AbortController; waiters: number }>();

/** Test hook: forget every cached branch listing. */
export function resetGitBranchesCache(): void {
  dataCache.clear();
  dirtyCache.clear();
  dirsByRoot.clear();
  layoutByRoot.clear();
}

async function cachedLayout(root: string): Promise<GitLayout | null> {
  const hit = layoutByRoot.get(root);
  if (hit !== undefined) return hit;
  const l = await gitLayout(root);
  if (l !== null) layoutByRoot.set(root, l);
  return l;
}

async function statSig(p: string): Promise<string> {
  try {
    const s = await fs.promises.stat(p);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'x';
  }
}

async function walkRefs(dir: string, rel: string, out: Promise<string>[]): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  out.push(statSig(dir).then((s) => `${rel}/:${s}`));
  if (out.length > 20_000) return false;
  const subs: Promise<boolean>[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) subs.push(walkRefs(abs, `${rel}/${e.name}`, out));
    else out.push(statSig(abs).then((s) => `${rel}/${e.name}:${s}`));
  }
  return (await Promise.all(subs)).every(Boolean);
}

/**
 * A fingerprint of everything the branch listing reads: HEAD, packed-refs,
 * config and every ref file (name + mtime + size). Plain `stat` calls, no git
 * child. Null when it cannot be trusted (not a git checkout, a reftable repo).
 */
async function refsFingerprint(root: string): Promise<{ fp: string; indexSig: string } | null> {
  let dirs = dirsByRoot.get(root);
  if (dirs === undefined) {
    const d = await resolveGitDirs(root);
    if (d === null) return null;
    dirs = d;
    dirsByRoot.set(root, d);
  }
  const parts: Promise<string>[] = [];
  const ok = await walkRefs(path.join(dirs.commonDir, 'refs'), 'refs', parts);
  if (!ok || parts.length === 0) return null;
  const [head, packed, config, index, refs] = await Promise.all([
    statSig(path.join(dirs.gitDir, 'HEAD')),
    statSig(path.join(dirs.commonDir, 'packed-refs')),
    statSig(path.join(dirs.commonDir, 'config')),
    statSig(path.join(dirs.gitDir, 'index')),
    Promise.all(parts),
  ]);
  const hash = createHash('sha1');
  hash.update([head, packed, config, ...refs.sort()].join('\n'));
  return { fp: hash.digest('hex'), indexSig: index };
}

function parseAheadBehind(s: string | undefined): { ahead: number; behind: number } | null {
  const m = /^(\d+)\s+(\d+)$/.exec((s ?? '').trim());
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}

/** One `for-each-ref`: local branches plus, when `base` is given, `%(ahead-behind:<base>)` as the 7th field. */
async function readLocalRefs(root: string, base: string | null, signal: AbortSignal): Promise<string[][] | null> {
  const fields = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:iso-strict)', '%(contents:subject)'];
  if (base !== null) fields.push(`%(ahead-behind:${base})`);
  const r = await runGit(root, ['for-each-ref', `--format=${fields.join('%00')}%1e`, 'refs/heads'], undefined, signal);
  if (r.code !== 0) return null;
  return r.stdout
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec !== '')
    .map((rec) => rec.split(FIELD));
}

/** Old git (no `ahead-behind` atom): bounded `rev-list` fan-out, newest branches first, under a time budget. */
async function fallbackCounts(
  root: string,
  base: string,
  names: string[],
  signal: AbortSignal,
): Promise<Map<string, { ahead: number; behind: number }>> {
  const out = new Map<string, { ahead: number; behind: number }>();
  const queue = names.slice(0, FALLBACK_MAX_BRANCHES);
  const deadline = Date.now() + FALLBACK_BUDGET_MS;
  const worker = async (): Promise<void> => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      if (Date.now() > deadline || signal.aborted) return;
      const lr = await runGit(root, ['rev-list', '--left-right', '--count', `${base}...refs/heads/${n}`], undefined, signal);
      const m = /^(\d+)\s+(\d+)/.exec(lr.stdout.trim());
      if (lr.code === 0 && m) out.set(n, { ahead: Number(m[2]), behind: Number(m[1]) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FALLBACK_CONCURRENCY, queue.length) }, worker));
  return out;
}

async function computeBranchData(root: string, signal: AbortSignal, mode: 'auto' | 'off'): Promise<BranchData> {
  const [state, base] = await Promise.all([headState(root), defaultBaseRef(root)]);
  const useAtom = mode === 'auto' && base !== 'HEAD';
  const remotesP = readRefs(root, 'refs/remotes', signal);
  let locals: string[][] | null = useAtom ? await readLocalRefs(root, base, signal) : null;
  const atomWorked = locals !== null;
  if (locals === null) locals = (await readLocalRefs(root, null, signal)) ?? [];
  const remotes = await remotesP;

  const rows = locals.map((f) => ({ f, name: (f[0] ?? '').replace(/^refs\/heads\//, '') })).filter((x) => x.name !== '');
  let fallback = new Map<string, { ahead: number; behind: number }>();
  if (!atomWorked && base !== 'HEAD') {
    const need = rows
      .filter((x) => (x.f[2] ?? '') === '' || parseTrack(x.f[3] ?? '') === null)
      .filter((x) => x.name !== base)
      .sort((a, b) => (b.f[4] ?? '').localeCompare(a.f[4] ?? ''))
      .map((x) => x.name);
    fallback = await fallbackCounts(root, base, need, signal);
  }

  const branches: BranchInfo[] = [];
  for (const { f, name } of rows) {
    const upstream = f[2] ?? '';
    let counts: { ahead: number; behind: number } | null = null;
    let against: string | undefined;
    if (upstream !== '') {
      counts = parseTrack(f[3] ?? '');
      against = upstream;
    }
    if (counts === null && name !== base && base !== 'HEAD') {
      const c = atomWorked ? parseAheadBehind(f[6]) : (fallback.get(name) ?? null);
      if (c !== null) {
        counts = c;
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
  const localNames = new Set(branches.map((b) => b.name));
  const remoteBranches: RemoteBranchInfo[] = [];
  for (const f of remotes) {
    const full = (f[0] ?? '').replace(/^refs\/remotes\//, '');
    if (full === '' || /\/HEAD$/.test(full)) continue;
    const slash = full.indexOf('/');
    if (slash < 0) continue;
    if (localNames.has(full.slice(slash + 1))) continue;
    remoteBranches.push({ name: full, remote: true, lastCommit: { sha: f[1] ?? '', date: f[4] ?? '', subject: f[5] ?? '' } });
  }
  return { state, branches, remoteBranches };
}

async function timedDirty(root: string, signal?: AbortSignal): Promise<{ value: number; ms: number }> {
  const t0 = Date.now();
  const value = await countDirty(root, signal);
  return { value, ms: Date.now() - t0 };
}

async function computeGitBranches(root: string, signal: AbortSignal, mode: 'auto' | 'off', staleDirty: boolean): Promise<GitBranchesResult> {
  // Start every git child that a cache miss would need AT ONCE (the fingerprint is stat-only and
  // cheap); a hit simply never awaits them. A cold call costs the slowest child, not their sum.
  const prev = dataCache.get(root);
  const prevDirty = dirtyCache.get(root);
  const fprP = refsFingerprint(root);
  const dataP = prev === undefined ? computeBranchData(root, signal, mode) : null;
  const dirtyP = prevDirty === undefined ? timedDirty(root, signal) : null;
  dataP?.catch(() => undefined);
  dirtyP?.catch(() => undefined);
  const fpr = await fprP;

  let data: BranchData;
  if (fpr !== null && prev !== undefined && prev.fp === fpr.fp) {
    data = prev.data;
  } else {
    data = await (dataP ?? computeBranchData(root, signal, mode));
    if (signal.aborted) throw new Error('aborted');
    if (fpr !== null) dataCache.set(root, { fp: fpr.fp, data });
  }
  let dirty: number;
  const dkey = fpr === null ? '' : `${fpr.fp}|${fpr.indexSig}`;
  const sameKey = fpr !== null && prevDirty !== undefined && prevDirty.key === dkey;
  const age = prevDirty === undefined ? Infinity : Date.now() - prevDirty.at;
  if (staleDirty && sameKey && prevDirty!.ms > DIRTY_SLOW_MS) {
    // A slow status (big work tree) is never awaited twice: reuse the count, refresh once it is stale.
    dirty = prevDirty!.value;
    if (age >= DIRTY_TTL_MS && !prevDirty!.refreshing) {
      prevDirty!.refreshing = true;
      void timedDirty(root)
        .then((d) => dirtyCache.set(root, { key: dkey, at: Date.now(), value: d.value, ms: d.ms, refreshing: false }))
        .catch(() => {
          prevDirty!.refreshing = false;
        });
    }
  } else {
    const d = await (dirtyP ?? timedDirty(root, signal));
    if (signal.aborted) throw new Error('aborted');
    dirty = d.value;
    if (fpr !== null) dirtyCache.set(root, { key: dkey, at: Date.now(), value: d.value, ms: d.ms, refreshing: false });
  }
  return { current: data.state.branch, detached: data.state.detached, sha: data.state.sha, branches: data.branches, remoteBranches: data.remoteBranches, dirty };
}

/**
 * The branch listing. ONE `for-each-ref` carries every ahead/behind count
 * (`%(ahead-behind:<base>)`), the result is cached per refs fingerprint,
 * concurrent callers share one computation, and the git children are killed
 * when every caller has gone away.
 */
export function gitBranches(root: string, opts: GitBranchesOptions = {}): Promise<GitBranchesResult> {
  const mode = opts.aheadBehind ?? 'auto';
  const stale = opts.staleDirty === true;
  const key = `${root}\0${mode}\0${stale ? 's' : 'f'}`;
  let entry = inflightBranches.get(key);
  if (entry === undefined) {
    const ac = new AbortController();
    const promise: Promise<GitBranchesResult> = computeGitBranches(root, ac.signal, mode, stale).finally(() => {
      if (inflightBranches.get(key) === created) inflightBranches.delete(key);
    });
    promise.catch(() => undefined); /* every waiter handles its own copy; this keeps an all-aborted run from being 'unhandled' */
    const created = { promise, ac, waiters: 0 };
    entry = created;
    inflightBranches.set(key, created);
  }
  const shared = entry;
  shared.waiters++;
  const signal = opts.signal;
  return new Promise<GitBranchesResult>((resolve, reject) => {
    let done = false;
    const leave = (): void => {
      done = true;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (done) return;
      leave();
      if (--shared.waiters === 0) shared.ac.abort();
      reject(new Error('aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      (v) => {
        if (done) return;
        leave();
        resolve(v);
      },
      (e) => {
        if (done) return;
        leave();
        reject(e);
      },
    );
  });
}

/** Dirty files under the attached root (staged, unstaged, untracked), without `.sequence/`. */
async function countDirty(root: string, signal?: AbortSignal): Promise<number> {
  const [r, layout] = await Promise.all([
    runGit(root, ['status', '--porcelain=v1', '-z', '--no-renames', '--', '.'], undefined, signal),
    cachedLayout(root),
  ]);
  if (r.code !== 0) return 0;
  const prefix = layout?.prefix ?? '';
  let n = 0;
  for (const rec of r.stdout.split('\0')) {
    if (rec.length < 4) continue;
    let p = rec.slice(3);
    if (prefix !== '' && p.startsWith(prefix)) p = p.slice(prefix.length);
    if (!isSequenceRuntimePath(p)) n++;
  }
  return n;
}

/* ═══ switch ══════════════════════════════════════════════════════════════ */

export interface GitSwitchRequest {
  branch: unknown;
  create?: unknown;
  from?: unknown;
}

export type GitSwitchResult =
  | { ok: true; status: 200; branch: string; sha: string | null; created: boolean; changed: boolean; previous: string | null }
  | { ok: false; status: number; reason: 'dirty' | 'invalid' | 'exists' | 'not-found' | 'git'; error: string; files?: string[] };

/** File names git lists under "would be overwritten" (tab-indented lines). */
export function parseOverwriteFiles(stderr: string): string[] {
  const files: string[] = [];
  let inList = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (/would be overwritten/.test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      if (line.startsWith('\t')) files.push(line.slice(1).trim().replace(/\\/g, '/'));
      else inList = false;
    }
  }
  return files;
}

const LOCALE_C = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };

export async function gitSwitch(root: string, req: GitSwitchRequest): Promise<GitSwitchResult> {
  const name = req.branch;
  if (typeof name !== 'string' || !isValidBranchName(name)) {
    return { ok: false, status: 400, reason: 'invalid', error: 'branch is not a valid branch name' };
  }
  const fmt = await runGit(root, ['check-ref-format', '--branch', name]);
  if (fmt.code !== 0) {
    return { ok: false, status: 400, reason: 'invalid', error: `git rejected the branch name: ${name}` };
  }
  if (req.create !== undefined && typeof req.create !== 'boolean') {
    return { ok: false, status: 400, reason: 'invalid', error: '"create" must be a boolean when present' };
  }
  const create = req.create === true;
  if (req.from !== undefined && !create) {
    return { ok: false, status: 400, reason: 'invalid', error: '"from" is only valid with create' };
  }

  if (create && name.startsWith('refs/')) {
    return { ok: false, status: 400, reason: 'invalid', error: "a new branch name must not begin with 'refs/'" };
  }
  const before = await headState(root);
  const local = await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  const exists = local.code === 0 && local.stdout.trim() !== '';

  if (create && exists) {
    return { ok: false, status: 409, reason: 'exists', error: `branch '${name}' already exists` };
  }
  if (!create && exists && before.branch === name) {
    return { ok: true, status: 200, branch: name, sha: before.sha, created: false, changed: false, previous: name };
  }
  if (!create && !exists) {
    /* `git switch <name>` can DWIM a remote-tracking branch into a local one;
       allow exactly that and nothing else. */
    const remotes = await runGit(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes']);
    const hit = remotes.stdout.split(/\r?\n/).some((r) => /^refs\/remotes\/[^/]+\//.test(r) && r.replace(/^refs\/remotes\/[^/]+\//, '') === name);
    if (!hit) return { ok: false, status: 404, reason: 'not-found', error: `no branch named '${name}'` };
  }

  let argv: string[];
  if (create) {
    argv = ['switch', '-c', name];
    if (req.from !== undefined) {
      if (typeof req.from !== 'string') {
        return { ok: false, status: 400, reason: 'invalid', error: '"from" must be a non-empty string when present' };
      }
      try {
        argv.push(await resolveCommit(root, req.from, 'from'));
      } catch (e) {
        if (e instanceof GitWorkspaceError) return { ok: false, status: e.status, reason: 'invalid', error: e.message };
        throw e;
      }
    }
  } else {
    argv = ['switch', '--', name];
  }

  const r = await runGit(root, argv, LOCALE_C);
  if (r.code !== 0) {
    const prefix = (await gitLayout(root))?.prefix ?? '';
    const files = parseOverwriteFiles(r.stderr).map((f) => (prefix !== '' && f.startsWith(prefix) ? f.slice(prefix.length) : f));
    if (files.length > 0 || /would be overwritten/.test(r.stderr)) {
      return { ok: false, status: 409, reason: 'dirty', error: 'local changes would be overwritten by the switch', files };
    }
    const msg = (r.stderr || r.stdout || '').trim();
    return { ok: false, status: 409, reason: 'git', error: msg || `git switch failed (exit ${r.code ?? r.signal})` };
  }
  const after = await headState(root);
  return { ok: true, status: 200, branch: after.branch ?? name, sha: after.sha, created: create, changed: true, previous: before.branch };
}

/* ═══ per-branch file status ══════════════════════════════════════════════ */

export type ChangeStatus = 'A' | 'M' | 'D' | 'R';

export interface FileChange {
  status: ChangeStatus;
  added: number;
  removed: number;
  binary?: true;
}

export interface BranchChangeFile {
  path: string;
  /** Source path when status is R. */
  oldPath?: string;
  /** Status of merge-base -> working tree (untracked files are A). */
  status: ChangeStatus;
  /** +/- of merge-base -> working tree (0/0 for an untracked file: not counted). */
  added: number;
  removed: number;
  binary?: true;
  /** merge-base -> HEAD: what is committed on this branch. */
  committed?: FileChange;
  /** HEAD -> index. */
  staged?: FileChange;
  /** index -> working tree. */
  unstaged?: FileChange;
  untracked?: true;
}

export interface BranchChangesResult {
  branch: string | null;
  /** Ref the merge base was taken against, or null when there is none. */
  base: string | null;
  mergeBase: string | null;
  head: string | null;
  /** True when no usable base exists; `files` then only describe the working tree against HEAD. */
  noBase?: true;
  files: BranchChangeFile[];
}

function letter(code: string): ChangeStatus {
  switch (code[0]) {
    case 'A':
    case 'C':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    default:
      return 'M';
  }
}

interface RawChange extends FileChange {
  path: string;
  oldPath?: string;
}

/** `git diff <args>` as name-status + numstat (both -z, rename-aware), keyed by destination path. */
async function diffSet(root: string, args: string[]): Promise<Map<string, RawChange>> {
  const out = new Map<string, RawChange>();
  const ns = await runGit(root, ['diff', '--relative', '--name-status', '-M', '-z', '--no-color', ...args]);
  if (ns.code !== 0) return out;
  const t = ns.stdout.split('\0');
  for (let i = 0; i < t.length; ) {
    const code = t[i++] ?? '';
    if (code === '') continue;
    if (code[0] === 'R' || code[0] === 'C') {
      const from = t[i++] ?? '';
      const to = t[i++] ?? '';
      out.set(to, { path: to, ...(code[0] === 'R' ? { oldPath: from } : {}), status: letter(code), added: 0, removed: 0 });
    } else {
      const p = t[i++] ?? '';
      out.set(p, { path: p, status: letter(code), added: 0, removed: 0 });
    }
  }
  const nu = await runGit(root, ['diff', '--relative', '--numstat', '-M', '-z', '--no-color', ...args]);
  if (nu.code === 0) {
    const u = nu.stdout.split('\0');
    for (let i = 0; i < u.length; ) {
      const tok = u[i] ?? '';
      const m = /^(\S+)\t(\S+)\t([\s\S]*)$/.exec(tok);
      if (!m) {
        i++;
        continue;
      }
      let dest = m[3] ?? '';
      if (dest === '') {
        dest = u[i + 2] ?? '';
        i += 3;
      } else {
        i += 1;
      }
      const entry = out.get(dest);
      if (!entry) continue;
      if (m[1] === '-' || m[2] === '-') entry.binary = true;
      else {
        entry.added = Number(m[1]);
        entry.removed = Number(m[2]);
      }
    }
  }
  return out;
}

function toChange(c: RawChange): FileChange {
  return { status: c.status, added: c.added, removed: c.removed, ...(c.binary ? { binary: true as const } : {}) };
}

/** Untracked, non-ignored files under `root` (paths relative to it), as A. */
async function addUntracked(root: string, files: Map<string, BranchChangeFile>): Promise<void> {
  const untr = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untr.code !== 0) return;
  for (const p of untr.stdout.split('\0')) {
    if (p === '') continue;
    let f = files.get(p);
    if (!f) {
      f = { path: p, status: 'A', added: 0, removed: 0 };
      files.set(p, f);
    }
    f.status = 'A';
    f.untracked = true;
  }
}

function sortFiles(files: Map<string, BranchChangeFile>): BranchChangeFile[] {
  return [...files.values()].filter((f) => !isSequenceRuntimePath(f.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function gitBranchChanges(root: string, requestedBase?: string): Promise<BranchChangesResult> {
  const state = await headState(root);
  const headSha = state.sha;
  if (headSha === null) {
    /* UNBORN: no commit yet, so everything in the index and the tree is new. */
    const [staged, unstaged] = await Promise.all([diffSet(root, ['--cached', '--']), diffSet(root, ['--'])]);
    const files = new Map<string, BranchChangeFile>();
    for (const c of staged.values()) {
      files.set(c.path, { path: c.path, status: 'A', added: c.added, removed: c.removed, ...(c.binary ? { binary: true as const } : {}), staged: toChange({ ...c, status: 'A' }) });
    }
    for (const c of unstaged.values()) {
      const f = files.get(c.path);
      if (f) f.unstaged = toChange(c);
    }
    await addUntracked(root, files);
    return { branch: state.branch, base: null, mergeBase: null, head: null, noBase: true, files: sortFiles(files) };
  }
  let baseRef: string | null = null;
  let mergeBase: string | null = null;
  const wanted = requestedBase !== undefined && requestedBase !== '' ? requestedBase : await defaultBaseRef(root);
  if (wanted.startsWith('-')) throw new GitWorkspaceError(400, "base must not begin with '-'");
  const baseSha = await resolveCommit(root, wanted, 'base').catch((e: unknown) => {
    if (requestedBase !== undefined && requestedBase !== '') throw e;
    return null;
  });
  if (baseSha) {
    const mb = await runGit(root, ['merge-base', baseSha, 'HEAD']);
    if (mb.code === 0 && mb.stdout.trim() !== '') {
      baseRef = wanted;
      mergeBase = mb.stdout.trim();
    }
  }
  const ref = mergeBase ?? headSha;
  const [total, committed, staged, unstaged] = await Promise.all([
    diffSet(root, [ref, '--']),
    mergeBase ? diffSet(root, [mergeBase, 'HEAD', '--']) : Promise.resolve(new Map<string, RawChange>()),
    diffSet(root, ['--cached', 'HEAD', '--']),
    diffSet(root, ['--']),
  ]);
  const files = new Map<string, BranchChangeFile>();
  const get = (p: string, seed: RawChange): BranchChangeFile => {
    let f = files.get(p);
    if (!f) {
      f = { path: p, status: seed.status, added: 0, removed: 0 };
      files.set(p, f);
    }
    return f;
  };
  for (const c of total.values()) {
    const f = get(c.path, c);
    f.status = c.status;
    f.added = c.added;
    f.removed = c.removed;
    if (c.binary) f.binary = true;
    if (c.oldPath !== undefined) f.oldPath = c.oldPath;
  }
  for (const c of committed.values()) get(c.path, c).committed = toChange(c);
  for (const c of staged.values()) get(c.path, c).staged = toChange(c);
  for (const c of unstaged.values()) get(c.path, c).unstaged = toChange(c);
  await addUntracked(root, files);
  const list = sortFiles(files);
  return {
    branch: state.branch,
    base: baseRef,
    mergeBase,
    head: headSha,
    ...(mergeBase === null ? { noBase: true as const } : {}),
    files: list,
  };
}

/* ═══ events + HEAD tracker ═══════════════════════════════════════════════ */

export interface GitHeadEvent {
  type: 'git:head';
  branch: string | null;
  sha: string | null;
  detached: boolean;
  previous: { branch: string | null; sha: string | null };
  /** True when this change started an architecture rescan (a branch change; a plain commit does not). */
  rescan: boolean;
}

export interface GraphUpdatedEvent {
  type: 'graph:updated';
  reason: 'git:head' | 'rescan';
  branch: string | null;
  sha: string | null;
  scannedAt?: string;
}

export type GitServerEvent = GitHeadEvent | GraphUpdatedEvent;

/** Server-sent-event fan-out for `GET /api/git/events`. */
export class GitEventHub {
  private readonly clients = new Set<http.ServerResponse>();
  private readonly owners = new Map<http.ServerResponse, string | null>();

  get size(): number {
    return this.clients.size;
  }

  attach(req: http.IncomingMessage, res: http.ServerResponse, owner: string | null = null): void {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders();
    res.write(': git events\n\n');
    this.clients.add(res);
    this.owners.set(res, owner);
    const drop = (): void => {
      this.clients.delete(res);
      this.owners.delete(res);
    };
    req.on('close', drop);
    res.on('close', drop);
  }

  emit(ev: GitServerEvent): void {
    const frame = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const c of this.clients) {
      try {
        c.write(frame);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  /**
   * Hosted mode: when the repo is re-attached to a new owner, end every stream
   * that belongs to someone else. `null` (unowned, local) keeps everyone.
   */
  dropNotOwnedBy(owner: string | null): void {
    if (owner === null) return;
    for (const c of [...this.clients]) {
      if (this.owners.get(c) === owner) continue;
      try {
        c.end();
      } catch {
        /* gone */
      }
      this.clients.delete(c);
      this.owners.delete(c);
    }
  }

  closeAll(): void {
    for (const c of this.clients) {
      try {
        c.end();
      } catch {
        /* gone */
      }
    }
    this.clients.clear();
    this.owners.clear();
  }
}

export interface HeadTrackerOptions {
  /** Absolute attached root, or null when detached. */
  getRoot: () => string | null;
  /** Start the SAME rescan POST /api/scan does; resolves with the new graph's scannedAt when known. */
  rescan: (root: string) => Promise<string | undefined>;
  emit: (ev: GitServerEvent) => void;
  onError?: (e: unknown) => void;
  /** Tests: how HEAD is read. Defaults to git. */
  /** Tests: a cheap synchronous fingerprint of HEAD (default: the contents of the HEAD file). */
  fingerprint?: (root: string) => string | null;
  readHead?: (root: string) => Promise<{ branch: string | null; detached: boolean; sha: string | null }>;
}

interface HeadSnapshot {
  branch: string | null;
  sha: string | null;
}

/** The contents of the repository's HEAD file (follows a linked worktree's `.git` file), or null when unreadable. */
export function headFileFingerprint(root: string): string | null {
  try {
    const dotGit = path.join(root, '.git');
    let gitDir = dotGit;
    if (fs.statSync(dotGit).isFile()) {
      const m = /^gitdir:s*(.+?)s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!m) return null;
      gitDir = path.resolve(root, m[1]!);
    }
    return fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * One funnel for "HEAD may have moved". The switch route and the filesystem
 * watcher both call {@link check}; it compares against the last HEAD it saw, so
 * a switch made through Sequence (route calls check, watcher fires later and
 * finds nothing new) rescans exactly once.
 */
export class HeadTracker {
  private last: HeadSnapshot | null = null;
  private lastRoot: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  /** Every read of HEAD (prime or check) takes the next number when it STARTS. */
  private seq = 0;
  /** The newest number whose result has been applied: an older read that finishes later is dropped. */
  private appliedSeq = 0;
  /** The prime that is reading HEAD right now, if any: a check waits for it so the switch is measured against it. */
  private priming: Promise<void> | null = null;
  /**
   * A check arrived while a prime was reading. That prime's read of HEAD may have landed AFTER a switch that
   * began first, which a snapshot comparison cannot reveal. The flag stays on the tracker until some check's result
   * is APPLIED (a check whose result is dropped as stale does not take it with it); that check then asks the
   * HEAD-file fingerprint, taken when the prime STARTED, whether HEAD really moved since.
   */
  private doubtArmed = false;
  private primeFingerprint: string | null = null;

  constructor(private readonly opts: HeadTrackerOptions) {}

  private fingerprint(root: string): string | null {
    try {
      return (this.opts.fingerprint ?? headFileFingerprint)(root);
    } catch {
      return null;
    }
  }

  private readHead(root: string): Promise<{ branch: string | null; detached: boolean; sha: string | null }> {
    return (this.opts.readHead ?? headState)(root);
  }

  /** Record the current HEAD as the baseline without emitting anything (call on attach). */
  prime(): Promise<void> {
    const root = this.opts.getRoot();
    this.lastRoot = root;
    this.last = null;
    if (root === null) return Promise.resolve();
    const seq = ++this.seq;
    this.doubtArmed = false;
    this.primeFingerprint = this.fingerprint(root);
    const run = (async (): Promise<void> => {
      const snap = await this.snap(root);
      /* Re-attached while git ran, or a newer read already applied: the newer one owns the baseline. */
      if (this.opts.getRoot() === root && this.lastRoot === root && seq >= this.appliedSeq) {
        this.appliedSeq = seq;
        this.last = snap;
      }
    })();
    const tracked = run.finally(() => {
      if (this.priming === tracked) this.priming = null;
    });
    this.priming = tracked;
    return tracked;
  }

  private async snap(root: string): Promise<HeadSnapshot> {
    const h = await this.readHead(root);
    return { branch: h.branch, sha: h.sha };
  }

  /**
   * Compare HEAD with the last seen. When it moved: emit `git:head`, and on a
   * branch change (or a detached sha change) run the rescan and emit
   * `graph:updated`. `done` resolves when all of that has finished.
   */
  async check(): Promise<{ changed: boolean; done: Promise<void> }> {
    let root = this.opts.getRoot();
    if (root === null) return { changed: false, done: Promise.resolve() };
    /* A baseline is being read: wait for it, so a switch that lands during that read is reported against it
       instead of being taken as the baseline itself. */
    if (this.priming) {
      this.doubtArmed = true;
      await this.priming.catch(() => undefined);
      root = this.opts.getRoot();
      if (root === null) return { changed: false, done: Promise.resolve() };
    }
    const seq = ++this.seq;
    if (this.lastRoot !== root || this.last === null) {
      const snap = await this.snap(root);
      if (seq >= this.appliedSeq && this.opts.getRoot() === root) {
        this.appliedSeq = seq;
        this.lastRoot = root;
        this.last = snap;
      }
      return { changed: false, done: Promise.resolve() };
    }
    const now = await this.readHead(root);
    /* Overlapping checks can finish out of order: a result older than one already applied would move the baseline
       backwards and announce a HEAD that is no longer current. */
    if (seq < this.appliedSeq) return { changed: false, done: this.chain };
    this.appliedSeq = seq;
    /* Whichever check applies first consumes the doubt. HEAD is taken to have moved unless the fingerprint taken when
       the prime started is readable and still the same (unreadable: report, the safe direction). */
    let doubt = false;
    if (this.doubtArmed) {
      this.doubtArmed = false;
      const fp = this.fingerprint(root);
      doubt = fp === null || this.primeFingerprint === null || fp !== this.primeFingerprint;
    }
    /* The compare-and-set below runs with no await between, so two overlapping checks emit once. */
    const prev = this.last;
    if (prev === null || this.lastRoot !== root) return { changed: false, done: this.chain };
    const same = now.branch === prev.branch && now.sha === prev.sha;
    if (same && !doubt) return { changed: false, done: this.chain };
    this.last = { branch: now.branch, sha: now.sha };
    const branchMoved = doubt || now.branch !== prev.branch || (now.branch === null && now.sha !== prev.sha);
    this.opts.emit({
      type: 'git:head',
      branch: now.branch,
      sha: now.sha,
      detached: now.detached,
      previous: { branch: prev.branch, sha: prev.sha },
      rescan: branchMoved,
    });
    if (!branchMoved) return { changed: true, done: Promise.resolve() };
    /* Serialised: a second switch during a scan waits, then scans once more. */
    const work = async (): Promise<void> => {
      try {
        const scannedAt = await this.opts.rescan(root);
        const cur = await this.snap(root);
        this.opts.emit({
          type: 'graph:updated',
          reason: 'git:head',
          branch: cur.branch,
          sha: cur.sha,
          ...(scannedAt ? { scannedAt } : {}),
        });
      } catch (e) {
        this.opts.onError?.(e);
      }
    };
    this.chain = this.chain.then(work);
    return { changed: true, done: this.chain };
  }
}

/* ═══ routes ══════════════════════════════════════════════════════════════ */

export interface GitBranchRouteResult {
  status: number;
  body: unknown;
}

/**
 * Dispatch the JSON branch routes. Returns null when `pathname`/`method` is
 * not one of them. Auth, repo-attached and owner checks stay in repoServer.
 */
export async function handleGitBranchRoute(
  pathname: string,
  method: string,
  search: URLSearchParams,
  readJson: () => Promise<unknown>,
  root: string,
  tracker: HeadTracker,
  signal?: AbortSignal,
): Promise<GitBranchRouteResult | null> {
  if (pathname === '/api/git/branches' && method === 'GET') {
    try {
      return { status: 200, body: await gitBranches(root, { signal, staleDirty: true }) };
    } catch (e) {
      // The client hung up; nobody reads this, and the git children are already killed.
      if (signal?.aborted) return { status: 499, body: { error: 'client closed request' } };
      throw e;
    }
  }
  if (pathname === '/api/git/branch-changes' && method === 'GET') {
    try {
      return { status: 200, body: await gitBranchChanges(root, search.get('base') ?? undefined) };
    } catch (e) {
      if (e instanceof GitWorkspaceError) return { status: e.status, body: { error: e.message } };
      throw e;
    }
  }
  if (pathname === '/api/git/switch' && method === 'POST') {
    let body: unknown;
    try {
      body = await readJson();
    } catch (e) {
      return { status: 400, body: { error: `invalid JSON body: ${(e as Error).message}` } };
    }
    if (body === null || typeof body !== 'object') return { status: 400, body: { error: 'body must be a JSON object' } };
    const r = await gitSwitch(root, body as GitSwitchRequest);
    if (!r.ok) {
      return { status: r.status, body: { ok: false, reason: r.reason, error: r.error, ...(r.files ? { files: r.files } : {}) } };
    }
    /* The watcher may already have seen HEAD move while git was still running
       (then this check finds nothing new and the scan is already under way), so
       `rescan` reports that the switch changed HEAD, not who noticed first. */
    await tracker.check();
    return { status: 200, body: { ok: true, branch: r.branch, sha: r.sha, created: r.created, changed: r.changed, previous: r.previous, rescan: r.changed } };
  }
  return null;
}
