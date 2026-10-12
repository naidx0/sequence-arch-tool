/**
 * S3 — UNDO ANYTHING THE AGENT DID: turn snapshots in a shadow git directory.
 *
 * At the start of each agent turn the whole working tree is written as a git
 * TREE object (`git add --all`, then `git write-tree`) into a SEPARATE git
 * directory, `<repo>/.sequence/snapshots/git`. No commit is ever made, no ref
 * moves, and the user's own `.git` (its index, HEAD, refs, stash) is never
 * opened: every git call here passes `--git-dir` and `--work-tree` explicitly
 * and strips GIT_* from the environment.
 *
 * Each turn also records the paths the agent wrote during it: from Claude
 * PreToolUse hooks (agentEvents.ts) and Codex `item/fileChange` and
 * `turn/diff/updated`, through {@link trackTurnWrites} and
 * {@link noteTurnDiff}. Those paths are what "Revert to here" puts back, so a
 * file the user edited by hand and the agent never touched is left alone.
 * `trackTurnWrites` also calls `checkpointStore.trackSessionWrite` before the
 * write lands, so the Rewind panel's checkpoints cover agent edits too.
 *
 *   Revert to here (turn N)  every path written in turn N or later goes back to
 *                            the tree taken when turn N started; a path that did
 *                            not exist then is deleted. The state just before
 *                            the revert is written as a tree first.
 *   Undo revert              those paths go back to that tree.
 *   A new turn after a revert drops the reverted turns: they did not happen.
 *
 * Bytes are kept exactly: the shadow repo sets core.autocrlf=false and
 * `info/attributes` turns off every text, eol and filter conversion, so a
 * restored CRLF file is byte-identical to the one snapshotted.
 *
 * The design (a shadow --git-dir, write-tree with no commits, per-file
 * checkout or delete on revert, a pointer for unrevert) follows OpenCode's
 * packages/opencode/src/snapshot/index.ts and session/revert.ts. No code was
 * copied; the design is credited under its licence:
 *
 *   MIT License
 *
 *   Copyright (c) 2025 opencode
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */

import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isCheckpointSessionId, trackSessionWrite } from './checkpointStore.js';
import { resolveInRepo } from './jail.js';
import { SEQUENCE_DIR } from './store.js';

export const SNAPSHOTS_DIR = 'snapshots';
const GIT_TIMEOUT_MS = 60_000;
/**
 * Turns kept per session. A turn past this ages out of the list, and the
 * shadow repository is garbage-collected so its tree goes too
 * ({@link pruneShadow}); the user's own repository is never touched.
 */
export const MAX_TURNS = 50;

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface TurnRecord {
  /** 1, 2, 3 … per session; stable (never renumbered). */
  seq: number;
  /** The provider's own turn id, when it has one (Codex turn id). */
  turnId?: string;
  /** The id of the saved chat turn (agent-runs.json) that began this snapshot: how Edit from here finds the one to put files back to. */
  chatTurnId?: string;
  label?: string;
  at: number;
  /**
   * The working tree when the turn started (a git tree id in the shadow repo).
   * `''` when no undo point could be written at all (see `noUndo`).
   */
  tree: string;
  /** Repo-relative paths the agent wrote during this turn. */
  files: string[];
  /**
   * A PARTIAL undo point: files that could not be read when the turn started
   * (on Windows, a file another process held open; git said "unable to index
   * file"). Everything else is in `tree`. A revert to this turn leaves these
   * files alone, because the point does not know what they held.
   */
  skipped?: string[];
  /** Set when there is no undo point for this turn at all (write-tree failed), with why. */
  noUndo?: string;
}

export interface RevertState {
  /** Reverted to the start of this turn. */
  seq: number;
  /** The tree of the reverted paths just before the revert: what Undo restores. */
  undoTree: string;
  /** Every path the revert put back. */
  files: string[];
  /** Paths the revert left alone: skipped by the turn's partial undo point, or unreadable for Undo. */
  skipped?: string[];
}

