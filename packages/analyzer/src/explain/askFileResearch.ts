/**
 * Ask FILE RESEARCH — capped reads of real repo file bodies for grounded answers.
 *
 * The structure digest carries paths only; this module selects relevant files from
 * that digest (and optional graph selection), reads them through the SAME jail as
 * GET /api/file, and renders an additive prompt section. Nothing here invents edges
 * or paths — every path must come from the digest or a real graph file node.
 */

import type { ArchGraph, ArchNode } from '@sequence/schema';
import fs from 'node:fs';
import { cutTextToBudget, omissionMarker } from '../llm/tokenBudget.js';
import { ASK_INDEX_MAX_FILE_BYTES, bestMatchingWindow, readyAskFileIndex, scoreAskFileHybrid, warmAskFileIndex, type AskFileIndex } from './askFileIndex.js';
import { rankAskFileLtr } from './askLtr.js';
import { neutralizeUntrusted, wrapUntrustedLines } from '../llm/untrusted.js';

/** Minimal digest shape needed for path selection — paths only, from buildDigest. */
export interface AskDigestFiles {
  services: { files: { path: string }[] }[];
}

export interface AskFileResearchBudget {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}

/**
 * ── FILE RESEARCH IS A HINT, NOT THE CONTEXT ──────────────────────────────
 *
 * This was 6 files × 12,000 bytes = 48,000 characters, and it is chosen by
 * `scorePath` — a scorer that reads the question's words against the file PATH
 * and never against its contents. So the turn opened with 48 KB (~12,000
 * tokens) of whole file bodies picked by filename overlap, whether or not any
 * of them was the answer.
 *
 * MEASURED, driving the real pipeline against a local granite4-hermes on this
 * monorepo and asking which file implements the staleness detection behind
 * `/api/status`: with the 48 KB of pre-read bodies present the model made ZERO
 * tool calls and answered — wrongly — from what it had been handed. With the
 * same prompt minus the pre-read bodies it called `read_file` on its first
 * round. A model given six whole files believes it has already looked.
 *
 * So the section keeps its job — point at the files whose PATHS match, which is
 * a genuinely cheap first hint — and stops pretending to be the retrieval. Six
 * openings at 2,000 characters is enough to see a file's imports, its exports
 * and its top-of-file comment; `read_file` (with `offset`/`limit`) gets the
 * rest, and `renderAskFileResearchSection` says so in the header.
 */
export const DEFAULT_ASK_FILE_RESEARCH_BUDGET: AskFileResearchBudget = {
  maxFiles: 6,
  maxBytesPerFile: 2_000,
  maxTotalBytes: 12_000,
};

export interface ResolvedAskFile {
  path: string;
  content: string;
  truncated: boolean;
  /** H-snippet: a truncated file shows its best-matching window; these are its 1-based lines (absent = the opening). */
  startLine?: number;
  endLine?: number;
  totalLines?: number;
}

export interface AskFileResearchResult {
  files: ResolvedAskFile[];
  /** Candidate paths that scored but did not fit the file cap. */
  omittedFiles: number;
  /** Paths refused by the jail, the reserved-dir guard, or a permission rule. */
  refusedPaths: string[];
  /** Better-ranked matches the gate skipped before they took a slot (permission rule, or not readable). */
  skippedPaths?: number;
}

