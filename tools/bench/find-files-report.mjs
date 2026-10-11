#!/usr/bin/env node
/* Pool find-files-eval rows files into the README tables. node find-files-report.mjs rows-*.json */
import fs from 'node:fs';
const files = process.argv.slice(2);
const per = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const all = per.flatMap((j) => j.rows.map((r) => ({ ...r, repo: j.repo })));
const pct = (x) => (100 * x).toFixed(1);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length); };
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const d = (rows, a, b, f) => { const x = rows.map((r) => r[a][f] - r[b][f]); return `${(100 * mean(x)).toFixed(1)} (${(100 * sd(x)).toFixed(1)})`; };
const line = (name, rows) => `| ${name} | ${rows.length} | ${pct(mean(rows.map((r) => r.G_seq.hit)))}/${pct(mean(rows.map((r) => r.G_seq.hit1)))} | ${pct(mean(rows.map((r) => r.G_tfidf.hit)))}/${pct(mean(rows.map((r) => r.G_tfidf.hit1)))} | ${pct(mean(rows.map((r) => r.FF0.hit)))}/${pct(mean(rows.map((r) => r.FF0.hit1)))} | ${d(rows, 'FF0', 'G_seq', 'hit')} | ${d(rows, 'FF0', 'G_tfidf', 'hit')} |`;
console.log('| repo | n | grep sequence h5/h1 | grep tf-idf h5/h1 | find_files h5/h1 | FF0 - sequence h5 (SE) | FF0 - tf-idf h5 (SE) |\n|---|---|---|---|---|---|---|');
for (const j of per) console.log(line(j.repo, all.filter((r) => r.repo === j.repo)));
console.log(line('**pooled**', all));
const T = all;
console.log('\nTokens per question (mean; ceil chars/4)');
console.log(`find_files text: ${mean(T.map((r) => r.FF0.tokens)).toFixed(0)}  (median ${med(T.map((r) => r.FF0.tokens))})`);
console.log(`grep sequence search output: ${mean(T.map((r) => r.G_seq.tokens)).toFixed(0)}; plus reading its top 5 (200 lines each): ${mean(T.map((r) => r.G_seq.tokens + r.G_seq.readTok)).toFixed(0)}`);
console.log(`find_files + reading its top 5 (200 lines each): ${mean(T.map((r) => r.FF0.tokens + r.FF0.readTok)).toFixed(0)}; reading tf-idf top 5: ${mean(T.map((r) => r.G_tfidf.readTok)).toFixed(0)}`);
console.log(`grep calls per question: ${mean(T.map((r) => r.G_seq.calls)).toFixed(1)}`);
const ok = T.filter((r) => r.FF0.hit), okg = T.filter((r) => r.G_seq.hit);
console.log(`tokens per HIT (total tokens / questions answered right): find_files ${(mean(T.map((r) => r.FF0.tokens)) / mean(T.map((r) => r.FF0.hit))).toFixed(0)}; grep sequence search ${(mean(T.map((r) => r.G_seq.tokens)) / mean(T.map((r) => r.G_seq.hit))).toFixed(0)}, with reads ${(mean(T.map((r) => r.G_seq.tokens + r.G_seq.readTok)) / mean(T.map((r) => r.G_seq.hit))).toFixed(0)}`);
console.log(`\nWarm latency per query, ms: find_files median ${med(T.map((r) => r.FF0.ms))}, p95 ${[...T.map((r) => r.FF0.ms)].sort((a, b) => a - b)[Math.floor(T.length * 0.95)]}; grep sequence median ${med(T.map((r) => r.G_seq.ms))}`);
console.log(`Index build (HYB+LTR) ms: ${per.map((j) => `${j.repo} ${j.buildMs} (${j.files} files)`).join(', ')}`);
const test = all.filter((r) => r.test);
console.log(`\nTime split (first ${per[0].nTrain}.. = 60% train, last 40% test), test n=${test.length}`);
console.log('| repo | test n | trained? | FF0 h5/h1 | FF1g h5/h1 | FF1u h5/h1 |\n|---|---|---|---|---|---|');
for (const j of per) { const t = all.filter((r) => r.repo === j.repo && r.test); const g = j.guard; console.log(`| ${j.repo} | ${t.length} | ${g.trained ? (g.deployed ? 'yes, shipped' : 'yes, guard kept frozen') : g.reason} | ${pct(mean(t.map((r) => r.FF0.hit)))}/${pct(mean(t.map((r) => r.FF0.hit1)))} | ${pct(mean(t.map((r) => r.FF1g.hit)))}/${pct(mean(t.map((r) => r.FF1g.hit1)))} | ${pct(mean(t.map((r) => r.FF1u.hit)))}/${pct(mean(t.map((r) => r.FF1u.hit1)))} |`); }
console.log(`| **pooled** | ${test.length} | | ${pct(mean(test.map((r) => r.FF0.hit)))}/${pct(mean(test.map((r) => r.FF0.hit1)))} | ${pct(mean(test.map((r) => r.FF1g.hit)))}/${pct(mean(test.map((r) => r.FF1g.hit1)))} | ${pct(mean(test.map((r) => r.FF1u.hit)))}/${pct(mean(test.map((r) => r.FF1u.hit1)))} |`);
console.log(`paired FF1g-FF0 h5 ${d(test, 'FF1g', 'FF0', 'hit')}, h1 ${d(test, 'FF1g', 'FF0', 'hit1')}; FF1u-FF0 h5 ${d(test, 'FF1u', 'FF0', 'hit')}, h1 ${d(test, 'FF1u', 'FF0', 'hit1')}`);
const trainedRepos = per.filter((j) => j.guard.trained).map((j) => j.repo);
const tt = test.filter((r) => trainedRepos.includes(r.repo));
console.log(`only the ${trainedRepos.length} repos that had >= 30 labels (n=${tt.length}): FF1g-FF0 h5 ${d(tt, 'FF1g', 'FF0', 'hit')}, h1 ${d(tt, 'FF1g', 'FF0', 'hit1')}; FF1u-FF0 h5 ${d(tt, 'FF1u', 'FF0', 'hit')}, h1 ${d(tt, 'FF1u', 'FF0', 'hit1')}`);
console.log(`test slice, frozen vs grep sequence: h5 ${pct(mean(test.map((r) => r.FF0.hit)))} vs ${pct(mean(test.map((r) => r.G_seq.hit)))}`);
