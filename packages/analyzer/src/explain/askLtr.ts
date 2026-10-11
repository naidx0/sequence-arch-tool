/**
 * Ask FILE RESEARCH, learning-to-rank picker (LTR): a port of the frozen
 * harness-study search3/ltr picker (`ltrlib.features` + `pick.ltr_pick`).
 *
 * WHAT. A LightGBM LambdaRank model (askLtrModel.generated.ts, 150 trees, 39
 * features) re-ranks a candidate union: the top 50 of each of F50, grep
 * TF-IDF over every file, path BM25, the most recently changed files,
 * history-kNN (files of past commits whose subjects match the question) and
 * history-subject BM25 — about 125 candidates a query. On 8 sealed repos it put
 * a file the real fix edited in the top 5 for 84.9% of questions, against
 * 75.5% for HYB_NOSEM (the picker before it).
 *
 * WHERE IT RUNS. Everything here is built in the ask index's background build
 * (askFileIndex.ts): the per-file facts (defined identifiers, import specs)
 * while each file is read, the history (`git log --first-parent`, 3,000
 * commits) and the import graph as a second stage after the HYB index is
 * already serving. A query computes the features over the in-memory index and
 * runs the trees; until the LTR stage is ready an ask uses HYB_NOSEM.
 *
 * PARITY. Feature arithmetic, candidate order and tie-breaks follow the Python
 * reference operation for operation (insertion-ordered maps where Python uses
 * dicts, stable sorts, Python's compensated `sum` for the one float sum).
 * tools/bench/ltr-parity.mjs compares the two pickers' top 5 per question.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { subtreePathspec, subtreePathspecAsync } from './gitSubtree.js';
import { ASK_STOPWORDS, askTokens } from './askTokens.js';
import type { AskFileIndex } from './askFileIndex.js';
import { parseLightGbmModel, predictLightGbm, type LightGbmModel } from './lightgbm.js';
import { ASK_LTR_MODEL_TEXT } from './askLtrModel.generated.js';
import { AskTermCounts, detachString, type AskTermStore } from './askTermCounts.js';

const execFileAsync = promisify(execFile);

export const ASK_LTR_FEATURES = [
  'f50', 'f50_rank', 'bm25f', 'bm25f_n', 'bm25c_n', 'bm25p_n', 'bm25p', 'grep_n', 'grep_rank',
  'stem_hit', 'base_hit', 'path_qfrac', 'def_hit', 'def_hit_code', 'def_hit_idf',
  'churn30', 'churn100', 'churn300', 'churn_all', 'since_last', 'in_recent5', 'cochange',
  'hsub_n', 'hsub', 'knn_sum_n', 'knn_max_n', 'knn_w_n', 'knn_top',
  'loglen', 'is_test', 'depth', 'ext', 'dir_prior', 'nbr_max', 'nbr_cnt', 'indeg',
  'q_ntok', 'logN', 'qtok_cov',
] as const;

/** Commits of history the LTR features read (`since_last` defaults to this). */
export const ASK_LTR_HISTORY_COMMITS = 3000;
/** The import-graph and postings builds yield every this many files (about 20 ms each on a 20k-file repo). */
const ASK_LTR_STEP_FILES = 500;
/** Candidates taken from each arm of the union. */
export const ASK_LTR_CANDIDATES_PER_ARM = 50;

/* ───────────────────────── per-file facts (read once, at build) ───────────────────────── */

/* Python's str-mode \w is [\p{L}\p{N}_]; \b before a keyword = not preceded by one. */
const W = '\\p{L}\\p{N}_';
const DEF = new RegExp(
  `(?:(?<![${W}])def|(?<![${W}])class|(?<![${W}])function\\*?|(?<![${W}])const|(?<![${W}])let|(?<![${W}])var|(?<![${W}])fn|(?<![${W}])struct|(?<![${W}])interface|(?<![${W}])type|(?<![${W}])enum|(?<![${W}])trait|(?<![${W}])func|(?<![${W}])impl|(?<![${W}])export\\s+default\\s+function)\\s+([A-Za-z_$][${W}$]*)`,
  'gu',
);
const JSI = new RegExp(
  `(?:(?<![${W}])from\\s*|(?<![${W}])import\\s*\\(\\s*|(?<![${W}])require\\s*\\(\\s*|(?<![${W}])import\\s+)['"]([^'"\\n]+)['"]`,
  'gu',
);
/* re.M's ^ is start-of-text or after \n only. */
const BOL = '(?<![^\\n])';
const PYF = new RegExp(`${BOL}\\s*from\\s+(\\.*[${W}.]*)\\s+import\\s+\\(?([${W}, \\t*]+)`, 'gu');
const PYI = new RegExp(`${BOL}\\s*import\\s+([${W}.]+)`, 'gu');
const RSM = new RegExp(`${BOL}\\s*(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+([${W}]+)\\s*;`, 'gu');
const RSU = new RegExp(`(?<![${W}])use\\s+(crate|super|self)::([${W}:]+)`, 'gu');
const JS_FILE = /\.(m?[jt]sx?|cjs|mts|vue|svelte)$/;

export interface AskLtrFileFacts {
  /** Identifiers the file defines, lowercased. */
  defs: Set<string>;
  js?: string[];
  pyFrom?: [string, string][];
  pyImport?: string[];
  rsMod?: string[];
  rsUse?: [string, string][];
  /** `name` of a package.json. */
  pkgName?: string;
}

