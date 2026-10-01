/* ══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY VIEW'S PUBLIC FACE — P9
   packages/web2/src/activity/index.ts

   One import for the wiring lane, the same way `shell/index.ts`,
   `chat/index.ts`, `state/index.ts`, `canvas/index.ts` and `review/index.ts`
   are one import each.

   ── HOW THIS IS MOUNTED, because it is an OVERLAY and not a pane ─────────

   `ShellOverlay` carries `{ kind: 'activity' }` and `app/App.tsx`'s
   `OverlayHost` answers that kind with one line:

       if (overlay.kind === 'activity') return <ConnectedActivity />;

   and `SHELL_COMMANDS` carries the row that opens it, so the surface is
   reachable from the Cmd/Ctrl-K palette that already exists. A surface a user
   cannot reach is the Wave 2 defect, and this package has a whole e2e about it.

   ── WHAT IS DELIBERATELY NOT EXPORTED ───────────────────────────────────

     activity.css   the app owns the ORDER of its stylesheets and argues it in
                    one place. A sheet that imported itself from here would land
                    wherever the module graph happened to put it.
     ActivityPane's two private halves (`RunRow`, `RunDetailPanel`) — they mean
                    nothing without the props the connected component assembles,
                    and exporting them would invite a second activity surface
                    built from the same parts.

   THE PURE LAYER IS EXPORTED ON PURPOSE. `activityModel.ts` is React-free and
   is what a test, an e2e or a later "how many runs need me" badge asks a
   question of. The plan's governing rule is that pure modules travel and
   rendered chrome does not.
   ══════════════════════════════════════════════════════════════════════════ */

export { ActivityPane } from './ActivityPane';
export type { ActivityPaneProps, RunDetail } from './ActivityPane';

export { ConnectedActivity, DEFAULT_POLL_MS } from './ConnectedActivity';
export type { ConnectedActivityProps } from './ConnectedActivity';

/* The testid inventory. An e2e script imports THIS rather than copying the
   strings, because a copy is how an anchor and its element drift apart. */
export { ACTIVITY } from './anchors';
export type { ActivityAnchor } from './anchors';

/* ── the pure layer ─────────────────────────────────────────────────────── */

export {
  ACTIVITY_BUCKETS,
  NODE_STATES,
  NODE_STATUSES,
  RUN_STATES,
  RUN_STATUSES,
  bucketOf,
  countByBucket,
  filterRuns,
  needsYou,
  nodeStatesFrom,
  programLabel,
  progressOf,
  spanLabel,
  spanMs,
  stateOf,
} from './activityModel';
export type {
  ActivityBucket,
  ActivityFilter,
  BucketCounts,
  BucketDef,
  RunProgress,
  RunStateRender,
  StateTone,
} from './activityModel';

export {
  ACTIVITY_ROUTES,
  assertSameOrigin,
  createActivityClient,
  isRunId,
  wireMessage,
} from './activityClient';
export type { ActivityClient } from './activityClient';
