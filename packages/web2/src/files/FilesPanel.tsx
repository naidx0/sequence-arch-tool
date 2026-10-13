/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL — item 2.1
   packages/web2/src/files/FilesPanel.tsx

   Owner, 2026-09-14: "rework and make the files sections with diffs and code
   editings and file editing like a real ide inside of our app, cursor style
   sidepannel with multiple editing options, like our own canvas".

   A tree on the left, and on the right ONE file shown as its source, as its
   diff, or as a field you can type into — with a visible control that switches
   between them and a header that always says which file you are looking at.

   ── FULLY CONTROLLED, AND THAT IS THE PRODUCT DECISION, NOT A TEST TRICK ──
   Every piece of state this panel draws — the selection, the expansion set, the
   query, the mode, the file text, the diff text, the draft — arrives as a prop,
   and every gesture leaves as a callback. Nothing here fetches and nothing here
   reads the store.

   The reason is Wave 3's lock. `docs/research/code-canvas-program.md` §2 puts a
   LOCKED CHAT in charge of which surface is showing and what it shows, and a
   panel that owned its own selection would have two authorities for one fact —
   the chat says "look at `packages/acp/src/client.ts`", the panel says "I am
   showing what was last clicked", and whichever one renders second wins. A
   surface whose entire state is a prop can be driven by the chat, by a click,
   by a command palette or by a test, and all four go down one path.

   ── "MULTIPLE EDITING OPTIONS", AND THE HALF OF IT THIS FILE REFUSES ──────
   The mode control and the action row are both slots: the panel renders the
   modes the caller has ENABLED (Edit exists only when an `onDraft` is passed)
   and the actions the caller has PASSED. Nothing here invents a Revert, a Stage
   or a Save that would then have to be honoured by somebody else's endpoint.
   That is the same refusal `railModel` records about coverage — a surface that
   draws a control it cannot make good on is lying about the product, and the
   reader finds out by pressing it.

   ── THE EDIT FIELD HAS A GUTTER NOW, AND IT CANNOT DRIFT (round 8) ───────
   The old field refused a gutter because two independently scrolling boxes
   drift by a line. CodeEditor.tsx puts the gutter, the highlighted listing and
   the field in ONE scroller (the field never scrolls itself), so a number and
   its line move together by construction.

   ── COMPACT IS THE ONLY DENSITY (law 3) ──────────────────────────────────
   Every rung here is the ladder's: rows on `--row-h`, controls on
   `--control-h`, icon buttons on `--icon-btn`, type at `--t-10` / `--t-11` /
   `--t-12`. "Airy is a defect."
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, cloneElement, isValidElement, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';

import { highlight, languageOf } from '../review/syntax';

import { FILES } from './anchors';
import { previewKind } from './previewKind';

/* The preview loads the first time a file is previewed: it and the prose
   renderer it uses are off the boot path (perf ratchet, round 7). */
const FilePreview = lazy(() => import('./FilePreview'));
/* The code editor loads the first time a file is edited (perf ratchet, round 8). */
const CodeEditor = lazy(() => import('./CodeEditor'));
import { FileTree } from './FileTree';
import type { FileTreeOps } from './fileOpsModel';
import { FilesIcon } from './FilesIcon';
import { DiffView } from './DiffView';
import { DIFF_LINE_CAP, buildFileTree, filterFileTree, statusTone } from './filesModel';
import type { FileStatus, FileTone, RepoPath } from './filesModel';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { ScopeToggle, useBranchUi } from './branchUi';

/**
 * WHAT THE RIGHT SIDE IS SHOWING. Three, not two, because "type into it" is a
 * different thing from "read it" — a field and a rendered listing cannot be one
 * control, and a reader who cannot see which of the two they are in will edit a
 * file believing they are browsing it.
 */
export type FilesView = 'preview' | 'code' | 'diff' | 'edit';

/** The three modes the header draws. `code` is the old read-only source mode and
 *  now means Edit (owner: "the source-code icon and the edit icon are the same
 *  thing ... condense them into one area, just an editing mode"). */
export type FilesMode = 'preview' | 'edit' | 'diff';

/**
 * A loaded thing, or the reason there is nothing.
 *
 * FOUR STATES AND NOT A NULLABLE STRING, for the reason the boot ladder gives
 * about itself: "a dead engine and a rejected folder looked the same on screen"
 * when absence was the only signal. `idle` is "nothing asked for", `loading` is
 * "asked", `failed` carries THE SERVER'S OWN SENTENCE — rewriting it would hide
 * the one line that says what to fix.
 */
export interface FileLoad {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  text?: string;
  message?: string;
}

