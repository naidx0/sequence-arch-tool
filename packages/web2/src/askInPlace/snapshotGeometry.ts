/* The geometry of a snapshot crop (pure). packages/web2/src/askInPlace/snapshotGeometry.ts
   Split from snapshot.ts so the board's boot chunk carries these few boxes and not the two renderers
   (0.1.4 integrate, perf ratchet): snapshot.ts is imported when a crop is taken. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Widest crop, in pixels. */
export const SNAPSHOT_MAX_W = 800;
/** Context kept round the selection, in the surface's own pixels. */
export const SNAPSHOT_PAD = 48;
/** Output pixels per source pixel for a small crop (the architecture crop is 2x as well); the width cap still wins. */
export const SNAPSHOT_SCALE = 2;
/** How long a crop may take before the message goes without it. */
export const SNAPSHOT_TIMEOUT_MS = 4000;
/** A crop never gets smaller than this: one tiny arrow needs its neighbours to mean anything. */
export const SNAPSHOT_MIN = 240;

/** The union of boxes; null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
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
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The region to capture: the selection grown by `pad`, no smaller than `min`
 * either way (kept centred), then slid back inside `bounds` when the board's
 * visible area is known. A region larger than the bounds is clipped to them.
 */
export function regionAround(selection: Box, bounds: Box | null, pad = SNAPSHOT_PAD, min = SNAPSHOT_MIN): Box {
  let w = Math.max(selection.w + pad * 2, min);
  let h = Math.max(selection.h + pad * 2, min);
  const cx = selection.x + selection.w / 2;
  const cy = selection.y + selection.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  if (bounds) {
    w = Math.min(w, bounds.w);
    h = Math.min(h, bounds.h);
    x = Math.min(Math.max(x, bounds.x), bounds.x + bounds.w - w);
    y = Math.min(Math.max(y, bounds.y), bounds.y + bounds.h - h);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The size that fits `max` wide, keeping the aspect; unchanged when it already fits. */
export function fitWidth(w: number, h: number, max = SNAPSHOT_MAX_W): { width: number; height: number; scale: number } {
  if (w <= max) return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), scale: 1 };
  const scale = max / w;
  return { width: Math.round(max), height: Math.max(1, Math.round(h * scale)), scale };
}

/** The crop's pixel size: 2x the region, never wider than the cap. */
export function outputSize(w: number, h: number, max = SNAPSHOT_MAX_W): { width: number; height: number } {
  const k = Math.min(SNAPSHOT_SCALE, max / w);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
