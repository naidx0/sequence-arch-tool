/* ══════════════════════════════════════════════════════════════════════════
   THE LAYOUT — ELK, wired, and shaped by the frame — item canvas-fixes 2
   packages/web2/src/canvas/layout.ts

   docs/brand/graphite/pages/05-the-canvas.html §05 (the board reads left to
   right) and pages/08-board-density-and-overflow.html §08.1 ("the budget is the
   frame, not a node count").

   ── WHAT THIS REPLACES, AND WHAT IT MEASURED ──────────────────────────────

   `project.ts` laid the graph out itself and said so in its own header: "THE
   LAYOUT IS A STAND-IN". The stand-in is depth-from-the-entry-points, one
   column per depth, which is the right picture WHEN THERE ARE EDGES — but this
   repository draws none (see `project.ts`'s note on `import` edges), so every
   node is depth 0 and all ten stacked into ONE COLUMN: 160px wide against a
   ~640px canvas, about a sixth of the width, overflowing the height by half a
   screen. Measured in Chromium against the shipped bundle:
   `e2e/board-fit.mjs` — "distinct columns across 10 cards after Fit: expected
   >= 2, got 1".

   The elkjs worker was lifted in item 3.2 and tested (`elkWorkerStub.test.ts`)
   and then nothing imported it. This module is the wire.

   ── THE TWO DECISIONS HERE, AND BOTH WERE MEASURED ──────────────────────

   (1) THE ASPECT RATIO IS THE FRAME'S — §08.1 applied to layout rather than to
   detail: the shape of the answer is the shape of the space it has to be read
   in. It is the USABLE frame's ratio, inset by --sp-24 on all four sides,
   because that is the box `fitViewport` will actually fit into; shaping the
   graph to a rectangle two gutters wider than the one it lands in is shaping it
   to the wrong rectangle.

   (2) A GRAPH WITH NO EDGE IS PACKED, NOT LAYERED. `elk.layered`'s component
   packer is what arranges disconnected pieces, and on this board it is
   demonstrably bad at it. Ten cards, elkjs 0.11.1, at the 640 x 756 canvas this
   repository actually renders — the number in each row is the zoom Fit would
   then land on, against the 0.83 floor:

       layered, aspect 0.85      → 1 column,  184 x 1230, fit 0.576  ← the defect
       layered, aspect 1.00      → 2 columns, 368 x  615, fit 1.151
       layered, aspect 2.50      → 5 columns, 920 x  246, fit 0.644
       rectpacking, aspect 0.75  → 2 columns, 374 x  621, fit 1.140

   `elk.aspectRatio` is an INPUT to layered's packer and not a promise about its
   output — handing it the true frame ratio produced a ratio of 0.15 — so a
   board that asked for the frame's shape and checked nothing would have shipped
   the column again. `rectpacking` honours it across every frame this shell
   produces, and it is the honest algorithm for the input: with no edge there is
   nothing to layer. Ten isolated nodes are a set, and arranging a set is
   packing. The moment the analyzer gives the board one drawn edge, layering is
   what the picture means and `elk.layered` is what runs.

   ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────

   NO SAME-THREAD FALLBACK THAT PULLS elkjs INTO THE MAIN BUNDLE. elkjs is
   ~500KB and the whole reason item 3.2 lifted a WORKER is that a layout of a
   real repository must not block the frame. Where there is no `Worker` — jsdom,
   and any environment that has taken workers away — this module says so by
   rejecting, and the board keeps the positions it already had. A board with a
   plainer arrangement is a legible board; a board that froze is not.

   NO RETRY, NO TIMEOUT RACE. A layout that failed is reported as failed
   (`CanvasSlice.layout`), once, and the reader keeps the previous picture.
   ══════════════════════════════════════════════════════════════════════════ */

import { FIT_INSET } from './camera.js';
import type { BoardEdge } from './Board.js';
import type { CardBox } from './cardBox.js';
import { VISUAL_STRIP_H } from './visualMeta.js';
import type { SeqDiagramLayoutDirection } from '@sequence/schema';

export interface BoardLayoutOptions {
  direction?: SeqDiagramLayoutDirection;
  /** When `circular-loop`, caller uses {@link circularLayoutPositions} instead of ELK. */
  engine?: 'layered-flow' | 'rectpacking' | 'circular-loop' | 'grid' | 'sequence';
  /**
   * VISUAL MODE'S LAYOUT PROFILE — MADR decision 9, "a layout profile, not a
   * new engine". Same algorithms, same routing; roomier spacing, and the
   * solver told to follow the document's order.
   */
  visual?: boolean;
}

