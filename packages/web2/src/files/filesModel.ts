/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL'S PURE MODEL — item 2.1
   packages/web2/src/files/filesModel.ts

   No React, no DOM, no fetch. Every decision the panel makes about SHAPE — how
   a flat path list becomes a tree, which chains collapse, what a query counts
   as a hit, where an arrow key lands, how much of a diff is safe to mount — is
   decided here, so each one is a property of a function that can be asserted at
   fixture scale rather than a property of a render that can only be inspected
   by eye.

   `railModel.ts` is the precedent and this file follows it deliberately: the
   rail's own lane learned that a filter which counts RENDERED rows reports "6
   matches" for two files, and that a count a reader can disprove by looking is
   worse than no count at all. The same trap is one line away in a tree, where
   every match drags its ancestors on screen with it.

   ── THE FOUR RULES, AND THE ALTERNATIVE EACH ONE REJECTS ──────────────────

   1. SINGLE-CHILD DIRECTORY CHAINS COLLAPSE. `packages/web2/src/files` with
      one child at every step is ONE row reading `packages/web2/src/files`, not
      four rows of which three carry no information and cost four indent steps.
      Every real IDE does this, and on this monorepo the alternative is a tree
      whose first four levels are pure scaffolding: the reader burns their whole
      indent budget before reaching a file. A chain stops collapsing the moment
      a directory has two children OR its only child is a FILE — folding a file
      into its parent's label would hide the one row the reader came for behind
      a name that looks like a folder.

   2. THE FILTER COUNTS HITS, NOT SCAFFOLDING. Sheet 11.5, verbatim: "A
      directory revealed only to expose a match below it is not itself a match."
      {@link filterFileTree} therefore returns the revealed tree AND a count
      taken during the walk, never `rows.length` afterwards.

   3. A ONE-WORD QUERY MATCHES A NAME; A QUERY WITH A SEPARATOR MATCHES A PATH.
      This is the direct fix for the defect 11.5 records. If a file matched on
      its full path, typing `src` would report one hit for the `src` directory
      plus one for every file beneath it — the same thing counted N times, which
      is precisely "6 matches for two files" wearing a different coat. A query
      that carries a `/` is unambiguously about a location, so there it matches
      the whole path and every hit is still a DISTINCT row the reader can act
      on.

   4. THE DIFF IS CAPPED BEFORE IT IS MOUNTED, AND THE CAP IS SAID OUT LOUD.
      A unified diff is machine-generated and unbounded; `git diff HEAD` across
      a rename of a lockfile is six figures of lines, and mounting a DOM row for
      each is the rail's measured stall (typing one character matched thousands
      of rows and "stalled the whole shell") arriving through a different door.
      Capping silently would be worse than stalling, because the reader would
      believe they had seen the change. {@link planDiff} truncates and reports
      exactly how many lines it withheld.

   ── THE PARSER IS REUSED AND IS NOT REWRITTEN ─────────────────────────────
   `review/diffModel.ts` already parses this exact dialect — `git diff
   --no-color`, which is what `GET /api/git/diff` returns — and it already gets
   right the four things that silently break a diff view on it: the omitted
   hunk count (`@@ -1 +1 @@` is a count of one, not zero), the `\ No newline`
   marker, an octal-escaped quoted path, and CRLF. A second parser here would be
   a second answer to "what line number is this", the two would drift, and the
   one this panel shipped would be the one nobody had measured against real git
   output. Importing it is the whole point of it being pure.

   ── SEPARATORS ───────────────────────────────────────────────────────────
   The engine sends native separators off the scan — `packages\web2\src` on this
   machine — while `state/types.ts` declares a repo path as forward-slashed:
   "Native separators never reach the store." {@link toRepoPath} normalises on
   the way in for the same reason `railModel.toRepoPath` does, and it is the
   same one-line implementation rather than an import, because this lane owns
   one directory and a cross-lane import for four lines of string handling ties
   two release surfaces together for no benefit.
   ══════════════════════════════════════════════════════════════════════════ */

