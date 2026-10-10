/* ══════════════════════════════════════════════════════════════════════════
   EDGE LABELS NEVER OVERPRINT — placed for the whole board at once
   packages/web2/src/canvas/edgeLabelPlace.ts

   Round 7 (coordinator review of r7-board-1-drag on the ML harness copy): with
   a card dragged, "/api/evidence?th… +17 more" and "/… +2 more" printed over
   each other and over a connector, because every tag was put at the midpoint of
   its route's longest segment with no regard for anything else on the board.

   Now each tag is placed after every route is known: it tries points along its
   own route, longest segment first (mid, then towards either end), beside the
   line and then on it, and takes the first whose box touches no tag already
   placed, no card and no other connector. A tag with no free place becomes a
   "+N" chip (N facts behind it, the whole label on hover) placed by the same
   rule; a chip with no free place is not drawn, and the label stays on the
   connector's own hover. Nothing overprints.

   The box is estimated from the type, not measured: --t-10 mono at 0.6em a
   glyph, plus the 3px knock-out stroke. The estimate errs wide.
   ══════════════════════════════════════════════════════════════════════════ */

type Pt = { x: number; y: number };
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  container?: boolean;
}

export const TAG_GLYPH_W = 6.1;
export const TAG_H = 14;
const PAD = 2;
/** A group frame's header band: a tag there would sit on the group's name. */
const HEADER_H = 36;

export function tagWidth(text: string): number {
  return text.length * TAG_GLYPH_W + 6;
}

export interface LabelInput {
  id: string;
  points: readonly Pt[];
  label: string;
  full?: string;
}

export interface LabelPlacement {
  at: Pt;
  text: string;
  full?: string;
  mode: 'full' | 'chip';
}

const rectOf = (c: Pt, w: number, h: number): Rect => ({
  x0: c.x - w / 2 - PAD,
  y0: c.y - h / 2 - PAD,
  x1: c.x + w / 2 + PAD,
  y1: c.y + h / 2 + PAD,
});
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Does segment p-q cross rect r (Liang-Barsky clip)? */
export function segmentHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: Array<[number, number]> = [
    [-dx, p.x - r.x0],
    [dx, r.x1 - p.x],
    [-dy, p.y - r.y0],
    [dy, r.y1 - p.y],
  ];
  for (const [pp, qq] of edges) {
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

/** How many facts a label stands for: its comma parts, or its "+N more". */
export function factCount(label: string, full?: string): number {
  if (full) return full.split(', ').filter(Boolean).length;
  const more = label.match(/\+(\d+) more$/);
  return more ? Number(more[1]) + 1 : 1;
}

function candidates(points: readonly Pt[], w: number): Pt[] {
  const segs: Array<{ a: Pt; b: Pt; len: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    segs.push({ a, b, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) });
  }
  segs.sort((s, t) => t.len - s.len);
  const out: Pt[] = [];
  for (const { a, b } of segs) {
    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      /* BESIDE the line first, then on it: a tag laid over its own line reads
         as "read-a-+72-more", because the knock-out stroke covers glyphs and
         not the spaces between words. */
      if (vertical) {
        out.push({ x: c.x + w / 2 + 6, y: c.y }, { x: c.x - w / 2 - 6, y: c.y });
      } else {
        out.push({ x: c.x, y: c.y - TAG_H / 2 - 4 }, { x: c.x, y: c.y + TAG_H / 2 + 4 });
      }
      out.push(c);
    }
  }
  return out;
}

/**
 * Places every label. `routes` are ALL the board's routes (labelled or not),
 * since every connector is something a tag must not sit on.
 */
export function placeEdgeLabels(
  labels: readonly LabelInput[],
  routes: ReadonlyArray<{ id: string; points: readonly Pt[] }>,
  boxes: readonly Box[],
): Map<string, LabelPlacement> {
  const blocks: Rect[] = [];
  for (const b of boxes) {
    if (b.container) blocks.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + Math.min(HEADER_H, b.h) });
    else blocks.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
  }
  const placed: Rect[] = [];
  const out = new Map<string, LabelPlacement>();
  const free = (id: string, r: Rect) => {
    if (placed.some((p) => hit(p, r))) return false;
    if (blocks.some((b) => hit(b, r))) return false;
    for (const route of routes) {
      if (route.id === id) continue;
      for (let i = 0; i < route.points.length - 1; i++) {
        if (segmentHitsRect(route.points[i]!, route.points[i + 1]!, r)) return false;
      }
    }
    return true;
  };
  for (const item of labels) {
    const tries: Array<{ text: string; mode: 'full' | 'chip' }> = [
      { text: item.label, mode: 'full' },
      /* A one-fact label has nothing to count, so its chip is an ellipsis. */
      { text: factCount(item.label, item.full) > 1 ? `+${factCount(item.label, item.full)}` : '…', mode: 'chip' },
    ];
    for (const attempt of tries) {
      const w = tagWidth(attempt.text);
      const spot = candidates(item.points, w).find((c) => free(item.id, rectOf(c, w, TAG_H)));
      if (!spot) continue;
      placed.push(rectOf(spot, w, TAG_H));
      out.set(item.id, {
        at: spot,
        text: attempt.text,
        mode: attempt.mode,
        ...(attempt.mode === 'chip' ? { full: item.full ?? item.label } : item.full ? { full: item.full } : {}),
      });
      break;
    }
  }
  return out;
}
