import fs from 'node:fs';
import path from 'node:path';
import type { ArchGraph, FunctionGraph } from '@sequence/schema';
import { toRelPosix } from '../relPosix.js';
import { extractFacts } from '../parse/facts.js';
import { noteSharedFactsCacheHit, takeSharedFacts, type SharedFileFacts } from '../parse/sharedFacts.js';
import { initParser } from '../parse/treesitter.js';
import { realpathContained } from '../server/jail.js';
import {
  IGNORE_DIRS,
  MAX_FILE_BYTES,
  resolveDiscovery,
  resolveImport,
  type ScanOptions,
} from '../scan.js';
import type { FunctionFact, Lang } from '../types.js';
import { buildFunctionGraph } from './buildFunctionGraph.js';
import { enrichWithCrossServiceEdges } from './crossServiceEdges.js';
import { readGoModulePath } from './goResolve.js';

const LANG_BY_EXT: Record<string, Lang> = {
  '.ts': 'ts',
  '.tsx': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
  '.go': 'go',
  '.java': 'java',
};

function* walkFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
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

function isGenerated(file: string): boolean {
  const base = path.basename(file);
  return /_pb2(_grpc)?\.py$|\.min\.js$|\.bundle\.js$|_pb\.(js|ts)$|\.pb\.go$|_grpc\.pb\.go$|_test\.go$|Grpc\.java$/.test(
    base
  );
}

const EMPTY: FunctionGraph = { nodes: [], edges: [] };

/**
 * Walk the attached repo's app-service source trees (same walk + `extractFacts`
 * filters as `scanRepo`), collect per-file function facts, and build a grounded
 * function graph with intra/cross-file calls and arch-attributed cross-service
 * edges. Pure over disk contents, deterministic, never throws.
 */
export async function buildRepoFunctionGraph(
  repoRoot: string,
  opts: ScanOptions = {},
  archGraph?: ArchGraph
): Promise<FunctionGraph> {
  try {
    const abs = path.resolve(repoRoot);
    if (!fs.existsSync(abs)) return EMPTY;

    const rootReal = fs.realpathSync(abs);
    const withinRoot = (candidateAbs: string): boolean => {
      const real = realpathContained(candidateAbs);
      return real === rootReal || real.startsWith(rootReal + path.sep);
    };

    await initParser();

    /**
     * THE SAME discovery decision `scanRepo` makes — not a second, shorter
     * re-implementation of it. See {@link resolveDiscovery}: this used to stop
     * at compose/k8s/code-first and miss the "the manifest points at no code"
     * correction, which is why sqlfluff's function graph was empty while its
     * arch graph had 456 files. `NoManifestsError` (nothing to scan at all)
     * stays an empty graph, exactly as before.
     */
    let discovery;
    try {
      discovery = resolveDiscovery(abs, withinRoot).discovery;
    } catch {
      return EMPTY;
    }

    /**
     * U23 — the parse output of the scan that just ran over this same root, if
     * there was one. A hit skips read+parse for that file; a miss (no scan, a
     * different repo, a file the scan never reached, or a file changed since)
     * falls through to the original read+`extractFacts` below. See
     * `parse/sharedFacts.ts` for why a hit is equivalent to re-parsing.
     */
    const shared = takeSharedFacts(rootReal);

    const fileInputs: Parameters<typeof buildFunctionGraph>[0] = [];
    const functionsByFile = new Map<string, FunctionFact[]>();
    /**
     * A FILE IS INGESTED ONCE, by the first service that reaches it.
     *
     * App service dirs nest — most often when one service's build context is
     * the repo root while real apps live beneath it, which is exactly the shape
     * {@link resolveDiscovery} now folds in. Ingesting a file twice would emit
     * the same `functionNodeId` twice (edge ids dedupe; node ids do not), so
     * the graph would carry duplicate nodes. `scanRepo` solves the same problem
     * with `excludedPrefixesFor`; this is the same rule stated as first-wins,
     * over the same deterministic walk order.
     */
    const ingested = new Set<string>();
    let fileCount = 0;
    const maxFiles = opts.maxFiles ?? 20_000;

    for (const service of discovery.services) {
      if (service.role !== 'app' || !service.dir) continue;
      const dirAbs = path.join(abs, service.dir);
      if (!withinRoot(dirAbs)) continue;

      // ONE walk per service. This used to walk the whole service tree twice —
      // once to collect `serviceRelPaths` for import resolution and once to
      // parse — which is a second full `readdirSync`/`statSync` sweep of every
      // directory in the repo for no new information. The two loops applied
      // IDENTICAL filters (extension + `isGenerated`) and `walkFiles` is
      // deterministic, so the collected list is exactly what the second walk
      // would have yielded, in the same order.
      const serviceFiles: { abs: string; rel: string; lang: Lang }[] = [];
      for (const fileAbs of walkFiles(dirAbs)) {
        const lang = LANG_BY_EXT[path.extname(fileAbs)];
        if (!lang) continue;
        if (isGenerated(fileAbs)) continue;
        // POSIX, and it MUST match what scanRepo recorded: this rel is the key
        // into the shared parse capture and the id of every function node. See
        // relPosix.ts and the equivalence argument in parse/sharedFacts.ts.
        serviceFiles.push({ abs: fileAbs, rel: toRelPosix(path.relative(abs, fileAbs)), lang });
      }
      const fileSet = new Set(serviceFiles.map((f) => f.rel));
      const goModulePath = serviceFiles.some((f) => f.lang === 'go')
        ? readGoModulePath(abs, service.dir!)
        : undefined;

      for (const { abs: fileAbs, rel, lang } of serviceFiles) {
        if (ingested.has(rel)) continue;
        if (++fileCount > maxFiles) break;
        ingested.add(rel);

        try {
          const stat = fs.statSync(fileAbs);
          if (stat.size > MAX_FILE_BYTES) continue;
          const hit = shared?.get(rel);
          let facts: SharedFileFacts;
          if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) {
            noteSharedFactsCacheHit();
            facts = hit.facts;
          } else {
            const src = fs.readFileSync(fileAbs, 'utf8');
            facts = extractFacts(src, rel, lang);
          }
          functionsByFile.set(facts.file, facts.functions);
          const imports = facts.imports.map((imp) => ({
            raw: imp.raw,
            line: imp.line,
            resolved: resolveImport(
              facts.file,
              imp.raw,
              facts.language,
              service.dir!,
              fileSet,
              goModulePath
            ),
            names: imp.names,
            moduleGranular: imp.moduleGranular,
          }));
          fileInputs.push({
            file: facts.file,
            lang: facts.language,
            functions: facts.functions,
            calls: facts.calls,
            imports,
            loc: facts.loc,
            // U33 — Java only; `undefined` for every other language.
            ...(facts.varTypes ? { varTypes: facts.varTypes } : {}),
            ...(facts.goPackageName ? { goPackageName: facts.goPackageName } : {}),
          });
        } catch {
          /* skip unreadable files — never abort the whole graph */
        }
      }
    }

    const base = buildFunctionGraph(fileInputs);
    return enrichWithCrossServiceEdges(base, archGraph, functionsByFile);
  } catch {
    return EMPTY;
  }
}