import { diffTotals, parseUnifiedDiff } from '../review/diffModel';
import type { DiffFileChange, DiffHunk, DiffLine, DiffTotals } from '../review/diffModel';

/** Repo-relative, forward slashes, no leading slash. */
export type RepoPath = string;

const BACKSLASH = String.fromCharCode(92);

/**
 * Native separator → repo separator, and nothing else.
 *
 * Total, and returns the empty path for an absent one, for the reason
 * `railModel` states: a `String(undefined)` reaching a row prints the word
 * "undefined" beside real filenames, which CANON names as "a plausible-looking
 * value" and is the one class of defect this product cannot ship.
 */
export function toRepoPath(path: string | null | undefined): RepoPath {
  if (typeof path !== 'string') return '';
  return path.split(BACKSLASH).join('/');
}

/* ========================================================================== *
 * THE TREE
 * ========================================================================== */

/**
 * `git status --porcelain`, normalised by the server into a word. The union is
 * the one `GitStatusFile.status` documents, plus the honest fallback.
 *
 * TYPED AS A UNION RATHER THAN `string` BECAUSE THE PANEL RENDERS IT. A status
 * the server invents tomorrow must arrive as `unknown` and print as a quiet
 * mark, never as a raw porcelain letter the reader has to decode.
 */
export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

const STATUSES: ReadonlySet<string> = new Set<FileStatus>([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted',
  'unknown',
]);

/** A server word this build does not know is `unknown`, never the raw word. */
export function asFileStatus(word: string | null | undefined): FileStatus {
  if (typeof word !== 'string') return 'unknown';
  const lower = word.toLowerCase();
  return STATUSES.has(lower) ? (lower as FileStatus) : 'unknown';
}

/**
 * The single letter beside a changed row, and the word it stands for.
 *
 * TWO CHANNELS FOR ONE FACT, because law 1 gives this no hue. "This file
 * changed" is not a verdict — it is neither good nor bad, and spending --fits
 * or --wont on it would make the one surface that legitimately owns those two
 * hues (the diff's own arithmetic) stop being the loudest thing on screen. The
 * letter carries it at a glance, the word carries it to a screen reader and to
 * a tooltip, and the render is identical in greyscale.
 *
 * `renamed` and `copied` share R and C with nothing else; `conflicted` takes U
 * from porcelain's own `UU`, which is what a git user already reads.
 */
const STATUS_LETTER: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflicted: 'U',
  unknown: '•',
};

export function statusLetter(status: FileStatus): string {
  return STATUS_LETTER[status];
}

export interface FileTreeFile {
  kind: 'file';
  /** The full repo-relative path. This is the string a read or a write uses. */
  path: RepoPath;
  /** The basename — what the row prints. */
  label: string;
}

export interface FileTreeDir {
  kind: 'dir';
  /**
   * The path of the DEEPEST directory in a collapsed chain, because that is
   * the directory whose children are listed under this row. Using the shallow
   * end would make the expansion key name a directory the row does not show.
   */
  path: RepoPath;
  /** `src/files` for a collapsed chain, `files` otherwise. */
  label: string;
  children: FileTreeNode[];
  /** Files at or below this row. A dir with none is never produced. */
  fileCount: number;
}

export type FileTreeNode = FileTreeDir | FileTreeFile;

interface Building {
  name: string;
  dirs: Map<string, Building>;
  files: string[];
}

function emptyBuilding(name: string): Building {
  return { name, dirs: new Map(), files: [] };
}

/**
 * A flat list of repo-relative paths → the tree an IDE draws.
 *
 * DIRECTORIES BEFORE FILES, THEN BY NAME. This is not taste: a mixed sort puts
 * `zod.ts` above the `src/` the reader is heading for, and every IDE the reader
 * has used sorts this way, so any other order costs them a scan of the whole
 * list on every glance. `localeCompare` matches what `railModel.buildRailRows`
 * already uses for its file rows, so the two surfaces cannot disagree about the
 * order of the same repository.
 *
 * TOTAL AND DEDUPING. A duplicate path, an empty string, a `./` prefix and a
 * trailing slash all arrive from real callers (a git status list concatenated
 * with a scan list produces every one of them), and each of them would
 * otherwise become a second row for one file or a directory with no name.
 */
