import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board } from './Board';
import { BoardMenu } from './BoardMenu';
import { EMPTY_CANVAS } from '../state/initial';
import {
  anatomyExtraHeight,
  anatomyPanel,
  indexAnatomy,
  ANATOMY_EXTRA_H,
  ANATOMY_MAP,
  ANATOMY_NOTE_H,
} from './anatomy';
import { cardHeight } from './cardBox';
import { canvasReduce } from './canvasReduce';
import { installResizeObserver } from './testResizeObserver';
import { projectDocument } from './project';
import type { ArchGraph, SeqDiagramV1 } from '@sequence/schema';
import type { BoardNode } from './NodeCard';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   ANATOMY, RENDERED — the wall on the card, and the gesture that opens it
   packages/web2/src/canvas/anatomyRendered.test.tsx

   The MODEL's five locks are `anatomyLocks.test.ts`. This file is about the
   three things that only exist once something paints:

     1  the wall is drawn INSIDE the node's own footprint, and the footprint
        was reserved for it before it painted — an unreserved 129px object is
        a treemap over the card's own border;
     2  a cell is keyed by node id in the DOM too, not only in the model;
     3  THE GESTURE. `onOpen` is a MENU action and still replaces the view, one
        level at a time. Anatomy is a third item that leaves it alone, and
        `boardMenuRendered.test.tsx` — the lock on that ruling — is untouched
        by this wave.
   ══════════════════════════════════════════════════════════════════════════ */

/* A repository shape with the two things Anatomy is about: a container whose
   children are MODULES AND FILES MIXED, and a child that holds nothing. */
const GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2026-09-02T00:00:00.000Z',
  repoRoot: '/fixtures/anatomy-render',
  repoName: 'anatomy-render',
  nodes: [
    { id: 'repo', kind: 'repo', label: 'anatomy-render' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api' },
    { id: 'mod:api/0', kind: 'module', label: 'server', parentId: 'svc:api', path: 'api/src' },
    /* A SECOND MODULE ON THE SAME PATH — the shape that collapses under a path
       key. Six real modules share `packages/analyzer/src` on this monorepo. */
    { id: 'mod:api/1', kind: 'module', label: 'detectors', parentId: 'svc:api', path: 'api/src' },
    {
      id: 'file:api/src/server.ts',
      kind: 'file',
      label: 'server.ts',
      parentId: 'mod:api/0',
      path: 'api/src/server.ts',
      meta: { loc: 800 },
    },
    {
      id: 'file:api/src/scan.ts',
      kind: 'file',
      label: 'scan.ts',
      parentId: 'mod:api/1',
      path: 'api/src/scan.ts',
      meta: { loc: 300 },
    },
    /* A service's DIRECT file child — on the real repository this bucket is
       237 tests, and it must be drawn as itself rather than blended in. */
    {
      id: 'file:api/api.test.ts',
      kind: 'file',
      label: 'api.test.ts',
      parentId: 'svc:api',
      path: 'api/api.test.ts',
      meta: { loc: 120 },
    },
    { id: 'ds:store', kind: 'datastore', label: 'store', parentId: 'svc:api' },
  ],
  edges: [
    {
      id: 'e:out',
      srcId: 'file:api/src/server.ts',
      dstId: 'ds:elsewhere',
      kind: 'db_read',
      confidence: 1,
      origin: 'deterministic',
      evidence: [{ file: 'api/src/server.ts', line: 4, snippet: 'select 1' }],
    },
  ],
  warnings: [],
};

