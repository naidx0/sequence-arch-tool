/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD SPECIMEN PAGE — the Tier-4 surface
   packages/web2/src/canvas/specimen.tsx

   WHAT THIS IS, AND WHAT IT IS NOT.

   It is a RENDERING HARNESS. `boardRendered.test.ts` builds it, serves it and
   drives it in a real Chrome, because four of this wave's locks are claims
   about RENDERED values and no jsdom tier can evaluate one:

     · kinds separate in greyscale FROM THE RADII THAT ACTUALLY PAINT
     · no `.node` border or edge stroke resolves to a verdict or accent at rest
     · selection reads LOUDER than resting
     · exactly one background-image on the root, and it moves with the camera

   It is ALSO the page a human looks at, which the plan requires of every wave:
   §4.6 Tier 4 and R15 — "no wave ships without a rendered screenshot compared
   against its sheet". `8d38fad3`'s own commit message is why: "nobody has
   looked at this with human eyes — every claim above is a computed-value
   measurement, because the browser pane would not composite."

   IT IS NOT PRODUCT DATA AND IT IS NEVER BUILT INTO THE APP. `vite.config.ts`
   sets no `build.rollupOptions.input`, so `vite build` emits index.html and
   nothing else; this page is built only by the test that drives it, into a
   temporary directory. The precedent is `boot/preview.tsx`, which says the same
   thing for the same reason.

   THE DOCUMENT BELOW IS A SPECIMEN AND SAYS SO ON THE PAGE. Graphite law 4
   forbids inventing a number, and the whole point of the greyscale invariant is
   that it is proved on the SHAPE rather than on the content — so the specimen
   carries one card of each kind and no count anybody could mistake for a
   measurement.
   ══════════════════════════════════════════════════════════════════════════ */

