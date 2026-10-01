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
}

export interface AskFileResearchResult {
  files: ResolvedAskFile[];
  /** Candidate paths that scored but did not fit the file cap. */
  omittedFiles: number;
  /** Paths refused by the jail, the reserved-dir guard, or a permission rule. */
  refusedPaths: string[];
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

/**
 * Rank digest paths by relevance to the question (and optional selection).
 * Returns repo-relative paths only — never invented.
 */
export function selectAskResearchPaths(
  graph: ArchGraph,
  digest: AskDigestFiles,
  question: string,
  opts: { subjectNodeId?: string; maxFiles?: number } = {},
): string[] {
  const maxFiles = opts.maxFiles ?? DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxFiles;
  const tokens = questionTokens(question);
  const candidates = new Set(digestFilePaths(digest));

  if (opts.subjectNodeId) {
    for (const p of filesUnderNode(graph, opts.subjectNodeId)) candidates.add(p);
  }

  const ranked = [...candidates]
    .map((path) => ({ path, score: scorePath(path, tokens) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const withScore = ranked.filter((r) => r.score > 0);
  const chosen =
    withScore.length > 0
      ? withScore
      : opts.subjectNodeId
        ? ranked.filter((r) => filesUnderNode(graph, opts.subjectNodeId!).includes(r.path))
        : [];

  return chosen.slice(0, maxFiles).map((r) => r.path);
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
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      refusedPaths.push(rel);
      onTrace?.({ type: 'file:done', path: normalizedPath });
      continue;
    }
    const truncated = raw.length > perFileCap;
    const content = truncated ? raw.slice(0, perFileCap) : raw;
    totalBytes += content.length;
    files.push({ path: normalizedPath, content, truncated });
    onTrace?.({ type: 'file:done', path: normalizedPath });
  }

  return { files, omittedFiles, refusedPaths };
}

/** Render the file-research section for the ask prompt. Empty when no files read. */
export function renderAskFileResearchSection(result: AskFileResearchResult): string[] {
  if (result.files.length === 0 && result.omittedFiles === 0 && result.refusedPaths.length === 0) {
    return [];
  }
  const L: string[] = [
    '--- FILE RESEARCH (real file OPENINGS from this repo — cite paths verbatim; do NOT invent code) ---',
    'These are the files whose PATHS matched your question, opened at the top and cut. ' +
      'They are a starting point, not the answer: a file marked (truncated) has more below ' +
      'the cut, and a file that is not listed here is not absent from the repo. Call ' +
      '`read_file` (with `offset` / `limit` for a large file), `search_files`, or `who_calls` ' +
      'before naming any symbol you have not actually seen.',
  ];
  const blocks: string[] = [];
  for (const f of result.files) {
    const header = `### ${f.path}${f.truncated ? ` (first ${f.content.length} bytes — call read_file with {"path":"${f.path}","offset":N} for more)` : ''}`;
    blocks.push(`${header}\n\`\`\`\n${neutralizeUntrusted(f.content)}\n\`\`\``);
  }
  if (blocks.length > 0) {
    L.push(...wrapUntrustedLines(blocks));
  }
  if (result.omittedFiles > 0) {
    L.push(omissionMarker(result.omittedFiles, 'research files'));
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
  const paths = selectAskResearchPaths(args.graph, args.digest, args.question, {
    subjectNodeId: args.subjectNodeId,
    maxFiles: budget.maxFiles,
  });
  if (paths.length === 0) return { files: [], omittedFiles: 0, refusedPaths: [] };
  return readAskResearchFiles(args.resolveReadable, paths, budget, onTrace);
}

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
  return { files, omittedFiles, refusedPaths: result.refusedPaths };
}