/** What the LTR features need from a file's text, extracted while the index reads it. */
export function extractAskLtrFacts(path: string, text: string): AskLtrFileFacts {
  /* Every kept string is detached from `text` (askTermCounts.ts detachString): facts live until the LTR stage is built, the text must not. */
  const d = detachString;
  const facts: AskLtrFileFacts = { defs: new Set() };
  for (const m of text.matchAll(DEF)) facts.defs.add(d(m[1]!.toLowerCase()));
  if (JS_FILE.test(path)) facts.js = [...text.matchAll(JSI)].map((m) => d(m[1]!));
  else if (path.endsWith('.py')) {
    facts.pyFrom = [...text.matchAll(PYF)].map((m) => [d(m[1]!), d(m[2]!)]);
    facts.pyImport = [...text.matchAll(PYI)].map((m) => d(m[1]!));
  } else if (path.endsWith('.rs')) {
    facts.rsMod = [...text.matchAll(RSM)].map((m) => d(m[1]!));
    facts.rsUse = [...text.matchAll(RSU)].map((m) => [d(m[1]!), d(m[2]!)]);
  }
  if (path.endsWith('package.json')) {
    try {
      const j: unknown = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const nm = (j as { name?: unknown }).name;
        if (typeof nm === 'string') facts.pkgName = nm;
      }
    } catch {
      /* not JSON: no package name */
    }
  }
  return facts;
}

/* ───────────────────────── history ───────────────────────── */

/** One first-parent commit (merges diffed against their first parent): subject and every file it changed. */
export interface AskLtrHistoryCommit {
  subject: string;
  files: string[];
}

function ltrHistoryArgs(root: string, rev: string, n: number, spec: readonly string[]): string[] {
  return ['-c', 'core.quotePath=false', '-C', root, 'log', '--first-parent', '--diff-merges=first-parent', '-n', String(n), '--name-only', '--format=%x00%H%x09%s', '--relative', rev, '--', ...spec];
}

function parseLtrHistory(out: string): AskLtrHistoryCommit[] {
  const H: AskLtrHistoryCommit[] = [];
  for (const rec of out.split('\0').slice(1)) {
    const lines = rec.split('\n');
    const head = lines[0] ?? '';
    const tab = head.indexOf('\t');
    H.push({ subject: tab >= 0 ? head.slice(tab + 1) : '', files: lines.slice(1).filter((l) => l !== '') });
  }
  return H;
}

/** The newest `maxCommits` first-parent commits up to `rev`, newest first. Empty outside a git work tree. */
export function readAskLtrHistory(root: string, opts: { rev?: string; maxCommits?: number } = {}): AskLtrHistoryCommit[] {
  const { rev = 'HEAD', maxCommits = ASK_LTR_HISTORY_COMMITS } = opts;
  try {
    return parseLtrHistory(execFileSync('git', ltrHistoryArgs(root, rev, maxCommits, subtreePathspec(root)), { encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }));
  } catch {
    return [];
  }
}

/** {@link readAskLtrHistory} without blocking the event loop. */
export async function readAskLtrHistoryAsync(root: string, opts: { rev?: string; maxCommits?: number } = {}): Promise<AskLtrHistoryCommit[]> {
  const { rev = 'HEAD', maxCommits = ASK_LTR_HISTORY_COMMITS } = opts;
  try {
    const { stdout } = await execFileAsync('git', ltrHistoryArgs(root, rev, maxCommits, await subtreePathspecAsync(root)), { encoding: 'utf8', maxBuffer: 1 << 29, windowsHide: true });
    return parseLtrHistory(stdout);
  } catch {
    return [];
  }
}

/* ───────────────────────── the LTR stage of the index ───────────────────────── */

type Counter = Map<string, number>;

interface CommitDoc {
  /** The commit's subject, kept for find_files's reason line. */
  subject: string;
  tf: Counter;
  len: number;
  files: string[];
}

export interface AskLtrData {
  histN: number;
  nh: number;
  pavg: number;
  last: Map<string, number>;
  ch30: Counter;
  ch100: Counter;
  ch300: Counter;
  chall: Counter;
  maxChall: number;
  dirc: Counter;
  sdocs: Map<string, Counter>;
  slen: Map<string, number>;
  sdf: Counter;
  spost: Map<string, string[]>;
  sN: number;
  savg: number;
  cdocs: (CommitDoc | null)[];
  cdf: Counter;
  cpost: Map<string, number[]>;
  cN: number;
  cavg: number;
  recent5: Set<string>;
  cochange: Counter;
  defs: Map<string, Set<string>>;
  defcount: Counter;
  nbr: Map<string, Set<string>>;
  indeg: Counter;
  /**
   * The BM25 arms' postings: word -> id, and for id the file numbers
   * postData[postStart[id] .. postStart[id + 1]) (in `index.files` order) whose
   * contents or path hold it. A query visits only those files, in the
   * reference's insertion order (word, then file order).
   */
  postId: ReadonlyMap<string, number>;
  postStart: Int32Array;
  postData: Int32Array;
  /** Each file's path length in tokens (bm25_path's document length), by file number. */
  plen: Float64Array;
}

