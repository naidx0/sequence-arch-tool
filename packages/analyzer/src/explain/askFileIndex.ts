/**
 * Ask FILE INDEX — the content-aware picker behind FILE RESEARCH (HYB_NOSEM:
 * F50 + commit history + grep), and the best-matching window shown for each
 * picked file (H-snippet).
 *
 * WHY. `scorePath` in askFileResearch.ts read the question's words against file
 * PATHS only. On find-the-fix (tools/bench/find-the-fix.mjs, codeforge at S
 * 6ca8c4e6, 179 questions) it put a file the real fix edited in its top 5 for
 * 13.4% of questions; grep over contents managed 34.1%. Harness study
 * H-search1 (2026-10-09, harness-study/ftf2.mjs, registered and sealed) found:
 *
 *   BM25F over file contents + path tokens, plus 0.5 x log churn  = 62.0%
 *
 * and on 8 public repos (1,244 questions) 60.5% vs grep 44.6%. F50 here is a
 * port of that reference (`toks`, `bm25`, `withChurn`), unchanged in its
 * parameters: k1 1.2, b 0.75, path tokens x3, churn weight 0.5 over the last
 * 300 first-parent commits, skipping commits that touch more than 30 files.
 * HYB_NOSEM (search3/hybrid) adds 0.5 x BM25 over each file's commit subjects
 * and 0.15 x grep; see {@link scoreAskFileHybrid}.
 *
 * CANDIDATES. The scan's file nodes plus the repo's tracked source files
 * (`git ls-files`, filtered by {@link isAskIndexSource}): this module DOES add
 * paths the digest never listed (a .css or .json the scan does not model).
 * Every path is a real tracked or scanned file, and nothing read here reaches
 * the prompt except through `readAskResearchFiles`, which reads again through
 * the caller's (permission-gated) resolver. Contents are read through the plain
 * jail resolver and only RANK; the caller filters the ranking through its own
 * gate before a path takes a slot.
 *
 * COST AND WHERE IT RUNS. Building tokenises every candidate (measured on this
 * monorepo, ~2.4k files: ~3 s of CPU, ~150 MB before the lowercase copy was
 * dropped). So it never runs on the ask path: {@link warmAskFileIndex} builds it
 * in the background when a scan lands (async git and reads, yielding to the
 * event loop every {@link ASK_INDEX_YIELD_EVERY} files), and an ask uses it only
 * once {@link readyAskFileIndex} returns it; before that the ask falls back to
 * the path score. Bounded: at most {@link ASK_INDEX_MAX_FILES} files and
 * {@link ASK_INDEX_MAX_TEXT_BYTES} of text (later files are indexed by path).
 * A query is F50 + hist over the in-memory index plus grep over at most 600
 * candidates' text, read on demand.
 */

