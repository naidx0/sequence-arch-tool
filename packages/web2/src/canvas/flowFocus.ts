/* ══════════════════════════════════════════════════════════════════════════
   A FLOW, RESOLVED ONTO THE BOARD — item playback
   packages/web2/src/canvas/flowFocus.ts

   docs/brand/graphite/pages/06-selection-focus-and-dimming.html §06.6:
   "the PATH IS PROMOTED first — its edges take --flow-onflow at --w-flow while
   everything else stays --flow-traced at the thinner --w-edge — and only then
   is the off-path card receded to --board-dim-opacity."

   THIS FILE IS THE STEP BETWEEN THE RAIL'S HOPS AND THAT SENTENCE, AND IT
   EXISTS BECAUSE THE TWO ARE NOT IN THE SAME VOCABULARY.

   `flowForFunction` (rail/railModel.ts) emits hops at whatever level the scan
   can PROVE. Its own code says so: it takes the card→card pair when both ends
   resolve to a card, and otherwise falls back to the file→file pair. The board
   draws service, datastore and topic nodes and nothing else. So a hop can name
   a node that is not on the board at all.

   MEASURED ON THIS MONOREPO, TODAY, BEFORE ANY OF THIS WAS WRITTEN:

     · the scan is a few hundred nodes, of which only about ten are drawable
       (all `service`, one per package) and the great majority are `file`;
     · `.sequence/functions.json` holds thousands of call edges and **every one of
       them is intra-package** — zero cross-package edges;
     · therefore `flowForFunction` produces **zero** card→card hops on this
       repository. Every traced flow here is file→file.

   A WIRING THAT ONLY HANDLED THE card→card CASE WOULD THEREFORE LIGHT NOTHING
   ON THE ONE REPOSITORY THE GATE RUNS AGAINST, while the heading claimed it
   plays. That is the exact defect this item exists to close, one level down.

   SO A HOP IS RESOLVED TO THE BOARD'S OWN LEVEL, AND THE RESOLUTION IS NAMED
   RATHER THAN HIDDEN. `HopResolution` is a four-member union and every consumer
   must handle all four, because the difference between them is the difference
   between a claim the board can make and one it cannot:

     direct      both ends are nodes the board draws. The connector between
                 them, if the board draws one, IS the hop.
     containing  an end is not drawn, so the board shows the node that CONTAINS
                 it — walked on the scan's own `parentId`, never guessed. The
                 ends still differ, so the board still moves between two cards.
     inside      both ends resolve to the SAME board node. The hop happened
                 inside that one service. This is 100% of this repository's
                 flows, and calling it `direct` would be the surface claiming a
                 service-to-service crossing the scan never found.
     none        an end resolves to nothing the board draws. Nothing is lit for
                 it, and the surface says so rather than skipping past it.

   WHY THE WALK IS HERE AND NOT REUSED FROM `railModel.ts`. That module's
   `cardOf` walks to the first ancestor of a CARD KIND. This walks to the first
   ancestor THE BOARD IS ACTUALLY DRAWING, which is the stricter question and
   the only one a card on screen can answer — a node of a card kind that the
   projection dropped is not somewhere the camera can go. Both read the same
   `parentId` field; neither derives a containment of its own.

   REACT-FREE, AND IT TAKES THE BOARD AS DATA. No graph, no document, no
   renderer: a set of ids, a list of connectors and a parent lookup. That is
   what makes every case above testable without mounting anything.
   ══════════════════════════════════════════════════════════════════════════ */

import type { DimSpec, EdgeId, FlowPlayback, NodeId } from '../state/types';

/** How a hop's end was put on the board. See the header — all four are real. */
export type HopResolution = 'direct' | 'containing' | 'inside' | 'none';

export interface BoardHop {
  /** Index into `playback.hops`, so a consumer can pair the two lists. */
  index: number;
  /** The hop's `from`, resolved to a node the board draws. Null = not drawn. */
  from: NodeId | null;
  /** The hop's `to`, resolved the same way. */
  to: NodeId | null;
  /**
   * The BOARD connector this hop rides, when the board draws one between the
   * resolved ends.
   *
   * IT IS NEVER `FlowHop.via`. `via` is an ARCH edge id; the board draws
   * `SeqDiagramEdge` ids, which `seqdFromGraph` mints separately. Copying one
   * into the other would be a surface addressing a connector by an id nothing
   * on screen carries — it would silently never match, and the promotion this
   * field exists for would never happen while the code read as if it did.
   */
  edgeId: EdgeId | null;
  how: HopResolution;
}

