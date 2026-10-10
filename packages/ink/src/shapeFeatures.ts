/* ══════════════════════════════════════════════════════════════════════════
   STROKE FEATURES FOR THE TRAINED SHAPE RECOGNIZER
   packages/ink/src/shapeFeatures.ts

   One stroke in, a fixed row of numbers out. Every feature is a ratio against
   the stroke's own size, so the row is the same at any zoom, with one
   exception that says so: `logRelDiag` (size against the other strokes on the
   same board, which is how a letter is told from a box drawn round it).

   Only the shape of the path. Timestamps are recorded on the whiteboard now,
   but nothing here reads time, pressure or speed: the DiDi data this was
   trained on is a pen on a tablet, and a mouse's speed profile is another
   thing. The path is resampled first, so a pen's dense samples and a mouse's
   sparse ones give the same row.

   A run of strokes drawn as one shape (the four sides of a box) is judged as
   one path: the strokes are joined and `pieceDiags` says how many there were
   and how big each was.

   PURE. No DOM, no randomness.
   ══════════════════════════════════════════════════════════════════════════ */

export interface P {
  x: number;
  y: number;
}

export const SHAPE_FEATURE_NAMES = [
  'logPieces',
  'pieceRel',
  'logRelDiag',
  'aspect',
  'closure',
  'pathOverDiag',
  'pathOverPerim',
  'fill',
  'hullFill',
  'solidity',
  'straight',
  'chordDev',
  'rdp04',
  'rdp10',
  'turnAbs',
  'turnNet',
  'corners',
  'resEllipse',
  'resBox',
  'resDiamond',
  'nearEdge',
  'nearCorner',
  'selfX',
  'farIdx',
  'farToEnd',
  'reversals',
  'dir0',
  'dir1',
  'dir2',
  'dir3',
  'endTurn',
  'startTurn',
] as const;

export type ShapeFeatureName = (typeof SHAPE_FEATURE_NAMES)[number];
export const SHAPE_FEATURE_COUNT = SHAPE_FEATURE_NAMES.length;

function dist(a: P, b: P): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dedupe(points: readonly P[]): P[] {
  const out: P[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Resample to `n` points evenly spaced along the path ($1-recognizer style). */
export function resample(points: readonly P[], n: number): P[] {
  const pts = dedupe(points);
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0]! }));
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1]!, pts[i]!);
  const step = total / (n - 1);
  const out: P[] = [{ ...pts[0]! }];
  let acc = 0;
  let prev = pts[0]!;
  let i = 1;
  while (i < pts.length && out.length < n - 1) {
    const cur = pts[i]!;
    const d = dist(prev, cur);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      acc = 0;
    } else {
      acc += d;
      prev = cur;
      i++;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1]! });
  return out;
}

function perp(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
}

function rdpCount(points: P[], eps: number): number {
  if (points.length < 3) return points.length;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxD = -1;
  let idx = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perp(points[i]!, first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) return rdpCount(points.slice(0, idx + 1), eps) + rdpCount(points.slice(idx), eps) - 1;
  return 2;
}

