/*
 * Paired statistics for the task-completion arm. Pure; tested in stats.test.mjs.
 *
 * Two arms ran the SAME tasks. For each task, the arm's score is the mean of its
 * repeats; the paired difference is b - a. SE = sd(differences) / sqrt(n) with the
 * n-1 sample sd. The registered win bar (docs/research/pi-and-opencode-study.md
 * section 5): "win" only if mean difference > 2 SE, and only with n >= 30 tasks.
 * Tasks present in one arm only are listed in `unpaired`, never silently dropped.
 */

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function perTask(rows, key) {
  const by = new Map();
  for (const r of rows) {
    const v = typeof r[key] === 'boolean' ? Number(r[key]) : Number(r[key]);
    if (!Number.isFinite(v)) continue;
    if (!by.has(r.task)) by.set(r.task, []);
    by.get(r.task).push(v);
  }
  return new Map([...by].map(([k, v]) => [k, mean(v)]));
}

export function pairedStats(aRows, bRows, { key = 'pass', minN = 30, z = 2, better = 'higher' } = {}) {
  const a = perTask(aRows, key);
  const b = perTask(bRows, key);
  const ids = [...a.keys()].filter((k) => b.has(k)).sort();
  const unpaired = [...new Set([...a.keys(), ...b.keys()])].filter((k) => !(a.has(k) && b.has(k)));
  const diffs = ids.map((task) => ({ task, a: a.get(task), b: b.get(task), diff: b.get(task) - a.get(task) }));
  const n = diffs.length;
  const m = n ? mean(diffs.map((d) => d.diff)) : 0;
  const sd = n > 1 ? Math.sqrt(diffs.reduce((s, d) => s + (d.diff - m) ** 2, 0) / (n - 1)) : 0;
  const se = n > 0 ? sd / Math.sqrt(n) : 0;
  let verdict;
  if (n < minN) verdict = 'underpowered';
  else if (m > z * se) verdict = better === 'lower' ? 'loss' : 'win';
  else if (m < -z * se) verdict = better === 'lower' ? 'win' : 'loss';
  else verdict = 'no-difference';
  return { key, n, minN, meanA: n ? mean(diffs.map((d) => d.a)) : 0, meanB: n ? mean(diffs.map((d) => d.b)) : 0, mean: m, sd, se, bar: z * se, verdict, diffs, unpaired };
}

export function formatStats(s, labelA = 'A', labelB = 'B') {
  return [
    `${s.key}: ${labelA} ${s.meanA.toFixed(3)}  ${labelB} ${s.meanB.toFixed(3)}  n=${s.n}`,
    `mean diff (${labelB}-${labelA}) ${s.mean.toFixed(3)}  sd ${s.sd.toFixed(3)}  SE ${s.se.toFixed(3)}  2SE ${s.bar.toFixed(3)}`,
    `verdict: ${s.verdict}${s.verdict === 'underpowered' ? ` (needs n >= ${s.minN})` : ''}${s.unpaired.length ? `  unpaired: ${s.unpaired.join(',')}` : ''}`,
  ].join('\n');
}