export interface BoardFlow {
  hops: BoardHop[];
  /**
   * What the board lights, in the frozen contract's own shape.
   *
   * NULL WHEN THE FLOW LIGHTS NOTHING, and that is not the same as an empty
   * DimSpec. An empty lit set would recede every card on the board to answer a
   * question with no answer on it — sheet 06.6: "dimming is never how the board
   * answers a question". Null leaves the board at rest.
   */
  dim: DimSpec | null;
  /** The node the board focuses at the current cursor. Null = nothing to focus. */
  focus: NodeId | null;
  /** How many hops the board can put on screen. `hops.length - shown` cannot. */
  shown: number;
}

export interface BoardShape {
  /** Every node id the board is drawing right now. */
  nodeIds: ReadonlySet<NodeId>;
  /** Every connector it is drawing, by its endpoints. */
  edges: readonly { id: EdgeId; source: NodeId; target: NodeId }[];
}

/** `parentId`, read off the scan. Null at the root, or for an id it never saw. */
export type ParentLookup = (id: NodeId) => NodeId | null;

/**
 * One end of one hop, put on the board.
 *
 * The walk is bounded by a `seen` set rather than by a depth: a malformed
 * `parentId` cycle is a fact about a scan, not something to spin on. The rail's
 * own index walks the same field with the same guard and for the same reason.
 */
function place(
  id: NodeId,
  board: BoardShape,
  parentOf: ParentLookup,
): { id: NodeId; direct: boolean } | null {
  if (board.nodeIds.has(id)) return { id, direct: true };
  const seen = new Set<NodeId>([id]);
  let cursor = parentOf(id);
  while (cursor !== null) {
    if (board.nodeIds.has(cursor)) return { id: cursor, direct: false };
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    cursor = parentOf(cursor);
  }
  return null;
}

/** The cursor, clamped into the hop list. -1 stays -1: it means "not started". */
export function hopAt(playback: FlowPlayback): number {
  if (playback.hops.length === 0) return -1;
  if (playback.cursor < 0) return -1;
  return Math.min(playback.cursor, playback.hops.length - 1);
}

/**
 * A flow, resolved onto the board it is going to be drawn over.
 *
 * PURE, AND TOTAL. Every hop produces a `BoardHop`; none is dropped. A dropped
 * hop is a hop the reader is stepping through while the board silently does
 * nothing, which is the whole failure this item was opened for.
 */
export function resolveFlow(
  playback: FlowPlayback,
  board: BoardShape,
  parentOf: ParentLookup,
): BoardFlow {
  const hops: BoardHop[] = playback.hops.map((hop, index) => {
    const from = place(hop.from, board, parentOf);
    const to = place(hop.to, board, parentOf);

    if (from === null || to === null) {
      return { index, from: from?.id ?? null, to: to?.id ?? null, edgeId: null, how: 'none' };
    }

    const how: HopResolution =
      from.id === to.id ? 'inside' : from.direct && to.direct ? 'direct' : 'containing';

    /* THE CONNECTOR IS MATCHED BY ITS ENDS, never by an id carried over from
       the other graph. A board edge joining the two resolved ends IS this hop
       at the board's level; nothing else is. `inside` can have no connector,
       because a node has no edge to itself on this board. */
    const edge =
      how === 'inside'
        ? undefined
        : board.edges.find((e) => e.source === from.id && e.target === to.id);

    return { index, from: from.id, to: to.id, edgeId: edge?.id ?? null, how };
  });

  const litNodeIds: NodeId[] = [];
  const litEdgeIds: EdgeId[] = [];
  for (const hop of hops) {
    for (const end of [hop.from, hop.to]) {
      if (end !== null && !litNodeIds.includes(end)) litNodeIds.push(end);
    }
    if (hop.edgeId !== null && !litEdgeIds.includes(hop.edgeId)) litEdgeIds.push(hop.edgeId);
  }

  const cursor = hopAt(playback);
  const current = cursor >= 0 ? hops[cursor] : null;

  return {
    hops,
    dim: litNodeIds.length ? { reason: 'playback', litNodeIds, litEdgeIds } : null,
    /* THE DESTINATION IS WHAT YOU ARE ON. A hop is an arrival; focusing its
       source would leave the card the reader just came from lit while the strip
       reads the next one. `from` is the fallback only when the destination did
       not resolve, so a half-placeable hop still moves the board somewhere real
       rather than nowhere. */
    focus: current ? (current.to ?? current.from) : null,
    shown: hops.filter((hop) => hop.how !== 'none').length,
  };
}