import { execFile, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { subtreePathspec, subtreePathspecAsync } from './gitSubtree.js';
import { askTokens, clearAskTokenCache } from './askTokens.js';
import { AskGrepIndexBuilder, type AskGrepIndex } from './askGrepIndex.js';
import { AskDocFreq, AskTermStore } from './askTermCounts.js';
import { buildAskFileIndexInWorker } from './askIndexWorker.js';
import { buildAskLtrData, buildAskLtrSteps, extractAskLtrFacts, readAskLtrHistoryAsync, type AskLtrData, type AskLtrFileFacts, type AskLtrHistoryCommit } from './askLtr.js';

const execFileAsync = promisify(execFile);

export { askTokens } from './askTokens.js';

export interface AskFileIndex {
  /** Per file: content token counts (a compact read-only view, askTermCounts.ts) and token count. */
  docs: Map<string, { tf: ReadonlyMap<string, number>; len: number }>;
  pathDocs: Map<string, ReadonlyMap<string, number>>;
  df: ReadonlyMap<string, number>;
  n: number;
  avgdl: number;
  churn: Map<string, number>;
  maxChurn: number;
  /** HYB: each file's history document (subject tokens of the last 50 commits that modified it). Absent without git history. */
  hist?: { docs: Map<string, { tf: Map<string, number>; len: number }>; df: Map<string, number>; avg: number };
  /** The indexed paths in index order (scan files first, then tracked files). */
  files: string[];
  /**
   * The grep cache: every indexed file's lowercased text as a run index
   * (askGrepIndex.ts), so a query never re-reads or re-lowercases the corpus.
   * Bounded by the text cap ({@link ASK_INDEX_MAX_TEXT_BYTES}).
   */
  grep: AskGrepIndex;
  /**
   * The LTR picker's stage (askLtr.ts): history, definitions, import graph.
   * Built after the rest of the index is already serving; absent until then
   * (and when the build skipped it), and FILE RESEARCH uses HYB_NOSEM.
   */
  ltr?: AskLtrData;
  /** Settles when the LTR stage has finished (or was skipped or cancelled). */
  ltrPending?: Promise<void>;
  /** True when the text budget ran out and later files were indexed by path only. */
  textCapped?: boolean;
}

/** One non-merge commit of the history HYB reads: its subject and the files it modified. */
export interface AskHistoryCommit {
  subject: string;
  files: string[];
}

/** Files larger than this are indexed by path only (generated bundles, fixtures), and FILE RESEARCH shows only their opening. */
export const ASK_INDEX_MAX_FILE_BYTES = 1_000_000;
/** At most this many files are indexed (scan files first, then tracked files). */
export const ASK_INDEX_MAX_FILES = 20_000;
/** At most this much text is read and tokenised per index; files after that are indexed by path only. */
export const ASK_INDEX_MAX_TEXT_BYTES = 64 * 1024 * 1024;
/** The background build yields to the event loop every this many files. */
export const ASK_INDEX_YIELD_EVERY = 50;

/** Builds an index one file at a time (the async build yields between files). */
class AskIndexBuilder {
  readonly docs: AskFileIndex['docs'] = new Map();
  readonly pathDocs: AskFileIndex['pathDocs'] = new Map();
  /** Vocabulary, every document's (term, count) pairs and df, compact (askTermCounts.ts). */
  readonly terms = new AskTermStore();
  readonly df = new AskDocFreq(this.terms);
  readonly grep = new AskGrepIndexBuilder();
  /** Per-file facts the LTR stage needs (definitions, import specs); null = LTR off. */
  readonly facts: Map<string, AskLtrFileFacts> | null;
  total = 0;

  constructor(ltr = true) {
    this.facts = ltr ? new Map() : null;
  }

  /** `read` false: the file could not be read (indexed by path only, not counted as a grep document). */
  add(f: string, text: string, read = true): void {
    if (this.docs.has(f)) return;
    this.grep.add(this.docs.size, read ? text : null);
    if (this.facts && text) this.facts.set(f, extractAskLtrFacts(f, text));
    const tf = new Map<string, number>();
    const tk = askTokens(text);
    for (const w of tk) tf.set(w, (tf.get(w) ?? 0) + 1);
    const ptf = new Map<string, number>();
    for (const w of askTokens(f.replace(/[/._-]/g, ' '))) ptf.set(w, (ptf.get(w) ?? 0) + 1);
    const ctf = this.terms.add(tf);
    const cptf = this.terms.add(ptf);
    this.docs.set(f, { tf: ctf, len: tk.length });
    this.pathDocs.set(f, cptf);
    this.total += tk.length;
    this.terms.countDoc(new Set([...ctf.termIds(), ...cptf.termIds()]));
  }

  finish(churn: ReadonlyMap<string, number>, history: readonly AskHistoryCommit[] | undefined): AskFileIndex {
    const { docs, pathDocs, df } = this;
    this.terms.trim();
    const kept = new Map<string, number>();
    for (const [f, c] of churn) if (docs.has(f)) kept.set(f, c);
    let maxChurn = 1;
    for (const c of kept.values()) if (c > maxChurn) maxChurn = c;
    const index: AskFileIndex = { docs, pathDocs, df, n: docs.size, avgdl: this.total / (docs.size || 1), churn: kept, maxChurn, files: [...docs.keys()], grep: this.grep.finish() };
    if (history && history.length > 0) index.hist = buildHistDocs(history, docs);
    return index;
  }
}

/**
 * Build an index from in-memory `[path, text]` pairs (tests, the bench). With
 * `ltrHistory` (readAskLtrHistory) the LTR stage is built too, synchronously.
 */
export function buildAskFileIndex(
  files: Iterable<readonly [string, string]>,
  churn: ReadonlyMap<string, number> = new Map(),
  history?: readonly AskHistoryCommit[],
  ltrHistory?: readonly AskLtrHistoryCommit[],
  /** The history depth `ltrHistory` was read with (since_last's default); the product reads 3,000. */
  ltrHistN?: number,
): AskFileIndex {
  const b = new AskIndexBuilder(ltrHistory !== undefined);
  for (const [f, text] of files) b.add(f, text);
  const index = b.finish(churn, history);
  if (ltrHistory && b.facts) index.ltr = buildAskLtrData(index, b.facts, ltrHistory, ltrHistN);
  return index;
}

/** hist50: per file, the subject tokens of the last `perFile` commits (newest first) that modified it. */
function buildHistDocs(history: readonly AskHistoryCommit[], live: ReadonlyMap<string, unknown>, perFile = 50): NonNullable<AskFileIndex['hist']> {
  const seen = new Map<string, number>();
  const docs = new Map<string, { tf: Map<string, number>; len: number }>();
  for (const c of history) {
    const files = c.files.filter((f) => live.has(f));
    if (files.length === 0) continue;
    const tk = askTokens(c.subject);
    for (const f of files) {
      const i = seen.get(f) ?? 0;
      if (i >= perFile) continue;
      seen.set(f, i + 1);
      let d = docs.get(f);
      if (!d) docs.set(f, (d = { tf: new Map(), len: 0 }));
      for (const t of tk) d.tf.set(t, (d.tf.get(t) ?? 0) + 1);
      d.len += tk.length;
    }
  }
  const df = new Map<string, number>();
  let avg = 0;
  for (const d of docs.values()) {
    avg += d.len;
    for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  return { docs, df, avg: avg / (docs.size || 1) };
}

export interface AskIndexScoreOptions {
  k1?: number;
  b?: number;
  /** Weight of a path token against a content token. */
  wPath?: number;
  /** Weight of the normalised log-churn prior added to the normalised BM25F score. */
  churnWeight?: number;
}

/**
 * F50: BM25F (content + path x3) normalised to 0..1, plus 0.5 x log(1+churn) /
 * log(1+max churn). Only files with a positive BM25F score are returned: churn
 * re-ranks matches, it never surfaces a file the question did not match.
 */
export function scoreAskFileIndex(index: AskFileIndex, question: string, opts: AskIndexScoreOptions = {}): Map<string, number> {
  const { k1 = 1.2, b = 0.75, wPath = 3, churnWeight = 0.5 } = opts;
  const { n, df, avgdl } = index;
  const idf = (w: string): number => Math.log(1 + (n - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
  const ws = [...new Set(askTokens(question))].filter((w) => df.has(w));
  const raw = new Map<string, number>();
  for (const [f, d] of index.docs) {
    const p = index.pathDocs.get(f)!;
    let v = 0;
    for (const w of ws) {
      const tf = d.tf.get(w) ?? 0;
      const pf = p.get(w) ?? 0;
      if (!tf && !pf) continue;
      const tfw = tf + wPath * pf;
      const lenN = d.len + wPath * 4;
      v += (idf(w) * (tfw * (k1 + 1))) / (tfw + k1 * (1 - b + (b * lenN) / avgdl));
    }
    if (v > 0) raw.set(f, v);
  }
  const max = Math.max(0, ...raw.values());
  const out = new Map<string, number>();
  const denom = Math.log(1 + index.maxChurn);
  for (const [f, v] of raw) {
    out.set(f, (max ? v / max : 0) + (churnWeight * Math.log(1 + (index.churn.get(f) ?? 0))) / denom);
  }
  return out;
}

/** hist50: BM25 (k1 1.2, b 0.75) of the question over each file's history document; idf over every indexed file. */
function histScores(index: AskFileIndex, question: string): Map<string, number> {
  const out = new Map<string, number>();
  const h = index.hist;
  if (!h) return out;
  const k1 = 1.2;
  const b = 0.75;
  const n = index.n;
  const idf = (w: string): number => Math.log(1 + (n - (h.df.get(w) ?? 0) + 0.5) / ((h.df.get(w) ?? 0) + 0.5));
  const ws = [...new Set(askTokens(question))].filter((w) => h.df.has(w));
  for (const [f, d] of h.docs) {
    let v = 0;
    for (const w of ws) {
      const tf = d.tf.get(w);
      if (!tf) continue;
      v += (idf(w) * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * d.len) / h.avg));
    }
    if (v > 0) out.set(f, v);
  }
  return out;
}

const POSITIONS = new WeakMap<AskFileIndex, Map<string, number>>();

/** Each indexed path's position in `index.files` (the grep cache's file ids). */
export function filePositions(index: AskFileIndex): Map<string, number> {
  let m = POSITIONS.get(index);
  if (!m) {
    m = new Map();
    index.files.forEach((f, i) => m!.set(f, i));
    POSITIONS.set(index, m);
  }
  return m;
}

/**
 * HYB's grep term: TF-IDF of the question's words as substrings of the
 * lowercased contents (find-the-fix picker A), over `candidates` only (the
 * F50 and hist arms' top 300 each), with document frequency counted over those
 * candidates. At weight 0.15 a grep-only file adds at most 0.15, so it almost
 * never reaches the top 6. Counts come from the index's grep cache (a run
 * index of the lowercased text, built in the background): the same numbers as
 * counting in each candidate's text, without reading or lowercasing ~12 MB of
 * it per ask.
 */
function grepScores(index: AskFileIndex, question: string, candidates: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])];
  if (words.length === 0) return out;
  const pos = filePositions(index);
  const pool: number[] = [];
  for (const f of candidates) {
    const i = pos.get(f);
    if (i !== undefined && index.grep.hasText(i)) pool.push(i);
  }
  const wcs = words.map((w) => index.grep.wordCounts(w));
  const counts = pool.map((i) => wcs.map((wc) => wc.get(i) ?? 0));
  const df = words.map((_, j) => counts.reduce((a, row) => a + (row[j]! > 0 ? 1 : 0), 0));
  const n = pool.length;
  pool.forEach((fi, i) => {
    let v = 0;
    words.forEach((_, j) => {
      const c = counts[i]![j]!;
      if (c) v += Math.log(1 + c) * Math.log(1 + n / df[j]!);
    });
    if (v > 0) out.set(index.files[fi]!, v);
  });
  return out;
}

