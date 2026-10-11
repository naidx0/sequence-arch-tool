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
  /**
   * THE COMPOSITE BOARD'S NESTING: member id -> the expanded group it is drawn
   * inside. A group becomes an ELK compound node; its members are laid out
   * inside it and come back in coordinates relative to it.
   */
  parentOf?: Readonly<Record<string, string>>;
}

/** ELK direction token for layered layouts. */
export function elkDirectionFor(direction: SeqDiagramLayoutDirection = 'TD'): 'RIGHT' | 'DOWN' {
  return direction === 'LR' ? 'RIGHT' : 'DOWN';
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
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** Present on a compound node (an expanded group). */
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
}

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  /** ELK's orthogonal route, relative to the node whose `edges` hold it. */
  sections?: Array<{ startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }>;
}

/* EDGE SPACING (stream 3b, owner review of shopfront): parallel lines must
   separate rather than stack into one thick bundle, and a line keeps clear of
   a box it passes. ELK's layered routing is ORTHOGONAL by default (A5 keeps
   it that way, so it is not restated here) and the board draws ELK's route. */
const EDGE_EDGE = 6;
const EDGE_NODE = 10;
const EDGE_SPACING: Record<string, string> = {
  'elk.spacing.edgeEdge': String(EDGE_EDGE),
  'elk.spacing.edgeNode': String(EDGE_NODE),
  'elk.layered.spacing.edgeEdgeBetweenLayers': String(EDGE_EDGE),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(EDGE_NODE),
  'elk.layered.mergeEdges': 'false',
};

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

/* DECISION 49 TIGHTENED BOTH, AND THE EDGE SPACING ABOVE (Jaden: "make sure
   it isn't super spread out... easy to read"). With the reskin's card the
   old 72 / 48 (and 10 / 16 for the lines) fitted shopfront at 59% in an 801px
   pane, the far titles at 9.9px; at 40 / 24 (6 / 10) it fits at 69%, measured
   with tools/measure/board-legibility.mjs on shopfront and on this monorepo:
   no label or box overlaps, and one edge crossing on the monorepo where the
   old spacing had two. */
/** `--sp-40`. Between two layers. */
const LAYER_GAP = 40;
/** `--sp-24`, the field's own pitch. The card gap within a layer. */
const PITCH = 24;

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
  const parentOf = Object.fromEntries(
    Object.entries(options.parentOf ?? {}).filter(([child, parent]) => known.has(child) && known.has(parent)),
  ) as Record<string, string>;
  const nested = Object.keys(parentOf).length > 0;
  /* NESTED: each edge is placed in the lowest group that holds both ends, with
     each end lifted to that group's direct member. The root sees only edges
     between top-level boxes, so the layered choice below is made on them. */
  const placed = nested ? placeEdges(edges, known, parentOf) : null;
  const drawn = placed
    ? (placed.get('') ?? [])
    : edges.filter((edge) => known.has(edge.source) && known.has(edge.target));
  const aspect = String(frameAspect(frame.width, frame.height));
  const direction = options.direction ?? 'TD';
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
          ...EDGE_SPACING,
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
    children: nested
      ? compoundChildren('', boxes, parentOf, placed!, { elkDirection, pitch, layerGap })
      : boxes.map((box) => ({ id: box.id, width: box.w, height: box.h })),
    edges: drawn.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/** A group's frame: room for its header above the members, a gutter around. */
export const GROUP_PAD = { top: 40, side: 16, bottom: 16 } as const;

/** The chain of groups holding `id`, innermost first; '' is the board. */
function ancestors(id: string, parentOf: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf[id];
  while (cur !== undefined && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf[cur];
  }
  out.push('');
  return out;
}

/**
 * Each edge, in the group that holds both its ends (the lowest common one),
 * with each end replaced by its ancestor that is a direct member of that
 * group. Edges that collapse onto one box, or join a group to its own member,
 * are dropped from the layout (they are still drawn). Deduplicated per group.
 */