/** True when the question is likely about implementation, not topology alone. */
export function wantsAskFileResearch(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(code|source|file|files|function|class|method|implement|implementation|snippet|read|show me)\b/.test(
      q,
    ) ||
    /\bhow does .+ work\b/.test(q) ||
    /\bwhat does .+ do\b/.test(q) ||
    // Attached "explain how X reaches Y" is implementation, not a fragility chip.
    /\bexplain how\b/.test(q) ||
    /\bhow \w[\w-]* reaches\b/.test(q) ||
    /\bhow \w[\w-]* talks? to\b/.test(q) ||
    /\.[a-z]{1,4}\b/.test(q) ||
    /`[^`]+\.[a-z]{1,4}`/.test(q)
  );
}

function questionTokens(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** All repo-relative file paths from the digest — the honest candidate set. */
export function digestFilePaths(digest: AskDigestFiles): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const svc of digest.services) {
    for (const f of svc.files) {
      if (!f.path || seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(f.path);
    }
  }
  return out;
}

function filesUnderNode(graph: ArchGraph, nodeId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const root = byId.get(nodeId);
  if (!root) return [];
  const out: string[] = [];
  const walk = (n: ArchNode): void => {
    if (n.kind === 'file' && n.path) out.push(n.path);
    for (const child of graph.nodes) {
      if (child.parentId === n.id) walk(child);
    }
  };
  walk(root);
  return out;
}

function scorePath(path: string, tokens: readonly string[]): number {
  const hay = path.toLowerCase().replace(/[\\/]/g, '/');
  const base = hay.split('/').pop() ?? hay;
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
    if (base.includes(t)) score += 3;
    if (base === t || base.startsWith(`${t}.`) || base.endsWith(`.${t}`)) score += 4;
  }
  // Datastore names rarely appear in paths; surface the service db module.
  if (tokens.some((t) => t === 'postgres' || t === 'postgresql' || t === 'database')) {
    if (/(^|\/)db\.(py|js|ts|go)$/.test(hay) || hay.includes('/db/')) score += 4;
  }
  return score;
}

/** The candidate set: every digest file, plus the files under the subject node. */
export function askResearchCandidates(graph: ArchGraph, digest: AskDigestFiles, subjectNodeId?: string): string[] {
  const candidates = new Set(digestFilePaths(digest));
  if (subjectNodeId) {
    for (const p of filesUnderNode(graph, subjectNodeId)) candidates.add(p);
  }
  return [...candidates];
}

/**
 * The scan's side of the F50 candidate set: the path-score candidates plus
 * every file node the scan found (warmAskFileIndex adds the repo's tracked
 * source files). The digest lists a few hundred files (275 of ~2,000 on this
 * monorepo at 6ca8c4e6); over digest files alone F50 scored 19.6% hit@5 on
 * find-the-fix. Grounded: every path is a scanned file node or a tracked file.
 */
export function askIndexCandidates(graph: ArchGraph, digest: AskDigestFiles, subjectNodeId?: string): string[] {
  const out = new Set(askResearchCandidates(graph, digest, subjectNodeId));
  for (const n of graph.nodes) if (n.kind === 'file' && n.path) out.add(n.path);
  return [...out];
}

/**
 * Rank paths by relevance to the question (and optional selection).
 * Returns repo-relative paths only — never invented.
 *
 * With an index whose LTR stage is ready, the ranking is the LightGBM picker
 * (askLtr.ts; sealed hit@5 84.9% vs 75.5% for HYB_NOSEM), then HYB_NOSEM.
 * With `index` (askFileIndex.ts) the ranking is HYB_NOSEM over every scanned
 * and tracked source file: F50 (BM25F over contents and path tokens plus a
 * churn prior) + 0.5 x BM25 over each file's commit-subject history + 0.15 x
 * grep. F50 alone: find-the-fix codeforge hit@5 62% vs 13.4% for the path
 * score. With a subject node, that node's matching files come first, then the
 * rest of the ranking. Without an index, or when nothing matches the
 * question's words, it is the path score below.
 *
 * `accept` (the caller's permission-gated resolver) is applied before a path
 * takes a slot, so a denied or unreadable file never displaces a readable one.
 */
export function selectAskResearchPaths(
  graph: ArchGraph,
  digest: AskDigestFiles,
  question: string,
  opts: { subjectNodeId?: string; maxFiles?: number; index?: AskFileIndex; accept?: (path: string) => boolean; /** Rank with HYB_NOSEM even when the LTR stage is ready (the bench's before arm). */ noLtr?: boolean; /** Called for each ranked path `accept` turned away. */ onSkip?: (path: string) => void } = {},
): string[] {
  const maxFiles = opts.maxFiles ?? DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxFiles;
  const accept = opts.accept ?? (() => true);
  const take = (paths: Iterable<string>): string[] => {
    const out: string[] = [];
    for (const p of paths) {
      if (out.length >= maxFiles) break;
      if (out.includes(p)) continue;
      if (accept(p)) out.push(p);
      else opts.onSkip?.(p);
    }
    return out;
  };
  const tokens = questionTokens(question);
  const candidates = new Set(askResearchCandidates(graph, digest, opts.subjectNodeId));
  const subjectFiles = opts.subjectNodeId ? new Set(filesUnderNode(graph, opts.subjectNodeId)) : null;

  if (opts.index) {
    const index = opts.index;
    /* The index holds grounded paths only (scan file nodes, tracked files); rank them all. */
    let hyb: string[] | null = null;
    const hybrid = (): string[] =>
      (hyb ??= [...scoreAskFileHybrid(index, question)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p));
    /*
     * LTR (askLtr.ts) once its stage of the background build is ready: the
     * model's order over its ~125 candidates, then HYB_NOSEM for the rest (a
     * gate that refuses many of them, or a subject node's other files).
     * Before that, and with SEQUENCE_ASK_PICKER=hyb, HYB_NOSEM alone.
     */
    const ltr = index.ltr && !opts.noLtr ? rankAskFileLtr(index, question) : [];
    const lazyOrder = function* (): Generator<string> {
      yield* ltr;
      const seen = new Set(ltr);
      for (const p of hybrid()) if (!seen.has(p)) yield p;
    };
    let picked: string[];
    if (subjectFiles) {
      /* An ask scoped to a board node reads that node's matching files first (S1). */
      const all = [...lazyOrder()];
      picked = take([...all.filter((p) => subjectFiles.has(p)), ...all.filter((p) => !subjectFiles.has(p))]);
    } else picked = take(lazyOrder());
    if (picked.length > 0) return picked;
  }

  const ranked = [...candidates]
    .map((path) => ({ path, score: scorePath(path, tokens) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const withScore = ranked.filter((r) => r.score > 0);
  const chosen =
    withScore.length > 0
      ? withScore
      : subjectFiles
        ? ranked.filter((r) => subjectFiles.has(r.path))
        : [];

  return take(chosen.map((r) => r.path));
}

export type ResolveReadablePath = (rel: string) => string | null;

/**
 * Read selected paths through the jail. `resolveReadable` is the same choke point
 * as GET /api/file (repoServer's `resolveReadablePath`).
 */
export function readAskResearchFiles(
  resolveReadable: ResolveReadablePath,
  paths: readonly string[],
  budget: AskFileResearchBudget = DEFAULT_ASK_FILE_RESEARCH_BUDGET,
  onTrace?: (event: AskFileResearchTraceEvent) => void,
  /** H-snippet: with a question, a file over the cap shows its best-matching window, not its opening. */
  question?: string,
): AskFileResearchResult {
  const files: ResolvedAskFile[] = [];
  const refusedPaths: string[] = [];
  let totalBytes = 0;
  let omittedFiles = 0;

  for (const rel of paths) {
    const normalizedPath = rel.replace(/\\/g, '/');
    if (files.length >= budget.maxFiles) {
      omittedFiles += 1;
      continue;
    }
    onTrace?.({ type: 'file:read', path: normalizedPath });
    const abs = resolveReadable(rel);
    if (!abs) {
      refusedPaths.push(rel);
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      refusedPaths.push(rel);
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    if (!stat.isFile()) {
      refusedPaths.push(rel);
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    if (totalBytes >= budget.maxTotalBytes) {
      omittedFiles += 1;
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    const perFileCap = Math.min(
      budget.maxBytesPerFile,
      budget.maxTotalBytes - totalBytes,
    );
    if (perFileCap <= 0) {
      omittedFiles += 1;
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    let raw: string;
    /* A file over the index cap (a generated bundle, a big fixture) is never read whole: its opening only (S4). */
    const huge = stat.size > ASK_INDEX_MAX_FILE_BYTES;
    try {
      raw = huge ? readOpening(abs, perFileCap) : fs.readFileSync(abs, 'utf8');
    } catch {
      refusedPaths.push(rel);
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    const truncated = huge || raw.length > perFileCap;
    if (truncated && question && !huge) {
      const w = bestMatchingWindow(raw, question, perFileCap);
      if (w.startLine > 1) {
        totalBytes += w.content.length;
        files.push({ path: normalizedPath, content: w.content, truncated, startLine: w.startLine, endLine: w.endLine, totalLines: w.totalLines });
        onTrace?.({ type: 'file:done', path: normalizedPath });
        continue;
      }
    }
    const content = truncated ? raw.slice(0, perFileCap) : raw;
    totalBytes += content.length;
    files.push({ path: normalizedPath, content, truncated });
    onTrace?.({ type: 'file:done', path: normalizedPath });
  }

  return { files, omittedFiles, refusedPaths };
}

/** The first `chars` characters of a file, reading at most 4 bytes per character. */
function readOpening(abs: string, chars: number): string {
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(chars * 4);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').slice(0, chars);
  } finally {
    fs.closeSync(fd);
  }
}

/** Render the file-research section for the ask prompt. Empty when no files read. */
export function renderAskFileResearchSection(result: AskFileResearchResult): string[] {
  const skipped = result.skippedPaths ?? 0;
  if (result.files.length === 0 && result.omittedFiles === 0 && result.refusedPaths.length === 0 && skipped === 0) {
    return [];
  }
  const L: string[] = [
    '--- FILE RESEARCH (real file excerpts from this repo — cite paths verbatim; do NOT invent code) ---',
    'These are the files that best matched your question, each shown at its best-matching part (or its opening) and cut. ' +
      'They are a starting point, not the answer: a file marked (truncated) has more below ' +
      'the cut, and a file that is not listed here is not absent from the repo. Call ' +
      '`read_file` (with `offset` / `limit` for a large file), `search_files`, or `who_calls` ' +
      'before naming any symbol you have not actually seen.',
  ];
  const blocks: string[] = [];
  for (const f of result.files) {
    const header = `### ${f.path}${
      f.truncated && f.startLine
        ? ` (lines ${f.startLine}-${f.endLine} of ${f.totalLines}, the part that best matched the question — call read_file with {"path":"${f.path}","offset":${(f.endLine ?? 0) + 1}} for what follows)`
        : f.truncated
          ? ` (first ${f.content.length} bytes — call read_file with {"path":"${f.path}","offset":N} for more)`
          : ''
    }`;
    blocks.push(`${header}\n\`\`\`\n${neutralizeUntrusted(f.content)}\n\`\`\``);
  }
  if (blocks.length > 0) {
    L.push(...wrapUntrustedLines(blocks));
  }
  if (result.omittedFiles > 0) {
    L.push(omissionMarker(result.omittedFiles, 'research files'));
  }
  if (skipped > 0) {
    /* Review v2 nit: with the gate filtering before a slot is taken, the model otherwise never learns a better match exists. */
    L.push(
      `…${skipped} best match${skipped === 1 ? '' : 'es'} skipped by permission rules or not readable (not shown; ask the user before reading ${skipped === 1 ? 'it' : 'them'})`,
    );
  }
  if (result.refusedPaths.length > 0) {
    L.push(
      `…${result.refusedPaths.length} path${result.refusedPaths.length === 1 ? '' : 's'} refused (jail, permission rule, or not readable)`,
    );
  }
  return L;
}

