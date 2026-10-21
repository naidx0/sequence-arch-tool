/**
 * P5 — filesystem watch → mark the served graph stale.
 *
 * `PUT /api/file` and proposal apply already call `markGraphStale` for known
 * writes. External edits (editor, git checkout, another process) did not —
 * gap G5. This module watches the attached root, debounces, skips IGNORE_DIRS
 * and `.sequence` noise, and reports relative paths. It does NOT rescan; the
 * client shows the stale strip and the user hits Retry.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { IGNORE_DIRS } from '../ignoreDirs.js';

/** Debounce window — bursty editors (save + temp + rename) collapse to one hint. */
export const REPO_WATCH_DEBOUNCE_MS = 400;

/** Directory names never watched (scanner ignore + Sequence's own runtime tree). */
const SKIP_DIR_NAMES = new Set([...IGNORE_DIRS, '.sequence']);

export interface RepoWatchHandle {
  /** Absolute root currently watched, or null when stopped. */
  readonly root: string | null;
  /** The watch is open and not stopped. False when the platform refused it: nothing can be inferred from its silence. */
  readonly active: boolean;
  /** Stop watching; safe to call more than once. */
  stop(): void;
}

export interface RepoWatchOptions {
  /** Called with repo-relative POSIX paths after the debounce settles. */
  onChange: (relPaths: readonly string[]) => void;
  /** Called at once, undebounced, for every event that would be reported (a parked repo is marked changed from this). */
  onActivity?: () => void;
  /** Override debounce (tests). */
  debounceMs?: number;
  /** Inject fs.watch (tests). */
  watch?: typeof fs.watch;
}

/**
 * Should this relative path (or any of its ancestors) be ignored?
 * Matches the scanner's IGNORE_DIRS semantics: directory *names* in the path.
 */
export function shouldIgnoreWatchPath(relPosix: string): boolean {
  if (relPosix === '' || relPosix === '.') return false;
  const parts = relPosix.split('/').filter(Boolean);
  for (const part of parts) {
    if (SKIP_DIR_NAMES.has(part)) return true;
    /* Editor / OS junk that is not a directory name in IGNORE_DIRS. */
    if (part === '.DS_Store' || part.endsWith('~') || part.startsWith('.#')) return true;
  }
  return false;
}

/**
 * Start a recursive watch on `root`. Returns a handle; calling again after
 * stop() is a fresh watch. Failures to open the watch are reported via
 * `onChange` never firing — the server keeps serving; watch is best-effort.
 */
/**
 * A bare `change` event on a DIRECTORY is not an edit: the scanner reading a tree is enough to raise one on Windows,
 * and a real create, delete, rename or write also arrives for the file itself. Used only for the "has this repo
 * changed since it was loaded" flag, where a false alarm costs a full re-check and a missed one is the risk.
 */
function isDirectoryTouch(root: string, posix: string, event: string): boolean {
  if (event !== 'change') return false;
  try {
    return fs.statSync(path.join(root, posix === '.' ? '' : posix)).isDirectory();
  } catch {
    return false;
  }
}

