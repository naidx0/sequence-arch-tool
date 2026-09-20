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

   ── THE EDIT FIELD HAS NO LINE GUTTER, WHICH IS DELIBERATE ────────────────
   A gutter beside a `<textarea>` is two independently scrolling boxes that have
   to be kept in step by hand, and the moment they drift by one line every
   number on screen is wrong — on a surface whose whole claim is `file:line`.
   The honest compact form is the field plus a count strip, which cannot drift.
   A real gutter belongs to a real editor component, and that is a bigger thing
   than this wave; pretending with two divs is how the wrong number ships.

   ── COMPACT IS THE ONLY DENSITY (law 3) ──────────────────────────────────
   Every rung here is the ladder's: rows on `--row-h`, controls on
   `--control-h`, icon buttons on `--icon-btn`, type at `--t-10` / `--t-11` /
   `--t-12`. "Airy is a defect."
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';

import { highlight, languageOf } from '../review/syntax';

import { FILES } from './anchors';
import { FileTree } from './FileTree';
import { FilesIcon } from './FilesIcon';
import { DiffView } from './DiffView';
import { DIFF_LINE_CAP, buildFileTree, filterFileTree } from './filesModel';
import type { FileStatus, RepoPath } from './filesModel';

/**
 * WHAT THE RIGHT SIDE IS SHOWING. Three, not two, because "type into it" is a
 * different thing from "read it" — a field and a rendered listing cannot be one
 * control, and a reader who cannot see which of the two they are in will edit a
 * file believing they are browsing it.
 */
export type FilesView = 'code' | 'diff' | 'edit';

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
  /** Every repo-relative path the tree should hold. */
  paths: readonly string[];
  /** Path → git status, from `GET /api/git/status`. */
  status?: ReadonlyMap<RepoPath, FileStatus> | null;
  /** Named in the header when known, because a diff is against SOMETHING. */
  branch?: string | null;

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
const MODES: { id: FilesView; label: string; icon: 'code' | 'split' | 'pen' }[] = [
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'diff', label: 'Diff', icon: 'split' },
  { id: 'edit', label: 'Edit', icon: 'pen' },
];

