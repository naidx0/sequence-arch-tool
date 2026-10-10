/**
 * P5 — filesystem watch → mark the served graph stale.
 *
 * `PUT /api/file` and proposal apply already call `markGraphStale` for known
 * writes. External edits (editor, git checkout, another process) did not —
 * gap G5. This module watches the attached root, debounces, skips IGNORE_DIRS
 * and `.sequence` noise, and reports relative paths. It does NOT rescan; the
 * client shows the stale strip and the user hits Retry.
 */

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
  /** Stop watching; safe to call more than once. */
  stop(): void;
}

export interface RepoWatchOptions {
  /** Called with repo-relative POSIX paths after the debounce settles. */
  onChange: (relPaths: readonly string[]) => void;
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

  const note = (rel: string): void => {
    const posix = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    if (shouldIgnoreWatchPath(posix)) return;
    pending.add(posix === '' ? '.' : posix);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  try {
    watcher = watchFn(root, { recursive: true }, (_event, filename) => {
      if (closed) return;
      /* `filename` may be null on some platforms; treat as "something under root". */
      note(filename == null ? '.' : String(filename));
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
