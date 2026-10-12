/* ══════════════════════════════════════════════════════════════════════════
   HOW FRESH A PERSISTED GRAPH IS, AND WHOSE IT IS (S2a)
   packages/analyzer/src/server/graphStamp.ts

   The board's MCP server answers from `<repo>/.sequence/graph.json`, so an
   answer can be older than the code. Each tool result says how old, in one
   line ("graph at a1b2c3d, 12 min old"), from what this module reads:

     headCommit          the repo's HEAD commit, read from .git (a file in a
                         linked worktree) with no git process
     linkedWorktreeBase  the main checkout a linked git worktree belongs to
                         (a Sequence chat worktree is one), or null
     graphStamp          the commit and scan time a graph.json records,
                         memoised by the file's mtime so a call parses it once

   Pure filesystem reads; nothing here scans.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

/** The `.git` directory of `repoRoot` (followed through a linked worktree's `.git` file), or null. */
function gitDir(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return m ? path.resolve(repoRoot, m[1]!.trim()) : null;
  } catch {
    return null;
  }
}

/** The common git dir (the main checkout's .git) for a git dir, following `commondir`. */
function commonDir(dir: string): string {
  try {
    return path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim());
  } catch {
    return dir;
  }
}

/** HEAD's commit (full sha), or null when this is not a git checkout or HEAD is unborn. */
export function headCommit(repoRoot: string): string | null {
  const dir = gitDir(repoRoot);
  if (!dir) return null;
  try {
    const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
    if (!ref) return null;
    const common = commonDir(dir);
    for (const base of [dir, common]) {
      try {
        const sha = fs.readFileSync(path.join(base, ref), 'utf8').trim();
        if (/^[0-9a-f]{40}$/.test(sha)) return sha;
      } catch {
        /* not a loose ref here */
      }
    }
    const packed = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8');
    for (const line of packed.split(/\r?\n/)) {
      const [sha, name] = line.split(' ');
      if (name === ref && /^[0-9a-f]{40}$/.test(sha ?? '')) return sha!;
    }
    return null;
  } catch {
    return null;
  }
}

/** The main checkout a linked git worktree belongs to, or null for a main checkout (or no git). */
export function linkedWorktreeBase(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, '.git');
  try {
    if (!fs.statSync(dotGit).isFile()) return null;
  } catch {
    return null;
  }
  const dir = gitDir(repoRoot);
  if (!dir) return null;
  const common = commonDir(dir);
  if (path.resolve(common) === path.resolve(dir)) return null;
  return path.dirname(common);
}

export interface GraphStamp {
  /** HEAD when the graph was written, when it was recorded. */
  commit: string | null;
  /** The scan time the graph records (ISO), or null. */
  scannedAt: string | null;
}

const memo = new Map<string, { mtimeMs: number; stamp: GraphStamp }>();

/** What `<repoRoot>/.sequence/graph.json` records about itself, or null when there is none. */
export function graphStamp(repoRoot: string): GraphStamp | null {
  const file = path.join(repoRoot, '.sequence', 'graph.json');
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = memo.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.stamp;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { commit?: unknown; graph?: { scannedAt?: unknown } };
    const stamp: GraphStamp = {
      commit: typeof parsed.commit === 'string' ? parsed.commit : null,
      scannedAt: typeof parsed.graph?.scannedAt === 'string' ? parsed.graph.scannedAt : null,
    };
    memo.set(file, { mtimeMs, stamp });
    return stamp;
  } catch {
    return null;
  }
}

/** "under a minute old", "12 min old", "3 h old", "2 days old". */
export function ageText(fromIso: string | null, now: number = Date.now()): string {
  const at = fromIso ? Date.parse(fromIso) : NaN;
  if (!Number.isFinite(at)) return 'of unknown age';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'under a minute old';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min old`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h old`;
  return `${Math.round(h / 24)} days old`;
}

/** The one line a board tool's answer ends with: "graph at a1b2c3d, 12 min old" (or "graph from base …"). */
export function freshnessLine(stamp: GraphStamp, opts: { fromBase?: boolean; now?: number } = {}): string {
  const commit = stamp.commit ? stamp.commit.slice(0, 7) : 'an unrecorded commit';
  const age = ageText(stamp.scannedAt, opts.now);
  return opts.fromBase ? `graph from base ${commit}, ${age} (this worktree has no graph of its own)` : `graph at ${commit}, ${age}`;
}
