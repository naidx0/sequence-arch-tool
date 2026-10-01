/* ══════════════════════════════════════════════════════════════════════════
   "IS IT STILL WORKING?" — the mark on a pane the model draws on
   packages/web2/src/v3/paneWorking.test.tsx

   Owner, 2026-09-20: "it's important to show when the model's still actually
   writing or typing, because right now the architecture is imported and I'm
   working with it but descriptions are popping up one by one, which is
   awesome, but I don't know if, when, or if it's working."

   ── THE THREE THINGS THAT MAKE THE MARK WORTH HAVING ──────────────────────

   1. IT IS ON WHILE THE TURN IS. Driven by `session.inFlight.phase` and
      nothing else — not a timer, not a count of edits arriving.
   2. IT IS OFF WHEN NOTHING IS RUNNING. This is the one that decides whether
      the mark is believed: an indicator that can be on with no work behind it
      teaches the reader to stop reading it, which is worse than no indicator.
   3. IT IS ONLY ON A SURFACE THE MODEL PAINTS. `MODEL_DRAWN_PANES`. Files and
      Terminal change during a turn too, but nobody sits watching them fill in
      and a mark there would claim an activity the pane cannot show.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { MODEL_DRAWN_PANES, WORKSPACE_PILLS } from '../app/chromeTabModel';
import { createStore, type Store } from '../state';
import { V3App } from './V3App';

function shellWith(opts: { running: boolean }): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-work', title: 'Session', pinned: false, updatedAt: '2026-09-20' }],
    activeId: 's-work',
  } as never);
  if (opts.running) {
    store.dispatch({ type: 'composer/draft', text: 'map this repository' });
    store.dispatch({ type: 'turn/send', at: 1 });
  }
  return store;
}

/** Open every workspace pane, so the mark's presence is a choice and not a
 *  consequence of which pane happened to be on screen. */
function openEveryPane(): void {
  localStorage.setItem(
    'v3.chromeTabs',
    JSON.stringify({
      tabs: WORKSPACE_PILLS.map((id) => ({ id, minimized: false })),
      active: 'architecture',
    }),
  );
}

describe('the working mark on a live pane head', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-platform', 'win');
  });

  it('is on every pane the model draws on while a turn is in flight', () => {
    openEveryPane();
    render(
      <V3App appStore={shellWith({ running: true })} />,
    );

    for (const id of MODEL_DRAWN_PANES) {
      const mark = screen.getByTestId(`v3-pane-working-${id}`);
      expect(mark.textContent).toBe('Working');
      /* The phase travels on the element, so a later rule can style
         `stopping` differently without re-deriving which turn it is. */
      expect(mark.getAttribute('data-phase')).toBe('queued');
    }
  });

  it('is on NO pane the model does not draw on', () => {
    /*
     * DERIVED FROM THE SAME TWO LISTS, not hand-listed. A test that named
     * "files" and "terminal" could not fail for a pane nobody thought to add
     * to it — and the pane most likely to grow this mark wrongly is the one
     * added next.
     */
    openEveryPane();
    render(
      <V3App appStore={shellWith({ running: true })} />,
    );

    const notDrawn = WORKSPACE_PILLS.filter(
      (id) => id !== 'chat' && !MODEL_DRAWN_PANES.includes(id),
    );
    expect(notDrawn.length).toBeGreaterThan(0);
    for (const id of notDrawn) {
      expect(screen.queryByTestId(`v3-pane-working-${id}`)).toBeNull();
    }
  });

  it('is on NOTHING when no turn is running', () => {
    /* The case that decides whether the mark is believed. */
    openEveryPane();
    render(
      <V3App appStore={shellWith({ running: false })} />,
    );

    for (const id of WORKSPACE_PILLS) {
      expect(screen.queryByTestId(`v3-pane-working-${id}`)).toBeNull();
    }
  });

  it('goes out the moment the turn settles, rather than fading on its own', () => {
    openEveryPane();
    const store = shellWith({ running: true });
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('v3-pane-working-architecture')).toBeTruthy();

    /* `act` because the dispatch is outside React's own event handling here —
       without it the assertion reads the render BEFORE the store's update,
       which would pass or fail on scheduling rather than on the rule. */
    act(() => {
      store.dispatch({ type: 'turn/stopped', at: 2 } as never);
    });
    expect(screen.queryByTestId('v3-pane-working-architecture')).toBeNull();
  });
});
