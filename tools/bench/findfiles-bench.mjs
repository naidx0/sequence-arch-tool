#!/usr/bin/env node
/* bench:findfiles — A1 of docs/plans/0.1.9/BENCH-PROGRAM.md. Which files does this change touch?
 *
 *   pnpm bench:findfiles                       run every held-out repo (needs `pnpm -r build` and the clones)
 *   node tools/bench/findfiles-bench.mjs --build-questions [--seed N] [--per-repo 50]   (re)write the sealed set
 *   flags: --repos flask,gin  --limit N (first N questions per repo, smoke only)  --cache DIR  --date YYYY-MM-DD
 *
 * Question = a commit subject; answer = the files the commit modified; the tree is the commit's PARENT.
 * Filters (tools/bench/lib/findfiles-score.mjs judgeCommit): no merges; no bot/release subjects; commits touching
 * more than 20 files dropped; answer = status-M, indexable-extension, non-lockfile, non-generated files (1..8);
 * subjects that name an answer file's path or basename-with-extension literally dropped; duplicate subjects dropped;
 * at least 200 ancestors behind the parent. Sampled seeded-random from the newest 1,500 non-merge commits on the
 * FIRST-PARENT chain ending at the pinned sha (set version 2; version 1 sampled all non-merge commits and is kept as
 * questions.v1.json for history). Needs rg 14.x and git on PATH; a failed tool run throws.
 *
 * Arms (all see the same worktree at the parent; none sees the commit itself):
 *   S   the shipped find_files exactly as the product calls it: findFiles(root, subject, {k: 5, frozenOnly, noLog}).
 *       frozenOnly = a fresh install (the frozen LightGBM ranker, no per-repo residual trees: nothing has been learned
 *       from edits yet). The 0.1.8.1 test-file down-weighting (demoteTestFiles) is inside findFiles.
 *   G   Claude-Code-style sequence: Glob (rg --files, basename contains word) for the 2 rarest query words, Grep -l
 *       (rg -l -i -F) for the 3 rarest, files ranked by how many of those 5 result lists hold them, top 5 read.
 *       "Rarest" is the TRUE document frequency from probing every word (an oracle: a real agent guesses), which
 *       favours G. Words matching >= 60 % of files are skipped. Same logic as find-files-eval.mjs gSeq, on rg.
 *   R   `rg -c` TF-IDF over every query word: the upper bound a grep pipeline could reach if it read counts.
 *   GG  `git grep -c -i -F` per word; files ranked by (distinct query words matched, total match count).
 * Tokens are chars/4 (ceil), an ESTIMATE, not a tokenizer count. */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureClone, heldoutCache, lfSha256, loadRepos, verifySealed } from './data/findfiles-heldout/download.mjs';
import { assertSpawnOk, bootstrapCI, checkpointValid, clusteredSE, hashSeed, hitAtK, posixRgPath, isAnswerFile, judgeCommit, mean, outName, pairedDiff, recallAtK, rng, sample, sealGuard, sigMark, tokensOfChars, wilsonOf } from './lib/findfiles-score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(HERE, 'data', 'findfiles-heldout');
const QFILE = path.join(DATA, 'questions.json');
const argv = process.argv;
const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const K = 5;
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'pipe'] });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sealedSha = (s) => lfSha256(Buffer.from(s)); // LF-normalised: a Windows autocrlf checkout must still verify

