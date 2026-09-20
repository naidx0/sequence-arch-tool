/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SURFACE'S TESTID CONTRACT — Wave 5
   packages/web2/src/review/anchors.ts

   The split is the one `e2e/lib/anchors.mjs` established for the whole
   package and it is repeated here rather than restated loosely:

     IDENTITY is a `data-testid` — what a thing IS.
     STATE    is a named `data-*` attribute — what state it is IN.

   v1's e2e asked "is this card selected" with `.arch-rf-card-selected` and read
   the zoom by parsing a computed transform. The first dies with the stylesheet;
   the second was never this repo's contract. A testid and a `data-` attribute
   survive a rebuild because they are promises the product makes rather than
   by-products of how it was styled.

   WHY THIS FILE IS IN src/review/ AND NOT IN e2e/lib/. This lane owns exactly
   one directory. `e2e/lib/anchors.mjs` is shared property, and its own header
   says "new anchors land WITH the surface, not ahead of it" — so the inventory
   for this surface ships beside the surface, and the day an e2e script is
   written for it, that script imports this list instead of a hand-copied one.
   A copy is how the anchor and the element drift apart.

   EVERY ENTRY BELOW IS EMITTED BY THIS DIRECTORY TODAY. An anchor for
   something unbuilt is how a suite goes green against nothing.
   ══════════════════════════════════════════════════════════════════════════ */

export const REVIEW = {
  /** The pane itself. STATE: `data-scope`. */
  root: 'review',

  /* ── the scope segmented control — item 5.4 ────────────────────────────── */
  scopeBar: 'review-scope',
  /** One segment. STATE: `data-scope`, `data-served` ('yes'|'no'), aria-pressed. */
  scopeSeg: 'review-scope-seg',
  /** The line saying what the engine actually measured for this scope. */
  provenance: 'review-provenance',
  /** The named refusal shown for a scope the engine cannot serve. */
  gap: 'review-gap',
  /** The revision / base picker. Present only for the commit and branch scopes,
   *  because it is the thing those scopes were missing. */
  revPicker: 'review-rev-picker',

  /* ── the header and the whole-surface states ───────────────────────────── */
  head: 'review-head',
  totals: 'review-totals',
  empty: 'review-empty',
  failure: 'review-failure',
  loading: 'review-loading',

  /* ── one file — items 5.1 and 5.2 ──────────────────────────────────────── */
  /** STATE: `data-path`, `data-decision`, `data-expanded`, `data-staged`,
   *  `data-applied`. */
  file: 'review-file',
  fileHead: 'review-file-head',
  filePath: 'review-file-path',
  statAdd: 'review-stat-add',
  statDel: 'review-stat-del',
  accept: 'review-accept',
  reject: 'review-reject',
  stage: 'review-stage',
  /** Why the assistant believes this is the right change. */
  why: 'review-why',
  revert: 'review-revert',
  /* The confirm arm. Discard is the one irreversible act in the product, so it
     is a second deliberate press against a sentence naming what goes. */
  revertConfirm: 'review-revert-confirm',
  revertCancel: 'review-revert-cancel',
  apply: 'review-apply',
  commit: 'review-commit',
  commitMessage: 'review-commit-message',

  /* ── the diff — item 5.1 ───────────────────────────────────────────────── */
  diff: 'review-diff',
  hunk: 'review-hunk',
  /** STATE: `data-kind` ('add'|'del'|'context'), `data-old`, `data-new`.
   *  A removed line carries NO `data-new`: it occupies no line in the new
   *  file, and numbering it anyway anchors a comment where nothing is. */
  line: 'review-line',
  fileEmpty: 'review-file-empty',
  fileBinary: 'review-file-binary',
  fileFailure: 'review-file-failure',

  /* ── line comments — item 5.3 ──────────────────────────────────────────── */
  commentAdd: 'review-comment-add',
  commentField: 'review-comment-field',
  commentSend: 'review-comment-send',
  commentCancel: 'review-comment-cancel',
  /** STATE: `data-line`, `data-sent`. */
  comment: 'review-comment',

  /* ── the impact panel — item 5.5 / B2 ──────────────────────────────────── */
  impact: 'review-impact',
  /** STATE: `data-node-id`. */
  impactNode: 'review-impact-node',
  impactEdge: 'review-impact-edge',
  impactFn: 'review-impact-fn',
  impactCycle: 'review-impact-cycle',
  impactRisk: 'review-impact-risk',
  impactUnmapped: 'review-impact-unmapped',
  impactGap: 'review-impact-gap',
} as const;

export type ReviewAnchor = (typeof REVIEW)[keyof typeof REVIEW];
