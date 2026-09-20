import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createHash } from 'node:crypto';
import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';
import { IGNORE_DIRS, scanRepo, type ScanOptions } from '../scan.js';
import { SEQUENCE_DIR, writeJson } from './store.js';

/**
 * The PERSISTENCE MOAT: scan a repo once into a grounded {@link ArchGraph},
 * persist it under `<repo>/.sequence/graph.json`, and on the next attach of
 * UNCHANGED content load the cached graph verbatim instead of re-crawling the
 * codebase. The cache is a PURE SPEEDUP — a cache-loaded graph is byte-identical
 * to a fresh {@link scanRepo} of the same content (same nodes/edges AND the same
 * stored `scannedAt`), so it can never be a source of drift or fabrication.
 *
 * Honesty rests on {@link computeSignature}: a cheap, stat-only content signature
 * over the repo's file set. Any change the scanner could observe — a source edit
 * OR a manifest change (compose/k8s/package.json) — perturbs the signature and
 * forces a fresh scan. The signature deliberately walks the WHOLE tree (a
 * superset of the files `scanRepo` reads) so a change to a file the scan reads is
 * NEVER missed (no false cache hit ⇒ no stale serve); an unrelated change merely
 * costs one extra scan (a false miss, which is always safe).
 *
 * ---------------------------------------------------------------------------
 * W1.4 — WHY THE SIGNATURE IS NOW PER-PACKAGE
 *
 * The signature used to fold the whole tree into ONE string, so the cache had
 * exactly one entry and a write anywhere invalidated everything. In a nine-package
 * monorepo that means editing `packages/mcp` throws away everything the cache knew
 * about `packages/web`, and the next question about `packages/web` pays a full
 * re-crawl.
 *
 * Measured on this repository (2026-08-20, `SEQUENCE_SCAN_PROFILE=1`), so the fix
 * is aimed at the real cost and not the assumed one:
 *
 *   computeSignature (whole tree, 1,133 files)   54 ms   ← NOT the bottleneck
 *   scanRepo (the re-crawl the miss forces)   3,275 ms
 *     └─ extractFacts, per file                2,600 ms  (79% of the scan)
 *     └─ everything downstream of parsing        500 ms  (detectors, join, nodes)
 *   buildRepoFunctionGraph (warm shared facts)  128 ms
 *
 * So the 7–8 s figure in the plan is the cost of the RE-CRAWL a whole-tree miss
 * forces, not of the signature itself: re-signing is 54 ms. What follows therefore
 * partitions the CACHE, not just the hash — the whole-tree hash becomes a hash over
 * per-part hashes, and each part's slice of the graph stays independently readable
 * while that part's bytes are unchanged.
 *
 * A part is a directory holding a package manifest ({@link PART_MANIFESTS}) —
 * pnpm/npm/yarn workspaces, Go modules, Cargo/Poetry/Maven/Gradle/Composer/Bundler
 * projects — plus {@link ROOT_PART} for everything under no manifest at all. A repo
 * with no sub-manifests has exactly one part and behaves precisely as it did before.
 *
 * WHAT THIS DOES NOT DO, stated so nobody reads more into it than is there: it does
 * NOT make a re-crawl incremental. `scanRepo` is whole-repo by construction (global
 * discovery, clustering and cross-service joins), so a changed part still costs a
 * full scan — the 79% sitting in per-file `extractFacts` can only be reclaimed where
 * that call is made, in `scan.ts`, by persisting the per-file facts the way
 * `parse/sharedFacts.ts` already does in memory. What this DOES do is stop an
 * unrelated part from paying for that scan at all.
 *
 * Measured end to end on this repository (14 parts), writing one new file into one
 * package and then asking about a DIFFERENT package:
 *
 *   computePartSignatures                        78 ms
 *   readCachedPart('packages/web')               18 ms  (753 nodes, 1,567 edges)
 *   ------------------------------------------------
 *   answer, no scan                              96 ms
 *   what the same question cost before        4,469 ms  (the forced whole re-crawl)
 *
 * ~46x, and inside the same order of magnitude as the ripgrep baseline (~40 ms) the
 * plan measures against. `changedParts` named exactly the one package written.
 */