/** ELK direction token for layered layouts. */
export function elkDirectionFor(direction: SeqDiagramLayoutDirection = 'LR'): 'RIGHT' | 'DOWN' {
  return direction === 'TD' ? 'DOWN' : 'RIGHT';
}

/**
 * Place nodes on a circle — for agent-workflow / feedback-loop diagrams.
 * Order follows edge walk when a cycle exists, else stable id order.
 */
export function circularLayoutPositions(
  boxes: readonly CardBox[],
  edges: readonly BoardEdge[],
  frame: { width: number; height: number },
): Record<string, { x: number; y: number }> {
  if (boxes.length === 0) return {};
  if (boxes.length === 1) {
    const only = boxes[0]!;
    return { [only.id]: { x: 0, y: 0 } };
  }

  const ids = boxes.map((b) => b.id);
  const order = cycleOrderedNodeIds(ids, edges);
  const maxDim = Math.max(...boxes.map((b) => Math.max(b.w, b.h)));
  const usableW = Math.max(1, frame.width - FIT_INSET * 2);
  const usableH = Math.max(1, frame.height - FIT_INSET * 2);
  const radius = Math.max(maxDim * 1.25, Math.min(usableW, usableH) * 0.38);

  const out: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!;
    const box = boxes.find((b) => b.id === id)!;
    const angle = (2 * Math.PI * i) / order.length - Math.PI / 2;
    out[id] = {
      x: radius * Math.cos(angle) - box.w / 2,
      y: radius * Math.sin(angle) - box.h / 2,
    };
  }
  return out;
}

/** Walk a directed cycle when present; otherwise sort ids for stable placement. */
export function cycleOrderedNodeIds(
  nodeIds: readonly string[],
  edges: readonly BoardEdge[],
): string[] {
  const known = new Set(nodeIds);
  const outAdj = new Map<string, string[]>();
  for (const id of nodeIds) outAdj.set(id, []);
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    outAdj.get(e.source)!.push(e.target);
  }

  const start = nodeIds.find((id) => (outAdj.get(id)?.length ?? 0) > 0) ?? nodeIds[0]!;
  const order: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = start;
  while (cur && !seen.has(cur) && order.length < nodeIds.length) {
    order.push(cur);
    seen.add(cur);
    const successors: string[] = outAdj.get(cur) ?? [];
    let next: string | null = null;
    for (const candidate of successors) {
      if (!seen.has(candidate)) {
        next = candidate;
        break;
      }
    }
    if (!next && successors.length > 0) next = successors[0]!;
    cur = next && next !== cur ? next : null;
  }
  for (const id of [...nodeIds].sort((a, b) => a.localeCompare(b))) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

/* ── the ELK graph, as much of it as this board uses ───────────────────────
   Typed here rather than imported from elkjs: importing a type from elkjs
   pulls the module specifier into this file, and this file is loaded on the
   main thread. The worker is the only place elkjs is allowed to exist. */

export interface ElkNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

/* ── the spacings, from the ramp rather than picked ────────────────────────
   The stand-in used --sp-40 across and --sp-24 down, and those are the two the
   sheets name for the board: --board-field-pitch is the ground's own pitch and
   --sp-40 is the space between two major sections. Keeping them means the ELK
   layout lands on the same grain the field is drawn on. */

/** `--sp-40`+. Between two layers — owner P2.6: cards were clumping on attach. */
const LAYER_GAP = 72;
/** `--board-field-pitch`+. Horizontal/vertical card gap — readable at first glance. */
const PITCH = 48;

/* ── the Visual profile's two gaps, DERIVED rather than chosen ─────────────
   MADR decision 9 asks for "larger elk.spacing.nodeNode and
   elk.layered.spacing.nodeNodeBetweenLayers", and A5 says the extra richness
   comes from "layout, hierarchy, type, spacing" — but Graphite law 4 still
   holds and a gap somebody liked the look of is an invented number.

   So both grow by exactly the row the CARD grew by — `VISUAL_STRIP_H`, imported
   rather than restated, so this file cannot drift from the height the card
   actually reserves. It is sheet 02.3's footer arithmetic (--sp-4 the column
   gap + --sp-4 the row's own padding-top + a 16px .prov = 24) PLUS the one
   hairline rule that separates the strip from the card body, which the footer
   does not carry: 4 + 1 + 4 + 16 = 25. `visualMeta.ts`'s `VISUAL_STRIP_H`
   header states why the hairline is in the number — it is a painted pixel, and
   leaving it out hands ELK and the router a box one pixel shorter than the
   card. An earlier version of this comment said 24 twice, which is the footer's
   number and not this row's; a reader who re-derived the two gaps from it would
   have got 72 and 96 and, worse, might have "corrected" VISUAL_STRIP_H down to
   match. A card that got one row taller and whose neighbours did not move is a
   board that got tighter as it got denser; adding the same 25 back keeps the
   optical whitespace where it was and lets the extra room read as room rather
   than as crowding. */
