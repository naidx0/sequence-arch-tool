/* ══════════════════════════════════════════════════════════════════════════
   THE RAIL'S PUBLIC FACE — Wave 4
   packages/web2/src/rail/index.ts

   One import for the lane that wires the shell, the same way `shell/index.ts`,
   `chat/index.ts` and `boot/index.ts` are one import each.

   ── WHAT THE WIRING LANE MOUNTS ───────────────────────────────────────────
   `app/App.tsx` currently passes `rail={<NotYet what="Index" wave="Wave 4" />}`
   into `<ConnectedShell>`. That placeholder is what this replaces. This lane
   may not edit App.tsx — "You own ONE directory… the one time lanes shared
   files it cost a full repair cycle" — so the handback is written out here in
   full rather than half-applied.

   TWO LINES IN App.tsx:

       import '../rail/rail.css';        // after the chat.css line; rail.css
                                         // argues its own position in its header
       ...
       rail={<ConnectedIndexRail />}     // in place of <NotYet what="Index" …>

   and one connector beside the others in `state/connect.tsx`, because that file
   is "where the store meets React, and nowhere else". Its prop builder is a
   pure function of (state, dispatch) exactly like `chatColumnPropsFrom`:

       graph      state.repo.phase === 'attached' || 'stale' ? repo.graph : null
       functions  repo.functions                  — null until /api/functions
       coverage   the LAST assistant turn's `coverage`, or null
       playback   canvas.view.state === 'S3' ? canvas.view.playback : null
       status     repo.phase === 'scanning' ? 'reading' : phase === 'stale'
                    ? 'stale' : 'idle'
       onPlay     dispatch a canvas action that enters S3 with this playback
       onFocusNode / onOpenScope   the canvas's S2 focus and its scope push

   ── TWO THINGS THAT ARE NOT DONE, AND ARE NOT THIS LANE'S TO DO ───────────
   1. NOTHING FETCHES `/api/functions` YET. `state/initial.ts` sets
      `functions: null` and `store.ts` never sets it otherwise, so the rail
      renders its files and no functions until the store learns the route. That
      is honest — the file rung is real either way — and it is the store lane's
      call, not a second loader smuggled into a component. `GetFunctionsResponse`
      is already typed in `@sequence/api-types`; {@link buildFunctionIndex} turns
      it into the `FunctionIndex` this component wants, in one call.
   2. THE STORE HAS NO `rail/*` ACTIONS. `EMPTY_RAIL` is the declared
      `RailSlice` and nothing writes it. The rail's view state therefore lives
      in `useState` inside `IndexRail`, in exactly that slice's shape — see the
      handback paragraph in IndexRail.tsx for the mechanical move.

   `railModel` is exported whole because the canvas needs `flowForFunction` the
   day it animates a flow the chat asked for rather than one the rail clicked:
   `TurnEffect` already carries `{kind:'focus'; …; play: FunctionId | null}`,
   and the hop rule must be the same one in both places or the two surfaces
   will draw two different flows for one function.
   ══════════════════════════════════════════════════════════════════════════ */

export { IndexRail } from './IndexRail';
export type { IndexRailProps, RailStatus } from './IndexRail';

export { FlowPanel } from './FlowPanel';
export type { FlowPanelProps } from './FlowPanel';

export { NodeDetailPanel } from './NodeDetailPanel';
export type { NodeDetailPanelProps } from './NodeDetailPanel';

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

/*
 * `RailIcon` is deliberately NOT re-exported, for the reason `chat/index.ts`
 * gives about its own: a surface that reaches past this file is a surface this
 * lane cannot change, and all three icon files are due to collapse into one
 * `components/Icon.tsx` at the plan's §5 skeleton. An importer outside this
 * directory would have to be found and edited on that day.
 */
