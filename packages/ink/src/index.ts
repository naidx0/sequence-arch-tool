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
/* ═══════════════════════════════════════════════════════════════════════════
   THE SECOND HALF: A DRAWING THE MODEL CAN BE TOLD ABOUT
   ═══════════════════════════════════════════════════════════════════════════

   `recognizeStroke` has classified one stroke since the day it was written, and
   both of its callers turn the answer into PIXELS — a snapped node, an edge.
   Nothing ever turned it into WORDS, so the read-back that reaches the model
   describes a reader's sketch as "12 marks with no words on them, which I
   cannot read" (`web2/src/whiteboard/whiteboardAsk.ts`) even when nine of them
   are plainly rectangles.

   What follows is that translation and nothing more: shapes in, a countable
   English phrase and a coarse position out.

   NEVER A POINT LIST. A prompt carrying raw pointer samples is both expensive
   and useless — the model cannot see, and a hundred coordinates do not add up
   to a picture for it. A NAME and a NINTH OF THE DRAWING is the most a stroke
   can honestly say, so it is the most this returns.

   AND A SCRIBBLE STAYS A SCRIBBLE. `recognizeStroke` returns `scribble` for
   anything it will not name, and this names it "unreadable mark" rather than
   guessing the nearest shape. Inventing "roughly a rectangle" for a stroke the
   classifier rejected would put a claim about the reader's drawing into the
   prompt that nothing measured.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The kinds {@link recognizeStroke} produces, as a discriminant. */
export type InkShapeKind = InkResult['kind'];

/** What each kind is CALLED in a sentence a person (or a model) reads. */
export const INK_SHAPE_NAMES: Record<InkShapeKind, { one: string; many: string }> = {
  box: { one: 'rectangle', many: 'rectangles' },
  line: { one: 'line', many: 'lines' },
  scribble: { one: 'unreadable mark', many: 'unreadable marks' },
};

/**
 * Coarse position inside the drawing, as a 3×3 grid cell.
 *
 * The centre cell is called "centre" rather than "middle-centre", because that
 * is what it is called; every other cell is `row-column`.
 */
export const INK_GRID_ROWS = ['top', 'middle', 'bottom'] as const;
export const INK_GRID_COLUMNS = ['left', 'centre', 'right'] as const;
export type InkGridCell = string;

/** One stroke, summarised. `rect` is its own bounding box — never its points. */
export interface InkStrokeSummary {
  /** Index in the input list, so a caller can pair this back to its stroke. */
  index: number;
  kind: InkShapeKind;
  /** `INK_SHAPE_NAMES[kind].one`. */
  name: string;
  /** Which ninth of the whole drawing this stroke's centre falls in. */
  cell: InkGridCell;
  /** Rounded — sub-pixel precision is noise in a prompt. */
  rect: Rect;
}

export interface InkSummary {
  strokes: InkStrokeSummary[];
  counts: Record<InkShapeKind, number>;
  /**
   * "3 rectangles, 2 lines and 1 unreadable mark" — empty when there are no
   * strokes at all, so a caller can say NOTHING rather than say "0 marks".
   */
  phrase: string;
}

function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * Which ninth of `outer` the point `p` falls in.
 *
 * A zero-width or zero-height drawing (one vertical line, a single stroke) has
 * no thirds to divide, so that axis collapses to its middle band rather than
 * dividing by zero and naming a cell out of a NaN.
 */
export function inkGridCell(p: Point, outer: Rect): InkGridCell {
  const third = (v: number, origin: number, extent: number): 0 | 1 | 2 => {
    if (!(extent > 0)) return 1;
    const f = (v - origin) / extent;
    if (f < 1 / 3) return 0;
    if (f < 2 / 3) return 1;
    return 2;
  };
  const row = INK_GRID_ROWS[third(p.y, outer.y, outer.height)]!;
  const col = INK_GRID_COLUMNS[third(p.x, outer.x, outer.width)]!;
  return row === 'middle' && col === 'centre' ? 'centre' : `${row}-${col}`;
}

/** "3 rectangles, 2 lines and 1 unreadable mark". Oxford-free, `and` before the last. */
function countPhrase(counts: Record<InkShapeKind, number>): string {
  const parts: string[] = [];
  for (const kind of ['box', 'line', 'scribble'] as const) {
    const n = counts[kind];
    if (n <= 0) continue;
    const label = n === 1 ? INK_SHAPE_NAMES[kind].one : INK_SHAPE_NAMES[kind].many;
    parts.push(`${n} ${label}`);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Summarise a whole drawing's freehand strokes.
 *
 * Every stroke is classified by {@link recognizeStroke} — the SAME function the
 * board's autocorrect uses, so the words in the prompt and the shapes on screen
 * can never disagree about what was drawn — and placed in a 3×3 grid of the
 * drawing's OWN bounding box. Relative to the drawing rather than to the
 * viewport, because a camera position is not part of what somebody drew.
 *
 * PURE. Strokes in, summary out; `{ strokes: [], counts: all zero, phrase: '' }`
 * for an empty list.
 */
export function summarizeStrokes(
  strokes: readonly { readonly points: readonly Point[] }[],
): InkSummary {
  const counts: Record<InkShapeKind, number> = { box: 0, line: 0, scribble: 0 };
  const classified: { index: number; kind: InkShapeKind; rect: Rect }[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const pts = strokes[i]?.points ?? [];
    if (pts.length === 0) continue;
    const result = recognizeStroke(pts.map((p) => ({ x: p.x, y: p.y })));
    counts[result.kind] += 1;
    /* The BOUNDING BOX of the raw points, not the recognizer's snapped rect:
       a `line` result carries endpoints and a `scribble` carries nothing, so
       the one measurement every kind can supply is the box its ink occupies. */
    classified.push({ index: i, kind: result.kind, rect: boundingBox([...pts]) });
  }
  if (classified.length === 0) {
    return { strokes: [], counts, phrase: '' };
  }
  const outer = boundingBox(
    classified.flatMap((c) => [
      { x: c.rect.x, y: c.rect.y },
      { x: c.rect.x + c.rect.width, y: c.rect.y + c.rect.height },
    ]),
  );
  const summaries: InkStrokeSummary[] = classified.map((c) => ({
    index: c.index,
    kind: c.kind,
    name: INK_SHAPE_NAMES[c.kind].one,
    cell: inkGridCell(
      { x: c.rect.x + c.rect.width / 2, y: c.rect.y + c.rect.height / 2 },
      outer,
    ),
    rect: roundRect(c.rect),
  }));
  return { strokes: summaries, counts, phrase: countPhrase(counts) };
}