import { StrictMode, useReducer, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import '../tokens/graphite.css';
import '../styles/base.css';
import './board.css';

import { Board, type BoardEdge } from './Board.js';
import { KindLegend } from './KindLegend.js';
import { NodeCard, type BoardNode } from './NodeCard.js';
import { SILHOUETTES, silhouetteClass } from './kinds.js';
import { EMPTY_CANVAS } from '../state/initial.js';
import { canvasReduce } from './canvasReduce.js';
import { anatomyPanel } from './anatomy.js';
import { cardHeight } from './cardBox.js';
import { AnatomyPanel } from './visual/AnatomyPanel.js';
import { VisualMetaStrip } from './visual/VisualMetaStrip.js';
import type { ArchGraph } from '@sequence/schema';

/** One card of each silhouette, at the three heights sheet 02.3 derives. */
const SPECIMENS: BoardNode[] = [
  {
    id: 'spec:entry',
    label: 'public API',
    subtitle: 'The way in.',
    present: { kind: 'service', entry: true },
    schemaKind: 'service',
    provenance: 'traced',
    count: null,
  },
  {
    id: 'spec:service',
    label: 'checkout',
    subtitle: 'Takes an order and charges it.',
    present: { kind: 'service', entry: false },
    schemaKind: 'service',
    provenance: 'traced',
    count: null,
  },
  {
    id: 'spec:module',
    label: 'billing',
    subtitle: null,
    present: { kind: 'module', entry: false },
    schemaKind: 'module',
    provenance: 'declared',
    count: null,
  },
  {
    id: 'spec:store',
    label: 'orders',
    subtitle: null,
    present: { kind: 'storage', entry: false },
    schemaKind: 'datastore',
    provenance: 'declared',
    count: null,
  },
  {
    id: 'spec:topic',
    label: 'order.placed',
    subtitle: 'A lane things flow along.',
    present: { kind: 'topic', entry: false },
    schemaKind: 'topic',
    provenance: null,
    count: null,
  },
  {
    id: 'spec:agent',
    label: 'refund worker',
    subtitle: 'An actor, not a deployment.',
    present: { kind: 'agent', entry: false },
    schemaKind: 'agent',
    provenance: null,
    count: null,
  },
];

const SPEC_EDGES: BoardEdge[] = [
  { id: 'x1', source: 'spec:entry', target: 'spec:service', proof: 'traced' },
  { id: 'x2', source: 'spec:service', target: 'spec:store', proof: 'declared' },
  { id: 'x3', source: 'spec:service', target: 'spec:topic', proof: 'onflow' },
];

/* ══════════════════════════════════════════════════════════════════════════
   THE FOUR SHAPES `cardHeight` CLAIMS TO DESCRIBE
   (read by boardRendered.test.ts's "the declared box is the painted card")

   THIS IS THE ONLY PLACE IN THE SUITE WHERE THE TWO NUMBERS MEET IN A REAL
   BROWSER. `cardBox.test.ts` compares `cardBox.ts` to the token ramp that
   `cardBox.ts` is written from, so both halves agree by construction — and for
   a whole wave both of them disagreed with the DOM by seven units on every
   card. Each wrapper below carries `cardHeight`'s answer in `data-declared`
   and renders the card beside it; the test measures the card and demands they
   match.

   SHAPES 5 AND 6 ARE THE WRAPPING ONES, and they exist because the first four
   deliberately did not wrap. `svc:web2` declared 68 and painted 83 on the real
   monorepo: its glance line "packages web2 - packages web2 test" fills two
   --lh-11 boxes and only one was reserved. Wrapping cannot be derived from the
   ramp — whether a string wraps is a fact about the FACE and the string — so
   `textFit.ts` measures it and these two shapes are where that measurement is
   checked against a browser that actually laid the text out.
   ══════════════════════════════════════════════════════════════════════════ */
const PAINTED_BASE: BoardNode = {
  id: 'spec:painted',
  label: 'checkout',
  subtitle: null,
  present: { kind: 'service', entry: false },
  schemaKind: 'service',
  provenance: 'traced',
  count: null,
};

const PAINTED_GLANCE: BoardNode = { ...PAINTED_BASE, subtitle: 'Charges an order.' };

/* THE REPORTED STRING, not a convenient one: this is `svc:web2`'s own glance
   line on this monorepo, the card that declared 68 and painted 83. */
const PAINTED_WRAP_GLANCE: BoardNode = {
  ...PAINTED_BASE,
  subtitle: 'packages web2 · packages web2 test',
};

/* ── THE TWO CARDS THAT DISAGREED ON THE REAL BOARD ─────────────────────────
   `svc:acp` declared 45 and painted 45; `svc:web2` declared 45 and painted 49,
   with `.nd-body` padding-top reading 2px and 6px respectively — while both
   carried the SAME class list, the same data attributes and the same two
   matching CSS rules. That reading came from the in-app pane, which is now known
   not to recalculate after a script mutation, so it is treated as UNCONFIRMED
   until a real browser says the same thing.

   The only input that differs is the title text, and both cards sit at rung 5
   where `.nd-t-short` applies. So: same kind, same rung, different label. If the
   4px reappears here it is real and the harness can be mutated honestly to find
   it; if it does not, the residue was an artifact of a frozen style engine and
   the board was never wrong. */
const RUNG5_LONG_TITLE: BoardNode = { ...PAINTED_BASE, label: 'Acp service' };
const RUNG5_SHORT_TITLE: BoardNode = { ...PAINTED_BASE, label: 'Web2' };

/* THE INPUT THE FIRST PAIR MISSED. `svc:web2` on the real monorepo HAS a glance
   line; `svc:acp` does not. `visibilityAtWithSubtitleBoost` gives a card that
   carries one an extra rung of subtitle, so at rung 5 the two cards can take
   DIFFERENT `.nd-body` variants — `with-sub` (--sp-6) against `title-only`
   (--sp-2) — which is exactly the 6px-against-2px that was measured. Same label
   as above, so the only difference from `RUNG5_SHORT_TITLE` is the subtitle. */
const RUNG5_WITH_SUBTITLE: BoardNode = {
  ...PAINTED_BASE,
  label: 'Web2',
  subtitle: 'packages web2 · packages web2 test',
};

/* `.nd-t` has `overflow-wrap: anywhere` and NO clamp, so a long label is
   unbounded — the same hazard one row up, and the one no card on this
   repository happens to trip today. A label that cannot fit 138px on one line
   is the whole test. */
const PAINTED_WRAP_TITLE: BoardNode = {
  ...PAINTED_BASE,
  label: 'checkout settlement reconciliation worker',
};

/** A container with modules, a file and one child that holds nothing, so the
 *  wall draws its zero band and the note under it — the shape whose reserved
 *  footprint was 10 units short of what it painted. */
const PAINTED_GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2026-09-02T00:00:00.000Z',
  repoRoot: '/specimen',
  repoName: 'specimen',
  nodes: [
    { id: 'svc:api', kind: 'service', label: 'api', path: 'api' },
    { id: 'mod:api/0', kind: 'module', label: 'server', parentId: 'svc:api', path: 'api/src' },
    {
      id: 'file:api/src/server.ts',
      kind: 'file',
      label: 'server.ts',
      parentId: 'mod:api/0',
      path: 'api/src/server.ts',
      meta: { loc: 800 },
    },
    { id: 'ds:store', kind: 'datastore', label: 'store', parentId: 'svc:api' },
  ],
  edges: [],
  warnings: [],
};