/* ───────────────────────── sealed question set ───────────────────────── */
async function buildQuestions() {
  const seed = Number(arg('--seed', 20261014));
  const perRepo = Number(arg('--per-repo', 50));
  const cache = heldoutCache(argv);
  sealGuard(fs.existsSync(QFILE), argv.includes('--force')); // F13
  /* NOTE: the word filter (minimum 3 non-stopword words) uses the BUILT analyzer's ASK_STOPWORDS, so rebuilding the set
   * on a different analyzer build can change which commits are eligible. The sealed file, not the code, is the record. */
  const { ASK_STOPWORDS } = await import(pathToFileURL(path.join(ROOT, 'packages/analyzer/dist/explain/askTokens.js')).href);
  const wordsOf = (q) => [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((w) => !ASK_STOPWORDS.has(w)))];
  console.log(`seed=${seed} per-repo=${perRepo}`);
  const out = { about: 'Sealed find_files held-out question set (bench:findfiles), version 2: sampled along the first-parent chain. Commit shas, subjects and answer paths only; no repo content.', version: 2, seed, perRepo, k: K, repos: [] };
  for (const repo of loadRepos()) {
    const dir = ensureClone(repo, cache);
    const log = gitIn(dir, 'log', '--first-parent', '--no-merges', '-n', '1500', '--name-status', '--format=%x01%H%x02%P%x02%s', repo.sha);
    const reasons = {};
    const pool = [];
    const seenSubj = new Set();
    for (const chunk of log.split('\x01').slice(1)) {
      const [head, ...rest] = chunk.split('\n');
      const [commit, parents, subject] = head.split('\x02');
      const changed = rest.filter(Boolean).map((l) => { const [st, ...p] = l.split('\t'); return { status: st[0], path: p[p.length - 1] }; });
      const v = judgeCommit({ subject, parents: parents.trim().split(' ').filter(Boolean).length, changed, existsAtParent: () => true }, { wordsOf });
      if (!v.ok) { reasons[v.reason] = (reasons[v.reason] ?? 0) + 1; continue; }
      const key = subject.trim().toLowerCase();
      if (seenSubj.has(key)) { reasons['duplicate-subject'] = (reasons['duplicate-subject'] ?? 0) + 1; continue; }
      seenSubj.add(key);
      const parent = parents.trim().split(' ')[0];
      if (!parent) continue;
      pool.push({ commit, parent, subject: subject.trim(), answer: v.answer });
    }
    const rand = rng(seed ^ hashSeed(repo.id));
    const picked = [];
    for (const c of sample(pool, pool.length, rand)) {
      if (picked.length >= perRepo) break;
      if (Number(gitIn(dir, 'rev-list', '--count', c.parent).trim()) < 200) { reasons['<200-ancestors'] = (reasons['<200-ancestors'] ?? 0) + 1; continue; }
      picked.push(c);
    }
    if (picked.length < perRepo) throw new Error(`${repo.id}: only ${picked.length} eligible commits (< ${perRepo})`);
    console.log(`${repo.id}: pool=${pool.length} picked=${picked.length} dropped=${JSON.stringify(reasons)}`);
    out.repos.push({ id: repo.id, sha: repo.sha, lang: repo.lang, poolSize: pool.length, dropped: reasons, questions: picked });
  }
  const body = JSON.stringify(out, null, 1) + '\n';
  fs.writeFileSync(QFILE, body);
  fs.writeFileSync(path.join(DATA, 'questions.sha256'), `${sha256(body)}  questions.json\n`);
  console.log(`wrote ${path.relative(ROOT, QFILE)} sha256=${sha256(body)}`);
}

/* ───────────────────────── the arms ───────────────────────── */
/* --hidden -g '!.git': search the same files git tracks (.github/, .travis.yml, ...), as git grep does; without --hidden
 * the rg arms could never return a hidden-path answer (F5). */
const rgRun = (cwd, args) => {
  const t = performance.now();
  /* an explicit path: with no path and a piped stdin, rg searches stdin instead of the tree */
  const full = ['--hidden', '-g', '!.git', ...args];
  const r = spawnSync('rg', args.includes('--files') ? full : [...full, '--', '.'], { cwd, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'pipe'] });
  assertSpawnOk(r, `rg ${args.slice(0, 4).join(' ')}`); // F7: a failed rg is an error, not "no matches"
  return { out: (r.stdout ?? '').split('\n').map(posixRgPath).join('\n'), ms: performance.now() - t, status: r.status };
};
const gitGrepRun = (cwd, args) => {
  const t = performance.now();
  const r = spawnSync('git', ['-C', cwd, 'grep', ...args], { encoding: 'utf8', maxBuffer: 1 << 29 });
  assertSpawnOk(r, `git grep ${args.slice(0, 4).join(' ')}`);
  return { out: r.stdout ?? '', ms: performance.now() - t, status: r.status };
};
const parseCounts = (out) => new Map(out.split('\n').filter(Boolean).map((l) => { const i = l.lastIndexOf(':'); return [l.slice(0, i), Number(l.slice(i + 1))]; }));
const tok = (s) => tokensOfChars(s.length);
const readTop = (wt, files) => files.reduce((s, f) => { try { return s + tok(fs.readFileSync(path.join(wt, f), 'utf8').split('\n').slice(0, 200).join('\n')); } catch { return s; } }, 0);
const topK = (scores) => [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, K).map(([f]) => f);

