#!/usr/bin/env node
/*
 * find-the-fix — can the map find the files a real change touched?
 *
 * Offline, no model, no key. For a repository it extracts the tree at S (the
 * first-parent commit `--back` before HEAD), scans it once, and takes the next
 * first-parent commits after S as questions: the subject is the question and
 * the files the commit modified (that already existed at S) are the answer.
 * Every picker reads only the S tree, so a fix cannot leak into its own search.
 *
 *   A grep      TF-IDF of the question's words over file contents
 *   B sequence  selectAskResearchPaths over the map's digest files (the product today)
 *   D lexical   A + Sequence's path score, each scaled to 0..1
 *   C topology  D + 0.5 x the best D among the file's one-hop map neighbours
 *
 *   node tools/bench/find-the-fix.mjs --repo <dir> [--back 300] [--k 5] [--out file.json]
 *
 * Registered in lab/log.md (2026-10-01) before the first run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../../packages/analyzer/dist/scan.js';
import { buildDigest } from '../../packages/analyzer/dist/explain/explain.js';
import { selectAskResearchPaths } from '../../packages/analyzer/dist/explain/askFileResearch.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const REPO = path.resolve(arg('--repo', '.'));
const BACK = Number(arg('--back', 300));
const K = Number(arg('--k', 5));
const OUT = arg('--out');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

const CODE = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|vendor|lab|runs|logs|tmp)\//;
const isSource = (p) => CODE.test(p) && !SKIP.test(p) && !/lock\.(json|ya?ml)$|-lock\.json$/.test(p);
const NOISE = /^(log|handoff|merge|wip|lab)\b|^merge /i;

/* ── the snapshot ─────────────────────────────────────────────────────────── */
const chain = git('rev-list', '--first-parent', 'HEAD').split('\n');
if (chain.length <= BACK) throw new Error(`only ${chain.length} first-parent commits`);
const S = chain[BACK];
const after = chain.slice(0, BACK).reverse(); // oldest first
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-the-fix-'));
/* cwd rather than -C: a Git Bash tar on PATH reads a drive letter as a remote host. */
execFileSync('tar', ['-x'], { cwd: dir, input: execFileSync('git', ['-C', REPO, 'archive', '--format=tar', S], { maxBuffer: 1 << 30 }) });
const atS = new Set(git('ls-tree', '-r', '--name-only', S).split('\n').filter(isSource));

/* ── the questions ────────────────────────────────────────────────────────── */
const queries = [];
for (const c of after) {
  const subject = git('log', '-1', '--format=%s', c);
  if (NOISE.test(subject)) continue;
  const changed = git('diff-tree', '--no-commit-id', '--name-status', '-r', c)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([st, p]) => st === 'M' && atS.has(p))
    .map(([, p]) => p);
  if (changed.length < 1 || changed.length > 8) continue;
  queries.push({ commit: c.slice(0, 8), subject, truth: changed });
}

/* ── the index over S ─────────────────────────────────────────────────────── */
const tScan = Date.now();
const graph = await scanRepo(dir, { cluster: true });
const scanMs = Date.now() - tScan;
const digest = buildDigest(graph);

