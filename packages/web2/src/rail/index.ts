/* ══════════════════════════════════════════════════════════════════════════
   WHAT IS LEFT OF `rail/` — the pieces the Files surface uses.
   packages/web2/src/rail/index.ts

   The Index rail (`IndexRail`, its connector, its detail panel, file
   viewer, workspace listing and key map) was retired by owner ruling
   (docs/plans/0.1.9/HANDOFF.md, 2026-10-14) and its four useful ideas moved
   into `files/`: the function count on a file row, the "not read" disclosure,
   reveal-in-Files when a board card is clicked, and the group-by-service view.

   Kept because Files uses them: `FlowPanel` (the traced-path strip under the
   tree), `RailIcon`, and `railModel` (the function index and the hop rule).
   ══════════════════════════════════════════════════════════════════════════ */

export { FlowPanel } from './FlowPanel';
export type { FlowPanelProps } from './FlowPanel';

export {
  NOT_TRACED,
  NO_EVIDENCE_ON_HOP,
  buildFunctionIndex,
  buildRailRows,
  componentEdgeCounts,
  coverageBadgeText,
  coverageByPath,
  evidenceRef,
  filterRailRows,
  flowForFunction,
  nodeDetailViewFor,
  toRepoPath,
} from './railModel';
export type { FilteredRows, FlowTrace } from './railModel';
