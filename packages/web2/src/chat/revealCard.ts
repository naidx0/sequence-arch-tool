/* ══════════════════════════════════════════════════════════════════════════
   BRING A CARD'S TOP INTO VIEW, BELOW THE TRANSCRIPT'S STICKY HEADER
   packages/web2/src/chat/revealCard.ts

   The agent's header (agentComposer.tsx, `.agchat-hd`) is sticky at the top
   of the transcript's scroller. A card scrolled to the scroller's top lands
   UNDER it: the 2026-10-06 shot of the question card had its first question
   hidden there. So the card's scroll-margin-top is set to the header's own
   measured height (whatever marks itself `data-transcript-sticky`), never a
   number written here, and the card is scrolled to its top. A card taller
   than the chat stays whole: its top shows, the rest scrolls as usual.

   Revealing a card is the reader being taken somewhere, so the scroller is
   told to stop following the end (HOLD_EVENT, stickToBottom.ts) first.
   Lazy: only the run thread and the toasts load it.
   ══════════════════════════════════════════════════════════════════════════ */

import { HOLD_EVENT, SCROLLER_ATTR } from './transcriptNav';

/** Marks an element that sticks to the top of the transcript's scroller. */
export const STICKY_ATTR = 'data-transcript-sticky';

/**
 * How far down from the scroller's top edge the sticky header reaches: its
 * bottom, measured against the scroller, so the scroller's own padding above
 * a stuck header counts too (the 2026-10-06 fix shot: a 32 px header that
 * sticks 20 px down covers 52 px, and a margin of only its height left the
 * card's title row under it).
 */
export function stickyOffset(scroller: Element | null): number {
  if (!scroller) return 0;
  const top = scroller.getBoundingClientRect().top;
  let reach = 0;
  for (const el of scroller.querySelectorAll(`[${STICKY_ATTR}]`)) reach = Math.max(reach, el.getBoundingClientRect().bottom - top);
  return Math.max(0, Math.ceil(reach));
}

/** Scroll `card`'s top to just below the sticky header. Returns the offset used. */
export function revealCardTop(card: HTMLElement, behavior: ScrollBehavior = 'smooth'): number {
  const scroller = card.closest(`[${SCROLLER_ATTR}]`);
  const offset = stickyOffset(scroller);
  card.style.scrollMarginTop = `${offset}px`;
  scroller?.dispatchEvent(new Event(HOLD_EVENT));
  /* jsdom has no scrolling; a page always does. */
  if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start', behavior });
  return offset;
}

/** The virtualized list's scroll for a reveal: centred, or (align top) the row's top below the sticky header. */
export function revealScroll(index: number, align: 'center' | 'top' | undefined, offset: number): { index: number; animated: true; viewPosition: number; viewOffset?: number } {
  return align === 'top' ? { index, animated: true, viewPosition: 0, viewOffset: offset } : { index, animated: true, viewPosition: 0.5 };
}
