/* ══════════════════════════════════════════════════════════════════════════
   WHEN A TOAST SHOWS, AND WHERE IT SITS
   packages/web2/src/chat/toastPlacement.ts

   WHEN. A toast repeats what the chat card already says, so it shows only
   while that card cannot be seen: the chat is scrolled away from it, another
   view hides the chat (the card is display:none or not in the page), or the
   window itself is hidden. An IntersectionObserver per card answers that
   (it accounts for scrolled-away ancestors and display:none); without one
   the toast always shows, which is the safe side.

   WHERE. The stack sits bottom-right, ABOVE anything marked
   `data-toast-avoid` that it would otherwise cover (the board's bottom
   toolbar strip). The board marks its own strip; this file never reaches
   into the board's markup. With nothing marked, the stack keeps its inset;
   the board no longer lifts its own furniture (canvas/toastLift.ts is gone).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** What a part of the page sets to keep the toast stack off it. */
export const TOAST_AVOID_ATTR = 'data-toast-avoid';
export const TOAST_INSET = 16;
export const TOAST_GAP = 8;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The stack's `bottom`: its inset, or high enough to clear every marked
 * obstacle it would overlap horizontally, whichever is higher.
 */
export function toastBottom(stack: { left: number; right: number }, obstacles: readonly Box[], viewportHeight: number, inset = TOAST_INSET, gap = TOAST_GAP): number {
  let bottom = inset;
  for (const o of obstacles) {
    if (o.right <= stack.left || o.left >= stack.right) continue;
    if (o.bottom <= o.top) continue;
    bottom = Math.max(bottom, Math.round(viewportHeight - o.top + gap));
  }
  return bottom;
}

/** Keeps the stack's `bottom` clear of marked obstacles while mounted. */
export function useToastBottom(stackRef: RefObject<HTMLElement>, deps: readonly unknown[]): number {
  const [bottom, setBottom] = useState(TOAST_INSET);
  useLayoutEffect(() => {
    const measure = (): void => {
      const stack = stackRef.current;
      if (!stack) return;
      const r = stack.getBoundingClientRect();
      /* Not laid out yet: the stack's place by its own rule (320 px, inset from the right). */
      const span = r.width > 0 ? { left: r.left, right: r.right } : { left: window.innerWidth - TOAST_INSET - 320, right: window.innerWidth - TOAST_INSET };
      const obstacles = [...document.querySelectorAll(`[${TOAST_AVOID_ATTR}]`)].map((el) => el.getBoundingClientRect());
      const next = toastBottom(span, obstacles, window.innerHeight);
      setBottom((was) => (was === next ? was : next));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    for (const el of document.querySelectorAll(`[${TOAST_AVOID_ATTR}]`)) ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return bottom;
}

/** The chat element a toast stands in for. */
export function cardSelector(spec: { kind: string; runId: string; approval?: { requestId: string } }): string {
  /* Attribute selectors, quoted: ids here are UUIDs and run ids, but a quote
     or a backslash must not end the selector. */
  const q = (s: string): string => s.replace(/["\\]/g, (c) => `\\${c}`);
  if (spec.kind === 'approval' && spec.approval) {
    const id = q(spec.approval.requestId);
    return `[data-approval-id="${id}"], [id="agcard-${id}"]`;
  }
  return `[id="agrun-${q(spec.runId)}"]`;
}

/**
 * The keys whose chat card a person can see right now. Re-observes when
 * `keys` change (a card appears or goes) and on visibility changes.
 */
export function useVisibleCards(targets: readonly { key: string; selector: string }[]): ReadonlySet<string> {
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  const signature = targets.map((t) => `${t.key}=${t.selector}`).join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') {
      setVisible(new Set());
      return undefined;
    }
    const seen = new Map<string, boolean>();
    const publish = (): void => {
      const hidden = document.visibilityState === 'hidden';
      const next = new Set<string>();
      if (!hidden) for (const [k, v] of seen) if (v) next.add(k);
      setVisible((was) => (was.size === next.size && [...next].every((k) => was.has(k)) ? was : next));
    };
    const keyOf = new Map<Element, string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const k = keyOf.get(e.target);
        if (k) seen.set(k, e.isIntersecting && e.intersectionRatio > 0);
      }
      publish();
    });
    const attach = (): void => {
      for (const t of targets) {
        const el = document.querySelector(t.selector);
        const already = [...keyOf.entries()].find(([, k]) => k === t.key)?.[0];
        if (el === already) continue;
        if (already) {
          io.unobserve(already);
          keyOf.delete(already);
          seen.set(t.key, false);
        }
        if (el) {
          keyOf.set(el, t.key);
          io.observe(el);
        }
      }
      publish();
    };
    attach();
    /* A card that mounts later (lazy pane, a tab coming back) is picked up. */
    const mo = new MutationObserver(attach);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', publish);
    return () => {
      mo.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', publish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return visible;
}