export interface SessionSnapshots {
  version: 1;
  sessionId: string;
  turns: TurnRecord[];
  revert?: RevertState;
}

export interface TurnFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

/* ───────────────────────────── git ───────────────────────────── */

export function shadowGitDir(root: string): string {
  return path.join(root, SEQUENCE_DIR, SNAPSHOTS_DIR, 'git');
}

/** Every GIT_* variable removed, so nothing the server inherited can redirect a call to the user's repo. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

interface Proc {
  code: number | null;
  signal?: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
}

function git(root: string, args: string[], input?: string | Buffer): Promise<Proc> {
  return new Promise((resolve) => {
    const child = childProcess.spawn('git', ['--git-dir', shadowGitDir(root), '--work-tree', root, ...args], {
      cwd: root,
      env: cleanEnv(),
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, GIT_TIMEOUT_MS);
    child.stdout!.on('data', (c: Buffer) => out.push(c));
    child.stderr!.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: e.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      /* Killed mid-write it cannot remove its own lock; under the queue no other git of ours holds it. */
      if (killed) fs.rmSync(indexLock(root), { force: true });
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: err });
    });
    if (input !== undefined) child.stdin!.end(input);
  });
}

/**
 * THE WHOLE ANSWER ON FAILURE: the command, its exit code (or the signal it
 * was stopped by), git's stderr and the start of its stdout. "git add failed:
 * exit 1" alone, seen once under load, could not say which cause it was.
 */
export function gitFailure(args: readonly string[], r: { code: number | null; signal?: string | null; stdout: Buffer | string; stderr: string }): string {
  const how = r.code === null ? `stopped by ${r.signal ?? 'a signal'}` : `exit ${r.code}`;
  const err = r.stderr.trim();
  const out = (typeof r.stdout === 'string' ? r.stdout : r.stdout.toString('utf8')).trim().slice(0, 400);
  return `git ${args.join(' ')} failed (${how})${err ? `: ${err}` : ''}${out ? ` [stdout: ${out}]` : ''}`;
}

/** The shadow index's lock file. */
function indexLock(root: string): string {
  return path.join(shadowGitDir(root), 'index.lock');
}

/** git's own words for a held index lock ("Unable to create '…/index.lock': File exists."). */
export function isIndexLockError(stderr: string): boolean {
  return /index\.lock/.test(stderr);
}

/**
 * The bounded retry for a held index lock, and only for that. Backoff in ms;
 * five tries over about 1.5 s. Every shadow call of this process runs under
 * the per-shadow queue ({@link serial}), so a lock that is still there after
 * the last try and is older than any git this process lets live
 * (GIT_TIMEOUT_MS) was left by a git that died: it is removed and the call
 * tried once more, so no stale lock stays behind. A younger lock belongs to a
 * live git (another process on this shadow) and is left alone.
 */
export const LOCK_BACKOFF_MS = [50, 100, 200, 400, 800];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gitLocked(root: string, args: string[], input?: string | Buffer): Promise<Proc> {
  let r = await git(root, args, input);
  for (const ms of LOCK_BACKOFF_MS) {
    if (r.code === 0 || !isIndexLockError(r.stderr)) return r;
    await sleep(ms);
    r = await git(root, args, input);
  }
  if (r.code !== 0 && isIndexLockError(r.stderr)) {
    const lock = indexLock(root);
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
    } catch {
      age = Number.POSITIVE_INFINITY; /* gone already: just try again */
    }
    if (age > GIT_TIMEOUT_MS) {
      fs.rmSync(lock, { force: true });
      r = await git(root, args, input);
    }
  }
  return r;
}

async function gitOk(root: string, args: string[], input?: string | Buffer): Promise<string> {
  const r = await gitLocked(root, args, input);
  if (r.code !== 0) throw new SnapshotError(gitFailure(args, r), 500);
  return r.stdout.toString('utf8');
}