const VISUAL_PITCH = PITCH + VISUAL_STRIP_H;
const VISUAL_LAYER_GAP = LAYER_GAP + VISUAL_STRIP_H;

/**
 * THE ASPECT THE LAYOUT IS SHAPED TO — the USABLE frame, quantised.
 *
 * INSET FIRST. `fitViewport` insets by FIT_INSET on all four sides before it
 * divides, so the box the graph is actually fitted into is the frame minus two
 * gutters on each axis. That is the rectangle the layout should be the shape
 * of; the frame itself is a rectangle the graph never occupies.
 *
 * QUANTISED SECOND, and this is not defensive rounding. The frame's width
 * changes on every pixel of a resizer drag. A layout that re-packs on every one
 * of those moves the cards under the reader's hand while they are still holding
 * the grip, which is the class of defect that makes a surface feel unstable
 * without ever being wrong. Quarter steps mean the packing changes when the
 * pane changes SHAPE, not when it changes size.
 *
 * A degenerate frame answers 1 rather than 0, Infinity or NaN: every one of
 * those reaches ELK as an option string it silently gives up on, and a layout
 * that silently produced nothing is indistinguishable from one that never ran.
 */
export function frameAspect(width: number, height: number): number {
  const usableW = width - FIT_INSET * 2;
  const usableH = height - FIT_INSET * 2;
  if (!(usableW > 0) || !(usableH > 0)) return 1;
  return Math.max(0.25, Math.round((usableW / usableH) * 4) / 4);
}

/**
 * The ELK graph for a set of already-measured cards.
 *
 * PURE, and it takes `CardBox`es rather than nodes, because `cardBox.ts` is the
 * one place that knows how tall a card is — "so a hit region, an edge endpoint
 * and a fit-bounds can never disagree about where a card is". A layout computed
 * against a different height is a fourth opinion.
 */
