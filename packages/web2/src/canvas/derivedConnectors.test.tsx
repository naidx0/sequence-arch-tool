import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import { installResizeObserver } from './testResizeObserver';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   THE DERIVED LAYER, END TO END — the count reaches the pixels.
   packages/web2/src/canvas/derivedConnectors.test.tsx

   WHAT WAS MEASURED, on this monorepo, in the shipped bundle.

   The Architecture board drew ZERO connectors between eleven service cards and
   said so honestly. The edges existed: rolling the scan's 2,186 import edges up
   by their files' `parentId` yields 269 cross-service imports collapsing to
   twelve service->service pairs above the threshold — 84 analyzer->schema,
   63 web2->api-types, 49 web2->schema, 3 mcp->analyzer, and so on. Every one is
   grounded: each member import carries {file, line, snippet}.

   `deriveImportEdges` had computed all of that for a year. THREE things stopped
   it reaching the reader, and this file locks all three:

     1. `ConnectedBoard` mapped each derived edge to `{id, source, target,
        proof}` and DROPPED `d.label` — nine lines after a comment promising
        "its label counts imports and never says calls". All twelve painted
        identically, so the one thing the inference carries — how strong the
        coupling is — died at the render boundary.
     2. Nothing drew an edge label at all. `BoardEdge` had no label field and
        `ElbowEdge` rendered a `<BaseEdge>` and nothing else.
     3. The layer was offered only on a board with NO connector whatsoever. This
        repository scans exactly one (a real db_access), so the test failed by
        one edge and ten unjoined cards sat beside twelve real dependencies
        nobody had a reason to go looking for.

   WHAT IS NOT BEING CLAIMED, and the assertions below are written to keep it
   that way: an import is not a call. The connector stays `derived` — its own
   proof state, its own dotted hairline ink, its own arrowhead — and its words
   are arithmetic ("3 imports"), never a verb.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = '/tmp/derived';

/**
 * Two services, four files, and imports that cross the boundary three times.
 *
 * THREE IS THE THRESHOLD `derivedEdges.ts` PUBLISHES, and the fixture sits
 * exactly on it rather than comfortably above it: a fixture that clears a floor
 * by a mile cannot tell you the floor is still there. The reverse direction has
 * ONE import, which is below the floor, so it must not be drawn — that pair is
 * the negative case in the same graph.
 *
 * NO INTERACTION EDGE. The scan finds no http, no queue, no db access here, so
 * both cards are joined to nothing and the board has to decide what to say
 * about them. That is the state this whole layer exists for.
 */
