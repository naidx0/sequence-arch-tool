/* ══════════════════════════════════════════════════════════════════════════
   BOARDS — the pure half: geometry for anchored and bound marks, and the ops a
   change becomes
   packages/web2/src/canvas/boards/boardsModel.ts

   Round 8 (lab/specs/r8-boards.md). Every drawing surface reads and writes one
   server store (`/api/boards`); an agent writes the same store through the
   MCP `draw` tool. This module is the part of that with no I/O: where a mark
   anchored to a node is drawn now, where a bound arrow's ends land, and which
   `put` / `remove` ops turn one document into the next.

   PURE. Values in, values out; the tests pin exact geometry.
   ══════════════════════════════════════════════════════════════════════════ */

import { STICKY_H, STICKY_W, normalizeLegacy, type Point, type WbItem, type WbShape } from '../../whiteboard/whiteboardModel';

export type BoardKind = 'architecture' | 'whiteboard';

export interface BoardMeta {
  id: string;
  name: string;
  kind: BoardKind;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardsIndex {
  version: 1;
  boards: BoardMeta[];
}

export interface BoardDoc {
  version: 1;
  id: string;
  rev: number;
  items: WbItem[];
}

export type BoardOp = { op: 'put'; item: WbItem } | { op: 'remove'; id: string };

export const ARCH_BOARD_ID = 'architecture';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box a mark covers, in its own (unanchored) coordinates. */
export function itemBox(item: WbItem): Box | null {
  switch (item.kind) {
    case 'shape': {
      const xs = [item.from.x, item.to.x, ...(item.points ?? []).map((p) => p.x)];
      const ys = [item.from.y, item.to.y, ...(item.points ?? []).map((p) => p.y)];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'text':
      if (item.sticky) return { x: item.at.x, y: item.at.y, w: item.w ?? STICKY_W, h: item.h ?? STICKY_H };
      return { x: item.at.x, y: item.at.y - 14, w: Math.max(24, item.text.length * 7.5), h: 20 };
    case 'noderef':
      return { x: item.at.x, y: item.at.y - 14, w: Math.max(24, item.label.length * 7), h: 20 };
    case 'artifact':
      return { x: item.at.x, y: item.at.y, w: item.size.w, h: item.size.h };
    case 'svg':
    case 'scene':
    case 'video':
      return { x: item.at.x, y: item.at.y, w: item.w, h: item.h };
    case 'stroke': {
      if (item.points.length === 0) return null;
      const xs = item.points.map((p) => p.x);
      const ys = item.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
}

export function shiftItem<T extends WbItem>(item: T, dx: number, dy: number): T {
  if (dx === 0 && dy === 0) return item;
  const mv = (p: Point): Point => ({ ...p, x: p.x + dx, y: p.y + dy });
  switch (item.kind) {
    case 'stroke':
      return { ...item, points: item.points.map(mv) };
    case 'shape':
      return { ...item, from: mv(item.from), to: mv(item.to), ...(item.points ? { points: item.points.map(mv) } : {}) };
    default:
      return { ...item, at: mv((item as { at: Point }).at) } as T;
  }
}

/**
 * Where a mark is drawn now: an anchored mark moves with its node. A mark
 * whose node is not on the board (another level, a rescan that dropped it)
 * is not drawn — `null` — rather than drawn at the origin, where it would sit
 * beside the wrong thing.
 */
export function placeItem(item: WbItem, nodeBox: (id: string) => Box | null | undefined): WbItem | null {
  if (!item.anchor) return item;
  const box = nodeBox(item.anchor);
  if (!box) return null;
  return shiftItem(item, box.x, box.y);
}

function centre(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Where the segment from the box's centre toward `toward` leaves the box. */
export function boundaryPoint(b: Box, toward: Point): Point {
  const c = centre(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = Math.max(b.w / 2, 0.5);
  const hh = Math.max(b.h / 2, 0.5);
  const t = Math.min(Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * Math.min(t, 1), y: c.y + dy * Math.min(t, 1) };
}

/**
 * A bound arrow's two ends, from where its targets are NOW. An end whose
 * target cannot be found keeps its stored point. A small gap keeps the head
 * off the target's edge.
 */
export function arrowEnds(shape: WbShape, find: (id: string) => Box | null | undefined): { from: Point; to: Point } {
  const a = shape.fromId ? find(shape.fromId) : null;
  const b = shape.toId ? find(shape.toId) : null;
  if (!a && !b) return { from: shape.from, to: shape.to };
  const aim = (box: Box | null | undefined, fallback: Point): Point => (box ? centre(box) : fallback);
  const from = a ? boundaryPoint(pad(a, 4), aim(b, shape.to)) : shape.from;
  const to = b ? boundaryPoint(pad(b, 6), aim(a, shape.from)) : shape.to;
  return { from, to };
}

function pad(b: Box, n: number): Box {
  return { x: b.x - n, y: b.y - n, w: b.w + n * 2, h: b.h + n * 2 };
}

/**
 * Every mark resolved for drawing: anchors applied, bound arrows aimed at
 * their targets (marks on this board first, then node boxes), hidden marks
 * dropped. `hidden` counts what was dropped so the surface can say so.
 */
export function resolveItems(
  items: readonly WbItem[],
  nodeBox: (id: string) => Box | null | undefined = () => null,
): { items: WbItem[]; hidden: number } {
  const placed: WbItem[] = [];
  let hidden = 0;
  for (const it of items) {
    const p = placeItem(it, nodeBox);
    if (p) placed.push(p);
    else hidden += 1;
  }
  const boxes = new Map<string, Box>();
  for (const it of placed) {
    if (it.kind === 'shape' && (it.shape === 'arrow' || it.shape === 'line')) continue;
    const b = itemBox(it);
    if (b) boxes.set(it.id, b);
  }
  const find = (id: string) => boxes.get(id) ?? nodeBox(id) ?? null;
  return {
    hidden,
    items: placed.map((it) =>
      it.kind === 'shape' && (it.fromId || it.toId) ? { ...it, ...arrowEnds(it, find) } : it,
    ),
  };
}

/**
 * When the Spaces surface closes because its list emptied. `had` is the project that last showed a Space: only an
 * emptying of THAT project's list closes the surface. A project opened (or switched to) with none keeps its
 * "No spaces" note, however many Spaces the project before it had.
 */
export function closeAfterEmpty(had: string | null, project: string, count: number): { close: boolean; had: string | null } {
  if (count > 0) return { close: false, had: project };
  return { close: had === project, had: null };
}

/** The ops that turn `prev` into `next`. Artifact frames are not boards' to store. */
/**
 * WHETHER THE BOARD STORE TAKES THE `scene` KIND. It does not yet (its validator refuses unknown kinds), so scenes are
 * kept locally per board (ConnectedWhiteboard) and are not written as ops. The backend adds the kind with the JSON
 * shape in whiteboard/scene.ts, and flips this to true.
 */
export const SCENE_ON_SERVER = false;

/**
 * WHETHER THE STORE TAKES THE `video` KIND AND SERVES ITS FILES. Until it does, a video item is not written as an op (the
 * store's validator would refuse the whole batch and lose the person's other edits with it); it is kept with the
 * board on this machine like a scene is. Flip to true when the backend merges the kind.
 */
export const VIDEO_ON_SERVER = false;

export function diffOps(prev: readonly WbItem[], next: readonly WbItem[]): BoardOp[] {
  const skip = (i: WbItem) => i.kind === 'artifact' || (i.kind === 'scene' && !SCENE_ON_SERVER) || (i.kind === 'video' && !VIDEO_ON_SERVER);
  const before = new Map(prev.filter((i) => !skip(i)).map((i) => [i.id, JSON.stringify(i)]));
  const ops: BoardOp[] = [];
  const seen = new Set<string>();
  for (const it of next) {
    if (skip(it)) continue;
    seen.add(it.id);
    /* A re-saved item is written in the current names (normalizeLegacy), so the store's validator accepts it. */
    if (before.get(it.id) !== JSON.stringify(it)) ops.push({ op: 'put', item: normalizeLegacy(it) });
  }
  for (const id of before.keys()) if (!seen.has(id)) ops.push({ op: 'remove', id });
  return ops;
}

/**
 * What a board is CALLED on screen. A project made before Spaces has its default board stored as "Whiteboard"; the
 * reader's word for one is "Board" (0.1.8.1 C9, audit P2-12: Spaces is the surface, a Board is what is in it), so that
 * untouched default displays as Board. A name the person chose is theirs.
 */
export function boardLabel(b: Pick<BoardMeta, 'id' | 'kind' | 'name'>): string {
  return b.kind === 'whiteboard' && b.id === 'whiteboard' && b.name === 'Whiteboard' ? 'Board' : b.name;
}

/** A name for the next new board: "Board", "Board 2", … Boards already named otherwise keep their names. */
export function nextBoardName(index: BoardsIndex | null): string {
  const names = new Set((index?.boards ?? []).map((b) => boardLabel(b).toLowerCase()));
  if (!names.has('board')) return 'Board';
  let n = 2;
  while (names.has(`board ${n}`)) n += 1;
  return `Board ${n}`;
}