const DOC = {
  version: 1,
  kind: 'architecture',
  title: 'anatomy fixture',
  grounded: { repoRoot: '/fixtures/anatomy-render', scannedAt: '2026-09-02T00:00:00.000Z' },
  nodes: [
    { id: 'svc:api', label: 'api', kind: 'service', evidenceRef: 'scan:api/src/server.ts:4' },
    /* ON THE BOARD, AND UNDER A SERVICE IN THE GRAPH — which is exactly the
       shape `ds:analyzer-db` has on this monorepo: parented to `svc:analyzer`
       by containment and drawn at the systems level all the same. So the one
       genuinely empty node in this repository IS reachable, and its copy is
       something a reader will actually meet. */
    { id: 'ds:store', label: 'store', kind: 'datastore', evidenceRef: 'scan:api/src/server.ts:4' },
  ],
  edges: [],
} as unknown as SeqDiagramV1;

const CANVAS = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

/** `Board` reaches the wall through `React.lazy` — settle the promise first so
 *  one act flush is enough and the test is not racing a dynamic import. */
async function preload(): Promise<void> {
  await import('./visual/AnatomyPanel');
}

async function mount(openOn: string | null) {
  await preload();
  const projection = projectDocument(DOC);
  const index = indexAnatomy(GRAPH);
  const view = render(
    <Board
      canvas={CANVAS}
      nodes={projection.nodes}
      edges={projection.edges}
      positions={projection.positions}
      dispatch={() => {}}
      onGround={() => {}}
      anatomy={openOn ? anatomyPanel(GRAPH, openOn, index) : null}
      anatomyKind={openOn ? index.node(openOn)?.kind : undefined}
      onCloseAnatomy={() => {}}
    />,
  );
  await act(async () => {});
  return view;
}

