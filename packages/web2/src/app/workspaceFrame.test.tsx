import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import '../shell2/shell2.css';

import { App } from './App';
import { LIVE_PILLS } from './chromeTabModel';
import { openPane, openPanes, pane, paneIsOpen } from '../../test/support/v3';
import { STAGE_MAX } from '../shell2/Shell2';

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

   DECISION 49 (the reskin shell) answers the same finding a third way: the
   stage seats at most two surfaces side by side (the split dock), and opening
   a third retires the oldest other one, so its pill goes dark with it. The
   property is unchanged and is what is asserted: a pill that reads open has a
   pane on the stage.
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(() => {
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('an open pane is reachable, however many are open', () => {
  it('never says open for a pane that is not on the stage: two seat side by side, a third retires the oldest', () => {
    render(<App />);
    for (const id of LIVE_PILLS) {
      openPane(id);
      const lit = LIVE_PILLS.filter((x) => paneIsOpen(x));
      expect(lit.length, `after opening ${id}`).toBeLessThanOrEqual(STAGE_MAX);
      for (const x of lit) expect(pane(x), `${x} reads open and has no pane on the stage`).toBeTruthy();
      expect(openPanes().sort()).toEqual([...lit].sort());
      /* The one just asked for is always among them. */
      expect(paneIsOpen(id)).toBe(true);
    }
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

  it('closing the last live pane leaves the chat, centred, rather than an empty frame', () => {
    /*
     * v2 REFUSED here and printed "only view open". V3 fell back to chat; the
     * reskin keeps the chat column on screen always, so closing the last
     * surface leaves the chat and a stage that says how to open one.
     *
     * The property both answers share, and the one worth locking: THE
     * WORKSPACE IS NEVER EMPTY. A frame with nothing in it is a product that
     * looks broken.
     */
    render(<App />);

    openPane('architecture');
    fireEvent.click(screen.getByTestId('v3-tab-close-architecture'));

    expect(openPanes()).toHaveLength(0);
    /* Round 7, B3: "they can condense into their little icons when no surface
       is open, and it can just center the actual chat box". The stage folds
       away; the bar keeps every surface as an icon that opens it. */
    expect(paneIsOpen('chat')).toBe(true);
    expect(document.querySelector('.s2-row')?.getAttribute('data-stage')).toBe('none');
    expect(document.querySelector('.s2-stage')).toBeNull();
    /* Round 13 ruling: the bar keeps its names with no surface open. */
    expect(document.querySelector('.s2-surfaces')?.classList.contains('is-compact')).toBe(false);
    expect(screen.getByTestId('s2-tab-architecture').querySelector('.s2-seg-l')?.textContent).toBe('Architecture');
    expect(screen.getByTestId('s2-tab-architecture').getAttribute('aria-label')).toBe('Architecture');
    expect(screen.getByTestId('composer-field')).toBeTruthy();
    /* A name opens it again, and the stage comes back. */
    openPane('architecture');
    expect(document.querySelector('.s2-row')?.getAttribute('data-stage')).toBeNull();
    expect(pane('architecture')).not.toBeNull();
  });
});
