/* ══════════════════════════════════════════════════════════════════════════
   THE TREE — item 2.1
   packages/web2/src/files/FileTree.tsx

   The left half of the files panel: the repository as a tree you can walk with
   the keyboard, with one selected row and a mark on everything that changed.

   PRESENTATIONAL, WITHOUT EXCEPTION. No store, no fetch, no `useEffect`. Every
   piece of state it draws arrives as a prop and every gesture leaves as a
   callback, which is what lets the panel be mounted against a fixture in a test
   and against the live engine in the app with the same code path. The one thing
   it computes is the flattening, and that is computed here ON PURPOSE — see
   below.

   ── WHY THE FLATTEN LIVES INSIDE THIS COMPONENT ───────────────────────────
   The keyboard must navigate EXACTLY the rows on screen. If the parent
   flattened for the render and this component flattened again for the key
   handler, the two lists would agree until the first time one of them was
   passed a different cap or a different `expanded` set, and then Down would
   skip a row that is visibly there. One flatten, used by both, makes that
   disagreement unrepresentable rather than merely unlikely.

   ── THE FOUR NON-CHROMATIC CHANNELS, WHICH IS ALL THIS TREE SPENDS ────────
   Sheet 11.8 rule 2, written for the rail and binding here for the same reason:
   "No hue for a category. Height, indent, icon and type family tell the rows
   apart." A directory and a file differ by a chevron, a glyph, one indent step
   and a type family. Render this tree in greyscale and no row becomes
   ambiguous.

     SELECTION IS NEUTRAL, and that is sheet 11.4's explicit ruling — "selection
     is where the keyboard is, and is neutral". It gets `--state-selected`, the
     same fill the rail uses, and no hue.

     A CHANGED FILE GETS A LETTER, NOT A COLOUR. "This file is modified" is a
     fact about the world and not a verdict on it; spending --fits or --wont
     here would put the diff channel's own two hues on a row that is making no
     claim, and the diff — the one surface that legitimately owns them — would
     stop being the loudest thing in the panel. The letter is M/A/D/R/C/U/?,
     which a git user already reads, and the full word rides in the title and
     the accessible label so it survives a reader who does not.

   ── GLASS IS DELIBERATELY NOT HERE ────────────────────────────────────────
   Decision 14 closes with the limit, verbatim: "`backdrop-filter` costs a
   compositing layer per box. Glass goes on the chrome's fixed, small set of
   controls — never a list item, never a transcript row." A tree row is a list
   item and this tree can mount three hundred of them. Decision 16's frosted
   selection block names its selectors one at a time for the same reason, and
   `.files-row` is not among them.
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

import { FILES } from './anchors';
import { FilesIcon } from './FilesIcon';
import { FILE_ROW_CAP, flattenFileTree, statusLetter, treeKeyAction } from './filesModel';
import type { FileRow, FileStatus, FileTreeNode, RepoPath, TreeKey } from './filesModel';

const NAV_KEYS: ReadonlySet<string> = new Set<TreeKey>([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'Enter',
]);

/**
 * THE INDENT STOPS COMPOUNDING AT TEN LEVELS, AND THE NAME IS WHY.
 *
 * The rail could state that "the indent never compounds" because it is three
 * rungs deep by construction. A repository tree has no such bound, and at
 * `--rail-w` a twelfth indent step leaves under a hundred pixels for the
 * filename — so the row renders an ellipsis and nothing else, which is a row
 * that costs a line and says nothing. Past ten the rows stay aligned with each
 * other; the tree is still readable because collapsing single-child chains has
 * already removed most of the depth a monorepo carries.
 */
const MAX_INDENT = 10;

export interface FileTreeProps {
  /** The tree, already filtered if the caller is filtering. */
  nodes: FileTreeNode[];
  /**
   * Expanded directory paths, or `'all'` — which is what a FILTERED tree wants,
   * since a reader who has just typed a query is asking to see the matches and
   * not to re-open the four directories above each one.
   */
  expanded: ReadonlySet<RepoPath> | 'all';
  /** The row the keyboard is on. Neutral, never a verdict. */
  selected: RepoPath | null;
  /** Repo path → git status, for the changed marks. */
  status?: ReadonlyMap<RepoPath, FileStatus> | null;
  /** Mostly for tests; the product uses {@link FILE_ROW_CAP}. */
  cap?: number;
  /** Fires for every selection move, from the pointer and from the keyboard. */
  onSelect: (path: RepoPath) => void;
  /**
   * A directory's expansion should FLIP. Expand and collapse are one callback
   * because the caller owns the set and already knows which way it is going;
   * two callbacks would let a caller implement one and silently half-work.
   */
  onToggle: (path: RepoPath) => void;
  /** A file was activated — clicked, or Enter'd. */
  onOpen: (path: RepoPath) => void;
  /** Said when there is nothing to draw. Never a blank box. */
  emptyNote?: string;
  /** The tree's accessible name. */
  label?: string;
}

/** A DOM id per row, for `aria-activedescendant`. */
function rowId(path: RepoPath): string {
  return `files-row-${path}`;
}