describe('anatomy — the wall on the card', () => {
  it('draws nothing until a node is opened on', async () => {
    const { container } = await mount(null);
    expect(container.querySelector('[data-testid="board-node-anatomy"]')).toBeNull();
  });

  it('draws the wall inside the opened node and nowhere else', async () => {
    const { container } = await mount('svc:api');
    const walls = container.querySelectorAll('[data-testid="board-node-anatomy"]');
    expect(walls).toHaveLength(1);
    const card = walls[0]!.closest('[data-testid="board-node"]');
    expect(card?.getAttribute('data-node-id')).toBe('svc:api');
  });

  it('adds NO board node and NO board edge — the ruling this wave must not cross', async () => {
    /* THE POINT OF THE WHOLE DESIGN, asserted rather than described. Opening a
       wall changes the board's node set and edge set by NOTHING: the four
       things inside `api` become cells in one card, never cards. That is what
       makes this a rendering rather than the second structural level the owner
       cut — see docs/COMPETITIVE-GAPS-2026-08-22.md §33. */
    const cards = (root: HTMLElement) =>
      [...root.querySelectorAll('[data-testid="board-node"]')]
        .map((el) => el.getAttribute('data-node-id'))
        .sort();
    const edges = (root: HTMLElement) =>
      [...root.querySelectorAll('.react-flow__edge')].map((el) => el.getAttribute('data-id')).sort();

    const shut = await mount(null);
    const before = { cards: cards(shut.container), edges: edges(shut.container) };
    shut.unmount();

    const open = await mount('svc:api');
    expect({ cards: cards(open.container), edges: edges(open.container) }).toEqual(before);
    /* And the wall really is showing more than one thing, so the parity above
       is not the parity of an empty picture. */
    expect(anatomyPanel(GRAPH, 'svc:api', indexAnatomy(GRAPH)).cells.length).toBeGreaterThan(1);
  });

  it('keys every cell by node id in the DOM, so same-path siblings both draw', async () => {
    const { container } = await mount('svc:api');
    const ids = [...container.querySelectorAll('[data-cell-id]')].map((el) =>
      el.getAttribute('data-cell-id'),
    );
    expect(ids).toContain('mod:api/0');
    expect(ids).toContain('mod:api/1');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws the service's direct file child as its own cell", async () => {
    const { container } = await mount('svc:api');
    expect(container.querySelector('[data-cell-id="file:api/api.test.ts"]')).not.toBeNull();
  });

  it('draws the child that holds nothing, and says the band is not to scale', async () => {
    const { container } = await mount('svc:api');
    const store = container.querySelector('[data-cell-id="ds:store"]');
    expect(store).not.toBeNull();
    expect(store?.getAttribute('data-to-scale')).toBe('false');
    expect(screen.getByTestId('board-node-anatomy-zero').textContent).toContain('not drawn to scale');
  });

  it('draws the leader from the CELL the edge actually leaves from', async () => {
    const { container } = await mount('svc:api');
    const leader = container.querySelector('[data-leader="mod:api/0"]');
    expect(leader).not.toBeNull();
    expect(leader?.getAttribute('data-leader-count')).toBe('1');
    /* Orthogonal, and it never bends: one axis changes, the other does not. */
    const d = leader!.querySelector('path')!.getAttribute('d')!;
    const [, x1, y1, x2, y2] = d.match(/M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/)!;
    expect(x1 === x2 || y1 === y2).toBe(true);
  });

  it('never draws a label wider than the cell it names', async () => {
    /* FOUND BY LOOKING, NOT BY REASONING, which is why it has a test. The first
       rule here was a bare 30px minimum width, and on the real repository it
       drew `detectors` — 54.0px of JetBrains Mono at --t-10 — inside a 43.0px
       cell, so the name ran across its neighbour and read as the neighbour's.
       The advance is exactly 6.0px per character on a mono face; this re-derives
       it from the rendered rect rather than trusting the predicate. */
    const { container } = await mount('svc:api');
    for (const text of container.querySelectorAll('.ana-label')) {
      const rect = text.parentElement!.querySelector('rect')!;
      const width = Number(rect.getAttribute('width'));
      expect((text.textContent ?? '').length * 6 + 6).toBeLessThanOrEqual(width);
    }
  });

  it('groups the leaders so the whole reading can recede together', async () => {
    const { container } = await mount('svc:api');
    const group = container.querySelector('.ana-leaders');
    expect(group).not.toBeNull();
    expect(group!.querySelectorAll('[data-leader]').length).toBeGreaterThan(0);
    /* Every leader is inside it — one that escaped would paint at full strength
       over a map whose claim is area. */
    expect(container.querySelectorAll('[data-leader]').length).toBe(
      group!.querySelectorAll('[data-leader]').length,
    );
  });

  it('says what a datastore IS when there is nothing inside it', async () => {
    const { container } = await mount('ds:store');
    const empty = container.querySelector('[data-testid="board-node-anatomy-empty"]');
    expect(empty?.textContent).toContain('datastore');
    /* NOT an apology for the scan: nothing was missed. */
    expect(empty?.textContent).not.toContain('recorded nothing');
    expect(container.querySelector('[data-testid="board-node-anatomy-map"]')).toBeNull();
  });
});