export interface GatherAskFileResearchArgs {
  graph: ArchGraph;
  digest: AskDigestFiles;
  question: string;
  resolveReadable: ResolveReadablePath;
  subjectNodeId?: string;
  budget?: AskFileResearchBudget;
  /**
   * The repo root: with it the picker is HYB_NOSEM over this scan's content +
   * history index once that index is built (warmAskFileIndex, started when the
   * scan landed). Until then the ask uses the path score; it never waits.
   */
  repoRoot?: string;
  /**
   * The plain jail resolver the index reads contents through when this ask has
   * to start the build itself (contents only rank). Defaults to
   * `resolveReadable`. Never the permission-gated one in the product: a build
   * through one ask's gate would bake that ask's permissions into the index.
   */
  indexResolveReadable?: ResolveReadablePath;
}

export type AskFileResearchTraceEvent =
  | { type: 'file:read'; path: string }
  | { type: 'file:done'; path: string };

/**
 * End-to-end: select → read → render. No-op when the question does not ask about code.
 * Optional `onTrace` emits per-file events for the ask stream.
 */
export function gatherAskFileResearchTraced(
  args: GatherAskFileResearchArgs,
  onTrace?: (event: AskFileResearchTraceEvent) => void,
): AskFileResearchResult {
  if (!wantsAskFileResearch(args.question)) {
    return { files: [], omittedFiles: 0, refusedPaths: [] };
  }
  const budget = args.budget ?? DEFAULT_ASK_FILE_RESEARCH_BUDGET;
  let index: AskFileIndex | undefined;
  if (args.repoRoot) {
    index = readyAskFileIndex(args.graph, args.repoRoot);
    /* Not built yet: start it in the background (a no-op while it builds) and answer from the path score now. */
    if (!index) void warmAskFileIndex(args.graph, args.repoRoot, askIndexCandidates(args.graph, args.digest), args.indexResolveReadable ?? args.resolveReadable);
  }
  const skipped = new Set<string>();
  const paths = selectAskResearchPaths(args.graph, args.digest, args.question, {
    subjectNodeId: args.subjectNodeId,
    maxFiles: budget.maxFiles,
    ...(index ? { index } : {}),
    accept: (p) => isReadableFile(args.resolveReadable(p)),
    onSkip: (p) => skipped.add(p),
  });
  if (paths.length === 0) return { files: [], omittedFiles: 0, refusedPaths: [], ...(skipped.size ? { skippedPaths: skipped.size } : {}) };
  const r = readAskResearchFiles(args.resolveReadable, paths, budget, onTrace, args.question);
  return skipped.size ? { ...r, skippedPaths: skipped.size } : r;
}

