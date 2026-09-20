import { render } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { substituteVars } from '../../test/support/css';
import { Board } from './Board';
import { EMPTY_CANVAS } from '../state/initial';
import { anatomyPanel, indexAnatomy } from './anatomy';
import { CARD_FLOOR, cardHeight } from './cardBox';
import { canvasReduce } from './canvasReduce';
import { installResizeObserver } from './testResizeObserver';
import { projectDocument } from './project';
import type { AnatomyPanel } from './anatomy';
import type { ArchGraph, SeqDiagramV1 } from '@sequence/schema';
import type { LodRung } from '../state/types';

installResizeObserver();

/* ══════════════════════════════════════════════════════════════════════════
   THE BOX THE LAYOUT IS HANDED IS THE BOX THE BROWSER PAINTS
   packages/web2/src/canvas/cardPainted.test.tsx

   WHY THIS FILE EXISTS, AND WHY `cardBox.test.ts` COULD NOT BE IT. Every
   assertion in `cardBox.test.ts` compares `cardBox.ts`'s arithmetic to the
   token ramp `cardBox.ts` is written from. Both halves therefore agree with
   each other by construction, and for a whole wave both of them disagreed with
   the DOM: the model summed a `.nd-hd` row (icon + mono kind tag) at --lh-12
   that has not existed in web2 since P2.6, declared 38 for a card the browser
   painted at 45, and thirteen green assertions said nothing. Layout positioned
   every neighbour from a box seven units shorter than its card.

   SO THE ONLY HONEST LOCK IS ONE THAT STARTS FROM A CARD THAT RENDERED. This
   file mounts the real `Board` over a real projection and rebuilds each card's
   height from the elements that actually came out and the styles the live
   cascade actually gave them — which rows exist, which `.nd-body` class the
   component chose, what line-height that class resolves to — and asserts
   `cardHeight` equals it.

   ── WHAT JSDOM CANNOT DO, SAID PLAINLY RATHER THAN FAKED ──────────────────

   jsdom runs no layout engine at all. `getBoundingClientRect().height` and
   `offsetHeight` are 0 on every element on this board — probed, not assumed —
   so "measure the rendered card" cannot mean reading a rect here. What jsdom
   DOES have is the real element tree and the real cascade, and those are where
   the defect lived. `paintedHeight` below supplies the one thing jsdom is
   missing — the vertical box model — and takes everything else from the DOM.

   IT STILL CANNOT COUNT LINE BOXES, because jsdom has no font metrics, so a
   text element is one line unless a caller says otherwise. Two consequences,
   both real and both named here rather than hidden:

     · `.ana-note` wraps to three lines in the browser (measured), so the
       anatomy shape passes that in. `anatomy.ts` reserves the same three.
     · A GLANCE LINE THAT WRAPS IS NOW MODELLED — CLOSED, and closed the way
       this note said it would have to be. `.nd-s` is `-webkit-line-clamp: 2`,
       and on this monorepo `svc:web2` painted 83 against a declared 68 because
       one line box was reserved for two. `textFit.ts` measures the string
       against the card's content width in the face the browser paints with,
       and `cardBox` reserves every line the row takes — capped at two for the
       clamp, unbounded for `.nd-t`, which has `overflow-wrap: anywhere` and no
       clamp at all.
       IT IS STILL NOT PROVEN HERE, and that is the honest part: jsdom has no
       font metrics, so `wrappedLineCount` returns 1 in this file and the
       reconstruction below is identical to what it always was. The proof is
       `boardRendered.test.ts`'s shapes `wrap-glance` and `wrap-title`, which
       run in a real Chromium and additionally assert the browser drew TWO line
       boxes — without that second assertion the shapes would pass by agreeing
       at one line and prove nothing.

   ── AND THE NUMBERS ARE ANCHORED OUTSIDE THIS PROCESS ─────────────────────

   A reconstruction could itself drift into fiction, so each shape is ALSO
   asserted against what the shipped bundle painted in Chrome, measured through
   `node.querySelector('.node').offsetHeight` on the running app against this
   monorepo (2026-09-02, devicePixelRatio 1). If one of those four goes red,
   re-measure in the running app before touching it — that is the whole point
   of the number being there.

   THE GROUND TRUTH IS `boardRendered.test.ts`, not this file. That one builds
   the specimen with the real vite pipeline, serves it, drives a real Chromium
   at --force-device-scale-factor=1 and compares `cardHeight`'s answer to the
   card's own `getBoundingClientRect().height` on the same four shapes. It is
   the better lock and it is the one to trust; it also SKIPS, loudly, on a
   machine with no Chromium, which is why this one exists beside it.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── THE VERTICAL BOX MODEL, READ OFF THE LIVE CASCADE ───────────────────── */