/**
 * SHEET 06.6's FIRST STEP: THE PATH IS PROMOTED BEFORE ANYTHING IS DIMMED.
 *
 * "its edges take --flow-onflow at --w-flow while everything else stays
 * --flow-traced at the thinner --w-edge — and only then is the off-path card
 * receded to --board-dim-opacity. Contrast is won by making the answer louder,
 * not by making the rest illegible."
 *
 * `EdgeProof` has carried `onflow` since item 3.3 and `.e-onflow` has been in
 * board.css since; NOTHING EVER SET EITHER. This is what sets it.
 *
 * IT IS APPLIED AT RENDER AND NEVER WRITTEN ONTO THE DOCUMENT. A proof stored
 * on the edge would still be there after the flow was cleared, and the reader
 * would be looking at a promoted path with nothing playing.
 *
 * IT IS A PURE FUNCTION AND NOT A LINE INSIDE THE BOARD because it cannot be
 * asserted through the board anywhere this suite can reach: @xyflow drops an
 * edge whose handles it has not measured, jsdom measures nothing, and THIS
 * REPOSITORY DRAWS NO CONNECTOR AT ALL — every edge its scan finds is an
 * import, which the board deliberately does not lift to a service connector.
 * So the rule is tested here, where it can be, rather than asserted nowhere and
 * described in a comment.
 */
export function promoteOnFlow<E extends { id: EdgeId; proof: string }>(
  edges: readonly E[],
  dim: DimSpec | null,
): readonly E[] {
  /* DECISION 6: a selection dim reads sheet 06.6's order too — the path is
     promoted before anything recedes. `path-focus` is still excluded: nothing
     builds one yet, and the test that locks this module says so in its own
     words rather than by accident. */
  if (
    dim === null ||
    (dim.reason !== 'playback' && dim.reason !== 'selection') ||
    dim.litEdgeIds.length === 0
  )
    return edges;
  const lit = new Set(dim.litEdgeIds);
  // The array identity is preserved when nothing is promoted, so a board with
  // no connector on the path does not re-route on every render of a flow.
  if (!edges.some((edge) => lit.has(edge.id))) return edges;
  return edges.map((edge) => (lit.has(edge.id) ? { ...edge, proof: 'onflow' } : edge));
}

/**
 * DECISION 6 — THE SAME PIPELINE, FED BY A CLICK.
 *
 * Sheet 06 §06.6, as amended: "Selecting a node asks a question about THAT
 * node, and the board answers by receding everything not on its path, exactly
 * as path-focus does; the dim extends today's flow-playback behaviour to the
 * selected card rather than inventing a second mechanism." So this returns the
 * same `DimSpec` playback resolves to — reason `'selection'` is the only
 * difference, and it exists so the reducer and the dot channel can tell which
 * ask produced the recede.
 *
 * THE PATH OF A SELECTION IS ITS IMMEDIATE COMPANY: the selected nodes, the
 * connectors that touch them, and those connectors' other ends. That is
 * everything the board can PROVE about "the path being read" from a click —
 * walking transitively would light a closure the reader did not ask about on a
 * graph whose edges are sparse here anyway. NULL at an empty selection: rest
 * stays at rest, for the same reason `resolveFlow` returns null.
 *
 * PURE, like everything else in this file: it takes ids and edges as data so
 * the board's host can call it in an effect and a test can call it with four
 * literals.
 */
export function selectionDim(
  selectedNodeIds: readonly NodeId[],
  edges: readonly { id: EdgeId; source: NodeId; target: NodeId }[],
): DimSpec | null {
  if (selectedNodeIds.length === 0) return null;
  const chosen = new Set<NodeId>(selectedNodeIds);
  const lit = new Set<NodeId>(selectedNodeIds);
  const litEdgeIds: EdgeId[] = [];
  for (const edge of edges) {
    if (!chosen.has(edge.source) && !chosen.has(edge.target)) continue;
    lit.add(edge.source);
    lit.add(edge.target);
    litEdgeIds.push(edge.id);
  }
  return { reason: 'selection', litNodeIds: [...lit], litEdgeIds };
}

