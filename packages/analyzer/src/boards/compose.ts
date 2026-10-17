/* Compose and build: a flat draw op becomes a stored board item, and a compose op becomes the
   add ops it stands for. Lives in the analyzer so the MCP draw tool and the server's flow
   generator place diagrams with the SAME logic. */
import { ARROWHEADS, DASHES, FONT_SIZES, LABEL_POSITIONS } from './boardPalette.js';
import { BoardError, type BoardItem } from './boardStore.js';

/** The flat fields a draw op speaks (the MCP zod shape is assignable to this). */
export interface DrawOp {
  op: 'add' | 'update' | 'remove' | 'compose';
  id?: string;
  type?: 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'path' | 'frame' | 'text' | 'sticky' | 'svg' | 'video' | 'scene';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  from?: string;
  to?: string;
  anchor?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: (typeof DASHES)[number];
  arrowStart?: (typeof ARROWHEADS)[number];
  arrowEnd?: (typeof ARROWHEADS)[number];
  points?: unknown[];
  labelPos?: (typeof LABEL_POSITIONS)[number];
  fontSize?: (typeof FONT_SIZES)[number];
  group?: string;
  ownTheme?: boolean;
  svg?: string;
  src?: string;
  poster?: string;
  keyframes?: unknown[];
  duration?: number;
  fps?: number;
  easing?: string;
  layout?: 'row' | 'column' | 'grid';
  gap?: number;
  columns?: number;
  items?: Record<string, unknown>[];
  connect?: number[][];
}

export const SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 160, h: 72 },
  ellipse: { w: 140, h: 80 },
  diamond: { w: 140, h: 96 },
  sticky: { w: 180, h: 110 },
  frame: { w: 320, h: 200 },
  text: { w: 120, h: 24 },
  svg: { w: 240, h: 240 },
  video: { w: 320, h: 180 },
  scene: { w: 480, h: 300 },
};

/** The width of an architecture card in board units (web2 CARD_W). */
export const NODE_CARD_W = 160;

export const STYLE_KEYS = ['stroke', 'fill', 'strokeWidth', 'dash', 'arrowStart', 'arrowEnd', 'labelPos', 'fontSize', 'ownTheme'] as const;

/** Path vertices as [x, y] pairs or {x, y} objects (both accepted); null when any is neither. */
function toPoints(raw: unknown[]): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number') out.push({ x: p[0], y: p[1] });
    else if (p && typeof p === 'object' && typeof (p as { x?: unknown }).x === 'number' && typeof (p as { y?: unknown }).y === 'number') out.push({ x: (p as { x: number }).x, y: (p as { y: number }).y });
    else return null;
  }
  return out;
}

/** A keyframe as an object, or as the compact array [t, target, x?, y?, scale?, opacity?]. */
function keyframeOf(k: unknown): unknown {
  if (!Array.isArray(k)) return k;
  const [t, target, x, y, scale, opacity] = k;
  return { t, target, ...(x != null ? { x } : {}), ...(y != null ? { y } : {}), ...(scale != null ? { scale } : {}), ...(opacity != null ? { opacity } : {}) };
}

/** The style fields of an op, only those given. */
export function styleOf(o: Partial<DrawOp>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) if (o[k] !== undefined) s[k] = o[k];
  return s;
}

/**
 * Build the stored item from flat fields. Refusals are thrown as BoardError
 * with the op's index so an agent can fix the one it got wrong.
 */
