import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import '../v3/v3.css';

import { App } from './App';
import { LIVE_PANE_MIN, LIVE_PILLS } from './chromeTabModel';
import { closePane, openPane, openPanes, pane, paneIsOpen, tab } from '../../test/support/v3';

/* ══════════════════════════════════════════════════════════════════════════
   THE WORKSPACE FRAME — WHAT HAPPENS WHEN MORE IS OPEN THAN FITS
   packages/web2/src/app/workspaceFrame.test.tsx

   ── THE FINDING THIS FILE EXISTS FOR, AND WHY IT SURVIVED A REWRITE ───────

   The 2026-08-29 audit photographed a defect in the v2 grid workspace:

     "At 1152px the Browser pane was painted outside `.shell` (overflow:hidden)
      with no scrollbar and no indicator, while its pill still read ON."

   The pill said open, the pane was mounted, and it was nowhere. v2 answered by
   REFUSING a pill it could not seat and printing a notice.

   V3 rebuilt the workspace — flex instead of a computed grid track list — and
   did not carry the finding across. The same defect was back, by a different
   route: every pane carries a 240px floor (`LIVE_PANE_MIN`), flex items do not
   shrink below their floor, and `.v3-live-stack` was `overflow: hidden`. Past
   two or three panes on an ordinary laptop the surplus was clipped, silently,
   with the pills still reading open.

   ── WHAT THIS FILE ASSERTS NOW, AND WHAT IT DELIBERATELY DOES NOT ─────────

   The old assertions were about the v2 MECHANISM: inline grid track lists that
   summed to the measured container, a capacity refusal, a `workspace-view-
   refused` notice. None of those elements exists, and none of them should —
   V3's answer is different and better suited to a chrome whose whole shape is
   "open what you want and drag the splitters".

   So what is locked is the PROPERTY the audit paid for, stated so that either
   mechanism would satisfy it: AN OPEN PANE IS REACHABLE. A pill that reads
   open has a pane that can be got to, either because it fits or because the
   stack scrolls to it. A rewrite that clips it again fails here.

   WHY THIS TIER CAN ASK AT ALL, given that jsdom has no layout: the assertions
   are not about a painted box. They read which pills are on, which panes are
   mounted, and the stack's own overflow rule out of the stylesheet. The
   painted-box questions belong to the e2e tier, which is where the audit
   measured them.
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(() => {
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

/** The live stack's own resolved overflow, read off the sheet that ships. */
function stackOverflow(): { x: string; y: string } {
  const stack = screen.getByTestId('v3-live-stack');
  const style = window.getComputedStyle(stack);
  return { x: style.overflowX, y: style.overflowY };
}

