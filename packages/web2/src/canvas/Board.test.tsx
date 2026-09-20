import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { Board, boardNodePosition, type BoardEdge } from './Board';
import { CanvasProvider } from './canvasChannel';
import { DocProvider } from './docChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { EMPTY_CANVAS } from '../state/initial';
import { ConnectedShell, StoreProvider, createStore } from '../state';
import type { BoardNode } from './NodeCard';
import type { CanvasAction } from './canvasReduce';
import { canvasReduce } from './canvasReduce';
import { projectDocument } from './project';
import { installResizeObserver } from './testResizeObserver';
import type { SeqDiagramV1 } from '../../../schema/src/seqdiagram.js';

installResizeObserver();

/* ── a small grounded document, and nothing about it is invented ───────────
   Three nodes and two edges, with the two evidence shapes the projection has
   to tell apart: a ref that lands on a LINE (traced) and one that does not
   (declared). No counts, because nothing here computed one. */
const DOC = {
  version: 1,
  kind: 'architecture',
  title: 'fixture',
  grounded: { repoRoot: '/tmp/fixture', scannedAt: '2026-08-20T00:00:00.000Z' },
  nodes: [
    {
      id: 'svc:gateway',
      label: 'gateway',
      kind: 'service',
      evidenceRef: 'scan:src/gateway.ts:12',
      detail: { whatItIs: 'The way in.' },
    },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', evidenceRef: 'scan:src/checkout.ts:41' },
    { id: 'db:orders', label: 'orders', kind: 'datastore', evidenceRef: 'scan:compose:orders' },
  ],
  edges: [
    { id: 'e1', from: 'svc:gateway', to: 'svc:checkout', family: 'call' },
    { id: 'e2', from: 'svc:checkout', to: 'db:orders', family: 'db' },
  ],
} as unknown as SeqDiagramV1;

const NODES: BoardNode[] = [
  {
    id: 'svc:checkout',
    label: 'checkout',
    subtitle: 'Charges an order.',
    present: { kind: 'service', entry: false },
    schemaKind: 'service',
    provenance: 'traced',
    count: null,
  },
  {
    id: 'db:orders',
    label: 'orders',
    subtitle: null,
    present: { kind: 'storage', entry: false },
    schemaKind: 'datastore',
    provenance: 'declared',
    count: null,
  },
];

const EDGES: BoardEdge[] = [
  { id: 'e1', source: 'svc:checkout', target: 'db:orders', proof: 'traced' },
];

const POSITIONS = {
  'svc:checkout': { x: 0, y: 0 },
  'db:orders': { x: 320, y: 0 },
};

function mountBoard(over: Partial<Parameters<typeof Board>[0]> = {}) {
  const dispatched: CanvasAction[] = [];
  const onGround = vi.fn();
  const onExplain = vi.fn();
  const result = render(
    <Board
      canvas={canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 })}
      nodes={NODES}
      edges={EDGES}
      positions={POSITIONS}
      dispatch={(action) => dispatched.push(action)}
      onGround={onGround}
      onExplain={onExplain}
      {...over}
    />,
  );
  return { ...result, dispatched, onGround, onExplain };
}

/**
 * ITEM 3.4 — THE HOST.
 *
 * jsdom has no layout, so it cannot tell you where a card ended up. What it CAN
 * tell you is whether the board mounted one field, whether the edges reached
 * the DOM at all, and what the host dispatched. The rendered-value half —
 * radii, contrast, the field's transform — is `boardRendered.test.ts`.
 */
describe('item 3.6 — exactly one field', () => {
  it('declares one background-image, on the root, and nowhere else in the subtree', () => {
    // Sheet 05.9 assertion 2, and the defect it names: v1 draws TWO fields — a
    // 24px dot grid and a 26px line grid on separate layers, one static and one
    // tracking. Two pitches two pixels apart do not add detail; they beat, and
    // the beat crawls when the camera moves.
    //
    // Read off the STYLESHEET rather than off a computed style, because jsdom
    // does not substitute custom properties: what is asserted is that exactly
    // one rule in board.css sets background-image, and that its selector is the
    // board root. The browser tier asserts the painted consequence.
    const sheets = [...document.styleSheets];
    const declaring: string[] = [];
    for (const sheet of sheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!rule.selectorText.includes('board')) continue;
        const image = rule.style.getPropertyValue('background-image');
        if (image && image !== 'none') declaring.push(`${rule.selectorText} → ${image}`);
      }
    }

    expect(declaring).toHaveLength(1);
    expect(declaring[0]).toContain('.board-scope.board');
    expect(declaring[0]).toContain('radial-gradient');
  });

  it('drives the field off the camera, in three custom properties and no more', () => {
    // "pan writes background-position, zoom writes background-size, and both
    // stay locked to the content layer's own translate and scale." A field
    // nailed down while the content slides across it is the single biggest tell
    // that a board is not a real board.
    const camera = canvasReduce(
      canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 }),
      { type: 'canvas/pan', dx: -137, dy: 42 },
    );
    const zoomed = canvasReduce(camera, { type: 'canvas/zoom-step', direction: -1 });

    const { container } = mountBoard({ canvas: zoomed });
    const root = container.querySelector('[data-testid="board"]') as HTMLElement;

    expect(root.style.getPropertyValue('--board-cam-x')).toBe(`${zoomed.viewport.x}px`);
    expect(root.style.getPropertyValue('--board-cam-y')).toBe(`${zoomed.viewport.y}px`);
    expect(root.style.getPropertyValue('--board-cam-z')).toBe(String(zoomed.viewport.zoom));
  });

  it('mounts no second field of the renderer’s own', () => {
    const { container } = mountBoard();
    expect(container.querySelector('.react-flow__background')).toBeNull();
  });
});