const inc = (m: Counter, k: string, by = 1): void => {
  m.set(k, (m.get(k) ?? 0) + by);
};

/** posixpath.dirname */
function dirname(p: string): string {
  const i = p.lastIndexOf('/') + 1;
  let head = p.slice(0, i);
  if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, '');
  return head;
}

/** posixpath.join(a, b) */
function join(a: string, b: string): string {
  if (b.startsWith('/')) return b;
  if (!a || a.endsWith('/')) return a + b;
  return `${a}/${b}`;
}

/** posixpath.normpath */
function normpath(p: string): string {
  if (!p) return '.';
  let initial = p.startsWith('/') ? 1 : 0;
  if (initial && p.startsWith('//') && !p.startsWith('///')) initial = 2;
  const out: string[] = [];
  for (const c of p.split('/')) {
    if (c === '' || c === '.') continue;
    if (c !== '..' || (!initial && out.length === 0) || (out.length > 0 && out[out.length - 1] === '..')) out.push(c);
    else if (out.length > 0) out.pop();
  }
  const r = '/'.repeat(initial) + out.join('/');
  return r || '.';
}

/** Python list slice `xs[:end]` (negative end counts from the back). */
function sliceTo<T>(xs: T[], end: number): T[] {
  return xs.slice(0, end < 0 ? Math.max(0, xs.length + end) : end);
}

const JS_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

function* buildImports(files: readonly string[], facts: ReadonlyMap<string, AskLtrFileFacts>): Generator<void, { nbr: Map<string, Set<string>>; indeg: Counter }, void> {
  const fset = new Set(files);
  const pymod = new Map<string, string[]>();
  for (const f of files) {
    if (!f.endsWith('.py')) continue;
    let m = f.slice(0, -3);
    if (m.endsWith('/__init__')) m = m.slice(0, -9);
    const parts = m.split('/');
    for (let i = 0; i < parts.length; i++) {
      const k = parts.slice(i).join('.');
      const l = pymod.get(k);
      if (l) l.push(f);
      else pymod.set(k, [f]);
    }
  }
  const pkgs = new Map<string, string>();
  for (const f of files) {
    if (!f.endsWith('package.json')) continue;
    const nm = facts.get(f)?.pkgName;
    if (nm !== undefined) pkgs.set(nm, dirname(f));
  }
  const resJs = (raw: string): string | null => {
    const base = normpath(raw);
    if (base.startsWith('..')) return null;
    const cands = [base];
    if (/\.(m|c)?js$/.test(base)) cands.push(base.replace(/\.(m|c)?js$/, ''));
    for (const c of cands) for (const e of JS_EXTS) if (fset.has(c + e)) return c + e;
    return null;
  };
  const nbr = new Map<string, Set<string>>();
  const indeg: Counter = new Map();
  const add = (a: string, b: string): void => {
    if (!b || b === a) return;
    let s = nbr.get(a);
    if (!s) nbr.set(a, (s = new Set()));
    s.add(b);
    let t = nbr.get(b);
    if (!t) nbr.set(b, (t = new Set()));
    t.add(a);
  };
  let k = 0;
  for (const f of files) {
    if (++k % ASK_LTR_STEP_FILES === 0) yield;
    const fx = facts.get(f);
    if (!fx) continue;
    const d = dirname(f);
    if (JS_FILE.test(f)) {
      for (const spec of fx.js ?? []) {
        let tgt: string | null = null;
        if (spec.startsWith('.')) tgt = resJs(join(d, spec));
        else {
          for (const [nm, pd] of pkgs) {
            if (spec === nm || spec.startsWith(`${nm}/`)) {
              const sub = spec.slice(nm.length).replace(/^\/+/, '');
              for (const root of [`${pd}/src`, pd]) {
                tgt = resJs(join(root, sub || 'index'));
                if (tgt) break;
              }
              break;
            }
          }
          if (!tgt && (spec.slice(0, 2) === '@/' || spec.slice(0, 2) === '~/')) tgt = resJs(join('src', spec.slice(2))) ?? resJs(spec.slice(2));
        }
        if (tgt) {
          add(f, tgt);
          inc(indeg, tgt);
        }
      }
    } else if (f.endsWith('.py')) {
      for (const [mod, names] of fx.pyFrom ?? []) {
        let absm: string;
        if (mod.startsWith('.')) {
          const stripped = mod.replace(/^\.+/, '');
          const lv = mod.length - stripped.length;
          let bp = d ? d.split('/') : [];
          if (lv > 1) bp = sliceTo(bp, bp.length - (lv - 1));
          absm = [...bp.filter((x) => x), ...(stripped ? [stripped] : [])].join('.');
        } else absm = mod;
        const tg = absm ? pymod.get(absm) : undefined;
        if (tg && tg.length <= 3)
          for (const x of tg) {
            add(f, x);
            inc(indeg, x);
          }
        for (const raw of names.replace(/\t/g, ' ').split(',')) {
          const nm = raw.trim().split(' ')[0]!;
          if (nm && nm !== '*') {
            const tg2 = pymod.get((absm ? `${absm}.` : '') + nm);
            if (tg2 && tg2.length <= 3)
              for (const x of tg2) {
                add(f, x);
                inc(indeg, x);
              }
          }
        }
      }
      for (const mod of fx.pyImport ?? []) {
        const tg = pymod.get(mod);
        if (tg && tg.length <= 3)
          for (const x of tg) {
            add(f, x);
            inc(indeg, x);
          }
      }
    } else if (f.endsWith('.rs')) {
      for (const m of fx.rsMod ?? []) {
        const base = f.endsWith('mod.rs') || f.endsWith('lib.rs') || f.endsWith('main.rs') ? d : f.slice(0, -3);
        for (const c of [`${base}/${m}.rs`, `${base}/${m}/mod.rs`]) {
          if (fset.has(c)) {
            add(f, c);
            inc(indeg, c);
            break;
          }
        }
      }
      for (const [kind, p] of fx.rsUse ?? []) {
        const seg = p.split('::')[0]!;
        let root = d;
        if (kind === 'crate') {
          const i = f.lastIndexOf('src/');
          root = i >= 0 ? f.slice(0, i + 3) : d;
        }
        for (const c of [`${root}/${seg}.rs`, `${root}/${seg}/mod.rs`]) {
          if (fset.has(c)) {
            add(f, c);
            inc(indeg, c);
            break;
          }
        }
      }
    }
  }
  return { nbr, indeg };
}

