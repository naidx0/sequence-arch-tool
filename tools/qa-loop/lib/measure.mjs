/**
 * One repo, end to end — the measurement itself.
 *
 * This module is loaded **inside a child process** (`lib/child.mjs`), one child
 * per repo. That is not a detail: tree-sitter's syntax trees live in a WASM heap
 * that never returns memory to the OS, and a long-lived process measuring 27
 * repositories back to back degrades badly regardless of how carefully every
 * tree is freed. A fresh process per repo gives a fresh WASM heap, so a repo's
 * cost depends on the repo and not on its position in the run.
 *
 * Nothing here re-implements the engine: every number comes from a shipped
 * function, read out of `dist/` exactly as `pnpm grade` consumes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './manifest.mjs';
import {
  countNodes,
  evidenceStats,
  evidenceResolutionStats,
  fallbackTitleStats,
  duplicateTitleStats,
  promptSizeStats,
  stemFlowStats,
} from './metrics.mjs';

// ---------------------------------------------------------------------------
// Engine imports. These are the COMPILED artefacts, exactly as `pnpm grade`
// consumes them — the harness measures what ships, not what the sources say.
// `stemFlow.ts` is web-side source with type-only imports, loaded directly via
// Node's type stripping (Node >= 22.18); there is no compiled copy of it.
// ---------------------------------------------------------------------------
export const DIST = {
  scan: path.join(REPO_ROOT, 'packages/analyzer/dist/scan.js'),
  score: path.join(REPO_ROOT, 'packages/analyzer/dist/score.js'),
  explain: path.join(REPO_ROOT, 'packages/analyzer/dist/explain/explain.js'),
  fnGraph: path.join(REPO_ROOT, 'packages/analyzer/dist/functions/repoFunctionGraph.js'),
  schema: path.join(REPO_ROOT, 'packages/schema/dist/index.js'),
  stemFlow: path.join(REPO_ROOT, 'packages/web/src/graph/stemFlow.ts'),
};

export async function loadEngine() {
  const missing = Object.entries(DIST)
    .filter(([, p]) => !fs.existsSync(p))
    .map(([k, p]) => `${k}: ${path.relative(REPO_ROOT, p)}`);
  if (missing.length > 0) {
    throw new Error(
      `the engine is not built — run \`pnpm -r build\` first.\nMissing:\n  - ${missing.join('\n  - ')}`
    );
  }
  const imp = (p) => import(pathToFileURL(p).href);
  const [scan, score, explain, fnGraph, schema, stemFlow] = await Promise.all([
    imp(DIST.scan),
    imp(DIST.score),
    imp(DIST.explain),
    imp(DIST.fnGraph),
    imp(DIST.schema),
    imp(DIST.stemFlow),
  ]);
  return {
    scanRepo: scan.scanRepo,
    scoreGraph: score.scoreGraph,
    buildStructuralTree: explain.buildStructuralTree,
    buildDigest: explain.buildDigest,
    buildAskPrompt: explain.buildAskPrompt,
    buildRepoFunctionGraph: fnGraph.buildRepoFunctionGraph,
    validateGraph: schema.validateGraph,
    detectStemCandidates: stemFlow.detectStemCandidates,
    /**
     * U30 — the function the CANVAS calls (`canvas/GroupedCanvas.tsx:840`) to
     * decide whether "Show main flow" acts on a click. The harness asks the
     * product's own question with the product's own code; `stemPlays` is not a
     * re-derivation.
     */
    mainFlowState: stemFlow.mainFlowState,
  };
}

/**
 * A `file -> line count` resolver over one clone, for
 * {@link evidenceResolutionStats}. Evidence paths are repo-relative (that is
 * what `scanRepo` records), so they are resolved against the scanned directory.
 *
 * Cached per file, because a repo's edges cite the same files over and over —
 * n8n has 33k edges over 18k files — and because the answer cannot change
 * during one measurement.
 *
 * A file that exists but is too large to count is reported as `Infinity`: it
 * IS openable, which is the question being asked, and reading a 50MB minified
 * bundle to know that would be a self-inflicted timeout.
 */
export function lineCountResolver(dir, maxBytes = 4 * 1024 * 1024) {
  /** @type {Map<string, number|null>} */
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let out = null;
    try {
      const abs = path.resolve(dir, file);
      // A path that escapes the clone is not this repo's evidence.
      const rel = path.relative(dir, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        cache.set(file, null);
        return null;
      }
      const st = fs.statSync(abs);
      if (!st.isFile()) out = null;
      else if (st.size > maxBytes) out = Infinity;
      else {
        const text = fs.readFileSync(abs, 'utf8');
        // Trailing newline does not add a line a user can be sent to.
        out = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      }
    } catch {
      out = null;
    }
    cache.set(file, out);
    return out;
  };
}

/**
 * Peak process RSS while this repo runs.
 *
 * One repo owns the whole child process, so unlike the old single-process
 * harness this IS a per-repo footprint — the interpreter's own baseline
 * included, which is a few tens of MB and named as such in the README.
 */
export function rssSampler(intervalMs = 250) {
  let peak = process.memoryUsage.rss();
  const t = setInterval(() => {
    const now = process.memoryUsage.rss();
    if (now > peak) peak = now;
  }, intervalMs);
  t.unref?.();
  return {
    stop() {
      clearInterval(t);
      const now = process.memoryUsage.rss();
      if (now > peak) peak = now;
      return Math.round((peak / (1024 * 1024)) * 10) / 10;
    },
  };
}

