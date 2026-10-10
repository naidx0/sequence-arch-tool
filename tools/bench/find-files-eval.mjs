#!/usr/bin/env node
/* find_files vs grep-first on a sealed question set, plus per-repo retraining on a time split.
 *
 *   node tools/bench/find-files-eval.mjs --repo DIR --questions q.json --out rows.json [--split 0.6]
 *        [--rounds N --leaves N --lr X --min-data N]            (trainer knobs, dev tuning only)
 *
 * Index and history are those of S (a detached worktree at the question set's S), so no
 * question's own commit is visible to any arm. Arms:
 *   FF0     find_files with the frozen ranker (the shipped model), the whole tool call, token budget included.
 *   FF1g    FF0 + this repo's residual trees trained on the first --split of the questions (the product rule:
 *           newest 20% of that part held out, deployed only if no worse on hit@5 and hit@1 and better on one;
 *           fewer than 30 labelled queries: no training).
 *   FF1u    same trees, no guard (what retraining does when it always ships).
 *   G_seq   the agent's typical grep/glob sequence: Glob **\/*w* for the 2 rarest query words, Grep (files_with_matches)
 *           for the 3 rarest, files ranked by how many of those lists hold them, top 5 read (first 200 lines).
 *   G_tfidf the frozen study's grep arm (TF-IDF of every query word over every file's text): an upper bound for grep.
 * Tokens are ceil(chars / 4). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../packages/analyzer/dist');
const A = await import(`${DIST}/index.js`);
const { buildAskFileIndexAsync } = await import(`${DIST}/explain/askFileIndex.js`);
const { askGrepAll, rankAskFileLtrScored, askLtrModel, topByScore } = await import(`${DIST}/explain/askLtr.js`);
const { trainResidualTrees, withResidualTrees, hitAtK } = await import(`${DIST}/explain/ltrTrain.js`);
const { ASK_STOPWORDS } = await import(`${DIST}/explain/askTokens.js`);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const REPO = path.resolve(arg('--repo')); const QF = arg('--questions'); const OUT = arg('--out'); const SPLIT = Number(arg('--split', 0.6)); const K = 5;
const knobs = { rounds: Number(arg('--rounds', 40)), leaves: Number(arg('--leaves', 4)), learningRate: Number(arg('--lr', 0.1)), minDataInLeaf: Number(arg('--min-data', 20)) };
const MIN_LABELS = Number(arg('--min-labels', 30));
const { S, queries } = JSON.parse(fs.readFileSync(QF, 'utf8'));
const name = path.basename(REPO);
const WT = `/home/claude/ff-wt/${name}-${S.slice(0, 8)}`;
fs.mkdirSync('/home/claude/ff-wt', { recursive: true });
if (!fs.existsSync(WT)) execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', WT, S], { stdio: 'ignore' });
const tok = (s) => Math.ceil(s.length / 4);
const git = (...a) => { try { return execFileSync('git', ['-C', WT, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

/* ---- index (built by the product's own entry so the tool call is measured as shipped) ---- */
let t0 = Date.now();
A.warmFindFiles(WT);
const first = await A.findFiles(WT, 'warm up', { noLog: true, waitMs: 900000, frozenOnly: true });
const index = A.peekFindFilesIndex(WT);
if (index?.ltrPending) await index.ltrPending;
const buildMs = Date.now() - t0;
if (!index?.ltr) throw new Error('no LTR stage');

/* ---- grep-first simulation ---- */
const allFiles = git('ls-files').split('\n').filter(Boolean);
const baseNames = allFiles.map((f) => f.slice(f.lastIndexOf('/') + 1).toLowerCase());
const wordsOf = (q) => [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((w) => !ASK_STOPWORDS.has(w)))];
const grepCache = new Map();
const grepFiles = (w) => { if (!grepCache.has(w)) grepCache.set(w, git('grep', '-il', '-F', '-e', w).split('\n').filter(Boolean)); return grepCache.get(w); };
const readTokens = (f) => { try { const t = fs.readFileSync(path.join(WT, f), 'utf8'); return tok(t.split('\n').slice(0, 200).join('\n')); } catch { return 0; } };
function gSeq(q) {
  const t = performance.now();
  const ws = wordsOf(q).map((w) => [w, grepFiles(w)]).filter(([, l]) => l.length > 0 && l.length < 0.6 * allFiles.length).sort((a, b) => a[1].length - b[1].length);
  const greps = ws.slice(0, 3);
  const globs = ws.slice(0, 2).map(([w]) => [w, allFiles.filter((f, i) => baseNames[i].includes(w))]);
  const score = new Map();
  let searchTok = 0;
  for (const [, l] of greps) { searchTok += 20 + tok(l.slice(0, 100).join('\n')); for (const f of l) score.set(f, (score.get(f) ?? 0) + 1); }
  for (const [, l] of globs) { searchTok += 20 + tok(l.slice(0, 100).join('\n')); for (const f of new Set(l)) score.set(f, (score.get(f) ?? 0) + 1); }
  const got = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, K).map(([f]) => f);
  return { got, searchTok, readTok: got.reduce((s, f) => s + readTokens(f), 0), calls: greps.length + globs.length, ms: Math.round(performance.now() - t) };
}
const metr = (got, truth) => { const h = got.filter((f) => truth.includes(f)).length; return { hit: h ? 1 : 0, hit1: got[0] && truth.includes(got[0]) ? 1 : 0, recall: h / truth.length }; };