export function buildItem(o: Partial<DrawOp> & { id: string }, where: string, anchored: boolean): BoardItem {
  const type = o.type;
  if (!type) throw new BoardError(`${where}: type is required to add (rect, ellipse, diamond, arrow, line, path, frame, text, sticky, svg, video, scene)`);
  const by = 'agent' as const;
  const anchor = o.anchor ? { anchor: o.anchor } : {};
  const group = o.group ? { group: o.group } : {};
  /* Anchored without a position: just right of the card, top-aligned. */
  const x = o.x ?? (anchored ? NODE_CARD_W + 24 : undefined);
  const y = o.y ?? (anchored ? 0 : undefined);
  if (type === 'arrow' || type === 'line') {
    const bound = o.from && o.to;
    if (!bound && (x === undefined || y === undefined || o.w === undefined || o.h === undefined)) {
      throw new BoardError(`${where}: an ${type} needs from and to ids, or x, y, w, h (w/h is the vector to its end)`);
    }
    const fx = x ?? 0;
    const fy = y ?? 0;
    return {
      kind: 'shape',
      id: o.id,
      by,
      ...anchor,
      ...group,
      shape: type,
      from: { x: fx, y: fy },
      to: { x: fx + (o.w ?? 0), y: fy + (o.h ?? 0) },
      ...(o.text ? { label: o.text } : {}),
      ...(o.from ? { fromId: o.from } : {}),
      ...(o.to ? { toId: o.to } : {}),
      ...styleOf(o),
    } as BoardItem;
  }
  if (type === 'path') {
    const pts = o.points ? toPoints(o.points) : null;
    if (!pts || pts.length < 2) throw new BoardError(`${where}: a path needs points: at least two [x, y] pairs or {x, y} objects`);
    return {
      kind: 'shape',
      id: o.id,
      by,
      ...anchor,
      ...group,
      shape: 'path',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      points: pts,
      ...(o.text ? { label: o.text } : {}),
      ...styleOf(o),
    } as BoardItem;
  }
  if (x === undefined || y === undefined) throw new BoardError(`${where}: x and y are required (or an anchor)`);
  if (type === 'text') {
    if (!o.text) throw new BoardError(`${where}: text needs text`);
    return {
      kind: 'text',
      id: o.id,
      by,
      ...anchor,
      ...group,
      at: { x, y },
      text: o.text,
      ...(o.stroke ? { color: o.stroke } : {}),
      ...(o.fontSize ? { fontSize: o.fontSize } : {}),
      ...(o.ownTheme ? { ownTheme: true } : {}),
    } as BoardItem;
  }
  if (type === 'sticky') {
    return {
      kind: 'text',
      sticky: true,
      id: o.id,
      by,
      ...anchor,
      ...group,
      at: { x, y },
      text: o.text ?? '',
      w: o.w ?? SIZES.sticky!.w,
      h: o.h ?? SIZES.sticky!.h,
      ...(o.stroke ? { color: o.stroke } : {}),
      ...(o.fontSize ? { fontSize: o.fontSize } : {}),
      ...(o.ownTheme ? { ownTheme: true } : {}),
    } as BoardItem;
  }
  if (type === 'svg') {
    if (!o.svg) throw new BoardError(`${where}: an svg needs svg markup`);
    return {
      kind: 'svg',
      id: o.id,
      by,
      ...anchor,
      ...group,
      at: { x, y },
      w: o.w ?? SIZES.svg!.w,
      h: o.h ?? SIZES.svg!.h,
      svg: o.svg,
      ...(o.text ? { label: o.text } : {}),
    } as BoardItem;
  }
  if (type === 'video') {
    if (!o.src) throw new BoardError(`${where}: a video needs src (a project-relative .mp4/.webm/.gif path)`);
    return {
      kind: 'video',
      id: o.id,
      by,
      ...anchor,
      ...group,
      at: { x, y },
      w: o.w ?? SIZES.video!.w,
      h: o.h ?? SIZES.video!.h,
      src: o.src,
      ...(o.poster ? { poster: o.poster } : {}),
      ...(o.text ? { label: o.text } : {}),
    } as BoardItem;
  }
  if (type === 'scene') {
    if (o.duration === undefined) throw new BoardError(`${where}: a scene needs duration (ms) and keyframes [{t, target, x, y, scale, opacity, text}]`);
    return {
      kind: 'scene',
      id: o.id,
      by,
      ...anchor,
      ...group,
      at: { x, y },
      w: o.w ?? SIZES.scene!.w,
      h: o.h ?? SIZES.scene!.h,
      duration: o.duration,
      keyframes: (o.keyframes ?? []).map(keyframeOf),
      ...(o.fps !== undefined ? { fps: o.fps } : {}),
      ...(o.easing ? { easing: o.easing } : {}),
      ...(o.text ? { title: o.text } : {}),
      ...(o.ownTheme ? { ownTheme: true } : {}),
    } as BoardItem;
  }
  const size = SIZES[type]!;
  return {
    kind: 'shape',
    id: o.id,
    by,
    ...anchor,
    ...group,
    shape: type,
    from: { x, y },
    to: { x: x + (o.w ?? size.w), y: y + (o.h ?? size.h) },
    ...(o.text ? { label: o.text } : {}),
    ...styleOf(o),
  } as BoardItem;
}

/* ── compose: a diagram in one call ──────────────────────────────────── */

const FRAME_PAD = 24;
const FRAME_TITLE = 36;