/** Cache filename under `<repo>/.sequence/`. */
export const GRAPH_CACHE_FILE = 'graph.json';

/**
 * On-disk format version. BUMP when the persisted shape (or the signature
 * algorithm) changes so an older/newer `graph.json` is treated as a miss and
 * silently re-scanned instead of being trusted.
 *
 * 2 = per-part signatures (W1.4). Both the shape AND the algorithm changed, so a
 * v1 file must not be trusted: its single signature was computed a different way.
 *
 * 3 = the POSIX import resolver. `resolveImport` built its candidate paths with
 * the host's `path.join` while the file set it matched against is POSIX, so on
 * Windows EVERY relative JS/TS import failed to resolve and the cached graph is
 * missing all of them — and with them the service-to-service edges they imply.
 * The shape is unchanged, which is precisely why this needs a bump: a v2 file is
 * structurally valid and would be trusted, handing an upgraded user a graph that
 * is materially smaller than the truth with nothing to indicate it. Measured on
 * the shopfront fixture: 32 function-graph nodes from the stale cache against 35
 * from a correct scan, the three missing ones being a datastore, a service and a
 * topic that no longer appeared connected to anything.
 */
export const GRAPH_CACHE_VERSION = 3;

/**
 * The part key for every file that sits under no package manifest — the repo root's
 * own files, `docs/`, `tools/`, a single-package repo in its entirety. Angle brackets
 * because they cannot occur in a repo-relative path, so this can never collide with a
 * real directory.
 */
export const ROOT_PART = '<root>';

/**
 * Filenames that mark a directory as a package root. Deliberately a manifest list and
 * not a path convention: `packages/*` is one ecosystem's habit, whereas "the directory
 * that declares a package" is what every ecosystem actually agrees on, and it is the
 * same evidence `scanRepo`'s own discovery uses to find services.
 */
const PART_MANIFESTS = new Set([
  'package.json',
  'go.mod',
  'pyproject.toml',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
]);

/**
 * Upper bound on distinct parts. A repo that trips this (a fixture tree with a
 * manifest in every directory, a vendored monorepo) falls back to ONE part, which is
 * exactly the pre-W1.4 behaviour — degrading to a coarser cache is always safe, and a
 * signature map with thousands of entries would cost more to write than it saves.
 */
const MAX_PARTS = 512;

/** Per-part content signatures for one repo at one instant, under one set of scan options. */
export interface PartSignatures {
  /** partKey → sha256 over that part's file stats, with the scan options folded in. */
  parts: Record<string, string>;
  /**
   * The part directories these signatures were computed against, repo-relative and
   * POSIX-separated, DEEPEST FIRST — the order in which a file's owning part is
   * decided, so a nested package beats its parent.
   */
  dirs: string[];
  /** The whole-repo signature: a hash over the map above. Identical contract to before. */
  signature: string;
}

interface GraphCacheFile {
  version: number;
  signature: string;
  /** partKey → the signature that part had when this graph was scanned. */
  parts?: Record<string, string>;
  /** The part directories in force at scan time, deepest first. */
  dirs?: string[];
  graph: ArchGraph;
}

/**
 * Walk the repo tree yielding every regular file's absolute path, applying the
 * SAME ignore rules as the scanner's `walkFiles` (scan.ts): dot-directories are
 * skipped (so `.git`, and critically `.sequence/` — the cache's own home — are
 * never inputs to their own signature, which would self-invalidate forever) plus
 * the shared {@link IGNORE_DIRS} (node_modules, dist, …). `.env` is the sole
 * dotfile kept, matching the scanner exactly. Mirrored rather than imported so
 * the scanner file stays untouched; the ignore SET itself is imported so the two
 * can never drift apart.
 */
function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir mid-walk — skip, never throw
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

/** The scan options that actually change the emitted graph — folded into the signature. */
function normalizeScanOpts(opts: ScanOptions | undefined): string {
  return JSON.stringify({
    cluster: opts?.cluster ?? true,
    llm: opts?.llm ?? false,
    maxFiles: opts?.maxFiles ?? 20_000,
  });
}