export function FileTree({
  nodes,
  expanded,
  selected,
  status = null,
  cap = FILE_ROW_CAP,
  onSelect,
  onToggle,
  onOpen,
  emptyNote = 'No files here.',
  label = 'Files',
}: FileTreeProps) {
  const { rows, omitted } = useMemo(
    () => flattenFileTree(nodes, { expanded, status, cap }),
    [nodes, expanded, status, cap],
  );

  /*
   * FOCUS STAYS ON THE CONTAINER AND THE SELECTION MOVES, which is the
   * `aria-activedescendant` half of the ARIA tree pattern rather than the
   * roving-tabindex half. Both are valid; this one is chosen because the rows
   * are re-created on every expand and a roving tabindex has to re-assert
   * `.focus()` after each of those renders — and the moment that call is missed
   * the keyboard silently falls out of the tree onto the document, which is a
   * defect no unit test sees and every keyboard user hits immediately.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(event.key)) return;
    const action = treeKeyAction(rows, selected, event.key as TreeKey);
    /* Nothing happened, so nothing is swallowed. Calling preventDefault on a
       key this tree declined to use would break the browser's own behaviour
       for it — Left on the first row would stop being Left. */
    if (action === null) return;
    event.preventDefault();

    if (action.kind === 'select') onSelect(action.path);
    else if (action.kind === 'open') onOpen(action.path);
    else onToggle(action.path);
  };

  if (rows.length === 0) {
    return (
      <div className="files-tree files-tree-empty" data-testid={FILES.tree}>
        <p className="files-note" data-testid={FILES.empty}>
          {emptyNote}
        </p>
      </div>
    );
  }

  return (
    <div
      className="files-tree"
      data-testid={FILES.tree}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selected === null ? undefined : rowId(selected)}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => (
        <Row
          key={row.path}
          row={row}
          selected={row.path === selected}
          onSelect={onSelect}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
      {omitted > 0 ? (
        /* SAID, NEVER SILENT. A tree that stops at the cap without saying so
           tells the reader their repository ends here, and that is the one
           number they cannot check by looking. */
        <p className="files-note" data-testid={FILES.omitted}>
          {`+${omitted.toLocaleString('en-US')} more not listed — narrow the filter`}
        </p>
      ) : null}
    </div>
  );
}

interface RowProps {
  row: FileRow;
  selected: boolean;
  onSelect: (path: RepoPath) => void;
  onToggle: (path: RepoPath) => void;
  onOpen: (path: RepoPath) => void;
}

function Row({ row, selected, onSelect, onToggle, onOpen }: RowProps) {
  const isDir = row.kind === 'dir';
  /* A collapsed chain's label carries separators, and the identity of
     `packages/web2/src/files` is its TAIL — so it truncates at the FRONT. The
     recipe is rail.css's, `direction: rtl` with an inner <bdi>, and it is the
     only way CSS puts the ellipsis on the left without measuring the string in
     JavaScript. A plain name has no head to lose and stays left-to-right. */
  const chained = isDir && row.label.includes('/');

  const style = { '--files-depth': Math.min(row.depth, MAX_INDENT) } as CSSProperties;

  return (
    <div
      id={rowId(row.path)}
      className={`files-row files-row-${row.kind}`}
      data-testid={FILES.row}
      data-kind={row.kind}
      data-path={row.path}
      data-selected={selected ? 'true' : 'false'}
      data-dirty={row.dirty ? 'true' : 'false'}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? row.expanded : undefined}
      aria-label={
        row.status === null
          ? undefined
          : /* THE WORD, NOT THE LETTER. "M" is a glyph and means nothing read
               aloud; the status word is the whole point of having one. */
            `${row.path}, ${row.status}`
      }
      title={row.status === null ? row.path : `${row.path} — ${row.status}`}
      style={style}
      onClick={() => {
        onSelect(row.path);
        if (isDir) onToggle(row.path);
        else onOpen(row.path);
      }}
    >
      {/* The chevron sits in a fixed slot whether or not it is drawn, so every
          glyph in the tree lands on one vertical line. A file with no slot
          would shift its name half a step left of the directories around it,
          and the indent is one of the four channels that tell the rungs
          apart — it cannot also be noise. */}
      <span className="files-twist" aria-hidden="true">
        {isDir ? <FilesIcon name={row.expanded ? 'chevdown' : 'chevright'} size={12} /> : null}
      </span>
      <FilesIcon name={isDir ? 'folder' : 'file'} size={14} />
      <span className={chained ? 'files-name files-name-tail' : 'files-name'}>
        {chained ? <bdi>{row.label}</bdi> : row.label}
      </span>
      {row.status !== null ? (
        <span className="files-mark mono" aria-hidden="true">
          {statusLetter(row.status)}
        </span>
      ) : null}
      {row.status === null && row.dirty ? (
        /* A directory says only THAT something under it changed, never what:
           rolling seven files' statuses into one letter would have to pick a
           winner, and any pick is a claim the panel cannot support. */
        <span className="files-mark files-mark-dot" aria-hidden="true" />
      ) : null}
    </div>
  );
}
