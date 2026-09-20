/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SURFACE'S PUBLIC FACE — Wave 5
   packages/web2/src/review/index.ts

   One import for the wiring lane, the same way `shell/index.ts`,
   `chat/index.ts`, `state/index.ts` and `canvas/index.ts` are one import each.

   ── HOW THIS IS MOUNTED, because it is an OVERLAY and not a pane ─────────

   `ShellOverlay` already carries `{ kind: 'review'; proposalId: ProposalId }`,
   and `app/App.tsx`'s `OverlayHost` currently answers that kind with the
   honest not-yet panel — "Review… a later wave". THIS IS THAT WAVE. The
   replacement is one arm of that switch:

       if (overlay.kind === 'review') return <ConnectedReview />;

   `ConnectedReview` needs nothing else: it reads the graph, the turns and the
   proposals off the store itself, and it dispatches the composer's own actions
   for item 5.3. This lane does not edit App.tsx.

   ── WHAT IS DELIBERATELY NOT EXPORTED, and why in each case ──────────────

     review.css   the app owns the ORDER of its stylesheets and argues it in
                  one place (App.tsx's style block). A sheet that imported
                  itself from here would land wherever the module graph
                  happened to put it — which is how a radius raised off the
                  frame ends up under the sheet it was raised off.
     ReviewIcon   a glyph vocabulary, not a surface. It is deleted the day the
                  shared components/Icon.tsx lands, and nothing outside this
                  lane should hold a reference when that happens.
     DiffView /
     ImpactPanel  the pane's own two halves. They mean nothing without the
                  reducer that feeds them, and exporting them would invite a
                  second review surface assembled from the same parts.

   THE PURE LAYER IS EXPORTED ON PURPOSE. `parseUnifiedDiff`, `changedRanges`
   and `computeReviewImpact` are React-free and are what a test, an e2e or a
   later chat-side "what did this change break" answer asks a question of. The
   plan's governing rule is that pure modules travel and rendered chrome does
   not; these are the pure ones.
   ══════════════════════════════════════════════════════════════════════════ */

export { ReviewPane } from './ReviewPane';
export type { ProposalSnapshot, ReviewPaneProps } from './ReviewPane';

export { ConnectedReview } from './ConnectedReview';
export type { ConnectedReviewProps } from './ConnectedReview';

/* The testid inventory. An e2e script imports THIS rather than copying the
   strings, because a copy is how an anchor and its element drift apart. */
export { REVIEW } from './anchors';
export type { ReviewAnchor } from './anchors';

/* ── the pure layer ─────────────────────────────────────────────────────── */

export { changedRanges, diffTotals, parseUnifiedDiff } from './diffModel';
export type {
  DiffChangeKind,
  DiffFileChange,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DiffTotals,
  LineRange,
} from './diffModel';

export {
  acceptPlan,
  commentSteer,
  emptyReview,
  pendingComments,
  reviewReduce,
  stagedPaths,
} from './reviewModel';
export type {
  ApplyState,
  DiffState,
  FileDecision,
  ReviewAction,
  ReviewFile,
  ReviewState,
} from './reviewModel';

export { REVIEW_SCOPES, scopeSupport, servedScopes } from './reviewScopes';
export type { ScopeSource, ScopeSupport } from './reviewScopes';

export { computeReviewImpact, nodeForPath } from './impactModel';
export type {
  ChangedFile,
  ImpactInput,
  ReviewImpact,
  TouchedCaller,
  TouchedEdge,
  TouchedFunction,
  TouchedNode,
} from './impactModel';

export { REVIEW_ROUTES, createReviewClient, wireMessage } from './reviewClient';
export type { ReviewClient } from './reviewClient';

export { SYNTAX_CLASSES, highlight, languageOf } from './syntax';
export type { SyntaxClass, SyntaxLanguage, SyntaxSpan } from './syntax';
