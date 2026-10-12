/**
 * find_files: the trained file ranker, for agents.
 *
 * WHAT. A question in, the top-k files out, each with a one-line reason and a
 * small snippet window, inside a token budget. It is the same ranker the local
 * ask path uses (askLtr.ts: LightGBM LambdaRank over ~125 candidates, sealed
 * hit@5 84.9% vs 51.0% for grep) with the per-repo residual trees from
 * findFilesLearn.ts on top once the user's own edits have taught it something.
 *
 * WHERE IT RUNS. In the MCP server process Claude/Codex start for a session
 * (packages/mcp); that process has no scan and no access to the app's warm index,
 * so it keeps its own, built by the very same background builder
 * (buildAskFileIndexAsync: async git and reads, yields every 50 files, the LTR
 * stage after the HYB stage is already serving). The index is per repo root,
 * rebuilt in the background when HEAD moves or after 15 minutes; the old index
 * keeps answering until the new one is ready.
 *
 * NEVER STALLS A TURN. With no index yet a call waits at most 250 ms (a small
 * repo builds in that time) and then answers from the tracked file list scored
 * by path words; with the text stage up but the learned stage still building it
 * waits at most 1 s and then answers from HYB_NOSEM. The answer always says
 * which, and says to ask again for the learned ranking. (It used to wait up to
 * 4 s on a cold index: a 4 s stall on the agent's first call, then path words
 * anyway on a big repo.)
 *
 * ONE INDEX PER REPO. An agent session's MCP server does not hold the index:
 * findFilesHost.ts runs one host process per repository root that every
 * session connects to, so several chats on one repo share one index.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { askLtrEnabled, bestMatchingWindow, buildAskFileIndexAsync, listRepoSourceFilesAsync, scoreAskFileHybrid, type AskFileIndex } from './askFileIndex.js';
import { ASK_LTR_FEATURES, askLtrModel, rankAskFileLtrScored } from './askLtr.js';
import { ASK_STOPWORDS, askTokens } from './askTokens.js';
import { linkedWorktreeBase } from '../server/graphStamp.js';
import { createFindFilesLearner, type FindFilesLearner } from './findFilesLearn.js';
import type { LightGbmModel } from './lightgbm.js';

const execFileAsync = promisify(execFile);

export type FindFilesRanker = 'trained' | 'frozen' | 'hybrid' | 'paths';

export interface FoundFile {
  path: string;
  reason: string;
  /** 1-based inclusive window of the file shown, absent when the budget had no room for it. */
  snippet?: { startLine: number; endLine: number; content: string };
}

export interface FindFilesResult {
  files: FoundFile[];
  /** The top-k paths in rank order, before the token budget cut any from the text. */
  ranking: string[];
  /** `trained` = frozen + this repo's residual trees; `frozen` = the shipped LTR model; `hybrid` = LTR stage not ready; `paths` = nothing built yet. */
  ranker: FindFilesRanker;
  /** The text an agent receives. */
  text: string;
  /** ceil(text.length / 4), the repo's token convention. */
  tokens: number;
  ms: number;
  /** Candidates the ranker scored (0 for `paths`). */
  scored: number;
}

export interface FindFilesOptions {
  k?: number;
  /** Cap on the answer text, in tokens (default 800). */
  budgetTokens?: number;
  /** Longest this call waits for the index: default 250 ms while nothing is built, 1,000 ms for the learned stage. */
  waitMs?: number;
  /** Do not record this call for learning (benchmarks). */
  noLog?: boolean;
  /** Use the frozen model even when a trained one exists (benchmarks). */
  frozenOnly?: boolean;
  /** Answer from path words without touching (or building) an index: the shared host is not reachable yet. */
  indexless?: boolean;
}

export const FIND_FILES_DEFAULT_K = 5;
export const FIND_FILES_MAX_K = 20;
export const FIND_FILES_DEFAULT_BUDGET = 800;
export const FIND_FILES_MAX_QUERY_CHARS = 2000;
const FRESH_MS = 15 * 60_000;
/** No index yet: wait this long for the build, then answer by path words. */
export const FIND_FILES_COLD_WAIT_MS = 250;
/** Text stage up, learned stage building: wait this long, then answer from the text ranker. */
export const FIND_FILES_LTR_WAIT_MS = 1_000;

interface Entry {
  root: string;
  index?: AskFileIndex;
  head?: string | null;
  builtAt: number;
  building?: Promise<void>;
  learner: FindFilesLearner;
}