export function buildFileTree(paths: Iterable<string>): FileTreeNode[] {
  const root = emptyBuilding('');
  const seen = new Set<string>();

  for (const raw of paths) {
    const cleaned = toRepoPath(raw)
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    /* A TRAILING SLASH IS A DIRECTORY AND IS DROPPED WHOLE. It is the one
       unambiguous signal in this input, and stripping it before using it is how
       `src/` became a FILE called `src` sitting beside the directory `src` —
       two rows for one thing, which is the "6 matches for two files" defect
       reaching the tree instead of the count. A directory carries no
       information a tree built from its files does not already have. */
    if (cleaned.endsWith('/')) continue;
    const path = cleaned;
    if (path === '' || seen.has(path)) continue;
    seen.add(path);

    const segments = path.split('/').filter((s) => s !== '' && s !== '.');
    if (segments.length === 0) continue;

    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i]!;
      let next = node.dirs.get(name);
      if (!next) {
        next = emptyBuilding(name);
        node.dirs.set(name, next);
      }
      node = next;
    }
    node.files.push(segments[segments.length - 1]!);
  }

  return materialise(root, '');
}

/**
 * The collapse, and the reason it is done HERE rather than in the renderer.
 *
 * A renderer that collapsed while walking would have to decide, per frame,
 * which of four directory rows is "the" row — and the expansion key, the
 * keyboard's idea of a parent, and the filter's idea of an ancestor would each
 * get their own answer. One collapsed node with one path and one label means
 * all three read the same string.
 */
