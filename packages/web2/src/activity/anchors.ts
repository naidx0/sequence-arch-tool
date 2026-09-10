/* ══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY VIEW'S TESTID CONTRACT — P9
   packages/web2/src/activity/anchors.ts

   The split is the one `review/anchors.ts` and `e2e/lib/anchors.mjs` already
   established for this package, and it is repeated rather than restated
   loosely:

     IDENTITY is a `data-testid` — what a thing IS.
     STATE    is a named `data-*` attribute — what state it is IN.

   EVERY ENTRY BELOW IS EMITTED BY THIS DIRECTORY TODAY. An anchor for
   something unbuilt is how a suite goes green against nothing.
   ══════════════════════════════════════════════════════════════════════════ */

export const ACTIVITY = {
  /** The pane itself. STATE: `data-bucket` — which filter is applied. */
  root: 'activity',

  /* ── the filter bar — Codex's Unread/Running/Waiting/Blocked ──────────── */
  bucketBar: 'activity-buckets',
  /** One filter. STATE: `data-bucket`, `data-count`, aria-pressed. */
  bucketBtn: 'activity-bucket',

  /* ── the three absences, told apart ───────────────────────────────────── */
  /** The engine has NOT answered. No count, no rows, no status. */
  unanswered: 'activity-unanswered',
  /** The engine answered and listed nothing. A measurement, not an absence. */
  empty: 'activity-empty',
  /** The engine refused or could not be reached — in its own words. */
  failure: 'activity-failure',
  /** The filter is applied and matches none of the runs the engine listed. */
  noMatch: 'activity-nomatch',

  /* ── the list ─────────────────────────────────────────────────────────── */
  list: 'activity-list',
  /** One run. STATE: `data-run-id`, `data-status`, `data-tone`, `data-bucket`,
   *  `data-open`. */
  row: 'activity-row',
  /** The state, as a word. The dot beside it is decoration; this is the claim. */
  rowState: 'activity-row-state',
  /** What the run is running — the program's own name. */
  rowProgram: 'activity-row-program',
  /** `nodesDone`/`nodesTotal`, drawn only when the engine supplied a
   *  denominator. */
  rowProgress: 'activity-row-progress',
  /** How much of the tree the run moved. ABSENT when it was not measured -
   *  a run still going, or a repository git could not read - and absent is
   *  NOT zero, so the element is not rendered at all rather than showing a
   *  number nobody measured. */
  rowChanged: 'activity-row-changed',
  /** The engine's own run-level error sentence. Never composed here. */
  rowError: 'activity-row-error',
  /** Why the run's own declared gates rejected its result — the checker's own
   *  words and the scheduler's own note, one line each. Drawn only when the
   *  engine supplied them. */
  rowViolations: 'activity-row-violations',
  rowMeta: 'activity-row-meta',
  refresh: 'activity-refresh',

  /* ── one run, opened ──────────────────────────────────────────────────── */
  detail: 'activity-detail',
  detailClose: 'activity-detail-close',
  detailLoading: 'activity-detail-loading',
  detailFailure: 'activity-detail-failure',
  /** One node of the opened run. STATE: `data-node-id`, `data-node-status`. */
  detailNode: 'activity-detail-node',
  /** A loud run-level signal the scheduler emitted. */
  detailNote: 'activity-detail-note',
  /** One reason this run's result was rejected by a gate the run declared. */
  detailViolation: 'activity-detail-violation',
  /** One committed row of the run's durable log. STATE: `data-seq`. */
  detailEvent: 'activity-detail-event',
  detailEventsEmpty: 'activity-detail-events-empty',

  /* ── starting one ─────────────────────────────────────────────────────
     The Activity overlay was a viewer for runs only the CLI could create.
     These are the identities of the half that starts one. */
  /** Opens the authoring view in place of the list. */
  newRun: 'activity-new-run',
  /** The authoring view itself. */
  author: 'activity-author',
  authorName: 'activity-author-name',
  authorInstruction: 'activity-author-instruction',
  /** Everything wrong with the form, all of it at once. */
  authorProblems: 'activity-author-problems',
  /** The engine's own refusal, verbatim. Never composed here. */
  authorFailure: 'activity-author-failure',
  authorStart: 'activity-author-start',
  authorBack: 'activity-author-back',
  /** P4 — curated built-in catalogue list inside the author form. */
  authorBuiltins: 'activity-author-builtins',
  /** One catalogue entry. STATE: `data-builtin-id`, `data-selected`. */
  authorBuiltin: 'activity-author-builtin',
  /** Clears a built-in pick and returns to the freeform fields. */
  authorCustom: 'activity-author-custom',
  /** P4 — ACP preflight note before Start (available / no agents). */
  authorAcpNote: 'activity-author-acp-note',
  /** What this run may spend. Both are enforced by the scheduler and reported
   *  back on the record, which is why they are offered where the fields
   *  nothing enforces are not. */
  authorBudgets: 'activity-author-budgets',
  authorTimeBudget: 'activity-author-time-budget',
  authorStepBudget: 'activity-author-step-budget',

  /* ── territories (git worktrees) ─────────────────────────────────────── */
  /** Parallel working trees for this attached repo. */
  territories: 'activity-territories',
  territoriesSummary: 'activity-territories-summary',
  /** One worktree row. STATE: `data-main`, `data-path`. */
  territoryRow: 'activity-territory',
  territoriesEmpty: 'activity-territories-empty',

  /* ── steering one that is already going ───────────────────────────────
     `shouldPause` reached the runner at last, so "Waiting on you" can finally
     be non-zero — and no client posted to either route, so nothing could put
     a run into that state. STATE lives on the run row's `data-status`, which
     the engine supplies; these are only the doors. */
  pause: 'activity-pause',
  resume: 'activity-resume',
  /** Opens the irreversible stop confirmation; it does not contact the engine. */
  cancel: 'activity-cancel',
  cancelGate: 'activity-cancel-gate',
  /** The second deliberate action, which is the only one that POSTs. */
  cancelConfirm: 'activity-cancel-confirm',
  cancelBack: 'activity-cancel-back',
  /** The engine's refusal to pause, resume or cancel, verbatim. */
  steerFailure: 'activity-steer-failure',
  /** Open a board-launched run on Architecture with overlay reconnect. */
  openOnBoard: 'activity-open-on-board',
} as const;

export type ActivityAnchor = (typeof ACTIVITY)[keyof typeof ACTIVITY];
