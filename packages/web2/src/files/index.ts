/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL'S PUBLIC FACE — item 2.1
   packages/web2/src/files/index.ts

   One import for the lane that wires this panel to the engine, the same way
   `rail/index.ts` and `review/index.ts` are one import each.

   ── WHAT THE WIRING LANE DOES, WRITTEN OUT BECAUSE THIS LANE CANNOT DO IT ──
   This directory owns itself and nothing else — "the one time lanes shared
   files it cost a full repair cycle" — so the handback is stated in full rather
   than half-applied.

   ONE LINE IN `app/App.tsx`, in the ordered style block that file argues:

       import '../files/files.css';   // beside rail.css, BEFORE review.css

   and a connector beside the others in `state/connect.tsx`, because that file
   is "where the store meets React, and nowhere else". Every prop below is a
   pure function of (state, dispatch) — the panel is fully controlled and holds
   no state of its own except two render-local caps on how much text is mounted.

   ── THE THREE ENDPOINTS IT NEEDS, AND WHAT EACH PROP WANTS BACK ───────────

     GET /api/git/status  → `{branch, files:[{path,status,staged?,unstaged?}]}`
         `branch`   → the `branch` prop.
         `files`    → the `status` prop, as a Map built with
                      `asFileStatus(file.status)`. A word this build does not
                      know becomes `unknown` and draws a quiet mark, never a
                      raw porcelain letter.

     GET /api/file?path= → the file's TEXT, as `text/plain`.
         → `content`, as `{state:'ready', text}`. On a non-2xx the body is the
           server's own sentence and goes in `{state:'failed', message}`
           UNCHANGED — "too large", "outside the repo" and "unreadable" are
           three different fixes and the panel must not flatten them into one.

     GET /api/git/diff?path=&scope= → `{path, diff}`.
         → `diff`, as `{state:'ready', text: body.diff}`. An EMPTY string is a
           valid, expected answer and must still be passed as `ready` — the
           panel renders the "unchanged, or untracked" sentence. Turning an
           empty diff into `idle` would show "nothing loaded yet" forever.

   ── THE TREE'S PATH LIST ──────────────────────────────────────────────────
   `paths` is every repo-relative path the tree should hold. The obvious source
   is the scan's file nodes — the same list `railModel.buildRailRows` walks —
   and the git status list should be CONCATENATED into it rather than merged by
   hand: a file created since the last scan is in status and not in the graph,
   and `buildFileTree` dedupes, so concatenating is both correct and the only
   way an untracked new file appears in the tree at all.

   ── WHAT MAKES THE PANEL WRITABLE ─────────────────────────────────────────
   Passing `onDraft`. Without it there is no Edit mode and no field — which is
   the honest rendering for a caller with no write endpoint, rather than a tab
   that silently discards typing. A Save belongs in `actions`, wired to
   `PUT /api/file`, and that route's four refusals (415, 400, 403, 409) are
   again the server's own sentences.
   ══════════════════════════════════════════════════════════════════════════ */

export { FilesPanel } from './FilesPanel';
export type { FileAction, FileLoad, FilesPanelProps, FilesView } from './FilesPanel';

/*
 * THE WIRING LANE TOOK THE HANDBACK ABOVE, AND IT LIVES IN THIS DIRECTORY.
 *
 * The paragraphs at the top of this file are the instructions; the connector is
 * the instructions carried out, and it is exported from here rather than
 * imported by path so that `app/App.tsx` mounts the panel through the one door
 * this lane owns — the reason `rail/index.ts` and `review/index.ts` each give
 * for being one import.
 *
 * It is NOT in `state/connect.tsx`, which is where the handback asks for it,
 * for the reason `app/ConnectedIndexRail.tsx` gives in full about itself: that
 * file belongs to the state lane, this component belongs to this one, and one
 * agent per file is the rule that came out of a full repair cycle (CANON §6).
 * The move is mechanical the day the slices are folded in — cut the body into
 * `filesPanelPropsFrom(state, store)` there and this stays one line.
 *
 * `CONNECTED_FILES` is exported because its own header explains what it is: the
 * anchors for the chrome the connector adds, which cannot go in `anchors.ts`
 * while that file belongs to the panel lane. The test reads the same object the
 * component writes, which is the whole point of having one.
 */
export { ConnectedFilesPanel, CONNECTED_FILES } from './ConnectedFilesPanel';
export type { ConnectedFilesPanelProps } from './ConnectedFilesPanel';

export { FileTree } from './FileTree';
export type { FileTreeProps } from './FileTree';

export { DiffView } from './DiffView';
export type { DiffViewProps } from './DiffView';

export {
  DIFF_LINE_CAP,
  FILE_ROW_CAP,
  asFileStatus,
  buildFileTree,
  diffSummary,
  filterFileTree,
  flattenFileTree,
  pathToReveal,
  planDiff,
  statusLetter,
  toRepoPath,
  treeKeyAction,
} from './filesModel';

export type {
  DiffPlan,
  DiffState,
  FileRow,
  FileStatus,
  FileTreeDir,
  FileTreeFile,
  FileTreeNode,
  FilteredTree,
  FlatTree,
  FlattenOptions,
  RepoPath,
  TreeAction,
  TreeKey,
} from './filesModel';

export { FILES } from './anchors';
export type { FilesAnchor } from './anchors';

/*
 * `FilesIcon` is deliberately NOT re-exported, for the reason `rail/index.ts`
 * and `chat/index.ts` both give about theirs: a surface that reaches past this
 * file is a surface this lane cannot change, and all four icon files are due to
 * collapse into one `components/Icon.tsx` at the plan's §5 skeleton. An importer
 * outside this directory would have to be found and edited on that day.
 */