function materialise(node: Building, prefix: string): FileTreeNode[] {
  const out: FileTreeNode[] = [];

  for (const child of node.dirs.values()) {
    let label = child.name;
    let path = prefix === '' ? child.name : `${prefix}/${child.name}`;
    let current = child;

    /* THE CHAIN, AND THE TWO CONDITIONS THAT END IT. One subdirectory and no
       files keeps folding; a second child of any kind, or a single child that
       is a file, stops. A guard against a cycle is unnecessary — the structure
       was just built from strings and is a tree by construction — but the loop
       is still bounded by path depth rather than by a `while (true)`. */
    for (let depth = 0; depth < 64; depth += 1) {
      if (current.files.length !== 0 || current.dirs.size !== 1) break;
      const only = [...current.dirs.values()][0]!;
      label = `${label}/${only.name}`;
      path = `${path}/${only.name}`;
      current = only;
    }

    const children = materialise(current, path);
    /* A directory with no files anywhere under it is not produced at all. The
       input is a list of FILES, so an empty directory cannot arise from a real
       repository listing — but a caller passing a directory path by mistake
       would otherwise mount a row that opens onto nothing. */
    let fileCount = 0;
    for (const grandchild of children) {
      fileCount += grandchild.kind === 'file' ? 1 : grandchild.fileCount;
    }
    if (fileCount === 0) continue;
    out.push({ kind: 'dir', path, label, children, fileCount });
  }

  out.sort((a, b) => a.label.localeCompare(b.label));

  const files: FileTreeNode[] = node.files
    .map((name) => ({
      kind: 'file' as const,
      path: prefix === '' ? name : `${prefix}/${name}`,
      label: name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...out, ...files];
}

/* ========================================================================== *
 * THE FILTER — sheet 11.5's rule, applied to a tree
 * ========================================================================== */

export interface FilteredTree {
  nodes: FileTreeNode[];
  /**
   * Hits. `null` when there is no query at all, which is a different fact from
   * "zero hits" and reads differently in the header — the rail's `FilteredRows`
   * draws the same distinction for the same reason.
   */
  matches: number | null;
}

/**
 * A query with a separator is about a LOCATION and matches the whole path;
 * a query without one is about a NAME and matches the row's own label.
 *
 * See rule 3 in the header for the defect the second half prevents. Note that a
 * collapsed chain's label is `src/files`, which contains a separator — so the
 * label test is run on the label whatever the query looks like, and a reader
 * who types `src/files` still finds the collapsed row they can see.
 */
function hits(node: FileTreeNode, query: string): boolean {
  if (node.label.toLowerCase().includes(query)) return true;
  if (!query.includes('/')) return false;
  return node.path.toLowerCase().includes(query);
}

/**
 * The revealed tree, and an honest count.
 *
 * TWO RULES THAT LOOK LIKE ONE AND ARE NOT:
 *
 *   - a directory kept ONLY because something below it matched is scaffolding.
 *     It is rendered, because a match with no path to it is unreachable, and it
 *     is NOT counted. This is sheet 11.5 verbatim.
 *   - a directory whose own name matched keeps its whole subtree, because the
 *     reader asked for that folder and a folder that opens onto nothing is a
 *     dead row. Its descendants are still not counted: the reader typed one
 *     thing and found one thing, and reporting "1 match" beside forty visible
 *     rows is the truth, where "41" would be a number they could disprove by
 *     reading it.
 */
export function filterFileTree(nodes: FileTreeNode[], query: string): FilteredTree {
  const q = query.trim().toLowerCase();
  if (q === '') return { nodes, matches: null };

  let matches = 0;

  const walk = (list: FileTreeNode[]): FileTreeNode[] => {
    const kept: FileTreeNode[] = [];
    for (const node of list) {
      const own = hits(node, q);
      if (own) matches += 1;

      if (node.kind === 'file') {
        if (own) kept.push(node);
        continue;
      }

      if (own) {
        /* The subtree comes through whole and uncounted — see above. The walk
           does not descend, so nothing inside it can add to `matches`. */
        kept.push(node);
        continue;
      }

      const children = walk(node.children);
      if (children.length === 0) continue;
      let fileCount = 0;
      for (const child of children) fileCount += child.kind === 'file' ? 1 : child.fileCount;
      kept.push({ ...node, children, fileCount });
    }
    return kept;
  };

  return { nodes: walk(nodes), matches };
}

/* ========================================================================== *
 * FLATTENING — what the renderer and the keyboard both read
 * ========================================================================== */

export interface FileRow {
  kind: 'dir' | 'file';
  path: RepoPath;
  label: string;
  /** 0 at the root. One indent step per level; the renderer multiplies. */
  depth: number;
  /** Directories only. Files carry `false` so a caller never branches on it. */
  expanded: boolean;
  /** Files at or below this row. 1 for a file. */
  fileCount: number;
  /** This file changed, or something under this directory did. */
  dirty: boolean;
  /** The file's own status. `null` for a clean file and for every directory. */
  status: FileStatus | null;
}

export interface FlattenOptions {
  /** Expanded directory paths, or `'all'` for a filtered tree. */
  expanded: ReadonlySet<RepoPath> | 'all';
  /** Path → status, from `GET /api/git/status`. */
  status?: ReadonlyMap<RepoPath, FileStatus> | null;
  /** The most rows to return. See {@link FILE_ROW_CAP}. */
  cap?: number;
}

export interface FlatTree {
  rows: FileRow[];
  /**
   * Rows the cap withheld. SAID, NEVER SILENT: a list that quietly stops tells
   * the reader their repository contains exactly what they can see, and the one
   * number they cannot check from the screen is the one that matters.
   */
  omitted: number;
}

/**
 * The most rows this panel will mount at once.
 *
 * THE SAME MEASURED PROBLEM THE RAIL RECORDS, ONE SURFACE OVER: typing one or
 * two characters into a filter — the exact gesture a filter exists for —
 * matched thousands of rows on this repository and mounted a DOM button for
 * every one, stalling the whole shell. The rail settled on 300 against the
 * READER rather than the renderer: past a few hundred rows nobody is scanning a
 * list, they are refining the query, and the honest response is to say how many
 * more there are. The same number is used here so two lists in one product do
 * not truncate at two different places.
 */
export const FILE_ROW_CAP = 300;

/**
 * The tree → the flat list of visible rows, in render order.
 *
 * FLAT, THOUGH THE STRUCTURE IS A TREE, AND THAT IS THE POINT. Keyboard
 * navigation is "the next visible row", the selected row is an index, and the
 * cap is a slice — all three are one-liners on a list and each is a recursive
 * walk with its own edge cases on a tree. The renderer draws the nesting from
 * `depth`, which is the only thing about the tree it needs.
 */
export function flattenFileTree(nodes: FileTreeNode[], options: FlattenOptions): FlatTree {
  const { expanded, status = null, cap = FILE_ROW_CAP } = options;
  const all = expanded === 'all';
  const isOpen = (path: RepoPath) => all || (expanded as ReadonlySet<RepoPath>).has(path);

  const rows: FileRow[] = [];

  const dirtyUnder = (node: FileTreeNode): boolean => {
    if (status === null) return false;
    if (node.kind === 'file') return status.has(node.path);
    for (const child of node.children) {
      if (dirtyUnder(child)) return true;
    }
    return false;
  };

  const walk = (list: FileTreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind === 'file') {
        const own = status?.get(node.path) ?? null;
        rows.push({
          kind: 'file',
          path: node.path,
          label: node.label,
          depth,
          expanded: false,
          fileCount: 1,
          dirty: own !== null,
          status: own,
        });
        continue;
      }
      const open = isOpen(node.path);
      rows.push({
        kind: 'dir',
        path: node.path,
        label: node.label,
        depth,
        expanded: open,
        fileCount: node.fileCount,
        dirty: dirtyUnder(node),
        status: null,
      });
      if (open) walk(node.children, depth + 1);
    }
  };

  walk(nodes, 0);

  if (rows.length > cap) return { rows: rows.slice(0, cap), omitted: rows.length - cap };
  return { rows, omitted: 0 };
}

