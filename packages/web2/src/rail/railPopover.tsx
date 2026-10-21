/* The rail's one top-layer popover (0.1.8.4 UX2): a component's flyout and the workflow hover card both open through it.
   It draws into document.body (the `.s2` scope carries the tokens, as ModelMenu's agent flyout and ConfirmDialog do), so a
   card is never clipped by the rail's list or its pane and can spill over the chat or the canvas. Where it goes is a pure
   function (placePopover): beside or below its anchor, flipped when there is no room, always inside the window. */

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import './railPopover.css';

/** A popover keeps this much clear of the window's edges. */
export const POP_INSET = 8;
/** The gap between the anchor and the popover; the popover's hit area covers it (a hover bridge) so the pointer can cross. */
export const POP_GAP = 6;

export interface PopRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type PopPrefer = 'right' | 'below';
export type PopSide = 'right' | 'left' | 'below' | 'above';
export interface PopPlacement {
  left: number;
  top: number;
  /** Which side of the anchor it landed on (after any flip). */
  side: PopSide;
  /** Set when the popover is taller than the room: the height it must be capped to (its body scrolls). */
  maxHeight: number | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Where a popover of `size` goes for `anchor`, in viewport pixels.
 * 'right': beside the anchor, top aligned with it; flips to its left when the right has no room; with room on neither
 * side it takes the roomier one and is clamped into the window.
 * 'below': under the anchor, left aligned; flips above when below has no room; with room on neither it takes the roomier
 * side and is capped in height. Either way the result is inside the window with an inset.
 */
export function placePopover(o: { anchor: PopRect; size: { w: number; h: number }; viewport: { w: number; h: number }; prefer: PopPrefer; gap?: number; inset?: number }): PopPlacement {
  const inset = o.inset ?? POP_INSET;
  const gap = o.gap ?? POP_GAP;
  const { anchor: a, size, viewport: vp } = o;
  if (o.prefer === 'right') {
    const roomR = vp.w - inset - (a.right + gap);
    const roomL = a.left - gap - inset;
    const fit = (l: number) => clamp(l, inset, vp.w - inset - size.w);
    let side: PopSide;
    let left: number;
    if (size.w <= roomR) {
      side = 'right';
      left = a.right + gap;
    } else if (size.w <= roomL) {
      side = 'left';
      left = a.left - gap - size.w;
    } else if (roomR >= roomL) {
      side = 'right';
      left = fit(a.right + gap);
    } else {
      side = 'left';
      left = fit(a.left - gap - size.w);
    }
    const roomH = vp.h - 2 * inset;
    const tooTall = size.h > roomH;
    return { left, top: tooTall ? inset : clamp(a.top, inset, vp.h - inset - size.h), side, maxHeight: tooTall ? Math.max(0, Math.floor(roomH)) : null };
  }
  const left = clamp(a.left, inset, vp.w - inset - size.w);
  const roomH = vp.h - 2 * inset;
  const spaceBelow = vp.h - inset - (a.bottom + gap);
  const spaceAbove = a.top - gap - inset;
  const inY = (t: number) => clamp(t, inset, vp.h - inset - size.h);
  if (size.h <= spaceBelow) return { left, top: inY(a.bottom + gap), side: 'below', maxHeight: null };
  if (size.h <= spaceAbove) return { left, top: inY(a.top - gap - size.h), side: 'above', maxHeight: null };
  if (spaceBelow >= spaceAbove) {
    const top = Math.max(a.bottom + gap, inset);
    return { left, top, side: 'below', maxHeight: Math.max(0, Math.floor(vp.h - inset - top)) };
  }
  return { left, top: inset, side: 'above', maxHeight: Math.max(0, Math.floor(Math.min(spaceAbove, roomH))) };
}

export interface RailPopoverProps {
  /** The anchor's rect now, in viewport pixels; null when it is gone. Read on open, on resize, on scroll and when the card resizes. */
  anchor: () => PopRect | null;
  prefer: PopPrefer;
  /** Marks the kind for styling and tests: a click flyout or a hover card. */
  kind: 'flyout' | 'card';
  label?: string;
  role?: 'dialog' | 'group';
  /** Extra classes on the popover (none today). */
  className?: string;
  popRef?: MutableRefObject<HTMLDivElement | null>;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerEnter?: () => void;
  /** Focusable by script (a dialog takes focus on open). */
  focusable?: boolean;
  children: ReactNode;
}

/** The popover itself, in the top-layer root on document.body. */
export function RailPopover({ anchor, prefer, kind, label, role, className, popRef, onKeyDown, onPointerEnter, focusable, children }: RailPopoverProps) {
  const own = useRef<HTMLDivElement | null>(null);
  const ref = popRef ?? own;
  const anchorFn = useRef(anchor);
  anchorFn.current = anchor;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const place = () => {
      const a = anchorFn.current();
      if (!a) return;
      /* Measure at its natural height: a cap from the last pass would hide that it now fits. */
      el.style.maxHeight = '';
      const r = el.getBoundingClientRect();
      const p = placePopover({ anchor: a, size: { w: r.width, h: r.height }, viewport: { w: window.innerWidth, h: window.innerHeight }, prefer });
      el.style.left = `${Math.round(p.left)}px`;
      el.style.top = `${Math.round(p.top)}px`;
      el.style.maxHeight = p.maxHeight === null ? '' : `${p.maxHeight}px`;
      el.setAttribute('data-side', p.side);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    /* A card that loads its steps grows after it opens. */
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [ref, prefer]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="s2 s2-fly-layer" data-testid="rail-pop-root">
      <div
        ref={ref}
        className={`s2-menu rail-pop${className ? ` ${className}` : ''}`}
        data-kind={kind}
        data-side={prefer === 'right' ? 'right' : 'below'}
        data-testid="rail-pop"
        role={role}
        aria-label={label}
        tabIndex={focusable ? -1 : undefined}
        onKeyDown={onKeyDown}
        onPointerEnter={onPointerEnter}
      >
        <div className="rail-pop-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Closes a popover on Escape or a press outside. `inside` lists the elements that count as part of it (the popover and its
 * anchor, so the anchor's own click can toggle). Escape is taken only when focus is inside, so a hover card does not eat
 * an Escape meant for something else.
 */
export function usePopoverDismiss(open: boolean, inside: () => Array<Element | null | undefined>, onDismiss: (why: 'escape' | 'outside') => void): void {
  const insideFn = useRef(inside);
  const dismissFn = useRef(onDismiss);
  insideFn.current = inside;
  dismissFn.current = onDismiss;
  useEffect(() => {
    if (!open) return undefined;
    const within = (n: Node | null) => insideFn.current().some((el) => !!el && !!n && el.contains(n));
    const away = (e: PointerEvent) => {
      if (!within(e.target as Node)) dismissFn.current('outside');
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (within(document.activeElement)) {
        e.stopPropagation();
        e.preventDefault();
      }
      dismissFn.current('escape');
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
}

/** Tab inside a popover wraps instead of leaving it: returns true when it moved focus. */
export function wrapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, root: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !root) return false;
  const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  if (items.length === 0) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && (at <= 0)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && at === items.length - 1) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
