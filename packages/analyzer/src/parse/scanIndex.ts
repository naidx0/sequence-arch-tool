/**
 * The scan index: what the last scan learned about each file, so a rescan touches only
 * the files that changed.
 *
 * `facts.v8` (parse/factsCache.ts) answers "have I parsed these exact bytes before".
 * It is a 36 MB file on the pinned monorepo, 0.7 s to load and 0.5 s to write, so a
 * rescan that had to open it to learn that 2,611 of 2,612 files were unchanged spent
 * more time on the answer than on the edit. This index sits in front of it:
 *
 *   `<repo>/.sequence/cache/scan-index.v8`   one small record per file (about 3 MB in all)
 *
 * A record holds the file's stat and content hash, the slice of its facts the node build
 * reads (`Slim`: imports, function and class names, loc, the import snippets, rationale,
 * the scheduled-job flag), and each service's detector output for it. Everything the scan
 * derives from a file's bytes is here, so an unchanged file costs one `stat`: no read, no
 * hash, no parse, no detector run, and no load of the heavy facts (calls, assignments,
 * source lines). Those stay in `facts.v8` and load only if something asks for them
 * (parse/lazyFacts.ts).
 *
 * WHEN A STAT MATCH IS TRUSTED. `size`, `mtimeMs` and `ino` must all equal the recorded
 * ones, and the file must not be "racy": its mtime must be at least RACY_MS older than
 * the moment the content was last verified. This is git's racy-clean rule. A file written
 * within the same timestamp tick as our read could be edited again, keeping size and
 * mtime, and a stat comparison would then call it unchanged. Such files are re-hashed
 * (and, once verified at least RACY_MS after their mtime, trusted again).
 *
 * RESIDUAL, stated plainly: an edit that keeps the size, restores the mtime AND the
 * inode (a tool that rewrites in place and then `utimes` it back) is not seen. Git has
 * the same blind spot. It does not exist for editors, formatters, checkouts or `touch`,
 * which all change mtime or size. A content change that changes the size is always seen.
 *
 * WHAT INVALIDATES THE WHOLE INDEX: the format, the V8 version, the extractor version
 * (parse/factsCache.ts), DERIVED_VERSION below, and this build of the analyzer (the
 * module's own mtime, like graphCache's BUILD_MTIME_MS): detector or node-build code
 * changed, so what it derived before is not what it derives now.
 * `derived-version.test.ts` fails when the detector sources change without a bump.
 *
 * Any read problem yields an empty index: a cache must never turn a scan into an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import v8 from 'node:v8';
import { writeUnlessTracked } from '../server/trackedSequence.js';
import type { RationaleNote } from '../rationale.js';
import type { ImportFact, Lang } from '../types.js';
import type { FileDetections } from '../detectors/perFile.js';
import { EXTRACTOR_VERSION } from './factsCache.js';

/**
 * BUMP THIS when the detectors (detectors/*.ts), rationale.ts, scheduledDetect.ts or the
 * `Slim` derivation change what they return for the same facts. The recorded hash lives
 * in `derived-version.test.ts`, which fails with instructions when it no longer matches.
 */
export const DERIVED_VERSION = 'd7';

/**
 * The same pin for DERIVED_VERSION: sha256 of what derives the index's contents. See extractor-version.test.ts.
 * Re-recorded WITHOUT a bump when resolveImportAll's python import-root ordering was sped up (each root
 * split once; same comparator, same order, same output), so existing caches stay valid.
 */
export const DERIVED_SOURCE_HASH = '6d8b0bc8119a83f20492ebf55cc5475945f5acbc3d8d1d0db68cb234d0170da8';

const FORMAT = 1;
/** git's racy-clean window: the coarsest mtime granularity of a filesystem we run on (FAT: 2 s). */
export const RACY_MS = 2000;

/** The slice of a file's facts the node build and the memoised passes read. */
export interface Slim {
  language: Lang;
  loc: number;
  parseErrors: number;
  imports: ImportFact[];
  /** names only: the node build describes a module by them. The full facts load with the rest (lazyFacts.ts). */
  fnNames: string[];
  classNames: string[];
  goPackageName?: string;
  /** which optional heavy members the full facts carry (`'annotations' in facts`) */
  hasAnnotations: boolean;
  hasVarTypes: boolean;
  /** `(lines[imp.line - 1] ?? '').trim().slice(0, 200)` for each import, aligned with `imports` */
  importSnippets: string[];
  rationale: RationaleNote[];
  scheduled: boolean;
}

