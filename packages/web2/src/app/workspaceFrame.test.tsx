import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { WORKSPACE_PANE_RESIZER_PX } from './chromeTabModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE WORKSPACE MEASURES ITS OWN CONTAINER, AND REFUSES WHAT IT CANNOT SEAT.
   packages/web2/src/app/workspaceFrame.test.tsx

   TWO DEFECTS, BOTH FOUND IN THE SHIPPED BUNDLE, BOTH INVISIBLE TO EVERY
   EXISTING TEST.

     1. `useWorkspaceSplitContainerWidth` keyed its `useLayoutEffect` on the
        REF OBJECT, which never changes. The effect fired once — on the boot
        render, where only the Chat pill is open and no split element exists —
        read `null` and returned. It never ran again when the split mounted, so
        the width stayed 0 and the hook's hardcoded `960` shipped as the real
        answer. Measured at 1920x1080: two panes drew `476px 8px 476px` inside
        a 1704px container, 744px of dead space, and resizing changed nothing.

     2. Because the widths were a fiction, the pane COUNT was unbounded. At
        1152px the Browser pane was painted outside `.shell` (overflow:hidden)
        with no scrollbar and no indicator, while its pill still read ON.

   WHY THIS TIER CAN ASK THESE QUESTIONS AT ALL, given that jsdom has no
   layout: neither assertion is about a PAINTED box. The first reads the grid
   track list the component computed and wrote into `style`; the second reads
   which pills are on. Both are decisions the component makes from one number,
   and this file supplies that number by defining `clientWidth` on the one
   element the component measures — the same element a browser would report it
   for. Nothing is faked that the product then reads back as a measurement:
   `boardRendered.test.ts` and the e2e tier own the painted-box questions.
   ══════════════════════════════════════════════════════════════════════════ */

/** The element `App.tsx` hangs its ResizeObserver on. */
const MEASURED = 'shell-cb-body';

let reportedWidth = 0;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains(MEASURED) ? reportedWidth : 0;
    },
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  reportedWidth = 0;
  window.localStorage.clear();
});

/** Sum of the pane tracks plus the gutters, off the inline track list. */
function trackTotal(): number {
  const split = screen.getByTestId('shell-workspace-split');
  const tracks = split.style.gridTemplateColumns.trim().split(/\s+/);
  expect(tracks.length).toBeGreaterThan(0);
  return tracks.reduce((sum, track) => sum + Number.parseFloat(track), 0);
}

describe('the workspace is sized by the container it is in', () => {
  it('spends the whole measured width, not a 960px guess', () => {
    /* A 1920 window minus the 216px rail — the case the audit measured. */
    reportedWidth = 1704;
    render(<App />);

    fireEvent.click(screen.getByTestId('workspace-tab-ai-canvas'));

    const split = screen.getByTestId('shell-workspace-split');
    const tracks = split.style.gridTemplateColumns.trim().split(/\s+/);
    expect(tracks).toHaveLength(3);
    expect(tracks[1]).toBe(`${WORKSPACE_PANE_RESIZER_PX}px`);
    expect(trackTotal()).toBe(1704);
    /* And specifically NOT the fallback that used to ship as the answer. */
    expect(trackTotal()).not.toBe(960);
  });

  it('follows a different container to a different total', () => {
    reportedWidth = 808;
    render(<App />);

    fireEvent.click(screen.getByTestId('workspace-tab-ai-canvas'));
    expect(trackTotal()).toBe(808);
  });

  it('an uneven split still totals the container exactly', () => {
    /* Five equal panes in 1704 are 334.4 each. Rounding each on its own gives
       five 334px tracks, a 1702px total, and two pixels of the last pane
       painted past the right edge of an overflow:hidden shell — measured at
       1280 as a right edge of 1282. The last track carries the remainder. */
    reportedWidth = 1704;
    render(<App />);

    for (const id of ['architecture', 'whiteboard', 'ai-canvas', 'terminal']) {
      fireEvent.click(screen.getByTestId(`workspace-tab-${id}`));
    }

    const split = screen.getByTestId('shell-workspace-split');
    const tracks = split.style.gridTemplateColumns.trim().split(/\s+/);
    expect(tracks).toHaveLength(9);
    expect(trackTotal()).toBe(1704);
  });
});

describe('a pill the frame cannot seat is refused out loud', () => {
  it('says why instead of painting the pane past the right edge', () => {
    /* Two SEAT slots (2*280 + 8 = 568) seat two USABLE panes, and no more.
       The old floor called this width "three seats" — three 176px slivers,
       the melt the 2026-08-29 audit photographed. Capacity now answers in
       columns a surface can actually speak in. */
    reportedWidth = 568;
    render(<App />);

    fireEvent.click(screen.getByTestId('workspace-tab-architecture'));
    expect(trackTotal()).toBe(568);

    const browser = screen.getByTestId('workspace-tab-browser');
    expect(browser.getAttribute('aria-disabled')).toBe('true');
    expect(browser.getAttribute('title')).toMatch(/fits 2 views side by side/i);

    fireEvent.click(browser);

    /* The pill did not silently stay off: it stayed off AND said why. */
    expect(browser.getAttribute('data-on')).toBe('false');
    expect(screen.queryByTestId('shell-workspace-pane-browser')).toBeNull();
    const notice = screen.getByTestId('workspace-view-refused');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toMatch(/hide one before opening Browser/i);

    /* Two panes, and every track still inside the container. */
    expect(trackTotal()).toBe(568);
  });

  it('a wide frame refuses nothing', () => {
    reportedWidth = 1704;
    render(<App />);

    fireEvent.click(screen.getByTestId('workspace-tab-architecture'));
    fireEvent.click(screen.getByTestId('workspace-tab-terminal'));
    fireEvent.click(screen.getByTestId('workspace-tab-browser'));

    expect(screen.getByTestId('workspace-tab-browser').getAttribute('data-on')).toBe('true');
    expect(screen.getByTestId('workspace-tab-browser').getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByTestId('workspace-view-refused')).toBeNull();
    expect(trackTotal()).toBe(1704);
  });
});