export function startRepoWatch(root: string, opts: RepoWatchOptions): RepoWatchHandle {
  const debounceMs = opts.debounceMs ?? REPO_WATCH_DEBOUNCE_MS;
  const watchFn = opts.watch ?? fs.watch;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  const pending = new Set<string>();
  let watcher: fs.FSWatcher | null = null;

  const flush = (): void => {
    timer = null;
    if (closed || pending.size === 0) return;
    const paths = [...pending];
    pending.clear();
    opts.onChange(paths);
  };

  const note = (rel: string, event = 'rename'): void => {
    const posix = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    if (shouldIgnoreWatchPath(posix)) return;
    /* A bare directory `change` (the scanner reading a tree raises one) is neither an edit to report nor a change to count. */
    if (isDirectoryTouch(root, posix, event)) return;
    opts.onActivity?.();
    pending.add(posix === '' ? '.' : posix);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  try {
    watcher = watchFn(root, { recursive: true }, (_event, filename) => {
      if (closed) return;
      /* `filename` may be null on some platforms; treat as "something under root". */
      note(filename == null ? '.' : String(filename), filename == null ? 'rename' : _event);
    });
    watcher.on('error', () => {
      /* Best-effort: a broken watch must not take down the server. */
    });
    /* Do not keep the process alive for the watch alone — tests and short CLI
       runs must be able to exit when the HTTP server closes. */
    watcher.unref?.();
  } catch {
    watcher = null;
  }

  return {
    get root() {
      return closed ? null : root;
    },
    get active() {
      return !closed && watcher !== null;
    },
    stop() {
      if (closed) return;
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      try {
        watcher?.close();
      } catch {
        /* already closed */
      }
      watcher = null;
    },
  };
}

/**
 * Relativize an absolute path under root; returns null when outside.
 * Exported for tests — the watch callback usually gives relative names already.
 */
export function relUnderRoot(root: string, absOrRel: string): string | null {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(root, absOrRel);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/') || '.';
}

/* ═══ HEAD watch ══════════════════════════════════════════════════════════
 * `startRepoWatch` skips `.git/` on purpose (git churns it constantly), so a
 * branch switch made in a terminal or another app is invisible to it. This
 * watches only what a HEAD move touches: the git dir itself (HEAD is replaced
 * by rename, so the DIRECTORY is watched, never the file) and the shared
 * `refs/` tree (a commit moves the ref HEAD points at). For a linked worktree
 * the git dir is `<main>/.git/worktrees/<name>` and refs live in the common dir.
 */

/** Debounce for HEAD changes — a switch writes HEAD, the index and many files. */
export const HEAD_WATCH_DEBOUNCE_MS = 300;

export interface GitDirs {
  /** This checkout's git dir (holds HEAD). */
  gitDir: string;
  /** The common dir (holds refs/ and packed-refs); equals gitDir outside a linked worktree. */
  commonDir: string;
}

/** Resolve the real git dirs via `git rev-parse` (handles `.git` files). Null when not a git checkout. */
export function resolveGitDirs(root: string): Promise<GitDirs | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--absolute-git-dir', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const out = String(stdout).split(/\r?\n/).filter(Boolean);
        const gitDir = out[0];
        if (!gitDir) return resolve(null);
        const common = out[1] ? path.resolve(root, out[1]) : gitDir;
        resolve({ gitDir: path.resolve(gitDir), commonDir: common });
      },
    );
  });
}

export interface HeadWatchOptions {
  /** Called once per debounced burst of HEAD / ref activity. Compare with the last HEAD yourself. */
  onMaybeChanged: () => void;
  /** Called at once for every event, undebounced. */
  onActivity?: () => void;
  debounceMs?: number;
  watch?: typeof fs.watch;
  /** Test seam: skip the `git rev-parse` call (the dirs are then watched at once, synchronously). */
  dirs?: GitDirs | null;
}

export function startHeadWatch(root: string, opts: HeadWatchOptions): RepoWatchHandle {
  const debounceMs = opts.debounceMs ?? HEAD_WATCH_DEBOUNCE_MS;
  const watchFn = opts.watch ?? fs.watch;
  /* `undefined` while `git rev-parse` is still running (never on the event loop); null = not a checkout. */
  let dirs: GitDirs | null | undefined = opts.dirs;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  const watchers: fs.FSWatcher[] = [];

  const poke = (): void => {
    if (closed) return;
    opts.onActivity?.();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) opts.onMaybeChanged();
    }, debounceMs);
  };

  const open = (dir: string, recursive: boolean, accept: (name: string) => boolean): void => {
    try {
      const w = watchFn(dir, { recursive }, (_e, filename) => {
        const name = filename == null ? '' : String(filename).replace(/\\/g, '/');
        if (name === '' || accept(name)) poke();
      });
      w.on('error', () => undefined);
      w.unref?.();
      watchers.push(w);
    } catch {
      /* best-effort, like the repo watch */
    }
  };

  const openAll = (d: GitDirs): void => {
    open(d.gitDir, false, (n) => n === 'HEAD' || n === 'packed-refs');
    open(path.join(d.commonDir, 'refs'), true, () => true);
    /* A linked worktree's packed-refs lives in the common dir, not its own. */
    if (d.commonDir !== d.gitDir) open(d.commonDir, false, (n) => n === 'packed-refs');
  };
  if (dirs) openAll(dirs);
  else if (dirs === undefined) {
    void resolveGitDirs(root).then((d) => {
      dirs = d;
      if (d && !closed) {
        openAll(d);
        /* HEAD may have moved while git was resolving: let the tracker compare once (no onActivity, nothing changed on disk). */
        timer = setTimeout(() => {
          timer = null;
          if (!closed) opts.onMaybeChanged();
        }, debounceMs);
      }
    });
  }

  return {
    get root() {
      return closed ? null : root;
    },
    get active() {
      /* Not a git checkout: there is no HEAD to move, so the absence of a watch is not blindness. */
      return !closed && (dirs === null || dirs === undefined || watchers.length > 0);
    },
    stop() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      watchers.length = 0;
    },
  };
}