const files = [...atS];
const text = new Map();
for (const f of files) {
  try {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!t.includes('\0')) text.set(f, t.toLowerCase());
  } catch {}
}
const words = (q) => [...new Set(q.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])];
const df = new Map();
const docFreq = (w) => {
  if (!df.has(w)) {
    let n = 0;
    for (const t of text.values()) if (t.includes(w)) n++;
    df.set(w, n);
  }
  return df.get(w);
};
const count = (t, w) => {
  let n = 0;
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) n++;
  return n;
};
function grepScores(q) {
  const ws = words(q).filter((w) => docFreq(w) > 0);
  const N = text.size;
  const s = new Map();
  for (const [f, t] of text) {
    let v = 0;
    for (const w of ws) {
      const c = count(t, w);
      if (c) v += Math.log(1 + c) * Math.log(1 + N / docFreq(w));
    }
    if (v > 0) s.set(f, v);
  }
  return s;
}
function pathScores(q) {
  /* Sequence's own path rule (scorePath), applied to every file rather than only digest files. */
  const toks = words(q);
  const s = new Map();
  for (const f of text.keys()) {
    const hay = f.toLowerCase();
    const base = hay.split('/').pop();
    let v = 0;
    for (const t of toks) {
      if (hay.includes(t)) v += 2;
      if (base.includes(t)) v += 3;
      if (base === t || base.startsWith(`${t}.`) || base.endsWith(`.${t}`)) v += 4;
    }
    if (v > 0) s.set(f, v);
  }
  return s;
}
const norm = (m) => {
  const max = Math.max(0, ...m.values());
  return new Map([...m].map(([k, v]) => [k, max ? v / max : 0]));
};
const nbr = new Map();
for (const e of graph.edges) {
  const a = e.srcId?.startsWith('file:') ? e.srcId.slice(5) : null;
  const b = e.dstId?.startsWith('file:') ? e.dstId.slice(5) : null;
  if (!a || !b || a === b) continue;
  if (!nbr.has(a)) nbr.set(a, new Set());
  if (!nbr.has(b)) nbr.set(b, new Set());
  nbr.get(a).add(b);
  nbr.get(b).add(a);
}
const top = (m) => [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, K).map(([f]) => f);

const pickers = {
  A_grep: (q) => top(grepScores(q)),
  B_sequence: (q) => selectAskResearchPaths(graph, digest, q, { maxFiles: K }),
  D_lexical: (q) => {
    const g = norm(grepScores(q)), p = norm(pathScores(q));
    const s = new Map(g);
    for (const [f, v] of p) s.set(f, (s.get(f) ?? 0) + v);
    return top(s);
  },
  C_topology: (q) => {
    const g = norm(grepScores(q)), p = norm(pathScores(q));
    const d = new Map(g);
    for (const [f, v] of p) d.set(f, (d.get(f) ?? 0) + v);
    const s = new Map();
    for (const f of text.keys()) {
      let best = 0;
      for (const n of nbr.get(f) ?? []) best = Math.max(best, d.get(n) ?? 0);
      const v = (d.get(f) ?? 0) + 0.5 * best;
      if (v > 0) s.set(f, v);
    }
    return top(s);
  },
};

/* ── run ──────────────────────────────────────────────────────────────────── */
const rows = [];
for (const q of queries) {
  const row = { commit: q.commit, subject: q.subject, truth: q.truth };
  for (const [name, pick] of Object.entries(pickers)) {
    const t0 = performance.now();
    const got = pick(q.subject);
    const ms = performance.now() - t0;
    const hits = got.filter((f) => q.truth.includes(f)).length;
    const tokens = got.reduce((n, f) => n + Math.round((text.get(f)?.length ?? 0) / 4), 0);
    row[name] = { got, hit: hits > 0 ? 1 : 0, recall: hits / q.truth.length, tokens, ms };
  }
  rows.push(row);
}

const n = rows.length;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const summary = {};
for (const name of Object.keys(pickers)) {
  summary[name] = {
    hitAt5: mean(rows.map((r) => r[name].hit)),
    recallAt5: mean(rows.map((r) => r[name].recall)),
    tokens: Math.round(mean(rows.map((r) => r[name].tokens))),
    msPerQuery: +mean(rows.map((r) => r[name].ms)).toFixed(1),
  };
}
const paired = (a, b, key = 'hit') => {
  const d = rows.map((r) => r[a][key] - r[b][key]);
  return { delta: +mean(d).toFixed(3), se: +se(d).toFixed(3) };
};
const report = {
  repo: path.basename(REPO),
  snapshot: S.slice(0, 8),
  commitsAfter: BACK,
  queries: n,
  files: text.size,
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, filesWithNeighbours: nbr.size },
  scanMs,
  summary,
  paired: {
    C_vs_A_hit: paired('C_topology', 'A_grep'),
    C_vs_D_hit: paired('C_topology', 'D_lexical'),
    D_vs_A_hit: paired('D_lexical', 'A_grep'),
    B_vs_A_hit: paired('B_sequence', 'A_grep'),
    C_vs_A_recall: paired('C_topology', 'A_grep', 'recall'),
  },
};
console.log(JSON.stringify(report, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...report, rows }, null, 2));
fs.rmSync(dir, { recursive: true, force: true });