/**
 * Every directory on the way to a path, shallowest first.
 *
 * The panel needs this to reveal a file the CHAT selected — the engine names a
 * path, and a tree that scrolled to a row inside four collapsed directories
 * would scroll to nothing. It walks the real tree rather than splitting the
 * string, because a collapsed chain's expansion key is `src/files` and the
 * string split would produce `src` and `src/files`, of which only the second
 * exists as a row.
 */
export function pathToReveal(nodes: FileTreeNode[], target: RepoPath): RepoPath[] {
  const out: RepoPath[] = [];

  const walk = (list: FileTreeNode[]): boolean => {
    for (const node of list) {
      if (node.kind === 'file') {
        if (node.path === target) return true;
        continue;
      }
      if (node.path === target) return true;
      out.push(node.path);
      if (walk(node.children)) return true;
      out.pop();
    }
    return false;
  };

  return walk(nodes) ? out : [];
}

/* ========================================================================== *
 * THE KEYBOARD
 * ========================================================================== */

export type TreeKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'Home'
  | 'End'
  | 'Enter';

export type TreeAction =
  /** Move the selection. Nothing opens and nothing expands. */
  | { kind: 'select'; path: RepoPath }
  | { kind: 'expand'; path: RepoPath }
  | { kind: 'collapse'; path: RepoPath }
  /** Enter on a file: the panel should show it. */
  | { kind: 'open'; path: RepoPath };

/**
 * One key press → the one thing that should happen, or nothing.
 *
 * THE SEMANTICS ARE THE ARIA TREE PATTERN AND EVERY IDE'S, NOT AN INVENTION,
 * because a reader arrives at this panel with those reflexes already loaded and
 * any deviation reads as a bug rather than as a design:
 *
 *   Down / Up     the next and previous VISIBLE row — a collapsed directory's
 *                 children are not rows, so they are skipped without a special
 *                 case, which is the whole reason the flat list exists.
 *   Right         a closed directory opens; an open one moves INTO it; a file
 *                 does nothing, and doing nothing is correct rather than a
 *                 gap — there is nowhere to the right of a leaf.
 *   Left          an open directory closes; a closed directory or a file moves
 *                 to its PARENT, which is how a reader climbs out of a deep
 *                 path without reaching for the mouse.
 *   Home / End    the first and last visible rows.
 *   Enter         a file opens; a directory toggles, because a reader who has
 *                 just arrived on a folder row means "show me what is in it".
 *
 * PURE, AND RETURNING AN ACTION RATHER THAN MUTATING, so the component that
 * owns the selection state is the only thing that changes it and this rule set
 * is assertable without a DOM. The parent lane wiring this panel to the engine
 * can also replay these actions from a command palette without touching a key
 * event.
 *
 * `null` for a key that means nothing HERE, so the caller knows not to call
 * preventDefault — swallowing Left on the first row would break the browser's
 * own caret navigation for a keystroke this tree declined to use.
 */
