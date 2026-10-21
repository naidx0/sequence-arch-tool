// Paired compare of two bank runs: node paired.mjs BASE.json CAND.json
import fs from 'node:fs';
const [b, c] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).results);
const key = (r) => `${r.convo}/r${r.run}/t${r.turn}`;
const bm = new Map(b.filter((r) => !r.error).map((r) => [key(r), r]));
const pairs = c.filter((r) => !r.error && bm.has(key(r))).map((r) => [bm.get(key(r)), r]);
const errs = [b, c].map((x) => x.filter((r) => r.error).length);
const closing = (r) => (r.resendReasons || []).filter((s) => /closing|OFFERING|ends by/i.test(s)).length;
const m = {
  'mean turn time (s)': (r) => r.ms / 1000,
  'full product answer': (r) => (r.productShape ? 1 : 0),
  'lesson quality': (r) => r.quality ?? 0,
  'concept flow chart': (r) => (r.conceptFlowChart ? 1 : 0),
  'model calls per turn': (r) => r.providerCalls,
  'closing-question resends': closing,
};
console.log(`pairs ${pairs.length}, errors base ${errs[0]} cand ${errs[1]}`);
for (const [name, f] of Object.entries(m)) {
  const d = pairs.map(([x, y]) => f(y) - f(x));
  const n = d.length, mean = d.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(d.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const avg = (i) => pairs.reduce((a, p) => a + f(p[i]), 0) / n;
  const sum = (i) => pairs.reduce((a, p) => a + f(p[i]), 0);
  console.log(`${name}: base ${avg(0).toFixed(3)} cand ${avg(1).toFixed(3)} delta ${mean.toFixed(3)} SE ${se.toFixed(3)} (${(mean / se).toFixed(1)} SE)` + (name.includes('resends') ? ` totals ${sum(0)} -> ${sum(1)}` : ''));
}