interface Placed {
  op: DrawOp;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a line from the centre of `a` to the centre of `b` leaves `a` (and enters `b`). */
export function edgePoint(r: { x: number; y: number; w: number; h: number }, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Expand a `compose` op into plain `add` ops: a frame (when `text` is given)
 * sized to fit its children, the children placed on a row/column/grid with
 * `gap` between them and padding inside the frame, and an arrow for every
 * `connect` pair. Deterministic: same input, same boxes. Children are laid out
 * by their (default or given) w and h, so none can overlap.
 */
/** The bounding box of what is on a board, for placing a new diagram beside it. */
export function boardBounds(items: readonly BoardItem[]): { minY: number; maxX: number; maxY: number } | null {
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    if (it.anchor) continue;
    let x2: number;
    let y1: number;
    let y2: number;
    if (it.kind === 'shape') {
      x2 = Math.max(it.from.x, it.to.x);
      y1 = Math.min(it.from.y, it.to.y);
      y2 = Math.max(it.from.y, it.to.y);
    } else if (it.kind === 'stroke') {
      x2 = Math.max(...it.points.map((p) => p.x));
      y1 = Math.min(...it.points.map((p) => p.y));
      y2 = Math.max(...it.points.map((p) => p.y));
    } else if (it.kind === 'svg' || it.kind === 'video' || it.kind === 'scene') {
      x2 = it.at.x + it.w;
      y1 = it.at.y;
      y2 = it.at.y + it.h;
    } else {
      x2 = it.at.x + (it.kind === 'text' ? (it.w ?? SIZES.text!.w) : 160);
      y1 = it.at.y;
      y2 = it.at.y + (it.kind === 'text' ? (it.h ?? SIZES.text!.h) : 72);
    }
    maxX = Math.max(maxX, x2);
    minY = Math.min(minY, y1);
    maxY = Math.max(maxY, y2);
  }
  return Number.isFinite(maxX) ? { minY, maxX, maxY } : null;
}

export function composeOps(op: DrawOp, freshId: (type: string) => string, where: string, existing: readonly BoardItem[] = []): DrawOp[] {
  const kids = op.items ?? [];
  if (kids.length === 0) throw new BoardError(`${where}: compose needs items`);
  const layout = op.layout ?? 'row';
  const gap = op.gap ?? 24;
  if (!Number.isFinite(gap) || gap < 0) throw new BoardError(`${where}: gap must be 0 or more (got ${op.gap})`);
  if (op.columns !== undefined && (!Number.isInteger(op.columns) || op.columns < 1)) {
    throw new BoardError(`${where}: columns must be a whole number of 1 or more (got ${op.columns})`);
  }
  /* No x,y: beside whatever is already on the board (to its right, top-aligned), never on top of it. */
  const bounds = op.x === undefined || op.y === undefined ? boardBounds(existing) : null;
  /* Neither given: right of everything, top-aligned. Only x given: below everything. Only y given: right of everything. */
  const ox = op.x ?? (bounds ? bounds.maxX + 80 : 0);
  const oy = op.y ?? (bounds ? (op.x !== undefined ? bounds.maxY + 80 : bounds.minY) : 0);
  const titled = Boolean(op.text);
  const group = op.group ?? freshId('group');
  const padTop = titled ? FRAME_TITLE : FRAME_PAD;
  const placed: Placed[] = kids.map((k, i) => {
    const kid = k as Partial<DrawOp>;
    const type = kid.type ?? 'rect';
    if (type === 'arrow' || type === 'line' || type === 'path') {
      throw new BoardError(`${where}.items[${i}]: items are boxes (rect, ellipse, diamond, sticky, text, svg, frame); join them with connect`);
    }
    const size = SIZES[type] ?? SIZES.rect!;
    for (const dim of ['w', 'h'] as const) {
      if (kid[dim] !== undefined && !(Number.isFinite(kid[dim]) && kid[dim]! > 0)) throw new BoardError(`${where}.items[${i}]: ${dim} must be above 0 (got ${kid[dim]})`);
    }
    return { op: { ...kid, op: 'add', type } as DrawOp, x: 0, y: 0, w: kid.w ?? size.w, h: kid.h ?? size.h };
  });
  const cols = layout === 'row' ? placed.length : layout === 'column' ? 1 : Math.max(1, op.columns ?? Math.ceil(Math.sqrt(placed.length)));
  const rows = Math.ceil(placed.length / cols);
  const colW = Array.from({ length: cols }, () => 0);
  const rowH = Array.from({ length: rows }, () => 0);
  placed.forEach((p, i) => {
    colW[i % cols] = Math.max(colW[i % cols]!, p.w);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)]!, p.h);
  });
  const colX: number[] = [];
  let acc = ox + FRAME_PAD;
  for (const w of colW) {
    colX.push(acc);
    acc += w + gap;
  }
  const rowY: number[] = [];
  acc = oy + padTop;
  for (const h of rowH) {
    rowY.push(acc);
    acc += h + gap;
  }
  placed.forEach((p, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    /* centred inside its cell */
    p.x = colX[c]! + (colW[c]! - p.w) / 2;
    p.y = rowY[r]! + (rowH[r]! - p.h) / 2;
  });
  const innerW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  const innerH = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);
  const out: DrawOp[] = [];
  if (titled) {
    out.push({
      op: 'add',
      type: 'frame',
      id: freshId('frame'),
      x: ox,
      y: oy,
      w: innerW + FRAME_PAD * 2,
      h: innerH + padTop + FRAME_PAD,
      text: op.text,
      group,
      ...styleOf(op),
    });
  }
  placed.forEach((p) => {
    const id = p.op.id ?? freshId(p.op.type ?? 'item');
    p.op = { ...p.op, id, x: p.x, y: p.y, w: p.w, h: p.h, group };
    out.push(p.op);
  });
  for (const pair of op.connect ?? []) {
    const [i, j] = pair as [number, number];
    const a = placed[i!];
    const b = placed[j!];
    if (pair.length !== 2 || !a || !b || i === j) throw new BoardError(`${where}.connect: [${i}, ${j}] must name two different items (0 to ${placed.length - 1})`);
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const s = edgePoint(a, cb);
    const e = edgePoint(b, ca);
    out.push({ op: 'add', type: 'arrow', id: freshId('arrow'), x: s.x, y: s.y, w: e.x - s.x, h: e.y - s.y, from: a.op.id, to: b.op.id, arrowEnd: 'arrow', group });
  }
  return out;
}