/** Create the shadow repository once. Idempotent. */
export async function ensureShadow(root: string): Promise<void> {
  const dir = shadowGitDir(root);
  if (fs.existsSync(path.join(dir, 'HEAD'))) return;
  fs.mkdirSync(dir, { recursive: true });
  await gitOk(root, ['init', '-q']);
  for (const [k, v] of [
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    ['core.longpaths', 'true'],
    ['core.symlinks', 'true'],
    ['core.fsmonitor', 'false'],
    ['gc.auto', '0'],
  ]) {
    await gitOk(root, ['config', k!, v!]);
  }
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true });
  syncShadowExclude(root);
  /* Bytes in, bytes out: no eol, text or filter conversion either way. */
  fs.writeFileSync(path.join(dir, 'info', 'attributes'), '* -text -filter -ident\n');
}

/* ─────────────────────────── ignore rules ─────────────────────────── */

/**
 * The user's own git directory's `info/exclude`, or null when the root is not
 * a git checkout. Handles a linked worktree (`.git` is a file naming the git
 * dir, whose `commondir` holds the shared info/).
 */
export function userExcludeFile(root: string): string | null {
  const dotGit = path.join(root, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (st.isDirectory()) return path.join(dotGit, 'info', 'exclude');
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  if (!m) return null;
  const gitDir = path.resolve(root, m[1]!);
  let common = gitDir;
  try {
    common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    /* not a linked worktree */
  }
  return path.join(common, 'info', 'exclude');
}

/**
 * THE SHADOW SEES THE USER'S IGNORE RULES. The work tree's .gitignore files
 * apply on their own, and the global excludes file comes from the user's git
 * config; but the shadow GIT_DIR has its own info/, which does not see the
 * user's `.git/info/exclude`. So the shadow's exclude is Sequence's own store
 * plus the user's exclude, re-synced before each snapshot (it is one small
 * file). Without it, a folder the user excludes locally (a 50 MB build output,
 * say) is hashed into the shadow on every turn.
 */
function syncShadowExclude(root: string): void {
  let theirs = '';
  const file = userExcludeFile(root);
  if (file) {
    try {
      theirs = fs.readFileSync(file, 'utf8');
    } catch {
      theirs = '';
    }
  }
  const want = `/${SEQUENCE_DIR}/\n# The user's own .git/info/exclude:\n${theirs}${theirs && !theirs.endsWith('\n') ? '\n' : ''}`;
  const ours = path.join(shadowGitDir(root), 'info', 'exclude');
  let have = '';
  try {
    have = fs.readFileSync(ours, 'utf8');
  } catch {
    have = '';
  }
  if (have !== want) fs.writeFileSync(ours, want);
}

/** Roots whose `.sequence/` this process has already made sure git ignores. */
const userExcludeChecked = new Set<string>();

/** Tests: forget which roots were checked, as a new process would. */
export function resetSequenceIgnoredCheck(): void {
  userExcludeChecked.clear();
}

/**
 * `.sequence/` IS NEVER COMMITTED BY ACCIDENT. When the user's repository does
 * not already ignore it, `.sequence/` is added to their LOCAL
 * `.git/info/exclude` (once), never to their .gitignore, which is theirs and
 * shared. Read-only git otherwise: `check-ignore` writes nothing.
 */
export function ensureSequenceIgnored(root: string): void {
  if (userExcludeChecked.has(root)) return;
  const file = userExcludeFile(root);
  if (!file) return;
  const r = childProcess.spawnSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', `${SEQUENCE_DIR}/`], {
    env: cleanEnv(),
    windowsHide: true,
  });
  if (r.status === 0) {
    userExcludeChecked.add(root);
    return;
  }
  if (r.status !== 1) return; /* git could not answer: change nothing */
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const line = `${SEQUENCE_DIR}/`;
  if (!text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === `/${line}`)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? nl : ''}${line}${nl}`);
  }
  userExcludeChecked.add(root);
}

/* ─────────────────────────── growth ─────────────────────────── */

/** Aged-out turns (across a repo's chats) between two shadow gcs. */
export const GC_EVERY_DROPPED = 10;

/** Count aged-out turns; true when a gc is due (and reset the count). */
function gcDue(root: string, dropped: number): boolean {
  const file = path.join(root, SEQUENCE_DIR, SNAPSHOTS_DIR, 'gc-due');
  let n = 0;
  try {
    n = Number(fs.readFileSync(file, 'utf8')) || 0;
  } catch {
    n = 0;
  }
  n += dropped;
  const due = n >= GC_EVERY_DROPPED;
  fs.writeFileSync(file, String(due ? 0 : n));
  return due;
}

/** Resolves once every snapshot operation queued for `root` has finished (tests, shutdown). */
export function snapshotsIdle(root: string): Promise<void> {
  return serial(root, async () => undefined);
}

/**
 * Drop what no session still needs from the shadow repository: every tree a
 * session's turns (or its active revert) point at is kept, everything else
 * goes with `git gc --prune=now`, run in the SHADOW git dir only. The trees
 * are pinned with temporary refs for the gc and the refs are removed after,
 * so at rest the shadow holds trees only, no refs.
 */
export async function pruneShadow(root: string): Promise<void> {
  const keep = new Set<string>();
  for (const { sessionId } of listSnapshotSessions(root)) {
    const s = readSession(root, sessionId);
    for (const t of s.turns) keep.add(t.tree);
    if (s.revert) keep.add(s.revert.undoTree);
  }
  const refs = [...keep].map((tree, i) => `create refs/seq-keep/${i} ${tree}\n`).join('');
  if (refs) await gitOk(root, ['-c', 'core.logAllRefUpdates=false', 'update-ref', '--stdin'], refs);
  try {
    await gitOk(root, ['-c', 'gc.reflogExpire=now', '-c', 'gc.reflogExpireUnreachable=now', 'gc', '--quiet', '--prune=now']);
  } finally {
    const listed = (await gitOk(root, ['for-each-ref', '--format=%(refname)', 'refs/seq-keep/'])).split('\n').filter(Boolean);
    if (listed.length) await gitOk(root, ['-c', 'core.logAllRefUpdates=false', 'update-ref', '--stdin'], listed.map((r) => `delete ${r}\n`).join(''));
  }
}

/**
 * The working tree as a tree id. With `paths`, only those paths are re-read
 * from disk first (cheap, for diffs and undo); otherwise the whole tree.
 */
export async function writeTree(root: string, paths?: readonly string[]): Promise<string> {
  return (await snapshotTree(root, paths)).tree;
}

/**
 * The paths `git add --ignore-errors` could not read, from its stderr:
 * `error: open("a.txt"): Permission denied` and `error: unable to index file
 * 'a.txt'` (also `short read while indexing`). Repo-relative, forward slashes.
 */
export function skippedFromStderr(root: string, stderr: string): string[] {
  const out = new Set<string>();
  for (const m of stderr.matchAll(/unable to index file '([^']+)'|open\("([^"]+)"\)|short read while indexing (\S+)/g)) {
    const p = (m[1] ?? m[2] ?? m[3])!;
    const rel = toRelPosix(path.isAbsolute(p) ? path.relative(root, p) : p);
    if (rel && !rel.startsWith('..')) out.add(rel);
  }
  return [...out].sort();
}

/**
 * The working tree as a tree id, with the files that could not be read.
 *
 * `git add -A --ignore-errors` puts everything readable in the shadow index;
 * a file another process holds open (Windows) is reported on stderr and
 * skipped, and the tree is still written: a PARTIAL undo point, not none.
 * Anything else git refuses is an error, and so is write-tree failing.
 */
export async function snapshotTree(root: string, paths?: readonly string[]): Promise<{ tree: string; skipped: string[] }> {
  await ensureShadow(root);
  syncShadowExclude(root);
  ensureSequenceIgnored(root);
  const skipped: string[] = [];
  const add = async (args: string[], input?: string): Promise<void> => {
    const r = await gitLocked(root, args, input);
    if (r.code === 0) return;
    const lost = skippedFromStderr(root, r.stderr);
    if (lost.length === 0) throw new SnapshotError(gitFailure(args, r), 500);
    skipped.push(...lost);
  };
  if (paths) {
    /* A path that is on disk is re-read; one that is not is dropped from the
       shadow index (git add refuses a pathspec that matches nothing). */
    const present = paths.filter((p) => fs.existsSync(path.join(root, p)));
    const absent = paths.filter((p) => !present.includes(p));
    if (present.length > 0) {
      await add(['add', '--all', '--ignore-errors', '--pathspec-from-file=-', '--pathspec-file-nul'], present.join('\0'));
    }
    if (absent.length > 0) {
      await gitOk(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], absent.join('\0'));
    }
  } else {
    await add(['add', '--all', '--ignore-errors', '--', '.']);
  }
  const tree = (await gitOk(root, ['write-tree'])).trim();
  return { tree, skipped: [...new Set(skipped)].sort() };
}

/** What a turn with no undo point says, everywhere it is shown. */
export const NO_UNDO_POINT = 'No undo point for this turn'

/**
 * Build the shadow's index for the whole tree without recording a turn, so
 * the next turn-start snapshot is warm (~0.1 s on codeforge instead of ~3.9 s
 * cold). Run in idle time after a project opens (turnSnapshotGate.ts
 * IdleWarmer); queued like every other shadow operation.
 */
export function warmShadow(root: string): Promise<void> {
  return serial(root, async () => {
    await writeTree(root);
  });
}

async function inTree(root: string, tree: string, rel: string): Promise<boolean> {
  const out = await gitOk(root, ['ls-tree', '-z', '--name-only', tree, '--', rel]);
  return out.split('\0').includes(rel);
}

/* ─────────────────────────── the session log ─────────────────────────── */

function toRelPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function logPath(root: string, sessionId: string): string {
  if (!isCheckpointSessionId(sessionId)) throw new SnapshotError(`not a usable session id: ${String(sessionId)}`, 400);
  return path.join(root, SEQUENCE_DIR, SNAPSHOTS_DIR, `${sessionId}.json`);
}

export function readSession(root: string, sessionId: string): SessionSnapshots {
  try {
    const raw = JSON.parse(fs.readFileSync(logPath(root, sessionId), 'utf8')) as SessionSnapshots;
    if (raw && raw.version === 1 && Array.isArray(raw.turns)) return raw;
  } catch (e) {
    if (e instanceof SnapshotError) throw e;
  }
  return { version: 1, sessionId, turns: [] };
}

/** Every session with turn snapshots, the most recent turn first. */
export function listSnapshotSessions(root: string): { sessionId: string; turns: number; lastAt: number; reverted: boolean }[] {
  const dir = path.join(root, SEQUENCE_DIR, SNAPSHOTS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => /^([A-Za-z0-9_-]{1,64})\.json$/.exec(n)?.[1])
    .filter((id): id is string => !!id)
    .map((id) => {
      const s = readSession(root, id);
      return { sessionId: id, turns: s.turns.length, lastAt: s.turns.at(-1)?.at ?? 0, reverted: !!s.revert };
    })
    .filter((s) => s.turns > 0)
    .sort((a, b) => b.lastAt - a.lastAt);
}

function writeSession(root: string, s: SessionSnapshots): void {
  const file = logPath(root, s.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}

/** A repo-relative path inside the repo and outside .sequence/ and .git/, or null. */
function safeRel(root: string, p: string): string | null {
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  const rel = toRelPosix(path.relative(root, abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const top = rel.split('/')[0];
  if (top === SEQUENCE_DIR || top === '.git') return null;
  return resolveInRepo(root, rel) ? rel : null;
}

/**
 * ONE QUEUE PER SHADOW DIRECTORY, so no two git calls of this process ever
 * share the shadow index (two would contend for its index.lock). Keyed by the
 * shadow dir's real path, case-folded on Windows: `C:\\repo`, `c:/repo` and a
 * symlinked spelling are one shadow and must be one queue. Exported for the
 * test that proves overlapping calls are serialised.
 */
const queues = new Map<string, Promise<unknown>>();
export function shadowKey(root: string): string {
  let p = path.resolve(shadowGitDir(root));
  try {
    p = fs.realpathSync.native(path.resolve(root)) + p.slice(path.resolve(root).length);
  } catch {
    /* not on disk yet: the resolved spelling */
  }
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
function serial<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = shadowKey(root);
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/* ───────────────────────────── turns ───────────────────────────── */

/**
 * A turn starts: snapshot the working tree. Call it before the agent can
 * write. A turn after a revert drops the reverted turns.
 */
export function beginTurn(
  root: string,
  sessionId: string,
  opts: { turnId?: string; chatTurnId?: string; label?: string; now?: () => number } = {},
): Promise<TurnRecord> {
  return serial(root, async () => {
    const s = readSession(root, sessionId);
    if (s.revert) {
      const from = s.revert.seq;
      s.turns = s.turns.filter((t) => t.seq < from);
      delete s.revert;
    }
    /* A partial point (files skipped) is still an undo point. Only when no
       tree can be written at all does the turn carry "No undo point" and its
       reason, so the person sees it rather than a silent gap in Rewind. */
    let snap: { tree: string; skipped: string[] } | null = null;
    let noUndo: string | undefined;
    try {
      snap = await snapshotTree(root);
    } catch (e) {
      noUndo = `${NO_UNDO_POINT}: ${(e as Error).message}`;
    }
    const last = s.turns.at(-1);
    const rec: TurnRecord = {
      seq: (last?.seq ?? 0) + 1,
      ...(opts.turnId ? { turnId: opts.turnId } : {}),
      ...(opts.chatTurnId ? { chatTurnId: opts.chatTurnId } : {}),
      ...(opts.label ? { label: opts.label } : {}),
      at: (opts.now ?? Date.now)(),
      tree: snap?.tree ?? '',
      files: [],
      ...(snap && snap.skipped.length ? { skipped: snap.skipped } : {}),
      ...(noUndo ? { noUndo } : {}),
    };
    s.turns.push(rec);
    const dropped = s.turns.length > MAX_TURNS ? s.turns.splice(0, s.turns.length - MAX_TURNS) : [];
    writeSession(root, s);
    /* Turns aged out: their trees go from the shadow too, in a batch (a gc
       on codeforge costs ~3.5 s, a snapshot ~0.1 s), queued AFTER this turn
       so the agent never waits on it. */
    if (dropped.length > 0 && gcDue(root, dropped.length)) {
      void serial(root, () => pruneShadow(root)).catch(() => undefined);
    }
    return rec;
  });
}

function turnFor(s: SessionSnapshots, turnId?: string): TurnRecord | undefined {
  return (turnId ? s.turns.find((t) => t.turnId === turnId) : undefined) ?? s.turns.at(-1);
}

/**
 * The agent is about to write these paths. MUST run before the write lands:
 * it records the paths on the current turn (starting one if there is none,
 * whose snapshot is then taken now, before the write) and gives each to
 * `checkpointStore.trackSessionWrite`. Paths outside the repo are ignored.
 */
export async function trackTurnWrites(
  root: string,
  sessionId: string,
  paths: readonly string[],
  opts: { turnId?: string } = {},
): Promise<string[]> {
  const rels = [...new Set(paths.map((p) => safeRel(root, p)).filter((p): p is string => p !== null))];
  if (rels.length === 0) return [];
  if (readSession(root, sessionId).turns.length === 0) await beginTurn(root, sessionId, opts);
  return serial(root, async () => {
    for (const rel of rels) {
      try {
        trackSessionWrite(root, sessionId, rel);
      } catch {
        /* an oversized file: the shadow tree still holds it */
      }
    }
    const s = readSession(root, sessionId);
    const turn = turnFor(s, opts.turnId);
    if (!turn) return [];
    for (const rel of rels) if (!turn.files.includes(rel)) turn.files.push(rel);
    writeSession(root, s);
    return rels;
  });
}

/** The paths a unified diff (Codex `turn/diff/updated`) touches, both sides of a rename. */
export function diffPaths(diff: string): string[] {
  const out = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+?)\r?$/gm)) {
    out.add(m[1]!);
    out.add(m[2]!);
  }
  return [...out];
}

/** Codex said what this turn's diff is: union its paths into the turn. */
export function noteTurnDiff(root: string, sessionId: string, diff: string, opts: { turnId?: string } = {}): Promise<string[]> {
  return trackTurnWrites(root, sessionId, diffPaths(diff), opts);
}

/** Every path written in turn `seq` or later. */
function filesFrom(s: SessionSnapshots, seq: number): string[] {
  return [...new Set(s.turns.filter((t) => t.seq >= seq).flatMap((t) => t.files))].sort();
}

function turnBySeq(s: SessionSnapshots, seq: number): TurnRecord {
  const t = s.turns.find((x) => x.seq === seq);
  if (!t) throw new SnapshotError(`no turn ${seq} in session ${s.sessionId}`, 404);
  return t;
}

/* ─────────────────────────── what changed ─────────────────────────── */

/** Status of each path between a turn's start and now (paths written in that turn or later). */
export function turnFiles(root: string, sessionId: string, seq: number): Promise<TurnFile[]> {
  return serial(root, async () => {
    const s = readSession(root, sessionId);
    const start = turnBySeq(s, seq);
    const files = filesFrom(s, seq);
    if (files.length === 0) return [];
    if (!start.tree) throw new SnapshotError(start.noUndo ?? NO_UNDO_POINT, 409);
    const now = await writeTree(root, files);
    const out = await gitOk(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', start.tree, now, '--', ...files]);
    const parts = out.split('\0').filter(Boolean);
    const res: TurnFile[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const st = parts[i]!;
      res.push({ path: parts[i + 1]!, status: st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'modified' });
    }
    return res;
  });
}

/** The unified diff from a turn's start to now, for one path or all of the turn's paths. */
export function turnDiff(root: string, sessionId: string, seq: number, onlyPath?: string): Promise<string> {
  return serial(root, async () => {
    const s = readSession(root, sessionId);
    const start = turnBySeq(s, seq);
    let files = filesFrom(s, seq);
    if (onlyPath !== undefined) {
      const rel = safeRel(root, onlyPath);
      if (!rel) throw new SnapshotError('path is outside the repository', 400);
      files = [rel];
    }
    if (files.length === 0) return '';
    if (!start.tree) throw new SnapshotError(start.noUndo ?? NO_UNDO_POINT, 409);
    const now = await writeTree(root, files);
    return gitOk(root, ['diff-tree', '-r', '-p', '--no-renames', '--no-color', '--no-ext-diff', start.tree, now, '--', ...files]);
  });
}

/* ─────────────────────────── revert and undo ─────────────────────────── */

async function restorePaths(root: string, tree: string, files: readonly string[]): Promise<void> {
  for (const rel of files) {
    if (await inTree(root, tree, rel)) {
      await gitOk(root, ['checkout', tree, '--', rel]);
    } else {
      fs.rmSync(path.join(root, rel), { force: true });
    }
  }
}

/**
 * Revert to the start of turn `seq`: every path written in that turn or later
 * goes back to the tree taken then. Reverting further back while a revert is
 * active keeps the first undo point, so Undo always returns to the state
 * before any revert.
 */
export function revertToTurn(root: string, sessionId: string, seq: number): Promise<RevertState> {
  return serial(root, async () => {
    const s = readSession(root, sessionId);
    const turn = turnBySeq(s, seq);
    if (!turn.tree) throw new SnapshotError(turn.noUndo ?? NO_UNDO_POINT, 409);
    const prev = s.revert;
    /* A PARTIAL point does not know what its skipped files held: they are
       left alone, and so is anything that cannot be read for Undo now. */
    const leave = new Set([...(turn.skipped ?? []), ...(prev?.skipped ?? [])]);
    let files = [...new Set([...filesFrom(s, seq), ...(prev?.files ?? [])])].filter((f) => !leave.has(f)).sort();
    /* The undo point is taken BEFORE anything is restored. */
    let undoTree: string;
    if (!prev) {
      const u = await snapshotTree(root, files);
      for (const f of u.skipped) leave.add(f);
      undoTree = u.tree;
    } else {
      const extra = files.filter((f) => !prev.files.includes(f));
      if (extra.length > 0) {
        const u = await snapshotTree(root, extra);
        for (const f of u.skipped) leave.add(f);
        undoTree = await widenUndo(root, prev, extra.filter((f) => !leave.has(f)));
      } else {
        undoTree = prev.undoTree;
      }
    }
    files = files.filter((f) => !leave.has(f));
    await restorePaths(root, turn.tree, files);
    s.revert = { seq, undoTree, files, ...(leave.size ? { skipped: [...leave].sort() } : {}) };
    writeSession(root, s);
    return s.revert;
  });
}

/**
 * The undo point after a wider revert: the original undo tree for the paths
 * it covered, and the pre-revert state (still in the shadow index) for the
 * rest. Built with a temporary index so the shadow index is not disturbed.
 */
async function widenUndo(root: string, prev: RevertState, extra: readonly string[]): Promise<string> {
  /* `extra` were just re-read into the shadow index (before the restore);
     copy their entries into the old undo tree, or drop those absent now. */
  const tmpIndex = path.join(os.tmpdir(), `seq-snap-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    await gitEnv(root, env, ['read-tree', prev.undoTree]);
    const entries = await gitOk(root, ['ls-files', '-s', '-z', '--', ...extra]);
    const listed = new Set(entries.split('\0').filter(Boolean).map((e) => e.slice(e.indexOf('\t') + 1)));
    const gone = extra.filter((f) => !listed.has(f)).map((f) => `0 ${'0'.repeat(40)}\t${f}\0`).join('');
    if (entries || gone) await gitEnv(root, env, ['update-index', '-z', '--index-info'], entries + gone);
    return (await gitEnv(root, env, ['write-tree'])).trim();
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

function gitEnv(root: string, extra: Record<string, string>, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('git', ['--git-dir', shadowGitDir(root), '--work-tree', root, ...args], {
      cwd: root,
      env: { ...cleanEnv(), ...extra },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout!.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr!.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code, signal) => (code === 0 ? resolve(out) : reject(new SnapshotError(gitFailure(args, { code, signal, stdout: out, stderr: err }), 500))));
    if (input !== undefined) child.stdin!.end(input);
  });
}

/** Put back everything the active revert changed. */
export function undoRevert(root: string, sessionId: string): Promise<{ restored: string[] }> {
  return serial(root, async () => {
    const s = readSession(root, sessionId);
    if (!s.revert) throw new SnapshotError('there is no revert to undo', 409);
    await restorePaths(root, s.revert.undoTree, s.revert.files);
    const restored = s.revert.files;
    delete s.revert;
    writeSession(root, s);
    return { restored };
  });
}
