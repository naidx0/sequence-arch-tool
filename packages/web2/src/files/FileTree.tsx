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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import { ConfirmDialog } from '../shell2/ConfirmDialog';
import { RailRow } from '../shell2/RailRow';

import { FILES } from './anchors';
import { FileContextMenu } from './FileContextMenu';
import type { FileMenuAction, FileMenuTarget } from './FileContextMenu';
import { canMoveInto, baseName, parentDir, validName } from './fileOpsModel';
import type { FileTreeOps } from './fileOpsModel';
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
  /** Files being edited right now (agent edit running, or an unsaved buffer): yellow, pulsing. */
  progress?: ReadonlySet<RepoPath> | null;
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
  /**
   * Round 9, ask 20: when present the tree can be organised — drag a row onto a
   * folder to move it, right-click for rename / new / duplicate / delete / copy
   * path / reveal, F2 and Delete from the keyboard. Absent, the tree is read-only
   * exactly as before.
   */
  ops?: FileTreeOps;
}

/** A DOM id per row, for `aria-activedescendant`. */
function rowId(path: RepoPath): string {
  return `files-row-${path}`;
}

/**
 * A name's two halves for a middle ellipsis: the tail is the extension and the
 * three characters before it (or the last six of a name with none), and never
 * gives way; the head gives way first.
 */
export function splitName(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf('.');
  const keep = dot > 0 ? Math.max(0, dot - 3) : Math.max(0, name.length - 6);
  return { head: name.slice(0, keep), tail: name.slice(keep) };
}


/**
 * A NAME IS NEVER CUT FROM THE FRONT. It shows whole when it fits `avail`; when it
 * does not, the middle goes: the start and the extension stay ("Doc…file",
 * "untr….ts"), with as much of the start as fits. `measure` is the width of a
 * string in the row's own font, injected so this is testable without a layout.
 * If not even "…" plus the tail fits, the elided form is still returned and CSS
 * clips its right edge, which never removes the start.
 */
export function elideName(name: string, avail: number, measure: (s: string) => number): { head: string; tail: string } {
  if (measure(name) <= avail) return { head: name, tail: '' };
  const dot = name.lastIndexOf('.');
  const tail = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : name.slice(Math.max(1, name.length - 4));
  const stem = name.slice(0, name.length - tail.length);
  if (stem.length <= 1) return { head: name, tail: '' };
  let k = stem.length - 1;
  while (k > 1 && measure(`${stem.slice(0, k)}…${tail}`) > avail) k -= 1;
  return { head: `${stem.slice(0, k)}…`, tail };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measurer(el: HTMLElement): ((s: string) => number) | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  const ctx = measureCtx;
  if (!ctx) return null;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return (s) => ctx.measureText(s).width;
}

/** The name, fitted to its own box and re-fitted whenever that box changes size
 *  (the column dragged, the pane resized, rail to drawer to full). Unmeasured
 *  (no layout, no canvas) it falls back to the static split. */
function FitName({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<{ head: string; tail: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const run = () => {
      const avail = el.clientWidth;
      const measure = measurer(el);
      if (avail <= 0 || !measure) {
        setFit(null);
        return;
      }
      setFit(elideName(label, avail, measure));
    };
    run();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run);
    ro?.observe(el);
    void document.fonts?.ready.then(run);
    return () => ro?.disconnect();
  }, [label]);
  const parts = fit ?? splitName(label);
  return (
    <span className="files-name files-name-mid" ref={ref}>
      <span className="files-name-head">{parts.head}</span>
      {parts.tail === '' ? null : <span className="files-name-end">{parts.tail}</span>}
    </span>
  );
}


type Editing =
  | { mode: 'rename'; path: string }
  | { mode: 'file' | 'folder'; parent: string };