/**
 * Repo-relative POSIX form. Every part key, part directory and membership test uses
 * it, so a signature computed on Windows names the same parts as one computed on
 * macOS and a cache file is not silently repo-local to one separator convention.
 */
function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

/** Deepest-first, then lexicographic — a total order, so `dirs` is deterministic. */
function byDepthDesc(a: string, b: string): number {
  const da = a.split('/').length;
  const db = b.split('/').length;
  return db - da || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Which part owns `relPosix`? The DEEPEST part directory that contains it, or
 * {@link ROOT_PART} when no manifest sits above it. `dirs` must be deepest-first.
 *
 * A directory that IS a part belongs to itself (`packages/web` → `packages/web`), which
 * is what puts the `svc:` node for a package into its own slice rather than the root's.
 */
export function partOf(relPosix: string, dirs: string[]): string {
  for (const d of dirs) {
    if (relPosix === d || relPosix.startsWith(`${d}/`)) return d;
  }
  return ROOT_PART;
}

/**
 * A memo from whole-repo signature → the parts that produced it, so
 * {@link writeCachedGraph} can persist the part map without recomputing it and
 * without changing its three-argument shape for existing callers.
 *
 * A lookup is exact by construction and cannot go stale: the key IS the sha256 over
 * the value, so a hit means the caller is writing the very parts that were hashed.
 * Bounded to {@link MEMO_MAX} entries, oldest evicted first, because a long-lived app
 * server signs the same repo hundreds of times a session.
 */
const MEMO_MAX = 16;
const partsMemo = new Map<string, PartSignatures>();

function rememberParts(sigs: PartSignatures): void {
  partsMemo.delete(sigs.signature);
  partsMemo.set(sigs.signature, sigs);
  while (partsMemo.size > MEMO_MAX) {
    const oldest = partsMemo.keys().next();
    if (oldest.done) break;
    partsMemo.delete(oldest.value);
  }
}

/**
 * Per-part content signatures over the repo, using ONLY `stat` (no file reads).
 * Measured on this repository: **75–78 ms** for 1,133 files across 14 parts, against
 * **54 ms** for the whole-tree hash it replaces. The partitioning costs ~22 ms and
 * buys the ability to answer which package moved — a trade worth naming rather than
 * hiding, since the thing it saves is a 3.3–4.7 s re-crawl.
 *
 * One walk does two jobs: it collects `relpath\0mtimeMs\0size` for every file, and it
 * notices every {@link PART_MANIFESTS} file, which is what defines the parts. Each
 * part's signature is the sha256 of its own sorted lines plus the scan-relevant
 * options; the whole-repo signature is the sha256 over the resulting `partKey\0partSig`
 * pairs. That keeps every property the single hash had — same content ⇒ same string,
 * any add/remove/edit or option change ⇒ a different one — while making it answerable
 * WHICH part moved.
 */
export async function computePartSignatures(
  repoRoot: string,
  scanOpts?: ScanOptions
): Promise<PartSignatures> {
  const root = path.resolve(repoRoot);
  const optsLine = `opts:${normalizeScanOpts(scanOpts)}\n`;

  /** relPosix → the stat line for that file. */
  const lines: [string, string][] = [];
  const partDirs = new Set<string>();
  for (const abs of walkFiles(root)) {
    const relPosix = toPosix(path.relative(root, abs));
    if (PART_MANIFESTS.has(path.basename(abs))) {
      const dir = relPosix.includes('/') ? relPosix.slice(0, relPosix.lastIndexOf('/')) : '';
      // The repo root is never its own part — everything under no OTHER manifest is
      // ROOT_PART already, and making the root a part would swallow every nested one.
      if (dir) partDirs.add(dir);
    }
    try {
      const st = fs.statSync(abs);
      lines.push([relPosix, `${relPosix}\0${st.mtimeMs}\0${st.size}`]);
    } catch {
      // A file that vanished between readdir and stat still contributes its
      // presence deterministically, so its disappearance later changes the hash.
      lines.push([relPosix, `${relPosix}\0!\0!`]);
    }
  }

  const dirs = partDirs.size > MAX_PARTS ? [] : [...partDirs].sort(byDepthDesc);

  const grouped = new Map<string, string[]>();
  // Every part directory gets a bucket up front, so a package that currently holds
  // only ignored files still has a (stable, empty-set) signature rather than
  // silently disappearing from the map and reappearing when a file lands in it.
  for (const d of dirs) grouped.set(d, []);
  grouped.set(ROOT_PART, []);
  for (const [relPosix, line] of lines) {
    const key = partOf(relPosix, dirs);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(line);
    else grouped.set(key, [line]);
  }

  const parts: Record<string, string> = {};
  for (const [key, bucket] of grouped) {
    bucket.sort();
    const h = createHash('sha256');
    h.update(optsLine);
    // The part's own key goes into its hash so that two parts holding no walked
    // files at all do not share one signature. Nothing compares signatures ACROSS
    // keys today; this makes it safe if something ever does.
    h.update(`part:${key}\n`);
    for (const line of bucket) h.update(line + '\n');
    parts[key] = h.digest('hex');
  }

  const whole = createHash('sha256');
  whole.update(optsLine);
  for (const key of Object.keys(parts).sort()) whole.update(`${key}\0${parts[key]}\n`);

  const sigs: PartSignatures = { parts, dirs, signature: whole.digest('hex') };
  rememberParts(sigs);
  return sigs;
}

/**
 * The whole-repo content signature. Unchanged contract: two calls with no change on
 * disk return the same string; any file add/remove/edit (or an option change) returns
 * a different one. It is now derived from {@link computePartSignatures} — a hash over
 * the per-part hashes — so the two can never disagree about whether a repo changed.
 */
export async function computeSignature(
  repoRoot: string,
  scanOpts?: ScanOptions
): Promise<string> {
  return (await computePartSignatures(repoRoot, scanOpts)).signature;
}

/**
 * Read `<repo>/.sequence/graph.json`. Returns `{ signature, graph, parts, dirs }` on a
 * valid, current-version file; returns `null` for a missing / corrupt / wrong-version /
 * malformed file. NEVER throws — a bad cache always degrades to a fresh scan.
 *
 * `parts`/`dirs` are `{}`/`[]` rather than absent on a file written by a caller that
 * did not have them, so a part read is a clean miss instead of a crash.
 */
/**
 * When this analyzer build was produced.
 *
 * A cache older than the code that would rebuild it cannot be trusted, no matter
 * how well its content signature matches: the SIGNATURE describes the repository
 * and the VERSION describes the file format, and neither notices that the
 * scanner itself now answers differently.
 *
 * That gap is not hypothetical — it cost real time on 2026-08-21. The scanner
 * was changed three times in a session (Python submodule imports resolving to
 * the submodule, test files excluded from the architecture view, datastores
 * inferred from table access). Every one changes what a scan RETURNS while
 * changing neither the repo nor the format, so a cache written minutes earlier
 * kept being served: the app showed 969 edges and no datastore while a direct
 * scan of the same repo returned 1335 edges and one, and the difference looked
 * like a bug in the new code rather than a stale file.
 *
 * Bumping `GRAPH_CACHE_VERSION` by hand works and is still right for a FORMAT
 * change, but it relies on remembering, and the failure is silent when you do
 * not. The build's own mtime needs no discipline. This is the same idea as the
 * `?expect_build=<fingerprint>` handshake ml-harness uses between its launcher
 * and its engine, which is where the shape was borrowed from.
 */
const BUILD_MTIME_MS = (() => {
  try {
    return fs.statSync(url.fileURLToPath(import.meta.url)).mtimeMs;
  } catch {
    return 0; // unknowable (bundled, virtual fs) — fall back to version + signature alone
  }
})();

export function readCachedGraph(
  repoRoot: string
): { signature: string; graph: ArchGraph; parts: Record<string, string>; dirs: string[] } | null {
  const p = path.join(repoRoot, SEQUENCE_DIR, GRAPH_CACHE_FILE);
  try {
    if (!fs.existsSync(p)) return null;
    // Written by an older analyzer than the one asking — see BUILD_MTIME_MS.
    if (BUILD_MTIME_MS > 0 && fs.statSync(p).mtimeMs < BUILD_MTIME_MS) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<GraphCacheFile>;
    if (
      !parsed ||
      parsed.version !== GRAPH_CACHE_VERSION ||
      typeof parsed.signature !== 'string' ||
      !parsed.graph ||
      typeof parsed.graph !== 'object'
    ) {
      return null;
    }
    const parts =
      parsed.parts && typeof parsed.parts === 'object' ? (parsed.parts as Record<string, string>) : {};
    const dirs = Array.isArray(parsed.dirs) ? (parsed.dirs as string[]) : [];
    return { signature: parsed.signature, graph: parsed.graph as ArchGraph, parts, dirs };
  } catch {
    return null; // corrupt / unreadable — treat as no cache
  }
}

/**
 * Persist `graph` under `<repo>/.sequence/graph.json` tagged with `signature` and
 * the format version. The graph is stored VERBATIM (including its `scannedAt`),
 * so a later cache hit re-serves the exact same timestamp — which is what keeps
 * the `scannedAt`-keyed explain cache valid across re-opens. Best-effort: a
 * read-only `.sequence` must never crash an attach, so a write failure is
 * swallowed (the scan already succeeded in memory).
 *
 * `sigs` may be passed explicitly; when it is not, the part map is recovered from the
 * memo by the signature itself (see {@link partsMemo}), so the three-argument call
 * every existing caller makes still persists a fully part-aware cache.
 */
export function writeCachedGraph(
  repoRoot: string,
  signature: string,
  graph: ArchGraph,
  sigs?: PartSignatures
): void {
  const resolved = sigs && sigs.signature === signature ? sigs : partsMemo.get(signature);
  const payload: GraphCacheFile = {
    version: GRAPH_CACHE_VERSION,
    signature,
    parts: resolved?.parts ?? {},
    dirs: resolved?.dirs ?? [],
    graph,
  };
  try {
    writeJson(repoRoot, GRAPH_CACHE_FILE, payload);
  } catch {
    /* read-only / permissions — attach still succeeds, next attach just re-scans */
  }
}

/**
 * A signature no content walk can ever produce, used to mark a part (or the whole
 * cache) invalid in place. `computePartSignatures` only ever emits 64 hex characters,
 * so a value carrying `stale:` and a nonce can never be matched by a real one.
 */
function poison(): string {
  return `stale:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

/**
 * Best-effort invalidation of the persisted graph cache. Used after an in-place file
 * write that does NOT itself re-scan (PUT /api/file), so the next attach cannot be
 * fooled into a stale hit on a filesystem with coarse (1s) mtime granularity where a
 * same-size edit might not perturb the signature. An already-absent file is a no-op;
 * never throws.
 *
 * Called with `changedPath`, the invalidation is SCOPED: the whole-repo signature is
 * poisoned (so the next attach still re-crawls — the repo really did change) but only
 * the written file's own part is marked invalid, leaving every other part's entry
 * readable through {@link readCachedPart}. Called without one — which is what every
 * pre-W1.4 caller does — it removes the file outright, byte-for-byte the old behaviour.
 */
export function clearCachedGraph(repoRoot: string, changedPath?: string): void {
  if (changedPath !== undefined) {
    try {
      const cached = readCachedGraph(repoRoot);
      if (cached) {
        const relNative = path.relative(path.resolve(repoRoot), path.resolve(changedPath));
        const relPosix = toPosix(relNative);
        // A path outside the repo cannot be scoped to a part; fall through to the
        // whole-cache removal below rather than guess which part it touched. The
        // `isAbsolute` arm is not redundant on Windows: `path.relative` between two
        // different DRIVES returns an absolute path, not one starting with `..`.
        if (relPosix && !relPosix.startsWith('..') && !path.isAbsolute(relNative)) {
          const key = partOf(relPosix, cached.dirs);
          writeJson(repoRoot, GRAPH_CACHE_FILE, {
            version: GRAPH_CACHE_VERSION,
            signature: poison(),
            parts: { ...cached.parts, [key]: poison() },
            dirs: cached.dirs,
            graph: cached.graph,
          } satisfies GraphCacheFile);
          return;
        }
      }
    } catch {
      /* fall through to the unscoped removal — never leave a half-written cache */
    }
  }
  try {
    fs.rmSync(path.join(repoRoot, SEQUENCE_DIR, GRAPH_CACHE_FILE), { force: true });
  } catch {
    /* already gone / read-only — the signature check still guards honesty */
  }
}

/** One part's slice of a graph, plus what the slice deliberately left out. */
export interface GraphPart {
  /** The part this slice belongs to (a directory, or {@link ROOT_PART}). */
  part: string;
  /** The signature the part had when the graph was scanned. */
  signature: string;
  /** The `scannedAt` of the graph this slice came from — a fresh scan carries a new one. */
  scannedAt: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  /**
   * Edges that touch this part but whose evidence lies (partly) outside it, and which
   * are therefore NOT in `edges` — a cross-package import, an HTTP call between two
   * services. Counted rather than dropped silently, for the same reason
   * `GraphQueryAnswer` carries `omitted`: a grounded answer that quietly loses facts
   * is worse than one that says how many it lost. A caller that needs these must scan.
   */
  omittedCrossPart: number;
}

/**
 * Slice `graph` down to the nodes and edges that belong to `part`.
 *
 * The rule is deliberately conservative, and it is what makes a surviving part entry
 * HONEST rather than merely fast: a node is in the slice when its own `path` lives in
 * the part, and an edge is in the slice when BOTH endpoints are and EVERY piece of its
 * evidence cites a file inside it. So every fact in a slice was derived from bytes
 * inside that part — which is exactly the set of bytes the part's signature covers.
 * Change nothing in the part and the slice cannot have changed either.
 *
 * A node with NO `path` — the `repo` node, and the `datastore`/`topic` nodes a compose
 * or k8s manifest implies — is in no slice at all, and every edge touching one lands in
 * `omittedCrossPart`. That is deliberate: those nodes are repo-global, so no single
 * part's signature can vouch for them, and quietly filing them under {@link ROOT_PART}
 * would be a guess dressed as a fact.
 *
 * The converse is the omission, and it is reported: an edge whose evidence sits in
 * ANOTHER part (a `packages/mcp` file importing a `packages/web` one) is not in the
 * `packages/web` slice, because a write in `packages/mcp` could have created or
 * removed it and this part's signature would not know.
 *
 * ONE CAVEAT, found while locking this and true of the cache generally rather than of
 * slicing: `ArchEdge.id` is NOT content-derived. An import edge is `imp${++importSeq}`
 * (`scan.ts:789`), an ordinal over the whole scan, so adding a file anywhere renumbers
 * every import edge discovered after it. A slice served from cache therefore carries
 * the ids of the scan that built it, which a later fresh scan of a changed repo will
 * not reproduce. Everything that identifies an edge in substance — `srcId`, `dstId`,
 * `kind`, `confidence`, `origin`, `evidence` — is stable; only the ordinal is not.
 * Do not join a cached slice to a fresh graph on `id`.
 */
export function slicePart(
  graph: ArchGraph,
  part: string,
  sigs: Pick<PartSignatures, 'dirs'>
): { nodes: ArchNode[]; edges: ArchEdge[]; omittedCrossPart: number } {
  const dirs = sigs.dirs;
  const inPart = (p: string | undefined): boolean =>
    typeof p === 'string' && p.length > 0 && partOf(toPosix(p), dirs) === part;

  const nodes = (graph.nodes ?? []).filter((n) => inPart(n.path));
  const ids = new Set(nodes.map((n) => n.id));

  const edges: ArchEdge[] = [];
  let omittedCrossPart = 0;
  for (const e of graph.edges ?? []) {
    const touches = ids.has(e.srcId) || ids.has(e.dstId);
    if (!touches) continue;
    const bothEnds = ids.has(e.srcId) && ids.has(e.dstId);
    const evidence = e.evidence ?? [];
    // An edge with NO evidence is omitted rather than kept: `every` on an empty array
    // is vacuously true, and "no file grounds this edge" is precisely the case a part
    // signature cannot vouch for. Import edges always carry evidence
    // (`manifestless.test.ts` locks that), so this only ever catches the ungrounded.
    const evidenceInside = evidence.length > 0 && evidence.every((ev) => inPart(ev.file));
    if (bothEnds && evidenceInside) edges.push(e);
    else omittedCrossPart += 1;
  }
  return { nodes, edges, omittedCrossPart };
}

/**
 * Read ONE part's slice of the persisted graph, WITHOUT scanning — the whole point of
 * W1.4. Returns `null` when there is no cache, when this part is not in it, or when
 * the part's bytes have changed since the graph was scanned. Never throws.
 *
 * `sigs` is the CURRENT {@link computePartSignatures} for the repo (75–78 ms on this
 * repository). The comparison is per part, so a write in `packages/mcp` misses on
 * `packages/mcp` and hits on every other part — a write no longer invalidates the rest.
 *
 * The returned `scannedAt` is the cached graph's own, so a caller can prove no scan
 * ran: a fresh `scanRepo` always carries a new timestamp.
 */
export function readCachedPart(
  repoRoot: string,
  part: string,
  sigs: PartSignatures
): GraphPart | null {
  const cached = readCachedGraph(repoRoot);
  if (!cached) return null;
  const was = cached.parts[part];
  const now = sigs.parts[part];
  if (typeof was !== 'string' || typeof now !== 'string' || was !== now) return null;
  // Slice against the dirs the graph was BUILT under. A reshaping of the part
  // directories that affected this part would have moved files in or out of it and
  // therefore changed its signature, so reaching here means the two agree.
  const { nodes, edges, omittedCrossPart } = slicePart(cached.graph, part, { dirs: cached.dirs });
  return {
    part,
    signature: was,
    scannedAt: String((cached.graph as { scannedAt?: string }).scannedAt ?? ''),
    nodes,
    edges,
    omittedCrossPart,
  };
}

/**
 * Which parts have changed since the persisted graph was scanned? `null` means there
 * is no usable cache at all. An empty array means nothing moved — the whole-graph hit
 * path applies.
 */
export function changedParts(
  repoRoot: string,
  sigs: PartSignatures
): string[] | null {
  const cached = readCachedGraph(repoRoot);
  if (!cached) return null;
  const keys = new Set([...Object.keys(cached.parts), ...Object.keys(sigs.parts)]);
  return [...keys].filter((k) => cached.parts[k] !== sigs.parts[k]).sort();
}

/**
 * Scan a repo, reusing the persisted graph when its content is unchanged.
 *
 * This is the one place the cache is applied, so every caller that wants it gets the
 * SAME signature rules. It lives here rather than inside `scanRepo` because
 * `graphCache` already imports from `scan`, and putting the call the other way round
 * would make an import cycle out of two modules that are currently a clean layer.
 *
 * Opt-in by construction: a caller has to choose this function. That matters — the
 * analyzer's fixture tests call `scanRepo` directly and MUST keep exercising the real
 * scanner, and a cache applied by default would have turned a second fixture scan
 * into a cache hit and quietly stopped the suite testing anything.
 *
 * Measured on the Sequence monorepo: 3.96s cold, 0.38s warm — 10.4x — with a touched
 * source file correctly forcing a rescan. A changed part still forces that rescan
 * (see the header: `scanRepo` is whole-repo); what W1.4 changes is that every OTHER
 * part stays answerable from {@link readCachedPart} while it runs and afterwards.
 */
export async function scanRepoCached(
  repoRoot: string,
  opts: ScanOptions = {},
): Promise<ArchGraph> {
  let sigs: PartSignatures | null = null;
  try {
    sigs = await computePartSignatures(repoRoot, opts);
    const hit = readCachedGraph(repoRoot);
    if (hit && hit.signature === sigs.signature) return hit.graph;
  } catch {
    // An unreadable tree or cache is not an error here — fall through to a real scan.
  }
  const graph = await scanRepo(repoRoot, opts);
  if (sigs) {
    try {
      writeCachedGraph(repoRoot, sigs.signature, graph, sigs);
    } catch {
      // A read-only repo still gets its graph; the cache is never a dependency.
    }
  }
  return graph;
}
