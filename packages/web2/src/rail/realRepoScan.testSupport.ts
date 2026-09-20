import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';
import type { ArchGraph, FunctionGraph } from '@sequence/schema';

/*
 * `cluster` IS A BOOLEAN, NOT THE LITERAL `false`.
 *
 * This local declaration of the analyzer's surface pinned both flags to the
 * literal types the one existing caller happened to pass. That is narrower than
 * the real `scanRepo`, which every production caller invokes with
 * `{ cluster: true }` (cli.ts, askCli.ts, diagramCli.ts, eval/grade.ts), and it
 * failed the build the moment clustering became opt-in here rather than never.
 * `llm` is widened with it for the same reason: a declaration that only admits
 * the argument already being passed cannot describe a seam.
 */
interface AnalyzerEngine {
  scanRepo: (
    repoRoot: string,
    options: { cluster: boolean; llm: boolean },
  ) => Promise<ArchGraph>;
  buildRepoFunctionGraph: (
    repoRoot: string,
    options: { cluster: boolean; llm: boolean },
    graph: ArchGraph,
  ) => Promise<FunctionGraph>;
}

export interface RealRepoScan {
  graph: GetArchGraphResponse;
  functions: GetFunctionsResponse;
}

function readCaches(repoRoot: string): RealRepoScan | null {
  if (process.env.SEQUENCE_WEB2_FRESH_SCAN === '1') return null;

  const graphPath = join(repoRoot, '.sequence', 'graph.json');
  const functionsPath = join(repoRoot, '.sequence', 'functions.json');
  if (!existsSync(graphPath) || !existsSync(functionsPath)) return null;

  const graphFile = JSON.parse(readFileSync(graphPath, 'utf8')) as {
    graph?: Omit<GetArchGraphResponse, 'nodeDetail'> & {
      nodeDetail?: GetArchGraphResponse['nodeDetail'];
    };
  };
  const functionFile = JSON.parse(readFileSync(functionsPath, 'utf8')) as {
    functionGraph?: GetFunctionsResponse['functionGraph'];
    warnings?: unknown;
  };
  if (!graphFile.graph || !functionFile.functionGraph) return null;

  return {
    graph: { ...graphFile.graph, nodeDetail: graphFile.graph.nodeDetail ?? {} },
    functions: {
      functionGraph: functionFile.functionGraph,
      warnings: Array.isArray(functionFile.warnings) ? (functionFile.warnings as string[]) : [],
    },
  };
}

/**
 * The engine's real result for this checkout.
 *
 * CI starts without the gitignored `.sequence` cache. A missing cache therefore
 * triggers the same deterministic, key-free scanner and function builder the
 * analyzer exports; it never turns the claimed real-repo checks into skips.
 * The override exists so the fallback can be exercised without moving a
 * developer's cache out from under another process.
 */
export async function loadRealRepoScan(
  repoRoot: string,
  opts: { cluster?: boolean } = {},
): Promise<RealRepoScan> {
  const cached = readCaches(repoRoot);
  if (cached) return cached;

  /*
   * CLUSTERING IS OPT-IN BECAUSE THE FALLBACK IS NOT SHAPE-IDENTICAL TO THE
   * CACHE, AND THAT COST A RED MAIN.
   *
   * The comment above is right that the fallback is deterministic and key-free.
   * What it does not say is that `cluster: false` makes it STRUCTURALLY
   * different: module nodes are Louvain clusters, so without clustering the
   * graph has NONE, and every file hangs directly off its service.
   *
   * A developer machine that has run the app has `.sequence/graph.json` — the
   * clustered graph the PRODUCT builds — so a module-dependent test passes
   * locally and fails on any clean checkout. The anatomy locks did exactly
   * that: `server`, `llm` and the three "Top level" modules were all undefined
   * on CI, and 137 production files appeared loose under `analyzer`. A lock
   * that asserts a property of a gitignored file is not a lock.
   *
   * `{ cluster: true }` is what every real caller uses (`cli.ts`, `askCli.ts`,
   * `diagramCli.ts`, `eval/grade.ts`), and it needs no key. It is opt-in rather
   * than the default only so existing callers keep the cheaper scan they were
   * written against.
   */
  const options = { cluster: opts.cluster === true, llm: false } as const;
  /* CI builds every package before it runs web2 tests, so this is the analyzer
     artifact CI actually executes. Use a file: URL from repoRoot — vitest can
     rewrite `new URL(..., import.meta.url)` to http:, which Node's ESM loader
     refuses. */
  const { pathToFileURL } = await import('node:url');
  const analyzerUrl = pathToFileURL(join(repoRoot, 'packages/analyzer/dist/index.js')).href;
  const { scanRepo, buildRepoFunctionGraph } = (await import(
    /* @vite-ignore */ analyzerUrl
  )) as AnalyzerEngine;
  const graph = await scanRepo(repoRoot, options);
  const functionGraph = await buildRepoFunctionGraph(repoRoot, options, graph);
  return {
    graph: { ...graph, nodeDetail: {} },
    functions: { functionGraph, warnings: [] },
  };
}