describe('item 3.6 — one cluster, one legend', () => {
  it('draws exactly one zoom cluster and it carries a percentage', () => {
    // Sheet 05.9 assertion 7. v1 ships two clusters in two corners in two
    // languages and neither shows one.
    mountBoard();
    expect(screen.getAllByTestId('board-zoom')).toHaveLength(1);
    expect(screen.getByTestId('board-zoom-pct').textContent).toBe('100%');
  });

  it('has four controls and no fifth', () => {
    const { container } = mountBoard();
    const cluster = container.querySelector('[data-testid="board-zoom"]')!;
    expect(cluster.querySelectorAll('button')).toHaveLength(3);
    expect(cluster.querySelector('.pct')).not.toBeNull();
    // Fit is a WORD — sheet 09 ruling 3: ic-frame means the boundary drawn
    // around a selection, and fitting the board draws no boundary.
    expect(screen.getByTestId('board-fit').textContent).toBe('Fit');
    expect(screen.getByTestId('board-fit').querySelector('svg')).toBeNull();
  });

  it('disables a step at the end of the range rather than silently no-oping', () => {
    const floored = canvasReduce(EMPTY_CANVAS, {
      type: 'canvas/viewport',
      viewport: { x: 0, y: 0, zoom: 0.25 },
    });
    mountBoard({ canvas: floored });
    expect((screen.getByTestId('board-zoom-out') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('board-zoom-in') as HTMLButtonElement).disabled).toBe(false);
  });

  it('draws the legend with entry apart, and only for kinds on the board', () => {
    mountBoard();
    /* Kinds key starts collapsed (owner: first glance is the graph). */
    act(() => {
      screen.getByTestId('board-legend-shut').click();
    });
    const chips = screen.getAllByTestId('board-legend-kind');
    expect(chips.map((chip) => chip.getAttribute('data-kind'))).toEqual(['service', 'storage']);
    // No entry on this board, so no second group and no separator.
    expect(screen.queryByTestId('board-legend-sep')).toBeNull();
  });

  it('draws no legend at all when there is nothing to be a key to', () => {
    mountBoard({ nodes: [], edges: [] });
    expect(screen.queryByTestId('board-legend')).toBeNull();
  });
});

describe('item 3.4 — the host dispatches and never pokes', () => {
  it('turns the camera keys into actions and changes no graph fact', () => {
    const { container, dispatched } = mountBoard();
    const root = container.querySelector('[data-testid="board"]') as HTMLElement;

    for (const key of ['Escape', '0', '1', '2', '+', '-']) {
      act(() => {
        root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }

    expect(dispatched.map((action) => action.type)).toEqual([
      'canvas/clear',
      'canvas/zoom-reset',
      'canvas/fit',
      'canvas/fit',
      'canvas/zoom-step',
      'canvas/zoom-step',
    ]);
    // Not one of them writes a position, a scope or a view.
    expect(dispatched.some((action) => action.type === 'canvas/position')).toBe(false);
  });

  it('binds no key to a mode this build cannot enter', () => {
    // Sheet 05.7 lists `V D Esc 0 1 2 + −`. Draw is Wave 8+, so `D` would arm a
    // tool with no implementation and `V` would switch to the only tool there
    // is. An affordance for something the product cannot do is the same lie
    // sheet 02.6 refuses on the connection handle.
    const { container, dispatched } = mountBoard();
    const root = container.querySelector('[data-testid="board"]') as HTMLElement;

    for (const key of ['d', 'D', 'v', 'V']) {
      act(() => {
        root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    expect(dispatched).toEqual([]);
  });

  it('fits to the selection when there is one, and to everything when there is not', () => {
    const withSelection = {
      ...canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 }),
      selection: { nodeIds: ['db:orders'], edgeIds: [], anchor: 'db:orders' },
    };
    const { container, dispatched } = mountBoard({ canvas: withSelection });
    const root = container.querySelector('[data-testid="board"]') as HTMLElement;

    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    });
    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });

    const [selectionFit, allFit] = dispatched.filter((a) => a.type === 'canvas/fit') as Array<
      Extract<CanvasAction, { type: 'canvas/fit' }>
    >;
    // The selection is one card; everything is two. Same policy, different
    // bounds — which is the whole of "fit and zoom-to-selection are one
    // operation".
    expect(selectionFit.bounds!.width).toBeLessThan(allFit.bounds!.width);
  });
});

