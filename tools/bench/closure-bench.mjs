#!/usr/bin/env node
/* bench:closure — A2 of docs/plans/0.1.9/BENCH-PROGRAM.md. What breaks if I change X? (importers, depth 1..4)
 *
 *   pnpm bench:closure              all held-out repos that have a parseable import graph (JS/TS, Python)
 *   flags: --repos flask,express  --targets 30  --seed N  --cache DIR  --date YYYY-MM-DD  --max-calls 1500
 *   Subset runs (--repos, or --targets other than the default) write `-partial` files and never replace the full run.
 *   Needs rg 14.x and git on PATH; a failed tool run throws.
 *
 * Per repo, at the pinned sha: scan once with the shipped scanner; build an INDEPENDENT import graph (regex resolver,
 * tools/bench/lib/importgraph.mjs, no shared code with the analyzer). Agreement between the two graphs is a per-repo
 * DIAGNOSTIC, not a publication filter: every repo is pooled, because gating on "Sequence's recall is high" selects
 * on the outcome. Targets are 30 seeded-random files that have at least one direct importer in the independent graph.
 *
 * Truth. T_ind = transitive importers within depth d from the independent resolver, the only non-circular truth.
 * T_seq = the same from Sequence's own scan graph (the grep arm's recall against it is shown for reference; the SEQ
 * arm's is 1.0 by construction and not reported).
 *
 * Arms.
 *   SEQ   ONE call: impactFromGraph(graph, 'file:<path>') from @sequence/mcp, the function behind the `impact` MCP tool
 *         (scan cached, as the product's MCP server holds it). The call has no depth parameter and returns the whole
 *         transitive closure, so for "depth <= d" the SEQ answer is TRUNCATED to depth d by breadth-first search over
 *         Sequence's own import graph, which is what a depth-limited impact would return. Recall AND precision are
 *         computed on the truncated set at every d. The as-shipped unbounded closure is reported separately.
 *   GREP  breadth-first by hand: one `rg -l` per frontier file (importers-by-depth.py method), pattern = an import line
 *         that names the file's module stem, no resolution. Calls = rg invocations; bytes = what the agent reads back
 *         (file lists) and, separately, the size of the files it found (reading them to take the next hop).
 * Tokens are bytes/4, an estimate. */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureClone, heldoutCache, loadRepos } from './data/findfiles-heldout/download.mjs';
import { assertSpawnOk, bootstrapCI, clusteredSE, hashSeed, mean, outName, posixRgPath, pairedDiff, precisionOf, recallOf, rng, sample, sigMark } from './lib/findfiles-score.mjs';
import { bfsByDepth, cumulative, importGrepPattern, isJsFile, isPyFile, jsEdges, langGlobs, moduleStem, pyEdges, reverseAdj } from './lib/importgraph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv;
const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const SEED = Number(arg('--seed', 20261014));
const DEFAULT_TARGETS = 30;
const TARGETS = Number(arg('--targets', DEFAULT_TARGETS));
const MAX_CALLS = Number(arg('--max-calls', 1500));
const DEPTHS = [1, 2, 3, 4];
const LOW_AGREEMENT = 0.75; // diagnostic flag only
const SPOT_QUOTA = [3, 3, 2, 2]; // hand-check edges drawn from the first four repos that have agreed edges (F14)
const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'pipe'] });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const nanMean = (xs) => mean(xs.filter((x) => x !== null && Number.isFinite(x)));
const prec = (got, truth) => (got.length === 0 ? null : precisionOf(got, truth)); // an empty answer has no precision