/**
 * The spotlight for one step of a lesson (`teach:step`), resolved against what
 * the board actually DRAWS.
 *
 * GROUNDED IS NOT DRAWN, and conflating the two is what reverted the first
 * teach:step attempt (604fa893). The server validates every `nodeId` a chart
 * cites against the scanned graph, so the ids arriving here are real — but the
 * graph carries file and module nodes and the board paints services,
 * datastores and topics. Dimming from the raw list receded every card and lit
 * none: a spotlight on nothing, pointing the learner at nowhere.
 *
 * So the intersection decides, and NULL is a real answer: a step naming only
 * things this board does not draw leaves the board alone. That lesson is not
 * lost — its caption and its chart still carry it — and an untouched board is
 * honest where a fully-dimmed one is not.
 *
 * No edges are lit. A step names concepts, not a traced route; `litEdgeIds` is
 * the flow's vocabulary and borrowing it would claim a path nobody walked.
 */
export function teachDim(
  litNodeIds: readonly NodeId[] | undefined,
  drawnNodeIds: ReadonlySet<NodeId>,
): DimSpec | null {
  if (!litNodeIds || litNodeIds.length === 0) return null;
  const drawn = litNodeIds.filter((id) => drawnNodeIds.has(id));
  if (drawn.length === 0) return null;
  /* De-duplicated: a chart may cite one node from two items, and a lit set
     that repeats an id would make `sameDim` below miss a real no-op. */
  return { reason: 'teach', litNodeIds: [...new Set(drawn)], litEdgeIds: [] };
}

/**
 * THE SAME RESOLUTION, A DIFFERENT CLAIM — a symbol lookup, not a lesson.
 *
 * Identical mechanics to `teachDim` on purpose: filter to what the board
 * actually draws, de-duplicate, light no edges. What differs is the REASON, and
 * that is the entire reason this function exists rather than a second caller of
 * the first one. `teach` means a lesson step is on screen; a lookup is not a
 * lesson, and the teach lane refused to emit `teach:step` for one precisely so
 * the board would not be told a lesson happened when none did.
 *
 * NO EDGES, for `teachDim`'s reason and one of its own: a lookup answers WHERE
 * a symbol is declared, which is a fact about one node. Lighting a route
 * between two of them would claim a call the lookup never traced.
 */
export function lookupDim(
  litNodeIds: readonly NodeId[] | undefined,
  drawnNodeIds: ReadonlySet<NodeId>,
): DimSpec | null {
  if (!litNodeIds || litNodeIds.length === 0) return null;
  const drawn = litNodeIds.filter((id) => drawnNodeIds.has(id));
  if (drawn.length === 0) return null;
  return { reason: 'lookup', litNodeIds: [...new Set(drawn)], litEdgeIds: [] };
}

/**
 * Two `DimSpec`s that say the same thing.
 *
 * The board recomputes its resolution whenever the projection or the playback
 * changes, and dispatches the result. Without this the dispatch would return a
 * new object every time and the effect that produced it would run again —
 * a render loop written as a data flow. Order matters here and is not sorted
 * away: `resolveFlow` emits ids in hop order, which is stable for one flow.
 */
export function sameDim(a: DimSpec | null, b: DimSpec | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.reason === b.reason &&
    a.litNodeIds.length === b.litNodeIds.length &&
    a.litEdgeIds.length === b.litEdgeIds.length &&
    a.litNodeIds.every((id, i) => id === b.litNodeIds[i]) &&
    a.litEdgeIds.every((id, i) => id === b.litEdgeIds[i])
  );
}

/**
 * `parentId`, as a lookup, off the scan's own node list.
 *
 * Taken as a plain array of `{id, parentId}` rather than as an `ArchGraph` so
 * this module keeps no dependency on the wire types and a test can hand it four
 * literals.
 */
export function parentLookup(
  nodes: readonly { id: NodeId; parentId?: string | null }[],
): ParentLookup {
  const map = new Map<NodeId, NodeId | null>();
  for (const node of nodes) map.set(node.id, node.parentId ?? null);
  return (id) => map.get(id) ?? null;
}
