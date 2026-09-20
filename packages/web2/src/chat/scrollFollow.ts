/* ══════════════════════════════════════════════════════════════════════════
   SCROLL-FOLLOW THAT YIELDS TO THE READER
   packages/web2/src/chat/scrollFollow.ts

   Ported from MLH/frontend/src/App.tsx:223-232 and :374-382, item 7 of the
   adoption list. The study's note on it: v1 has NO autoscroll at all — grep
   across packages/web/src/product/ for scrollTop or scrollIntoView returns zero
   — and this is "the highest user-visible-improvement-per-line item in this
   whole document".

   The threshold is the whole idea. Following unconditionally yanks a reader
   who scrolled up back to the bottom on every delta, which is worse than not
   following at all; following never means a live answer writes itself off the
   bottom of a screen nobody is looking at. 48px is roughly two tool rows: far
   enough that a deliberate scroll registers, near enough that resting at the
   end still counts as being at the end.
   ══════════════════════════════════════════════════════════════════════════ */

export const TAIL_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * True when the viewport is parked within `threshold` of the bottom — i.e.
 * when the reader is reading the end, so appending to the end should move them.
 *
 * A container with nothing to scroll answers true: distance is zero, and the
 * empty and one-turn cases must not start life detached.
 */
export function shouldFollow(m: ScrollMetrics, threshold: number = TAIL_THRESHOLD_PX): boolean {
  const distanceFromBottom = m.scrollHeight - m.scrollTop - m.clientHeight;
  return distanceFromBottom <= threshold;
}