function grepArms(wt, q, wordsOf) {
  const words = wordsOf(q);
  const allFiles = rgRun(wt, ['--files']).out.split('\n').filter(Boolean);
  const counts = new Map(); // word -> { map, ms }
  for (const w of words) { const r = rgRun(wt, ['-c', '-i', '-F', '-e', w]); counts.set(w, { map: parseCounts(r.out), ms: r.ms }); }
  const ggCounts = new Map();
  let ggMs = 0;
  for (const w of words) { const r = gitGrepRun(wt, ['-c', '-i', '-F', '-e', w]); ggMs += r.ms; ggCounts.set(w, parseCounts(r.out)); }
  /* `keep` narrows every result list to indexable source files: the sensitivity variant (the sealed answers are source files only). */
  const build = (keep) => {
  const files = allFiles.filter(keep);
  const N = files.length;
  const base = files.map((f) => f.slice(f.lastIndexOf('/') + 1).toLowerCase());
  const cm = (w) => new Map([...counts.get(w).map].filter(([f]) => keep(f)));
  /* G */
  const probe = words.map((w) => [w, [...cm(w).keys()]]).filter(([, l]) => l.length > 0 && l.length < 0.6 * N).sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1));
  const greps = probe.slice(0, 3), globs = probe.slice(0, 2).map(([w]) => [w, files.filter((f, i) => base[i].includes(w))]);
  const gScore = new Map();
  let gSearchTok = 0;
  for (const [, l] of greps) { gSearchTok += 20 + tok(l.slice(0, 100).join('\n')); for (const f of l) gScore.set(f, (gScore.get(f) ?? 0) + 1); }
  for (const [, l] of globs) { gSearchTok += 20 + tok(l.slice(0, 100).join('\n')); for (const f of new Set(l)) gScore.set(f, (gScore.get(f) ?? 0) + 1); }
  const gGot = topK(gScore);
  const gMs = greps.reduce((s, [w]) => s + counts.get(w).ms, 0);
  /* R: rg -c TF-IDF over all words */
  const rScore = new Map();
  for (const w of words) { const m = cm(w); const df = m.size; if (!df) continue; const idf = Math.log(1 + N / df); for (const [f, c] of m) rScore.set(f, (rScore.get(f) ?? 0) + Math.log(1 + c) * idf); }
  const rGot = topK(rScore);
  const rMs = words.reduce((s, w) => s + counts.get(w).ms, 0);
  /* GG: git grep -c per word; (distinct words, total matches) */
  const ggDistinct = new Map(), ggTotal = new Map();
  for (const w of words) for (const [f, c] of ggCounts.get(w)) { if (!keep(f)) continue; ggDistinct.set(f, (ggDistinct.get(f) ?? 0) + 1); ggTotal.set(f, (ggTotal.get(f) ?? 0) + c); }
  const ggGot = [...ggTotal].sort((a, b) => (ggDistinct.get(b[0]) - ggDistinct.get(a[0])) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, K).map(([f]) => f);
  const listTok = (g) => tok(g.join('\n'));
  return {
    G: { got: gGot, ms: Math.round(gMs), calls: greps.length + globs.length, outTok: gSearchTok },
    R: { got: rGot, ms: Math.round(rMs), calls: words.length, outTok: listTok(rGot) },
    GG: { got: ggGot, ms: Math.round(ggMs), calls: words.length, outTok: listTok(ggGot) },
  };
  };
  const all = build(() => true), src = build((f) => isAnswerFile(f));
  return { ...all, G_src: src.G, R_src: src.R, GG_src: src.GG };
}