export interface FileStat {
  size: number;
  mtimeMs: number;
  ino: number;
}

/**
 * The files a signature walk saw (`server/graphCache.ts`), in walk order, parallel arrays: `rels[i]` is
 * repo-relative POSIX, `stats[i]` the stat read for it. A scan handed one neither walks nor stats.
 */
export interface FileSnapshot {
  rels: string[];
  stats: FileStat[];
}

export interface IndexRecord extends FileStat {
  /** `Date.now()` taken just BEFORE the bytes that produced `sha` were read */
  readAtMs: number;
  sha: string;
  lang: Lang;
  tsx: boolean;
  maxFileBytes: number;
  extractor: string;
  slim: Slim;
  /**
   * Per service name (a build context shared by two services is detected once per service): what the detectors
   * found in this file, valid while the service's `det` key (see {@link ScanIndex.keyIs}) is unchanged.
   */
  det: Record<string, FileDetections>;
  /**
   * Per service name: where each of this file's imports resolved to (`null`: none landed in the repo), valid
   * while the service's `imp` key is unchanged. Aligned with `slim.imports`.
   */
  imp?: Record<string, string[][] | null>;
}

interface Disk {
  format: number;
  v8: string;
  build: number;
  derived: string;
  records: Record<string, IndexRecord>;
  memos?: Record<string, { key: string; value: unknown }>;
  keys?: Record<string, string>;
}

/**
 * When the code that derives what the index stores was built: the newest mtime among the modules that
 * shape it (the scan, the detectors, rationale, clustering, the facts extractor and this file). Any rebuild
 * of those makes the whole index a miss, so a developer's edit to a detector can never be answered with the
 * output of the old one. In a bundle those files do not exist; the bundle's own mtime stands in.
 * (A release is guarded by DERIVED_VERSION and EXTRACTOR_VERSION and the tests that pin their sources.)
 */
const BUILD_MTIME_MS = (() => {
  try {
    const here = url.fileURLToPath(import.meta.url);
    const dir = path.dirname(here);
    const peers = ['../scan.js', '../rationale.js', '../scheduledDetect.js', '../cluster/cluster.js', './facts.js', './factsCache.js', './lazyFacts.js', here];
    const detectors = path.join(dir, '..', 'detectors');
    let newest = 0;
    const note = (f: string): void => {
      try {
        newest = Math.max(newest, fs.statSync(path.isAbsolute(f) ? f : path.join(dir, f)).mtimeMs);
      } catch {
        /* not a build tree */
      }
    };
    for (const f of peers) note(f);
    try {
      for (const n of fs.readdirSync(detectors)) if (n.endsWith('.js')) note(path.join(detectors, n));
    } catch {
      /* not a build tree */
    }
    return newest;
  } catch {
    return 0; // bundled or virtual: the version fields still guard it
  }
})();

export class ScanIndex {
  private readonly file: string;
  private records: Record<string, IndexRecord> = {};
  private memos: Record<string, { key: string; value: unknown }> = {};
  /**
   * What the per-file memos of each service (`det`, `imp`) were computed under. One key per service, not one per
   * file: everything they depend on besides the file itself (the other services' names and wires, the file list)
   * is shared by every file of the service, and every file of a service is visited by every scan.
   */
  private keys: Record<string, string> = {};
  private readonly seen = new Set<string>();
  private readonly seenMemos = new Set<string>();
  private readonly seenKeys = new Set<string>();
  private dirty = false;

  constructor(
    repoRoot: string,
    private readonly maxFileBytes: number,
  ) {
    this.file = path.join(repoRoot, '.sequence', 'cache', 'scan-index.v8');
    try {
      const d = v8.deserialize(fs.readFileSync(this.file)) as Disk;
      if (
        d &&
        d.format === FORMAT &&
        d.v8 === process.versions.v8 &&
        d.build === BUILD_MTIME_MS &&
        d.derived === DERIVED_VERSION &&
        d.records &&
        typeof d.records === 'object'
      ) {
        this.records = d.records;
        if (d.memos && typeof d.memos === 'object') this.memos = d.memos;
        if (d.keys && typeof d.keys === 'object') this.keys = d.keys;
      }
    } catch {
      /* none yet, or unreadable: start empty */
    }
  }

  /** Records loaded from disk. */
  get size(): number {
    return Object.keys(this.records).length;
  }

  get(rel: string): IndexRecord | undefined {
    const r = this.records[rel];
    return r && typeof r === 'object' && r.slim ? r : undefined;
  }

