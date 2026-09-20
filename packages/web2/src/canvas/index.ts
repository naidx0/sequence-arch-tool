/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD'S PUBLIC FACE — Wave 3
   packages/web2/src/canvas/index.ts

   One import for `app/App.tsx`, the same way `shell/index.ts`, `chat/index.ts`
   and `state/index.ts` are one import each.

   WHAT IS DELIBERATELY NOT RE-EXPORTED, and why in each case:

     board.css        the app owns the ORDER of its stylesheets and argues it in
                      one place (App.tsx's style block). A sheet that imported
                      itself from here would land wherever the module graph
                      happened to put it, which is how a radius raised off the
                      frame ends up under the sheet it was raised off.
     BoardIcon        a glyph vocabulary, not a surface. It is deleted the day
                      the shared components/Icon.tsx lands; nothing outside this
                      lane should be holding a reference to it when that
                      happens.
     ArchNode/ElbowEdge  the renderer's own node and edge types. They mean
                      nothing outside a <ReactFlow>, and exporting them would
                      invite a second board.
   ══════════════════════════════════════════════════════════════════════════ */

export { Board } from './Board';
export type { BoardEdge, BoardEdgeless, BoardEmpty, BoardPlayback, BoardProps } from './Board';
export { ConnectedBoard } from './ConnectedBoard';

/* ── THE CANVAS CHANNEL — item playback ───────────────────────────────────
 *
 * `CanvasProvider` is mounted by `app/App.tsx` inside `StoreProvider`, and
 * `useCanvas` is what `app/ConnectedIndexRail.tsx` reads the playback off. It is
 * exported from the canvas lane rather than from `app/` on purpose: the board is
 * the surface the slice describes, and a provider living in `app/` would make
 * `canvas → app → canvas` a cycle in the module graph the day anything in this
 * directory needed it. See the file's header for why it is not in `state/`. */
export { CanvasProvider, HOP_MS_FALLBACK, readHopMs, useCanvas } from './canvasChannel';
export type { CanvasChannel } from './canvasChannel';

/* ── THE DOCUMENT CHANNEL — create, rename, delete ────────────────────────
 *
 * The same relation to the `.seqd` that `CanvasProvider` has to the canvas
 * slice, mounted the same way and for the reason its header states. Editing is
 * not the board's alone — the composer edits by chat and the rail renames from
 * a tree row — so the document is a channel rather than a prop. */
export { DocProvider, useDoc } from './docChannel';
export type { DocChannel } from './docChannel';
export { docEdit } from './docEdit';
export type { DocEdit, DocEditResult } from './docEdit';
export { EMPTY_DOC_SESSION, docSessionReduce } from './docSession';
export type { DocSession, DocSessionAction } from './docSession';

/* The flow resolver. Pure, React-free, and the one place that knows a hop can
 * name a node the board does not draw. */
export { hopAt, parentLookup, promoteOnFlow, resolveFlow, sameDim } from './flowFocus';
export type { BoardFlow, BoardHop, BoardShape, HopResolution, ParentLookup } from './flowFocus';
export { KindLegend } from './KindLegend';
export { NodeCard } from './NodeCard';
export type { BoardNode, NodeCardProps } from './NodeCard';
export { ZoomCluster } from './ZoomCluster';

/* The pure layer. These are what a rail, a census or a test asks a question of,
   and none of them touches React. */
export { canvasReduce, detailBudget } from './canvasReduce';
export type { CanvasAction } from './canvasReduce';
export {
  FIT_INSET,
  FIT_MAX_ZOOM,
  FIT_MIN_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STOPS,
  clampZoom,
  fitViewport,
  stepZoom,
  unionBounds,
  wheelIntent,
  zoomPercent,
} from './camera';
export { CARD_FLOOR, CARD_W, cardBox, cardHeight } from './cardBox';
export {
  BOARD_KINDS,
  SILHOUETTES,
  boardKindFor,
  legendGroups,
  presentationFor,
  silhouetteClass,
  silhouetteGlyph,
  silhouetteLabel,
  silhouetteOf,
} from './kinds';
export type { BoardKind, KindPresentation, LegendGroup, Silhouette } from './kinds';
export {
  CARD_DRAWN_TO,
  KIND_CARRIED_TO,
  LOD_LADDER,
  rungFor,
  silhouetteSeparates,
  visibilityAt,
} from './lod';
export { boardNodeFrom, projectDocument, proofOf, provenanceOf } from './project';
export type { Projection } from './project';

/* THE LAYOUT. `elkGraphFor` and `positionsFrom` are pure and are what a test
 * asks; `layoutOffThread` is the only thing on this lane that touches a Worker,
 * and it is exported so the fold into `state/store.ts` has one name to move
 * rather than a private module to find. `elk.worker.ts` itself is NOT exported:
 * it is a worker entry point, and importing it from the main thread is exactly
 * the mistake `elkWorkerStub.test.ts` exists to catch. */
export { elkGraphFor, frameAspect, layoutOffThread, positionsFrom } from './layout';
export type { ElkEdge, ElkGraph, ElkNode } from './layout';

/* The type ramp, as arithmetic. Exported because `FIT_MIN_ZOOM` and the LOD
 * ladder are both derived from it and a surface reading one should be able to
 * see the other's derivation without opening two files. */
export { T_FLOOR, T_SUBTITLE, T_TITLE, TITLE_HOLDS_TO } from './typeRamp';

/* ── THE STEP BEFORE ALL OF THEM — ArchGraph → SeqDiagramV1 ────────────────
 *
 * LIFTED VERBATIM from packages/web/src/product/board/seqdFromGraph.ts, with
 * its test, under the governing rule: "Pure modules are inherited. Rendered
 * chrome is not." It is React-free, it compiles unchanged, and not one
 * character of it was edited on the way across — a lift that improves the
 * thing it lifts is a rewrite with none of a rewrite's tests.
 *
 * WHY IT IS EXPORTED FROM HERE AND NOT KEPT PRIVATE. `projectDocument` above
 * turns a document into cards; this turns a scanned graph into that document.
 * They are two halves of one road from the analyzer to the screen, and the
 * store binds the first half as its `project` — with no projector bound the
 * store refuses to report `attached` and the board draws nothing, which is
 * precisely the state the Wave 3 gate measured in the shipped bundle.
 * ───────────────────────────────────────────────────────────────────────── */
export {
  assertSeqdGroundedInGraph,
  countArchGraphNodes,
  enrichNodeDetailFromGraph,
  enrichSeqdWithOrphanScanNodes,
  seqdFromGraph,
} from './seqdFromGraph';
export type { ArchGraphCounts } from './seqdFromGraph';