function polyArea(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function hull(points: P[]): P[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * The feature row for one stroke.
 *
 * `boardDiag` is the median bounding-box diagonal of the OTHER strokes on the
 * board (or in the drawing), when the caller has it; without it the relative
 * size reads as 1 (this stroke is a typical one).
 */
export function shapeFeatures(points: readonly P[], boardDiag?: number, pieceDiags?: readonly number[]): number[] {
  const deduped = dedupe(points);
  const row = new Array<number>(SHAPE_FEATURE_COUNT).fill(0);
  if (deduped.length < 2) return row;
  /* DEVICE-INDEPENDENT. A tablet pen reports a point every few pixels, a mouse
     one per frame and far fewer when it moves fast, and a trackpad quantises to
     whole pixels. Resampling to an even 128 points first means none of that
     reaches a feature: the same outline gives the same row at any sampling rate. */
  const raw = resample(deduped, 128);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const diag = Math.hypot(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const R = resample(raw, 64);
  let pathLen = 0;
  for (let i = 1; i < raw.length; i++) pathLen += dist(raw[i - 1]!, raw[i]!);
  const start = raw[0]!;
  const end = raw[raw.length - 1]!;
  const chord = dist(start, end);

  let k = 0;
  const set = (v: number) => {
    row[k++] = Number.isFinite(v) ? v : 0;
  };
  /* How many strokes made this outline, and how big each was against the whole.
     A lone stroke is (1 piece, relative size 1); the four sides of a box are
     (4, ~0.5); the letters of a word are (n, ~0.3). Never an absolute size:
     a board's zoom and a person's screen would shift it. */
  const pieces = pieceDiags && pieceDiags.length > 0 ? pieceDiags : [diag];
  set(Math.log(pieces.length));
  set(Math.min(1.5, pieces.reduce((a, b) => a + b, 0) / pieces.length / diag));
  set(boardDiag && boardDiag > 0 ? Math.log(diag / boardDiag) : 0);
  set(Math.abs(Math.log(w / h)));
  set(chord / diag);
  set(pathLen / diag);
  set(pathLen / (2 * (w + h)));
  const area = polyArea(R);
  set(area / (w * h));
  const H = hull(R);
  const hullArea = polyArea(H);
  set(hullArea / (w * h));
  set(hullArea > 0 ? area / hullArea : 0);
  set(pathLen > 0 ? chord / pathLen : 0);
  let maxDev = 0;
  for (const p of R) maxDev = Math.max(maxDev, perp(p, start, end));
  set(chord > 1e-6 ? Math.min(maxDev / chord, 5) : 5);
  set(rdpCount(R, diag * 0.04));
  set(rdpCount(R, diag * 0.1));

  // Turning
  const ang: number[] = [];
  for (let i = 1; i < R.length; i++) ang.push(Math.atan2(R[i]!.y - R[i - 1]!.y, R[i]!.x - R[i - 1]!.x));
  let turnAbs = 0;
  let turnNet = 0;
  let corners = 0;
  let reversals = 0;
  const turns: number[] = [];
  for (let i = 1; i < ang.length; i++) {
    const d = angleDiff(ang[i - 1]!, ang[i]!);
    turns.push(d);
    turnAbs += Math.abs(d);
    turnNet += d;
  }
  // corners over a 3-step window, reversals over a 2-step window
  for (let i = 2; i < ang.length; i++) {
    const d = Math.abs(angleDiff(ang[i - 2]!, ang[i]!));
    if (d > Math.PI / 3) corners++;
    if (d > (5 * Math.PI) / 6) reversals++;
  }
  set(turnAbs / (2 * Math.PI));
  set(Math.abs(turnNet) / (2 * Math.PI));
  set(corners);

  // Residuals against the three closed outlines in the stroke's own box
  let rE = 0;
  let rB = 0;
  let rD = 0;
  let nearEdge = 0;
  let nearCorner = 0;
  for (const p of R) {
    const dx = (p.x - cx) / (w / 2);
    const dy = (p.y - cy) / (h / 2);
    rE += Math.abs(Math.hypot(dx, dy) - 1);
    rB += Math.abs(Math.max(Math.abs(dx), Math.abs(dy)) - 1);
    rD += Math.abs(Math.abs(dx) + Math.abs(dy) - 1);
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.8) nearEdge++;
    if (Math.abs(dx) > 0.75 && Math.abs(dy) > 0.75) nearCorner++;
  }
  set(rE / R.length);
  set(rB / R.length);
  set(rD / R.length);
  set(nearEdge / R.length);
  set(nearCorner / R.length);

  let selfX = 0;
  for (let i = 1; i < R.length; i++) {
    for (let j = i + 2; j < R.length; j++) {
      if (segmentsCross(R[i - 1]!, R[i]!, R[j - 1]!, R[j]!)) selfX++;
    }
  }
  set(Math.min(selfX, 20));

  // Arrow cues: where along the path is the point farthest from the start, and
  // how far the pen came back from it (a head drawn after the shaft).
  let far = 0;
  let farD = -1;
  for (let i = 0; i < R.length; i++) {
    const d = dist(R[i]!, R[0]!);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  set(far / (R.length - 1));
  set(dist(R[far]!, R[R.length - 1]!) / diag);
  set(reversals);

  // Direction histogram, 4 undirected bins (horizontal, diagonal /, vertical, diagonal \)
  const dirs = [0, 0, 0, 0];
  for (const a of ang) {
    let t = a % Math.PI;
    if (t < 0) t += Math.PI;
    dirs[Math.round(t / (Math.PI / 4)) % 4]! += 1;
  }
  for (const d of dirs) set(d / Math.max(ang.length, 1));

  // How much the path turns in its last / first fifth
  const fifth = Math.max(1, Math.floor(turns.length / 5));
  let endTurn = 0;
  let startTurn = 0;
  for (let i = turns.length - fifth; i < turns.length; i++) endTurn += Math.abs(turns[i] ?? 0);
  for (let i = 0; i < fifth; i++) startTurn += Math.abs(turns[i] ?? 0);
  set(endTurn / Math.PI);
  set(startTurn / Math.PI);

  return row;
}

/** Median bounding-box diagonal of a set of strokes (the `boardDiag` context). */
export function medianDiag(strokes: readonly (readonly P[])[]): number {
  const ds = strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of s) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return Math.hypot(maxX - minX, maxY - minY);
    })
    .sort((a, b) => a - b);
  if (ds.length === 0) return 0;
  return ds[Math.floor(ds.length / 2)]!;
}
