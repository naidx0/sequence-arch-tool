/**
 * @sequence/ink — pure, zero-dependency freehand stroke recognition.
 *
 * The signature vision interaction: "i draw a bad box squiggly box and it
 * autocorrects to an actual box." Given a raw pointer stroke (a list of screen-
 * or flow-space points), `recognizeStroke` classifies it deterministically —
 * no ML, no randomness — into one of three shapes:
 *
 *   - `box`     a closed loop that encloses meaningful area (rectangles, rotated
 *               squares, rough ellipses, wobbly blobs). Returns the axis-aligned
 *               bounding rect the caller snaps to a grid and turns into a node.
 *   - `line`    an open, roughly-straight stroke. Returns its endpoints; the
 *               caller hit-tests them against nodes to author an edge.
 *   - `scribble` anything else (jagged open strokes, L-shapes, tiny taps).
 *
 * Approach (per the plan): Ramer–Douglas–Peucker simplification to strip pointer
 * jitter down to dominant vertices, then closure detection + polygon-fill for the
 * box case and chord-deviation straightness for the line case. Every threshold is
 * a ratio against the stroke's own bounding-box diagonal, so recognition is
 * scale-invariant: the same gesture drawn large or small, at any zoom, classifies
 * the same way.
 *
 * These are pure functions over plain `{x,y}` data. No DOM, no framework.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type InkResult =
  | { kind: 'box'; rect: Rect; confidence: number }
  | { kind: 'line'; start: Point; end: Point; confidence: number }
  | { kind: 'scribble' };

/* --------------------------------------------------------------- thresholds ---
 * All distance thresholds are fractions of the stroke's bounding-box diagonal so
 * the recognizer is scale- and zoom-invariant. The values are tuned to be
 * *generous toward a box* — the user is deliberately drawing badly and expects the
 * squiggle to autocorrect — while still rejecting genuinely ambiguous strokes.
 */
const THRESHOLDS = {
  /** Strokes whose bounding-box diagonal is below this (in input units) are taps
   *  / accidental micro-drags — too small to carry intent. Rejected as scribble. */
  MIN_DIAGONAL: 30,
  /** A stroke is "closed" when its start→end gap is at most this fraction of the
   *  diagonal. Generous (0.35): a hand-drawn box is rarely closed cleanly. */
  CLOSURE_FRAC: 0.35,
  /** A closed stroke is a box when its simplified polygon fills at least this
   *  fraction of its bounding box. A perfect axis rect ≈ 1.0, a 45°-rotated square
   *  = 0.5, an ellipse ≈ 0.785; a self-crossing scribble's signed area ≈ 0. 0.35
   *  clears every real box (with jitter headroom) and rejects closed scribbles. */
  BOX_FILL_MIN: 0.35,
  /** An open stroke is a line when its max perpendicular deviation from the
   *  start→end chord is at most this fraction of the chord length. An L-shape
   *  deviates ~0.5 (corner half-way out) so it is correctly excluded. */
  LINE_STRAIGHT_FRAC: 0.15,
  /** RDP simplification tolerance, as a fraction of the diagonal. */
  RDP_EPS_FRAC: 0.04,
} as const;

/** Exposed for tests and callers that want to reason about the tuning. */
export const INK_THRESHOLDS = THRESHOLDS;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drop consecutive duplicate (or near-duplicate) points — repeated pointer
 *  events at a stationary position would otherwise skew simplification. */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) out.push(p);
  }
  return out;
}