const ENTRIES = new Map<string, Entry>();

const tokensOf = (s: string): number => Math.ceil(s.length / 4);

async function headOf(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], { windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** The jail resolver for the index: a path inside `root` that is not a symlink out of it. */
function resolver(root: string): (rel: string) => string | null {
  const real = fs.realpathSync(root);
  return (rel) => {
    const abs = path.resolve(real, rel);
    if (abs !== real && !abs.startsWith(real + path.sep)) return null;
    try {
      const r = fs.realpathSync(abs);
      return r === real || r.startsWith(real + path.sep) ? r : null;
    } catch {
      return null;
    }
  };
}

function entryFor(root: string): Entry {
  const key = path.resolve(root);
  let e = ENTRIES.get(key);
  if (!e) {
    e = { root: key, builtAt: 0, learner: createFindFilesLearner(key, { storeRoot: linkedWorktreeBase(key) ?? key, busy: () => ENTRIES.get(key)?.building !== undefined }) };
    ENTRIES.set(key, e);
  }
  return e;
}

function startBuild(e: Entry): void {
  if (e.building) return;
  const head = headOf(e.root);
  e.building = (async () => {
    try {
      const index = await buildAskFileIndexAsync(e.root, [], resolver(e.root), {});
      if (index) {
        e.index = index;
        e.head = await head;
        e.builtAt = Date.now();
        /* The ranker may only retrain once the LTR stage is up, and only in the background. */
        void index.ltrPending?.then(() => e.learner.onIndexReady(index));
      }
    } catch {
      /* a failed build leaves the previous index (or none): the call falls back */
    } finally {
      e.building = undefined;
    }
  })();
}

/** Start (or join) the background build for `root` and return at once. Safe to call on every session start. */
export function warmFindFiles(root: string): void {
  try {
    const e = entryFor(root);
    if (!e.index) startBuild(e);
  } catch {
    /* an unreadable root is reported by the first call */
  }
}

/** The ready index for `root`, if any (tests and benchmarks). */
export function peekFindFilesIndex(root: string): AskFileIndex | undefined {
  return ENTRIES.get(path.resolve(root))?.index;
}

/** Forget a root's index (tests). */
export function dropFindFiles(root?: string): void {
  if (root) ENTRIES.delete(path.resolve(root));
  else ENTRIES.clear();
}

/* ───────────────────────── reasons ───────────────────────── */

const F = (name: (typeof ASK_LTR_FEATURES)[number]): number => ASK_LTR_FEATURES.indexOf(name);
const IX = {
  baseHit: F('base_hit'),
  stemHit: F('stem_hit'),
  pathQ: F('path_qfrac'),
  defHit: F('def_hit'),
  defCode: F('def_hit_code'),
  grepN: F('grep_n'),
  grepRank: F('grep_rank'),
  knnSum: F('knn_sum_n'),
  knnMax: F('knn_max_n'),
  hsub: F('hsub_n'),
  ch30: F('churn30'),
  recent: F('in_recent5'),
  nbr: F('nbr_max'),
  cover: F('qtok_cov'),
};

/** A past commit that touched `file` and whose subject best matches the question, for the reason line. */
function similarCommit(index: AskFileIndex, file: string, qWords: string[]): string | null {
  const L = index.ltr;
  if (!L) return null;
  let best = -1;
  let bestScore = 0;
  const seen = new Set<number>();
  for (const w of qWords) {
    const list = L.cpost.get(w);
    if (!list) continue;
    for (const j of list) {
      if (!L.cdocs[j]?.files.includes(file)) continue;
      if (!seen.has(j)) seen.add(j);
    }
  }
  for (const j of seen) {
    let sc = 0;
    for (const w of qWords) {
      const tf = L.cdocs[j]?.tf.get(w);
      if (tf) sc += Math.log(1 + L.cN / (L.cdf.get(w) ?? 1));
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = j;
    }
  }
  const subject = best >= 0 ? L.cdocs[best]?.subject : undefined;
  return subject ? (subject.length > 70 ? `${subject.slice(0, 67)}...` : subject) : null;
}

/** One line, at most ~140 chars: the strongest evidence for this file, from its own feature row. */
export function reasonLine(index: AskFileIndex, file: string, row: readonly number[], question: string): string {
  const parts: string[] = [];
  const qWords = [...new Set(askTokens(question))];
  const L = index.ltr;
  if (row[IX.baseHit]! > 0 || row[IX.stemHit]! > 0) parts.push('file name is in the question');
  else if (row[IX.pathQ]! > 0) parts.push('path matches the question');
  if (row[IX.defHit]! > 0 && L) {
    /* The words the feature counts: plain words of the question (not stop words), and `backticked` code. */
    const defs = L.defs.get(file);
    const words = (question.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => w.length > 2 && !ASK_STOPWORDS.has(w.toLowerCase()));
    for (const m of question.matchAll(/`([A-Za-z_][\w.]*)`/g)) words.push(m[1]!);
    const hit = defs ? [...new Set(words.filter((w) => defs.has(w.toLowerCase())))].slice(0, 2) : [];
    parts.push(hit.length ? `defines ${hit.map((h) => `\`${h}\``).join(', ')}` : 'defines a term from the question');
  }
  if (parts.length < 2 && (row[IX.knnSum]! > 0.3 || row[IX.hsub]! > 0.3)) {
    const c = similarCommit(index, file, qWords);
    parts.push(c ? `edited by a similar commit: "${c}"` : 'edited by similar past commits');
  }
  if (parts.length < 2 && (row[IX.grepRank]! <= 3 || row[IX.grepN]! > 0.6)) parts.push('text contains the question words');
  if (parts.length < 2 && (row[IX.recent]! > 0 || row[IX.ch30]! > 3)) parts.push('changed recently');
  if (parts.length < 2 && row[IX.nbr]! > 0.6) parts.push('imports or is imported by a strong match');
  if (parts.length === 0) parts.push(row[IX.cover]! > 0.5 ? 'covers most question words' : 'ranked by history and churn');
  const s = parts.join('; ');
  return s.length > 150 ? `${s.slice(0, 147)}...` : s;
}

/* ───────────────────────── the answer ───────────────────────── */

function readText(root: string, rel: string): string | null {
  try {
    const abs = resolver(root)(rel);
    if (!abs) return null;
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2_000_000) return null;
    const t = fs.readFileSync(abs, 'utf8');
    return t.includes('\0') ? null : t;
  } catch {
    return null;
  }
}

/** Lines of a window, each as `N| text` and cut to 160 chars so one minified line cannot eat the budget. */
function numbered(startLine: number, content: string): string {
  return content
    .split('\n')
    .map((l, i) => `${startLine + i}| ${l.length > 160 ? `${l.slice(0, 157)}...` : l}`)
    .join('\n');
}

function render(question: string, ranker: FindFilesRanker, shown: FoundFile[], total: number, ms: number, note: string | null): string {
  const lines: string[] = [];
  const label = ranker === 'trained' ? 'learned ranker, tuned on this repo' : ranker === 'frozen' ? 'learned ranker' : ranker === 'hybrid' ? 'text ranker, learned ranker still warming' : 'path match only, index still warming';
  lines.push(`find_files: ${shown.length} of ${total} files (${label}, ${ms} ms)`);
  shown.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.path}  [${f.reason}]`);
    if (f.snippet) lines.push(numbered(f.snippet.startLine, f.snippet.content));
  });
  if (note) lines.push(note);
  return lines.join('\n');
}