/**
 * One control in the action row.
 *
 * NO `danger` FLAG, AND THE OMISSION IS THE RULING. The reflex for Discard or
 * Revert is to redden it, and law 1 counts hues, not surfaces: red here is
 * --wont, which in this product means "won't fit" — a verdict about the world.
 * A destructive action is not a verdict, it is a thing the reader is about to
 * do, and Decision 5's gate settles the same question one surface over ("deny
 * is a quiet button, because declining a proposal is not a failure"). A
 * destructive action is made safe by CONFIRMATION, which belongs to whoever
 * owns the endpoint, not by a colour.
 */
export interface FileAction {
  id: string;
  label: string;
  disabled?: boolean;
  /** Why it is unavailable, in the product's own words. Never a bare grey. */
  note?: string;
}

export interface FilesPanelProps {
  /** A line to reveal in the editor (a `path:12` followed from the chat). */
  focusLine?: number;
  focusKey?: number;
  /** A project search that led here: the editor's find opens seeded with it. */
  findSeed?: string;
  /** Every repo-relative path the tree should hold. */
  paths: readonly string[];
  /** Folders with no files in them yet (just created, or empty on disk). */
  emptyDirs?: readonly string[];
  /** Round 9, ask 20: present, the tree can move, rename, create, duplicate and delete. */
  ops?: FileTreeOps;
  /** Path → git status, from `GET /api/git/status`. */
  status?: ReadonlyMap<RepoPath, FileStatus> | null;
  /** Files being edited right now: an agent's running edit, or an unsaved buffer. Yellow, pulsing. */
  progress?: ReadonlySet<RepoPath> | null;
  /** Named in the header when known, because a diff is against SOMETHING. */
  branch?: string | null;
  /** The repo's name: the first crumb, and the whole header while no file is open. */
  repoName?: string | null;

  selected: RepoPath | null;
  onSelect: (path: RepoPath) => void;
  /** A file was activated — clicked or Enter'd. Usually the caller's fetch. */
  onOpen?: (path: RepoPath) => void;

  expanded: ReadonlySet<RepoPath>;
  onToggle: (path: RepoPath) => void;

  query: string;
  onQuery: (query: string) => void;

  view: FilesView;
  onView: (view: FilesView) => void;

  /**
   * When false, Diff is omitted (no git repo). Default true for attached repos.
   */
  diffEnabled?: boolean;

  /** The selected file's source. */
  content: FileLoad;
  /** The selected file's unified diff, verbatim from `GET /api/git/diff`. */
  diff: FileLoad;

  /**
   * The unsaved edit. PASSING `onDraft` IS WHAT MAKES THE PANEL EDITABLE — a
   * caller with no write endpoint gets a read-only panel with no Edit tab
   * rather than a tab that silently discards typing.
   */
  draft?: string | null;
  onDraft?: (text: string) => void;

  actions?: readonly FileAction[];
  onAction?: (id: string, path: RepoPath) => void;
}

/**
 * The three modes, with the glyph each one earns.
 *
 * A LABEL AS WELL AS A GLYPH, on all three. Sheet 11.7's rule — "every coloured
 * state on this sheet also carries a word" — generalises here: an icon-only
 * segmented control makes the reader learn three pictures before they can pick
 * one, and `split` for a diff is a reused glyph rather than a universal symbol.
 * At --t-11 the word costs about thirty pixels and removes the guess.
 */
const MODES: { id: FilesMode; label: string; icon: 'eye' | 'split' | 'pen' }[] = [
  /* Round 7, B8: a file with a rendered form (HTML, Markdown, an image) opens
     rendered; Preview and Edit switch between the two. ONE source mode: the
     separate Code and Edit buttons were the same thing (owner, 2026-10-09). */
  { id: 'preview', label: 'Preview', icon: 'eye' },
  { id: 'edit', label: 'Edit', icon: 'pen' },
  { id: 'diff', label: 'Diff', icon: 'split' },
];

const MODE_TITLE: Record<FilesMode, string> = {
  preview: 'Preview: the file rendered',
  edit: 'Edit: the source, editable',
  diff: 'Diff: what changed against git',
};

/** Where the reader's tree width is remembered. Per origin, not per repo. */
const TREE_W_KEY = 'files.treeW';
/** Set once the reader has dragged the seam: their width then outranks the auto rail. */
const TREE_DRAGGED_KEY = 'files.treeDragged';

/**
 * THE TREE'S FLOOR AND CEILING.
 *
 * 160 is where a path stops being readable at this type size; 640 is where the
 * tree has stopped being a rail and taken the pane. Neither is a snap — this
 * column is dragged to a size, not chosen from frames, because unlike the live
 * panes it has no sibling whose share it is taking.
 */