export function serializeError(err) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? null };
  return { name: 'NonError', message: String(err), stack: null };
}

/**
 * The shape every failure row shares, whatever killed it — a clone that never
 * landed, a scan that threw, a child the parent had to kill. One shape means a
 * downstream consumer never has to ask which kind of red it is looking at.
 */
export function failureRow(row, dir, elapsedMs, error, rssMb = null) {
  return {
    id: row.id,
    sha: row.sha,
    dir: dir ?? null,
    negativeCase: row.negativeCase === true,
    why: row.why ?? null,
    ok: false,
    elapsedMs,
    rssMb,
    counts: null,
    evidencePct: null,
    evidenceResolvedPct: null,
    fallbackTitlePct: null,
    dupTitleCount: null,
    promptChars: null,
    promptSize: null,
    stemFound: null,
    stemPlays: null,
    stemHops: null,
    scoreVsTruth: null,
    warnings: [],
    error,
  };
}

/**
 * @returns a JSONL row: full stacks and verbatim warnings. This is TRIAGE data,
 * not user display — nothing here is trimmed for looks.
 */
export async function measureRepo(engine, row, dir, opts) {
  const started = Date.now();
  const rss = rssSampler();
  const base = {
    id: row.id,
    sha: row.sha,
    dir,
    negativeCase: row.negativeCase === true,
    why: row.why ?? null,
  };
  try {
    const scanOpts = { cluster: true, llm: false };
    if (opts.maxFiles) scanOpts.maxFiles = opts.maxFiles;
    const graph = await engine.scanRepo(dir, scanOpts);

    const counts = countNodes(graph);
    const problems = engine.validateGraph(graph);
    const evidence = evidenceStats(problems, counts.edges);
    // U30 — does the evidence OPEN, not merely exist. Reads the clone on disk.
    const evidenceResolution = evidenceResolutionStats(graph.edges, lineCountResolver(dir));

    let plainTree = null;
    let treeError = null;
    try {
      plainTree = engine.buildStructuralTree(graph);
    } catch (err) {
      treeError = serializeError(err);
    }
    const fallback = fallbackTitleStats(graph, plainTree);
    const dup = duplicateTitleStats(graph);

    // How big the assembled ask prompt actually is for this repo, and whether a
    // per-site token budget had to cut anything. Additive triage data only —
    // nothing here gates the run.
    let promptSize = null;
    try {
      const digest = engine.buildDigest(graph);
      promptSize = promptSizeStats(
        JSON.stringify(digest),
        engine.buildAskPrompt(digest, 'what is fragile?')
      );
    } catch {
      promptSize = null;
    }

    let stemFound = null;
    let stemFlow = null;
    let stem = null;
    let functionGraphCounts = null;
    let stemError = null;
    if (opts.functionGraph) {
      try {
        const fg = await engine.buildRepoFunctionGraph(dir, scanOpts, graph);
        functionGraphCounts = { nodes: fg.nodes.length, edges: fg.edges.length };
        const candidates = engine.detectStemCandidates(graph, fg);
        // U30 — the product's own decision function, not a re-derivation. This
        // is what the canvas evaluates before the user clicks "Show main flow".
        stemFlow = stemFlowStats(engine.mainFlowState(graph, fg), candidates.length);
        stemFound = candidates.length > 0;
        stem = candidates.length > 0
          ? {
              file: candidates[0].file,
              reason: candidates[0].reason,
              count: candidates.length,
              // What the user would actually get from the top candidate.
              plays: stemFlow.stemPlays,
              hops: stemFlow.stemHops,
              message: stemFlow.message,
            }
          : null;
      } catch (err) {
        stemError = serializeError(err);
      }
    }

    let scoreVsTruth = null;
    let graphFile = null;
    if (row.groundTruth) {
      const truthPath = path.resolve(REPO_ROOT, row.groundTruth);
      graphFile = path.join(opts.graphsDir, `${row.id}.graph.json`);
      fs.mkdirSync(opts.graphsDir, { recursive: true });
      fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2));
      // scoreGraph reads paths, not objects — that is the shipped signature
      // (packages/analyzer/src/score.ts), so the graph goes to disk next to the
      // run. It doubles as the one-command repro artefact for a red row.
      const s = engine.scoreGraph(graphFile, truthPath);
      scoreVsTruth = { precision: s.precision, recall: s.recall, truth: row.groundTruth, report: s.report };
    }

    return {
      ...base,
      ok: true,
      elapsedMs: Date.now() - started,
      rssMb: rss.stop(),
      counts,
      evidencePct: evidence.evidencePct,
      evidence,
      evidenceResolvedPct: evidenceResolution.evidenceResolvedPct,
      evidenceResolution,
      fallbackTitlePct: fallback.fallbackTitlePct,
      fallbackTitles: fallback,
      dupTitleCount: dup.dupTitleCount,
      duplicateTitles: dup,
      promptChars: promptSize ? promptSize.promptChars : null,
      promptSize,
      stemFound,
      stemPlays: stemFlow ? stemFlow.stemPlays : null,
      stemHops: stemFlow ? stemFlow.stemHops : null,
      stemFlow,
      stem,
      functionGraph: functionGraphCounts,
      scoreVsTruth,
      graphFile,
      warnings: Array.isArray(graph.warnings) ? graph.warnings : [],
      validationProblems: problems,
      treeError,
      stemError,
      error: null,
    };
  } catch (err) {
    return failureRow(row, dir, Date.now() - started, serializeError(err), rss.stop());
  }
}