export function treeKeyAction(
  rows: readonly FileRow[],
  selected: RepoPath | null,
  key: TreeKey,
): TreeAction | null {
  if (rows.length === 0) return null;

  const index = selected === null ? -1 : rows.findIndex((r) => r.path === selected);

  if (key === 'Home') return { kind: 'select', path: rows[0]!.path };
  if (key === 'End') return { kind: 'select', path: rows[rows.length - 1]!.path };

  /* NOTHING SELECTED IS NOT AN ERROR STATE. A first arrow press lands on the
     first row, which is what a reader who has just tabbed into the tree means.
     Up from nothing lands on the first row too rather than the last: the
     keyboard entering a list starts at its head in every direction. */
  if (index === -1) {
    if (key === 'ArrowDown' || key === 'ArrowUp') return { kind: 'select', path: rows[0]!.path };
    return null;
  }

  const row = rows[index]!;

  if (key === 'ArrowDown') {
    const next = rows[index + 1];
    return next ? { kind: 'select', path: next.path } : null;
  }

  if (key === 'ArrowUp') {
    const previous = rows[index - 1];
    return previous ? { kind: 'select', path: previous.path } : null;
  }

  if (key === 'ArrowRight') {
    if (row.kind !== 'dir') return null;
    if (!row.expanded) return { kind: 'expand', path: row.path };
    const child = rows[index + 1];
    /* An expanded directory with nothing under it cannot occur — `buildFileTree`
       drops a directory with no files anywhere below it — but a filtered tree
       is built by a different walk, so the guard stays rather than trusting a
       rule enforced in another function. */
    return child && child.depth > row.depth ? { kind: 'select', path: child.path } : null;
  }

  if (key === 'ArrowLeft') {
    if (row.kind === 'dir' && row.expanded) return { kind: 'collapse', path: row.path };
    /* The parent is the nearest PRECEDING row one step shallower. Read off the
       flat list rather than off the path string, because a collapsed chain's
       parent is not `path.slice(0, lastIndexOf('/'))` — that string names a
       directory this tree deliberately never drew. */
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rows[i]!.depth < row.depth) return { kind: 'select', path: rows[i]!.path };
    }
    return null;
  }

  if (row.kind === 'dir') {
    return row.expanded ? { kind: 'collapse', path: row.path } : { kind: 'expand', path: row.path };
  }
  return { kind: 'open', path: row.path };
}

/* ========================================================================== *
 * THE DIFF
 * ========================================================================== */

/**
 * What the diff side is showing, as one word.
 *
 * FOUR STATES AND NOT A BOOLEAN, because each one has a different sentence and
 * a different next move for the reader, and collapsing any two of them is how a
 * blank panel comes to mean four unrelated things:
 *
 *   empty       git returned nothing. The file is unchanged, or untracked —
 *               `GET /api/git/diff` documents an empty body for both.
 *   binary      git refused to produce lines. There is a change and it has no
 *               line to show, which is NOT the same as no change.
 *   ready       there are hunks to render.
 *   unreadable  text arrived and nothing in it parsed. Never rendered as an
 *               empty panel: a parser that fails silently on one dialect looks
 *               exactly like a clean tree, and the reader would ship believing
 *               they had reviewed the change.
 */
export type DiffState = 'empty' | 'binary' | 'ready' | 'unreadable';

