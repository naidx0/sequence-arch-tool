import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board } from './Board';
import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { EMPTY_CANVAS } from '../state/initial';
import { LOD_LADDER } from './lod';
import { StoreProvider, createStore } from '../state';
import { canvasReduce } from './canvasReduce';
import { installResizeObserver } from './testResizeObserver';
import { projectDocument } from './project';
import { readShellPersisted, readShellTokens } from '../shell';
import { seqdFromGraph } from './seqdFromGraph';
import { summarizeGraph } from '../boot';
import { VISUAL_MODE_STORAGE_KEY, boardVisualKey } from './visualMode';
import type { GetArchGraphResponse } from '@sequence/api-types';
import type { SeqDiagramV1 } from '../../../schema/src/seqdiagram.js';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   VISUAL MODE — THE TWO LOCKS THE MADR SAYS THE WHOLE MODE STANDS ON
   packages/web2/src/canvas/visualBoard.test.tsx

   docs/decisions/visual-board-mode-madr.md §0, amendments A2 and A4.

   ── A4, DETERMINISM ───────────────────────────────────────────────────────

   Max, 2026-09-02: "it's important that it doesn't randomly generate this every
   time. It has to be actually consistent with our design format … a consistent
   React thing."

   The cheapest possible proof is the one written below: render the same
   document twice and deep-equal the result — the order the cards come out in,
   the transform each one is placed with, the classes each one paints with, and
   the text each one carries. It would fail on a `Math.random`, on a `Date.now`,
   on an unstable sort comparator, and on any layout that read an unordered
   collection as an order.

   ── A2 / DECISION 2, THE GROUNDING CONTRACT ──────────────────────────────

   "Visual mode adds no data … render the same document in both modes and assert
   the node set, the edge set and every rendered number are identical — only
   geometry, silhouette and motion may differ. That test is the whole defence of
   the binding decision at the UI layer; without it 'design-quality' quietly
   becomes 'the pretty one shows more'."

   Read A2 with it: Visual MAY draw structure the spec already carries and the
   plain view collapses — the kind word, the provenance, the part names. So the
   parity assertion is about the FACTS, not about the pixel count: same node
   ids, same edge ids, and no numeral on screen that the specification does not
   carry.
   ══════════════════════════════════════════════════════════════════════════ */

/* A grounded document with the two evidence shapes `provenanceOf` tells apart
   (a ref that lands on a LINE is traced; one that does not is declared) and
   with a `detail.parts` array, because the part NAMES are the structure A2
   permits Visual to surface and nothing else in this package draws them. */
const DOC = {
  version: 1,
  kind: 'architecture',
  title: 'visual fixture',
  grounded: { repoRoot: '/tmp/visual', scannedAt: '2026-09-02T00:00:00.000Z' },
  nodes: [
    {
      id: 'svc:gateway',
      label: 'gateway',
      kind: 'service',
      evidenceRef: 'scan:src/gateway.ts:12',
      detail: { whatItDoes: 'Fronts every request.', parts: ['routes', 'auth', 'limits'] },
    },
    {
      id: 'svc:checkout',
      label: 'checkout',
      kind: 'service',
      evidenceRef: 'scan:src/checkout.ts:41',
      detail: { whatItDoes: 'Takes the money.' },
    },
    {
      id: 'db:orders',
      label: 'orders',
      kind: 'datastore',
      evidenceRef: 'scan:compose:orders',
      detail: { parts: ['orders', 'refunds'] },
    },
  ],
  edges: [
    { id: 'e1', from: 'svc:gateway', to: 'svc:checkout', family: 'call' },
    { id: 'e2', from: 'svc:checkout', to: 'db:orders', family: 'db' },
  ],
} as unknown as SeqDiagramV1;

const CANVAS = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

/**
 * The lazy chunk, resolved before anything renders.
 *
 * `Board.tsx` reaches `VisualMetaStrip` through `React.lazy`, which is the
 * whole point (a reader with Visual off never fetches it). Awaiting the same
 * module here settles the promise `lazy` will throw, so one `act` flush is
 * enough and the test is not racing a dynamic import.
 */