/* ---- retraining on the time split ---- */
const frozen = askLtrModel();
const nTrain = Math.floor(queries.length * SPLIT);
const exampleOf = (q) => { const r = rankAskFileLtrScored(index, q.subject, frozen); const rows = r.ranked.slice(0, 50).map((x) => x.row); const cands = r.ranked.slice(0, 50).map((x) => x.path); return { cands, ex: { rows, labels: cands.map((c) => (q.truth.includes(c) ? 1 : 0)) } }; };
const trainEx = queries.slice(0, nTrain).map(exampleOf).filter((e) => e.ex.labels.some((l) => l > 0)).map((e) => e.ex);
const nHeld = Math.max(6, Math.round(trainEx.length * 0.2));
const sc = (m, list, k) => list.reduce((s, e) => s + (hitAtK(m, e, k) ?? 0), 0) / Math.max(1, list.length);
let g = { trained: false, reason: `only ${trainEx.length} labelled queries (< ${MIN_LABELS})`, trees: 0 }; let modelG = frozen;
if (trainEx.length >= MIN_LABELS) {
  const tr = trainEx.slice(0, trainEx.length - nHeld), ho = trainEx.slice(trainEx.length - nHeld);
  const trees = await trainResidualTrees(frozen, tr, knobs); const m = withResidualTrees(frozen, trees);
  const b5 = sc(frozen, ho, 5), b1 = sc(frozen, ho, 1), n5 = sc(m, ho, 5), n1 = sc(m, ho, 1);
  const dep = trees.length > 0 && n5 >= b5 && n1 >= b1 && (n5 > b5 || n1 > b1);
  g = { trained: true, deployed: dep, trees: trees.length, held: ho.length, base: { h5: b5, h1: b1 }, next: { h5: n5, h1: n1 } };
  if (dep) modelG = m;
}
const uTrees = trainEx.length >= 1 ? await trainResidualTrees(frozen, trainEx, knobs) : []; const modelU = withResidualTrees(frozen, uTrees);

/* ---- run ---- */
const rows = [];
for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const ff = await A.findFiles(WT, q.subject, { noLog: true, frozenOnly: true, k: K });
  const ff0 = { got: ff.ranking, ...metr(ff.ranking, q.truth), tokens: ff.tokens, ms: ff.ms, readTok: ff.ranking.reduce((s, f) => s + readTokens(f), 0), ranker: ff.ranker };
  const row = { commit: q.commit, subject: q.subject, truth: q.truth, test: i >= nTrain, FF0: ff0 };
  if (i >= nTrain) {
    for (const [k, m] of [['FF1g', modelG], ['FF1u', modelU]]) { const got = rankAskFileLtrScored(index, q.subject, m).ranked.slice(0, K).map((x) => x.path); row[k] = { got, ...metr(got, q.truth) }; }
  }
  const gs = gSeq(q.subject); row.G_seq = { got: gs.got, ...metr(gs.got, q.truth), tokens: gs.searchTok, readTok: gs.readTok, calls: gs.calls, ms: gs.ms };
  const tf = performance.now(); const gt = topByScore(askGrepAll(index, q.subject), K); row.G_tfidf = { got: gt, ...metr(gt, q.truth), ms: Math.round(performance.now() - tf), readTok: gt.reduce((s, f) => s + readTokens(f), 0) };
  rows.push(row);
}
fs.writeFileSync(OUT, JSON.stringify({ repo: name, S, n: queries.length, nTrain, buildMs, files: index.files.length, knobs, guard: g, unguardedTrees: uTrees.length, rows }));
const m = (arm, f, sel = rows) => (100 * sel.reduce((s, r) => s + (r[arm]?.[f] ?? 0), 0) / sel.length).toFixed(1);
const test = rows.filter((r) => r.test);
console.log(`${name} n=${rows.length} test=${test.length} build=${buildMs}ms files=${index.files.length} | all h5: FF0 ${m('FF0', 'hit')} G_seq ${m('G_seq', 'hit')} G_tfidf ${m('G_tfidf', 'hit')} | test h5: FF0 ${m('FF0', 'hit', test)} FF1g ${m('FF1g', 'hit', test)} FF1u ${m('FF1u', 'hit', test)} | guard ${JSON.stringify(g)}`);
process.exit(0);
