/**
 * Site-shaped orthogonal elbows for Architecture, agentic tree, and Whiteboard Connect.
 *
 * SITE today (`site/demo.js`): Ledger cards on one board; `edgeEndpoints` picks a
 * side from dx/dy (not fixed L→R); path `d` is still cubic `C` (horizontal
 * tangents). Whiteboard Connect is a straight `<line>` between ink boxes; the
 * arrow tool is freehand, not the connector. Agentic steps drop Heartbeat /
 * researcher / builder / verifier / task cards on that same board.
 *
 * PRODUCT today: Architecture `defaultEdgeOptions type: 'default'` = cubic
 * bezier, handles Left/Right only. ProgramGraph `getBezierPath` + kanban /
 * harness list are monitors, not the graph. Interior how-it-works already
 * routes H/V gutters (`layoutComponentInterior`) — reuse that idea.
 *
 * THIS MODULE: H/V polylines, round join/cap in CSS, closed triangle marker
 * elsewhere. Fan shared sides. Detour a side lane instead of cutting a foreign
 * card. Family stroke colors stay on the edge class, not here.
 */

export type ElbowSide = 'top' | 'right' | 'bottom' | 'left';

export interface ElbowBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElbowPoint {
  x: number;
  y: number;
}

export interface ElbowSibling {
  id: string;
  source: string;
  target: string;
}

export const ELBOW_STUB = 16;
export const ELBOW_GAP = 12;
const EPS = 0.5;

export function pickSides(a: ElbowBox, b: ElbowBox): { from: ElbowSide; to: ElbowSide } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

/** Spread 0..1 along a shared side. One edge sits at mid (0.5). */
export function fanT(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const t = (index + 1) / (count + 1);
  return Math.min(0.82, Math.max(0.18, t));
}

export function sidePoint(box: ElbowBox, side: ElbowSide, t: number): ElbowPoint {
  const u = Math.min(0.85, Math.max(0.15, t));
  switch (side) {
    case 'top':
      return { x: box.x + box.w * u, y: box.y };
    case 'bottom':
      return { x: box.x + box.w * u, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: box.y + box.h * u };
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h * u };
  }
}

export function stubPoint(side: ElbowSide, p: ElbowPoint, len = ELBOW_STUB): ElbowPoint {
  switch (side) {
    case 'top':
      return { x: p.x, y: p.y - len };
    case 'bottom':
      return { x: p.x, y: p.y + len };
    case 'left':
      return { x: p.x - len, y: p.y };
    case 'right':
      return { x: p.x + len, y: p.y };
  }
}

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