/**
 * Postings for the BM25 arms, compressed rows: word -> id, then file numbers
 * postData[postStart[id] .. postStart[id + 1]) in index order. Two passes
 * (count, fill), yielding every ASK_LTR_STEP_FILES files.
 */
function* buildBm25Postings(
  files: readonly string[],
  docs: AskFileIndex['docs'],
  pathDocs: AskFileIndex['pathDocs'],
): Generator<void, Pick<AskLtrData, 'postId' | 'postStart' | 'postData' | 'plen'>, void> {
  /* The product's index (askTermCounts.ts): its vocabulary ids ARE the posting ids, so no second word Map. */
  const store = files.length > 0 ? shared(docs.get(files[0]!)!.tf) : null;
  if (store && files.every((f) => shared(docs.get(f)!.tf) === store && shared(pathDocs.get(f)!) === store)) return yield* buildBm25PostingsById(files, docs, pathDocs, store);
  const plen = new Float64Array(files.length);
  const postId = new Map<string, number>();
  let cnt = new Int32Array(1 << 14);
  const count = (w: string): void => {
    let id = postId.get(w);
    if (id === undefined) {
      id = postId.size;
      postId.set(w, id);
      if (id >= cnt.length) {
        const next = new Int32Array(cnt.length * 2);
        next.set(cnt);
        cnt = next;
      }
    }
    cnt[id]!++;
  };
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && i % ASK_LTR_STEP_FILES === 0) yield;
    const f = files[i]!;
    const tf = docs.get(f)!.tf;
    for (const w of tf.keys()) count(w);
    let l = 0;
    for (const [w, v] of pathDocs.get(f)!) {
      l += v;
      if (!tf.has(w)) count(w);
    }
    plen[i] = l;
  }
  yield;
  const nWords = postId.size;
  const postStart = new Int32Array(nWords + 1);
  for (let k = 0; k < nWords; k++) postStart[k + 1] = postStart[k]! + cnt[k]!;
  const fill = postStart.slice(0, nWords);
  cnt = new Int32Array(0);
  const postData = new Int32Array(postStart[nWords]!);
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && i % ASK_LTR_STEP_FILES === 0) yield;
    const f = files[i]!;
    const tf = docs.get(f)!.tf;
    for (const w of tf.keys()) postData[fill[postId.get(w)!]!++] = i;
    for (const w of pathDocs.get(f)!.keys()) if (!tf.has(w)) postData[fill[postId.get(w)!]!++] = i;
  }
  yield;
  return { postId, postStart, postData, plen };
}

const shared = (m: ReadonlyMap<string, number>): AskTermStore | null => (m instanceof AskTermCounts ? m.termStore : null);

/** {@link buildBm25Postings} over compact term counts: the same postings (files in index order per word), ids from the store. */
function* buildBm25PostingsById(
  files: readonly string[],
  docs: AskFileIndex['docs'],
  pathDocs: AskFileIndex['pathDocs'],
  store: AskTermStore,
): Generator<void, Pick<AskLtrData, 'postId' | 'postStart' | 'postData' | 'plen'>, void> {
  const plen = new Float64Array(files.length);
  const nWords = store.terms.length;
  const cnt = new Int32Array(nWords);
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && i % ASK_LTR_STEP_FILES === 0) yield;
    const f = files[i]!;
    const tf = docs.get(f)!.tf as AskTermCounts;
    tf.forEachId((id) => cnt[id]!++);
    let l = 0;
    (pathDocs.get(f)! as AskTermCounts).forEachId((id, v) => {
      l += v;
      if (!tf.hasId(id)) cnt[id]!++;
    });
    plen[i] = l;
  }
  yield;
  const postStart = new Int32Array(nWords + 1);
  for (let k = 0; k < nWords; k++) postStart[k + 1] = postStart[k]! + cnt[k]!;
  const fill = postStart.slice(0, nWords);
  const postData = new Int32Array(postStart[nWords]!);
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && i % ASK_LTR_STEP_FILES === 0) yield;
    const f = files[i]!;
    const tf = docs.get(f)!.tf as AskTermCounts;
    tf.forEachId((id) => (postData[fill[id]!++] = i));
    (pathDocs.get(f)! as AskTermCounts).forEachId((id) => {
      if (!tf.hasId(id)) postData[fill[id]!++] = i;
    });
  }
  yield;
  return { postId: store.ids, postStart, postData, plen };
}