function grepBfs(wt, lang, target) {
  const globs = langGlobs(lang).flatMap((g) => ['-g', g]);
  const seen = new Set([target]);
  let frontier = [target];
  let calls = 0, outBytes = 0, fileBytes = 0, ms = 0, capped = false;
  const levels = [];
  for (const _d of DEPTHS) {
    const next = new Set();
    for (const f of frontier) {
      if (calls >= MAX_CALLS) { capped = true; break; }
      const t = performance.now();
      const r = spawnSync('rg', ['--hidden', '-g', '!.git', '-l', '-i', '-e', importGrepPattern(lang, moduleStem(f)), ...globs, '--', '.'], { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
      assertSpawnOk(r, `rg import grep for ${f}`); // F7
      ms += performance.now() - t;
      calls++;
      const out = r.stdout ?? '';
      outBytes += out.length;
      for (const line of out.split('\n')) { const p = posixRgPath(line); if (p && !seen.has(p)) { seen.add(p); next.add(p); } }
    }
    for (const p of next) { try { fileBytes += fs.statSync(path.join(wt, p)).size; } catch { /* vanished */ } }
    levels.push(next);
    frontier = [...next];
  }
  return { levels, calls, outBytes, fileBytes, ms, capped };
}

/** The import lines of `src` that name `dst`'s module stem: what a human checks to confirm an edge is real (F14). */
function importLines(wt, src, dst) {
  const stem = moduleStem(dst).toLowerCase();
  let text = '';
  try { text = fs.readFileSync(path.join(wt, src), 'utf8'); } catch { return []; }
  return text.split('\n').map((l, i) => [i + 1, l.trim()]).filter(([, l]) => /\b(import|from|require)\b/.test(l) && l.toLowerCase().includes(stem)).slice(0, 3).map(([n, l]) => `${n}: ${l.slice(0, 160)}`);
}

async function main() {
  const dist = path.join(ROOT, 'packages');
  const { scanRepo } = await import(pathToFileURL(`${dist}/analyzer/dist/scan.js`).href);
  const { impactFromGraph } = await import(pathToFileURL(`${dist}/mcp/dist/insightTools.js`).href);
  const cache = heldoutCache(argv);
  const only = arg('--repos') ? new Set(arg('--repos').split(',')) : null;
  const partial = Boolean(only) || TARGETS !== DEFAULT_TARGETS;
  let loadMax = os.loadavg()[0];
  console.log(`seed=${SEED} targets/repo=${TARGETS} load=${loadMax.toFixed(1)}`);
  const results = [];
  const spot = [];
  let quotaIdx = 0;
  for (const spec of loadRepos()) {
    if (!spec.closure || (only && !only.has(spec.id))) continue;
    const lang = spec.closure === 'python' ? 'python' : 'js';
    const clone = ensureClone(spec, cache);
    const wt = path.join(cache, '_closure', spec.id);
    if (!fs.existsSync(wt)) { gitIn(clone, 'worktree', 'prune'); fs.mkdirSync(path.dirname(wt), { recursive: true }); gitIn(clone, 'worktree', 'add', '-f', '--detach', wt, spec.sha); }
    gitIn(wt, 'checkout', '-q', '--detach', '-f', spec.sha);
    const files = gitIn(wt, 'ls-files').split('\n').filter(Boolean);
    const read = (p) => fs.readFileSync(path.join(wt, p), 'utf8');
    const isLang = lang === 'python' ? isPyFile : isJsFile;

    /* independent graph */
    const indEdges = (lang === 'python' ? pyEdges : jsEdges)({ files, read });
    const indSet = new Set(indEdges.map(([s, d]) => `${s}\0${d}`));
    /* Sequence's scan graph */
    const t0 = Date.now();
    const graph = await scanRepo(wt, { cluster: true });
    const scanMs = Date.now() - t0;
    const fileNodes = new Set(graph.nodes.filter((n) => n.kind === 'file').map((n) => n.id.slice(5)));
    const seqEdges = graph.edges.filter((e) => e.kind === 'import' && e.srcId.startsWith('file:') && e.dstId.startsWith('file:')).map((e) => [e.srcId.slice(5), e.dstId.slice(5)]);
    const seqSet = new Set(seqEdges.map(([s, d]) => `${s}\0${d}`));
    const langFiles = files.filter(isLang);
    const scannedLang = langFiles.filter((f) => fileNodes.has(f));
    /* agreement: inside the files both parsed (U) and over the whole independent universe (full); NaN when a set is empty */
    const inUni = (k) => { const [s, d] = k.split('\0'); return fileNodes.has(s) && fileNodes.has(d); };
    const indU = new Set([...indSet].filter(inUni));
    const seqL = new Set([...seqSet].filter((k) => { const [s, d] = k.split('\0'); return isLang(s) && isLang(d); }));
    const interU = [...indU].filter((k) => seqL.has(k)).length;
    const unionU = new Set([...indU, ...seqL]).size;
    const interFull = [...indSet].filter((k) => seqL.has(k)).length;
    const unionFull = new Set([...indSet, ...seqL]).size;
    const ratio = (a, b) => (b ? a / b : NaN);
    const agreement = {
      langFiles: langFiles.length, scannedLangFiles: scannedLang.length, coverage: ratio(scannedLang.length, langFiles.length),
      indEdges: indSet.size, indEdgesInScannedUniverse: indU.size, seqEdges: seqL.size, both: interU,
      edgeJaccard: ratio(interU, unionU), edgeJaccardFull: ratio(interFull, unionFull),
      seqCoversInd: ratio(interU, indU.size), seqCoversIndFull: ratio(interFull, indSet.size), indCoversSeq: ratio(interU, seqL.size),
    };

    /* F14: edges both graphs report, with the import line that justifies each (read and judged by a human) */
    if (quotaIdx < SPOT_QUOTA.length) {
      const agreed = [...indSet].filter((k) => seqL.has(k)).sort();
      if (agreed.length) {
        for (const k of sample(agreed, SPOT_QUOTA[quotaIdx], rng(SEED ^ hashSeed(`spot:${spec.id}`)))) { const [src, dst] = k.split('\0'); spot.push({ repo: spec.id, src, dst, lines: importLines(wt, src, dst) }); }
        quotaIdx++;
      }
    }

    /* targets */
    const indRev = reverseAdj(indEdges);
    const seqRev = reverseAdj(seqEdges);
    const eligible = [...indRev.keys()].sort();
    const rand = rng(SEED ^ hashSeed(spec.id));
    const targets = sample(eligible, TARGETS, rand);
    const rows = [];
    for (const tgt of targets) {
      const tInd = cumulative(bfsByDepth(indRev, tgt, 4));
      const inGraph = fileNodes.has(tgt);
      const tSeq = inGraph ? cumulative(bfsByDepth(seqRev, tgt, 4)) : DEPTHS.map(() => new Set());
      /* SEQ arm: one call, three timings -> median. Its answer for depth d is the closure truncated to depth d (tSeq). */
      let impact = null; const times = [];
      if (inGraph) for (let i = 0; i < 3; i++) { const t = performance.now(); impact = impactFromGraph(graph, `file:${tgt}`); times.push(performance.now() - t); }
      const seqRaw = impact ? impact.impactedBy.filter((x) => x.startsWith('file:')).map((x) => x.slice(5)) : [];
      const seqBytes = impact ? JSON.stringify(impact).length : 0;
      const g = grepBfs(wt, lang, tgt);
      const gCum = cumulative(g.levels);
      const per = {};
      for (const d of DEPTHS) {
        const ti = [...tInd[d - 1]], ts = [...tSeq[d - 1]];
        const sGot = ts; // truncated to depth d
        const gGot = [...gCum[d - 1]];
        per[d] = {
          truthInd: ti.length, truthSeq: ts.length,
          seq: { recallInd: recallOf(sGot, ti), precisionInd: prec(sGot, ti), returned: sGot.length },
          seqRaw: { recallInd: recallOf(seqRaw, ti), precisionInd: prec(seqRaw, ti), returned: seqRaw.length },
          grep: { recallInd: recallOf(gGot, ti), recallSeq: ts.length ? recallOf(gGot, ts) : null, precisionInd: prec(gGot, ti), returned: gGot.length },
        };
      }
      const cum4Ind = [...tInd[3]], cum4Seq = [...tSeq[3]];
      const u = new Set([...cum4Seq, ...cum4Ind]).size;
      rows.push({
        target: tgt, inScanGraph: inGraph, per,
        seq: { calls: impact ? 1 : 0, bytes: seqBytes, tokens: Math.ceil(seqBytes / 4), ms: median(times), closureSize: seqRaw.length },
        grep: { calls: g.calls, outBytes: g.outBytes, outTokens: Math.ceil(g.outBytes / 4), fileBytes: g.fileBytes, fileTokens: Math.ceil(g.fileBytes / 4), ms: g.ms, capped: g.capped },
        agreeJaccard: u ? cum4Seq.filter((x) => tInd[3].has(x)).length / u : NaN,
        seqRecallOfInd: recallOf(cum4Seq, cum4Ind),
      });
      loadMax = Math.max(loadMax, os.loadavg()[0]);
      process.stdout.write(`${spec.id} ${rows.length}/${targets.length} seq=${rows.at(-1).seq.calls}call grep=${g.calls}calls\r`);
    }
    process.stdout.write('\n');
    agreement.perTargetSeqRecallOfInd = mean(rows.map((r) => r.seqRecallOfInd));
    agreement.perTargetJaccard = nanMean(rows.map((r) => r.agreeJaccard));
    agreement.targetsNotInScanGraph = rows.filter((r) => !r.inScanGraph).length;
    agreement.lowAgreement = !(agreement.edgeJaccard >= LOW_AGREEMENT) || !(agreement.perTargetSeqRecallOfInd >= LOW_AGREEMENT);
    results.push({ id: spec.id, sha: spec.sha, lang, scanMs, agreement, eligibleTargets: eligible.length, rows, loadavg: os.loadavg()[0] });
    console.log(`${spec.id}: edgeJaccard ${agreement.edgeJaccard.toFixed(3)} seqRecallOfInd ${agreement.perTargetSeqRecallOfInd.toFixed(3)}`);
  }
  report(results, spot, { partial, loadMax });
}

function summarise(rows) {
  const o = { n: rows.length, depths: {} };
  const ids = rows.map((r) => r.repo);
  const multi = new Set(ids).size >= 2;
  for (const d of DEPTHS) {
    const g = (arm, k) => rows.map((r) => r.per[d][arm][k]);
    const nn = (xs) => xs.filter((x) => x !== null && Number.isFinite(x));
    const a = g('seq', 'recallInd'), b = g('grep', 'recallInd');
    const diff = pairedDiff(a, b, { seed: SEED });
    diff.clusteredSE = multi ? clusteredSE(a.map((x, i) => x - b[i]), ids) : NaN;
    const entry = {
      seqRecallInd: bootstrapCI(a, { seed: SEED }), grepRecallInd: bootstrapCI(b, { seed: SEED }),
      seqPrecisionInd: bootstrapCI(nn(g('seq', 'precisionInd')), { seed: SEED }), grepPrecisionInd: bootstrapCI(nn(g('grep', 'precisionInd')), { seed: SEED }),
      seqRawRecallInd: bootstrapCI(g('seqRaw', 'recallInd'), { seed: SEED }), seqRawPrecisionInd: bootstrapCI(nn(g('seqRaw', 'precisionInd')), { seed: SEED }),
      diffRecallInd: diff,
      meanTruthInd: mean(rows.map((r) => r.per[d].truthInd)),
    };
    const withSeq = rows.filter((r) => r.per[d].truthSeq > 0);
    entry.grepRecallSeq = withSeq.length ? bootstrapCI(withSeq.map((r) => r.per[d].grep.recallSeq), { seed: SEED }) : null;
    o.depths[d] = entry;
  }
  o.cost = {
    seq: { calls: mean(rows.map((r) => r.seq.calls)), tokens: mean(rows.map((r) => r.seq.tokens)), ms: nanMean(rows.map((r) => r.seq.ms)), closureSize: mean(rows.map((r) => r.seq.closureSize)) },
    grep: { calls: mean(rows.map((r) => r.grep.calls)), callsMedian: median(rows.map((r) => r.grep.calls)), outTokens: mean(rows.map((r) => r.grep.outTokens)), fileTokens: mean(rows.map((r) => r.grep.fileTokens)), ms: mean(rows.map((r) => r.grep.ms)), capped: rows.filter((r) => r.grep.capped).length },
  };
  return o;
}
const fx = (x, k = 3) => (Number.isFinite(x) ? x.toFixed(k) : 'n/a');
const pc = (c) => (c && Number.isFinite(c.mean) ? `${(100 * c.mean).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]` : 'n/a');
const pp = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : 'n/a');
function markdown(res) {
  const L = [`# bench:closure ${res.date}${res.partial ? ' (PARTIAL subset run, not the full result)' : ''}`, '',
    `Seed ${res.seed}, ${res.targetsPerRepo} targets per repo. Load average: start ${res.loadavgStart.toFixed(1)}, max ${res.loadavgMax.toFixed(1)}, end ${res.loadavgEnd.toFixed(1)} on ${res.cpus} cpus (wall times are load-dependent and not a benchmark result unless the load stayed under 2). Truth for recall is the INDEPENDENT regex resolver (T_ind). SEQ answers are truncated to depth d over Sequence's own graph; the unbounded as-shipped closure is shown separately. Every repo is pooled; agreement is a per-repo diagnostic. Tokens are bytes/4 estimates. 95 % bootstrap CIs over targets; the SE of the pooled SEQ−GREP difference is repo-clustered (CR1).`, '',
    '## Agreement and coverage: Sequence scan graph vs independent resolver (diagnostic, not a filter)', '',
    '| repo | lang | scan coverage (scanned / source files) | indep edges | seq edges | both | edge Jaccard (files both parsed) | edge Jaccard (full indep universe) | seq covers indep (both parsed / full) | per-target Seq recall of indep, depth<=4 | targets absent from scan graph | flag |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of res.repos) { const a = r.agreement; L.push(`| ${r.id} | ${r.lang} | ${fx(a.coverage)} (${a.scannedLangFiles} / ${a.langFiles}) | ${a.indEdges} (${a.indEdgesInScannedUniverse} among scanned files) | ${a.seqEdges} | ${a.both} | ${fx(a.edgeJaccard)} | ${fx(a.edgeJaccardFull)} | ${fx(a.seqCoversInd)} / ${fx(a.seqCoversIndFull)} | ${fx(a.perTargetSeqRecallOfInd)} | ${a.targetsNotInScanGraph}/${r.nTargets} | ${a.lowAgreement ? 'LOW AGREEMENT (graphs differ; still pooled)' : ''} |`); }
  const block = (title, s, pooled) => {
    L.push('', `## ${title} (n=${s.n} targets)`, '', `| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE${pooled ? ', clustered SE' : ''}) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |`, '|---|---|---|---|---|---|---|---|');
    for (const d of DEPTHS) { const e = s.depths[d]; const df = e.diffRecallInd; const se_ = pooled && Number.isFinite(df.clusteredSE) ? df.clusteredSE : df.se; L.push(`| <=${d} | ${e.meanTruthInd.toFixed(1)} | ${pc(e.seqRecallInd)} | ${pc(e.grepRecallInd)} | ${pp(df.mean)} (${pp(df.se)}${pooled ? ', ' + pp(df.clusteredSE) : ''}) ${sigMark(df.mean, se_) || ''} | ${pc(e.seqPrecisionInd)} | ${pc(e.grepPrecisionInd)} | ${pc(e.grepRecallSeq)} |`); }
    const e4 = s.depths[4];
    L.push('', `As shipped, the impact call returns the unbounded closure: recall ${pc(e4.seqRawRecallInd)} / precision ${pc(e4.seqRawPrecisionInd)} against the depth<=4 truth (mean returned ${s.cost.seq.closureSize.toFixed(1)} files).`,
      '', `Cost per target (mean): SEQ ${s.cost.seq.calls.toFixed(2)} call, ${s.cost.seq.tokens.toFixed(0)} tokens back, ${fx(s.cost.seq.ms, 2)} ms (graph already scanned; load-dependent). GREP ${s.cost.grep.calls.toFixed(1)} calls (median ${s.cost.grep.callsMedian}), ${s.cost.grep.outTokens.toFixed(0)} tokens of file lists back, plus ${s.cost.grep.fileTokens.toFixed(0)} tokens if it reads every file it found, ${s.cost.grep.ms.toFixed(0)} ms (load-dependent); ${s.cost.grep.capped} target(s) hit the ${MAX_CALLS}-call cap.`);
  };
  block('Pooled, ALL repos (headline)', res.pooled, true);
  for (const r of res.repos) { L.push('', `Scan time for ${r.id}: ${r.scanMs} ms (cold, one-off; the SEQ arm assumes the graph is held).`); block(r.id, res.perRepo[r.id], false); }
  L.push('', '## Independence spot check (F14): ten edges BOTH graphs report, with the import line in the source file', '', '| repo | importer | imported | matching import line(s) |', '|---|---|---|---|');
  for (const s of res.spot) L.push(`| ${s.repo} | ${s.src} | ${s.dst} | ${s.lines.length ? s.lines.map((x) => '`' + x.replace(/\|/g, '\\|') + '`').join('<br>') : '(no line found)'} |`);
  L.push('', '## Findings for the product (what this run exposed)', '');
  const by = Object.fromEntries(res.repos.map((r) => [r.id, r]));
  if (by.flask) L.push(`1. **Python \`from pkg import name\` and \`from . import module\` edges are missing.** flask: Sequence reports ${by.flask.agreement.seqEdges} import edges, the independent resolver ${by.flask.agreement.indEdges}; Sequence is a strict subset (nothing it reports is absent from the independent graph). Missing: edges into \`src/flask/__init__.py\` (\`from flask import x\`) and \`from . import typing as ft\`-style sibling-module imports. Per-target Seq recall of the independent depth<=4 closure is ${fx(by.flask.agreement.perTargetSeqRecallOfInd, 2)}.`);
  if (by.sqlfluff) L.push(`2. **The scanner is service-shaped and skips library packages.** sqlfluff: ${by.sqlfluff.agreement.scannedLangFiles} of ${by.sqlfluff.agreement.langFiles} Python source files scanned (only docs scripts; \`src/sqlfluff\` is never scanned), so every one of ${by.sqlfluff.rows.length} targets is absent from the graph and the impact call has nothing to answer from.`);
  if (by.vite) L.push(`3. **vite (TypeScript monorepo): ${fx(by.vite.agreement.perTargetSeqRecallOfInd, 2)} per-target recall of the independent closure** (edge Jaccard ${fx(by.vite.agreement.edgeJaccard)} over scanned files, scan coverage ${fx(by.vite.agreement.coverage)}). The missing edges are not diagnosed here; see the vite table.`);
  return L.join('\n') + '\n';
}
function report(results, spot, { partial, loadMax }) {
  const all = results.flatMap((r) => r.rows.map((x) => ({ repo: r.id, ...x })));
  const res = {
    bench: 'closure', date: DATE, partial, seed: SEED, targetsPerRepo: TARGETS, lowAgreementThreshold: LOW_AGREEMENT, cpus: os.cpus().length,
    loadavgStart: results[0]?.loadavg ?? os.loadavg()[0], loadavgMax: loadMax, loadavgEnd: os.loadavg()[0],
    tokenNote: 'tokens are bytes/4, an estimate',
    repos: results.map(({ rows, ...r }) => ({ ...r, nTargets: rows.length })),
    perRepo: Object.fromEntries(results.map((r) => [r.id, summarise(r.rows.map((x) => ({ repo: r.id, ...x })))])),
    pooled: summarise(all), spot, rows: all,
  };
  const out = path.join(ROOT, 'report/raw', outName('bench-closure', DATE, 'json', partial));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(res));
  const md = markdown({ ...res, repos: results.map((r) => ({ ...r, nTargets: r.rows.length })) });
  const mdOut = path.join(ROOT, 'tools/bench/out', outName('closure', DATE, 'md', partial));
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(mdOut, md);
  console.log(md);
  console.log(`\nwrote ${path.relative(ROOT, out)} and ${path.relative(ROOT, mdOut)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
