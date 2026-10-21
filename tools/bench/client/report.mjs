#!/usr/bin/env node
/* Markdown tables from run.mjs output.
     node tools/bench/client/report.mjs a.json [b.json]     one table per file; with two, a comparison with the verdict
   The verdict per metric follows docs/plans/0.1.8.3-speed-plan.md: "agree" = each median lies inside the other's
   [min, max]; a change is "beyond noise" when the run ranges do not overlap and the medians differ by 10 % or more. */
import fs from 'node:fs';

import { agree, r1 } from './stats.mjs';

/* Summaries are read at the 0.1 ms the report prints, so a rounded median is never "outside" an unrounded max. */
const rs = (v) => ({ ...v, median: r1(v.median), p95: r1(v.p95), min: r1(v.min), max: r1(v.max) });
const load = (f) => {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  r.summary = Object.fromEntries(Object.entries(r.summary).map(([k, v]) => [k, rs(v)]));
  return r;
};
const fmt = (x) => (x == null ? '-' : String(r1(x)));

export function table(result) {
  const rows = ['| metric | median | p95 | min | max | n |', '|---|---:|---:|---:|---:|---:|'];
  for (const [k, v] of Object.entries(result.summary)) rows.push(`| ${k} | ${fmt(v.median)} | ${fmt(v.p95)} | ${fmt(v.min)} | ${fmt(v.max)} | ${v.n} |`);
  return rows.join('\n');
}

export function overlaps(a, b) {
  return !(a.max < b.min || b.max < a.min);
}

export function compare(a, b) {
  const rows = ['| metric | A median (min-max) | B median (min-max) | B vs A | ranges | verdict |', '|---|---:|---:|---:|---|---|'];
  let agreeing = 0;
  let total = 0;
  for (const k of Object.keys(a.summary)) {
    const x = a.summary[k];
    const y = b.summary[k];
    if (!y) continue;
    total += 1;
    const ok = agree(x, y);
    if (ok) agreeing += 1;
    const diff = x.median ? ((y.median - x.median) / x.median) * 100 : null;
    const verdict = ok ? 'agree' : !overlaps(x, y) && diff != null && Math.abs(diff) >= 10 ? 'DIFFERENT (beyond noise)' : 'medians outside the other range';
    rows.push(`| ${k} | ${fmt(x.median)} (${fmt(x.min)}-${fmt(x.max)}) | ${fmt(y.median)} (${fmt(y.min)}-${fmt(y.max)}) | ${diff == null ? '-' : (diff >= 0 ? '+' : '') + r1(diff) + '%'} | ${overlaps(x, y) ? 'overlap' : 'disjoint'} | ${verdict} |`);
  }
  return { markdown: rows.join('\n'), agreeing, total };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/bench/client/report.mjs')) {
  const [fa, fb] = process.argv.slice(2);
  if (!fa) {
    console.error('usage: report.mjs a.json [b.json]');
    process.exit(2);
  }
  const a = load(fa);
  console.log(table(a));
  if (fb) {
    const b = load(fb);
    console.log('\n' + table(b) + '\n');
    const c = compare(a, b);
    console.log(c.markdown);
    console.log(`\n${c.agreeing} of ${c.total} metrics agree (each median inside the other run's range)`);
  }
}
