/**
 * First-run repo discovery: the git repos under the browse root (the user's
 * home), so the first screen can offer each one as a single click.
 *
 * A repo is a folder holding a `.git` entry (a directory, or the `.git` FILE a
 * worktree or submodule has). The walk is breadth-first so shallow, likely
 * repos are found before the budget runs out, and it is bounded every way that
 * matters on a real home folder:
 *   - depth: at most {@link DEFAULT_MAX_DEPTH} levels below the root;
 *   - time: a wall-clock budget, after which the result is marked truncated;
 *   - count: at most {@link DEFAULT_MAX_RESULTS} repos;
 *   - it never descends into a found repo (its subfolders are its own business);
 *   - it skips dependency/cache trees and hidden folders, and never follows a
 *     symlink or junction, which is also what makes a link loop impossible;
 *   - an unreadable folder is skipped, never fatal.
 *
 * It only reads directory listings and the mtime of `.git/HEAD` / `.git/index`.
 * It never reads file contents.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_MAX_RESULTS = 200;
export const DEFAULT_BUDGET_MS = 2000;

/** Folder names never descended into (case-insensitive). Hidden folders are skipped separately. */
const SKIP_NAMES = new Set(['node_modules', 'appdata', 'library', '$recycle.bin']);

export interface DiscoveredRepo {
  /** Absolute native path. */
  path: string;
  name: string;
  /** Epoch ms of the latest `.git/HEAD` / `.git/index` change; null when unreadable. */
  lastActive: number | null;
  /** True when the repo is in the user's recent list. */
  recent: boolean;
}

export interface DiscoveryResult {
  repos: DiscoveredRepo[];
  /** True when the walk stopped early (budget or result cap). */
  truncated: boolean;
  ms: number;
}

export interface DiscoveryOptions {
  /** Canonical browse root. Every result is inside it. */
  root: string;
  /** Recent repo paths, most recent first, already jailed to `root`. */
  recent?: readonly string[];
  maxDepth?: number;
  maxResults?: number;
  budgetMs?: number;
  /** Directory reads in flight at once. */
  concurrency?: number;
}

function shouldSkip(name: string): boolean {
  return name.startsWith('.') || SKIP_NAMES.has(name.toLowerCase());
}

/** Latest activity time of the repo at `dir`, from git's own bookkeeping files. */
export async function repoLastActive(dir: string): Promise<number | null> {
  const gitPath = path.join(dir, '.git');
  const candidates = [path.join(gitPath, 'HEAD'), path.join(gitPath, 'index'), gitPath];
  let best: number | null = null;
  for (const c of candidates) {
    try {
      const st = await fs.promises.stat(c);
      // `.git` itself only counts when it is a file (worktree / submodule pointer).
      if (c === gitPath && st.isDirectory()) continue;
      if (best === null || st.mtimeMs > best) best = st.mtimeMs;
    } catch {
      /* missing / unreadable */
    }
  }
  return best === null ? null : Math.round(best);
}

function isRepoDir(dir: string): boolean {
  try {
    fs.statSync(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Walk `root` and return its repos, recent ones first, then by last activity. */
export async function discoverRepos(opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const t0 = Date.now();
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const concurrency = Math.max(1, opts.concurrency ?? 16);
  const deadline = t0 + budgetMs;

  const found: string[] = [];
  const foundKeys = new Set<string>();
  const keyOf = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const add = (p: string): void => {
    const k = keyOf(p);
    if (foundKeys.has(k)) return;
    foundKeys.add(k);
    found.push(p);
  };

  // Recent repos the walk might not reach (too deep, under a skipped folder)
  // are still offered, as long as they are real repos.
  const recent = (opts.recent ?? []).filter((p) => isRepoDir(p));

  const queue: { dir: string; depth: number }[] = [{ dir: opts.root, depth: 0 }];
  let head = 0;
  let truncated = false;
  const full = (): boolean => found.length >= maxResults;

  async function visit(dir: string, depth: number): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable: skip
    }
    if (entries.some((e) => e.name === '.git')) {
      if (full()) {
        truncated = true;
        return;
      }
      add(dir);
      // Never descend into a found repo. The root itself is the exception: a
      // home folder under version control still has projects below it.
      if (depth > 0) return;
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      // isDirectory() is false for symlinks and junctions: they are never followed.
      if (!e.isDirectory() || shouldSkip(e.name)) continue;
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }

  async function worker(): Promise<void> {
    while (head < queue.length) {
      if (Date.now() >= deadline || full()) {
        truncated = true;
        return;
      }
      const item = queue[head++];
      await visit(item.dir, item.depth);
    }
  }

  // Workers stop when the queue is momentarily empty, so loop until it is
  // empty with nobody still reading (a read in flight may enqueue more).
  while (head < queue.length && !truncated) {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }
  if (head < queue.length) truncated = true;

  for (const r of recent) add(r);

  const repos: DiscoveredRepo[] = await Promise.all(
    found.map(async (p) => ({
      path: p,
      name: path.basename(p) || p,
      lastActive: await repoLastActive(p),
      recent: recent.some((r) => samePath(r, p)),
    })),
  );
  const recentRank = (p: string): number => recent.findIndex((r) => samePath(r, p));
  repos.sort((a, b) => {
    if (a.recent !== b.recent) return a.recent ? -1 : 1;
    if (a.recent && b.recent) return recentRank(a.path) - recentRank(b.path);
    return (b.lastActive ?? -1) - (a.lastActive ?? -1);
  });
  return { repos: repos.slice(0, maxResults), truncated, ms: Date.now() - t0 };
}
