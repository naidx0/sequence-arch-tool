/**
 * Per-file facts cache: an unchanged file is not parsed again.
 *
 * `extractFacts(src, rel, lang)` is a pure function of its arguments, so the facts
 * one parse produced are valid for any later scan that sees the same inputs. An
 * entry is reused only when EVERY input that can change the output matches:
 *
 *   sha256(content)  the file's text (not its mtime: a touch or a checkout that
 *                    rewrites identical bytes still hits; an edit never does)
 *   rel              repo-relative POSIX path (it is stored in the facts)
 *   lang, tsx        which grammar parsed it
 *   maxFileBytes     the scan's size cap (a cap change must not serve old skips)
 *   EXTRACTOR_VERSION  see below
 *
 * Lives at `<repo>/.sequence/cache/facts.v8` (gitignored; `.sequence` is never
 * walked). One structured-clone (v8.serialize) file - it round-trips Maps and
 * `undefined` members natively, so a cached `FileFacts` is `deepStrictEqual` to a
 * fresh parse with no encode/revive pass, and it loads several times faster than
 * the 30 MB of JSON the pinned monorepo would need. It is tagged with the V8
 * version that wrote it and ignored by any other. Rewritten atomically (temp + rename) only when the set
 * of entries changed, and pruned to the files the scan actually saw, so it cannot
 * grow past the repo. Any read problem (missing, torn, wrong shape, wrong format
 * version) yields an empty cache: a cache must never turn a scan into an error.
 *
 * `lines` (the whole source, by far the largest field) is NOT stored: the caller
 * already has the text and re-splits it. Equality with a fresh parse is locked by
 * facts-cache.test.ts.
 */
import crypto from 'node:crypto';
import v8 from 'node:v8';
import fs from 'node:fs';
import path from 'node:path';
import type { FileFacts, Lang } from '../types.js';
import { withLines } from './facts.js';
import { writeUnlessTracked } from '../server/trackedSequence.js';

/**
 * BUMP THIS whenever `facts.ts` (or anything it calls) changes what it extracts
 * from the same source. A stale version serves old facts for unchanged files; the
 * test in facts-cache.test.ts fails if the extractor's output for its specimens
 * changes while this stays put.
 */
export const EXTRACTOR_VERSION = '2c-2';

/**
 * sha256 of the sources that decide what `extractFacts` returns (parse/facts.ts, parse/treesitter.ts) and of the
 * grammar package's version, recorded when EXTRACTOR_VERSION was last set. `extractor-version.test.ts` recomputes
 * it and fails with "facts extraction changed: bump EXTRACTOR_VERSION and update the recorded hash" when it differs,
 * so a change to extraction cannot ship under an old version and serve stale facts. Update both together:
 *   SEQ_PIN_PRINT=1 node --test dist/test/extractor-version.test.js
 */
export const EXTRACTOR_SOURCE_HASH = '9d6722b08427d13e9bb0b7262ccf4c1562aae727edf6b205f8da36410d43ee50';

/** Cache file format. Independent of the extractor: changes when this encoding does. */
const FORMAT = 1;

interface Entry {
  sha: string;
  lang: Lang;
  tsx: boolean;
  maxFileBytes: number;
  extractor: string;
  /** FileFacts without `lines` */
  facts: Omit<FileFacts, 'lines'>;
}

interface Disk {
  format: number;
  v8: string;
  entries: Record<string, Entry>;
}

/**
 * Remove temp files a killed writer left in `.sequence/cache` (`facts.v8.<pid>.<ms>.tmp`, `scan-index.v8.<pid>.<ms>.tmp`):
 * tens of megabytes each, and nothing else would ever delete them. Only files older than `maxAgeMs` and not this
 * process's own are removed, so a writer that is merely slow is left alone. Never throws.
 */
export function sweepStaleCacheTmp(dir: string, maxAgeMs = 10 * 60_000): void {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      const m = /\.(\d+)\.(\d+)\.tmp$/.exec(name);
      if (!m || Number(m[1]) === process.pid) continue;
      try {
        const p = path.join(dir, name);
        if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.rmSync(p, { force: true });
      } catch {
        /* raced with its writer or its sweeper */
      }
    }
  } catch {
    /* no cache dir yet */
  }
}