export function simplifyOrthogonal(points: ElbowPoint[]): ElbowPoint[] {
  const cleaned: ElbowPoint[] = [];
  for (const p of points) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && nearly(prev.x, p.x) && nearly(prev.y, p.y)) continue;
    cleaned.push({ x: p.x, y: p.y });
  }
  const out: ElbowPoint[] = [];
  for (const p of cleaned) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (a && b && ((nearly(a.x, b.x) && nearly(b.x, p.x)) || (nearly(a.y, b.y) && nearly(b.y, p.y)))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** H/V elbow: stubs, then one mid gutter, then stubs. Never a diagonal. */
export function elbowPoints(
  from: ElbowPoint,
  fromSide: ElbowSide,
  to: ElbowPoint,
  toSide: ElbowSide,
): ElbowPoint[] {
  const a = stubPoint(fromSide, from);
  const b = stubPoint(toSide, to);
  const fromH = fromSide === 'left' || fromSide === 'right';
  const toH = toSide === 'left' || toSide === 'right';

  let mid: ElbowPoint[];
  if (fromH && toH) {
    const midX = (a.x + b.x) / 2;
    mid = [
      { x: midX, y: a.y },
      { x: midX, y: b.y },
    ];
  } else if (!fromH && !toH) {
    const midY = (a.y + b.y) / 2;
    mid = [
      { x: a.x, y: midY },
      { x: b.x, y: midY },
    ];
  } else if (fromH) {
    mid = [{ x: b.x, y: a.y }];
  } else {
    mid = [{ x: a.x, y: b.y }];
  }

  return simplifyOrthogonal([from, a, ...mid, b, to]);
}

function inflate(box: ElbowBox, pad: number): ElbowBox {
  return { id: box.id, x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function segmentHitsBox(p: ElbowPoint, q: ElbowPoint, box: ElbowBox): boolean {
  const minX = Math.min(p.x, q.x);
  const maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y);
  const maxY = Math.max(p.y, q.y);
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.w;
  const y1 = box.y + box.h;
  return minX < x1 - EPS && maxX > x0 + EPS && minY < y1 - EPS && maxY > y0 + EPS;
}

export function polylineHitsBox(points: ElbowPoint[], box: ElbowBox, skipStubs = false): boolean {
  if (points.length < 2) return false;
  const canSkip = skipStubs && points.length >= 4;
  const start = canSkip ? 1 : 0;
  const end = canSkip ? points.length - 2 : points.length - 1;
  for (let i = start; i < end; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (segmentHitsBox(a, b, box)) return true;
  }
  return false;
}

function unionBox(boxes: ElbowBox[]): ElbowBox | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { id: 'union', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * If the simple elbow cuts a foreign card, run a side lane around the obstacle
 * union — same idea as `layoutComponentInterior` far-row lanes.
 */
export function avoidObstacles(
  points: ElbowPoint[],
  from: ElbowPoint,
  fromSide: ElbowSide,
  to: ElbowPoint,
  toSide: ElbowSide,
  obstacles: ElbowBox[],
): ElbowPoint[] {
  const hits = obstacles.filter((b) => polylineHitsBox(points, inflate(b, ELBOW_GAP / 2), true));
  if (hits.length === 0) return points;
  const hull = unionBox(hits.map((b) => inflate(b, ELBOW_GAP)));
  if (!hull) return points;

  const a = stubPoint(fromSide, from);
  const b = stubPoint(toSide, to);
  const fromH = fromSide === 'left' || fromSide === 'right';
  const preferBelow = (a.y + b.y) / 2 >= hull.y + hull.h / 2;
  const laneY = preferBelow ? hull.y + hull.h + ELBOW_GAP : hull.y - ELBOW_GAP;
  const yDetour = simplifyOrthogonal([from, a, { x: a.x, y: laneY }, { x: b.x, y: laneY }, b, to]);
  const yClear = !obstacles.some((ob) => polylineHitsBox(yDetour, inflate(ob, ELBOW_GAP / 2), true));
  if (fromH || yClear) {
    if (yClear) return yDetour;
  }

  const preferRight = (a.x + b.x) / 2 >= hull.x + hull.w / 2;
  const laneX = preferRight ? hull.x + hull.w + ELBOW_GAP : hull.x - ELBOW_GAP;
  return simplifyOrthogonal([from, a, { x: laneX, y: a.y }, { x: laneX, y: b.y }, b, to]);
}

/* Item 3.2 lifted this module byte-identical and handed back four TS6133
   diagnostics for a ruling, because web2 sets noUnusedLocals and packages/web
   does not: `pnpm --filter @sequence/web2 build` is red until they are settled.
   RULED (Wave 3, board lane): an UNEXPORTED, UNREFERENCED `sideKey(nodeId,
   side)` stood here — one occurrence in the file, its own declaration. It is
   unreachable by construction, so deleting it is provably zero behaviour
   change, and shipping a package whose build is red for a dead private helper
   is the worse of the two costs. The lift is no longer byte-identical, at
   exactly this point and at orthogonalElbow.test.ts:2-4,17-18. */

export function fanIndexFor(
  edgeId: string,
  nodeId: string,
  side: ElbowSide,
  siblings: readonly ElbowSibling[],
  boxes: ReadonlyMap<string, ElbowBox>,
): { index: number; count: number } {
  const group: string[] = [];
  for (const e of siblings) {
    const src = boxes.get(e.source);
    const dst = boxes.get(e.target);
    if (!src || !dst) continue;
    const sides = pickSides(src, dst);
    const onFrom = e.source === nodeId && sides.from === side;
    const onTo = e.target === nodeId && sides.to === side;
    if (onFrom || onTo) group.push(e.id);
  }
  group.sort();
  const index = Math.max(0, group.indexOf(edgeId));
  return { index, count: Math.max(1, group.length) };
}

export function routeOrthogonalElbow(opts: {
  source: ElbowBox;
  target: ElbowBox;
  obstacles: readonly ElbowBox[];
  edgeId: string;
  siblings: readonly ElbowSibling[];
}): ElbowPoint[] {
  const { source, target, edgeId, siblings } = opts;
  const sides = pickSides(source, target);
  const boxMap = new Map(opts.obstacles.map((b) => [b.id, b]));
  boxMap.set(source.id, source);
  boxMap.set(target.id, target);
  const fromFan = fanIndexFor(edgeId, source.id, sides.from, siblings, boxMap);
  const toFan = fanIndexFor(edgeId, target.id, sides.to, siblings, boxMap);
  const from = sidePoint(source, sides.from, fanT(fromFan.index, fromFan.count));
  const to = sidePoint(target, sides.to, fanT(toFan.index, toFan.count));
  const simple = elbowPoints(from, sides.from, to, sides.to);
  const foreign = opts.obstacles.filter((b) => b.id !== source.id && b.id !== target.id);
  return avoidObstacles(simple, from, sides.from, to, sides.to, foreign);
}

export function routeBetweenRects(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
  obstacles: readonly ElbowBox[] = [],
  edgeId = 'preview',
): ElbowPoint[] {
  return routeOrthogonalElbow({
    source: { id: 'from', x: from.x, y: from.y, w: from.width, h: from.height },
    target: { id: 'to', x: to.x, y: to.y, w: to.width, h: to.height },
    obstacles,
    edgeId,
    siblings: [{ id: edgeId, source: 'from', target: 'to' }],
  });
}

export function polylinePathD(points: ElbowPoint[]): string {
  const pts = simplifyOrthogonal(points);
  if (pts.length === 0) return '';
  const first = pts[0]!;
  let d = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    d += ` L${round(p.x)} ${round(p.y)}`;
  }
  return d;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

const CURVE_CMD = /[CQSTcqsta]/;

/** Owner lock: no cubic/quadratic, no diagonal segments. */
/**
 * Where an edge label sits — Console sheet 23: "label sits ON the segment,
 * knocked out of the line — never over a node".
 *
 * The midpoint of the LONGEST segment, not the middle point of the polyline.
 * The middle point of an elbow is a BEND, and a bend is by construction the part
 * of the route closest to a card, so anchoring there is what pushed labels on top
 * of node cards. The longest run is the open channel between two columns.
 */
export function polylineLabelAnchor(points: ElbowPoint[]): ElbowPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!;
  let best: ElbowPoint | null = null;
  let bestLen = -1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

export function pathIsOrthogonalElbow(d: string): boolean {
  if (!d || CURVE_CMD.test(d)) return false;
  const nums = d
    .replace(/[MmLl]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length < 4 || nums.length % 2 !== 0) return false;
  let hasElbow = false;
  for (let i = 2; i < nums.length; i += 2) {
    const x0 = nums[i - 2]!;
    const y0 = nums[i - 1]!;
    const x1 = nums[i]!;
    const y1 = nums[i + 1]!;
    const horiz = nearly(y0, y1) && !nearly(x0, x1);
    const vert = nearly(x0, x1) && !nearly(y0, y1);
    if (!horiz && !vert) {
      if (nearly(x0, x1) && nearly(y0, y1)) continue;
      return false;
    }
    if (horiz || vert) hasElbow = true;
  }
  return hasElbow || nums.length === 4;
}

export function pathHasElbowCorner(d: string): boolean {
  if (!pathIsOrthogonalElbow(d)) return false;
  const nums = d
    .replace(/[MmLl]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  let horiz = false;
  let vert = false;
  for (let i = 2; i < nums.length; i += 2) {
    const x0 = nums[i - 2]!;
    const y0 = nums[i - 1]!;
    const x1 = nums[i]!;
    const y1 = nums[i + 1]!;
    if (nearly(y0, y1) && !nearly(x0, x1)) horiz = true;
    if (nearly(x0, x1) && !nearly(y0, y1)) vert = true;
  }
  return horiz && vert;
}