export function placeEdges(
  edges: readonly BoardEdge[],
  known: ReadonlySet<string>,
  parentOf: Readonly<Record<string, string>>,
): Map<string, BoardEdge[]> {
  const out = new Map<string, BoardEdge[]>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    const up = ancestors(edge.source, parentOf);
    const down = new Set(ancestors(edge.target, parentOf));
    const common = up.find((g) => down.has(g)) ?? '';
    if (common === edge.source || common === edge.target) continue;
    const lift = (id: string) => {
      let cur = id;
      while ((parentOf[cur] ?? '') !== common) cur = parentOf[cur]!;
      return cur;
    };
    const source = lift(edge.source);
    const target = lift(edge.target);
    if (source === target || source === common || target === common) continue;
    const key = `${common}\u0000${source}\u0000${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(common) ?? [];
    list.push(source === edge.source && target === edge.target ? edge : { ...edge, id: `${edge.id}@${common}`, source, target });
    out.set(common, list);
  }
  return out;
}

function compoundChildren(
  group: string,
  boxes: readonly CardBox[],
  parentOf: Readonly<Record<string, string>>,
  placed: ReadonlyMap<string, BoardEdge[]>,
  spacing: { elkDirection: string; pitch: number; layerGap: number },
): ElkNode[] {
  const members = boxes.filter((box) => (parentOf[box.id] ?? '') === group);
  return members.map((box): ElkNode => {
    const inner = boxes.some((b) => parentOf[b.id] === box.id);
    if (!inner) return { id: box.id, width: box.w, height: box.h };
    const own = placed.get(box.id) ?? [];
    const padding = `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`;
    /* The frame is at least as wide as the card it replaces, so the header
       never has less room than the collapsed card had. */
    const minSize = `(${box.w}, ${GROUP_PAD.top + GROUP_PAD.bottom})`;
    return {
      id: box.id,
      layoutOptions: (own.length > 0
          ? {
              'elk.algorithm': 'layered',
              'elk.direction': spacing.elkDirection,
              'elk.padding': padding,
              'elk.spacing.nodeNode': String(spacing.pitch / 2),
              'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.layerGap / 2),
              ...EDGE_SPACING,
              'elk.separateConnectedComponents': 'true',
              'elk.nodeSize.constraints': 'MINIMUM_SIZE',
              'elk.nodeSize.minimum': minSize,
            }
          : {
              'elk.algorithm': 'rectpacking',
              'elk.aspectRatio': '1.6',
              'elk.padding': padding,
              'elk.spacing.nodeNode': String(spacing.pitch / 2),
              'elk.nodeSize.constraints': 'MINIMUM_SIZE',
              'elk.nodeSize.minimum': minSize,
            }) as Record<string, string>,
      children: compoundChildren(box.id, boxes, parentOf, placed, spacing),
      edges: own.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    };
  });
}

/** The size ELK gave every compound node (an expanded group's frame). */
export function sizesFrom(result: {
  children?: readonly ElkNode[];
}): Record<string, { w: number; h: number }> {
  const out: Record<string, { w: number; h: number }> = {};
  const walk = (nodes: readonly ElkNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.children && node.children.length > 0) {
        if (Number.isFinite(node.width) && Number.isFinite(node.height)) {
          out[node.id] = { w: node.width!, h: node.height! };
        }
        walk(node.children);
      }
    }
  };
  walk(result.children);
  return out;
}

/**
 * ELK's edge routes, in the board's absolute coordinates: edge id -> polyline.
 *
 * A section is relative to the node that holds the edge (its container), so
 * each compound node's absolute corner is added. Edges ELK only saw lifted to
 * a group member (ids with '@', see `placeEdges`) are left out: their route
 * ends on the member, not on the card the board draws.
 */
export function routesFrom(result: {
  children?: readonly ElkNode[];
  edges?: readonly ElkEdge[];
}): Record<string, ElkPoint[]> {
  const out: Record<string, ElkPoint[]> = {};
  const take = (edges: readonly ElkEdge[] | undefined, ox: number, oy: number) => {
    for (const edge of edges ?? []) {
      if (edge.id.includes('@')) continue;
      const section = edge.sections?.[0];
      if (!section || (edge.sections?.length ?? 0) !== 1) continue;
      const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      if (!pts.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) continue;
      out[edge.id] = pts.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    }
  };
  const walk = (nodes: readonly ElkNode[] | undefined, ox: number, oy: number) => {
    for (const node of nodes ?? []) {
      if (!node.children || node.children.length === 0) continue;
      const x = ox + (node.x ?? 0);
      const y = oy + (node.y ?? 0);
      take(node.edges, x, y);
      walk(node.children, x, y);
    }
  };
  take(result.edges, 0, 0);
  walk(result.children, 0, 0);
  return out;
}

/**
 * Top-level cards no edge touches, split from the rest — only when there is a
 * connected part to lay out (a board with no edge at all is packed whole).
 * A group, a member of a group and a card holding members are never orphans.
 */
export function splitOrphans(
  boxes: readonly CardBox[],
  edges: readonly BoardEdge[],
  parentOf: Readonly<Record<string, string>>,
): { connected: CardBox[]; orphans: CardBox[] } {
  const ids = new Set(boxes.map((b) => b.id));
  const touched = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    touched.add(e.source);
    touched.add(e.target);
  }
  /* An edge to a member touches every group around it. */
  for (const id of [...touched]) {
    let cur = parentOf[id];
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      touched.add(cur);
      seen.add(cur);
      cur = parentOf[cur];
    }
  }
  if (touched.size === 0) return { connected: [...boxes], orphans: [] };
  const holders = new Set(Object.values(parentOf));
  const orphans = boxes.filter(
    (b) => !touched.has(b.id) && parentOf[b.id] === undefined && !holders.has(b.id),
  );
  if (orphans.length === 0) return { connected: [...boxes], orphans: [] };
  const out = new Set(orphans.map((b) => b.id));
  return { connected: boxes.filter((b) => !out.has(b.id)), orphans };
}

/** The "Not connected" label's height above its row, in flow units. */
export const ORPHAN_LABEL_H = 24;

/**
 * The orphans in rows under the connected board: left-aligned with it, one
 * --board-field-pitch apart, wrapping at the board's width (at least three
 * cards). Returns their positions and where the row's label goes.
 */
export function placeOrphanRow(
  connected: readonly CardBox[],
  orphans: readonly CardBox[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
  sizes: Readonly<Record<string, { w: number; h: number }>>,
  parentOf: Readonly<Record<string, string>>,
): { positions: Record<string, { x: number; y: number }>; label: { x: number; y: number; count: number; ids: string[] } | null } {
  if (orphans.length === 0) return { positions: {}, label: null };
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of connected) {
    if (parentOf[b.id] !== undefined) continue;
    const at = positions[b.id];
    if (!at) continue;
    const size = sizes[b.id] ?? { w: b.w, h: b.h };
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x + size.w);
    maxY = Math.max(maxY, at.y + size.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    maxY = 0;
  }
  const widest = Math.max(...orphans.map((b) => b.w));
  const width = Math.max(maxX - minX, widest * 3 + PITCH * 2);
  const top = maxY + LAYER_GAP;
  const out: Record<string, { x: number; y: number }> = {};
  let x = minX;
  let y = top + ORPHAN_LABEL_H;
  let rowH = 0;
  for (const b of orphans) {
    if (x > minX && x + b.w > minX + width) {
      x = minX;
      y += rowH + PITCH / 2;
      rowH = 0;
    }
    out[b.id] = { x, y };
    x += b.w + PITCH / 2;
    rowH = Math.max(rowH, b.h);
  }
  return { positions: out, label: { x: minX, y: top, count: orphans.length, ids: orphans.map((b) => b.id) } };
}

/**
 * The zoom a fit would land on for this arrangement in this frame (inset by
 * FIT_INSET on every side), from the top-level boxes. Used to choose between
 * two arrangements; the camera's own fit still decides the real zoom.
 */
export function fitZoomFor(
  boxes: readonly CardBox[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
  sizes: Readonly<Record<string, { w: number; h: number }>>,
  parentOf: Readonly<Record<string, string>>,
  frame: { width: number; height: number },
): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (parentOf[b.id] !== undefined) continue;
    const at = positions[b.id];
    if (!at) continue;
    const size = sizes[b.id] ?? { w: b.w, h: b.h };
    minX = Math.min(minX, at.x);
    minY = Math.min(minY, at.y);
    maxX = Math.max(maxX, at.x + size.w);
    maxY = Math.max(maxY, at.y + size.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const usableW = frame.width - FIT_INSET * 2;
  const usableH = frame.height - FIT_INSET * 2;
  if (!(w > 0) || !(h > 0) || !(usableW > 0) || !(usableH > 0)) return 0;
  return Math.min(usableW / w, usableH / h);
}

/** Crossings between ELK's routes: pairs of segments of different edges that
 *  intersect away from both ends. */
export function routeCrossings(routes: Readonly<Record<string, readonly ElkPoint[]>>): number {
  const lines = Object.values(routes);
  let n = 0;
  const hit = (a: ElkPoint, b: ElkPoint, c: ElkPoint, d: ElkPoint) => {
    const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    if (Math.abs(den) < 1e-9) return false;
    const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
    const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
  };
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i]!;
      const B = lines[j]!;
      for (let a = 0; a < A.length - 1; a++)
        for (let b = 0; b < B.length - 1; b++) if (hit(A[a]!, A[a + 1]!, B[b]!, B[b + 1]!)) n++;
    }
  return n;
}

/** How much larger LR must fit before it beats top-to-bottom (0.1.6, the owner: "vertical layering by default"). */
export const LR_MUST_FIT_LARGER = 1.25;

/** Of two arrangements, top-to-bottom unless left-to-right fits clearly larger (by LR_MUST_FIT_LARGER); when
 *  they are that far apart in TD's favour or close, TD; LR wins only on a clear fit, and then only if it does
 *  not cross more. */
export function pickLayout<T extends { direction: 'LR' | 'TD'; zoom: number; routes: Record<string, ElkPoint[]> }>(
  lr: T,
  td: T,
): T {
  if (lr.zoom < td.zoom * LR_MUST_FIT_LARGER) return td;
  return routeCrossings(lr.routes) > routeCrossings(td.routes) ? td : lr;
}

/** ELK's answer, as the shape the board already speaks. A child ELK did not
 *  place is left out rather than defaulted to the origin: a silent 0,0 is how
 *  every unplaced node ends up in one pile in the corner. */
export function positionsFrom(result: {
  children?: readonly ElkNode[];
}): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  /* A member of a compound node comes back RELATIVE TO ITS GROUP, and stays
     that way: the board places it inside its group's frame. */
  const walk = (children: readonly ElkNode[] | undefined) => {
    for (const child of children ?? []) {
      if (typeof child.x !== 'number' || typeof child.y !== 'number') continue;
      if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) continue;
      out[child.id] = { x: child.x, y: child.y };
      walk(child.children);
    }
  };
  walk(result.children);
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

/** Start the layout worker early (the Architecture tab's hover prefetch), so
 *  the first layout does not also pay for loading elkjs. */
export function prewarmLayoutWorker(): void {
  ensureWorker();
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