  /** Is the record for this very input (language, grammar, size cap, extractor)? */
  matches(r: IndexRecord, lang: Lang, tsx: boolean): boolean {
    return r.lang === lang && r.tsx === tsx && r.maxFileBytes === this.maxFileBytes && r.extractor === EXTRACTOR_VERSION;
  }

  /** May this stat stand in for reading the file? See the header for the rule. */
  trusted(r: IndexRecord, st: FileStat): boolean {
    return (
      r.size === st.size &&
      r.mtimeMs === st.mtimeMs &&
      r.ino === st.ino &&
      r.mtimeMs + RACY_MS <= r.readAtMs
    );
  }

  /** The bytes were read at `readAtMs` and hash to the record's `sha`: refresh the stat it is trusted by. */
  restat(r: IndexRecord, st: FileStat, readAtMs: number): void {
    r.size = st.size;
    r.mtimeMs = st.mtimeMs;
    r.ino = st.ino;
    r.readAtMs = readAtMs;
    this.dirty = true;
  }

  set(rel: string, r: IndexRecord): void {
    this.records[rel] = r;
    this.dirty = true;
  }

  /** The detector output was recomputed for this record. */
  touch(): void {
    this.dirty = true;
  }

  markSeen(rel: string): void {
    this.seen.add(rel);
  }

  /**
   * Is the stored `what` key for `service` (`'det'` or `'imp'`) `key`? When it is not, it becomes `key` and false is
   * returned: every file's memo of that kind must be recomputed under the new key (and will be, in this scan).
   */
  keyIs(what: 'det' | 'imp', service: string, key: string): boolean {
    const name = `${what}:${service}`;
    this.seenKeys.add(name);
    if (this.keys[name] === key) return true;
    this.keys[name] = key;
    this.dirty = true;
    return false;
  }

  /**
   * A pure function of `key`'s inputs, remembered across scans (the per-service PageRank and clustering).
   * `key` must be a digest of EVERYTHING `compute` reads; the stored copy is cloned so nothing a later pass
   * does to the returned value can reach the index.
   */
  memo<T>(name: string, key: string, compute: () => T): T {
    this.seenMemos.add(name);
    const hit = this.memos[name];
    if (hit && hit.key === key) return hit.value as T;
    const value = compute();
    this.memos[name] = { key, value: structuredClone(value) };
    this.dirty = true;
    return value;
  }

  newRecord(args: {
    st: FileStat;
    readAtMs: number;
    sha: string;
    lang: Lang;
    tsx: boolean;
    slim: Slim;
  }): IndexRecord {
    return {
      size: args.st.size,
      mtimeMs: args.st.mtimeMs,
      ino: args.st.ino,
      readAtMs: args.readAtMs,
      sha: args.sha,
      lang: args.lang,
      tsx: args.tsx,
      maxFileBytes: this.maxFileBytes,
      extractor: EXTRACTOR_VERSION,
      slim: args.slim,
      det: {},
    };
  }

  /** Write back, pruned to the files this scan saw, if anything changed. Never throws. */
  save(): void {
    const kept: Record<string, IndexRecord> = {};
    let n = 0;
    for (const rel of this.seen) {
      const r = this.records[rel];
      if (r) {
        kept[rel] = r;
        n += 1;
      }
    }
    const keys: Record<string, string> = {};
    for (const name of this.seenKeys) if (this.keys[name] !== undefined) keys[name] = this.keys[name];
    const memos: Record<string, { key: string; value: unknown }> = {};
    for (const name of this.seenMemos) if (this.memos[name]) memos[name] = this.memos[name];
    if (!this.dirty && n === Object.keys(this.records).length && Object.keys(memos).length === Object.keys(this.memos).length) return;
    /* A cache file the repo commits is the person's, not ours to rewrite (server/trackedSequence.ts). */
    writeUnlessTracked(path.resolve(path.dirname(this.file), '..', '..'), `.sequence/cache/${path.basename(this.file)}`, () => this.persist(kept, memos, keys));
  }

  private persist(kept: Record<string, IndexRecord>, memos: Record<string, { key: string; value: unknown }>, keys: Record<string, string>): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      const disk: Disk = { format: FORMAT, v8: process.versions.v8, build: BUILD_MTIME_MS, derived: DERIVED_VERSION, records: kept, memos, keys };
      fs.writeFileSync(tmp, v8.serialize(disk));
      try {
        fs.renameSync(tmp, this.file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      this.dirty = false;
    } catch {
      /* read-only repo, disk full, a racing scan: the index is an optimisation */
    }
  }
}

export function statOf(st: fs.Stats): FileStat {
  return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
}