/** An arm's top 300 files, ties by path. */
function top300(m: Map<string, number>): [string, number][] {
  return [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 300);
}

/** An arm's top 300 files divided by its max. */
function cutNorm(m: Map<string, number>): Map<string, number> {
  const top = top300(m);
  const max = Math.max(0, ...top.map(([, v]) => v));
  return new Map(top.map(([f, v]) => [f, max ? v / max : 0]));
}

/**
 * HYB_NOSEM (harness study search3/hybrid, frozen on dev, confirmed on fresh
 * sealed repos): n(F50) + 0.5 n(hist50) + 0.15 n(grep), each arm cut to its top
 * 300 and max-normalised. The frozen HYB adds 0.3 n(semSH), a WordLlama
 * embedding arm (16 MB of weights); without it the recipe needs no model and
 * kept most of the gain (dev: HYB +11.9, HYB_NOSEM +8.4 hit@5 over F50).
 * Without git history (no hist docs) this is F50 + 0.15 grep.
 *
 * Product change from the frozen recipe: grep runs over the F50 and hist top
 * 300 only (not every file), with its document frequency over those; checked
 * on the find-the-fix dev set (patches/v2/README.md).
 */
export function scoreAskFileHybrid(index: AskFileIndex, question: string): Map<string, number> {
  const out = new Map<string, number>();
  const f50 = scoreAskFileIndex(index, question);
  const hist = histScores(index, question);
  const pool = new Set([...top300(f50).map(([f]) => f), ...top300(hist).map(([f]) => f)]);
  const parts: [Map<string, number>, number][] = [
    [f50, 1],
    [hist, 0.5],
    [grepScores(index, question, pool), 0.15],
  ];
  for (const [m, w] of parts) for (const [f, v] of cutNorm(m)) out.set(f, (out.get(f) ?? 0) + w * v);
  return out;
}