/** Path-word fallback while no index exists: tracked files scored by how many question words their path holds. */
async function pathFallback(root: string, question: string, k: number): Promise<string[]> {
  const files = await listRepoSourceFilesAsync(root);
  const ws = [...new Set(askTokens(question))];
  const scored: [string, number][] = [];
  for (const f of files) {
    const pt = new Set(askTokens(f));
    let s = 0;
    for (const w of ws) if (pt.has(w)) s++;
    if (s > 0) scored.push([f, s]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([f]) => f);
}

/**
 * Answer one question. Never throws for a bad repo: a repo with nothing to rank
 * comes back with an empty list and a text that says so.
 */
export async function findFiles(root: string, question: string, opts: FindFilesOptions = {}): Promise<FindFilesResult> {
  const t0 = performance.now();
  const q = question.trim().slice(0, FIND_FILES_MAX_QUERY_CHARS);
  const k = Math.max(1, Math.min(FIND_FILES_MAX_K, Math.floor(opts.k ?? FIND_FILES_DEFAULT_K)));
  const budget = Math.max(150, opts.budgetTokens ?? FIND_FILES_DEFAULT_BUDGET);
  const t1 = performance.now();
  const timeout = (ms: number): Promise<'t'> => new Promise((r) => setTimeout(() => r('t'), Math.max(0, ms)).unref());
  const e = opts.indexless ? null : entryFor(root);
  if (e) {
    /* Stale-while-revalidate: HEAD moved or the index is old, rebuild behind this call. */
    if (!e.building && (!e.index || Date.now() - e.builtAt > FRESH_MS || ((await headOf(e.root)) ?? e.head) !== e.head)) startBuild(e);
    if (!e.index && e.building) await Promise.race([e.building, timeout((opts.waitMs ?? FIND_FILES_COLD_WAIT_MS) - (performance.now() - t1))]);
  }
  const index = e?.index;
  if (index?.ltrPending && !index.ltr && askLtrEnabled()) await Promise.race([index.ltrPending, timeout((opts.waitMs ?? FIND_FILES_LTR_WAIT_MS) - (performance.now() - t1))]);

  let ranker: FindFilesRanker;
  let order: { path: string; row?: number[] }[];
  let scored = 0;
  let rowsForLog: { cands: string[]; rows: number[][]; scores: number[] } | null = null;
  if (index?.ltr) {
    const { model, kind } = opts.frozenOnly || !e ? { model: askLtrModel() as LightGbmModel, kind: 'frozen' as const } : e.learner.currentModel();
    const r = rankAskFileLtrScored(index, q, model);
    order = r.ranked.map((x) => ({ path: x.path, row: x.row }));
    scored = r.cands.length;
    ranker = kind === 'repo' ? 'trained' : 'frozen';
    if (!opts.noLog && r.ranked.length > 0) rowsForLog = { cands: r.ranked.map((x) => x.path), rows: r.ranked.map((x) => x.row), scores: r.ranked.map((x) => x.score) };
  } else if (index) {
    const h = [...scoreAskFileHybrid(index, q)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    order = h.map(([p]) => ({ path: p }));
    scored = h.length;
    ranker = 'hybrid';
  } else {
    order = (await pathFallback(path.resolve(root), q, k)).map((p) => ({ path: p }));
    ranker = 'paths';
  }
  const top = order.slice(0, k);
  if (rowsForLog && e) e.learner.recordQuery(q, rowsForLog);

  /* Budget: header and one reason line per file first (drop the tail if even those do not fit), then snippets, best file the most room. */
  const files: FoundFile[] = top.map((t) => ({ path: t.path, reason: t.row && index ? reasonLine(index, t.path, t.row, q) : ranker === 'hybrid' ? 'text and history match the question' : 'path matches the question' }));
  let shown = files.slice();
  const warming = ranker === 'paths' || ranker === 'hybrid' ? 'The learned ranker is still indexing this repo; call find_files again in a few seconds for a better ranking.' : null;
  const baseCost = (list: FoundFile[]): number => tokensOf(render(q, ranker, list, order.length, 999, 'x'.repeat(80) + (warming ? `\n${warming}` : '')));
  while (shown.length > 1 && baseCost(shown) > budget) shown = shown.slice(0, -1);
  let remaining = Math.max(0, budget - baseCost(shown));
  const weights = shown.map((_, i) => 1 / (1 + i));
  let wLeft = weights.reduce((a, b) => a + b, 0);
  shown.forEach((f, i) => {
    const share = Math.floor((remaining * weights[i]!) / wLeft);
    wLeft -= weights[i]!;
    /* ~4 chars a token; line numbers add ~6 chars a line, so ask for a little less than the share. */
    const chars = Math.min(700, Math.floor(share * 3.4));
    if (chars < 160 || ranker === 'paths') return;
    const text = readText(path.resolve(root), f.path);
    if (text === null) return;
    const w = bestMatchingWindow(text, q, chars);
    if (w.content.trim() === '') return;
    f.snippet = { startLine: w.startLine, endLine: w.endLine, content: w.content.replace(/\s+$/, '') };
    remaining -= tokensOf(numbered(f.snippet.startLine, f.snippet.content));
  });
  const omitted = shown.length < files.length ? `(${files.length - shown.length} more omitted for the ${budget}-token budget)` : order.length === 0 ? 'No file matched. Use grep or glob.' : null;
  const note = [omitted, warming].filter(Boolean).join('\n') || null;
  const ms = Math.round(performance.now() - t0);
  const text = render(q, ranker, shown, order.length, ms, note);
  return { files: shown, ranking: top.map((t) => t.path), ranker, text, tokens: tokensOf(text), ms, scored };
}
