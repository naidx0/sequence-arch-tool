import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider, useDoc } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import { displayLabel } from './displayLabel.js';
import { installResizeObserver } from './testResizeObserver';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/**
 * THE ROW WAS ABOUT REACHABILITY, NOT ABOUT A REDUCER.
 *
 * `docEdit` proves the edit is correct, `docSession` proves a rescan cannot eat
 * it, `docWiring` proves the board repaints. None of those proves a PERSON can
 * do any of it — and "nothing on the board can be added, renamed or removed" is
 * a sentence about a person. CANON's rule is to build and judge from the user's
 * seat, so this test drives the gestures: right-click, click Rename, type,
 * Enter. No reducer is dispatched by hand anywhere in this file.
 */

const REPO = '/tmp/menu';

/* `path`, not `file`: `archNodeEvidenceRef` reads `path`, and a node without one
   gets no `evidenceRef` — which would make a SCANNED node look user-made to the
   Generate gate. The same field trap the export projector's test hit. */
const GRAPH = {
  repoName: 'menu',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', path: 'src/gateway.ts', line: 12 },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', path: 'src/checkout.ts', line: 41 },
    /* Inside the gateway, so "Open" has something to show. */
    { id: 'file:gw/app.ts', label: 'app.ts', kind: 'file', path: 'gw/app.ts', line: 1, parentId: 'svc:gateway' },
    { id: 'file:gw/routes.ts', label: 'routes.ts', kind: 'file', path: 'gw/routes.ts', line: 1, parentId: 'svc:gateway' },
  ],
  edges: [
    {
      id: 'e1',
      srcId: 'svc:gateway',
      dstId: 'svc:checkout',
      kind: 'call',
      confidence: 0.95,
      origin: 'deterministic',
    },
  ],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

/** Reaches the document channel so a test can add a node the product's way. */
let addNode: ((id: string, label: string) => void) | null = null;
function Probe() {
  const { dispatch } = useDoc();
  addNode = (id, label) => dispatch({ type: 'doc/add-node', id, label, kind: 'service' });
  return null;
}