export class FactsCache {
  /** files whose facts were served from the cache this scan */
  hits = 0;
  /** files that had to be parsed (and were stored) this scan */
  misses = 0;
  private readonly file: string;
  private loaded: Record<string, Entry> = {};
  private readonly next: Record<string, Entry> = {};
  private dirty = false;
  private didLoad = false;

  /**
   * @param lazy read `facts.v8` on first use instead of now. The scan index answers "unchanged"
   *   without it, so a rescan that edits one file never opens the 36 MB file at all.
   */
  constructor(
    repoRoot: string,
    private readonly maxFileBytes: number,
    lazy = false,
  ) {
    this.file = path.join(repoRoot, '.sequence', 'cache', 'facts.v8');
    if (!lazy) this.load();
  }

  private load(): void {
    if (this.didLoad) return;
    this.didLoad = true;
    try {
      const d = v8.deserialize(fs.readFileSync(this.file)) as Disk;
      if (d && d.format === FORMAT && d.v8 === process.versions.v8 && d.entries && typeof d.entries === 'object') this.loaded = d.entries;
    } catch {
      /* no cache yet, or an unreadable one: start empty */
    }
  }

  static hash(src: string): string {
    return crypto.createHash('sha256').update(src).digest('hex');
  }

  private entryFor(rel: string, sha: string, lang: Lang, tsx: boolean): Entry | undefined {
    this.load();
    const e = this.loaded[rel];
    if (
      !e ||
      e.sha !== sha ||
      e.lang !== lang ||
      e.tsx !== tsx ||
      e.maxFileBytes !== this.maxFileBytes ||
      e.extractor !== EXTRACTOR_VERSION
    ) {
      return undefined;
    }
    return e;
  }

  /** The stored facts (no `lines`) for this exact input, without counting a hit or retaining it. */
  peek(rel: string, sha: string, lang: Lang, tsx: boolean): Omit<FileFacts, 'lines'> | undefined {
    return this.entryFor(rel, sha, lang, tsx)?.facts;
  }

  /** Carry an unchanged file's stored entry into the next write. False when there is none to carry. */
  keep(rel: string, sha: string, lang: Lang, tsx: boolean): boolean {
    const e = this.entryFor(rel, sha, lang, tsx);
    if (!e) return false;
    this.next[rel] = e;
    return true;
  }

  /** Cached facts for this exact input, or undefined. */
  get(rel: string, sha: string, lang: Lang, tsx: boolean, lines: () => string[]): FileFacts | undefined {
    const e = this.entryFor(rel, sha, lang, tsx);
    if (!e) return undefined;
    try {
      const f = withLines(e.facts, lines());
      this.next[rel] = e;
      this.hits += 1;
      return f;
    } catch {
      return undefined;
    }
  }

  put(rel: string, sha: string, lang: Lang, tsx: boolean, facts: FileFacts): void {
    const { lines: _lines, ...rest } = facts;
    void _lines;
    this.next[rel] = {
      sha,
      lang,
      tsx,
      maxFileBytes: this.maxFileBytes,
      extractor: EXTRACTOR_VERSION,
      facts: rest,
    };
    this.misses += 1;
    this.dirty = true;
  }

  /** Write back if anything was added or dropped. Never throws. */
  save(): void {
    this.load();
    const kept = Object.keys(this.next).length;
    if (!this.dirty && kept === Object.keys(this.loaded).length) return;
    /* A cache file the repo commits is the person's, not ours to rewrite (server/trackedSequence.ts). */
    writeUnlessTracked(path.resolve(path.dirname(this.file), '..', '..'), `.sequence/cache/${path.basename(this.file)}`, () => this.persist());
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, v8.serialize({ format: FORMAT, v8: process.versions.v8, entries: this.next } satisfies Disk));
      try {
        fs.renameSync(tmp, this.file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    } catch {
      /* read-only repo, disk full, a racing scan: the cache is an optimisation */
    }
  }
}
