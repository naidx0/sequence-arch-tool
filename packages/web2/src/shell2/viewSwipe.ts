import { SWIPE_DISTANCE, SWIPE_FLICK_MIN, SWIPE_SLOP, SWIPE_VELOCITY } from './useSwipeDismiss';

/**
 * Swiping between Chat and Workspace on a phone (decision 52: swipe on touch and narrow only). The main area reads a
 * horizontal drag as "the other tab", the same switch the tab control makes. A gesture that starts where something
 * else owns the horizontal axis is not ours: a text field (the caret and the selection), a horizontally scrollable
 * region, a surface that took touch-action for itself (the board, a diagram, the tab bar's own pan).
 */

const FORM = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-no-swipe]';

/** True when the touch landed in something that owns a horizontal drag, between the target and the boundary. */
export function viewSwipeBlocked(target: Element, boundary: Element | null = null, styleOf: (el: Element) => CSSStyleDeclaration = (el) => getComputedStyle(el)): boolean {
  if (target.closest(FORM)) return true;
  for (let el: Element | null = target; el && el !== boundary; el = el.parentElement) {
    const cs = styleOf(el);
    const touch = cs.getPropertyValue('touch-action');
    if (touch === 'none' || touch.includes('pan-x')) return true;
    const ox = cs.overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/** Which way a finished drag turns the view: 1 for the next tab (a swipe left), -1 for the previous, 0 for neither. */
export function viewSwipeStep(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  const ax = Math.abs(dx);
  /* Mostly sideways: a diagonal or a vertical scroll is not a page turn. */
  if (ax < SWIPE_SLOP || ax < Math.abs(dy) * 1.5) return 0;
  const fast = ax / Math.max(1, ms) >= SWIPE_VELOCITY && ax >= SWIPE_FLICK_MIN;
  if (ax < SWIPE_DISTANCE && !fast) return 0;
  return dx < 0 ? 1 : -1;
}