const TREE_W_MIN = 160;
const TREE_W_MAX = 640;
const TREE_W_DEFAULT = 220;

/**
 * BELOW THIS PANE WIDTH THE TREE IS A DRAWER (round 9, ask 24: the preview was
 * 163 px in a 1024 window with two surfaces open). The file gets the whole
 * pane; the tree slides over it from the header toggle and goes away again when
 * a file is chosen. 440 (was 420): below it the tree is a drawer; from 441 up it is a compact column (files.css, 560 container rule) so the open file stays highlighted on the rail.
 */
const NARROW_PANE_PX = 440;

function clampTreeWidth(raw: number): number {
  if (!Number.isFinite(raw)) return TREE_W_DEFAULT;
  return Math.round(Math.min(TREE_W_MAX, Math.max(TREE_W_MIN, raw)));
}

function readStoredTreeWidth(): number {
  try {
    const raw = localStorage.getItem(TREE_W_KEY);
    return raw === null ? TREE_W_DEFAULT : clampTreeWidth(Number(raw));
  } catch {
    return TREE_W_DEFAULT;
  }
}

export function FilesPanel({
  focusLine,
  focusKey,
  findSeed,
  paths,
  emptyDirs,
  ops,
  status = null,
  progress = null,
  branch = null,
  repoName = null,
  selected,
  onSelect,
  onOpen,
  expanded,
  onToggle,
  query,
  onQuery,
  view,
  onView,
  diffEnabled = true,
  content,
  diff,
  draft = null,
  onDraft,
  actions,
  onAction,
}: FilesPanelProps) {
  /*
   * ══ THE TREE COLUMN'S WIDTH, AND WHETHER IT IS THERE AT ALL ═══════════
   *
   * Owner, 2026-09-21: "the file rail ... should all be draggable the same way
   * all the other rails are draggable. Right now it's stuck, it's fixed, so
   * when you open architecture next to files it looks bad ... you can't even
   * close that, [which] is a huge problem."
   *
   * It was `minmax(0, var(--rail-w))` — 280px from the token ladder, the same
   * on a 1400px window as inside a 240px pane, where it left the file about
   * thirty pixels.
   *
   * REMEMBERED, because a width the reader sets and the app forgets is a width
   * they set again every time. Per-origin rather than per-repo: how wide you
   * like a file tree is a fact about you, not about the project.
   *
   * READ LAZILY AND GUARDED, like every other storage read in this package:
   * `localStorage` throws in a private window and returns null with site data
   * cleared, and a panel that cannot mount because it could not remember a
   * number is worse than one that opens at its default.
   */
  const [treeW, setTreeW] = useState<number>(() => readStoredTreeWidth());
  const [treeOpen, setTreeOpen] = useState(true);
  /* Has the reader said how wide they want it? Their answer outranks the
     auto-compress above — see the class list on the panel root. */
  /* A width the reader DRAGGED is remembered across files and reloads (round 7);
     the stored number alone is not enough, since the effect below writes the
     default too. */
  const [treeWidened, setTreeWidened] = useState(() => {
    try {
      return localStorage.getItem(TREE_DRAGGED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const sideRef = useRef<HTMLDivElement | null>(null);
  /* The pane's own width, not the window's (a ResizeObserver on the container
     the panel already is). Without layout (a test, a server render) it is wide. */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const autoShut = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => setNarrow(el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width <= NARROW_PANE_PX);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  /* While the seam is held, its handle stays lit. */
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(TREE_W_KEY, String(treeW));
    } catch {
      /* storage unavailable — the width still holds for this sitting */
    }
  }, [treeW]);

  /*
   * THE SAME DRAG IDIOM AS THE SHELL'S SPLITTERS. Pointer capture so the drag
   * survives leaving the 1px strip, document-level move so it survives leaving
   * the panel, and the start width MEASURED off the element rather than read
   * off state — the two differ whenever the pane is too narrow to give the
   * tree its remembered width, and a drag anchored on the remembered number
   * jumps by the difference on the first move.
   */
  const onTreeResizeDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const measured = sideRef.current?.getBoundingClientRect().width;
    dragRef.current = {
      startX: e.clientX,
      startW: Math.round(measured && measured > 0 ? measured : treeW),
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    /* A DRAG IS ALSO A REQUEST TO SEE IT. Grabbing the strip while the tree is
       shut and watching nothing happen is the control lying about what it does. */
    setTreeOpen(true);
    setTreeWidened(true);
    setResizing(true);
    try {
      localStorage.setItem(TREE_DRAGGED_KEY, '1');
    } catch {
      /* the width still holds for this session */
    }
  }, [treeW]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setTreeW(clampTreeWidth(drag.startW + (e.clientX - drag.startX)));
    }
    function onUp() {
      dragRef.current = null;
      setResizing(false);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const tree = useMemo(() => buildFileTree(paths, emptyDirs ?? []), [paths, emptyDirs]);
  const bare = paths.length === 0 && (emptyDirs?.length ?? 0) === 0 && query.trim() === '';
  /* A folder can be the keyboard's selection; only a FILE is read. A folder
     handed to the reader answered "path is a directory" (owner photo,
     2026-09-22). */
  const fileSet = useMemo(() => new Set<string>(paths), [paths]);
  const selectedFile = selected !== null && fileSet.has(selected) ? selected : null;
  const filtered = useMemo(() => filterFileTree(tree, query), [tree, query]);
  const branchUi = useBranchUi();

  /* In a narrow pane, opening a file puts the tree away so the file has the
     pane; widening the pane brings back a tree that was put away this way. */
  useEffect(() => {
    if (narrow && selectedFile !== null) {
      setTreeOpen((open) => {
        if (open) autoShut.current = true;
        return false;
      });
    } else if (!narrow && autoShut.current) {
      autoShut.current = false;
      setTreeOpen(true);
    }
  }, [narrow, selectedFile]);

  const editable = typeof onDraft === 'function';
  /* A mode that is not available cannot be the mode. Falling back rather than
     rendering an empty right side means a caller that drops `onDraft` while
     `view` is 'edit' shows the file instead of nothing. */
  const kind = previewKind(selectedFile);
  const wanted: FilesMode = view === 'code' ? 'edit' : view;
  const mode: FilesMode =
    wanted === 'diff' && !diffEnabled
      ? 'edit'
      : wanted === 'preview' && kind === null
        ? 'edit'
        : /* A raster image has no text to read or edit: its bytes as UTF-8
             are noise, and saving them back would corrupt the file. */
          kind === 'image' && wanted === 'edit'
          ? 'preview'
          : wanted;

  return (
    /*
     * ── THE PANEL ASKS ITS OWN WIDTH, NOT THE WINDOW'S ────────────────────
     *
     * The two-column layout was chosen by a `@media (max-width: 720px)` query,
     * which reads the VIEWPORT. This panel does not live in the viewport — it
     * lives in a live pane whose width the reader sets, and which is 200px
     * wide when three panes are open on a 1280 screen.
     *
     * So on a wide screen with a narrow pane it stayed in two columns and
     * squeezed both: measured at a 200px pane, the tree took 199 and the file
     * took nothing, and the seam between them landed ON the pane's own
     * splitter — two 24px grab areas on top of each other, where a reader
     * aiming for one gets the other. That is what "it looks bad" was.
     *
     * This wrapper is the query's container. In the component rather than in
     * the host's sheet so the panel is correct wherever it is mounted; a
     * container named by an ancestor somebody else owns is a layout that works
     * until it is reused.
     */
    <div className="files-container" ref={containerRef}>
    <div
      className={[
        'files-scope',
        'files-panel',
        treeOpen ? '' : 'is-tree-shut',
        narrow ? 'is-narrow' : '',
        narrow && selectedFile !== null ? 'has-file' : '',
        /*
         * OPENING A FILE COMPRESSES THE TREE — once, and not again.
         *
         * `treeWidened` is the reader overruling it: the moment they drag the
         * seam or press the header toggle, this stops applying and their width
         * is what holds. A layout that re-compressed on every file pick would
         * be undoing their choice on a schedule.
         */
        selectedFile !== null && !treeWidened && treeOpen ? 'is-tree-rail' : '',
        /* The reader dragged the seam: their width holds at every pane size,
           the narrow container's rail included (files.css, is-tree-wide). */
        treeWidened && treeOpen ? 'is-tree-wide' : '',
        /* Nothing in the folder: one quiet line, no preview pane to expand into. */
        bare ? 'is-bare' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={FILES.panel}
      /* THE TREE'S WIDTH IS A VALUE, NOT A TOKEN. `--rail-w` is the ladder's
         rail width and is right as the DEFAULT; once the reader has dragged
         this one, the number is theirs and lives here. */
      style={
        {
          '--files-tree-w': `${treeW}px`,
        } as CSSProperties
      }
    >
      <div className="files-side" ref={sideRef} aria-hidden={treeOpen ? undefined : true}>
        <div className="files-top">
          {branchUi ? <ScopeToggle ui={branchUi} /> : null}
          <label className="files-fieldwrap">
            <span className="files-fieldicon" aria-hidden="true">
              <FilesIcon name="search" size={14} />
            </span>
            <input
              className="files-field"
              data-testid={FILES.filter}
              type="search"
              value={query}
              placeholder="Filter files"
              aria-label="Filter files"
              onChange={(event) => onQuery(event.target.value)}
            />
          </label>
          {/* HITS, NOT ROWS. Sheet 11.5: "a directory revealed only to expose a
              match below it is not itself a match", and a count taken off the
              rendered list reported "6 matches" for two files. `matches` is
              null with no query, which is a different fact from zero and reads
              differently here. */}
          {filtered.matches === null ? null : (
            <p className="files-matches" data-testid={FILES.matches}>
              {`${filtered.matches} match${filtered.matches === 1 ? '' : 'es'}`}
            </p>
          )}
        </div>

        <div className="files-treewrap">
          <FileTree
            ops={ops}
            nodes={filtered.nodes}
            /* A FILTERED TREE IS FULLY OPEN. A reader who has typed a query is
               asking to see the matches, not to re-open the four directories
               above each one — and the rows revealed are bounded by the hits,
               so the cap still holds. */
            expanded={filtered.matches === null ? expanded : 'all'}
            selected={selected}
            status={status}
            progress={progress}
            onSelect={onSelect}
            onToggle={onToggle}
            onOpen={(path) => {
              onOpen?.(path);
              if (narrow) {
                autoShut.current = true;
                setTreeOpen(false);
              }
            }}
            emptyNote={
              filtered.matches === null
                ? 'No files yet.'
                : `Nothing matches "${query.trim()}".`
            }
          />
        </div>
      </div>

      {/*
        ── THE TREE IS A COLUMN THE READER OWNS ──────────────────────────────

        Owner, 2026-09-21: "the file rail where it shows every file or folder in
        that workspace ... this should all be draggable the same way all the
        other rails are draggable. Right now it's stuck, it's fixed, so when you
        open architecture next to files it looks bad ... you can't even close
        that, [which] is a huge problem."

        The column was `minmax(0, var(--rail-w))` — one number from the token
        ladder, the same on a 1400px window and inside a 240px pane, where it
        left the file itself about thirty pixels of room.

        A SPLITTER AND A SHUT, because those are two different wants. Dragging
        is for "I want more of one than the other"; shutting is for "I am
        reading a file and the tree is in the way", and dragging to zero is a
        poor way to say the second — there is nothing left to grab to undo it.
        Shut keeps a control in the header to open it again.

        The same drag idiom as the shell's splitters, deliberately: pointer
        capture, document-level move, and the width read off the ELEMENT rather
        than off state, so a drag that starts while the pane is squeezed does
        not jump.
      */}
      <div
        className={`files-resizer${resizing ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the file tree"
        title="Drag to resize the file tree, double-click to hide it"
        data-testid={FILES.resizer}
        onPointerDown={onTreeResizeDown}
        onDoubleClick={() => setTreeOpen((v) => !v)}
        /* KEYBOARD: focusable; Left / Right resize in 16px steps (and open a
           shut tree), Enter hides or shows it. */
        tabIndex={0}
        aria-valuenow={treeOpen ? treeW : 0}
        aria-valuemin={0}
        aria-valuemax={TREE_W_MAX}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setTreeOpen((v) => !v);
            setTreeWidened(true);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setTreeOpen(true);
            setTreeWidened(true);
            setTreeW((w) => clampTreeWidth(w + (e.key === 'ArrowRight' ? 16 : -16)));
            try {
              localStorage.setItem(TREE_DRAGGED_KEY, '1');
            } catch {
              /* the width still holds for this session */
            }
          }
        }}
      />

      <div
        className="files-main"
        onPointerDownCapture={() => {
          /* The drawer is open over the file: pressing the strip of file beside
             it puts the drawer away. */
          if (narrow && treeOpen && selectedFile !== null) {
            autoShut.current = false;
            setTreeOpen(false);
          }
        }}
      >
        <Header
          onToggleTree={() => {
            setTreeOpen((v) => !v);
            setTreeWidened(true);
          }}
          treeShut={!treeOpen}
          path={selectedFile}
          repoName={repoName}
          branch={branch}
          status={selected === null ? null : (status?.get(selected) ?? null)}
          tone={
            selected === null
              ? null
              : statusTone(status?.get(selected) ?? null, progress?.has(selected) === true || (draft !== null && content.state === 'ready' && draft !== content.text))
          }
          mode={mode}
          editable={editable}
          diffEnabled={diffEnabled}
          onView={onView}
          dirty={draft !== null && content.state === 'ready' && draft !== content.text}
        />

        {/* In Edit the actions live in the editor's status row (round 8). */}
        {/* Save / Discard sit in the row only while there is something to save
            (a draft); in Edit they live in the editor's status row. */}
        {actions && actions.some((a) => a.disabled !== true) && !(mode === 'edit' && editable && selectedFile !== null && content.state === 'ready') ? (
          <div className="files-actions" role="group" aria-label="File actions">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="files-btn"
                data-testid={FILES.action}
                data-action={action.id}
                disabled={action.disabled === true || selected === null}
                /* THE REASON RIDES WITH THE REFUSAL. A greyed control with no
                   explanation is the defect `reviewScopes` records by name — a
                   disabled Revert behind a tooltip that had stopped being
                   true. */
                title={action.note}
                onClick={() => {
                  if (selected !== null) onAction?.(action.id, selected);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="files-body">
          {selectedFile === null ? (
            <p className="files-note" data-testid={FILES.note}>
              {/* "from the tree", not "on the left": the tree is ABOVE this in a
                  narrow pane (the container query at 420), and a line that
                  names a direction is wrong half the time once the layout can
                  move. Naming the thing instead is right in both. */}
              Pick a file from the tree to read it, diff it, or edit it.
            </p>
          ) : mode === 'preview' && kind !== null ? (
            kind === 'image' ? (
              <Suspense fallback={null}>
                <FilePreview kind={kind} path={selectedFile} text={null} />
              </Suspense>
            ) : content.state === 'ready' ? (
              <Suspense fallback={null}>
                <FilePreview kind={kind} path={selectedFile} text={content.text ?? ''} onCode={() => onView('edit')} />
              </Suspense>
            ) : (
              <Pending load={content} path={selectedFile} />
            )
          ) : mode === 'diff' ? (
            <DiffLoad load={diff} path={selectedFile} />
          ) : mode === 'edit' && editable ? (
            <EditView
              load={content}
              draft={draft}
              onDraft={onDraft}
              path={selectedFile}
              actions={actions}
              onAction={onAction}
              line={focusLine}
              lineKey={focusKey}
              findSeed={findSeed}
            />
          ) : (
            <CodeLoad load={content} path={selectedFile} />
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

/* ── the header ─────────────────────────────────────────────────────────── */

interface HeaderProps {
  path: RepoPath | null;
  /** The repo's own name, the head of the breadcrumb. */
  repoName?: string | null;
  /** Shown as a quiet chip at the end of the row. */
  branch?: string | null;
  status: FileStatus | null;
  tone: FileTone | null;
  mode: FilesMode;
  editable: boolean;
  diffEnabled: boolean;
  onView: (view: FilesView) => void;
  dirty: boolean;
  /** Shuts or re-opens the tree column. Absent ⇒ no control is drawn. */
  onToggleTree?: () => void;
  treeShut?: boolean;
}

function Header({
  path,
  repoName,
  branch = null,
  status,
  tone,
  mode,
  editable,
  diffEnabled,
  onView,
  dirty,
  onToggleTree,
  treeShut = false,
}: HeaderProps) {
  /* ONE LINE (owner, 2026-10-09): [tree] [breadcrumb] [modes] [status]. The
     breadcrumb is repo/dir/…/file; it truncates at the FRONT in CSS (the
     rtl + <bdi> recipe), so the file's own name is the last thing to go and the
     whole path is always in the title. With no file the line is the repo name
     alone and there is no mode control: nothing to switch yet. */
  const parts = path === null ? [] : path.split('/');
  const full = path === null ? (repoName ?? '') : repoName ? `${repoName}/${path}` : path;
  const lead = repoName ? [repoName] : [];
  const branchUi = useBranchUi();

  return (
    <div className="files-hd" data-testid={FILES.header} data-tone={tone ?? undefined}>
      {onToggleTree ? (
        <button
          type="button"
          className="files-btn files-treetoggle"
          data-testid={FILES.treeToggle}
          aria-pressed={treeShut ? 'true' : 'false'}
          aria-label={treeShut ? 'Show the file tree' : 'Hide the file tree'}
          title={treeShut ? 'Show the file tree' : 'Hide the file tree'}
          onClick={onToggleTree}
        >
          <FilesIcon name={treeShut ? 'chevright' : 'chevleft'} size={14} />
        </button>
      ) : null}
      <span className="files-hd-path files-crumb mono" data-testid={FILES.headerPath} title={full || undefined}>
        <bdi>
          {[...lead, ...parts].map((seg, i, all) => (
            <span key={i}>
              <span className={i === all.length - 1 && path !== null ? `files-crumb-leaf${tone === null ? '' : ` files-tone-${tone}`}` : 'files-crumb-dir'}>{seg}</span>
              {i < all.length - 1 ? <span className="files-crumb-sep">/</span> : null}
            </span>
          ))}
        </bdi>
      </span>
      {/* The tab's dirty dot (round 8): the file has edits not yet saved. */}
      {dirty ? <span className="files-hd-dot" data-testid="files-dirty-dot" aria-label="Unsaved edits" /> : null}

      {path === null ? null : (
        <div className="files-modes" role="group" aria-label="View" data-testid={FILES.view}>
          {MODES.filter((m) => {
            if (m.id === 'preview' && previewKind(path) === null) return false;
            if (m.id === 'edit' && previewKind(path) === 'image') return false;
            if (m.id === 'diff' && !diffEnabled) return false;
            return true;
          }).map((m) => {
            const word = m.id === 'edit' && !editable ? 'Code' : m.label;
            const title = m.id === 'edit' && !editable ? 'Code: the source, read-only' : MODE_TITLE[m.id];
            return (
              <button
                key={m.id}
                type="button"
                className="files-mode"
                data-testid={FILES.viewOption}
                data-mode={m.id}
                aria-pressed={mode === m.id}
                aria-label={word}
                title={title}
                onClick={() => onView(m.id)}
              >
                <FilesIcon name={m.icon} size={14} />
                <span className="files-mode-word">{word}</span>
              </button>
            );
          })}
        </div>
      )}

      {status !== null ? (
        <span className={`files-hd-status${tone === null ? '' : ` files-tone-${tone}`}`}>{status}</span>
      ) : null}
      {dirty ? <span className="files-hd-status files-tone-progress">unsaved</span> : null}
      {(() => {
        const chip =
          branch === null ? null : (
            <span className="files-hd-branch" data-testid={FILES.branch} title={`Diffs are against ${branch}`}>
              {branch}
            </span>
          );
        /* The switcher stands in for the chip when the engine serves branches. */
        return isValidElement(branchUi?.switcher) ? (
          <span className="files-hd-branchslot">{cloneElement(branchUi.switcher as ReactElement<{ fallback?: ReactNode }>, { fallback: chip })}</span>
        ) : (
          chip
        );
      })()}
    </div>
  );
}

/* ── the three bodies ───────────────────────────────────────────────────── */

/**
 * `idle` / `loading` / `failed` rendered once, so the three bodies below only
 * ever have to handle `ready`.
 *
 * THE FAILURE IS THE SERVER'S OWN SENTENCE. `/api/file` answers differently for
 * "too large", "outside the repo" and "unreadable", each is a different fix,
 * and a panel that rewrote all three as "could not load" would delete the one
 * line the reader can act on. `FileView.tsx` follows the same rule for the same
 * route.
 */
function Pending({ load, path }: { load: FileLoad; path: RepoPath }) {
  if (load.state === 'idle') {
    return (
      <p className="files-note" data-testid={FILES.note}>
        Nothing loaded for {path} yet.
      </p>
    );
  }
  if (load.state === 'loading') {
    return (
      <p className="files-note" data-testid={FILES.note}>
        <AsciiSpinner /> Reading {path}…
      </p>
    );
  }
  return (
    <p className="files-note files-note-fail" data-testid={FILES.note} role="alert">
      {load.message ?? `Could not read ${path}.`}
    </p>
  );
}

/**
 * Does this failure mean "there is no git here" rather than "the diff broke"?
 *
 * Matched on git's own words, because they are what arrives: the server hands
 * back the command's stderr verbatim and `fatal: not a git repository` is the
 * sentence git prints for it. Deliberately narrow — anything else keeps the
 * server's own message, which is the rule `Pending` exists to protect.
 */
function isNotAGitRepo(message: string | undefined): boolean {
  return message !== undefined && /not a git repository/i.test(message);
}

function DiffLoad({ load, path }: { load: FileLoad; path: RepoPath }) {
  /*
   * ── ONE FAILURE THAT IS NOT A FAILURE (owner, 2026-09-21) ──────────────
   *
   * "git diff fail warning, not a git repository."
   *
   * He attached a folder with no `.git` in it, opened Diff, and was shown
   * `git diff failed: fatal: not a git repository`. Every word of that is
   * true and none of it answers the question he asked, which was "what
   * changed in this file". Nothing changed, because nothing is tracking it,
   * and that is an ANSWER — a fact about the folder, not a fault in the
   * product.
   *
   * The surrounding rule still stands and is worth keeping: a failed read
   * shows the server's own sentence, because rewriting three different
   * failures as "could not load" deletes the one line a reader can act on.
   * This is the case where the server's sentence is a developer's message
   * about a tool, and the reader's question has a plain answer instead.
   */
  if (load.state === 'failed' && isNotAGitRepo(load.message)) {
    return (
      <p className="files-note" data-testid={FILES.note}>
        No git history here, so there is nothing to compare {path} against. Open this folder as a
        git repository and Diff starts working.
      </p>
    );
  }
  if (load.state !== 'ready') return <Pending load={load} path={path} />;
  return <DiffView text={load.text ?? ''} path={path} />;
}

function CodeLoad({ load, path }: { load: FileLoad; path: RepoPath }) {
  if (load.state !== 'ready') return <Pending load={load} path={path} />;
  return <CodeView text={load.text ?? ''} path={path} />;
}

/**
 * The source, with a gutter, capped.
 *
 * THE GUTTER IS THE POINT, and `FileView.tsx` says why in one line: evidence in
 * this product is `file:line`, and a viewer without line numbers makes the
 * reader count — which is exactly the work the citation was supposed to save.
 *
 * THE CAP IS THE SAME ONE THE DIFF USES, for the same measured reason and so
 * two listings in one panel do not truncate at two different places. A minified
 * bundle checked into a repository is a single file with hundreds of thousands
 * of lines, and one DOM row each is the rail's stall.
 */
function CodeView({ text, path }: { text: string; path: RepoPath }) {
  const [cap, setCap] = useState(DIFF_LINE_CAP);
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setCap(DIFF_LINE_CAP);
  }

  const language = languageOf(path);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const shown = lines.slice(0, cap);
  const omitted = lines.length - shown.length;

  return (
    <div className="files-code" data-testid={FILES.code}>
      <pre className="files-code-pre">
        {shown.map((line, index) => (
          <span className="files-code-line" data-testid={FILES.codeLine} key={index}>
            <span className="files-num mono">{index + 1}</span>
            <code className="files-code-text">
              {highlight(line, language).map((span, i) =>
                span.cls === null ? (
                  <span key={i}>{span.text}</span>
                ) : (
                  <span key={i} className={`files-t-${span.cls}`}>
                    {span.text}
                  </span>
                ),
              )}
            </code>
          </span>
        ))}
      </pre>
      {omitted > 0 ? (
        <div className="files-diff-tail">
          <p className="files-note">
            {`${omitted.toLocaleString('en-US')} more line${omitted === 1 ? '' : 's'} not drawn.`}
          </p>
          <button type="button" className="files-btn" onClick={() => setCap(cap + DIFF_LINE_CAP)}>
            {`Show ${Math.min(DIFF_LINE_CAP, omitted).toLocaleString('en-US')} more`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The field: the code editor (round 8, CodeEditor.tsx).
 *
 * `draft ?? load.text` IS THE WHOLE STATE RULE: a null draft means the reader
 * has not typed yet, so the field shows the file. The first keystroke makes the
 * draft a string and it stays the source of truth from then on — including when
 * it equals the file, because "I typed it back to how it was" is a state the
 * caller may want to know about and a `=== text` test would erase it.
 *
 * Save and Discard are the panel's own actions (the caller owns the endpoint);
 * the editor only presses them, from its status row or Mod+S.
 */
function EditView({
  load,
  draft,
  onDraft,
  path,
  actions,
  onAction,
  line,
  lineKey,
  findSeed,
}: {
  line?: number;
  lineKey?: number;
  findSeed?: string;
  load: FileLoad;
  draft: string | null;
  onDraft: ((text: string) => void) | undefined;
  path: RepoPath;
  actions?: readonly FileAction[];
  onAction?: (id: string, path: RepoPath) => void;
}) {
  if (load.state !== 'ready') return <Pending load={load} path={path} />;

  const value = draft ?? load.text ?? '';
  const save = actions?.find((a) => a.id === 'save');
  const discard = actions?.find((a) => a.id === 'discard');

  return (
    <div className="files-edit">
      <Suspense fallback={null}>
      <CodeEditor
        path={path}
        value={value}
        onChange={(text) => onDraft?.(text)}
        dirty={draft !== null && draft !== load.text}
        onSave={save && onAction ? () => onAction('save', path) : undefined}
        canSave={save ? save.disabled !== true : false}
        onDiscard={discard && onAction ? () => onAction('discard', path) : undefined}
        revealLine={line}
        revealKey={lineKey}
        findSeed={findSeed}
        findKey={lineKey}
      />
      </Suspense>
    </div>
  );
}
