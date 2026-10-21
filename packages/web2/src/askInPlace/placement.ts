/* ══════════════════════════════════════════════════════════════════════════
   WHERE THE POPOVER SITS
   packages/web2/src/askInPlace/placement.ts

   Next to the target, never on it, and always inside the BOARD (not the
   window): at three surfaces the board is about 300px wide, and a popover
   anchored by the window would hang off its edge. Preference order: right of
   the target, left of it, below, above; the first that fits whole wins, and
   when none does the popover is clamped inside the bounds (it may then cover
   the target, which is better than being cut off).
   ══════════════════════════════════════════════════════════════════════════ */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = 'right' | 'left' | 'below' | 'above' | 'clamped';

export const POPOVER_GAP = 12;
export const POPOVER_INSET = 8;

/**
 * `target` and the result are in the container's own coordinates; `size` is the
 * popover's measured size; `bounds` is the container's width and height.
 */
export function placePopover(
  target: Rect,
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  gap = POPOVER_GAP,
  inset = POPOVER_INSET,
): { left: number; top: number; side: Side } {
  const maxLeft = bounds.width - size.width - inset;
  const maxTop = bounds.height - size.height - inset;
  const clampX = (x: number) => Math.max(inset, Math.min(x, maxLeft));
  const clampY = (y: number) => Math.max(inset, Math.min(y, maxTop));
  const midY = target.top + target.height / 2 - size.height / 2;
  const midX = target.left + target.width / 2 - size.width / 2;

  const right = target.left + target.width + gap;
  if (right <= maxLeft) return { left: clampX(right), top: clampY(midY), side: 'right' };

  const left = target.left - gap - size.width;
  if (left >= inset) return { left: clampX(left), top: clampY(midY), side: 'left' };

  const below = target.top + target.height + gap;
  if (below <= maxTop) return { left: clampX(midX), top: clampY(below), side: 'below' };

  const above = target.top - gap - size.height;
  if (above >= inset) return { left: clampX(midX), top: clampY(above), side: 'above' };

  return { left: clampX(midX), top: clampY(midY), side: 'clamped' };
}

/** A viewport-coordinate rect into a container's coordinates. */
export function relativeTo(rect: { left: number; top: number; width: number; height: number }, container: { left: number; top: number }): Rect {
  return { left: rect.left - container.left, top: rect.top - container.top, width: rect.width, height: rect.height };
}