async function preloadVisualChunk(): Promise<void> {
  await import('./visual/VisualMetaStrip');
}

async function mount(visual: boolean, selection: readonly string[] = []) {
  await preloadVisualChunk();
  /* PROJECTED FRESH ON EVERY MOUNT, and that is the point rather than an
     oversight. A module-level projection would make the A4 lock a statement
     about React alone; re-running `projectDocument` puts the projector inside
     the loop, so a shuffle, a `Math.random` tie-break or a Map read as an order
     anywhere in it turns the deep-equal below red. Measured: it does — see the
     wave's mutation proof. */
  const projection = projectDocument(DOC);
  const canvas = selection.reduce(
    (slice, nodeId, index) =>
      canvasReduce(slice, { type: 'canvas/select', nodeId, additive: index > 0 }),
    CANVAS,
  );
  const view = render(
    <Board
      canvas={canvas}
      nodes={projection.nodes}
      edges={projection.edges}
      positions={projection.positions}
      dispatch={() => {}}
      onGround={() => {}}
      visual={visual}
    />,
  );
  /* Suspense resolves on a microtask once the module is in the cache. */
  await act(async () => {});
  return view;
}

/** What a rendered board IS, as far as A4 is concerned: which cards, in what
 *  order, placed where, painted with what, saying what. */
function snapshotCards(container: HTMLElement) {
  return [...container.querySelectorAll('.react-flow__node')].map((wrapper) => {
    const card = wrapper.querySelector('[data-testid="board-node"]');
    return {
      id: card?.getAttribute('data-node-id') ?? null,
      transform: (wrapper as HTMLElement).style.transform,
      className: card?.getAttribute('class') ?? null,
      kind: card?.getAttribute('data-kind') ?? null,
      text: card?.textContent ?? null,
    };
  });
}

function nodeIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid="board-node"]')]
    .map((el) => el.getAttribute('data-node-id') ?? '')
    .sort();
}

function edgeIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.react-flow__edge')]
    .map((el) => el.getAttribute('data-id') ?? '')
    .sort();
}

/** Every numeral a card puts on screen. */
function numeralsOnCards(container: HTMLElement): string[] {
  const found = new Set<string>();
  for (const card of container.querySelectorAll('[data-testid="board-node"]')) {
    for (const match of (card.textContent ?? '').matchAll(/\d+/g)) found.add(match[0]);
  }
  return [...found].sort();
}

/**
 * The numerals a card is ALLOWED to print.
 *
 * THE FIRST VERSION OF THIS FUNCTION LAUNDERED FABRICATED NUMBERS, and it is
 * worth stating how, because the shape recurs. It built the allow-set from every
 * digit run in `JSON.stringify(doc)` — which on this fixture alone is
 * {1, 2, 3, 12, 41, 00, 09, 02, 000, 2026}: "1" and "2" from the edge ids
 * `e1`/`e2`, "12" and "41" from the `:12`/`:41` line numbers inside
 * `evidenceRef`, and the rest from `grounded.scannedAt`. None of those is a
 * number a card may print, and all of them passed. A later row that invented an
 * inbound-edge count "2", a "1 of 3" position, or a "since 2026" badge would
 * have been waved through by a collision with a line number — and this test is
 * what the MADR calls "the whole defence of the binding decision at the UI
 * layer". The cited mutation proof (a fabricated 7) only caught anything
 * because 7 happens not to occur in this fixture.
 *
 * SO THE SET IS BUILT FROM THE FIELDS A CARD ACTUALLY DRAWS, not from the file
 * the card was built out of: the node's own label, the English `project.ts`
 * turns into the glance line, and the part names — plus the LENGTH of that part
 * list, which is the one derivation `project.ts` sanctions (`count: {label:
 * 'parts', value: String(parts.length)}`) and Graphite law 4 permits, because it
 * is a count of things the document lists rather than a number somebody
 * supplied. Ids, evidence refs, edge records and the scan timestamp are
 * deliberately NOT sources: nothing on a card renders any of them as text.
 */
