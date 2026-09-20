/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL'S TEST ANCHORS
   packages/web2/src/files/anchors.ts

   One frozen name per surface the tests reach for, following `review/anchors.ts`
   exactly. The point is not tidiness: a `data-testid` typed as a string literal
   in a component and typed again in a test is TWO strings, and the day someone
   renames the component's one the test goes on passing against an element that
   no longer exists — because `queryByTestId` returning null is how half of
   these assertions are written. Naming both sides off this object makes that
   failure a type error instead of a green run.

   THEY ARE ALSO THE CONTRACT WITH THE LEGIBILITY GATE, which drives the real
   app in a real browser and can only find a box by a stable name. A gate that
   hunts for a class name is a gate that breaks the first time a stylesheet is
   tidied.
   ══════════════════════════════════════════════════════════════════════════ */

export const FILES = {
  /** The whole panel root. */
  panel: 'files-panel',

  /* ── the tree ───────────────────────────────────────────────────────── */
  tree: 'files-tree',
  row: 'files-row',
  /** The "+N more not listed" line under a capped tree. */
  omitted: 'files-omitted',
  /** The sentence shown when the tree has nothing in it. */
  empty: 'files-empty',
  /** The hit count beside the filter. */
  matches: 'files-matches',
  filter: 'files-filter',

  /* ── the right side ─────────────────────────────────────────────────── */
  header: 'files-header',
  headerPath: 'files-header-path',
  /** The segmented Code / Diff / Edit control. */
  view: 'files-view',
  viewOption: 'files-view-option',
  action: 'files-action',

  code: 'files-code',
  codeLine: 'files-code-line',
  editor: 'files-editor',
  note: 'files-note',

  /* ── the diff ───────────────────────────────────────────────────────── */
  diff: 'files-diff',
  diffFile: 'files-diff-file',
  diffSummary: 'files-diff-summary',
  hunk: 'files-hunk',
  hunkHead: 'files-hunk-head',
  line: 'files-diff-line',
  diffMore: 'files-diff-more',
  diffNote: 'files-diff-note',
} as const;

export type FilesAnchor = (typeof FILES)[keyof typeof FILES];