describe('an open pane is reachable, however many are open', () => {
  it('never hides a pane it says is open', () => {
    /*
     * EVERY live surface at once — five of them, at a 240px floor each, which
     * is 1200px of panes in a stack that will not be that wide. This is the
     * case the audit photographed, reproduced with the count rather than with
     * a window size, because the count is the thing a reader controls.
     */
    render(<App />);

    for (const id of LIVE_PILLS) openPane(id);

    for (const id of LIVE_PILLS) {
      expect(paneIsOpen(id), `${id}'s pill does not read open`).toBe(true);
      expect(pane(id), `${id} reads open and has no pane mounted`).toBeTruthy();
    }
    expect(openPanes()).toHaveLength(LIVE_PILLS.length);

    /*
     * AND THE STACK CAN BE SCROLLED TO THEM. This is the half that makes
     * "mounted" mean "reachable": a mounted pane inside `overflow: hidden` is
     * exactly the defect — present in the DOM, absent from the screen, with
     * the pill still claiming it.
     */
    expect(stackOverflow().x).toBe('auto');
    /* And only sideways. A stack that scrolled vertically would let one pane
       push the whole row down instead of scrolling inside itself. */
    expect(stackOverflow().y).toBe('hidden');
  });

  it('asks for exactly its panes\' floor, so the chat column knows when to yield', () => {
    /*
     * ══ WHO GIVES WAY, AND WHEN ═══════════════════════════════════════════
     *
     * Owner, 2026-09-21, with a shot of Files crushed beside a board: "you
     * should be able to manipulate the size of the side rail showing the files
     * ... and not have the files surface be so lost and not usable."
     *
     * `.v3-chat-col` had `flex-shrink: 0`. It kept whatever width it was last
     * dragged to and would not give back one pixel, so the live stack — the
     * only item in the row that could shrink — absorbed every deficit.
     * Measured at 1280 with Files, Architecture and Terminal open: chat held
     * 480 with about 350px of empty space under a four-line answer, the three
     * panes sat pinned at their floor, and the terminal was off the screen.
     *
     * LETTING IT SHRINK IS HALF AN ANSWER AND THE FIRST TRY SHIPPED ONLY THAT
     * HALF. With `flex-basis: auto` the stack bids its content's MAX-content,
     * which for a board is "as much as you have", so the two were in a
     * proportional tug-of-war and the remembered width never held: measured at
     * 1920, chat rendered 370 against a stored 480 on a screen with room to
     * spare.
     *
     * A REMEMBERED WIDTH IS GIVEN UP FOR A NEED, NOT FOR AN APPETITE. The
     * stack's need is its panes at their floor; everything above that is a
     * preference with no more claim than the chat column's. So it asks for
     * exactly that, and a deficit — the thing that makes anything shrink —
     * exists only when the floors cannot all be met.
     *
     * WHAT THIS TIER CAN AND CANNOT SEE. jsdom has no layout, so the widths
     * above were measured in a browser; what is checkable here is the NUMBER
     * THE SHELL ASKS FOR, which is the decision. Its cap — `centerW - CHAT_MIN
     * - 1`, which keeps the overflow inside the stack instead of shifting the
     * whole layout — needs a measured container and is not asserted here.
     */
    render(<App />);

    const stack = () => screen.getByTestId('v3-live-stack');
    const askedFor = () => Number.parseFloat(stack().style.minWidth);

    /* One pane: its floor, no splitter. */
    openPane('architecture');
    for (const id of LIVE_PILLS) if (id !== 'architecture') closePane(id);
    expect(askedFor()).toBe(LIVE_PANE_MIN);

    /* Each further pane adds a floor AND the splitter beside it — the gutter
       is real width and a floor that forgot it would be short by one pixel per
       pane, which is how an off-by-one becomes a clipped column. */
    openPane('files');
    expect(askedFor()).toBe(LIVE_PANE_MIN * 2 + 1);

    openPane('terminal');
    expect(askedFor()).toBe(LIVE_PANE_MIN * 3 + 2);

    /* AND IT GOES BACK DOWN. A floor that only ever grew would keep the chat
       column squeezed after the reader closed the pane that squeezed it. */
    closePane('terminal');
    expect(askedFor()).toBe(LIVE_PANE_MIN * 2 + 1);
  });

  it('a pane closes from its own ×, and the pill follows it', () => {
    /*
     * Owner, 2026-09-13: "have an X to close them after they open up like
     * Chrome tabs so it's easy to navigate". The pill's label carried three
     * meanings on one press (show / focus / hide); the × carries one.
     */
    render(<App />);

    /* A CLOSED BASELINE, ESTABLISHED RATHER THAN ASSUMED. Which panes are open
       at boot is persisted chrome state, so asserting "the × is absent" before
       touching anything makes this case depend on what the previous one left
       behind. */
    if (paneIsOpen('architecture')) {
      fireEvent.click(screen.getByTestId('v3-tab-close-architecture'));
    }
    expect(screen.queryByTestId('v3-tab-close-architecture')).toBeNull();

    openPane('architecture');
    expect(paneIsOpen('architecture')).toBe(true);
    const close = screen.getByTestId('v3-tab-close-architecture');
    expect(close.getAttribute('aria-label')).toBe('Close Architecture');

    fireEvent.click(close);
    expect(paneIsOpen('architecture')).toBe(false);
    expect(screen.queryByTestId('v3-tab-close-architecture')).toBeNull();
    expect(pane('architecture')).toBeNull();
  });

  it('closing the last live pane leaves chat, rather than an empty frame', () => {
    /*
     * v2 REFUSED here and printed "only view open". V3 falls back to chat
     * instead (`closeLivePane`), which is a better answer to the same problem:
     * the reader gets the surface they started on rather than a notice telling
     * them they may not do what they just did.
     *
     * The property both answers share, and the one worth locking: THE
     * WORKSPACE IS NEVER EMPTY. A frame with nothing in it is a product that
     * looks broken.
     */
    render(<App />);

    openPane('architecture');
    fireEvent.click(screen.getByTestId('v3-tab-close-architecture'));

    expect(openPanes()).toHaveLength(0);
    expect(paneIsOpen('chat')).toBe(true);
    expect(tab('chat').classList.contains('is-selected')).toBe(true);
    expect(screen.getByTestId('composer-field')).toBeTruthy();
  });
});