function specNumerals(doc: SeqDiagramV1): Set<string> {
  const allowed = new Set<string>();
  const admit = (text: string | undefined | null) => {
    if (!text) return;
    for (const match of text.matchAll(/\d+/g)) allowed.add(match[0]);
  };
  for (const node of doc.nodes) {
    admit(node.label);
    admit(node.detail?.whatItDoes);
    for (const part of node.detail?.parts ?? []) admit(part);
    const parts = node.detail?.parts;
    if (parts?.length) allowed.add(String(parts.length));
  }
  return allowed;
}

describe('A4 — the same spec renders the same picture, every time', () => {
  it('two renders of one document are identical, card for card', async () => {
    const first = await mount(true);
    const a = snapshotCards(first.container);
    first.unmount();

    const second = await mount(true);
    const b = snapshotCards(second.container);
    second.unmount();

    /* Vacuity guard: an empty list deep-equals an empty list, and this file's
       whole claim would then be a tick that checked nothing. */
    expect(a.length).toBe(DOC.nodes.length);
    expect(a).toEqual(b);
  });

  it('the card ORDER follows the document, not the solver or a Set', async () => {
    /* A4's tie-break rule: "Where a layout needs a tie-break it breaks it on
       the spec's own order." The seed layout walks `doc.nodes`, so the drawn
       order is the authored order — and this is the assertion that would go red
       if anything downstream started iterating a Map or sorting by label. */
    const view = await mount(true);
    expect(
      [...view.container.querySelectorAll('[data-testid="board-node"]')].map((el) =>
        el.getAttribute('data-node-id'),
      ),
    ).toEqual(DOC.nodes.map((n) => n.id));
  });

  it('the projection itself is a pure function of the document', async () => {
    /* One level below the pixels, and worth its own line: if `projectDocument`
       were not stable, nothing above it could be. */
    expect(projectDocument(DOC)).toEqual(projectDocument(DOC));
  });
});

describe('decision 2 — Visual adds no data', () => {
  it('draws exactly the same nodes as the plain board', async () => {
    const plain = await mount(false);
    const plainIds = nodeIds(plain.container);
    plain.unmount();

    const visual = await mount(true);
    expect(nodeIds(visual.container)).toEqual(plainIds);
    expect(plainIds).toEqual([...DOC.nodes.map((n) => n.id)].sort());
    visual.unmount();
  });

  it('draws exactly the same connectors as the plain board', async () => {
    const plain = await mount(false);
    const plainEdges = edgeIds(plain.container);
    plain.unmount();

    const visual = await mount(true);
    expect(edgeIds(visual.container)).toEqual(plainEdges);
    expect(plainEdges).toEqual([...DOC.edges.map((e) => e.id)].sort());
    visual.unmount();
  });

  it('puts no numeral on a card that the specification does not carry', async () => {
    /* The whole defence of the binding decision at the UI layer. Geometry,
       silhouette and spacing may differ between the modes; a number may not
       appear in one and not the other, and no number may appear at all that is
       not in the document or a count of what the document lists. */
    const visual = await mount(true);
    const drawn = numeralsOnCards(visual.container);
    const allowed = specNumerals(DOC);
    expect(drawn.length).toBeGreaterThan(0);
    for (const numeral of drawn) {
      expect(allowed.has(numeral), `${numeral} is on a card and not in the spec`).toBe(true);
    }
    visual.unmount();
  });

  it('does not let an id, a line number or the scan clock into the allowed set', () => {
    /* The guard on the guard. Every numeral below IS in this document's JSON —
       `e1`/`e2`, the `:12` and `:41` inside the evidence refs, and
       `2026-09-02T00:00:00.000Z` — and every one of them was accepted while the
       allow-set was built by running a digit regex over the serialised file. A
       card that printed "1 of 3", an inbound-edge count, or a "since 2026"
       badge would have passed. None of these is a number a card may draw, so
       none of them may be a licence for one. */
    const allowed = specNumerals(DOC);
    for (const laundered of ['1', '12', '41', '2026', '09', '00', '000']) {
      expect(allowed.has(laundered), `${laundered} is spec text, not a number a card may print`)
        .toBe(false);
    }
    /* And it is not vacuous the other way: the one derivation that IS sanctioned
       is still allowed, and it is what the cards actually draw. */
    expect([...allowed].sort()).toEqual(['2', '3']);
  });
});