/** Subjects of commits that carry no meaning about the files they touch (universal only; a bench can add its own). */
const NOISE_SUBJECT = /^(merge|wip)\b/i;

/* -c core.quotePath=false: non-ASCII paths come back as UTF-8, not C-quoted, so they match ls-files -z. */
const GIT = (root: string): string[] => ['-c', 'core.quotePath=false', '-C', root];

function historyArgs(root: string, rev: string, maxCommits: number, spec: readonly string[]): string[] {
  /* --relative: when `root` is a subdirectory of the repo, paths come back relative to it (as ls-files prints them) and the log is limited to it. */
  /* S-new3: the `.` pathspec limits the log to the subtree, so -n counts this subtree's commits, not the whole repo's. */
  return [...GIT(root), 'log', rev, '--relative', '--no-merges', '--no-renames', '-n', String(maxCommits), '--format=%x01%s', '--name-only', '--', ...spec];
}

function parseHistory(out: string, maxFiles: number, noise: RegExp): AskHistoryCommit[] {
  const commits: AskHistoryCommit[] = [];
  for (const block of out.split('\x01').slice(1)) {
    const [subject = '', ...rest] = block.split('\n');
    const files = rest.map((l) => l.trim()).filter(Boolean);
    if (files.length === 0 || files.length > maxFiles || NOISE_SUBJECT.test(subject) || noise.test(subject)) continue;
    commits.push({ subject, files });
  }
  return commits;
}

export interface AskHistoryOptions {
  rev?: string;
  maxCommits?: number;
  maxFiles?: number;
  /** Extra subjects to skip on top of merge/wip (the bench passes codeforge's log/handoff/lab). */
  noiseSubject?: RegExp;
}

const NEVER = /$^/;

/**
 * Non-merge commits reachable from `rev`, newest first, up to `maxCommits`:
 * subject and modified files; commits touching more than `maxFiles` files and
 * merge/wip subjects are skipped. Empty outside a git work tree.
 */
