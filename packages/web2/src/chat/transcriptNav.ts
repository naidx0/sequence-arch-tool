/* ══════════════════════════════════════════════════════════════════════════
   THE TRANSCRIPT'S SCROLLER, AS OTHER PARTS SEE IT (S6)
   packages/web2/src/chat/transcriptNav.ts

   The transcript can be virtualized, so a card may not be in the page. Two
   things outside the list still need to reach it (the toasts' own check of
   which cards are on screen already re-reads the page as rows come and go,
   toastPlacement.ts):

     · a toast's "Show in chat" asks the list to bring a run or an approval
       into view (revealInTranscript), even when its row is not drawn;
     · a card that grows because its reader opened it (a capped body loading)
       keeps its own top where it was on screen (anchorRowTop), and tells the
       scroller to stop following the end.

   Small and dependency-free: it is on the boot path with the chat.
   ══════════════════════════════════════════════════════════════════════════ */

export const SCROLLER_ATTR = 'data-transcript-scroller';
export const HOLD_EVENT = 'sequence:transcript-hold';

/** What a reveal is asked to find: a run's card, or an approval inside one. */
export interface RevealTarget {
  runId: string;
  requestId?: string;
  /** `top`: the row's top just below the sticky header (a question card), not centred. */
  align?: 'center' | 'top';
}

type Revealer = (t: RevealTarget) => boolean;
let revealer: Revealer | null = null;

/** The virtualized list registers itself; the plain list needs no help. */
export function setTranscriptRevealer(fn: Revealer | null): void {
  revealer = fn;
}

/** True when a virtualized list took the request (it scrolls the row into view and draws it). */
export function revealInTranscript(t: RevealTarget): boolean {
  return revealer ? revealer(t) : false;
}

/**
 * Keep `el`'s row where it is on screen across a change the caller is about
 * to make. Returns the function to call once the change is laid out; it moves
 * the scroller by however far the row's top moved. Anchored on the row, not
 * on the scroll offset, so whatever else changed above or below, the row the
 * reader opened stays put.
 */
export function anchorRowTop(el: Element): () => void {
  const scroller = el.closest(`[${SCROLLER_ATTR}]`) as HTMLElement | null;
  if (!scroller) return () => {};
  const row = (el.closest('[data-row-key]') ?? el.closest('.agcard') ?? el) as HTMLElement;
  const topOf = (): number => row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const before = topOf();
  scroller.dispatchEvent(new Event(HOLD_EVENT));
  return () => {
    if (!row.isConnected) return;
    const moved = topOf() - before;
    if (moved !== 0) scroller.scrollTop += moved;
  };
}
