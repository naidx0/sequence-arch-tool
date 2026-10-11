/* ══════════════════════════════════════════════════════════════════════════
   PINNED TO THE END, UNTIL THE READER LEAVES IT (S6)
   packages/web2/src/chat/stickToBottom.ts

   While the transcript's scroller rests within STICK_PX of its end, anything
   added to it (a streamed token, a tool card, a new run) keeps it at the end.
   Once the reader scrolls further up than that, nothing the stream does moves
   them, and the chat shows a "Jump to latest" button until they come back
   (by scrolling down or by pressing it).

   It watches the scroller's own content (a MutationObserver), not the app
   state, so it works the same for the plain list and the virtualized one and
   for parts of the transcript drawn by other stores (the agent runs). The
   stick runs at most once per animation frame.

   A card that grows because its reader opened it says so (HOLD_EVENT,
   transcriptNav.ts): the reader is reading that card, so following stops.

   NOT FOLLOWING IS NOT THE SAME AS AWAY FROM THE END. A held card stops the
   follow, but when the transcript is short or still ends in view there is
   nothing to jump to, and "Jump to latest" showed over a chat that was
   already at its end (UX audit). The button is `away`: not following AND
   more than STICK_PX from the end, measured on every scroll, content change
   and resize.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { HOLD_EVENT } from './transcriptNav';

/** "At the end" is within this many pixels of it. */
export const STICK_PX = 40;

export function distanceFromEnd(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export interface StickToBottom {
  /** The scroller is at its end and follows what is added. */
  following: boolean;
  /** Not following, and more than STICK_PX from the end: what "Jump to latest" shows on. */
  away: boolean;
  /** Back to the end, and following again ("Jump to latest"). */
  jump: () => void;
}

/**
 * `scroller` is the element that scrolls (null while there is none).
 * `toEnd` overrides how the end is reached (a virtualized list knows its
 * real end before the page does).
 */
export function useStickToBottom(scroller: HTMLElement | null, toEnd?: () => void): StickToBottom {
  const [following, setFollowing] = useState(true);
  const [far, setFar] = useState(false);
  const followingRef = useRef(true);
  const toEndRef = useRef(toEnd);
  toEndRef.current = toEnd;
  /* Where the scroller was last seen, to tell the reader moving up from the page moving. */
  const lastTop = useRef(0);

  const set = useCallback((f: boolean) => {
    if (followingRef.current === f) return;
    followingRef.current = f;
    setFollowing(f);
  }, []);

  const stick = useCallback((el: HTMLElement) => {
    if (toEndRef.current) toEndRef.current();
    else el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);

  useEffect(() => {
    const el = scroller;
    if (!el) return undefined;
    if (followingRef.current) stick(el);
    /* Only the reader moving UP leaves the end. A scroll the page made (the
       scroller resized, a row above measured itself) can open a gap below
       without anyone leaving, and the next stick closes it. */
    lastTop.current = el.scrollTop;
    const measure = (): void => setFar(distanceFromEnd(el) > STICK_PX);
    measure();
    const onScroll = (): void => {
      const top = el.scrollTop;
      if (distanceFromEnd(el) <= STICK_PX) set(true);
      else if (top < lastTop.current - 1) set(false);
      lastTop.current = top;
      measure();
    };
    const onHold = (): void => {
      set(false);
      measure();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener(HOLD_EVENT, onHold);
    let frame: number | null = null;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16) as unknown as number;
    const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (h: number) => clearTimeout(h);
    const follow = (): void => {
      if (frame !== null) return;
      frame = raf(() => {
        frame = null;
        if (followingRef.current) stick(el);
        measure();
      });
    };
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(follow) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    /* The window or the pane resized: the scroller got shorter or longer with no scroll and no new content. */
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener(HOLD_EVENT, onHold);
      mo?.disconnect();
      ro?.disconnect();
      if (frame !== null) caf(frame);
    };
  }, [scroller, set, stick]);

  const jump = useCallback(() => {
    set(true);
    if (scroller) stick(scroller);
  }, [scroller, set, stick]);

  return { following, away: !following && far, jump };
}