export interface DiffPlan {
  state: DiffState;
  /** Files, already truncated to the cap. Numbers on surviving lines are real. */
  files: DiffFileChange[];
  totals: DiffTotals;
  /** Diff lines actually present in `files`. */
  shown: number;
  /** Diff lines the cap withheld. Rendered as a sentence, never dropped. */
  omitted: number;
}

/**
 * The most diff lines mounted at once.
 *
 * A UNIFIED DIFF IS UNBOUNDED AND MACHINE-GENERATED. `git diff HEAD` over a
 * regenerated lockfile is six figures of lines on this repository alone, and
 * one DOM row per line is the rail's measured stall arriving through a
 * different door. 2,000 lines is roughly forty screens: past that the reader is
 * not reading, and the honest move is to say how many are left and let them ask
 * for more.
 */
export const DIFF_LINE_CAP = 2000;

/**
 * Unified-diff TEXT → exactly what the view renders, and nothing it must decide.
 *
 * TRUNCATION IS A SLICE OFF THE TAIL, WHICH IS THE ONLY SAFE CUT. Every line's
 * old and new numbers are absolute, computed from its hunk's own header, so
 * dropping the last N lines leaves every surviving number correct. Dropping
 * from the middle, or renumbering, would put a real-looking wrong number in
 * front of a reader on the one surface whose entire job is to be exact about
 * which line changed.
 *
 * A HUNK EMPTIED BY THE CUT IS DROPPED, AND A FILE EMPTIED BY THE CUT IS KEPT.
 * A header with no lines under it is a row that says a change is here and shows
 * none; a FILE with no hunks still carries its name and its `+a −b` arithmetic,
 * which is the one thing a reader can still act on when the cap has bitten.
 */
export function planDiff(text: string, cap: number = DIFF_LINE_CAP): DiffPlan {
  const parsed = parseUnifiedDiff(text);

  if (parsed.length === 0) {
    /* Whitespace-only is `empty`; anything else that produced no file is text
       the parser did not understand, and the two must not print the same. */
    return {
      state: text.trim() === '' ? 'empty' : 'unreadable',
      files: [],
      totals: { files: 0, added: 0, removed: 0, binary: 0 },
      shown: 0,
      omitted: 0,
    };
  }

  const totals = diffTotals(parsed);
  const state: DiffState = parsed.every((f) => f.binary) ? 'binary' : 'ready';

  let budget = Math.max(0, cap);
  let shown = 0;
  let total = 0;
  const files: DiffFileChange[] = [];

  for (const file of parsed) {
    const hunks: DiffHunk[] = [];
    for (const hunk of file.hunks) {
      total += hunk.lines.length;
      if (budget <= 0) continue;
      const take = Math.min(budget, hunk.lines.length);
      budget -= take;
      shown += take;
      hunks.push(take === hunk.lines.length ? hunk : { ...hunk, lines: hunk.lines.slice(0, take) });
    }
    files.push({ ...file, hunks });
  }

  return { state, files, totals, shown, omitted: total - shown };
}

/**
 * `12 files · +340 −118`, or the honest shorter forms.
 *
 * ONE FUNCTION, SO THERE IS ONE SENTENCE, for the reason `railModel.evidenceRef`
 * gives: every surface that reports a diff's size goes through here, which is
 * what stops the third call site writing "340 additions" and the fourth writing
 * nothing at all. The minus is U+2212, not a hyphen, because it sits beside a
 * plus in a proportional-figure run and a hyphen is visibly the wrong height.
 */
export function diffSummary(totals: DiffTotals): string {
  if (totals.files === 0) return 'no changes';
  const files = `${totals.files} file${totals.files === 1 ? '' : 's'}`;
  if (totals.added === 0 && totals.removed === 0) {
    return totals.binary > 0 ? `${files} · binary` : files;
  }
  return `${files} · +${totals.added} −${totals.removed}`;
}

/* Re-exported so a consumer of this panel types against ONE module. The
   declarations themselves stay in `review/diffModel.ts` — a second copy of
   `DiffLine` here would be a second definition of what a line number means. */
export type { DiffFileChange, DiffHunk, DiffLine, DiffTotals };