const GRAPH = {
  repoName: 'derived',
  scannedAt: '2026-08-28T00:00:00.000Z',
  nodes: [
    { id: 'svc:analyzer', label: 'analyzer', kind: 'service', file: 'packages/analyzer', line: 1 },
    { id: 'svc:schema', label: 'schema', kind: 'service', file: 'packages/schema', line: 1 },
    {
      id: 'file:analyzer/scan.ts',
      label: 'scan.ts',
      kind: 'file',
      parentId: 'svc:analyzer',
      file: 'packages/analyzer/src/scan.ts',
      line: 1,
    },
    {
      id: 'file:analyzer/server.ts',
      label: 'server.ts',
      kind: 'file',
      parentId: 'svc:analyzer',
      file: 'packages/analyzer/src/server.ts',
      line: 1,
    },
    {
      id: 'file:schema/graph.ts',
      label: 'graph.ts',
      kind: 'file',
      parentId: 'svc:schema',
      file: 'packages/schema/src/graph.ts',
      line: 1,
    },
    {
      id: 'file:schema/seqd.ts',
      label: 'seqd.ts',
      kind: 'file',
      parentId: 'svc:schema',
      file: 'packages/schema/src/seqd.ts',
      line: 1,
    },
  ],
  edges: [
    ...['file:schema/graph.ts', 'file:schema/seqd.ts', 'file:schema/graph.ts'].map((dst, i) => ({
      id: `imp${i}`,
      srcId: i === 2 ? 'file:analyzer/server.ts' : 'file:analyzer/scan.ts',
      dstId: dst,
      kind: 'import',
      confidence: 1,
      origin: 'deterministic',
      evidence: [{ file: 'packages/analyzer/src/scan.ts', line: 3 + i, snippet: `import x${i}` }],
    })),
    /* One import the other way — below the floor of three, so the board must
       NOT draw schema -> analyzer. */
    {
      id: 'imp-back',
      srcId: 'file:schema/graph.ts',
      dstId: 'file:analyzer/scan.ts',
      kind: 'import',
      confidence: 1,
      origin: 'deterministic',
      evidence: [{ file: 'packages/schema/src/graph.ts', line: 9, snippet: 'import y' }],
    },
  ],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function mount(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: graph.repoName ?? 'derived',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt ?? '2026-08-28T00:00:00.000Z',
    },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

function labels(): string[] {
  return screen.queryAllByTestId('board-edge-label').map((el) => el.textContent ?? '');
}

describe('derived connectors carry their count to the screen', () => {
  it('draws the inferred dependency without the reader having to find a toggle', () => {
    /* The old condition was "the board has no connector at all". The real
       question is whether there are cards the board has nothing to say about,
       and here there are two. */
    mount(GRAPH);
    const edges = screen.queryAllByTestId('board-edge');
    expect(edges.length).toBe(1);
    expect(edges[0]!.getAttribute('data-proof')).toBe('derived');
  });

  it('writes the COUNT on the connector, which is the whole of the claim', () => {
    mount(GRAPH);
    expect(labels()).toEqual(['3 imports']);
  });

  it('says "imports" and never a word about calls', () => {
    /* An import is a fact about files. Every stronger verb would be a fact
       about behaviour that nothing measured — and `proofOf` spends the word
       "traced" on real imports, so this is the exact confusion the separate
       proof state exists to prevent. */
    mount(GRAPH);
    for (const text of labels()) {
      expect(text).toMatch(/^\d+ imports?$/);
      expect(text).not.toMatch(/call/i);
    }
  });

  it('does not draw the pair that is under the threshold', () => {
    /* schema -> analyzer has one import. A floor of one draws every pair
       sharing a single import, which is the hairball arriving by default
       rather than by choice. */
    mount(GRAPH);
    expect(screen.queryAllByTestId('board-edge').length).toBe(1);
    expect(labels()).not.toContain('1 import');
  });

  it('offers the count on the toggle as well, so the label says what pressing it draws', () => {
    mount(GRAPH);
    expect(screen.getByTestId('board-derived-toggle').textContent).toBe('Imports (1)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE CONDITION, ON THE SHAPE THAT ACTUALLY OCCURS.

   This monorepo's scan produces exactly ONE interaction edge — svc:analyzer ->
   ds:analyzer-db, a real db_access inferred from real table use — and 2,186
   imports. Under the old condition ("offer the inference only if the board has
   no connector at all") that one edge was enough to keep twelve grounded
   service->service dependencies behind an unpressed toggle, while ten of the
   eleven cards sat joined to nothing.

   The graph below is that shape, minimised: one real connector, one card the
   scan says nothing about, and a real import relationship between them.
   ══════════════════════════════════════════════════════════════════════════ */
const GRAPH_WITH_ONE_REAL_EDGE = {
  ...GRAPH,
  nodes: [
    ...(GRAPH.nodes as unknown[]),
    { id: 'ds:analyzer-db', label: 'analyzer-db', kind: 'datastore', file: 'packages/analyzer', line: 2 },
  ],
  edges: [
    ...(GRAPH.edges as unknown[]),
    {
      id: 'db1',
      srcId: 'svc:analyzer',
      dstId: 'ds:analyzer-db',
      kind: 'db_read',
      confidence: 0.9,
      origin: 'deterministic',
      evidence: [{ file: 'packages/analyzer/src/scan.ts', line: 20, snippet: 'select * from x' }],
    },
  ],
} as unknown as GetArchGraphResponse;

describe('a board with one connector and an unjoined card', () => {
  it('still offers the inference, because there is a card it has nothing to say about', () => {
    mount(GRAPH_WITH_ONE_REAL_EDGE);
    const proofs = screen.queryAllByTestId('board-edge').map((e) => e.getAttribute('data-proof'));
    /* The scanned db_access AND the inferred dependency, each in its own ink.
       Before the condition was widened this board drew one connector and hid
       the other behind a toggle. */
    expect(proofs.sort()).toEqual(['declared', 'derived']);
  });

  it('labels BOTH kinds of connector, each in its own proof state', () => {
    /* The scanned edge says what the scan read off the database access
       ('read'); the inferred one says how many imports cross the boundary. Two
       different strengths of claim, two different words, two different inks —
       and neither is silent, which is what the board was before it drew any
       edge label at all. */
    mount(GRAPH_WITH_ONE_REAL_EDGE);
    const tags = screen
      .queryAllByTestId('board-edge-label')
      .map((el) => `${el.getAttribute('data-proof')}:${el.textContent}`)
      .sort();
    expect(tags).toEqual(['declared:read', 'derived:3 imports']);
  });

  it('does not restate the scanned edge as an inference', () => {
    /* The derived layer is aggregated from imports only, and the db_access edge
       is a reading — it keeps its own proof state and is never counted twice. */
    mount(GRAPH_WITH_ONE_REAL_EDGE);
    expect(labels().filter((t) => /imports?$/.test(t)).length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE LAYOUT DIRECTION CONTROL — live, or not offered.

   MEASURED IN THE SHIPPED BUNDLE: clicking "Vertical" flipped `aria-pressed`
   correctly (Vertical true / Horizontal false) and the rendered layout was
   byte-identical — bounding box 160x677 at the same coordinates before and
   after. The control was live and the algorithm under it was not one that takes
   a direction: `elkGraphFor` picks `rectpacking` when no edge is drawn, and
   'where do N boxes go in a rectangle of this shape' has no left-to-right in
   it, so `elk.direction` is not even passed on that branch.

   Two halves, both asserted here: feed the layout the connectors the board is
   actually drawing and the layered path — the one that honours a direction — is
   taken; and when there is genuinely nothing to layer, do not offer a control
   that cannot do anything.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the layout direction control is live or absent, never inert', () => {
  it('is offered once the board has connectors to lay out', () => {
    mount(GRAPH);
    expect(screen.queryByTestId('board-derived-toggle')!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryAllByTestId('board-edge').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('board-layout-vertical')).not.toBeNull();
    expect(screen.queryByTestId('board-layout-horizontal')).not.toBeNull();
  });

  it('is withheld on a board with nothing to layer', () => {
    /* No imports either, so there is no inference to offer and no scanned
       connector to lay out — the rectpacking case, where a direction is not a
       question the algorithm can answer. */
    mount({ ...GRAPH, edges: [] } as unknown as GetArchGraphResponse);
    expect(screen.queryAllByTestId('board-edge').length).toBe(0);
    expect(screen.queryByTestId('board-layout-vertical')).toBeNull();
    expect(screen.queryByTestId('board-layout-horizontal')).toBeNull();
  });
});
