/**
 * ONE parse, two consumers (U23).
 *
 * `scanRepo` parses every source file in the repo. `buildRepoFunctionGraph`
 * then parsed every source file in the repo AGAIN, from scratch, for facts
 * `scanRepo` had already extracted and thrown away. On n8n that second pass was
 * ~37s on top of a ~45s scan and was the single dominant large-repo cost once
 * the risks quadratic and the digest quadratic were fixed.
 *
 * The fix is NOT "keep the tree-sitter trees alive". `parse/facts.ts` disposes
 * every `TSTree` in a `finally` on purpose — holding them exhausted the WASM
 * heap and made five repos read zero files. What is shared here is the PLAIN
 * JS OUTPUT of the parse: function spans, call sites and import statements.
 * Trees are still parsed once and disposed immediately, exactly as before.
 *
 * Two properties make the reuse provably equivalent to re-parsing:
 *
 *  1. `extractFacts(src, rel, lang)` is a pure function of its arguments, and
 *     both call sites pass the SAME `rel` — `toRelPosix(path.relative(repoRoot,
 *     fileAbs))`, POSIX on every platform, because a native separator on ONE
 *     side turns every lookup here into a silent miss —
 *     and the SAME `lang` (identical `LANG_BY_EXT` tables). So a cache hit
 *     returns exactly the object the re-parse would have produced.
 *  2. A hit additionally requires the file's `size` and `mtimeMs` to be
 *     unchanged since the scan read it. A file edited between the scan and the
 *     function-graph build falls through and is re-parsed, so the reuse can
 *     never serve stale facts.
 *
 * Only the fields the function graph reads are retained (`functions`, `calls`,
 * `imports`, `language`, `loc`, Java's `varTypes`, and Go's `goPackageName`) —
 * notably NOT `lines`, which is the whole source of
 * every file and by far the largest part of `FileFacts`. And the store holds a
 * single repo's worth of facts, handed over ONCE: `takeSharedFacts` clears the
 * slot, and `resetSharedFacts` clears it at the start of every scan. Memory is
 * therefore bounded to the window between a scan and the function-graph build
 * that consumes it, which is the only window the sharing exists for.
 */
import type { CallFact, FileFacts, FunctionFact, ImportFact, Lang } from '../types.js';

/** The projection of `FileFacts` the function graph actually reads. */
export interface SharedFileFacts {
  file: string;
  language: Lang;
  /** Total lines — the module scope's span (functions/buildFunctionGraph.ts). */
  loc: number;
  functions: FunctionFact[];
  calls: CallFact[];
  imports: ImportFact[];
  /** Java-only (U33): declared name -> unqualified type. See `FileFacts`. */
  varTypes?: Map<string, string | null>;
  /** Go-only (H10): declared `package` name. See `FileFacts`. */
  goPackageName?: string;
}

interface SharedEntry {
  size: number;
  mtimeMs: number;
  facts: SharedFileFacts;
}

/** repo-relative path -> the facts one parse of that file produced. */
export type SharedFactsByFile = Map<string, SharedEntry>;

interface Slot {
  /** `fs.realpathSync(path.resolve(repoRoot))` of the scan that filled it. */
  root: string;
  byFile: SharedFactsByFile;
}

let slot: Slot | null = null;
/** The capture a scan is currently filling; published on completion. */
let pending: Slot | null = null;
/** How many files `buildRepoFunctionGraph` served from the capture this run (test seam). */
let cacheHits = 0;

/** Start (or restart) a capture for `root`. Called at the top of every scan. */
export function resetSharedFacts(root: string): void {
  slot = null;
  pending = { root, byFile: new Map() };
}

/** Record one file's parse output. No-op when no capture is open. */
export function recordSharedFacts(
  rel: string,
  size: number,
  mtimeMs: number,
  facts: FileFacts
): void {
  if (!pending) return;
  if (pending.byFile.has(rel)) return; // first parse wins; a repeat is identical anyway
  pending.byFile.set(rel, {
    size,
    mtimeMs,
    facts: {
      file: facts.file,
      language: facts.language,
      loc: facts.loc,
      functions: facts.functions,
      calls: facts.calls,
      imports: facts.imports,
      ...(facts.varTypes ? { varTypes: facts.varTypes } : {}),
      ...(facts.goPackageName ? { goPackageName: facts.goPackageName } : {}),
    },
  });
}

/** Publish the open capture so the next function-graph build can consume it. */
export function publishSharedFacts(): void {
  slot = pending;
  pending = null;
}

/**
 * Hand over the facts captured for `root`, clearing the slot. Returns
 * `undefined` when the last scan was of a different repo (or there was none),
 * in which case the caller parses for itself exactly as it always did.
 */
export function takeSharedFacts(root: string): SharedFactsByFile | undefined {
  if (!slot || slot.root !== root) return undefined;
  const { byFile } = slot;
  slot = null;
  return byFile;
}

/** Test seam: drop everything held, as if no scan had run. */
export function clearSharedFacts(): void {
  slot = null;
  pending = null;
}

/** Test seam: reset the cache-hit counter before a timed or counted build. */
export function resetSharedFactsMetrics(): void {
  cacheHits = 0;
}

/** Called by `buildRepoFunctionGraph` when a file is served from the capture. */
export function noteSharedFactsCacheHit(): void {
  cacheHits += 1;
}

/** Test seam: how many files the last build took from the scan capture. */
export function sharedFactsCacheHits(): number {
  return cacheHits;
}
