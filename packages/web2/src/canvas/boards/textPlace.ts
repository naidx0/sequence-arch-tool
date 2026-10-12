/* Text-mark placement for the architecture board's drawing layer. Its own
   module so it loads with ArchDraw (lazy), not with the board at boot. */

import type { WbItem } from '../../whiteboard/whiteboardModel';
import { itemBox, type Box } from './boardsModel';

type Point = { x: number; y: number };

/* ── A TEXT MARK NEVER SITS ON A CONNECTION LINE ─────────────────────────
   Coordinator review of r8-board-1-draw: "Checkout core" was printed across
   a connector. The edge tags already obey this (edgeLabelPlace.ts); a text
   mark now does too, at render, so it holds when the layout moves the lines
   under it and for an agent's text as much as a person's. The mark keeps its
   stored place and is DRAWN at the nearest spot (in growing rings, up and
   down first) whose box touches no connector and no card. */

export type Line = readonly { x: number; y: number }[];

/** Polylines out of the router's path data ("M x y L x y …"). */
export function linesFromPaths(paths: readonly string[]): Line[] {
  return paths.map((d) => {
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
    return pts;
  });
}

function segHits(p: Point, q: Point, r: Box): boolean {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [pp, qq] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ] as const) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Is this box clear of every connector and every card? */
export function boxIsClear(box: Box, lines: readonly Line[], cards: readonly Box[]): boolean {
  for (const l of lines) for (let i = 1; i < l.length; i++) if (segHits(l[i - 1]!, l[i]!, box)) return false;
  for (const c of cards) if (overlaps(box, c)) return false;
  return true;
}

/** How far a text mark may move to get clear (coordinator ruling, round 8). */
export const TEXT_NUDGE_MAX = 24;

/**
 * Where to draw a text mark so it is legible: the nearest offset within
 * {@link TEXT_NUDGE_MAX} whose box touches no connector and no card,
 * preferring spots inside the shape the text belongs to (`owner`). A label
 * that drifts away from its rectangle reads worse than one on a line, so
 * when nothing near is clear it stays where it was put and is drawn on a
 * plate (`plate: true`) instead.
 */
export function placeTextMark(
  box: Box,
  lines: readonly Line[],
  cards: readonly Box[],
  owner: Box | null = null,
): { x: number; y: number; plate: boolean } {
  if (boxIsClear(box, lines, cards)) return { x: 0, y: 0, plate: false };
  const inside = (b: Box) => !!owner && b.x >= owner.x - 2 && b.y >= owner.y - 2 && b.x + b.w <= owner.x + owner.w + 2 && b.y + b.h <= owner.y + owner.h + 2;
  const tries: { x: number; y: number; d: number; home: number }[] = [];
  for (let dx = -TEXT_NUDGE_MAX; dx <= TEXT_NUDGE_MAX; dx += 4) {
    for (let dy = -TEXT_NUDGE_MAX; dy <= TEXT_NUDGE_MAX; dy += 4) {
      const d = Math.hypot(dx, dy);
      if (d === 0 || d > TEXT_NUDGE_MAX) continue;
      tries.push({ x: dx, y: dy, d, home: inside({ ...box, x: box.x + dx, y: box.y + dy }) ? 0 : 1 });
    }
  }
  tries.sort((a, b) => a.home - b.home || a.d - b.d || Math.abs(a.x) - Math.abs(b.x));
  for (const t of tries) if (boxIsClear({ ...box, x: box.x + t.x, y: box.y + t.y }, lines, cards)) return { x: t.x, y: t.y, plate: false };
  return { x: 0, y: 0, plate: true };
}

/** The shape a text mark belongs to: the smallest rectangle or ellipse it sits in or on the edge of. */
export function ownerShape(text: Box, items: readonly WbItem[]): Box | null {
  let best: Box | null = null;
  for (const it of items) {
    if (it.kind !== 'shape' || (it.shape !== 'rect' && it.shape !== 'ellipse')) continue;
    const b = itemBox(it);
    if (!b) continue;
    const pad = TEXT_NUDGE_MAX;
    const near = text.x >= b.x - pad && text.y >= b.y - pad && text.x <= b.x + b.w + pad && text.y <= b.y + b.h + pad;
    if (near && (!best || b.w * b.h < best.w * best.h)) best = b;
  }
  return best;
}

/** A text mark's painted box at 14px (archDraw.css .annot-text): baseline-up from `at`. */
export function textMarkBox(at: Point, text: string): Box {
  return { x: at.x - 2, y: at.y - 20, w: text.length * 8 + 4, h: 22 };
}
