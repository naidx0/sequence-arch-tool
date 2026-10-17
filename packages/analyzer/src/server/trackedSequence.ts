/* ══════════════════════════════════════════════════════════════════════════
   A TRACKED `.sequence/` FILE IS THE USER'S, NOT THE ENGINE'S
   packages/analyzer/src/server/trackedSequence.ts

   `.sequence/` is git-ignored by the repo's local exclude, but a repo may COMMIT files in it (a graph
   snapshot, the agent map) on purpose. The engine writes those same names as caches: a scan rewrote
   `graph.json`, an edit through the app deleted it, and `git status` showed the person's committed file
   as deleted. A cache may not touch a file git tracks. The cache is skipped for that file (the next
   attach re-scans, which is what a missing cache means anyway); the person's copy stays byte for byte.

   Asked of git itself (`ls-files --error-unmatch`), not guessed from ignore rules: an ignored path can
   still be tracked, and only tracked paths are at risk. The answer is remembered for a few seconds so a
   scan that writes six files asks once, not six times. Not a git repo, or no git: not tracked.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

const REFRESH_MS = 30_000;

interface Entry {
  set: Set<string> | null;
  at: number;
  pending: Promise<void> | null;
}
const entries = new Map<string, Entry>();

function entryOf(root: string): Entry {
  const key = path.resolve(root);
  let e = entries.get(key);
  if (!e) {
    e = { set: null, at: 0, pending: null };
    entries.set(key, e);
  }
  return e;
}

/** The same list, blocking: ONLY for a worker thread, whose own event loop is nobody's to protect. */
function listTrackedSync(root: string): Set<string> {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '.sequence'], { timeout: 10_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(String(out).split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

function listTracked(root: string): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    try {
      execFile('git', ['-C', root, 'ls-files', '-z', '--', '.sequence'], { timeout: 10_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve(new Set()); /* not a repo, or no git: nothing is tracked */
        resolve(new Set(String(stdout).split('\0').filter(Boolean)));
      });
    } catch {
      resolve(new Set());
    }
  });
}

/** (Re)compute the tracked set of `root` in the background; resolves when it is known. Never rejects. */
export function primeTrackedSequence(root: string): Promise<void> {
  const e = entryOf(root);
  if (e.pending) return e.pending;
  e.pending = listTracked(path.resolve(root)).then((s) => {
    e.set = s;
    e.at = Date.now();
    e.pending = null;
  });
  return e.pending;
}

function inGitRepo(root: string): boolean {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** `.sequence/` named by the repo's local exclude or its .gitignore: read from disk, no git. */
function sequenceIgnored(root: string): boolean {
  /* Every spelling that ignores what is inside .sequence/: .sequence, .sequence/, /.sequence/, .sequence/*, .sequence/** */
  const rule = /^\/?\.sequence(?:\/(?:\*{1,2})?)?\s*$/m;
  for (const f of [path.join(root, '.git', 'info', 'exclude'), path.join(root, '.gitignore')]) {
    try {
      if (rule.test(fs.readFileSync(f, 'utf8'))) return true;
    } catch {
      /* absent */
    }
  }
  return false;
}

/**
 * True when `<repoRoot>/<rel>` is tracked by git (posix `rel`, e.g. `.sequence/graph.json`), or when that is
 * not known yet and nothing says `.sequence/` is ignored (the write is held back rather than risked).
 */
export function isTrackedByGit(repoRoot: string, rel: string): boolean {
  const e = entryOf(repoRoot);
  if (e.set === null) {
    const root = path.resolve(repoRoot);
    if (!isMainThread && inGitRepo(root) && !sequenceIgnored(root)) {
      /* A worker thread has no memo of the main thread's and nobody replays its writes: ask git now. */
      e.set = listTrackedSync(root);
      e.at = Date.now();
      return e.set.has(rel);
    }
    void primeTrackedSequence(repoRoot);
    /* Not inside any git repository (no `.git` up the tree): nothing can be tracked. */
    return inGitRepo(root) && !sequenceIgnored(root);
  }
  if (Date.now() - e.at > REFRESH_MS) void primeTrackedSequence(repoRoot);
  return e.set.has(rel);
}

const queued = new Map<string, () => void>();
const replaying = new Set<Promise<void>>();

/**
 * Run `write` unless git tracks `rel`. When that is not known yet (the write would be held back), the write is
 * QUEUED and replayed once the check resolves, if the file turns out untracked: a held-back write is deferred,
 * never dropped. One queued write per file (the latest wins). A tracked file is never written.
 */
export function writeUnlessTracked(repoRoot: string, rel: string, write: () => void): void {
  const e = entryOf(repoRoot);
  const wasUnknown = e.set === null;
  if (!isTrackedByGit(repoRoot, rel)) {
    write();
    return;
  }
  if (!wasUnknown || e.set !== null) return; /* known and tracked */
  const key = `${path.resolve(repoRoot)}\0${rel}`;
  queued.set(key, write);
  const p: Promise<void> = primeTrackedSequence(repoRoot).then(() => {
    const w = queued.get(key);
    queued.delete(key);
    if (w && !entryOf(repoRoot).set?.has(rel)) {
      try {
        w();
      } catch {
        /* a cache write is best-effort, exactly as the direct one */
      }
    }
  });
  replaying.add(p);
  void p.finally(() => replaying.delete(p));
}

/** Resolves when every queued write has been replayed or dropped. */
export async function flushTrackedWrites(): Promise<void> {
  while (replaying.size) await Promise.all([...replaying]);
}

/** Test seam: forget what git said. */
export function resetTrackedMemo(): void {
  entries.clear();
  queued.clear();
}

/** The engine's own caches under `.sequence/`: derived from the repo, rebuilt on demand. */
export const SEQUENCE_CACHE_FILE = /^(?:graph|explain|annotations|functions)(?:[.-][\w.-]*)?\.json$/;