/* ───────────────────────── the run ───────────────────────── */
/** Hash of the analyzer files whose behaviour S depends on: a checkpoint written by another build is discarded (F8). */
function buildHash(dist) {
  const h = crypto.createHash('sha256');
  for (const f of ['explain/findFiles.js', 'explain/askLtr.js', 'explain/askLtrModel.generated.js', 'explain/askFileIndex.js', 'explain/askTokens.js', 'testFiles.js']) {
    try { h.update(fs.readFileSync(path.join(dist, f))); } catch { h.update(`missing:${f}`); }
  }
  return h.digest('hex').slice(0, 16);
}
const tool = (n) => { try { execFileSync(n, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
/** --dry: resolve what the run needs and print the plan; clones, indexes and scores nothing. Exits 1 if a prerequisite is missing. */
function dry(Q) {
  const cache = heldoutCache(argv);
  const dist = path.join(ROOT, 'packages/analyzer/dist');
  const need = [['analyzer build (packages/analyzer/dist)', fs.existsSync(path.join(dist, 'index.js'))], ['git on PATH', tool('git')], ['rg on PATH', tool('rg')]];
  const only = arg('--repos') ? new Set(arg('--repos').split(',')) : null;
  console.log(`bench:findfiles --dry: question set v${Q.version ?? 1} sha256 ${sealedSha(fs.readFileSync(QFILE, 'utf8'))} (matches questions.sha256), seed ${Q.seed}, k=${K}`);
  for (const v of verifySealed()) console.log(`  sealed ${v.file}: ${v.ok ? 'ok' : 'MISMATCH'}`);
  console.log(`  cache: ${cache}`);
  for (const r of Q.repos) {
    if (only && !only.has(r.id)) continue;
    const spec = loadRepos().find((x) => x.id === r.id);
    console.log(`  ${r.id}: ${r.questions.length} questions at ${spec.sha.slice(0, 10)}, clone ${fs.existsSync(path.join(cache, r.id, '.git')) ? 'present' : 'will be cloned (full history)'}`);
  }
  for (const [n, ok] of need) console.log(`  ${ok ? 'ok     ' : 'MISSING'} ${n}`);
  if (need.some(([, ok]) => !ok) || verifySealed().some((v) => !v.ok)) { console.error('dry run: prerequisites not met'); process.exit(1); }
  console.log('dry run ok; nothing was cloned, indexed or scored');
}
async function run() {
  if (!fs.existsSync(QFILE)) throw new Error('no sealed question set; run --build-questions first');
  const body = fs.readFileSync(QFILE, 'utf8');
  const want = fs.readFileSync(path.join(DATA, 'questions.sha256'), 'utf8').split(/\s+/)[0];
  if (sealedSha(body) !== want) throw new Error(`questions.json does not match questions.sha256 (${sealedSha(body)} vs ${want}); the set is sealed`);
  const Q = JSON.parse(body);
  if (argv.includes('--dry')) return dry(Q);
  const dist = path.join(ROOT, 'packages/analyzer/dist');
  const A = await import(pathToFileURL(`${dist}/index.js`).href);
  const { ASK_STOPWORDS } = await import(pathToFileURL(`${dist}/explain/askTokens.js`).href);
  const wordsOf = (q) => [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((w) => !ASK_STOPWORDS.has(w)))];
  const cache = heldoutCache(argv);
  const only = arg('--repos') ? new Set(arg('--repos').split(',')) : null;
  const limit = Number(arg('--limit', 0));
  const partial = Boolean(limit) || Boolean(only);
  const stamp = { questions: sealedSha(body), build: buildHash(dist) };
  const runRoot = path.join(cache, '_ff-runs');
  fs.mkdirSync(runRoot, { recursive: true });
  const repos = [];
  let loadMax = os.loadavg()[0];
  for (const r of Q.repos) {
    if (only && !only.has(r.id)) continue;
    const spec = loadRepos().find((x) => x.id === r.id);
    const clone = ensureClone(spec, cache);
    const wt = path.join(runRoot, r.id);
    if (!fs.existsSync(wt)) { gitIn(clone, 'worktree', 'prune'); gitIn(clone, 'worktree', 'add', '-f', '--detach', wt, r.questions[0].parent); }
    const ckpt = path.join(runRoot, `${r.id}.rows.json`);
    let rows = [];
    if (fs.existsSync(ckpt) && !limit) {
      try { const c = JSON.parse(fs.readFileSync(ckpt, 'utf8')); if (checkpointValid(c, stamp)) rows = c.rows; else console.log(`${r.id}: checkpoint is from another question set or analyzer build; discarded`); } catch { /* unreadable: start over */ }
    }
    const loadStart = os.loadavg()[0];
    const qs = limit ? r.questions.slice(0, limit) : r.questions;
    for (const q of qs) {
      if (rows.some((x) => x.commit === q.commit)) continue;
      gitIn(wt, 'checkout', '-q', '--detach', '-f', q.parent);
      gitIn(wt, 'clean', '-fdxq');
      /* S: build the product's index at the parent exactly as the eval does, then call findFiles as shipped. */
      A.dropFindFiles(wt);
      const b0 = Date.now();
      A.warmFindFiles(wt);
      await A.findFiles(wt, 'warm up', { noLog: true, waitMs: 900000, frozenOnly: true });
      const index = A.peekFindFilesIndex(wt);
      if (index?.ltrPending) await index.ltrPending;
      const buildMs = Date.now() - b0;
      const ltr = Boolean(index?.ltr);
      const t0 = performance.now();
      const ff = await A.findFiles(wt, q.subject, { noLog: true, frozenOnly: true, k: K });
      const sMs = Math.round(performance.now() - t0);
      const arms = { S: { got: ff.ranking, ms: sMs, calls: 1, outTok: ff.tokens, ranker: ff.ranker }, ...grepArms(wt, q.subject, wordsOf) };
      for (const a of Object.values(arms)) {
        a.hit1 = hitAtK(a.got, q.answer, 1); a.hit5 = hitAtK(a.got, q.answer, K); a.recall5 = recallAtK(a.got, q.answer, K);
        a.readTok = readTop(wt, a.got); a.totalTok = a.outTok + a.readTok;
      }
      loadMax = Math.max(loadMax, os.loadavg()[0]);
      rows.push({ commit: q.commit, subject: q.subject, answer: q.answer, buildMs, ltr, arms });
      if (!limit) fs.writeFileSync(ckpt, JSON.stringify({ stamp, rows }));
      process.stdout.write(`${r.id} ${rows.length}/${qs.length} S=${arms.S.hit5} G=${arms.G.hit5} R=${arms.R.hit5} GG=${arms.GG.hit5} ranker=${ff.ranker} build=${buildMs}ms\r`);
    }
    A.dropFindFiles(wt);
    process.stdout.write('\n');
    repos.push({ id: r.id, sha: r.sha, lang: r.lang, n: rows.length, loadStart, loadEnd: os.loadavg()[0], rows });
  }
  report(Q, repos, { partial, stamp, loadMax });
}

const ARMS = ['S', 'G', 'R', 'GG'];
const SRC_ARMS = ['G_src', 'R_src', 'GG_src'];
const GREP_ARMS = [...ARMS.slice(1), ...SRC_ARMS];
const METRICS = [['hit1', 'hit@1'], ['hit5', 'hit@5'], ['recall5', 'recall@5']];
/* hit@k are proportions -> Wilson intervals (F10); recall@5 is a mean of fractions -> bootstrap. */
function summarise(rows, seed) {
  const o = {};
  for (const a of [...ARMS, ...SRC_ARMS]) {
    o[a] = {};
    for (const [m] of METRICS) {
      const xs = rows.map((r) => r.arms[a][m]);
      o[a][m] = m === 'recall5' ? bootstrapCI(xs, { seed }) : wilsonOf(xs);
    }
    for (const f of ['outTok', 'readTok', 'totalTok', 'ms', 'calls']) o[a][f] = mean(rows.map((r) => r.arms[a][f]));
  }
  o.paired = {};
  const ids = rows.map((r) => r.repo);
  const clustered = new Set(ids).size >= 2;
  for (const other of GREP_ARMS) {
    o.paired[`S-${other}`] = {};
    for (const [m] of METRICS) {
      const a = rows.map((r) => r.arms.S[m]), b = rows.map((r) => r.arms[other][m]);
      const p = pairedDiff(a, b, { seed });
      p.clusteredSE = clustered ? clusteredSE(a.map((x, i) => x - b[i]), ids) : NaN;
      o.paired[`S-${other}`][m] = p;
    }
  }
  return o;
}
function report(Q, repos, { partial, stamp, loadMax }) {
  const seed = Q.seed;
  const all = repos.flatMap((r) => r.rows.map((x) => ({ ...x, repo: r.id })));
  const per = Object.fromEntries(repos.map((r) => [r.id, summarise(r.rows.map((x) => ({ ...x, repo: r.id })), seed)]));
  const pooled = summarise(all, seed);
  const res = {
    bench: 'findfiles', date: DATE, partial, seed, setVersion: Q.version ?? 1, questionsSha256: stamp.questions, analyzerBuild: stamp.build, k: K,
    tokenNote: 'tokens are chars/4 (ceil), an estimate, not a tokenizer count',
    machine: { node: process.version, cpus: os.cpus().length, loadavgStart: repos[0]?.loadStart, loadavgMax: loadMax, loadavgEnd: os.loadavg()[0], note: 'ms/query are load-dependent and not a benchmark result unless the load average stayed below 2 (BENCH-PROGRAM rule 5)' },
    repos: repos.map((r) => ({ id: r.id, sha: r.sha, lang: r.lang, n: r.n, loadStart: r.loadStart, loadEnd: r.loadEnd, medianIndexBuildMs: [...r.rows.map((x) => x.buildMs)].sort((a, b) => a - b)[Math.floor(r.rows.length / 2)], rankerCounts: r.rows.reduce((c, x) => { c[x.arms.S.ranker] = (c[x.arms.S.ranker] ?? 0) + 1; return c; }, {}) })),
    perRepo: per, pooled, rows: all,
  };
  const out = path.join(ROOT, 'report/raw', outName('bench-findfiles', DATE, 'json', partial));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(res));
  const md = markdown(res);
  const mdOut = path.join(ROOT, 'tools/bench/out', outName('findfiles', DATE, 'md', partial));
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(mdOut, md);
  console.log(md);
  console.log(`\nwrote ${path.relative(ROOT, out)} and ${path.relative(ROOT, mdOut)}`);
}
const pc = (c) => `${(100 * c.mean).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`;
const pp = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : 'n/a');
const diffRow = (label, d) => `| ${label} | ${pp(d.mean)} | ${pp(d.se)} | ${pp(d.clusteredSE)} | ${d.z.toFixed(1)} | ${sigMark(d.mean, Number.isFinite(d.clusteredSE) ? d.clusteredSE : d.se) || 'yes'} |`;
export function markdown(res) {
  const L = [];
  const lm = res.machine;
  const lowLoad = lm.loadavgMax < 2;
  const best = SRC_ARMS.reduce((b, a) => (res.pooled[a].hit5.mean > res.pooled[b].hit5.mean ? a : b), SRC_ARMS[0]);
  L.push(`# bench:findfiles ${res.date}${res.partial ? ' (PARTIAL subset run, not the full result)' : ''}`, '',
    `Question set v${res.setVersion}, sha256 \`${res.questionsSha256.slice(0, 16)}\`, seed ${res.seed}, k=${res.k}, analyzer build \`${res.analyzerBuild}\`. hit@k: Wilson 95 % intervals; recall@5: 95 % bootstrap over questions (2000 resamples). Tokens are chars/4 estimates. Load average: start ${lm.loadavgStart?.toFixed(1)}, max ${lm.loadavgMax?.toFixed(1)}, end ${lm.loadavgEnd.toFixed(1)} on ${lm.cpus} cpus.`, '');
  L.push('## Headline: S against the strongest FAIR baseline', '',
    `The strongest fair baseline is the best source-restricted grep arm, **${best}** (pooled hit@5 ${pc(res.pooled[best].hit5)}), not the Claude-Code-style G arm (hit@5 ${pc(res.pooled.G.hit5)}), which also returns docs and changelogs the source-only answers can never contain.`, '',
    '| comparison (S minus arm, pp) | paired SE | repo-clustered SE (CR1, ' + res.repos.length + ' clusters) | z (clustered) | significant (>= 2 SE) |', '|---|---|---|---|---|');
  for (const [m, name] of METRICS) L.push(diffRow(`${name} vs ${best}: ${pp(res.pooled.S[m].mean)} vs ${pp(res.pooled[best][m].mean)}`, { ...res.pooled.paired[`S-${best}`][m], z: res.pooled.paired[`S-${best}`][m].mean / (res.pooled.paired[`S-${best}`][m].clusteredSE || res.pooled.paired[`S-${best}`][m].se) }));
  L.push('', `Per repo, S minus ${best} on hit@5 (pp, paired SE; "n.s." = under 2 SE, not significant):`, '', '| repo | S hit@5 | ' + best + ' hit@5 | diff | paired SE | |', '|---|---|---|---|---|---|');
  for (const r of res.repos) { const d = res.perRepo[r.id].paired[`S-${best}`].hit5; L.push(`| ${r.id} | ${pp(res.perRepo[r.id].S.hit5.mean)} | ${pp(res.perRepo[r.id][best].hit5.mean)} | ${pp(d.mean)} | ${pp(d.se)} | ${sigMark(d.mean, d.se) || 'significant'} |`); }
  L.push('');
  const block = (title, s, n, pooled) => {
    L.push(`### ${title} (n=${n})`, '', `| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |`, '|---|---|---|---|---|---|---|---|');
    for (const a of [...ARMS, ...SRC_ARMS]) L.push(`| ${a} | ${pc(s[a].hit1)} | ${pc(s[a].hit5)} | ${pc(s[a].recall5)} | ${s[a].outTok.toFixed(0)} | ${s[a].totalTok.toFixed(0)} | ${s[a].ms.toFixed(0)} | ${s[a].calls.toFixed(1)} |`);
    L.push('', `Paired S minus arm, percentage points. ${pooled ? 'Clustered SE = repo-clustered (CR1); z uses it. ' : 'Per-repo: z uses the paired SE; '}"n.s." = under 2 SE.`, '', '| comparison | diff pp | paired SE | clustered SE | z | significant |', '|---|---|---|---|---|---|');
    for (const o of GREP_ARMS) for (const [m, name] of METRICS) { const d = s.paired[`S-${o}`][m]; const se_ = pooled && Number.isFinite(d.clusteredSE) ? d.clusteredSE : d.se; L.push(`| ${name} S−${o} | ${pp(d.mean)} | ${pp(d.se)} | ${pp(d.clusteredSE)} | ${(d.mean / se_).toFixed(1)} | ${sigMark(d.mean, se_) || 'yes'} |`); }
    L.push('');
  };
  block('Pooled', res.pooled, res.rows.length, true);
  for (const r of res.repos) block(`${r.id} (${r.lang}, ${r.sha.slice(0, 8)})`, res.perRepo[r.id], r.n, false);
  L.push('‡ ms/query is load-dependent' + (lowLoad ? ' (this run stayed under load 2, so the figures are usable as a rough guide)' : `, NOT a benchmark result: the load average reached ${lm.loadavgMax?.toFixed(1)} (needs < 2 throughout)`) + '. S times a warm in-process call; the grep arms time their subprocess calls. The index build is not in ms/query.', '');
  L.push('S ranker kinds per repo (frozen = LTR ready, hybrid = LTR stage not ready): ' + res.repos.map((r) => `${r.id} ${JSON.stringify(r.rankerCounts)}`).join('; '));
  L.push('', 'Median index build ms at the parent (S setup, not in ms/query): ' + res.repos.map((r) => `${r.id} ${r.medianIndexBuildMs}`).join(', '));
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv.includes('--build-questions')) await buildQuestions();
  else await run();
}