/**
 * The LTR stage of the index, as steps: the caller runs it to completion
 * (tests, the bench) or yields to the event loop between steps (the
 * background build).
 */
export function* buildAskLtrSteps(
  index: AskFileIndex,
  facts: ReadonlyMap<string, AskLtrFileFacts>,
  history: readonly AskLtrHistoryCommit[],
  histN = ASK_LTR_HISTORY_COMMITS,
): Generator<void, AskLtrData, void> {
  const { docs, pathDocs } = index;
  const files = index.files;
  let ptot = 0;
  for (const f of files) for (const v of pathDocs.get(f)!.values()) ptot += v;
  const pavg = ptot / (files.length || 1);

  const last = new Map<string, number>();
  const ch30: Counter = new Map();
  const ch100: Counter = new Map();
  const ch300: Counter = new Map();
  const chall: Counter = new Map();
  const dirc: Counter = new Map();
  const sdocs = new Map<string, Counter>();
  const cdocs: (CommitDoc | null)[] = [];
  history.forEach((c, i) => {
    const inraw = c.files.filter((f) => docs.has(f));
    const big = c.files.length > 30;
    for (const f of inraw) {
      if (!last.has(f)) last.set(f, i);
      if (!big) {
        if (i < 30) inc(ch30, f);
        if (i < 100) inc(ch100, f);
        if (i < 300) inc(ch300, f);
        inc(chall, f);
      }
    }
    if (big || inraw.length === 0) {
      cdocs.push(null);
      return;
    }
    const tf: Counter = new Map();
    let len = 0;
    for (const t of askTokens(c.subject)) {
      inc(tf, t);
      len++;
    }
    cdocs.push({ subject: c.subject, tf, len, files: inraw });
    for (const f of inraw) {
      let d = sdocs.get(f);
      if (!d) sdocs.set(f, (d = new Map()));
      for (const [w, n] of tf) inc(d, w, n);
    }
    if (i < 300) for (const d of new Set(inraw.map(dirname))) inc(dirc, d);
  });
  yield;
  const sdf: Counter = new Map();
  const spost = new Map<string, string[]>();
  const slen = new Map<string, number>();
  let stot = 0;
  for (const [f, c] of sdocs) {
    let l = 0;
    for (const [w, n] of c) {
      inc(sdf, w);
      const p = spost.get(w);
      if (p) p.push(f);
      else spost.set(w, [f]);
      l += n;
    }
    slen.set(f, l);
    stot += l;
  }
  const sN = Math.max(1, sdocs.size);
  const cdf: Counter = new Map();
  const cpost = new Map<string, number[]>();
  let nc = 0;
  let cl = 0;
  cdocs.forEach((cd, j) => {
    if (!cd) return;
    nc++;
    cl += cd.len;
    for (const w of cd.tf.keys()) {
      inc(cdf, w);
      const p = cpost.get(w);
      if (p) p.push(j);
      else cpost.set(w, [j]);
    }
  });
  const cN = Math.max(1, nc);
  const recent5 = new Set<string>();
  for (const c of history.slice(0, 5)) if (c.files.length <= 30) for (const f of c.files) if (docs.has(f)) recent5.add(f);
  const cochange: Counter = new Map();
  for (const cd of cdocs.slice(0, 300)) {
    if (!cd) continue;
    let r = 0;
    for (const f of cd.files) if (recent5.has(f)) r++;
    if (r) for (const f of cd.files) inc(cochange, f, (r - (recent5.has(f) ? 1 : 0)) / cd.files.length);
  }
  yield;
  const defs = new Map<string, Set<string>>();
  const defcount: Counter = new Map();
  for (const f of files) {
    const d = facts.get(f)?.defs ?? new Set<string>();
    defs.set(f, d);
    for (const x of d) inc(defcount, x);
  }
  yield;
  const { nbr, indeg } = yield* buildImports(files, facts);
  yield;
  const { postId, postStart, postData, plen } = yield* buildBm25Postings(files, docs, pathDocs);
  /* The grep arm's word lookup: trigram postings over the run vocabulary. */
  yield* index.grep.indexTrigrams();
  let maxChall = 1;
  for (const v of chall.values()) if (v > maxChall) maxChall = v;
  return {
    histN,
    nh: history.length,
    pavg,
    last,
    ch30,
    ch100,
    ch300,
    chall,
    maxChall,
    dirc,
    sdocs,
    slen,
    sdf,
    spost,
    sN,
    savg: stot / sN,
    cdocs,
    cdf,
    cpost,
    cN,
    cavg: nc ? cl / cN : 1,
    recent5,
    cochange,
    defs,
    defcount,
    nbr,
    indeg,
    postId,
    postStart,
    postData,
    plen,
  };
}