function boundingBox(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Perpendicular distance from point `p` to the (infinite) line through a→b. */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  // |cross product| / |a→b|
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Recursively keeps the point of
 * maximum perpendicular deviation from the current chord while it exceeds `eps`,
 * discarding the jitter in between. Endpoints are always preserved.
 */
export function rdp(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let maxDev = -1;
  let idx = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], first, last);
    if (d > maxDev) {
      maxDev = d;
      idx = i;
    }
  }
  if (maxDev > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    // right[0] === left[last]; drop the duplicate seam.
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/**
 * Turn a raw pointer stroke into a SMOOTH SVG path `d` for live rendering — the
 * fluidity half of the interaction. Recognition still runs on the raw points
 * (this never feeds the recognizer), so the classifier contracts are untouched;
 * this is purely what the human SEES while dragging, so the ink feels like a pen
 * and not a jagged polyline.
 *
 * Uses a uniform Catmull-Rom spline converted to cubic béziers: the curve passes
 * THROUGH every input point (no drift), with tangents derived from each point's
 * neighbours (the classic `/6` uniform Catmull-Rom control offset). Pure and
 * deterministic — same points in, same string out. Degenerate inputs are safe:
 * `[]`/single point → `''`; two points → a straight `L` segment.
 */
export function strokePath(points: Point[]): string {
  const pts = dedupe(points);
  if (pts.length < 2) return '';
  const f = (n: number): string => (Math.round(n * 100) / 100).toString();
  if (pts.length === 2) {
    return `M ${f(pts[0].x)} ${f(pts[0].y)} L ${f(pts[1].x)} ${f(pts[1].y)}`;
  }
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** Signed area of a polygon (shoelace). Absolute value ignores winding; a self-
 *  crossing path largely cancels, yielding a small area — which is exactly how we
 *  reject closed scribbles. The vertex list should NOT repeat the first point. */
function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Classify a raw freehand stroke. See the module doc for the shape taxonomy.
 * Pure and deterministic: identical input always yields identical output.
 */
export function recognizeStroke(points: { x: number; y: number }[]): InkResult {
  const pts = dedupe(points.map((p) => ({ x: p.x, y: p.y })));

  // Too few samples to be anything but a tap.
  if (pts.length < 3) return { kind: 'scribble' };

  const bbox = boundingBox(pts);
  const diag = Math.hypot(bbox.width, bbox.height);

  // Reject tiny strokes: below this the stroke carries no reliable shape signal.
  if (diag < THRESHOLDS.MIN_DIAGONAL) return { kind: 'scribble' };

  const eps = diag * THRESHOLDS.RDP_EPS_FRAC;
  const simplified = rdp(pts, eps);

  const start = pts[0];
  const end = pts[pts.length - 1];
  const endGap = dist(start, end);
  const closed = endGap <= THRESHOLDS.CLOSURE_FRAC * diag;

  if (closed) {
    // Closed stroke → candidate box. Measure how much of its bounding box the
    // simplified polygon actually encloses. A real box (even rough/rotated/oval)
    // fills a large fraction; a closed scribble self-cancels to near zero.
    const poly = simplified.slice();
    // Drop a closing vertex that coincides with the start so shoelace isn't skewed.
    if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < eps) poly.pop();
    if (poly.length >= 3) {
      const bboxArea = bbox.width * bbox.height;
      const fill = bboxArea > 0 ? polygonArea(poly) / bboxArea : 0;
      if (fill >= THRESHOLDS.BOX_FILL_MIN) {
        const closureQ = clamp01(1 - endGap / (THRESHOLDS.CLOSURE_FRAC * diag));
        const confidence = clamp01(0.6 * clamp01(fill) + 0.4 * closureQ);
        return {
          kind: 'box',
          rect: {
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
          },
          confidence,
        };
      }
    }
    // Closed but doesn't enclose real area → not a box; fall through to scribble.
    return { kind: 'scribble' };
  }

  // Open stroke → candidate line. It is a line only if it stays close to the
  // straight chord between its endpoints (small max perpendicular deviation).
  const chordLen = endGap;
  if (chordLen >= THRESHOLDS.MIN_DIAGONAL) {
    let maxDev = 0;
    for (const p of pts) {
      const d = perpDistance(p, start, end);
      if (d > maxDev) maxDev = d;
    }
    const straightness = maxDev / chordLen;
    if (straightness <= THRESHOLDS.LINE_STRAIGHT_FRAC) {
      const confidence = clamp01(1 - straightness / THRESHOLDS.LINE_STRAIGHT_FRAC);
      return {
        kind: 'line',
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        confidence,
      };
    }
  }

  return { kind: 'scribble' };
}