export function FileTree({
  nodes,
  expanded,
  selected,
  status = null,
  progress = null,
  cap = FILE_ROW_CAP,
  onSelect,
  onToggle,
  onOpen,
  emptyNote = 'No files here.',
  label = 'Files',
  ops,
}: FileTreeProps) {
  const { rows, omitted } = useMemo(
    () => flattenFileTree(nodes, { expanded, status, progress, cap }),
    [nodes, expanded, status, progress, cap],
  );

  /* ── organising: menu, inline edit, delete confirm, drag ───────────────── */
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirming, setConfirming] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /* '' is the project root; null is "not over a drop target". */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const kindOf = useMemo(() => {
    const map = new Map<string, 'file' | 'dir'>();
    for (const row of rows) map.set(row.path, row.kind);
    return map;
  }, [rows]);

  /* THE OPEN FILE IS ALWAYS IN VIEW (owner, 2026-10-09: the file named at the top
     "highlighted and selected on the side rail"). A selection made from outside
     the tree (the chat naming a file, a reload) can sit below the fold; bring it
     into view once it exists as a row. `nearest` leaves a visible row alone. */
  const selectedDrawn = selected !== null && kindOf.has(selected);
  useEffect(() => {
    if (selected === null || !selectedDrawn) return;
    const el = document.getElementById(rowId(selected));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selected, selectedDrawn]);

  const isOpen = (path: string) => expanded === 'all' || expanded.has(path);

  const startCreate = (parent: string, mode: 'file' | 'folder') => {
    if (parent !== '' && !isOpen(parent)) onToggle(parent);
    setNote(null);
    setEditing({ mode, parent });
  };

  const pick = (action: FileMenuAction, target: FileMenuTarget) => {
    setMenu(null);
    if (!ops) return;
    const here = target.path;
    const dirOfTarget = target.kind === 'dir' ? here : target.kind === 'file' ? parentDir(here) : '';
    if (action === 'new-file') startCreate(dirOfTarget, 'file');
    else if (action === 'new-folder') startCreate(dirOfTarget, 'folder');
    else if (action === 'rename') {
      setNote(null);
      setEditing({ mode: 'rename', path: here });
    } else if (action === 'duplicate') void ops.duplicate(here).then(setNote);
    else if (action === 'copy-path') ops.copyPath(here);
    else if (action === 'reveal') void ops.reveal(here).then(setNote);
    else if (action === 'delete') {
      setConfirmErr(null);
      setConfirming({ path: here, kind: target.kind === 'dir' ? 'dir' : 'file' });
    }
  };

  const commitEdit = async (value: string) => {
    if (!ops || editing === null) return;
    const name = validName(value);
    if (name === null) {
      setNote('Names cannot be empty, contain a slash, or be . or ..');
      return;
    }
    const failure =
      editing.mode === 'rename'
        ? name === baseName(editing.path)
          ? null
          : await ops.rename(editing.path, name)
        : await ops.create(editing.parent, name, editing.mode);
    if (failure !== null) {
      setNote(failure);
      return;
    }
    setNote(null);
    setEditing(null);
  };

  const doDrop = (event: DragEvent, targetDir: string) => {
    event.preventDefault();
    event.stopPropagation();
    const from = dragging ?? event.dataTransfer.getData('text/x-seq-path');
    setDropTarget(null);
    setDragging(null);
    if (!ops || !from || !canMoveInto(from, targetDir)) return;
    setNote(null);
    void ops.move(from, targetDir).then(setNote);
  };

  /** The directory a drop on this row means: the folder itself, or a file's parent. */
  const dropDirFor = (row: FileRow): string => (row.kind === 'dir' ? row.path : parentDir(row.path));

  const dragHandlers = (row: FileRow) =>
    ops
      ? {
          draggable: editing === null,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.setData('text/x-seq-path', row.path);
            event.dataTransfer.setData('text/plain', row.path);
            event.dataTransfer.effectAllowed = 'move';
            setDragging(row.path);
          },
          onDragEnd: () => {
            setDragging(null);
            setDropTarget(null);
          },
          onDragOver: (event: DragEvent) => {
            const dir = dropDirFor(row);
            if (dragging === null || !canMoveInto(dragging, dir)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            if (dropTarget !== dir) setDropTarget(dir);
          },
          onDrop: (event: DragEvent) => doDrop(event, dropDirFor(row)),
        }
      : {};

  const openMenu = (event: ReactMouseEvent, path: string, kind: FileMenuTarget['kind']) => {
    if (!ops) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind !== 'root') onSelect(path);
    setMenu({ path, kind, x: event.clientX, y: event.clientY });
  };

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
    if (ops && editing === null && selected !== null) {
      if (event.key === 'F2') {
        event.preventDefault();
        setNote(null);
        setEditing({ mode: 'rename', path: selected });
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        setConfirmErr(null);
        setConfirming({ path: selected, kind: kindOf.get(selected) ?? 'file' });
        return;
      }
    }
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

  const overlays = (
    <>
      {menu ? (
        <FileContextMenu target={menu} onPick={(action) => pick(action, menu)} onClose={() => setMenu(null)} />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          icon="trash"
          danger
          busy={busy}
          error={confirmErr}
          title={confirming.kind === 'dir' ? 'Delete this folder?' : 'Delete this file?'}
          body={
            confirming.kind === 'dir'
              ? `“${confirming.path}” and everything inside it is deleted from disk.`
              : `“${confirming.path}” is deleted from disk.`
          }
          confirmLabel="Delete"
          testId="files-confirm-delete"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (!ops) return;
            setBusy(true);
            void ops.remove(confirming.path).then((failure) => {
              setBusy(false);
              if (failure !== null) setConfirmErr(failure);
              else setConfirming(null);
            });
          }}
        />
      ) : null}
    </>
  );

  const noteEl = note ? (
    <p className="files-note files-ops-note" role="alert" data-testid="files-ops-note">
      {note}
    </p>
  ) : null;

  const newRow =
    editing !== null && editing.mode !== 'rename' ? (
      <NewEntryRow
        key="new-entry"
        depth={editing.parent === '' ? 0 : (rows.find((r) => r.path === editing.parent)?.depth ?? 0) + 1}
        kind={editing.mode}
        onCommit={commitEdit}
        onCancel={() => {
          setEditing(null);
          setNote(null);
        }}
      />
    ) : null;

  if (rows.length === 0) {
    return (
      <div
        className="files-tree files-tree-empty"
        data-testid={FILES.tree}
        onContextMenu={(event) => openMenu(event, '', 'root')}
      >
        <p className="files-note" data-testid={FILES.empty}>
          {emptyNote}
        </p>
        {newRow}
        {noteEl}
        {overlays}
      </div>
    );
  }

  const parentIndex =
    newRow && editing && editing.mode !== 'rename' && editing.parent !== ''
      ? rows.findIndex((r) => r.path === (editing as { parent: string }).parent)
      : -1;

  const rendered: ReactNode[] = [];
  if (newRow && (editing as { parent: string }).parent === '') rendered.push(newRow);
  rows.forEach((row, index) => {
    rendered.push(
      <Row
        key={row.path}
        row={row}
        selected={row.path === selected}
        renaming={editing !== null && editing.mode === 'rename' && editing.path === row.path}
        dropOn={dropTarget !== null && row.kind === 'dir' && row.path === dropTarget}
        dragging={dragging === row.path}
        extra={dragHandlers(row)}
        onContextMenu={(event) => openMenu(event, row.path, row.kind)}
        onCommitRename={commitEdit}
        onCancelRename={() => {
          setEditing(null);
          setNote(null);
        }}
        onSelect={onSelect}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
    if (index === parentIndex && newRow) rendered.push(newRow);
  });

  return (
    <div
      className={`files-tree${ops && dropTarget === '' ? ' is-drop-root' : ''}`}
      data-testid={FILES.tree}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selected === null ? undefined : rowId(selected)}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => openMenu(event, '', 'root')}
      onDragOver={(event) => {
        if (!ops || dragging === null || !canMoveInto(dragging, '')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== '') setDropTarget('');
      }}
      onDrop={(event) => doDrop(event, '')}
    >
      {rendered}
      {omitted > 0 ? (
        /* SAID, NEVER SILENT. A tree that stops at the cap without saying so
           tells the reader their repository ends here, and that is the one
           number they cannot check by looking. */
        <p className="files-note" data-testid={FILES.omitted}>
          {`+${omitted.toLocaleString('en-US')} more not listed — narrow the filter`}
        </p>
      ) : null}
      {noteEl}
      {overlays}
    </div>
  );
}

