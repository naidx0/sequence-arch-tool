import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuPercent, detectSettle, medianOf, percentile, summarize } from '../lib/scanBenchLib.mjs';

test('percentile is nearest-rank: p95 of 20 samples is the 19th smallest', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 0.95), 19);
  assert.equal(percentile(xs, 0.5), 10);
  assert.equal(percentile(xs, 1), 20);
  assert.equal(percentile(xs, 0), 1);
});

test('percentile ignores input order, does not mutate, and is null when empty', () => {
  const xs = [5, 1, 3];
  assert.equal(percentile(xs, 0.5), 3);
  assert.deepEqual(xs, [5, 1, 3]);
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([7], 0.95), 7);
});

test('one huge stall among many fast samples moves max but only p95 once it is >5 percent of them', () => {
  const fast = Array.from({ length: 99 }, () => 3);
  assert.equal(percentile([...fast, 20000], 0.95), 3);
  assert.equal(percentile([...fast.slice(0, 90), ...Array.from({ length: 10 }, () => 20000)], 0.95), 20000);
});

test('medianOf and summarize', () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 3, 2]), 2.5);
  assert.deepEqual(summarize([10, 30, 20]), { n: 3, median: 20, min: 10, max: 30 });
  assert.deepEqual(summarize([]), { n: 0, median: null, min: null, max: null });
  assert.equal(summarize([1, NaN, null, 3]).n, 2);
});

test('cpuPercent: 50 ticks in 1 s at 100 Hz is 50 percent of a core', () => {
  assert.equal(cpuPercent({ ticks: 0, t: 0 }, { ticks: 50, t: 1000 }), 50);
  assert.equal(cpuPercent({ ticks: 0, t: 0 }, { ticks: 5, t: 250 }), 20);
  assert.equal(cpuPercent({ ticks: 0, t: 1000 }, { ticks: 9, t: 1000 }), 0);
});

const series = (cpus, step = 250, rss = (i) => 100_000 + i) => cpus.map((cpu, i) => ({ t: i * step, cpu, rss: rss(i) }));

test('detectSettle: settles once CPU stays under 2 percent for 5 s, reporting RSS at the window end and the peak', () => {
  const busy = Array.from({ length: 8 }, () => 90);
  const quiet = Array.from({ length: 30 }, () => 0.5); // 30 x 250 ms = 7.25 s of span
  const s = series([...busy, ...quiet], 250, (i) => (i === 3 ? 400_000 : 150_000));
  const r = detectSettle(s);
  assert.equal(r.settled, true);
  assert.equal(r.windowStart, 8 * 250);
  assert.equal(r.settledAt, 8 * 250 + 5000);
  assert.equal(r.rssKb, 150_000);
  assert.equal(r.peakKb, 400_000);
});

test('detectSettle: a spike inside the quiet window restarts it', () => {
  const cpus = [...Array.from({ length: 12 }, () => 0.1), 50, ...Array.from({ length: 8 }, () => 0.1)];
  // 12 quiet samples span 2.75 s, then a spike, then 8 samples span 1.75 s: never 5 s in a row.
  assert.equal(detectSettle(series(cpus)).settled, false);
  const longer = [...cpus, ...Array.from({ length: 14 }, () => 0.1)]; // second window now spans >5 s
  const r = detectSettle(series(longer));
  assert.equal(r.settled, true);
  assert.equal(r.windowStart, 13 * 250);
});

test('detectSettle: never quiet is unsettled and reports the last RSS; empty input is unsettled', () => {
  const r = detectSettle(series(Array.from({ length: 40 }, () => 30), 250, (i) => 1000 + i));
  assert.equal(r.settled, false);
  assert.equal(r.rssKb, 1039);
  assert.equal(r.settledAt, null);
  assert.deepEqual(detectSettle([]), { settled: false, settledAt: null, windowStart: null, rssKb: null, peakKb: 0 });
});

test('detectSettle: the threshold is strict (exactly 2 percent is busy) and holdMs is respected', () => {
  assert.equal(detectSettle(series(Array.from({ length: 40 }, () => 2))).settled, false);
  assert.equal(detectSettle(series(Array.from({ length: 5 }, () => 0)), { holdMs: 1000 }).settled, true);
  assert.equal(detectSettle(series(Array.from({ length: 4 }, () => 0)), { holdMs: 1000 }).settled, false);
});