/** Run {@link buildAskLtrSteps} to completion. */
export function buildAskLtrData(index: AskFileIndex, facts: ReadonlyMap<string, AskLtrFileFacts>, history: readonly AskLtrHistoryCommit[], histN = ASK_LTR_HISTORY_COMMITS): AskLtrData {
  const it = buildAskLtrSteps(index, facts, history, histN);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/* ───────────────────────── features ───────────────────────── */

const TESTRE = /(^|\/)(tests?|__tests__|spec|e2e|test_utils)\/|(^|\/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$|(^|\/)conftest\.py$/i;
const EXT_GROUPS: readonly (readonly string[])[] = [
  ['py'],
  ['ts', 'tsx', 'mts', 'cts'],
  ['js', 'jsx', 'mjs', 'cjs'],
  ['json', 'yaml', 'yml', 'toml'],
  ['css', 'html', 'vue', 'svelte'],
  ['rs', 'go', 'java', 'kt', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift', 'rb', 'php', 'dart'],
  ['sh', 'ps1'],
];

function norm(m: Counter): Counter {
  let mx = 0;
  for (const v of m.values()) if (v > mx) mx = v;
  const out: Counter = new Map();
  for (const [k, v] of m) out.set(k, mx ? v / mx : 0);
  return out;
}

/** Stable sort by score, descending (Python `sorted(key=-v)`). */
export function byScore(m: Counter): string[] {
  return [...m].sort((a, b) => (a[1] === b[1] ? 0 : b[1] - a[1])).map(([f]) => f);
}

/**
 * `byScore(m).slice(0, k)` without sorting all of `m`: the k-th best score is
 * found on a typed copy, then only the entries at or above it are sorted
 * (stable, so ties keep insertion order as Python's sorted does).
 */
export function topByScore(m: Counter, k: number): string[] {
  if (m.size <= 4 * k) return byScore(m).slice(0, k);
  const vals = Float64Array.from(m.values()).sort();
  const cut = vals[vals.length - k]!;
  let above = 0;
  for (const v of m.values()) if (v > cut) above++;
  let ties = k - above;
  const keep: [string, number][] = [];
  for (const e of m) {
    if (e[1] > cut) keep.push(e);
    else if (e[1] === cut && ties > 0) {
      keep.push(e);
      ties--;
    }
  }
  return keep.sort((a, b) => (a[1] === b[1] ? 0 : b[1] - a[1])).map(([f]) => f);
}

/**
 * Each of `want`'s positions in `byScore(m)` (absent when not in `m`), without
 * sorting `m`: the entries scoring higher, plus the equal ones inserted before.
 */
export function rankOf(m: Counter, want: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const vs: number[] = [];
  for (const f of want) {
    const v = m.get(f);
    if (v !== undefined) vs.push(v);
  }
  if (vs.length === 0) return out;
  const sorted = Float64Array.from(new Set(vs)).sort();
  const S = sorted.length;
  /* hist[j]: entries above exactly the wanted scores sorted[0 .. j); eq[j]: entries equal to sorted[j] seen so far. */
  const hist = new Int32Array(S + 1);
  const eq = new Int32Array(S);
  const wanted = new Set(want);
  const at = new Map<string, number>();
  for (const [f, v] of m) {
    let lo = 0;
    let hi = S;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    hist[lo]!++;
    if (lo < S && sorted[lo] === v) {
      if (wanted.has(f)) {
        out.set(f, eq[lo]!);
        at.set(f, lo);
      }
      eq[lo]!++;
    }
  }
  /* above[j] = entries scoring higher than sorted[j] = sum of hist[l] for l > j. */
  const above = new Int32Array(S);
  for (let j = S - 1, acc = 0; j >= 0; j--) {
    acc += hist[j + 1]!;
    above[j] = acc;
  }
  for (const [f, j] of at) out.set(f, out.get(f)! + above[j]!);
  return out;
}

/** Python 3.12+ `sum()` of floats (Neumaier compensated). */
function pySum(xs: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
  }
  return s + c;
}

/** The grep arm over every file (search3/ltr `grep_scores`): TF-IDF of the question's words as substrings of the lowercased text. */
export function askGrepAll(index: AskFileIndex, question: string): Counter {
  const g = index.grep;
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])];
  const s: Counter = new Map();
  const N = g.readFiles;
  for (const w of words) {
    const { files, counts } = g.wordCountsDense(w);
    if (files.length === 0) continue;
    const iw = Math.log(1 + N / files.length);
    for (const fi of files) {
      const f = index.files[fi]!;
      s.set(f, (s.get(f) ?? 0) + Math.log(1 + counts[fi]!) * iw);
    }
  }
  for (const [f, v] of s) if (!(v > 0)) s.delete(f);
  return s;
}

export interface AskLtrFeatureRows {
  cands: string[];
  rows: number[][];
}

