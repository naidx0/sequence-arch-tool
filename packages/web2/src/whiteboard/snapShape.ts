/* ══════════════════════════════════════════════════════════════════════════
   A SNAP OFFER, AS THE CLEAN MARK IT WOULD BECOME
   packages/web2/src/whiteboard/snapShape.ts

   Pure. The offer says which strokes and which shape; this builds the `WbShape`
   (a connector becomes an arrow when the pen drew a head, a line when it did
   not; each end binds to a box it touches) and the words on the offer.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SnapOffer } from './snapSession';
import type { Point, WbItem, WbShape, WbStroke } from './whiteboardModel';

/** How far outside a box an arrow's end may land and still count as touching it. */
export const BIND_REACH = 18;

export const SNAP_WORDS: Record<SnapOffer['decision'], { noun: string; short: string }> = {
  rect: { noun: 'box', short: 'Box' },
  ellipse: { noun: 'ellipse', short: 'Ellipse' },
  diamond: { noun: 'diamond', short: 'Diamond' },
  connector: { noun: 'arrow', short: 'Arrow' },
};

function boxOf(it: WbItem): { x: number; y: number; w: number; h: number } | null {
  if (it.kind !== 'shape' || it.shape === 'arrow' || it.shape === 'line') return null;
  return {
    x: Math.min(it.from.x, it.to.x),
    y: Math.min(it.from.y, it.to.y),
    w: Math.abs(it.to.x - it.from.x),
    h: Math.abs(it.to.y - it.from.y),
  };
}

/** The box an end lands in (or just beside), smallest first so a box inside a box wins. */
export function boxAt(items: readonly WbItem[], at: Point, reach = BIND_REACH): string | undefined {
  let best: { id: string; area: number } | null = null;
  for (const it of items) {
    const b = boxOf(it);
    if (!b) continue;
    if (at.x < b.x - reach || at.x > b.x + b.w + reach || at.y < b.y - reach || at.y > b.y + b.h + reach) continue;
    const area = b.w * b.h;
    if (!best || area < best.area) best = { id: it.id, area };
  }
  return best?.id;
}

/** True when the pen ended away from the farthest point: it went back to draw a head (a plain line ends at its tip, give or take a wobble). */
export function drewAHead(points: readonly Point[], tip: Point): boolean {
  const last = points[points.length - 1];
  const first = points[0];
  if (!last || !first) return false;
  const len = Math.hypot(tip.x - first.x, tip.y - first.y);
  return len > 0 && Math.hypot(last.x - tip.x, last.y - tip.y) > 0.06 * len;
}

export function shapeFromOffer(id: string, offer: SnapOffer, strokes: readonly WbStroke[], existing: readonly WbItem[]): WbShape {
  if (offer.decision !== 'connector') {
    return { kind: 'shape', id, shape: offer.decision === 'rect' ? 'rect' : offer.decision, from: offer.from, to: offer.to };
  }
  const pts = strokes[0]?.points ?? [];
  const out: WbShape = {
    kind: 'shape',
    id,
    shape: drewAHead(pts, offer.to) ? 'arrow' : 'line',
    from: offer.from,
    to: offer.to,
  };
  const fromId = boxAt(existing, offer.from);
  const toId = boxAt(existing, offer.to);
  if (fromId) out.fromId = fromId;
  if (toId && toId !== fromId) out.toId = toId;
  return out;
}