/**
 * WHY THERE IS NO "the edge is in the DOM" ASSERTION IN THIS TIER, and it is a
 * finding rather than a gap.
 *
 * MEASURED: with two nodes and one edge mounted here, `.react-flow__node` is 2,
 * `.react-flow__handle` is 16 — and `.react-flow__edges` is EMPTY. That is the
 * inherited constraint working exactly as documented from the other direction:
 * @xyflow derives every edge endpoint from handle bounds MEASURED OFF THE DOM,
 * and the measurement is driven by a ResizeObserver. jsdom has no layout, so a
 * stub observer never fires, `internals.handleBounds` is never populated, and
 * `EdgeWrapper` returns null before `ElbowEdge` mounts.
 *
 * Faking the observer would fake the measurement, and a measurement invented by
 * a test is the one thing this project has already paid for twice. So the
 * routing math is locked in `routes.test.ts` (pure, exact) and the assertion
 * that an edge ACTUALLY PAINTS after the handle change — the "VERIFY edges
 * still route" the item asks for — is in `boardRendered.test.ts`, in a real
 * browser, which is the only place it can be true.
 */

describe('item 3.5 — ONE node click yields ONE composer chip', () => {
  it('is the Wave-3 acceptance gate, and it is met', () => {
    // §8.6: "the grounded graph cannot currently talk to the agent, on any
    // scanned node, at all." In v1 the button exists only on `design:draw-*`
    // nodes. This is that action, and there is exactly one of it.
    const store = createStore();

    /*
     * MOUNTED WHERE THE PRODUCT MOUNTS IT. Seat-walk OpenCode boot: with no
     * repository the shell is chat-only — no board pane, no BootSurface empty
     * card. Attach lives on the appbar chip (`shell-repo`), same overlay the
     * palette opens. Rendering `<ConnectedBoard/>` alone here used to make the
     * old board-empty assertion possible in a false form.
     */
    const first = render(
      <StoreProvider store={store}>
        {/* `CanvasProvider` is where the ONE canvas slice lives — item playback.
            It is inside `StoreProvider` here because that is where `App.tsx`
            puts it, and a test that mounted the connected board on a different
            arrangement of providers would be testing a product that does not
            ship. Without it `useCanvas` throws by design rather than falling
            back to a private slice nobody else can see. */}
        <CanvasProvider>
          {/* `DocProvider` holds the ONE `.seqd` the board paints and every
              surface edits, and it is nested here in the same order `App.tsx`
              nests it — see the note above about testing the product that
              ships. `useDoc` throws without it, by design. */}
          <DocProvider>
            <ConnectedShell
              chat={<div />}
              rail={<ConnectedBoard />}
              renderOverlay={(overlay) => (
                <div role="dialog" aria-label={overlay.kind} data-testid={`overlay-${overlay.kind}`} />
              )}
            />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );

    // Nothing attached: chat-only — no board empty card, attach is the appbar chip.
    expect(screen.queryByTestId('shell-rail')).toBeNull();
    expect(screen.queryByTestId('board-empty')).toBeNull();
    const open = screen.getByTestId('shell-repo');
    expect(open.textContent).toMatch(/open a repository/i);

    /*
     * THE ASSERTION IS THAT A DIALOG IS ON SCREEN — AND IT WAS NOT ALWAYS.
     *
     * This line used to read `expect(store.getState().shell.overlay).toEqual({
     * kind: 'attach' })`. That asserts A DISPATCH LANDED, and it was green for
     * a whole wave while this button opened NOTHING in a real browser: nobody
     * passed the shell a `renderOverlay`, and `Shell.tsx` kept its own private
     * copy of the shell state, so `shell.overlay` was a slice written by a
     * reducer and read by no renderer. CANON §6 names exactly this — "assert
     * the invariant, not the expression".
     *
     * jsdom cannot tell IN THE DOM from ON THE SCREEN, so it proves the wiring
     * and not the paint. `e2e/shell-overlay.mjs` proves the other half in a
     * real engine over the shipped bundle: the same click, a painted box with a
     * non-zero area inside the viewport, and exactly one overlay host.
     */
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => open.click());
    expect(screen.getByTestId('overlay-attach')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('attach');
    first.unmount();

    // A scan in flight is a DIFFERENT sentence, not the same paragraph with a
    // spinner on it — and it names elapsed time rather than a mute spinner.
    store.dispatch({
      type: 'repo/scanning',
      root: '/tmp/fixture',
      repoName: 'fixture',
      at: Date.now(),
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
    expect(screen.getByTestId('board-empty').querySelector('.t')!.textContent).toMatch(
      /^Scanning fixture · /,
    );

    // And nothing was grounded, because nothing was clicked.
    expect(store.getState().composer.chips).toEqual([]);
  });

  it('adds exactly one chip, carrying the node’s real id', () => {
    const store = createStore();
    const chips: string[] = [];
    store.subscribe(() => {
      chips.length = 0;
      for (const chip of store.getState().composer.chips) chips.push(chip.id);
    });

    // The projection, then the click, then the chip — the whole path, with the
    // grounded document as the only input.
    const projection = projectDocument(DOC);

    const dispatched: CanvasAction[] = [];
    const { container } = render(
      <StoreProvider store={store}>
        <Board
          canvas={canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 })}
          nodes={projection.nodes}
          edges={projection.edges}
          positions={projection.positions}
          dispatch={(action) => dispatched.push(action)}
          onGround={(node) =>
            store.dispatch({
              type: 'composer/chip-add',
              chip: {
                id: `node:${node.id}`,
                kind: 'node',
                ref: node.id,
                label: node.label,
                nodeKind: null,
              },
            })
          }
        />
      </StoreProvider>,
    );

    const cards = container.querySelectorAll('[data-testid="board-node"]');
    expect(cards).toHaveLength(3);

    act(() => {
      (cards[1] as HTMLElement).click();
    });

    const state = store.getState();
    expect(state.composer.chips).toHaveLength(1);
    expect(state.composer.chips[0]!.ref).toBe('svc:checkout');
    expect(state.composer.chips[0]!.kind).toBe('node');
    // ONE ACTION: the same click also selected the node.
    expect(dispatched.filter((a) => a.type === 'canvas/select')).toHaveLength(1);
  });

  it('does not stack the same node twice', () => {
    const store = createStore();
    const projection = projectDocument(DOC);

    const { container } = render(
      <StoreProvider store={store}>
        <Board
          canvas={canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 })}
          nodes={projection.nodes}
          edges={projection.edges}
          positions={projection.positions}
          dispatch={() => undefined}
          onGround={(node) =>
            store.dispatch({
              type: 'composer/chip-add',
              chip: {
                id: `node:${node.id}`,
                kind: 'node',
                ref: node.id,
                label: node.label,
                nodeKind: null,
              },
            })
          }
        />
      </StoreProvider>,
    );

    const card = container.querySelectorAll('[data-testid="board-node"]')[0] as HTMLElement;
    act(() => card.click());
    act(() => card.click());

    // A chip list with the same node in it twice is a context the reader did
    // not build.
    expect(store.getState().composer.chips).toHaveLength(1);
  });

  /**
   * A SELECTION THE READER DID NOT MAKE MUST SURVIVE THE RENDERER TELLING US
   * ABOUT THE ONE BEFORE IT — item playback, and it is a real defect rather
   * than a hypothetical.
   *
   * The guard that used to live in `onSelectionChange` named this case in
   * prose — "the board would clear a selection the reader arrived with (from a
   * turn effect, or the rail)" — and did not cover it. Instrumented,
   * @xyflow emits TWO reports in one tick when `canvas.selection` changes from
   * outside it: the previous value, then the current one. Acting on the first
   * dispatches `canvas/clear`, which un-selects, which re-renders, which
   * produces the pair again. In the App-level flow test that loop took the
   * vitest worker down with no error message at all, which is why this narrow,
   * fast assertion exists beside it.
   *
   * NOTHING IN THIS PACKAGE SET A SELECTION PROGRAMMATICALLY BEFORE, which is
   * exactly why 15 board tests could not see it.
   */
  it('does not clear a selection it was handed from outside', async () => {
    const projection = projectDocument(DOC);
    const framed = canvasReduce(EMPTY_CANVAS, {
      type: 'canvas/frame',
      width: 800,
      height: 600,
    });
    const dispatched: CanvasAction[] = [];

    const board = (canvas: typeof framed) => (
      <Board
        canvas={canvas}
        nodes={projection.nodes}
        edges={projection.edges}
        positions={projection.positions}
        dispatch={(action) => dispatched.push(action)}
        onGround={() => undefined}
      />
    );

    const { rerender } = render(board(framed));

    // The board is handed a selection nobody clicked — what a rail click, a
    // turn effect or a playback hop does.
    const selected = canvasReduce(framed, {
      type: 'canvas/select',
      nodeId: 'svc:checkout',
      additive: false,
    });
    rerender(board(selected));

    // The reports are coalesced into a microtask, so the assertion has to be
    // made after one — asserting synchronously would pass against the bug.
    await Promise.resolve();
    await Promise.resolve();

    expect(
      dispatched.filter((action) => action.type === 'canvas/clear'),
      `the renderer's stale report cleared a selection it was given: ${JSON.stringify(dispatched)}`,
    ).toEqual([]);
  });
});

