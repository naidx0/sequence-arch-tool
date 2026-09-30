import type { ArchGraph, FunctionGraph } from '@sequence/schema';
import { takeServerAttributionAmbiguity } from '../functions/crossServiceEdges.js';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import type { ScanOptions } from '../scan.js';
import { FUNCTIONS_FILE, readJson, writeJson } from './store.js';

/**
 * `.sequence/functions.json` — ONE definition of the function-graph cache.
 *
 * This format already existed, inline inside `repoServer.ts`'s `GET /api/functions`
 * handler, keyed on the arch graph's `scannedAt`. It is lifted here unchanged (same
 * file, same version, same key) rather than reimplemented, because a second cache
 * writing a second shape to the same path is how two readers start disagreeing about
 * what a repo contains.
 *
 * The reason it needed a home outside the HTTP handler: `buildRepoFunctionGraph`
 * re-parses every source file, which costs seconds on a monorepo of this size. (No
 * count is pinned here on purpose: five places quoted three different edge totals and
 * all three were stale within a day.) The app server calls it once and keeps it in
 * process memory, so the cost was invisible there. The MCP server is a fresh process
 * per client, and `who_calls scanRepo` paid the full 3.1 s on every single call.
 * Measured after this: **3,939 ms cold, 155 ms warm**, both in a cold process.
 *
 * Honesty rests on the same key the HTTP path always used: `graph.scannedAt`. The
 * arch cache stores its graph verbatim (timestamp included), so a cache-hit scan and
 * a fresh scan of the same bytes carry the same `scannedAt`, and any real rescan
 * carries a new one. A miss is always safe; a corrupt or wrong-version file reads as
 * a miss and never throws.
 */

/**
 * Bump when the persisted shape OR CONTENT CONTRACT changes, so an older file is
 * a miss rather than something trusted.
 *
 *  - 3 added `warnings`; a v2 entry has none, so it must not be served as if it did.
 *  - 4 is the POSIX node-id contract. Repo-relative paths are now POSIX on every
 *    platform (see `relPosix.ts`), and `resolveImport` builds its candidates with
 *    `path.posix`, so a cache written on Windows by an older build holds node ids
 *    like `file:gateway\src\index.ts` AND is missing every import edge that the
 *    native-separator resolver failed to resolve. Serving one after an upgrade
 *    would hand back a graph that is both wrongly-identified and materially
 *    smaller — measured on the shopfront fixture as 32 nodes against a correct 35
 *    — with no error anywhere. A version bump is exactly the mechanism for that.
 */
export const FUNCTION_GRAPH_CACHE_VERSION = 4;

/** The on-disk shape of `.sequence/functions.json`. Keyed on `scannedAt`. */
export interface FunctionGraphCacheFile {
  version: typeof FUNCTION_GRAPH_CACHE_VERSION;
  scannedAt: string;
  functionGraph: FunctionGraph;
  /**
   * Route-handler-attribution ambiguities from the build that produced this entry
   * (unresolved/ambiguous handlers degraded to the registration site) — see
   * `functions/crossServiceEdges.ts`'s `takeServerAttributionAmbiguity`.
   */
  warnings?: string[];
}

/**
 * Read the cache for `scannedAt`. Returns `null` for a missing / corrupt /
 * wrong-version / stale file. NEVER throws — a bad cache always degrades to a build.
 */
export function readCachedFunctionGraph(
  repoRoot: string,
  scannedAt: string
): { functionGraph: FunctionGraph; warnings: string[] } | null {
  let cached: FunctionGraphCacheFile | undefined;
  try {
    cached = readJson<FunctionGraphCacheFile>(repoRoot, FUNCTIONS_FILE);
  } catch {
    return null;
  }
  if (
    !cached ||
    cached.version !== FUNCTION_GRAPH_CACHE_VERSION ||
    cached.scannedAt !== scannedAt ||
    !cached.functionGraph ||
    !Array.isArray(cached.functionGraph.nodes) ||
    !Array.isArray(cached.functionGraph.edges)
  ) {
    return null;
  }
  return { functionGraph: cached.functionGraph, warnings: cached.warnings ?? [] };
}

/** Best-effort persist. A read-only repo still gets its graph; the cache is never a dependency. */
export function writeCachedFunctionGraph(
  repoRoot: string,
  scannedAt: string,
  functionGraph: FunctionGraph,
  warnings: string[]
): void {
  const payload: FunctionGraphCacheFile = {
    version: FUNCTION_GRAPH_CACHE_VERSION,
    scannedAt,
    functionGraph,
    warnings,
  };
  try {
    writeJson(repoRoot, FUNCTIONS_FILE, payload);
  } catch {
    /* read-only / permissions — the caller already has its graph in memory */
  }
}

/**
 * Build the repo's function graph, reusing the persisted one when the arch graph it
 * belongs to has not been rescanned. `warnings` is the read-and-clear attribution
 * ambiguity from the build, replayed from the cache on a hit so a cached answer is
 * exactly as qualified as a fresh one.
 *
 * Opt-in by construction, exactly like `scanRepoCached`: the analyzer's own fixture
 * tests call `buildRepoFunctionGraph` directly and must keep exercising the builder.
 */
export async function buildRepoFunctionGraphCached(
  repoRoot: string,
  archGraph: ArchGraph,
  opts: ScanOptions = {}
): Promise<{ functionGraph: FunctionGraph; warnings: string[] }> {
  const scannedAt = String((archGraph as { scannedAt?: string }).scannedAt ?? '');
  if (scannedAt) {
    const hit = readCachedFunctionGraph(repoRoot, scannedAt);
    if (hit) return hit;
  }
  let functionGraph: FunctionGraph = { nodes: [], edges: [] };
  let built = false;
  try {
    functionGraph = await buildRepoFunctionGraph(repoRoot, opts, archGraph);
    built = true;
  } catch {
    // Same contract as the HTTP path: a build failure is an empty graph, never a 500.
    functionGraph = { nodes: [], edges: [] };
  }
  const warnings = takeServerAttributionAmbiguity() ?? [];
  // Only persist a graph we actually BUILT. Degrading this call is the contract;
  // degrading every later call is not. The write is keyed on `scannedAt`, so a
  // cached failure survives until something forces a rescan — and since `who_calls`
  // started sharing this file, a failure inside the short-lived MCP process would
  // hand the long-lived app server an empty graph it has no reason to distrust.
  if (scannedAt && built) writeCachedFunctionGraph(repoRoot, scannedAt, functionGraph, warnings);
  return { functionGraph, warnings };
}