export function FilesPanel({
  paths,
  status = null,
  branch = null,
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
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  const filtered = useMemo(() => filterFileTree(tree, query), [tree, query]);

  const editable = typeof onDraft === 'function';
  /* A mode that is not available cannot be the mode. Falling back rather than
     rendering an empty right side means a caller that drops `onDraft` while
     `view` is 'edit' shows the file instead of nothing. */
  const mode: FilesView =
    view === 'diff' && !diffEnabled
      ? 'code'
      : view === 'edit' && !editable
        ? 'code'
        : view;

  return (
    <div className="files-scope files-panel" data-testid={FILES.panel}>
      <div className="files-side">
        <div className="files-top">
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
          <p className="files-matches" data-testid={FILES.matches}>
            {filtered.matches === null
              ? branch === null
                ? ''
                : `on ${branch}`
              : `${filtered.matches} match${filtered.matches === 1 ? '' : 'es'}`}
          </p>
        </div>

        <div className="files-treewrap">
          <FileTree
            nodes={filtered.nodes}
            /* A FILTERED TREE IS FULLY OPEN. A reader who has typed a query is
               asking to see the matches, not to re-open the four directories
               above each one — and the rows revealed are bounded by the hits,
               so the cap still holds. */
            expanded={filtered.matches === null ? expanded : 'all'}
            selected={selected}
            status={status}
            onSelect={onSelect}
            onToggle={onToggle}
            onOpen={(path) => {
              onOpen?.(path);
            }}
            emptyNote={
              filtered.matches === null
                ? 'No files yet. Open a repository and this fills as the scan reads it.'
                : `Nothing matches "${query.trim()}".`
            }
          />
        </div>
      </div>

      <div className="files-main">
        <Header
          path={selected}
          status={selected === null ? null : (status?.get(selected) ?? null)}
          mode={mode}
          editable={editable}
          diffEnabled={diffEnabled}
          onView={onView}
          dirty={draft !== null && content.state === 'ready' && draft !== content.text}
        />

        {actions && actions.length > 0 ? (
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
          {selected === null ? (
            <p className="files-note" data-testid={FILES.note}>
              Pick a file on the left to read it, diff it, or edit it.
            </p>
          ) : mode === 'diff' ? (
            <DiffLoad load={diff} path={selected} />
          ) : mode === 'edit' ? (
            <EditView
              load={content}
              draft={draft}
              onDraft={onDraft}
              path={selected}
            />
          ) : (
            <CodeLoad load={content} path={selected} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── the header ─────────────────────────────────────────────────────────── */

interface HeaderProps {
  path: RepoPath | null;
  status: FileStatus | null;
  mode: FilesView;
  editable: boolean;
  diffEnabled: boolean;
  onView: (view: FilesView) => void;
  dirty: boolean;
}

function Header({ path, status, mode, editable, diffEnabled, onView, dirty }: HeaderProps) {
  const name = path === null ? null : (path.split('/').pop() ?? path);

  return (
    <div className="files-hd" data-testid={FILES.header}>
      <div className="files-hd-id">
        <FilesIcon name="file" size={14} />
        <span className="files-hd-name">{name ?? 'No file'}</span>
        {/* THE WHOLE PATH IS THE SECOND LINE AND IT TRUNCATES AT THE FRONT,
            because two files called index.ts are told apart by their
            directories and by nothing else. */}
        <span className="files-hd-path mono" data-testid={FILES.headerPath} title={path ?? undefined}>
          <bdi>{path ?? ''}</bdi>
        </span>
        {status !== null ? <span className="files-hd-status">{status}</span> : null}
        {dirty ? <span className="files-hd-status">unsaved</span> : null}
      </div>

      <div className="files-modes" role="group" aria-label="View" data-testid={FILES.view}>
        {MODES.filter((m) => {
          if (m.id === 'edit' && !editable) return false;
          if (m.id === 'diff' && !diffEnabled) return false;
          return true;
        }).map((m) => (
          <button
            key={m.id}
            type="button"
            className="files-mode"
            data-testid={FILES.viewOption}
            data-mode={m.id}
            aria-pressed={mode === m.id}
            disabled={path === null}
            title={
              m.id === 'diff' && !diffEnabled
                ? 'Diff needs an attached repository'
                : undefined
            }
            onClick={() => onView(m.id)}
          >
            <FilesIcon name={m.icon} size={12} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
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
        Reading {path}…
      </p>
    );
  }
  return (
    <p className="files-note files-note-fail" data-testid={FILES.note} role="alert">
      {load.message ?? `Could not read ${path}.`}
    </p>
  );
}

function DiffLoad({ load, path }: { load: FileLoad; path: RepoPath }) {
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
 * The field.
 *
 * `draft ?? load.text` IS THE WHOLE STATE RULE: a null draft means the reader
 * has not typed yet, so the field shows the file. The first keystroke makes the
 * draft a string and it stays the source of truth from then on — including when
 * it equals the file, because "I typed it back to how it was" is a state the
 * caller may want to know about and a `=== text` test would erase it.
 *
 * NO GUTTER — see this file's header. Two boxes that scroll independently drift
 * by a line, and a wrong line number on this product's surfaces is the one
 * defect that cannot be shipped.
 */
function EditView({
  load,
  draft,
  onDraft,
  path,
}: {
  load: FileLoad;
  draft: string | null;
  onDraft: ((text: string) => void) | undefined;
  path: RepoPath;
}) {
  if (load.state !== 'ready') return <Pending load={load} path={path} />;

  const value = draft ?? load.text ?? '';
  const count = value === '' ? 0 : value.split(/\r?\n/).length;

  return (
    <div className="files-edit">
      <textarea
        className="files-editor mono"
        data-testid={FILES.editor}
        aria-label={`Edit ${path}`}
        spellCheck={false}
        value={value}
        onChange={(event) => onDraft?.(event.target.value)}
      />
      <p className="files-editnote">
        {`${count.toLocaleString('en-US')} line${count === 1 ? '' : 's'} · nothing is written until you save`}
      </p>
    </div>
  );
}