function mount(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'menu',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

function card(label: string): HTMLElement {
  const shown = displayLabel(label);
  const found = screen
    .queryAllByTestId('board-node')
    .find((el) => el.textContent?.includes(shown));
  if (!found) throw new Error(`no card labelled ${shown}; saw ${titles().join(', ')}`);
  return found;
}

function titles(): string[] {
  return screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');
}

describe('the board menu', () => {
  it('is not open until someone opens it', () => {
    mount();
    expect(screen.queryByTestId('board-menu')).toBeNull();
  });

  it('right-clicking a node opens a menu naming that node', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    const menu = screen.getByTestId('board-menu');
    /* The accessible name carries the target, so a screen-reader user knows
       which node the two items are about — the sighted cue is proximity, and
       proximity is not available to everyone. */
    expect(menu.getAttribute('aria-label')).toBe('Edit gateway');
    expect(screen.getByTestId('board-menu-rename')).toBeTruthy();
    expect(screen.getByTestId('board-menu-delete')).toBeTruthy();
  });

  it('renames a node through the gesture a person would use', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-rename'));

    const input = screen.getByTestId('board-menu-rename-input') as HTMLInputElement;
    /* Seeded with the current name: a rename box that starts empty makes the
       common case — changing one word — a retype. */
    expect(input.value).toBe('gateway');

    fireEvent.change(input, { target: { value: 'Edge Gateway' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(titles()).toContain('Edge Gateway');
    expect(titles()).not.toContain('Gateway');
    /* And the menu is gone — a menu that survives its own action leaves the
       reader to dismiss a thing that already did what they asked. */
    expect(screen.queryByTestId('board-menu')).toBeNull();
  });

  it('Escape abandons a rename without changing anything', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-rename'));
    const input = screen.getByTestId('board-menu-rename-input');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(titles()).toContain('Gateway');
    expect(titles()).not.toContain('Nope');
  });

  it('deletes a node through the menu', () => {
    mount();
    fireEvent.contextMenu(card('checkout'));
    fireEvent.click(screen.getByTestId('board-menu-delete'));
    expect(titles()).not.toContain('Checkout');
    expect(titles()).toContain('Gateway');
  });

  it('undo takes a deleted node back — the reason delete is safe to offer', () => {
    mount();
    fireEvent.contextMenu(card('checkout'));
    fireEvent.click(screen.getByTestId('board-menu-delete'));
    expect(titles()).not.toContain('Checkout');

    /* The accelerator every reader already has. Delete is one click away and
       the arrangement it removes may have taken an hour. */
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(titles()).toContain('Checkout');
  });

  it('undo takes a rename back too', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-rename'));
    const input = screen.getByTestId('board-menu-rename-input');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(titles()).toContain('Renamed');

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(titles()).toContain('Gateway');
  });

  /* ═══ opening a service ═════════════════════════════════════════════════ */

  it('a service with something inside can be OPENED', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-open'));

    /*
     * The owner's ruling was SYSTEMS LAYER ONLY, no nesting — "but a service
     * must still be openable". Opening REPLACES the view: one level is on
     * screen at a time and the level changes.
     */
    expect(titles()).toContain('app.ts');
    expect(titles()).toContain('routes.ts');
    /* The systems layer is gone, not drawn underneath. */
    expect(titles()).not.toContain('Checkout');
  });

  it('the opened view says which service, and how to leave', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.click(screen.getByTestId('board-menu-open'));

    const bar = screen.getByTestId('board-interior');
    expect(bar.textContent).toContain('Inside gateway');
    /* A view you can enter and not leave is a trap, and the reader's only other
       option would be a rescan. */
    fireEvent.click(screen.getByTestId('board-interior-close'));
    expect(screen.queryByTestId('board-interior')).toBeNull();
    expect(titles()).toContain('Checkout');
  });

  it('a service with nothing inside shows Open DISABLED, and says why', () => {
    mount();
    fireEvent.contextMenu(card('checkout'));

    /*
     * OWNER WALK 2026-08-22, item A4 — "Open scope doesn't open up."
     *
     * This row used to assert the item was ABSENT, on the reasoning that "a
     * control that opens an empty room is worse than no control". That
     * reasoning is right and is NOT weakened here: the item below opens
     * nothing. What changed is the other half — a reader who right-clicks two
     * services and sees Open on neither concludes the feature does not exist.
     * Silence and absence are the same pixels.
     *
     * So it renders disabled WITH THE REASON, which is the rule
     * `CommandSurface` already states for commands the shell cannot run:
     * "rendered DISABLED WITH THE REASON rather than hidden — a row that
     * disappears teaches nothing".
     */
    const open = screen.getByTestId('board-menu-open') as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute('aria-disabled')).toBe('true');
    /* The reason names the SCAN, because that is what decided it — the service
       is not broken and neither is the board. */
    expect(open.getAttribute('title')).toMatch(/scan/i);
  });

  it('a double-click opens a service, without going near the menu', () => {
    /*
     * OWNER WALK 2026-08-22, A4 — the other half. Making the menu item honest
     * fixes what a reader sees AFTER they find the context menu; it does
     * nothing for the reader who never right-clicks a canvas. Open was the
     * product's own drill-in and it was reachable by exactly one gesture that
     * nothing on screen suggested.
     *
     * Double-click is the gesture every canvas in the world uses for "go
     * inside this", so it is discovered by trying rather than by being told.
     */
    mount();
    fireEvent.doubleClick(card('gateway'));
    expect(screen.getByTestId('board-interior')).toBeTruthy();
  });

  it('a double-click on a service with nothing inside opens nothing', () => {
    /* Same rule as the disabled menu item, on the other gesture: an empty room
       does not get opened by either door. */
    mount();
    fireEvent.doubleClick(card('checkout'));
    expect(screen.queryByTestId('board-interior')).toBeNull();
  });

  it('the disabled Open opens nothing when pressed', () => {
    /* The half of the old assertion that must survive verbatim: an empty room
       still does not get opened. */
    mount();
    fireEvent.contextMenu(card('checkout'));
    fireEvent.click(screen.getByTestId('board-menu-open'));
    expect(screen.queryByTestId('board-interior')).toBeNull();
  });

  /* ═══ the Generate gate ═════════════════════════════════════════════════ */

  it('Generate is NOT offered on a node the scan proved', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    /*
     * `gateway` is in the code. Offering to generate it would invite a second
     * answer to a question the repository has settled, and afterwards nobody
     * could tell the invented one from the found one.
     */
    expect(screen.queryByTestId('board-menu-generate')).toBeNull();
  });

  it('Generate IS offered on a node a person added, and does NOT fire on the first click', () => {
    const store = mount();
    act(() => addNode!('draw:store-1', 'Franchise Store 1'));

    fireEvent.contextMenu(card('Franchise Store 1'));
    fireEvent.click(screen.getByTestId('board-menu-generate'));

    /*
     * THE OWNER'S SHARPEST CONSTRAINT: "Drawing a box must NOT fire a code
     * proposal. Generate is an explicit act with a CONFIRMATION STEP." One
     * click opens the arm and sends nothing.
     */
    expect(screen.getByTestId('board-menu-generate-confirm')).toBeTruthy();
    expect(store.getState().composer.draft).toBe('');
  });

  it('the confirm arm offers a NOTE or FILES, and only then does anything happen', () => {
    const store = mount();
    act(() => addNode!('draw:store-1', 'Franchise Store 1'));

    fireEvent.contextMenu(card('Franchise Store 1'));
    fireEvent.click(screen.getByTestId('board-menu-generate'));
    fireEvent.change(screen.getByTestId('board-menu-generate-note'), {
      target: { value: 'owns invoices' },
    });
    fireEvent.click(screen.getByTestId('board-menu-generate-describe'));

    const draft = store.getState().composer.draft;
    /* The person's own words, unparaphrased — step 5 of the owner's model. */
    expect(draft).toContain('owns invoices');
    expect(draft).toMatch(/Do not propose files/);
    /*
     * And it lands in the COMPOSER rather than being sent. The person presses
     * send, so a canvas gesture never starts a run on its own and they can edit
     * the question first.
     */
    expect(store.getState().session.turns).toHaveLength(0);
  });

  it('Escape closes the menu', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    expect(screen.getByTestId('board-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-menu')).toBeNull();
  });

  it('a click outside closes the menu', () => {
    mount();
    fireEvent.contextMenu(card('gateway'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('board-menu')).toBeNull();
  });
});