export function readGitHistory(root: string, opts: AskHistoryOptions = {}): AskHistoryCommit[] {
  const { rev = 'HEAD', maxCommits = 5000, maxFiles = 30, noiseSubject = NEVER } = opts;
  try {
    const out = execFileSync('git', historyArgs(root, rev, maxCommits, subtreePathspec(root)), { encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return parseHistory(out, maxFiles, noiseSubject);
  } catch {
    return [];
  }
}

/** {@link readGitHistory} without blocking the event loop. */
export async function readGitHistoryAsync(root: string, opts: AskHistoryOptions = {}): Promise<AskHistoryCommit[]> {
  const { rev = 'HEAD', maxCommits = 5000, maxFiles = 30, noiseSubject = NEVER } = opts;
  try {
    const { stdout } = await execFileAsync('git', historyArgs(root, rev, maxCommits, await subtreePathspecAsync(root)), { encoding: 'utf8', maxBuffer: 1 << 29, windowsHide: true });
    return parseHistory(stdout, maxFiles, noiseSubject);
  } catch {
    return [];
  }
}

function churnArgs(root: string, rev: string, commits: number, spec: readonly string[]): string[] {
  return [...GIT(root), 'log', '--first-parent', '--relative', '--diff-merges=off', '--no-renames', `-n${commits}`, '--name-only', '--format=%x1e', rev, '--', ...spec];
}

function parseChurn(out: string, maxFilesPerCommit: number): Map<string, number> {
  const churn = new Map<string, number>();
  for (const block of out.split('\x1e')) {
    const files = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (files.length === 0 || files.length > maxFilesPerCommit) continue;
    for (const f of files) churn.set(f, (churn.get(f) ?? 0) + 1);
  }
  return churn;
}

/**
 * How often each file changed in the `commits` first-parent commits up to
 * `rev` (inclusive), skipping commits that touch more than `maxFilesPerCommit`
 * files (mass renames, formatting sweeps). Merges count as zero files, as in
 * the reference. Paths are relative to `root` (a subdirectory works). Empty
 * when `root` is not a git work tree or git is missing.
 */
export function readGitChurn(
  root: string,
  opts: { rev?: string; commits?: number; maxFilesPerCommit?: number } = {},
): Map<string, number> {
  const { rev = 'HEAD', commits = 300, maxFilesPerCommit = 30 } = opts;
  try {
    const out = execFileSync('git', churnArgs(root, rev, commits, subtreePathspec(root)), { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return parseChurn(out, maxFilesPerCommit);
  } catch {
    return new Map();
  }
}

/** {@link readGitChurn} without blocking the event loop. */
export async function readGitChurnAsync(root: string, opts: { rev?: string; commits?: number; maxFilesPerCommit?: number } = {}): Promise<Map<string, number>> {
  const { rev = 'HEAD', commits = 300, maxFilesPerCommit = 30 } = opts;
  try {
    const { stdout } = await execFileAsync('git', churnArgs(root, rev, commits, await subtreePathspecAsync(root)), { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
    return parseChurn(stdout, maxFilesPerCommit);
  } catch {
    return new Map();
  }
}

/** A file's text if it is a readable, non-binary regular file of at most {@link ASK_INDEX_MAX_FILE_BYTES}; else null. */
export function readIndexText(resolveReadable: (rel: string) => string | null, rel: string): string | null {
  try {
    /* Inside the try: after a detach the resolver throws "no repo attached". */
    const abs = resolveReadable(rel);
    if (!abs) return null;
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > ASK_INDEX_MAX_FILE_BYTES) return null;
    const t = fs.readFileSync(abs, 'utf8');
    return t.includes('\0') ? null : t;
  } catch {
    return null;
  }
}

async function readIndexTextAsync(resolveReadable: (rel: string) => string | null, rel: string): Promise<string | null> {
  try {
    const abs = resolveReadable(rel);
    if (!abs) return null;
    const st = await fs.promises.stat(abs);
    if (!st.isFile() || st.size > ASK_INDEX_MAX_FILE_BYTES) return null;
    const t = await fs.promises.readFile(abs, 'utf8');
    return t.includes('\0') ? null : t;
  } catch {
    return null;
  }
}

/** Index files through a jail resolver (the same choke point as GET /api/file). Unreadable or binary files are path-only. */
export function indexFilesThrough(resolveReadable: (rel: string) => string | null, paths: readonly string[]): [string, string][] {
  return paths.map((rel) => [rel.replace(/\\/g, '/'), readIndexText(resolveReadable, rel) ?? '']);
}

const SOURCE = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
/** Build output and vendored code only: a user's `logs/`, `lab/` or `tmp/` module is still their source. */
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.git|vendor)\//;

/** The files the index covers: source, config and style files, outside build/vendor dirs, lockfiles excluded (the reference's filter). */
export function isAskIndexSource(p: string): boolean {
  return SOURCE.test(p) && !SKIP_DIR.test(p) && !/lock\.(json|ya?ml)$|-lock\.json$/.test(p);
}

function lsArgs(root: string, rev?: string): string[] {
  return rev ? [...GIT(root), 'ls-tree', '-r', '-z', '--name-only', rev] : [...GIT(root), 'ls-files', '-z'];
}

/**
 * The repo's tracked source files (`git ls-files`, or `git ls-tree` at `rev`),
 * filtered by {@link isAskIndexSource} and the caller's `skip`. Empty when
 * `root` is not a git work tree. The scan's own file nodes cover code only;
 * the fix for a style or config question lives in a .css / .json the scan
 * never lists (find-the-fix, codeforge: 29 of the 30 questions F50 lost
 * without them).
 */
export function listRepoSourceFiles(root: string, rev?: string, skip?: RegExp): string[] {
  try {
    const out = execFileSync('git', lsArgs(root, rev), { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return out.split('\0').filter((p) => p !== '' && isAskIndexSource(p) && !skip?.test(p));
  } catch {
    return [];
  }
}

/** {@link listRepoSourceFiles} without blocking the event loop. */
export async function listRepoSourceFilesAsync(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', lsArgs(root), { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
    return stdout.split('\0').filter((p) => p !== '' && isAskIndexSource(p));
  } catch {
    return [];
  }
}

export interface AskIndexBuildOptions {
  maxFiles?: number;
  maxTextBytes?: number;
  yieldEvery?: number;
  /** Polled between files; true abandons the build (a newer scan replaced this one). */
  cancelled?: () => boolean;
  /**
   * Build the LTR stage after the index is ready (default on; the environment
   * variable SEQUENCE_ASK_PICKER=hyb turns it off and FILE RESEARCH stays on
   * HYB_NOSEM).
   */
  ltr?: boolean;
  /** Told at each of the build's own yields to the event loop (tests count them). */
  onYield?: () => void;
  /**
   * Build on a worker thread running this program (the scan worker's file; askIndexWorker.ts) so the build's
   * garbage dies with the worker. The worker reads through its own plain jail, not `resolveReadable`. When it
   * cannot start or fails, the build runs in-process.
   */
  workerFile?: string | null;
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Whether the product builds the LTR stage (SEQUENCE_ASK_PICKER=hyb is the off switch). */
export function askLtrEnabled(): boolean {
  return process.env.SEQUENCE_ASK_PICKER !== 'hyb';
}

/**
 * Build the index for `repoRoot` without blocking the event loop: async git
 * (ls-files, churn, history) and async reads, yielding every `yieldEvery`
 * files. Candidates: `paths` (the scan's files) then the tracked source files,
 * deduped after normalising separators, at most `maxFiles`; once `maxTextBytes`
 * of text has been read, the rest are indexed by path only. Contents are read
 * through `resolveReadable`, the plain jail resolver: they only rank. Null when
 * cancelled.
 *
 * The returned index serves HYB_NOSEM at once. Its LTR stage (askLtr.ts: the
 * first-parent history, read concurrently, plus the definition and import
 * graph) is then built in the background, yielding between steps; it sets
 * `index.ltr` when done and `index.ltrPending` settles.
 */
export async function buildAskFileIndexAsync(
  repoRoot: string,
  paths: readonly string[],
  resolveReadable: (rel: string) => string | null,
  opts: AskIndexBuildOptions = {},
): Promise<AskFileIndex | null> {
  const { maxFiles = ASK_INDEX_MAX_FILES, maxTextBytes = ASK_INDEX_MAX_TEXT_BYTES, yieldEvery = ASK_INDEX_YIELD_EVERY, cancelled = () => false, ltr = askLtrEnabled(), onYield } = opts;
  const pause = (): Promise<void> => {
    onYield?.();
    return yieldToLoop();
  };
  const ltrHistory = ltr ? readAskLtrHistoryAsync(repoRoot) : null;
  const [tracked, churn, history] = await Promise.all([listRepoSourceFilesAsync(repoRoot), readGitChurnAsync(repoRoot), readGitHistoryAsync(repoRoot)]);
  if (cancelled()) return null;
  const all = [...new Set([...paths, ...tracked].map((p) => p.replace(/\\/g, '/')))].slice(0, maxFiles);
  const b = new AskIndexBuilder(ltr);
  let bytes = 0;
  let capped = false;
  /* Each slice of `yieldEvery` files is READ together and ADDED in order. One file at a time made the build as slow as the
     disk's latency times two round trips per file (3,900 files: seconds when quiet, minutes when something else is reading
     the disk), while the same files read in a worker took a fraction of it. The order, the byte cap and the result are
     unchanged: only the waiting overlaps. */
  let slice: (string | null)[] = [];
  for (let i = 0; i < all.length; i++) {
    if (i > 0 && i % yieldEvery === 0) {
      await pause();
      if (cancelled()) return null;
    }
    if (i % yieldEvery === 0 && !capped) slice = await Promise.all(all.slice(i, i + yieldEvery).map((r) => readIndexTextAsync(resolveReadable, r)));
    const rel = all[i]!;
    let text: string | null = null;
    if (!capped) {
      text = slice[i % yieldEvery] ?? null;
      if (text !== null && bytes + text.length > maxTextBytes) {
        capped = true;
        text = null;
      } else if (text !== null) bytes += text.length;
    }
    b.add(rel, text ?? '', text !== null);
  }
  await pause();
  /* The identifier memo sped up tokenising; it is not worth its memory between builds. */
  clearAskTokenCache();
  if (cancelled()) return null;
  const index = b.finish(churn, history);
  if (capped) index.textCapped = true;
  if (ltrHistory && b.facts) {
    const facts = b.facts;
    index.ltrPending = (async () => {
      const H = await ltrHistory;
      await pause();
      if (cancelled() || H.length === 0) return;
      const steps = buildAskLtrSteps(index, facts, H);
      for (;;) {
        const r = steps.next();
        if (r.done) {
          if (!cancelled()) index.ltr = r.value;
          return;
        }
        await pause();
        if (cancelled()) return;
      }
    })().catch(() => undefined);
  }
  return index;
}

/**
 * Build lifecycle, for tests and diagnostics: 'start' (root), 'ready' (root,
 * index), 'cancelled' (root), 'ltr' (root, index) when the LTR stage attaches.
 */
export const askIndexEvents = new EventEmitter();

interface CacheEntry {
  ready?: AskFileIndex;
  pending?: Promise<AskFileIndex | null>;
  /** When `ready` was built (carried unchanged to the next scan of the same repo). */
  builtAt?: number;
}

/**
 * A rescan of the same repo keeps the index it has instead of rebuilding it: the
 * index only RANKS, so one edited file moves nothing the ask can feel, while a
 * rebuild tokenises the whole repo (seconds of CPU on the main thread and a
 * ~130 MB allocation peak that V8 keeps committed for minutes: three one-file
 * rescans left the engine at 400 MB). Same rule as the find_files index
 * (findFiles.ts FRESH_MS): rebuild when the index is older than this, when
 * `fresh` says the tree moved under it (HEAD changed), or when the scan found
 * many files the index has never seen.
 */
export const ASK_INDEX_REFRESH_MS = 15 * 60_000;
/** Files new to the scan beyond this many (or 2% of the index) force a rebuild. */
export const ASK_INDEX_NEW_FILES_REBUILD = 20;

function carriedIndex(entry: CacheEntry | undefined, paths: readonly string[], fresh: boolean): CacheEntry | null {
  const index = entry?.ready;
  if (!entry || !index || fresh) return null;
  if (Date.now() - (entry.builtAt ?? 0) > ASK_INDEX_REFRESH_MS) return null;
  const known = new Set(index.files);
  let added = 0;
  for (const p of paths) if (!known.has(p.replace(/\\/g, '/'))) added++;
  if (added > Math.max(ASK_INDEX_NEW_FILES_REBUILD, index.n * 0.02)) return null;
  return { ready: index, builtAt: entry.builtAt };
}

const CACHE = new WeakMap<object, Map<string, CacheEntry>>();

function entryFor(scan: object, repoRoot: string): { byRoot: Map<string, CacheEntry>; entry: CacheEntry | undefined } {
  let byRoot = CACHE.get(scan);
  if (!byRoot) {
    byRoot = new Map();
    CACHE.set(scan, byRoot);
  }
  return { byRoot, entry: byRoot.get(repoRoot) };
}

/**
 * Start (or join) the background build of this scan's index. Called when a
 * scan lands (repoServer's setCurrentGraph) and, as a fallback, by the first
 * ask that finds no index. The promise resolves to the index, or null when
 * the build was cancelled (then a later call starts again).
 */
export function warmAskFileIndex(
  scan: object,
  repoRoot: string,
  paths: readonly string[],
  resolveReadable: (rel: string) => string | null,
  opts: AskIndexBuildOptions = {},
  /** The previous scan of this repo: its ready index is carried over unless it is stale (see {@link ASK_INDEX_REFRESH_MS}). */
  carryFrom?: object,
  /** True when the tree moved under the old index (HEAD changed): never carry it. */
  fresh = false,
): Promise<AskFileIndex | null> {
  const { byRoot, entry } = entryFor(scan, repoRoot);
  if (entry?.ready) return Promise.resolve(entry.ready);
  if (entry?.pending) return entry.pending;
  const plan = PLANS.get(scan);
  if (plan) {
    opts = { ...opts, workerFile: opts.workerFile ?? plan.workerFile, cancelled: opts.cancelled ?? plan.cancelled };
    carryFrom ??= plan.carryFrom?.();
    /* A scan nobody asked about has no index to carry: look back through the scans that followed one. */
    for (let hops = 0; carryFrom && !CACHE.get(carryFrom)?.get(repoRoot)?.ready && hops < 50; hops++) carryFrom = PLANS.get(carryFrom)?.carryFrom?.();
    fresh = fresh || plan.fresh;
  }
  if (carryFrom) {
    const carried = carriedIndex(CACHE.get(carryFrom)?.get(repoRoot), paths, fresh);
    if (carried) {
      byRoot.set(repoRoot, carried);
      return Promise.resolve(carried.ready!);
    }
  }
  const e: CacheEntry = {};
  askIndexEvents.emit('start', repoRoot);
  const build = opts.workerFile
    ? buildAskFileIndexInWorker(repoRoot, paths, opts.workerFile, opts).catch(() => (opts.cancelled?.() ? null : buildAskFileIndexAsync(repoRoot, paths, resolveReadable, opts)))
    : buildAskFileIndexAsync(repoRoot, paths, resolveReadable, opts);
  e.pending = build.then(
    (index) => {
      if (index) {
        e.ready = index;
        e.builtAt = Date.now();
        e.pending = undefined;
        askIndexEvents.emit('ready', repoRoot, index);
        void index.ltrPending?.then(() => {
          if (index.ltr) askIndexEvents.emit('ltr', repoRoot, index);
        });
      } else {
        if (byRoot.get(repoRoot) === e) byRoot.delete(repoRoot);
        askIndexEvents.emit('cancelled', repoRoot);
      }
      return index;
    },
    () => {
      if (byRoot.get(repoRoot) === e) byRoot.delete(repoRoot);
      return null;
    },
  );
  byRoot.set(repoRoot, e);
  plan?.started?.(e.pending);
  return e.pending;
}

/**
 * How a scan's index is to be built when somebody asks for it (the first ask). The server registers one per scan instead of
 * building at once: the build is seconds of CPU nobody has asked for yet, and it competed with the first board.
 */
export interface AskIndexPlan {
  /** The worker program to build on; null/undefined builds in-process. */
  workerFile?: string | null;
  cancelled?: () => boolean;
  /** The previous scan of the repo, to carry its index over from. */
  carryFrom?: () => object | undefined;
  /** The tree moved under the old index (HEAD changed). */
  fresh: boolean;
  /** The build began: lets the owner wait for it on close. */
  started?: (done: Promise<unknown>) => void;
}
const PLANS = new WeakMap<object, AskIndexPlan>();
export function planAskFileIndex(scan: object, plan: AskIndexPlan): void {
  PLANS.set(scan, plan);
}

/** This scan's index if its build has finished; undefined while it builds or before it started. Never waits. */
export function readyAskFileIndex(scan: object, repoRoot: string): AskFileIndex | undefined {
  return CACHE.get(scan)?.get(repoRoot)?.ready;
}

/** True while this scan's index is building. */
export function askFileIndexPending(scan: object, repoRoot: string): boolean {
  const e = CACHE.get(scan)?.get(repoRoot);
  return Boolean(e && !e.ready && e.pending);
}

/**
 * H-snippet: the single best-matching window of `text`, at most `budget`
 * bytes, line-aligned, windows starting every `step` lines. Each window is
 * scored by sum over the question's tokens of log(1+tf) x log(1 + windows/df),
 * with df counted over this file's windows. No match: the opening (today's
 * behaviour). Reference: harness-study/snippet.mjs, arm W (sealed codeforge:
 * edited code in view for 54.9% of picked truth files vs 30.1% for the opening).
 * Text over {@link ASK_INDEX_MAX_FILE_BYTES} gets the opening without scoring
 * (each window is tokenised: ~2,500 windows per MB).
 */
export function bestMatchingWindow(
  text: string,
  question: string,
  budget: number,
  step = 5,
): { startLine: number; endLine: number; content: string; totalLines: number } {
  if (text.length > ASK_INDEX_MAX_FILE_BYTES) {
    const content = text.slice(0, budget);
    let totalLines = 1;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) totalLines++;
    return { startLine: 1, endLine: content.split('\n').length, content, totalLines };
  }
  const lines = text.split('\n');
  const L = lines.length;
  /* Windows every `step` lines, each as many whole lines as fit the budget (at least one). Ends only grow: two pointers. */
  const windows: [number, number][] = [];
  {
    let e = 0;
    let bytes = 0;
    for (let s = 0; s < L; s += step) {
      if (e < s) {
        e = s;
        bytes = 0;
      }
      while (e < L && bytes + lines[e]!.length + 1 <= budget) {
        bytes += lines[e]!.length + 1;
        e++;
      }
      const end = e === s ? s + 1 : e;
      windows.push([s, end]);
      if (end >= L) break;
      /* Slide the window start: drop the lines s .. s+step-1 from the running byte count. */
      for (let i = s; i < Math.min(s + step, e); i++) bytes -= lines[i]!.length + 1;
    }
  }
  /*
   * M3: each line is tokenised once and only the question's tokens are
   * counted; a window's count is a prefix-sum difference. The score reads
   * only the question tokens' df, so the result equals tokenising each window.
   */
  const q = [...new Set(askTokens(question))];
  const qi = new Map(q.map((t, i) => [t, i]));
  const prefix = q.map(() => new Int32Array(L + 1));
  for (let l = 0; l < L; l++) {
    for (const p of prefix) p[l + 1] = p[l]!;
    if (q.length === 0) continue;
    for (const t of askTokens(lines[l]!)) {
      const i = qi.get(t);
      if (i !== undefined) prefix[i]![l + 1]!++;
    }
  }
  const df = q.map((_, i) => {
    let n = 0;
    for (const [s, e] of windows) if (prefix[i]![e]! - prefix[i]![s]! > 0) n++;
    return n;
  });
  let best = 0;
  let bestScore = 0;
  windows.forEach(([s, e], w) => {
    let v = 0;
    for (let i = 0; i < q.length; i++) {
      const c = prefix[i]![e]! - prefix[i]![s]!;
      if (c) v += Math.log(1 + c) * Math.log(1 + windows.length / df[i]!);
    }
    if (v > bestScore) {
      bestScore = v;
      best = w;
    }
  });
  const [s, e] = windows[best] ?? [0, lines.length];
  let content = lines.slice(s, e).join('\n');
  /* A single line longer than the budget: cut it, as the opening did. */
  if (content.length > budget) content = content.slice(0, budget);
  return { startLine: s + 1, endLine: e, content, totalLines: lines.length };
}
