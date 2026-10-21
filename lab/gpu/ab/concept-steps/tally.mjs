// Merge both orders per pair (A = flag off, B = flag on), then B wins minus losses per criterion.
import fs from 'node:fs';
import { mergeOrders } from '../../../../tools/bench/lesson-judge.mjs';
const S = process.argv[2];
const byKey = {};
let missing = 0;
for (const i of [0, 1, 2]) {
  const map = JSON.parse(fs.readFileSync(`${S}/judge/map${i}.json`, 'utf8'));
  const ans = JSON.parse(fs.readFileSync(`${S}/judge/answers${i}.json`, 'utf8'));
  for (const [id, key] of map) {
    if (!ans[id]) { missing++; continue; }
    const v = Object.fromEntries(Object.entries(ans[id]).map(([k, x]) => [k, String(x)]));
    byKey[key] = v;
  }
}
const pairs = JSON.parse(fs.readFileSync(`${S}/cs-pairs.json`, 'utf8'));
const merged = [];
for (const p of pairs) {
  const ab = byKey[`${p.id}|AB`], ba = byKey[`${p.id}|BA`];
  if (!ab || !ba) continue;
  merged.push({ p, m: mergeOrders(ab, ba) });
}
console.log(`answers missing ${missing}; pairs judged both orders ${merged.length} of ${pairs.length}`);
for (const k of ['visual', 'overall', 'true', 'clear', 'teaches', 'kind']) {
  const d = merged.map(({ m }) => (m[k] === 'B' ? 1 : m[k] === 'A' ? -1 : 0));
  const n = d.length, mean = d.reduce((a, v) => a + v, 0) / n;
  const se = Math.sqrt(d.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) / n);
  // By family: mean per family, then SE across families (clusters).
  const fam = {};
  merged.forEach(({ p }, i) => (fam[p.family] ??= []).push(d[i]));
  const fm = Object.values(fam).map((xs) => xs.reduce((a, v) => a + v, 0) / xs.length);
  const fmean = fm.reduce((a, v) => a + v, 0) / fm.length;
  const fse = Math.sqrt(fm.reduce((a, v) => a + (v - fmean) ** 2, 0) / (fm.length - 1) / fm.length);
  const wins = d.filter((x) => x > 0).length, losses = d.filter((x) => x < 0).length;
  console.log(`${k}: on wins ${wins}, loses ${losses}, ties ${n - wins - losses}; net ${mean.toFixed(3)} SE ${se.toFixed(3)} (${(mean / se).toFixed(1)} SE); by family (${fm.length}) ${fmean.toFixed(3)} SE ${fse.toFixed(3)}`);
}
const cs = pairs.map((p) => p.chartScore[1].score - p.chartScore[0].score);
console.log(`scoreChart (report only): off ${(pairs.reduce((a, p) => a + p.chartScore[0].score, 0) / pairs.length).toFixed(1)} on ${(pairs.reduce((a, p) => a + p.chartScore[1].score, 0) / pairs.length).toFixed(1)}; mean delta ${(cs.reduce((a, v) => a + v, 0) / cs.length).toFixed(1)}`);