/** A pending file/folder, as an input row under the folder it will live in. */
function NewEntryRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: {
  depth: number;
  kind: 'file' | 'folder';
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <RailRow
      depth={Math.min(depth, MAX_INDENT)}
      icon={<FilesIcon name={kind === 'folder' ? 'folder' : 'file'} size={14} />}
      className="files-row files-row-new"
      data-testid="files-new-row"
    >
      <NameInput
        initial=""
        label={kind === 'folder' ? 'New folder name' : 'New file name'}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </RailRow>
  );
}

/** Enter commits, Escape or leaving cancels. The row owns nothing else. */
function NameInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /* A commit that is awaiting the server must not be cancelled by the blur the
     re-render causes. */
  const committing = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      className="files-name-input"
      data-testid="files-name-input"
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      autoComplete="off"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          committing.current = true;
          onCommit(event.currentTarget.value);
          window.setTimeout(() => {
            committing.current = false;
          }, 0);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committing.current) onCancel();
      }}
    />
  );
}

interface RowProps {
  row: FileRow;
  selected: boolean;
  renaming: boolean;
  dropOn: boolean;
  dragging: boolean;
  extra: Record<string, unknown>;
  onContextMenu: (event: ReactMouseEvent) => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onSelect: (path: RepoPath) => void;
  onToggle: (path: RepoPath) => void;
  onOpen: (path: RepoPath) => void;
}