export function elkGraphFor(
  boxes: readonly CardBox[],
  edges: readonly BoardEdge[],
  frame: { width: number; height: number },
  options: BoardLayoutOptions = {},
): ElkGraph {
  const known = new Set(boxes.map((box) => box.id));
  /* An edge to somewhere the board is not drawing would make ELK invent a node
     to hang it on, and the board would then have a card the analyzer never
     found. `project.ts` already drops these; this is the second gate, because a
     layout is not the place to discover a dangling reference — and it has to
     run BEFORE the algorithm is chosen, or a document whose only edges were
     dangling would be layered as though it had some. */
  const drawn = edges.filter((edge) => known.has(edge.source) && known.has(edge.target));
  const aspect = String(frameAspect(frame.width, frame.height));
  const direction = options.direction ?? 'LR';
  const elkDirection = elkDirectionFor(direction);

  const useLayered =
    drawn.length > 0 &&
    options.engine !== 'grid' &&
    options.engine !== 'rectpacking';

  const visual = options.visual === true;
  const pitch = visual ? VISUAL_PITCH : PITCH;
  const layerGap = visual ? VISUAL_LAYER_GAP : LAYER_GAP;

  return {
    id: 'board',
    layoutOptions: useLayered
      ? {
          'elk.algorithm': 'layered',
          /* Direction follows the system classifier — LR for service flows,
             DOWN for top-down trees (process / package maps). */
          'elk.direction': elkDirection,
          /* Islands beside a connected core still have to go somewhere, and
             without this they are laid out on top of one another. */
          'elk.separateConnectedComponents': 'true',
          'elk.aspectRatio': aspect,
          'elk.spacing.nodeNode': String(pitch),
          'elk.spacing.componentComponent': String(pitch),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
          /* ══ A4 — THE DRAWING FOLLOWS THE SPEC'S ORDER ══════════════════
             Max, 2026-09-02: "it's important that it doesn't randomly generate
             this every time. It has to be actually consistent with our design
             format."

             ELK is already deterministic — the same graph in gives the same
             coordinates out — so this is not what makes the picture stable.
             What it makes stable is WHICH order the picture is stable AROUND:
             without it, two nodes with nothing to choose between them are
             ordered by the solver's crossing heuristic, so adding an unrelated
             third node can reshuffle the first two. With NODES_AND_EDGES the
             tie is broken on `doc.nodes` / `doc.edges` order, which is the
             spec's own order and the only order A4 lets us break it on.

             AND THE SECOND LINE IS WHAT MAKES THE FIRST ONE TRUE OF THE WHOLE
             BOARD. `.strategy` orders nodes WITHIN a component; it says nothing
             about where the components themselves go, and
             `elk.separateConnectedComponents` above is on unconditionally. With
             the components left to ELK's packer, the paragraph above was only
             half kept: measured on this repo's own elkjs 0.11.1, a graph
             authored [a1, a2, z1, z2] placed the a-component at y=166 and the
             z-component at y=12 — the later component drawn first — while the
             same graph authored [z1, z2, a1, a2] drew them the other way up. So
             a rescan that picked up one new unconnected package could move
             every existing island, which is exactly the complaint this option
             exists to remove. `.components: MODEL_ORDER` sorts the components
             by their own first node, and with it both authorings place the
             first-authored component first.

             Visual-only, because it is a layout PROFILE (MADR decision 9) and
             changing how the plain board arranges itself is not this wave's to
             do. `elk.edgeRouting` is untouched and stays ORTHOGONAL: A5 keeps
             the SPLINES rejection, and the elbow law is a sheet rule that would
             need its own numbered GRAPHITE-DECISIONS entry to move. */
          ...(visual
            ? {
                'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
                'elk.layered.considerModelOrder.components': 'MODEL_ORDER',
              }
            : {}),
        }
      : {
          /* NO EDGE, SO NOTHING TO LAYER. See the header: layered's component
             packer answered the frame's own ratio with a 160px column, and this
             is the algorithm whose entire job is the question actually being
             asked — where do N boxes go in a rectangle of this shape. */
          'elk.algorithm': 'rectpacking',
          'elk.aspectRatio': aspect,
          'elk.spacing.nodeNode': String(pitch),
        },
    children: boxes.map((box) => ({ id: box.id, width: box.w, height: box.h })),
    edges: drawn.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/** ELK's answer, as the shape the board already speaks. A child ELK did not
 *  place is left out rather than defaulted to the origin: a silent 0,0 is how
 *  every unplaced node ends up in one pile in the corner. */
export function positionsFrom(result: {
  children?: readonly ElkNode[];
}): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const child of result.children ?? []) {
    if (typeof child.x !== 'number' || typeof child.y !== 'number') continue;
    if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) continue;
    out[child.id] = { x: child.x, y: child.y };
  }
  return out;
}

/* ── the worker, and the one instance of it ────────────────────────────────

   ONE WORKER FOR THE PAGE. Constructing one per layout means constructing one
   per resize, each of which loads and parses ~500KB of elkjs before it can do
   anything — so the first layout after a drag would be the slowest one.

   THE REQUEST ID IS NOT DECORATION. Two layouts can be in flight when the
   reader drags a resizer while a scan lands, and `postMessage` gives no
   ordering guarantee. Without the id the board can paint the older answer over
   the newer one, which reads as the layout "snapping back". */

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (value: ElkGraph) => void; reject: (e: Error) => void }>();

function failAll(reason: string) {
  for (const entry of pending.values()) entry.reject(new Error(reason));
  pending.clear();
  worker = null;
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;

  const created = new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent) => {
    const { id, result, error } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(String(error)));
    else entry.resolve(result);
  };
  // A worker that died takes every request with it, and it says so rather than
  // leaving a promise that never settles — an unsettled layout is a board
  // stuck on 'laying-out' forever with nothing on screen to explain it.
  created.onerror = () => failAll('the layout worker failed to start');
  created.onmessageerror = () => failAll('the layout worker sent something unreadable');
  worker = created;
  return worker;
}

/**
 * Lay the board out off the main thread.
 *
 * Rejects — never resolves with a guess — when there is no `Worker` to run it
 * in. The caller marks `CanvasSlice.layout` failed and keeps the picture it
 * already had, which is the honest outcome: the graph is unchanged and only its
 * arrangement is the fallback.
 */
export function layoutOffThread(graph: ElkGraph): Promise<ElkGraph> {
  const host = ensureWorker();
  if (!host) return Promise.reject(new Error('no Worker in this environment'));

  const id = (nextRequestId += 1);
  return new Promise<ElkGraph>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    host.postMessage({ id, graph });
  });
}

/** Exported for the tests, which must be able to start from a known state
 *  rather than from whatever the previous test left in the map. */
export function resetLayoutWorkerForTest(): void {
  failAll('reset');
}