/** search3/ltr `features(snap, q)`: the candidate union and one 39-feature row per candidate. */
export function askLtrFeatures(index: AskFileIndex, q: string, ncand = ASK_LTR_CANDIDATES_PER_ARM): AskLtrFeatureRows {
  const L = index.ltr;
  if (!L) return { cands: [], rows: [] };
  const { docs, pathDocs, df, n: N, avgdl, files } = index;
  const k1 = 1.2;
  const allws = [...new Set(askTokens(q))];
  const ws = allws.filter((w) => df.has(w));
  const idf = (w: string): number => {
    const d = df.get(w) ?? 0;
    return Math.log(1 + (N - d + 0.5) / (d + 0.5));
  };
  /* bm25 (BM25F), bm25_content, bm25_path — insertion order as the reference: word, then file order. */
  const bmRaw: Counter = new Map();
  const bc: Counter = new Map();
  const bp: Counter = new Map();
  for (const w of ws) {
    const iw = idf(w);
    const id = L.postId.get(w);
    if (id === undefined) continue;
    for (let k = L.postStart[id]!, end = L.postStart[id + 1]!; k < end; k++) {
      const i = L.postData[k]!;
      const f = files[i]!;
      const d = docs.get(f)!;
      const tf = d.tf.get(w) ?? 0;
      const pf = pathDocs.get(f)!.get(w) ?? 0;
      {
        const b = 0.75;
        const tfw = tf + 3 * pf;
        const lenN = d.len + 3 * 4;
        bmRaw.set(f, (bmRaw.get(f) ?? 0) + (iw * (tfw * (k1 + 1))) / (tfw + k1 * (1 - b + (b * lenN) / avgdl)));
      }
      if (tf) {
        const b = 0.75;
        bc.set(f, (bc.get(f) ?? 0) + (iw * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.len) / avgdl)));
      }
      if (pf) {
        const b = 0.5;
        bp.set(f, (bp.get(f) ?? 0) + (iw * pf * (k1 + 1)) / (pf + k1 * (1 - b + (b * L.plen[i]!) / (L.pavg || 1))));
      }
    }
  }
  const bm: Counter = new Map();
  for (const [f, v] of bmRaw) if (v > 0) bm.set(f, v);
  /* with_churn(bm, 0.5) */
  const f50: Counter = new Map();
  {
    const den = Math.log(1 + index.maxChurn);
    for (const [f, v] of norm(bm)) f50.set(f, v + (0.5 * Math.log(1 + (index.churn.get(f) ?? 0))) / den);
  }
  const gr = askGrepAll(index, q);
  /* hist_subject */
  const hs: Counter = new Map();
  for (const w of allws) {
    const d = L.sdf.get(w) ?? 0;
    if (!d) continue;
    const iw = Math.log(1 + (L.sN - d + 0.5) / (d + 0.5));
    for (const f of L.spost.get(w)!) {
      const tf = L.sdocs.get(f)!.get(w)!;
      hs.set(f, (hs.get(f) ?? 0) + (iw * tf * (k1 + 1)) / (tf + k1 * (1 - 0.75 + (0.75 * L.slen.get(f)!) / L.savg)));
    }
  }
  /* knn: the 20 past commits whose subjects best match, their files' votes */
  const cs = new Map<number, number>();
  for (const w of allws) {
    const d = L.cdf.get(w) ?? 0;
    if (!d) continue;
    const iw = Math.log(1 + (L.cN - d + 0.5) / (d + 0.5));
    for (const j of L.cpost.get(w)!) {
      const cd = L.cdocs[j]!;
      const tf = cd.tf.get(w)!;
      cs.set(j, (cs.get(j) ?? 0) + (iw * tf * (k1 + 1)) / (tf + k1 * (1 - 0.75 + (0.75 * cd.len) / L.cavg)));
    }
  }
  const best = [...cs].sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0] - b[0])).slice(0, 20);
  const ks: Counter = new Map();
  const km: Counter = new Map();
  const kw: Counter = new Map();
  for (const [j, v] of best) {
    const fl = L.cdocs[j]!.files;
    for (const f of fl) {
      ks.set(f, (ks.get(f) ?? 0) + v);
      kw.set(f, (kw.get(f) ?? 0) + v / fl.length);
      km.set(f, Math.max(km.get(f) ?? 0, v));
    }
  }
  const ktop = best.length ? best[0]![1] : 0;
  const bmn = norm(bm);
  const grn = norm(gr);
  const bcn = norm(bc);
  const bpn = norm(bp);
  const hsn = norm(hs);
  const ksn = norm(ks);
  const kmn = norm(km);
  const kwn = norm(kw);
  const rec = [...L.last].sort((a, b) => a[1] - b[1]).slice(0, ncand).map(([f]) => f);
  const cands: string[] = [];
  const seen = new Set<string>();
  for (const lst of [topByScore(f50, ncand), topByScore(gr, ncand), topByScore(bp, ncand), rec, topByScore(ks, ncand), topByScore(hs, ncand)]) {
    for (const f of lst) {
      if (!seen.has(f)) {
        seen.add(f);
        cands.push(f);
      }
    }
  }
  const f50r = rankOf(f50, cands);
  const grr = rankOf(gr, cands);
  const qwords = (q.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => w.length > 2);
  const qlow = new Set(qwords.map((w) => w.toLowerCase()).filter((w) => !ASK_STOPWORDS.has(w)));
  const qcode = new Set(qwords.filter((w) => w.replace(/^_+|_+$/g, '').includes('_') || /[a-z][A-Z]/.test(w) || /[A-Z]{2,}[a-z]/.test(w)).map((w) => w.toLowerCase()));
  for (const m of q.matchAll(new RegExp(`\`([A-Za-z_][${W}.]*)\``, 'gu'))) qcode.add(m[1]!.toLowerCase());
  const qlowNorm = new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9_-]+/g) ?? []).map((w) => w.replace(/[-_]/g, '')));
  const qraw = q.toLowerCase();
  const rows: number[][] = [];
  for (const f of cands) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const bl = base.toLowerCase();
    const st = bl.replace(/\.[^.]*$/, '').replace(/\.(test|spec|d)$/, '');
    const ptoks = pathDocs.get(f)!;
    const doc = docs.get(f)!;
    const dfs = L.defs.get(f) ?? new Set<string>();
    let dh = 0;
    const dhiTerms: number[] = [];
    for (const w of qlow) {
      if (dfs.has(w)) {
        dh++;
        dhiTerms.push(Math.log(1 + N / L.defcount.get(w)!));
      }
    }
    let dhc = 0;
    for (const w of qcode) if (dfs.has(w)) dhc++;
    let nbm = 0;
    let nbc = 0;
    for (const g of L.nbr.get(f) ?? []) {
      const v = bmn.get(g) ?? 0;
      if (v > nbm) nbm = v;
      if (v > 0.5) nbc++;
    }
    const dot = base.lastIndexOf('.');
    const ext = (dot >= 0 ? base.slice(dot + 1) : base).toLowerCase();
    let eg = EXT_GROUPS.findIndex((g) => g.includes(ext));
    if (eg < 0) eg = EXT_GROUPS.length;
    let inPath = 0;
    let cov = 0;
    for (const w of ws) {
      if (ptoks.has(w)) inPath++;
      if (doc.tf.get(w) || ptoks.get(w)) cov++;
    }
    const wn = ws.length || 1;
    rows.push([
      f50.get(f) ?? 0,
      f50r.get(f) ?? 9999,
      bm.get(f) ?? 0,
      bmn.get(f) ?? 0,
      bcn.get(f) ?? 0,
      bpn.get(f) ?? 0,
      bp.get(f) ?? 0,
      grn.get(f) ?? 0,
      grr.get(f) ?? 9999,
      st.length >= 3 && qlowNorm.has(st.replace(/[-_]/g, '')) ? 1 : 0,
      qraw.includes(bl) ? 1 : 0,
      inPath / wn,
      dh,
      dhc,
      pySum(dhiTerms),
      L.ch30.get(f) ?? 0,
      L.ch100.get(f) ?? 0,
      L.ch300.get(f) ?? 0,
      Math.log(1 + (L.chall.get(f) ?? 0)) / Math.log(1 + L.maxChall),
      L.last.get(f) ?? L.histN,
      L.recent5.has(f) ? 1 : 0,
      L.cochange.get(f) ?? 0,
      hsn.get(f) ?? 0,
      hs.get(f) ?? 0,
      ksn.get(f) ?? 0,
      kmn.get(f) ?? 0,
      kwn.get(f) ?? 0,
      ktop,
      Math.log(1 + doc.len),
      TESTRE.test(f) ? 1 : 0,
      f.split('/').length - 1,
      eg,
      (L.dirc.get(dirname(f)) ?? 0) / Math.max(1, Math.min(300, L.nh)),
      nbm,
      nbc,
      Math.log(1 + (L.indeg.get(f) ?? 0)),
      ws.length,
      Math.log(1 + N),
      cov / wn,
    ]);
  }
  return { cands, rows };
}