describe('anatomy — the footprint is reserved before it is painted', () => {
  const node: BoardNode = {
    id: 'svc:api',
    label: 'api',
    subtitle: null,
    present: { kind: 'service', entry: false },
    schemaKind: 'service',
    provenance: 'traced',
    count: null,
  };

  it('makes the card exactly one wall taller when the wall is open', () => {
    const shut = cardHeight(node, 1, false, null);
    const open = cardHeight(node, 1, false, { zeroCount: 0, bucketUnnamed: false });
    expect(open - shut).toBe(ANATOMY_EXTRA_H);
  });

  it('RESERVES THE ZERO-BAND NOTE — a third row, measured in the running app', () => {
    /* THE DEFECT THIS KILLS. `ANATOMY_EXTRA_H` is derived from the sheet's
       parts and covers two of the panel's children — the 24-unit header and
       the 129-unit map. The panel has THREE: `.ana-note`, the sentence saying
       the bottom band is not to scale, is 42 more. It renders only when the
       container has children that roll up to zero lines, so a boolean `anatomy`
       flag could not express it and a constant could not either.

       Measured on the running app before the fix: `svc:analyzer`, which holds
       `ds:analyzer-db` at zero lines, declared 190 board units and painted 262
       — hanging 72 outside the box its neighbours are positioned from. No
       collision on this repository's layout, and no test could have caught it,
       because every test asserts the DECLARED box. A denser repo finds it. */
    const withNote = cardHeight(node, 1, false, { zeroCount: 1, bucketUnnamed: false });
    const without = cardHeight(node, 1, false, { zeroCount: 0, bucketUnnamed: false });
    expect(withNote).toBeGreaterThan(without);
    expect(withNote - without).toBe(ANATOMY_NOTE_H);
    /* Three lines of --t-10 on --lh-10 plus its gap. Asserted as a floor rather
       than an equality against a literal, so the ramp stays the source. */
    expect(ANATOMY_NOTE_H).toBeGreaterThanOrEqual(14 * 3);
  });

  it('a container with NO empty child reserves no note', () => {
    /* The other half: over-reserving on every node would put dead ground under
       every open wall. Only the panels that draw the note pay for it. */
    expect(anatomyExtraHeight({ zeroCount: 0, bucketUnnamed: false })).toBe(ANATOMY_EXTRA_H);
    expect(anatomyExtraHeight(null)).toBe(0);
  });

  it('reserves more than the map itself — the wall has a frame', () => {
    /* An unreserved header and inset is a treemap drawn over the card's border,
       which is what `cardBox.ts`'s own header exists to refuse. */
    expect(ANATOMY_EXTRA_H).toBeGreaterThan(ANATOMY_MAP);
  });

  it('keeps the card the same WIDTH — the column rhythm is not anatomy business', async () => {
    const { container } = await mount('svc:api');
    const wrapper = container.querySelector('.react-flow__node') as HTMLElement;
    expect(wrapper.style.width).toBe('160px');
  });
});

describe('anatomy — the gesture, and the ruling it must not cross', () => {
  function menu(props: Partial<Parameters<typeof BoardMenu>[0]> = {}) {
    return render(
      <BoardMenu
        target={{ nodeId: 'svc:api', label: 'api', openable: true, x: 0, y: 0 }}
        onRename={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
        {...props}
      />,
    );
  }

  it('leaves Open exactly as it was — a separate item, with its own handler', () => {
    const opened: string[] = [];
    const anatomised: string[] = [];
    menu({ onOpen: (id) => opened.push(id), onAnatomy: (id) => anatomised.push(id) });

    screen.getByTestId('board-menu-open').click();
    expect(opened).toEqual(['svc:api']);
    expect(anatomised).toEqual([]);
  });

  it('opens the wall from its own item, and touches Open not at all', () => {
    const opened: string[] = [];
    const anatomised: string[] = [];
    menu({ onOpen: (id) => opened.push(id), onAnatomy: (id) => anatomised.push(id) });

    screen.getByTestId('board-menu-anatomy').click();
    expect(anatomised).toEqual(['svc:api']);
    expect(opened).toEqual([]);
  });

  it('offers no anatomy item when the scan has never heard of the node', () => {
    menu({ onOpen: () => {} });
    expect(screen.queryByTestId('board-menu-anatomy')).toBeNull();
  });

  it('reads as a toggle once the wall is open', () => {
    menu({ onAnatomy: () => {}, anatomyOpen: true });
    const item = screen.getByTestId('board-menu-anatomy');
    expect(item.getAttribute('aria-pressed')).toBe('true');
    expect(item.textContent).toBe('Hide anatomy');
  });

  it('closes from the wall header — §07.3, the header IS the control', async () => {
    await preload();
    const closed: string[] = [];
    const index = indexAnatomy(GRAPH);
    const { AnatomyPanel } = await import('./visual/AnatomyPanel');
    render(
      <AnatomyPanel
        panel={anatomyPanel(GRAPH, 'svc:api', index)}
        kind="service"
        onClose={() => closed.push('closed')}
      />,
    );
    screen.getByTestId('board-node-anatomy-head').click();
    expect(closed).toEqual(['closed']);
  });
});