function Row({
  row,
  selected,
  renaming,
  dropOn,
  dragging,
  extra,
  onContextMenu,
  onCommitRename,
  onCancelRename,
  onSelect,
  onToggle,
  onOpen,
}: RowProps) {
  const isDir = row.kind === 'dir';
  /* A collapsed chain's label carries separators, and the identity of
     `packages/web2/src/files` is its TAIL — so it truncates at the FRONT. The
     recipe is rail.css's, `direction: rtl` with an inner <bdi>, and it is the
     only way CSS puts the ellipsis on the left without measuring the string in
     JavaScript. A plain name has no head to lose and stays left-to-right. */
  const chained = isDir && row.label.includes('/');

  return (
    /* Round 8: the one rail row the session sidebar draws too (shell2/RailRow). */
    <RailRow
      {...extra}
      onContextMenu={onContextMenu}
      depth={Math.min(row.depth, MAX_INDENT)}
      selected={selected}
      twist={isDir ? <FilesIcon name={row.expanded ? 'chevdown' : 'chevright'} size={12} /> : null}
      icon={<FilesIcon name={isDir ? 'folder' : 'file'} size={14} />}
      id={rowId(row.path)}
      className={`files-row files-row-${row.kind}${row.tone === null ? '' : ` files-tone-${row.tone}`}${dropOn ? ' is-drop' : ''}${dragging ? ' is-dragging' : ''}`}
      data-testid={FILES.row}
      data-kind={row.kind}
      data-path={row.path}
      data-selected={selected ? 'true' : 'false'}
      data-dirty={row.dirty ? 'true' : 'false'}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? row.expanded : undefined}
      data-tone={row.tone ?? undefined}
      aria-label={
        row.status === null && row.tone !== 'progress'
          ? undefined
          : /* THE WORD, NOT THE LETTER. "M" is a glyph and means nothing read
               aloud; the status word is the whole point of having one. */
            `${row.path}, ${row.status ?? 'being edited'}`
      }
      title={row.status === null && row.tone !== 'progress' ? row.path : `${row.path} — ${row.status ?? 'being edited'}`}
      onClick={() => {
        if (renaming) return;
        /* A FOLDER CLICK OPENS THE FOLDER, and nothing else (owner photo,
           2026-09-22: "path is a directory" under a highlighted folder). Selecting
           it made the reader load it as a file. Keyboard focus still walks
           folders — that is the `select` action above, not this click. */
        if (isDir) {
          onToggle(row.path);
          return;
        }
        onSelect(row.path);
        onOpen(row.path);
      }}
    >
      {renaming ? (
        <NameInput
          initial={baseName(row.path)}
          label={`Rename ${baseName(row.path)}`}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : chained ? (
        <span className="files-name files-name-tail">
          <bdi>{row.label}</bdi>
        </span>
      ) : (
        /* Round 7: a long name gives way IN THE MIDDLE and keeps its end, so
           "docker-compose.yml" reads "docker-co…se.yml", never "docker-comp".
           The full path is the row's title. */
        <FitName label={row.label} />
      )}
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
    </RailRow>
  );
}