/** A computed declaration with custom properties substituted — what a real
 *  browser would have returned. `substituteVars` explains why that step is
 *  needed at all under jsdom. */
function declared(el: Element, property: string): string {
  return substituteVars(el.ownerDocument.defaultView!.getComputedStyle(el).getPropertyValue(property), el).trim();
}

/** The same, walking up for a property jsdom does not inherit for us. */
function inherited(el: Element, property: string): string {
  let node: Element | null = el;
  while (node) {
    const value = declared(node, property);
    if (value) return value;
    node = node.parentElement;
  }
  return '';
}

function firstNumber(raw: string): number | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** One side out of a 1-to-4 value box shorthand (`padding: 0 var(--sp-6)`). */
function boxSide(raw: string, side: 'top' | 'bottom'): number | null {
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const pick = side === 'top' ? parts[0]! : parts.length >= 3 ? parts[2]! : parts[0]!;
  return firstNumber(pick);
}

function padding(el: Element, side: 'top' | 'bottom'): number {
  const own = firstNumber(declared(el, `padding-${side}`));
  if (own !== null) return own;
  /* jsdom does not expand a shorthand written with a var() into longhands, so
     `padding: var(--sp-10)` only ever comes back on the shorthand. */
  return boxSide(declared(el, 'padding'), side) ?? 0;
}

/**
 * A BORDER IS RASTERISED IN WHOLE DEVICE PIXELS, and that is not a detail this
 * board can round away: `--w-struct` is 1.5px and it is what the anatomy wall
 * and the store/agent chassis are drawn with. Probed in the running app
 * (Chrome, devicePixelRatio 1): an element carrying `border: 1.5px solid`
 * reports `border-top-width: 1px` and its box is one unit shorter per side than
 * the declaration. `anatomy.ts`'s `WALL_BORDER` records the same measurement
 * from the other side, and says what a 2x display does instead.
 */
function snapped(width: number): number {
  return Math.floor(width);
}

function border(el: Element, side: 'top' | 'bottom'): number {
  const candidates = [
    declared(el, `border-${side}-width`),
    declared(el, `border-${side}`),
    declared(el, 'border-width'),
    declared(el, 'border'),
  ];
  for (const raw of candidates) {
    const value = firstNumber(raw);
    if (value !== null) return snapped(value);
  }
  return 0;
}

function fontSize(el: Element): number {
  return firstNumber(inherited(el, 'font-size')) ?? 0;
}

function lineHeight(el: Element): number {
  const raw = inherited(el, 'line-height');
  if (raw.endsWith('px')) return firstNumber(raw) ?? 0;
  const factor = firstNumber(raw);
  /* `line-height: 1` on the strip's words — a unitless factor is a multiple of
     the element's own font size, which is how a 10px row and a 16px chip end up
     on the same line. */
  return factor === null ? 0 : factor * fontSize(el);
}

function rowGap(el: Element): number {
  return firstNumber(declared(el, 'row-gap')) ?? firstNumber(declared(el, 'gap')) ?? 0;
}

function isColumn(el: Element): boolean {
  return declared(el, 'display').includes('flex') && declared(el, 'flex-direction') === 'column';
}

/** Children that are IN FLOW. `.nd-ic` and `.nd-expand` are `position:
 *  absolute` and take no row — which is exactly the fact the old model got
 *  wrong when it reserved a header row for the icon. */
function inFlow(el: Element): Element[] {
  return [...el.children].filter((child) => {
    const position = declared(child, 'position');
    return position !== 'absolute' && position !== 'fixed';
  });
}