describe('sheet 08.5 — a board with no connector says why — item canvas-fixes 3', () => {
  /*
   * THE DECISION THIS LOCKS. The board does not draw `import` edges —
   * `packages/export/src/project.ts:124` skips them and that skip stays, because
   * an import says one FILE names another and the board's nodes are services.
   * On this repository every one of the ~1,000 scanned edges is an import, so
   * the honest consequence is a board of real cards with no connectors at all.
   *
   * The defect that consequence creates is that it looks BROKEN. Sheet 08.5's
   * third state is exactly this sentence — "No traced edge at this level ...
   * That is a fact about the level, not about the repository" — and this is the
   * lock that it is on screen, and that it is a note rather than a lid.
   */

  it('draws the note when there are nodes and no edges', () => {
    mountBoard({
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
    });

    const note = screen.getByTestId('board-edgeless');
    expect(note.querySelector('.t')!.textContent).toBe('No connector between these nodes');
    expect(note.querySelector('.s')!.textContent).toBe('All 996 edges are imports.');
    // Not a verdict and not a hue — Law 1. The absence of connectors is a fact
    // about the repository, not a judgement on it.
    expect(note.querySelector('.verdict')).toBeNull();
  });

  it('is a NOTE and not a lid — the cards are still there and still clickable', () => {
    // 08.5: "an empty state is a .empty box sitting ON the board, at the size of
    // what it is talking about, never a lid over it." A note that covered the
    // board would answer "why are there no connectors" by taking away the
    // nodes, which is the same defect one step along.
    const { onGround } = mountBoard({
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
    });

    expect(screen.getAllByTestId('board-node')).toHaveLength(NODES.length);
    // The big centred `.empty` box is a different claim and must NOT be here.
    expect(screen.queryByTestId('board-empty')).toBeNull();

    screen.getAllByTestId('board-node')[0]!.click();
    expect(onGround).toHaveBeenCalledTimes(1);
  });

  it('says nothing at all when the board HAS connectors', () => {
    // An explanation for something that is not happening is noise on a board
    // whose whole job is signal.
    mountBoard({
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
    });
    expect(screen.queryByTestId('board-edgeless')).toBeNull();
  });

  it('says nothing on an EMPTY board — that is the other empty state', () => {
    // Zero nodes and zero edges is "No graph yet", not "no connectors". Telling
    // a reader with nothing on screen that nothing is connected is true and
    // useless, and 08.5's whole point is that the two are different sentences.
    mountBoard({
      nodes: [],
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
      empty: { icon: 'board', what: 'No graph yet', why: 'Nothing has been read.' },
    });
    expect(screen.queryByTestId('board-edgeless')).toBeNull();
    expect(screen.getByTestId('board-empty')).toBeTruthy();
  });

  /*
   * OWNER WALK 2026-08-22, item A3 — "I should be able to X this thing where it
   * says no connectors, or after I read it."
   *
   * The note is CORRECT and it is also permanent: on this repository every edge
   * is an import, so the condition that draws it never stops being true. An
   * explanation you cannot put down stops being an explanation and becomes
   * furniture — it occupies the top-left gutter on every visit, forever, having
   * already been read.
   *
   * Dismissal is the READER'S, so the board does not decide when they are done
   * with it. The board only offers the control and reports the press; whether
   * the note comes back on a new scan is the owner's call one level up, because
   * only that level knows whether the finding is the same finding.
   */
  it('offers a dismiss control, and reports the press', () => {
    const onDismiss = vi.fn();
    mountBoard({
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
      onDismissEdgeless: onDismiss,
    });

    const close = screen.getByTestId('board-edgeless-dismiss');
    /* Named, because an unlabelled X on a note explaining an absence is
       ambiguous between "hide this note" and "do something to the board". */
    expect(close.getAttribute('aria-label')).toMatch(/dismiss/i);

    close.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows NO dismiss control when nobody is listening for it', () => {
    /* A control that cannot achieve anything is worse than no control — the
       same rule BoardMenu applies to Open. Without a handler the note is not
       dismissible, so it must not claim to be. */
    mountBoard({
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
    });

    expect(screen.getByTestId('board-edgeless')).toBeTruthy();
    expect(screen.queryByTestId('board-edgeless-dismiss')).toBeNull();
  });

  it('dismissing does not take the NODES with it', () => {
    /* The note sits on the board. A dismiss wired to the wrong container would
       take the cards out with the explanation, which is the lid failure the
       test above this one exists to prevent. */
    const onDismiss = vi.fn();
    mountBoard({
      edges: [],
      edgeless: { what: 'No connector between these nodes', why: 'All 996 edges are imports.' },
      onDismissEdgeless: onDismiss,
    });

    screen.getByTestId('board-edgeless-dismiss').click();
    expect(screen.getAllByTestId('board-node')).toHaveLength(NODES.length);
  });
});