function isReadableFile(abs: string | null): boolean {
  if (!abs) return false;
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * S-new4: a one-shot process (headless `sequence ask`) shares no event loop
 * with anyone, so it WAITS for this scan's index (and its LTR stage) before the
 * ask, instead of answering from the path score and then lingering to build an
 * index nobody reads. Only when the question would get FILE RESEARCH at all.
 * The server never calls this: there an ask never waits.
 *
 * The wait ends early on `signal` (Ctrl-C, `--timeout`) and after `maxWaitMs`
 * (never more than {@link ASK_ONESHOT_INDEX_WAIT_MS}); the build is then
 * cancelled so it does not keep the process alive, and the ask gets whatever is
 * ready: the HYB index without its LTR stage, or nothing (the path score).
 */
export async function awaitAskFileIndexForOneShot(args: {
  graph: ArchGraph;
  digest: AskDigestFiles;
  question: string;
  repoRoot: string;
  resolveReadable: ResolveReadablePath;
  signal?: AbortSignal;
  maxWaitMs?: number;
  /** Told once when the wait gives up on the cap (not on `signal`). */
  onGiveUp?: (waitedMs: number) => void;
}): Promise<AskFileIndex | null> {
  if (!wantsAskFileResearch(args.question) || args.signal?.aborted) return null;
  const cap = Math.max(0, Math.min(args.maxWaitMs ?? ASK_ONESHOT_INDEX_WAIT_MS, ASK_ONESHOT_INDEX_WAIT_MS));
  const t0 = Date.now();
  let stop = false;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const GAVE_UP = Symbol('gave-up');
  const gaveUp = new Promise<typeof GAVE_UP>((resolve) => {
    timer = setTimeout(() => {
      /* The timer fired, so the cap has passed on the loop's clock. Date.now() can read a millisecond short of it
         (libuv floors its clock; Node timers are known to fire up to 1 ms early against Date.now()). */
      args.onGiveUp?.(Math.max(cap, Date.now() - t0));
      resolve(GAVE_UP);
    }, cap);
    onAbort = () => resolve(GAVE_UP);
    args.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const warm = warmAskFileIndex(args.graph, args.repoRoot, askIndexCandidates(args.graph, args.digest), args.resolveReadable, { cancelled: () => stop });
    const index = await Promise.race([warm, gaveUp]);
    if (index === GAVE_UP) {
      stop = true;
      return null;
    }
    if (index?.ltrPending && (await Promise.race([index.ltrPending.then(() => undefined), gaveUp])) === GAVE_UP) stop = true;
    return index;
  } finally {
    clearTimeout(timer);
    if (onAbort) args.signal?.removeEventListener('abort', onAbort);
  }
}

/** The longest a one-shot ask waits for its file index (HYB and LTR stages together). */
export const ASK_ONESHOT_INDEX_WAIT_MS = 30_000;

/** @deprecated alias — use {@link gatherAskFileResearchTraced} without trace. */
export function gatherAskFileResearch(args: GatherAskFileResearchArgs): AskFileResearchResult {
  return gatherAskFileResearchTraced(args);
}

/** Exported for tests that need the total-budget char cut on assembled bodies. */
export function fitFileResearchToTokenBudget(
  result: AskFileResearchResult,
  budgetTokens: number,
): AskFileResearchResult {
  const limit = budgetTokens * 4;
  let used = 0;
  const files: ResolvedAskFile[] = [];
  let omittedFiles = result.omittedFiles;
  for (const f of result.files) {
    const room = limit - used;
    if (room <= 0) {
      omittedFiles += 1;
      continue;
    }
    if (f.content.length <= room) {
      files.push(f);
      used += f.content.length;
      continue;
    }
    const cut = cutTextToBudget(f.content, Math.ceil(room / 4));
    files.push({ path: f.path, content: cut.text, truncated: true });
    used += cut.text.length;
  }
  return { files, omittedFiles, refusedPaths: result.refusedPaths, ...(result.skippedPaths ? { skippedPaths: result.skippedPaths } : {}) };
}
