/**
 * @sequence/export — multiple projections of one ArchGraph, as pure text.
 *
 * Browser-safe (zero Node imports): depends only on the `@sequence/schema`
 * types. Consumed by the analyzer CLI (`sequence export`) and the web Export
 * menu alike. See project.ts for the anti-drift parity design.
 */
export { mermaidSequence, mermaidFlow, actorToken } from './mermaid.js';
export {
  archGraphToSeqDiagram,
  seqDiagramMermaidFlow,
  type ArchGraphToSeqDiagramOptions,
} from './seqdiagram.js';
export {
  formatScanEvidenceRef,
  archEdgeEvidenceRef,
  archNodeEvidenceRef,
  projectedEdgeEvidenceRefs,
} from './evidenceRef.js';
export {
  archGraphToBreakoutSeqDiagram,
  type ArchGraphToBreakoutSeqDiagramOptions,
} from './seqdiagram-breakout.js';
export { dependencyMatrix } from './matrix.js';
export { graphToSequenceModel, macOsTheme, type DiagramTheme, type SequenceDiagramModel } from './diagramModel.js';
export { renderSequenceSvg } from './renderSvg.js';
export { renderSeqDiagramSvg, type RenderSeqDiagramSvgOptions } from './renderSeqDiagramSvg.js';
export {
  SEQ_CARD_H,
  SEQ_CARD_W,
  SEQ_EMPTY_MIN_H,
  SEQ_EMPTY_MIN_W,
  SEQ_LANE_GAP,
  SEQ_MIN_MSG_SLOTS,
  SEQ_MIN_VIEW_H,
  SEQ_MIN_VIEW_W,
  SEQ_NODE_H,
  SEQ_NODE_W,
  SEQ_PAD_X,
  SEQ_PAD_Y,
  SEQ_ROLLUP_ID,
  SEQ_TITLE_BLOCK_H,
  SEQ_TOP,
  assignLayers,
  boardDisplayDoc,
  buildLayeredLayout,
  docWithExpandedRollup,
  humanizeNodeLabel,
  isSequenceLayout,
  nodeCardSubtitle,
  nodeCardTitle,
  resolveFlowNodeOrder,
  resolvePrimaryNodes,
  rollupHiddenCount,
  sequenceDiagramHeight,
  sequenceMessageSlots,
  seqDiagramHasRollup,
  seqDiagramContentBounds,
  seqDiagramNodeRects,
  seqDiagramSheetBounds,
  showTitleBlock,
  type SeqDiagramPositionOverrides,
  viewBoxFromSvg,
} from './seqDiagramLayout.js';
export { renderServiceMapSvg } from './serviceMapSvg.js';
export { structuralTheme, type StructuralTheme } from './structuralTheme.js';
export { scopeGraph, withDescendants } from './scope.js';
export { archToMarkdown, markdownToArch } from './archMarkdown.js';
export {
  projectEdges,
  serviceLevelEdgeKeys,
  buildLift,
  kindFamily,
  participantKinds,
  orderParticipants,
  orderEdgesByFlow,
  type ProjectedEdge,
  type Lifted,
  type LiftedKind,
} from './project.js';

/* Opening a service — what is INSIDE it. Deliberately not
   `archGraphToBreakoutSeqDiagram`, which places the focus service and its
   service-level NEIGHBOURS: measured on shopfront, that returned none of the
   gateway's six file children. One answers "what does this talk to", the other
   "what is in it". */
export { deriveImportEdges, DERIVED_DEFAULTS } from './derivedEdges.js';
export { degreeRanking, graphStats, packageComposition, reachByDepth, thinnest } from './graphStats.js';
export type { GraphStats, PackageRow, ReachRow, StatRow } from './graphStats.js';
export type { DerivedEdge, DerivedOptions } from './derivedEdges.js';
export { serviceInterior } from './serviceInterior.js';
export type { ServiceInterior, ServiceInteriorOptions } from './serviceInterior.js';