const PAINTED_PANEL = anatomyPanel(PAINTED_GRAPH, 'svc:api');

const SPEC_POSITIONS: Record<string, { x: number; y: number }> = {
  'spec:entry': { x: 40, y: 40 },
  'spec:service': { x: 300, y: 40 },
  'spec:module': { x: 300, y: 220 },
  'spec:store': { x: 560, y: 40 },
  'spec:topic': { x: 560, y: 190 },
  'spec:agent': { x: 40, y: 240 },
};

/**
 * A CARD OUTSIDE A BOARD STILL NEEDS THE RENDERER'S CONTEXT, and that is a
 * consequence of the inherited constraint rather than an accident of this page.
 *
 * `NodeCard` renders eight <Handle> elements because @xyflow measures every
 * edge endpoint off them in the DOM, and <Handle> reads the flow store. So a
 * card cannot be drawn anywhere the renderer is not — which is worth knowing
 * before somebody tries to put one in the index rail. `NodeCard.test.tsx` wraps
 * for the same reason, and the escape route is the same one: move handle
 * geometry onto `node.handles` so `parseHandles` reads it without the DOM.
 */
function Bare({ children, testid }: { children: ReactNode; testid: string }) {
  return (
    <div
      className="board-scope"
      data-testid={testid}
      /* A ROW, so the human comparison the Tier-4 pass exists for is possible:
         the point of drawing rest beside selected beside dimmed is that sheet
         06.1's monotonic order can be READ, and a vertical stack a screen tall
         cannot be read as an order at all. */
      style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', padding: '16px' }}
    >
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </div>
  );
}

