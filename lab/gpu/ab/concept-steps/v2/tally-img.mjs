// Per judge, per item: merge both orders (disagreement = tie); then cap wins minus losses over items.
import fs from 'node:fs';
const S = process.argv[2];
const map = JSON.parse(fs.readFileSync(`${S}/judge2/map.json`, 'utf8'));
const per = {}; // item -> list of scores (+1 cap, -1 off, 0 tie), one per judge
let clipped = 0;
for (const j of ['j1', 'j2', 'j3']) {
  const a = JSON.parse(fs.readFileSync(`${S}/judge2/answers-${j}.json`, 'utf8'));
  const v = {};
  for (const [id, n, order] of map) {
    const ans = a[id];
    if (!ans) throw new Error(`${j} missing ${id}`);
    const cl = String(ans.clipped ?? 'none');
    if (cl === '1' || cl === '2') { if (order.split('-')[Number(cl) - 1] === 'cap') clipped++; }
    const pick = String(ans.visual);
    const winner = pick === 'tie' ? 'tie' : order.split('-')[Number(pick) - 1];
    (v[n] ??= []).push(winner);
  }
  for (const [n, [x, y]] of Object.entries(v)) {
    const s = x === y ? (x === 'cap' ? 1 : x === 'off' ? -1 : 0) : 0;
    (per[n] ??= []).push(s);
  }
}
const itemMeans = Object.values(per).map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
const n = itemMeans.length, mean = itemMeans.reduce((a, b) => a + b, 0) / n;
const se = Math.sqrt(itemMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) / n);
const all = Object.values(per).flat();
console.log(`judgments ${all.length}: cap wins ${all.filter((x) => x > 0).length}, off wins ${all.filter((x) => x < 0).length}, ties ${all.filter((x) => x === 0).length}`);
console.log(`per item (n=${n}): mean ${mean.toFixed(3)} SE ${se.toFixed(3)} (${se > 0 ? (mean / se).toFixed(1) : 'inf'} SE); items ${JSON.stringify(per)}`);
console.log(`answers flagging text clipped only in the caption arm (both-arm ellipsis cuts excluded): ${clipped}`);
