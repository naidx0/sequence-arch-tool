import { render, screen } from '@testing-library/react';
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
import { installResizeObserver } from './testResizeObserver';
import type { DocSession, DocSessionAction } from './docSession';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/**
 * THE ROW SAID "NOTHING ON THE BOARD CAN BE ADDED, RENAMED OR REMOVED".
 *
 * `docEdit.test.ts` proves the edit is correct and `docSession.test.ts` proves
 * a rescan cannot silently eat it. Neither proves the one thing the row is
 * actually about: that an edit reaches the pixels. This package has already
 * paid twice for the other outcome — state that was right while no surface read
 * it, with a heading that asserted the behaviour anyway. `canvasChannel.tsx`
 * opens with that story.
 *
 * So this mounts the REAL `ConnectedBoard` on the REAL provider stack, in the
 * order `App.tsx` nests it, and asserts against rendered text.
 */

const REPO = '/tmp/wiring';

/* Two services and one call — the smallest graph where a rename is visible and
   a delete leaves something behind to look at. */
const GRAPH = {
  repoName: 'wiring',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 12 },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', file: 'src/checkout.ts', line: 41 },
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

function storeWithGraph(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: graph.repoName ?? 'wiring',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt ?? '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  return store;
}

/** Reaches into the live channel so a test can edit the way a surface will. */
function Probe({ onReady }: { onReady: (c: { session: DocSession; dispatch: (a: DocSessionAction) => void }) => void }) {
  const channel = useDoc();
  onReady(channel);
  return null;
}

function mount(store: Store) {
  let channel: { session: DocSession; dispatch: (a: DocSessionAction) => void } | null = null;
  render(
    /* The provider order is `App.tsx`'s, not a convenient one — a test mounted
       on an arrangement that does not ship proves nothing about what ships. */
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <Probe onReady={(c) => (channel = c)} />
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return () => channel!;
}

function titles(): string[] {
  return screen
    .queryAllByTestId('board-node-title')
    .map((el) => el.textContent ?? '')
    .filter(Boolean);
}

describe('editing reaches the board', () => {
  it('paints the scanned document before anything is edited', () => {
    mount(storeWithGraph(GRAPH));
    expect(titles()).toContain('Gateway');
    expect(titles()).toContain('Checkout');
  });

  it('a rename shows the new name on the card', () => {
    const channel = mount(storeWithGraph(GRAPH));
    act(() => {
      channel().dispatch({ type: 'doc/rename-node', id: 'svc:gateway', label: 'Edge Gateway' });
    });
    /*
     * The assertion is on rendered text, not on `session.doc`. Asserting the
     * session here would pass with `ConnectedBoard` still painting the scanned
     * document — which is exactly the defect, and exactly what a state-level
     * assertion cannot see.
     */
    expect(titles()).toContain('Edge Gateway');
    expect(titles()).not.toContain('Gateway');
  });

  it('a drawn node appears on the board', () => {
    const channel = mount(storeWithGraph(GRAPH));
    act(() => {
      channel().dispatch({
        type: 'doc/add-node',
        id: 'draw:store-1',
        label: 'Franchise Store 1',
        kind: 'service',
      });
    });
    expect(titles()).toContain('Franchise Store 1');
  });

  it('a deleted node leaves the board, and takes its edge with it', () => {
    const channel = mount(storeWithGraph(GRAPH));
    expect(titles()).toContain('Checkout');
    act(() => {
      channel().dispatch({ type: 'doc/delete-node', id: 'svc:checkout' });
    });
    expect(titles()).not.toContain('Checkout');
    expect(titles()).toContain('Gateway');
    /* The cascade is what keeps this from being a board drawing a connector to
       a card that is not there. */
    expect(channel().session.doc?.edges).toHaveLength(0);
  });

  it('the session counts the edits the board is showing', () => {
    const channel = mount(storeWithGraph(GRAPH));
    act(() => {
      channel().dispatch({ type: 'doc/rename-node', id: 'svc:gateway', label: 'A' });
    });
    act(() => {
      channel().dispatch({ type: 'doc/rename-node', id: 'svc:checkout', label: 'B' });
    });
    expect(channel().session.edits).toBe(2);
  });

  it('a rescan under an unsaved edit does not wipe the board', () => {
    const store = storeWithGraph(GRAPH);
    const channel = mount(store);
    act(() => {
      channel().dispatch({
        type: 'doc/add-node',
        id: 'draw:store-1',
        label: 'Franchise Store 1',
        kind: 'service',
      });
    });

    /* The same repo, scanned again — the case that would otherwise delete the
       user's drawing between two renders with nothing said about it. */
    act(() => {
      store.dispatch({
        type: 'repo/loaded',
        draft: {
          root: REPO,
          repoName: 'wiring',
          graph: GRAPH,
          summary: summarizeGraph(GRAPH),
          scannedAt: '2026-08-22T01:00:00.000Z',
        },
        at: 1,
      });
    });

    expect(titles()).toContain('Franchise Store 1');
    expect(channel().session.baseChanged).toBe(true);
  });
});