function hasOwnText(el: Element): boolean {
  return [...el.childNodes].some(
    (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 0,
  );
}

/** A box whose height is stated rather than derived: `.ana-hd` (--nest-hd-h),
 *  `.prov` (a 16px chip), and the map, an <svg> with a height attribute. */
function statedHeight(el: Element): number | null {
  const attribute = el.getAttribute('height');
  if (el.tagName.toLowerCase() === 'svg' && attribute) return firstNumber(attribute);
  const value = declared(el, 'height');
  return value.endsWith('px') ? firstNumber(value) : null;
}

type Lines = (el: Element) => number;

function contentHeight(el: Element, lines: Lines): number {
  const kids = inFlow(el);
  const ownLines = hasOwnText(el) ? lines(el) * lineHeight(el) : 0;
  if (kids.length === 0) return ownLines;
  const boxes = kids.map((kid) => boxHeight(kid, lines));
  if (isColumn(el)) {
    return boxes.reduce((sum, box) => sum + box, 0) + rowGap(el) * (boxes.length - 1);
  }
  // A row is as tall as its tallest item — `.nd-meta`, `.nd-t`, `.ana-hd`.
  return Math.max(ownLines, ...boxes);
}

function boxHeight(el: Element, lines: Lines): number {
  const stated = statedHeight(el);
  if (stated !== null) return stated;
  return (
    border(el, 'top') +
    padding(el, 'top') +
    contentHeight(el, lines) +
    padding(el, 'bottom') +
    border(el, 'bottom')
  );
}

/**
 * `calc()` as the floor is written: a sum of terms, each a product of numbers.
 * Anything else comes back NaN and fails the assertion loudly rather than
 * quietly resolving to a plausible figure.
 */
function calcPx(raw: string): number {
  if (!raw) return 0;
  const body = raw.trim().replace(/^calc\(/, '').replace(/\)$/, '');
  return body
    .split('+')
    .reduce(
      (sum, term) => sum + term.split('*').reduce((product, factor) => product * Number.parseFloat(factor), 1),
      0,
    );
}

/** What the browser would paint for this card: the box model over the elements
 *  that rendered, floored by the card's own `min-height`. */
function paintedHeight(card: Element, lines: Lines = () => 1): number {
  const floor = calcPx(declared(card, 'min-height'));
  expect(Number.isFinite(floor), 'min-height did not evaluate').toBe(true);
  return Math.max(boxHeight(card, lines), floor);
}

/* ── THE BOARD, MOUNTED ──────────────────────────────────────────────────── */

const CANVAS = canvasReduce(EMPTY_CANVAS, { type: 'canvas/frame', width: 800, height: 600 });

/** The same fixture shape `anatomyRendered.test.tsx` uses: a container whose
 *  children are modules and files mixed, and one child that holds nothing — so
 *  the wall draws its zero band and the note under it. */
const GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2026-09-02T00:00:00.000Z',
  repoRoot: '/fixtures/card-painted',
  repoName: 'card-painted',
  nodes: [
    { id: 'repo', kind: 'repo', label: 'card-painted' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api' },
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

function doc(nodes: unknown[]): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'architecture',
    title: 'card-painted',
    grounded: { repoRoot: '/fixtures/card-painted', scannedAt: '2026-09-02T00:00:00.000Z' },
    nodes,
    edges: [],
  } as unknown as SeqDiagramV1;
}

/** `Board` reaches the strip and the wall through `React.lazy` — settle both
 *  promises first so one act flush is enough. */
async function preload(): Promise<void> {
  await import('./visual/VisualMetaStrip');
  await import('./visual/AnatomyPanel');
}

interface Shape {
  card: HTMLElement;
  /** The rung the card actually drew at, read off the card rather than assumed. */
  rung: LodRung;
  node: ReturnType<typeof projectDocument>['nodes'][number];
}

async function mount(
  document_: SeqDiagramV1,
  options: { visual?: boolean; anatomyOn?: string | null } = {},
): Promise<{ shape: (id: string) => Shape; panel: AnatomyPanel | null }> {
  await preload();
  const projection = projectDocument(document_);
  const index = indexAnatomy(GRAPH);
  const panel = options.anatomyOn ? anatomyPanel(GRAPH, options.anatomyOn, index) : null;
  const view = render(
    <Board
      canvas={CANVAS}
      nodes={projection.nodes}
      edges={projection.edges}
      positions={projection.positions}
      dispatch={() => {}}
      onGround={() => {}}
      visual={options.visual ?? false}
      anatomy={panel}
      anatomyKind={options.anatomyOn ? index.node(options.anatomyOn)?.kind : undefined}
      onCloseAnatomy={() => {}}
    />,
  );
  await act(async () => {});
  return {
    panel,
    shape: (id) => {
      const card = view.container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
      expect(card, `no card rendered for ${id}`).not.toBeNull();
      return {
        card,
        rung: Number(card.getAttribute('data-rung')) as LodRung,
        node: projection.nodes.find((n) => n.id === id)!,
      };
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE FOUR SHAPES
   ══════════════════════════════════════════════════════════════════════════ */

describe('cardHeight describes the card the browser paints', () => {
  it('title only — and the floor is the natural card, not eleven units over it', async () => {
    const { shape } = await mount(
      doc([{ id: 'svc:api', label: 'api', kind: 'service', evidenceRef: 'scan:api/src/server.ts:1' }]),
    );
    const { card, rung, node } = shape('svc:api');

    expect(card.querySelector('.nd-body')?.className).toBe('nd-body title-only');
    /* THE ROW THAT NEVER EXISTED. The old model reserved a header row for the
       icon; the icon is out of flow and neither `.nd-hd` nor `.nd-k` is in the
       tree at all. */
    expect(card.querySelector('.nd-hd')).toBeNull();
    expect(card.querySelector('.nd-k')).toBeNull();
    expect(card.querySelector('.nd-row')).toBeNull();
    expect(declared(card.querySelector('.nd-ic')!, 'position')).toBe('absolute');

    expect(cardHeight(node, rung)).toBe(paintedHeight(card));
    // Measured in the running app, Chrome, on this monorepo.
    expect(paintedHeight(card)).toBe(45);
    /* And the CSS floor is that same natural card rather than a fixed height
       wearing a floor's name — sheet 02.3's binding sentence, evaluated against
       the card that ships. */
    expect(calcPx(declared(card, 'min-height'))).toBe(CARD_FLOOR);
    expect(CARD_FLOOR).toBe(45);
  });

  it('a glance line costs its own lid, not only its own line', async () => {
    const { shape } = await mount(
      doc([
        {
          id: 'svc:api',
          label: 'api',
          kind: 'service',
          evidenceRef: 'scan:api/src/server.ts:1',
          detail: { whatItDoes: 'Charges an order.' },
        },
      ]),
    );
    const { card, rung, node } = shape('svc:api');

    /* The component swaps the body's class, and board.css gives the two classes
       different padding-tops. That step is a row of the card's height and the
       old arithmetic did not have it. */
    expect(card.querySelector('.nd-body')?.className).toBe('nd-body with-sub');
    expect(declared(card.querySelector('.nd-body')!, 'padding-top')).toBe('6px');

    expect(cardHeight(node, rung)).toBe(paintedHeight(card));
    expect(paintedHeight(card)).toBe(68);
  });

  it('Visual on — the strip is reserved at the row it paints', async () => {
    const { shape } = await mount(
      doc([{ id: 'svc:api', label: 'api', kind: 'service', evidenceRef: 'scan:api/src/server.ts:1' }]),
      { visual: true },
    );
    const { card, rung, node } = shape('svc:api');

    expect(card.querySelector('.nd-meta')).not.toBeNull();
    // The chip row, not the words row: this node was traced.
    expect(card.querySelector('.nd-meta .prov')).not.toBeNull();

    expect(cardHeight(node, rung, true)).toBe(paintedHeight(card));
    expect(paintedHeight(card)).toBe(70);
  });

  it('anatomy open — the wall, its frame AND its row gaps', async () => {
    const { shape, panel } = await mount(
      doc([{ id: 'svc:api', label: 'api', kind: 'service', evidenceRef: 'scan:api/src/server.ts:1' }]),
      { anatomyOn: 'svc:api' },
    );
    const { card, rung, node } = shape('svc:api');
    expect(panel!.zeroCount).toBe(1);

    const wall = card.querySelector('[data-testid="board-node-anatomy"]')!;
    /* Three children, two gaps — the second gap is what `ANATOMY_NOTE_H`
       carries and the first is what `ANATOMY_EXTRA_H` was missing. */
    expect(inFlow(wall).length).toBe(3);

    /* jsdom cannot wrap text; the note takes three --lh-10 lines in the browser
       (measured: the wall's own box came back 213 with a 42-unit note). */
    const lines: Lines = (el) => (el.classList.contains('ana-note') ? 3 : 1);

    expect(cardHeight(node, rung, false, panel)).toBe(paintedHeight(card, lines));
    expect(paintedHeight(card, lines)).toBe(262);
  });
});
