/* The harness's statistics, kept apart so a test can pin them with known inputs.
   Percentile is nearest-rank (the smallest value with at least p of the sample at or below it), the
   convention an INP report uses; median averages the middle pair of an even sample. */

const sorted = (xs) => xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

export function percentile(xs, p) {
  const s = sorted(xs);
  if (!s.length) return null;
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[Math.min(s.length, rank) - 1];
}

export function median(xs) {
  const s = sorted(xs);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** {n, median, p95, min, max} of the finite numbers in xs; n is how many there were. */
export function summarize(xs) {
  const s = sorted(xs);
  return { n: s.length, median: median(s), p95: percentile(s, 0.95), min: s[0] ?? null, max: s[s.length - 1] ?? null };
}

/** Round to 1 decimal for reports. */
export const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Dropped frames from rAF deltas: a delta of k frame periods drops k-1 frames (only past 1.5 periods, so jitter is not a drop).
    `frameMs` is the display's period (16.7 at 60 Hz; the runner passes the median delta so a 55 Hz or remote display is not all "over").
    `over` counts deltas more than 25% past a period. */
export function droppedFrames(deltas, frameMs = 16.7) {
  let dropped = 0;
  for (const d of deltas) if (d > frameMs * 1.5) dropped += Math.round(d / frameMs) - 1;
  return { frames: deltas.length, dropped, over: deltas.filter((d) => d > frameMs * 1.25).length };
}

/** Do two summaries agree: each median lies inside the other's [min, max]? */
export function agree(a, b) {
  return a.median >= b.min && a.median <= b.max && b.median >= a.min && b.median <= a.max;
}
