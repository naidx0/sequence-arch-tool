import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * Decision 52 (native feel): a sheet follows the finger and is let go, or let back. One hook, one set of
 * thresholds, for every overlay and for the welcome track.
 *
 * Active only where a finger (or a pen) is the pointer, or the window is as narrow as the v3 breakpoint; a mouse
 * on a desktop-width window never drags a dialog. Pointer capture on the first move past the slop, so the drag
 * survives leaving the sheet; the transform is written straight to the element (no render per frame). A drag
 * that ends past the distance, or fast enough, hands off to `onDismiss` and the caller's exit animation plays
 * from where the finger left it (`data-swiped` names the axis for the CSS); anything less springs back on the
 * motion tokens. Reduced motion (base.css zeroes every transition) makes both an instant state change; the swipe
 * itself still works.
 */

/** px a drag must travel to count as a release; also the welcome track's page turn. */
export const SWIPE_DISTANCE = 64;
/** px/ms a flick must reach (past SWIPE_FLICK_MIN px) to count without the full distance. */
export const SWIPE_VELOCITY = 0.5;
export const SWIPE_FLICK_MIN = 24;
/** px before a gesture is read at all, and the narrow breakpoint (v3.css). */
export const SWIPE_SLOP = 8;
export const SWIPE_NARROW = '(max-width: 720px)';

type PointerLike = { pointerType?: string };

/** Touch and pen always; a mouse only in a narrow window. */
export function swipeActive(e: PointerLike, win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true;
  return !!win?.matchMedia?.(SWIPE_NARROW).matches;
}

/** Whether a release is a dismissal: far enough, or a quick flick that has gone a little way. */
export function swipeReleases(distance: number, velocity: number): boolean {
  return distance >= SWIPE_DISTANCE || (velocity >= SWIPE_VELOCITY && distance >= SWIPE_FLICK_MIN);
}

export interface SwipeDismissOptions {
  /** 'y' pulls down (bottom sheets, centred dialogs); 'x' pulls right (side panels). */
  axis?: 'y' | 'x';
  /** 'x' only: -1 pulls LEFT instead, for a drawer docked on the left edge. */
  dir?: 1 | -1;
  enabled?: boolean;
  /** For tests: the clock. */
  now?: () => number;
}

export interface SwipeDismissHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

interface Drag {
  id: number;
  x: number;
  y: number;
  dragging: boolean;
  /** the last two samples, for the release velocity */
  t0: number;
  m0: number;
  t1: number;
  m1: number;
}

const FORM = 'input, textarea, select, [contenteditable="true"], [data-no-swipe]';

/** A scroller between the touch and the sheet that is not at its start: the content owns this gesture. */
function scrolledAway(from: EventTarget | null, sheet: HTMLElement, axis: 'y' | 'x'): boolean {
  let el = from instanceof HTMLElement ? from : null;
  while (el && el !== sheet.parentElement) {
    const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;
    const room = axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
    if (room && pos > 0) return true;
    if (el === sheet) break;
    el = el.parentElement;
  }
  return false;
}

export function useSwipeDismiss(ref: RefObject<HTMLElement>, onDismiss: () => void, opts: SwipeDismissOptions = {}): SwipeDismissHandlers {
  const { axis = 'y', enabled = true, now } = opts;
  const dir = axis === 'x' ? (opts.dir ?? 1) : 1;
  const drag = useRef<Drag | null>(null);
  const clock = now ?? (() => performance.now());
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const offsetOf = (d: Drag, e: ReactPointerEvent<HTMLElement>) => (axis === 'y' ? e.clientY - d.y : (e.clientX - d.x) * dir);
  const crossOf = (d: Drag, e: ReactPointerEvent<HTMLElement>) => (axis === 'y' ? e.clientX - d.x : e.clientY - d.y);

  const springBack = useCallback(() => {
    const el = ref.current;
    drag.current = null;
    if (!el) return;
    el.removeAttribute('data-dragging');
    el.style.transition = 'transform var(--dur-3) var(--ease-enter)';
    el.style.transform = '';
    const done = () => {
      el.style.transition = '';
      el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
    window.setTimeout(done, 320);
  }, [ref]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!enabled || !el || (e.button ?? 0) > 0 || !swipeActive(e)) return;
    if (e.target instanceof Element && e.target.closest(FORM)) return;
    el.removeAttribute('data-swiped');
    const t = clock();
    const m = axis === 'y' ? e.clientY : 0;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, t0: t, m0: m, t1: t, m1: m };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    const off = offsetOf(d, e);
    if (!d.dragging) {
      const cross = crossOf(d, e);
      if (Math.abs(off) < SWIPE_SLOP && Math.abs(cross) < SWIPE_SLOP) return;
      /* up or sideways, or the content under the finger is mid-scroll: not ours. */
      if (off <= 0 || Math.abs(cross) > Math.abs(off) || scrolledAway(e.target, el, axis)) {
        drag.current = null;
        return;
      }
      d.dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
      el.style.transition = 'none';
      el.setAttribute('data-dragging', 'true');
    }
    const t = clock();
    d.t0 = d.t1;
    d.m0 = d.m1;
    d.t1 = t;
    d.m1 = off;
    const o = Math.max(0, off);
    el.style.transform = axis === 'y' ? `translateY(${o}px)` : `translateX(${o * dir}px)`;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    if (!d.dragging) {
      drag.current = null;
      return;
    }
    const off = Math.max(0, offsetOf(d, e));
    const dt = Math.max(1, d.t1 - d.t0);
    const velocity = (d.m1 - d.m0) / dt;
    try { el.releasePointerCapture(e.pointerId); } catch { /* released with the pointer */ }
    if (swipeReleases(off, velocity)) {
      /* Leave the transform where the finger let go: the exit animation reads it as its start. */
      drag.current = null;
      el.removeAttribute('data-dragging');
      el.style.transition = '';
      el.setAttribute('data-swiped', axis);
      dismiss.current();
    } else {
      springBack();
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { if (drag.current?.dragging) springBack(); else drag.current = null; } };
}