describe('item canvas-fixes 2 — the board states what its layout is doing', () => {
  it('carries CanvasSlice.layout on the root, so a suite can wait for ELK', () => {
    /*
     * ELK runs off-thread, so the arrangement on screen one frame after a
     * document arrives is not the arrangement two frames after. A suite that
     * measured columns on a fixed frame budget would be reading a race. This is
     * STATE on the root — what the board is IN — and it is what `data-layout`
     * exists for; `e2e/board-fit.mjs` waits on it before it measures anything.
     */
    const { container } = mountBoard();
    const root = container.querySelector('[data-testid="board"]')!;
    expect(root.getAttribute('data-layout')).toBe('idle');

    const laying = mountBoard({
      canvas: {
        ...canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 }),
        layout: 'laying-out',
      },
    });
    expect(
      laying.container.querySelector('[data-testid="board"]')!.getAttribute('data-layout'),
    ).toBe('laying-out');
  });
});

describe('sheet 08.5 — empty is three parts', () => {
  it('says what is not here, why, and offers something to do', () => {
    mountBoard({
      nodes: [],
      edges: [],
      empty: {
        icon: 'board',
        what: 'No graph yet',
        why: 'Nothing has been read.',
        action: { label: 'Open a repository', onAct: () => undefined },
      },
    });

    const empty = screen.getByTestId('board-empty');
    expect(empty.querySelector('.t')!.textContent).toBe('No graph yet');
    expect(empty.querySelector('.s')!.textContent).toBe('Nothing has been read.');
    expect(empty.querySelector('button')!.textContent).toBe('Open a repository');
    // An empty state is not a verdict, so nothing in it is coloured.
    expect(empty.querySelector('.verdict')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   DERIVED CONNECTORS — the weaker claim, drawn as a weaker claim.

   Owner walk 2026-08-22: "Between the services, they might not be directly
   connected, but there could be some type of dotted lines or maybe a dot
   connector."

   The board still does not draw an import AS A CALL — `project.ts` skips
   `kind === 'import'` and that stays. This is a fourth PROOF state for an edge
   that says something weaker and says it in a different visual language, so a
   reader can never mistake one for the other.
   ══════════════════════════════════════════════════════════════════════════ */
describe('a derived connector is not a traced one', () => {
  const DERIVED_EDGES = [
    { id: 'd1', source: NODES[0]!.id, target: NODES[1]!.id, proof: 'derived' as const },
  ];

  it('carries its own proof state on the DOM, not a borrowed one', () => {
    mountBoard({ edges: DERIVED_EDGES });
    const edge = screen.getAllByTestId('board-edge')[0]!;
    /* `data-proof` is what a suite, a screenshot diff and a reader's eye all
       key off. Reusing `declared` here would make the two indistinguishable to
       every one of them. */
    expect(edge.getAttribute('data-proof')).toBe('derived');
  });

  it('takes its own class, so it can be styled apart from every other state', () => {
    mountBoard({ edges: DERIVED_EDGES });
    const edge = screen.getAllByTestId('board-edge')[0]!;
    expect(edge.getAttribute('class')).toMatch(/e-derived/);
    /* And explicitly NOT the traced class. `proofOf` marks import traced, so
       this is the exact confusion that had to be prevented. */
    expect(edge.getAttribute('class')).not.toMatch(/e-traced/);
  });

  it('the four proof states are four distinct classes', () => {
    /* If two collapsed, the board would be asserting two different strengths
       of claim in one appearance — which is the failure the whole proof
       vocabulary exists to prevent. */
    const seen = new Set<string>();
    for (const proof of ['traced', 'declared', 'onflow', 'derived'] as const) {
      const view = mountBoard({
        edges: [{ id: `e-${proof}`, source: NODES[0]!.id, target: NODES[1]!.id, proof }],
      });
      const cls = screen.getAllByTestId('board-edge')[0]!.getAttribute('class')!;
      seen.add(cls.replace('edgeline ', ''));
      view.unmount();
    }
    expect(seen.size).toBe(4);
  });
});

/**
 * CLICKING A CARD ASKS WHY IT IS THERE.
 *
 * `NodeDetailPanel` answers exactly that — what the node is, and where each of
 * its edges was traced from, file and line. It was built, tested, and
 * reachable ONLY by clicking the same node a second time over in the rail;
 * clicking it here selected it and grounded the composer on it and nothing
 * else.
 *
 * This asserts THE BOARD'S SIDE of that seam. A rail test that renders the
 * panel for a given id passes whether or not anything ever supplies one — the
 * gap that let four features die on `/api/ask/stream` and let the rail's own
 * `selectedPath` be written by a reducer nobody read.
 */
describe('asking the rail why a node is there', () => {
  it('reports the node that was picked', () => {
    const { container, onExplain } = mountBoard();
    const cards = container.querySelectorAll('[data-testid="board-node"]');

    act(() => {
      (cards[1] as HTMLElement).click();
    });

    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(typeof onExplain.mock.calls[0]![0]).toBe('string');
  });

  it('reports the SAME node it selected — one gesture, one subject', () => {
    const { container, dispatched, onExplain } = mountBoard();
    const cards = container.querySelectorAll('[data-testid="board-node"]');

    act(() => {
      (cards[0] as HTMLElement).click();
    });

    const selected = dispatched.find((a) => a.type === 'canvas/select') as
      | { nodeId: string }
      | undefined;
    expect(selected).toBeTruthy();
    expect(onExplain).toHaveBeenCalledWith(selected!.nodeId);
  });

  it('a host that wires no handler is not broken by the click', () => {
    /* The prop is optional, and a board without a rail beside it must still
       select and ground. */
    const { container, onGround } = mountBoard({ onExplain: undefined });
    const cards = container.querySelectorAll('[data-testid="board-node"]');

    act(() => {
      (cards[0] as HTMLElement).click();
    });
    expect(onGround).toHaveBeenCalled();
  });
});

describe('node drag — live preview until drop', () => {
  it('answers with the in-flight position while dragging, then the saved one', () => {
    const laid = { x: 0, y: 0 };
    const drag = { nodeId: 'svc:checkout', x: 120, y: 48 };
    expect(boardNodePosition('svc:checkout', drag, {}, laid)).toEqual({ x: 120, y: 48 });
    expect(boardNodePosition('db:orders', drag, {}, laid)).toEqual(laid);
    expect(boardNodePosition('svc:checkout', null, { 'svc:checkout': drag }, laid)).toEqual(drag);
  });
});

describe('C4.1 — hop fit animates the camera (--seq-dur-cam)', () => {
  it('flags data-cam-animating and fits when a flow hop lands', () => {
    const { container, dispatched } = mountBoard({
      playback: {
        functionId: 'fn:charge',
        index: 0,
        count: 1,
        shown: 1,
        how: 'direct',
        from: 'svc:checkout',
        to: 'db:orders',
        fromLabel: 'checkout',
        toLabel: 'orders',
      },
    });
    const root = container.querySelector('[data-testid="board"]') as HTMLElement;
    expect(root.getAttribute('data-cam-animating')).toBe('true');
    expect(dispatched.some((a) => a.type === 'canvas/fit')).toBe(true);
  });

  it('board.css binds cam animation to data-cam-animating + --seq-dur-cam', () => {
    /* String lock: the ease must stay on the hop flag, not on every pan. */
    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((r) => r.cssText);
        } catch {
          return [] as string[];
        }
      })
      .join('\n');
    expect(css).toMatch(/data-cam-animating/);
    expect(css).toMatch(/--seq-dur-cam/);
  });
});

describe('P2 — camera fit after attach and proposal ghost', () => {
  it('fits the camera to ghost nodes when a topology proposal lands', () => {
    /*
     * Owner seat-walk: a proposal that does not move the camera leaves the
     * reader staring at grounded cards while the ghost is off-frame. The wire
     * existed; this locks it.
     */
    const { dispatched } = mountBoard({ ghostNodeIds: ['svc:checkout'] });
    const fits = dispatched.filter((a) => a.type === 'canvas/fit') as Array<
      Extract<CanvasAction, { type: 'canvas/fit' }>
    >;
    expect(fits.length).toBeGreaterThanOrEqual(1);
    expect(fits[0]!.bounds).not.toBeNull();
  });

  it('fits once after attach layout settles — not on the seed idle frame', () => {
    const dispatched: CanvasAction[] = [];
    const onGround = vi.fn();
    const onExplain = vi.fn();
    let canvas = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

    const props = () => ({
      canvas,
      nodes: NODES,
      edges: EDGES,
      positions: POSITIONS,
      dispatch: (action: CanvasAction) => {
        dispatched.push(action);
      },
      onGround,
      onExplain,
      attachFitKey: '/tmp/fixture|2026-08-26T00:00:00.000Z' as string | null,
    });

    const view = render(<Board {...props()} />);
    /* Seed idle before ELK: must not latch. */
    expect(dispatched.filter((a) => a.type === 'canvas/fit')).toHaveLength(0);

    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'laying-out' });
    act(() => {
      view.rerender(<Board {...props()} />);
    });
    expect(dispatched.filter((a) => a.type === 'canvas/fit')).toHaveLength(0);

    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'idle' });
    act(() => {
      view.rerender(<Board {...props()} />);
    });
    expect(dispatched.filter((a) => a.type === 'canvas/fit').length).toBe(1);

    /* Same attach key — no second fit on a later idle. */
    act(() => {
      view.rerender(<Board {...props()} />);
    });
    expect(dispatched.filter((a) => a.type === 'canvas/fit').length).toBe(1);
  });

  it('fits the seed when layout failed after attach', () => {
    const dispatched: CanvasAction[] = [];
    let canvas = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });
    const props = () => ({
      canvas,
      nodes: NODES,
      edges: EDGES,
      positions: POSITIONS,
      dispatch: (action: CanvasAction) => {
        dispatched.push(action);
      },
      onGround: vi.fn(),
      onExplain: vi.fn(),
      attachFitKey: '/tmp/fixture|failed-scan',
    });
    const view = render(<Board {...props()} />);
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'laying-out' });
    act(() => view.rerender(<Board {...props()} />));
    canvas = canvasReduce(canvas, { type: 'canvas/layout', layout: 'failed' });
    act(() => view.rerender(<Board {...props()} />));
    expect(dispatched.some((a) => a.type === 'canvas/fit')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE EDGE TAG — an architecture diagram whose arrows say something.

   MEASURED BEFORE THIS: `grep -rn edgetag packages/web2/src` returned two hits,
   both inside comments (lod.ts and lod.test.ts). Zero CSS rules, zero JSX. The
   board drew a `<BaseEdge>` and nothing else, so a reader could not tell
   whether A -> B was an HTTP call, a queue publish or a counted inference —
   while sheet 04 specifies a tag on every connector and the SVG exporter has
   drawn one for the same document since it was written.
   ══════════════════════════════════════════════════════════════════════════ */
describe('a connector says what it is', () => {
  const LABELLED: BoardEdge[] = [
    { id: 'e1', source: 'svc:checkout', target: 'db:orders', proof: 'derived', label: '84 imports' },
  ];

  it('paints the label on the board', () => {
    mountBoard({ edges: LABELLED });
    const tag = screen.getByTestId('board-edge-label');
    expect(tag.textContent).toBe('84 imports');
  });

  it('carries the connector’s own proof state, so an inference cannot read as a call', () => {
    /* The line already separates the four states three ways — hue, dash and
       weight. The tag is the fourth signal and it must point the same way: a
       derived count painting in the traced ink would be the strongest proof
       word spent on the weakest claim. */
    mountBoard({ edges: LABELLED });
    expect(screen.getByTestId('board-edge-label').getAttribute('data-proof')).toBe('derived');
  });

  it('draws no tag at all for a connector the document gave no words', () => {
    // EDGES is the traced fixture, and it has no label.
    mountBoard();
    expect(screen.getAllByTestId('board-edge').length).toBe(1);
    expect(screen.queryByTestId('board-edge-label')).toBeNull();
  });

  it('takes the tag away with the rest of the --t-10 ink, not by shrinking it', () => {
    /* §05.8's one rule: labels are HIDDEN at low zoom, never shrunk. `.edgetag`
       is authored at --t-10, so its threshold is 1.00 and it is the first row
       to go — the board asks `lod.ts` rather than picking a zoom of its own. */
    const zoomedOut = canvasReduce(
      canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 }),
      { type: 'canvas/zoom-at', zoom: 0.5, at: { x: 400, y: 300 } },
    );
    expect(zoomedOut.rung).toBeGreaterThan(1);
    mountBoard({ edges: LABELLED, canvas: zoomedOut });
    expect(screen.getAllByTestId('board-edge').length).toBe(1);
    expect(screen.queryByTestId('board-edge-label')).toBeNull();
  });
});