function Specimen() {
  const [canvas, dispatch] = useReducer(
    canvasReduce,
    canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 900, height: 560 }),
  );

  return (
    <div data-testid="specimen">
      {/* THE BOARD ITSELF — the field, the camera, the cards, the edges, the
          legend and the one cluster. This is the frame the screenshot is taken
          of, and it is the same component the app mounts. */}
      <div style={{ width: '900px', height: '560px' }} data-testid="specimen-board">
        <Board
          canvas={canvas}
          nodes={SPECIMENS}
          edges={SPEC_EDGES}
          positions={SPEC_POSITIONS}
          dispatch={dispatch}
          onGround={() => undefined}
        />
      </div>

      {/* THE FIVE STATES, side by side, so the monotonic order of sheet 06.1 is
          measurable: each is louder than the one before it, except the last,
          which is quieter on purpose. */}
      <Bare testid="specimen-states">
        <div data-testid="state-rest">
          <NodeCard node={SPECIMENS[1]!} selected={false} dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div data-testid="state-sel">
          <NodeCard node={SPECIMENS[1]!} selected dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div data-testid="state-dim">
          <NodeCard node={SPECIMENS[1]!} selected={false} dimmed rung={1} onSelect={() => undefined} />
        </div>
        {/* DECISION 6 — THE STATUS DOT, in the states the sheet names. The
            selected dot rides an un-dimmed card (selection is never receded);
            on-path and off-path ride dimmed cards, which is exactly where they
            appear in the product — and exactly the combination whose contrast
            boardRendered.test.ts measures. */}
        <div data-testid="state-dot-selected">
          <NodeCard node={SPECIMENS[1]!} selected dimmed={false} dot="selected" rung={1} onSelect={() => undefined} />
        </div>
        <div data-testid="state-dot-onpath-dim">
          <NodeCard node={SPECIMENS[1]!} selected={false} dimmed dot="onpath" rung={1} onSelect={() => undefined} />
        </div>
        <div data-testid="state-dot-offpath-dim">
          <NodeCard node={SPECIMENS[1]!} selected={false} dimmed dot="offpath" rung={1} onSelect={() => undefined} />
        </div>
      </Bare>

      {/* THE THREE HEIGHTS of sheet 02.3 — title only, + subtitle, + evidence.
          A card with no subtitle must be visibly shorter than a card with one,
          "and it is testable by measuring two boxes". */}
      <Bare testid="specimen-heights">
        <div data-testid="height-title">
          <NodeCard
            node={{ ...SPECIMENS[1]!, subtitle: null, provenance: null }}
            selected={false}
            dimmed={false}
            rung={1}
            onSelect={() => undefined}
          />
        </div>
        <div data-testid="height-subtitle">
          <NodeCard
            node={{ ...SPECIMENS[1]!, provenance: null }}
            selected={false}
            dimmed={false}
            rung={1}
            onSelect={() => undefined}
          />
        </div>
        <div data-testid="height-evidence">
          {/* Selected so provenance paints — first glance hides it until select. */}
          <NodeCard node={SPECIMENS[1]!} selected dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
      </Bare>

      {/* THE DECLARED BOX BESIDE THE CARD IT CLAIMS TO DESCRIBE. Four shapes,
          each carrying `cardHeight`'s own answer, so the test has nothing to
          re-derive — it measures the card and compares. */}
      <Bare testid="specimen-painted">
        <div
          data-testid="painted-card"
          data-shape="title"
          data-declared={String(cardHeight(PAINTED_BASE, 1))}
        >
          <NodeCard node={PAINTED_BASE} selected={false} dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div
          data-testid="painted-card"
          data-shape="glance"
          data-declared={String(cardHeight(PAINTED_GLANCE, 1))}
        >
          <NodeCard node={PAINTED_GLANCE} selected={false} dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div
          data-testid="painted-card"
          data-shape="wrap-glance"
          data-declared={String(cardHeight(PAINTED_WRAP_GLANCE, 1))}
        >
          <NodeCard node={PAINTED_WRAP_GLANCE} selected={false} dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div
          data-testid="painted-card"
          data-shape="wrap-title"
          data-declared={String(cardHeight(PAINTED_WRAP_TITLE, 1))}
        >
          <NodeCard node={PAINTED_WRAP_TITLE} selected={false} dimmed={false} rung={1} onSelect={() => undefined} />
        </div>
        <div
          data-testid="rung5-card"
          data-shape="rung5-long"
          data-declared={String(cardHeight(RUNG5_LONG_TITLE, 5))}
        >
          <NodeCard node={RUNG5_LONG_TITLE} selected={false} dimmed={false} rung={5} onSelect={() => undefined} />
        </div>
        <div
          data-testid="rung5-card"
          data-shape="rung5-short"
          data-declared={String(cardHeight(RUNG5_SHORT_TITLE, 5))}
        >
          <NodeCard node={RUNG5_SHORT_TITLE} selected={false} dimmed={false} rung={5} onSelect={() => undefined} />
        </div>
        <div
          data-testid="rung5-card"
          data-shape="rung5-subtitled"
          data-declared={String(cardHeight(RUNG5_WITH_SUBTITLE, 5))}
        >
          <NodeCard node={RUNG5_WITH_SUBTITLE} selected={false} dimmed={false} rung={5} onSelect={() => undefined} />
        </div>
        <div
          data-testid="painted-card"
          data-shape="visual"
          data-declared={String(cardHeight(PAINTED_BASE, 1, true))}
        >
          <NodeCard
            node={PAINTED_BASE}
            selected={false}
            dimmed={false}
            rung={1}
            onSelect={() => undefined}
            meta={<VisualMetaStrip node={PAINTED_BASE} />}
          />
        </div>
        <div
          data-testid="painted-card"
          data-shape="anatomy"
          data-declared={String(cardHeight(PAINTED_BASE, 1, false, PAINTED_PANEL))}
        >
          <NodeCard
            node={PAINTED_BASE}
            selected={false}
            dimmed={false}
            rung={1}
            onSelect={() => undefined}
            anatomy={
              <AnatomyPanel panel={PAINTED_PANEL} kind="service" onClose={() => undefined} />
            }
          />
        </div>
      </Bare>

      {/* ONE CARD PER SILHOUETTE, each at the FULL card, so the greyscale
          invariant is measured on what the reader is actually shown. */}
      <Bare testid="specimen-kinds">
        {SILHOUETTES.map((silhouette) => (
          <div key={silhouette} data-testid="kind-card" data-kind={silhouette}>
            <NodeCard
              node={
                silhouette === 'entry'
                  ? { ...SPECIMENS[0]! }
                  : {
                      ...SPECIMENS[1]!,
                      id: `spec:${silhouette}`,
                      present: { kind: silhouette, entry: false },
                      schemaKind: silhouette,
                    }
              }
              selected={false}
              dimmed={false}
              rung={1}
              onSelect={() => undefined}
            />
          </div>
        ))}
      </Bare>

      {/* THE SILHOUETTE CHIPS at half a card — the size the legend draws and
          the size the ladder's floor is stated at. Rendered bare so the radii
          can be read off the element itself. */}
      <div
        className="board-scope"
        data-testid="specimen-swatches"
        style={{ display: 'flex', gap: '16px', padding: '16px' }}
      >
        {SILHOUETTES.map((silhouette) => (
          <span
            key={silhouette}
            className={`silswatch ${silhouetteClass(silhouette)}`}
            data-testid="kind-swatch"
            data-kind={silhouette}
          />
        ))}
      </div>

      <div className="board-scope" data-testid="specimen-legend">
        <KindLegend />
      </div>
    </div>
  );
}

const mount = document.getElementById('root');
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <Specimen />
    </StrictMode>,
  );
}
