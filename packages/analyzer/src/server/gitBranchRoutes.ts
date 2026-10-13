import { execFileSync } from 'node:child_process';
import type http from 'node:http';

import {
  defaultBaseRef,
  isValidBranchName,
  resolveCommit,
  runGit,
  GitWorkspaceError,
} from './gitWorkspace.js';

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
async function readRefs(root: string, refs: string): Promise<string[][]> {
  const fmt = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:iso-strict)', '%(contents:subject)'].join('%00') + '%1e';
  const r = await runGit(root, ['for-each-ref', `--format=${fmt}`, refs]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec !== '')
    .map((rec) => rec.split(FIELD));
}

/**
 * ONE reading of HEAD, shared by the async routes and the sync tracker.
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

function gitSync(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 });
  } catch {
    return '';
  }
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

export async function gitBranches(root: string): Promise<GitBranchesResult> {
  const state = await headState(root);
  const base = await defaultBaseRef(root);
  const locals = await readRefs(root, 'refs/heads');
  const branches: BranchInfo[] = [];
  for (const f of locals) {
    const name = (f[0] ?? '').replace(/^refs\/heads\//, '');
    if (name === '') continue;
    const upstream = f[2] ?? '';
    let counts: { ahead: number; behind: number } | null = null;
    let against: string | undefined;
    if (upstream !== '') {
      counts = parseTrack(f[3] ?? '');
      against = upstream;
    }
    if (counts === null && name !== base && base !== 'HEAD') {
      const lr = await runGit(root, ['rev-list', '--left-right', '--count', `${base}...refs/heads/${name}`]);
      const m = /^(\d+)\s+(\d+)/.exec(lr.stdout.trim());
      if (lr.code === 0 && m) {
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
  const localNames = new Set(branches.map((b) => b.name));
  const remoteBranches: RemoteBranchInfo[] = [];
  for (const f of await readRefs(root, 'refs/remotes')) {
    const full = (f[0] ?? '').replace(/^refs\/remotes\//, '');
    if (full === '' || /\/HEAD$/.test(full)) continue;
    const slash = full.indexOf('/');
    if (slash < 0) continue;
    if (localNames.has(full.slice(slash + 1))) continue;
    remoteBranches.push({ name: full, remote: true, lastCommit: { sha: f[1] ?? '', date: f[4] ?? '', subject: f[5] ?? '' } });
  }
  const dirty = await countDirty(root);
  return { current: state.branch, detached: state.detached, sha: state.sha, branches, remoteBranches, dirty };
}

/** Dirty files under the attached root (staged, unstaged, untracked), without `.sequence/`. */
async function countDirty(root: string): Promise<number> {
  const r = await runGit(root, ['status', '--porcelain=v1', '-z', '--no-renames', '--', '.']);
  if (r.code !== 0) return 0;
  const layout = await gitLayout(root);
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
  reason: 'git:head';
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
}

interface HeadSnapshot {
  branch: string | null;
  sha: string | null;
}

/** Synchronous read of HEAD for the tracker (a handful of ms per debounced fs event). */
function readHeadSync(root: string): HeadSnapshot & { detached: boolean } {
  const h = parseHead(gitSync(root, ['symbolic-ref', '--quiet', 'HEAD']), gitSync(root, ['rev-parse', '--verify', '--quiet', 'HEAD']));
  return { branch: h.branch, sha: h.sha, detached: h.detached };
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

  constructor(private readonly opts: HeadTrackerOptions) {}

  /** Record the current HEAD as the baseline without emitting anything (call on attach). */
  prime(): void {
    const root = this.opts.getRoot();
    this.lastRoot = root;
    this.last = root === null ? null : this.snap(root);
  }

  private snap(root: string): HeadSnapshot {
    const h = readHeadSync(root);
    return { branch: h.branch, sha: h.sha };
  }

  /**
   * Compare HEAD with the last seen. When it moved: emit `git:head`, and on a
   * branch change (or a detached sha change) run the rescan and emit
   * `graph:updated`. `done` resolves when all of that has finished.
   */
  check(): { changed: boolean; done: Promise<void> } {
    const root = this.opts.getRoot();
    if (root === null) return { changed: false, done: Promise.resolve() };
    if (this.lastRoot !== root || this.last === null) {
      this.lastRoot = root;
      this.last = this.snap(root);
      return { changed: false, done: Promise.resolve() };
    }
    const now = readHeadSync(root);
    const prev = this.last;
    if (now.branch === prev.branch && now.sha === prev.sha) return { changed: false, done: this.chain };
    this.last = { branch: now.branch, sha: now.sha };
    const branchMoved = now.branch !== prev.branch || (now.branch === null && now.sha !== prev.sha);
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
        const cur = this.snap(root);
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
): Promise<GitBranchRouteResult | null> {
  if (pathname === '/api/git/branches' && method === 'GET') {
    return { status: 200, body: await gitBranches(root) };
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
    tracker.check();
    return { status: 200, body: { ok: true, branch: r.branch, sha: r.sha, created: r.created, changed: r.changed, previous: r.previous, rescan: r.changed } };
  }
  return null;
}
