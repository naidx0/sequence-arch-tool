/**
 * Language mix — how much of a repo (and of each service) is written in what.
 *
 * Every file node the scan emits already carries `meta.language` and `meta.loc`
 * (scan.ts), and every parsed FileFacts carries the same two facts. Nothing ever
 * summed them, so the product could not answer the one question a reader asks
 * first — "what is this written in?" — and the language packs (`lang/packs.ts`)
 * had no mix to compose themselves from.
 *
 * This module is pure counting. It reports what the parse SAW:
 *
 *  - shares are weighted by lines of code when the sample carries `loc`, and by
 *    file count when it does not (a repo of files with no `loc` still gets an
 *    honest breakdown, just a coarser one) — `weightedBy` says which happened;
 *  - a file whose language the scanner does not parse is NOT dropped and NOT
 *    guessed at. It is reported under its own extension with `parsed: false`, so
 *    a Rust-heavy repo reads "62% rs (not parsed)" instead of pretending the
 *    38% we could read is the whole system.
 *
 * Nothing here selects a pack or biases a label — that is `lang/packs.ts`. This
 * file never writes anything back onto a file's language either; it only counts.
 */

import type { ArchGraph, ArchNode } from '@sequence/schema';
import type { Lang } from '../types.js';

/** One language's slice of a mix. */
export interface LanguageShare {
  /** `FileFacts.language` for parsed code, else the file extension without the dot. */
  language: string;
  /** How many files were counted. */
  files: number;
  /** Total lines of code across those files (0 when no sample carried `loc`). */
  loc: number;
  /** 0..1 slice of the mix, rounded to 4 decimals. Shares sum to ~1. */
  share: number;
  /** True only for the five languages the scanner actually parses. */
  parsed: boolean;
}

export interface LanguageMix {
  /** Descending by share, then by language name — deterministic. */
  shares: LanguageShare[];
  /** Files that contributed to the shares. */
  files: number;
  /** Lines counted (0 when nothing carried `loc`). */
  loc: number;
  /** What the percentages are actually weighted by — stated, never assumed. */
  weightedBy: 'loc' | 'files';
  /**
   * Files that carried neither a language nor a usable extension (e.g. a
   * `Dockerfile` node). Counted separately rather than folded into a bucket that
   * would claim more than we know.
   */
  unclassifiedFiles: number;
}

/** The five languages with a real tree-sitter grammar (`parse/treesitter.ts`). */
const PARSED: ReadonlySet<string> = new Set<Lang>(['ts', 'js', 'py', 'go', 'java']);

export function isParsedLanguage(language: string | undefined): language is Lang {
  return !!language && PARSED.has(language);
}

/** One file's contribution: whatever the caller already knows about it. */
export interface LanguageSample {
  /** `FileFacts.language` / `meta.language` when the file was parsed. */
  language?: string;
  /** Repo-relative path — read ONLY for its extension, and only when unparsed. */
  path?: string;
  /** Lines of code, when the scan counted them. */
  loc?: number;
}

const EMPTY: LanguageMix = {
  shares: [],
  files: 0,
  loc: 0,
  weightedBy: 'files',
  unclassifiedFiles: 0,
};

/** The extension a file's language falls back to, or undefined when it has none. */
function extensionOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined; // no ext, or a dotfile
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Sum a set of files into a language breakdown.
 *
 * Weighted by `loc` when ANY counted file carries one — a mix where half the
 * files report lines and half do not would otherwise silently weight the second
 * half at zero, so files without `loc` fall back to counting as one line each
 * and `weightedBy` still says `loc`. When no file carries `loc` at all the whole
 * mix is by file count, which is stated rather than implied.
 */
export function languageMix(samples: readonly LanguageSample[]): LanguageMix {
  if (samples.length === 0) return EMPTY;
  const anyLoc = samples.some((s) => typeof s.loc === 'number' && s.loc > 0);
  // Keyed by parsed-ness AND name: a file the parser read is a different fact
  // from one we only know the extension of, even when both read "ts".
  const buckets = new Map<
    string,
    { language: string; files: number; loc: number; weight: number; parsed: boolean }
  >();
  let unclassified = 0;
  let totalWeight = 0;
  let totalFiles = 0;
  let totalLoc = 0;

  for (const s of samples) {
    const parsed = isParsedLanguage(s.language);
    const key = parsed ? (s.language as string) : extensionOf(s.path);
    if (!key) {
      unclassified += 1;
      continue;
    }
    const loc = typeof s.loc === 'number' && s.loc > 0 ? s.loc : 0;
    const weight = anyLoc ? Math.max(loc, 1) : 1;
    const bucketKey = `${parsed ? 'p' : 'u'}:${key}`;
    const b = buckets.get(bucketKey) ?? { language: key, files: 0, loc: 0, weight: 0, parsed };
    b.files += 1;
    b.loc += loc;
    b.weight += weight;
    buckets.set(bucketKey, b);
    totalWeight += weight;
    totalFiles += 1;
    totalLoc += loc;
  }

  const shares: LanguageShare[] = [...buckets.values()]
    .map((b) => ({
      language: b.language,
      files: b.files,
      loc: b.loc,
      share: totalWeight > 0 ? Number((b.weight / totalWeight).toFixed(4)) : 0,
      parsed: b.parsed,
    }))
    .sort(
      (a, b) =>
        b.share - a.share ||
        a.language.localeCompare(b.language) ||
        Number(b.parsed) - Number(a.parsed)
    );

  return {
    shares,
    files: totalFiles,
    loc: totalLoc,
    weightedBy: anyLoc ? 'loc' : 'files',
    unclassifiedFiles: unclassified,
  };
}

export interface GraphLanguageMix {
  /** Every file node in the graph. */
  repo: LanguageMix;
  /** Keyed by service node id; only services that own at least one file appear. */
  byService: Map<string, LanguageMix>;
}

/**
 * The same counting, read off a scanned graph — for callers (the digest, the
 * server payload) that hold a graph rather than the parse facts. Identical
 * arithmetic; the only difference is where the samples come from.
 */
export function graphLanguageMix(graph: ArchGraph): GraphLanguageMix {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const serviceOf = (node: ArchNode): string | undefined => {
    let cur: ArchNode | undefined = node;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.kind === 'service') return cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return undefined;
  };

  const all: LanguageSample[] = [];
  const perService = new Map<string, LanguageSample[]>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue;
    const sample: LanguageSample = {
      language: typeof n.meta?.language === 'string' ? n.meta.language : undefined,
      path: n.path ?? n.label,
      loc: typeof n.meta?.loc === 'number' ? n.meta.loc : undefined,
    };
    all.push(sample);
    const svc = serviceOf(n);
    if (svc) {
      const list = perService.get(svc) ?? [];
      list.push(sample);
      perService.set(svc, list);
    }
  }

  const byService = new Map<string, LanguageMix>();
  for (const [svc, samples] of perService) byService.set(svc, languageMix(samples));
  return { repo: languageMix(all), byService };
}

/** "62% py · 31% ts" — a mix as one honest line. Empty string for an empty mix. */
export function formatLanguageMix(mix: LanguageMix, top = 3): string {
  return mix.shares
    .slice(0, top)
    .map((s) => `${Math.round(s.share * 100)}% ${s.language}${s.parsed ? '' : ' (not parsed)'}`)
    .join(' · ');
}
