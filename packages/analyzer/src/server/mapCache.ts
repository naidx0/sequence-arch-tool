import fs from 'node:fs';
import path from 'node:path';

import { MAP_FILES } from '../agentMap.js';
import { SEQUENCE_DIR } from './store.js';
import { isTrackedByGit, primeTrackedSequence } from './trackedSequence.js';

/*
 * APP-15: the size of a project's `.sequence/` folder, and "Clear map cache".
 *
 * `.sequence/` holds two kinds of thing. What a scan regenerates (the graph and function-graph caches and the map
 * files the agents read) can go at any time. Everything else is the person's own work or costs them something to
 * repeat: boards, sessions, memory notes, snapshots, skills, settings, and the model-written explain and annotation
 * caches. Clear removes only the first kind, and only by an ALLOW-LIST of top-level file names: a new file the engine
 * starts writing is kept until someone adds it here on purpose.
 */

const SCAN_CACHE_JSON = /^(?:graph|functions)(?:[.-][\w.-]*)?\.json$/;
const MAP_NAMES: ReadonlySet<string> = new Set(Object.values(MAP_FILES));

/** True for a top-level file name in `.sequence/` that a scan regenerates. */
export function isClearableCacheFile(name: string): boolean {
  return SCAN_CACHE_JSON.test(name) || MAP_NAMES.has(name);
}

export interface CacheSize {
  /** every byte under `.sequence/` (what the folder costs on disk) */
  bytes: number;
  /** the part Clear would free */
  clearableBytes: number;
}

function seqDir(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR);
}

function dirBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirBytes(p);
      else if (e.isFile()) total += fs.lstatSync(p).size;
    } catch {
      /* gone between the listing and the stat */
    }
  }
  return total;
}

/** Top-level regular files (never symlinks, never directories) of `.sequence/` that Clear may remove. */
function clearableEntries(repoRoot: string): { name: string; file: string; size: number }[] {
  const dir = seqDir(repoRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; file: string; size: number }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !isClearableCacheFile(e.name)) continue;
    const file = path.join(dir, e.name);
    try {
      out.push({ name: e.name, file, size: fs.lstatSync(file).size });
    } catch {
      /* gone */
    }
  }
  return out;
}

export function cacheSize(repoRoot: string): CacheSize {
  return { bytes: dirBytes(seqDir(repoRoot)), clearableBytes: clearableEntries(repoRoot).reduce((n, e) => n + e.size, 0) };
}

export interface ClearOutcome {
  removed: string[];
  freedBytes: number;
}

/** Remove the regenerable files. A file the repository commits is the person's and is left alone. */
export function clearMapCache(repoRoot: string): ClearOutcome {
  const removed: string[] = [];
  let freedBytes = 0;
  for (const e of clearableEntries(repoRoot)) {
    if (isTrackedByGit(repoRoot, `${SEQUENCE_DIR}/${e.name}`)) continue;
    try {
      fs.rmSync(e.file, { force: true });
      removed.push(e.name);
      freedBytes += e.size;
    } catch {
      /* in use or read-only: it stays, and the next size read says so */
    }
  }
  return { removed, freedBytes };
}

/** Ask git which `.sequence/` files are committed, so Clear never deletes one (settles before the first clear). */
export function primeCacheCheck(repoRoot: string): Promise<void> {
  return primeTrackedSequence(repoRoot);
}