describe('A2 — Visual shows structure the plain view collapses', () => {
  it('prints the kind WORD, which no card has ever carried', async () => {
    const plain = await mount(false);
    expect(plain.container.querySelectorAll('[data-testid="board-node-meta"]')).toHaveLength(0);
    plain.unmount();

    const visual = await mount(true);
    const strips = visual.container.querySelectorAll('[data-testid="board-node-meta"]');
    expect(strips).toHaveLength(DOC.nodes.length);
    expect([...strips].map((el) => el.querySelector('.nd-meta-kind')!.textContent)).toEqual([
      'Service',
      'Service',
      'Datastore',
    ]);
    visual.unmount();
  });

  it('shows provenance at REST, which the plain card hides behind a click', async () => {
    const plain = await mount(false);
    expect(plain.container.querySelectorAll('[data-testid="board-node-provenance"]')).toHaveLength(0);
    plain.unmount();

    const visual = await mount(true);
    /* The words are `provenanceOf`'s answer verbatim: a ref ending in `:<line>`
       is a place the analyzer reached, anything else is a manifest's claim. */
    expect(
      [...visual.container.querySelectorAll('[data-testid="board-node-provenance"]')].map((el) =>
        el.getAttribute('data-provenance'),
      ),
    ).toEqual(['traced', 'traced', 'declared']);
    visual.unmount();
  });

  it('keeps the part NAMES off the resting card — the 2026-08-25 ruling', async () => {
    /* `glanceLine.ts` carries it verbatim: "Detail (paths, parts, provenance)
       waits for select / expand." Measured on this monorepo, drawn at rest the
       line reads `packages\analyzer\src · Packages\analyzer\src\explain\explain
       · …` — the path dump that ruling names, in the slot it names. A2 spends
       the resting row on the short words instead. */
    const visual = await mount(true);
    expect(visual.container.querySelectorAll('[data-testid="board-node-parts"]')).toHaveLength(0);
    expect(visual.container.querySelectorAll('[data-testid="board-node-meta"]')).toHaveLength(
      DOC.nodes.length,
    );
    visual.unmount();
  });

  it('names the parts on the SELECTED card, in the document order', async () => {
    const visual = await mount(true, ['svc:gateway']);
    const lines = [...visual.container.querySelectorAll('[data-testid="board-node-parts"]')];
    expect(lines.map((el) => el.textContent)).toEqual(['routes · auth · limits']);
    /* The whole list is reachable on hover, so a line the card had to cut is
       never information the reader cannot get to. */
    expect(lines[0]!.getAttribute('title')).toBe('routes · auth · limits');
    visual.unmount();
  });

  it('draws NO parts line, and no count, for a node the document says nothing about', async () => {
    /* Absent, never zeroed. `svc:checkout` carries no `parts`, so even selected
       it gets no line — not an empty one, and not a "0 parts". */
    const visual = await mount(true, ['svc:checkout']);
    const card = [...visual.container.querySelectorAll('[data-testid="board-node"]')].find(
      (el) => el.getAttribute('data-node-id') === 'svc:checkout',
    )!;
    expect(card.querySelector('[data-testid="board-node-parts"]')).toBeNull();
    expect(card.querySelector('[data-testid="board-node-count"]')).toBeNull();
    visual.unmount();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   AND THE CONTROL IS ACTUALLY REACHABLE — this repository's dominant failure
   mode is BUILT BUT NOT REACHED, so the toggle is asserted from the seat a
   reader sits in: the real `ConnectedBoard`, on a real scanned graph.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = '/tmp/visual-repo';

const GRAPH = {
  repoName: 'visual',
  scannedAt: '2026-09-02T00:00:00.000Z',
  nodes: [
    { id: 'svc:alpha', label: 'alpha', kind: 'service', file: 'packages/alpha', line: 1 },
    { id: 'svc:beta', label: 'beta', kind: 'service', file: 'packages/beta', line: 1 },
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function mountConnected() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'visual',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: GRAPH.scannedAt!,
    },
    at: 0,
  });
  return render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
}

describe('A1 — the board opens Visual, and the control turns it off', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('opens with Visual ON when nothing has been chosen', () => {
    const view = mountConnected();
    expect(screen.getByTestId('board').getAttribute('data-visual')).toBe('true');
    expect(screen.getByTestId('board-visual-toggle').getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('the control turns it OFF, and the board says so', () => {
    const view = mountConnected();
    act(() => {
      screen.getByTestId('board-visual-toggle').click();
    });
    expect(screen.getByTestId('board').getAttribute('data-visual')).toBe('false');
    expect(screen.getByTestId('board-visual-toggle').getAttribute('aria-pressed')).toBe('false');
    view.unmount();
  });

  it('remembers the refusal for THIS board across a remount', () => {
    const first = mountConnected();
    act(() => {
      screen.getByTestId('board-visual-toggle').click();
    });
    first.unmount();

    const second = mountConnected();
    expect(screen.getByTestId('board').getAttribute('data-visual')).toBe('false');
    second.unmount();

    /* Keyed on the repository ROOT, so the next scan of the same repo does not
       hand the reader back a mode they turned off. */
    const raw = JSON.parse(window.localStorage.getItem(VISUAL_MODE_STORAGE_KEY)!);
    expect(raw.boards[boardVisualKey(REPO, 'scratch')]).toBe(false);
  });

  it('promises only what the board actually draws, where the reader stands', () => {
    /* THE DEFECT THIS LOCKS. The first tooltip read "Visual mode is on. Cards
       show kind, provenance and the parts the scan found inside", and both
       halves were false at the seat: `NodeCard` and `cardHeight` gate the strip
       on `show.footer`, which `lod.ts` puts at rung 1 — zoom >= 1.00 — while the
       post-attach fit on this monorepo lands at 74%, rung 4. A reader opening
       the Architecture tab saw a highlighted control over a board with zero
       strips, being told the cards were showing three things none of which was
       on screen. And the part NAMES are `selected ? meta.parts : null` — never
       on a resting card at any zoom, by the 2026-08-25 ruling.

       The zoom is read out of the ladder rather than typed, so a rung floor
       that moves takes the sentence with it. */
    const floor = LOD_LADDER.find((step) => step.rung === 1)!.floor;
    const view = mountConnected();
    const title = screen.getByTestId('board-visual-toggle').getAttribute('title') ?? '';

    expect(title, 'the tooltip does not say at what zoom any of this appears').toContain(
      `${Math.round(floor * 100)}%`,
    );
    /* The parts may be mentioned, but only alongside the thing that reveals
       them. A sentence that names them at rest is the claim that was false. */
    if (/\bparts\b/i.test(title)) expect(title).toMatch(/\bselect\b/i);
    view.unmount();
  });

  it('sits on the board furniture, not in the composer mode menu', () => {
    /* MADR decision 1: the mode menu answers "what will this turn be allowed to
       do to my repository" and every row there is a claim about consequences.
       Visual is a claim about appearance, scoped to one board, true whether or
       not a turn is running — so it lives beside the direction toggle. */
    const view = mountConnected();
    const toggle = screen.getByTestId('board-visual-toggle');
    expect(toggle.closest('.boardtools')).not.toBeNull();
    view.unmount();
  });
});