/* ───────────────────────── the model ───────────────────────── */

let MODEL: LightGbmModel | null = null;

/** The shipped model, parsed once. Throws if its features are not {@link ASK_LTR_FEATURES}. */
export function askLtrModel(): LightGbmModel {
  if (!MODEL) {
    const m = parseLightGbmModel(ASK_LTR_MODEL_TEXT);
    if (m.featureNames.join(' ') !== ASK_LTR_FEATURES.join(' ')) throw new Error('ask LTR model: feature names do not match askLtrFeatures');
    MODEL = m;
  }
  return MODEL;
}

/**
 * The LTR ranking: every candidate, best first (model score, then F50 rank,
 * then path — pick.py's order). Empty when the LTR stage is not built.
 */
export function rankAskFileLtr(index: AskFileIndex, question: string, model: LightGbmModel = askLtrModel()): string[] {
  return rankAskFileLtrScored(index, question, model).ranked.map((r) => r.path);
}

export interface AskLtrRanked {
  /** Every candidate, best first. */
  ranked: { path: string; score: number; row: number[] }[];
  /** The candidates in union order with their feature rows (what a trainer logs). */
  cands: string[];
  rows: number[][];
}

/** {@link rankAskFileLtr} that also hands back each candidate's score and its 39-feature row. */
export function rankAskFileLtrScored(index: AskFileIndex, question: string, model: LightGbmModel = askLtrModel()): AskLtrRanked {
  const { cands, rows } = askLtrFeatures(index, question);
  if (cands.length === 0) return { ranked: [], cands, rows };
  const s = rows.map((r) => predictLightGbm(model, r));
  const order = cands.map((_, i) => i);
  order.sort((a, b) => {
    if (s[a] !== s[b]) return s[b]! - s[a]!;
    if (rows[a]![1] !== rows[b]![1]) return rows[a]![1]! - rows[b]![1]!;
    return cands[a]! < cands[b]! ? -1 : cands[a]! > cands[b]! ? 1 : 0;
  });
  return { ranked: order.map((i) => ({ path: cands[i]!, score: s[i]!, row: rows[i]! })), cands, rows };
}
