/* ══════════════════════════════════════════════════════════════════════════
   THE INDEX RAIL — items 4.1, 4.2, 4.3, 4.4, 4.5
   packages/web2/src/rail/IndexRail.tsx

   Written against docs/brand/graphite/pages/11-the-functions-rail.html.

   WHAT IT IS. CLAUDE.md, in the sentence that describes the product: "an
   Obsidian-style file/functions rail on the right drills into it — functions-
   first: click a function → the canvas re-sorts and plays the animated
   service-to-service flow." Sheet 11.1 names it: "This column has a name: the
   index rail. It is the shell's third column, it holds one thing — the index of
   the open repository, board card above file above function."

   ── IT DOES NOT DRAW ITS OWN TITLE, AND THAT IS NOT AN OMISSION ───────────
   Sheet 11.1: "The header carries the word, not a glyph… the rail's own header
   is titled in words." That header is `.pane-hd`, the 44px line the shell owns,
   and `shell/Shell.tsx` already draws it with the literal word `Index`
   (`railTitle = 'Index'`, asserted at every breakpoint in `Shell.test.tsx`).
   Repeating the word inside the pane body would put two headers on one column,
   so this component carries the word as the REGION'S ACCESSIBLE NAME instead —
   the same word, said once, to every reader. `IndexRail.test.tsx` locks the
   non-duplication, because "add a title" is the obvious first instinct of the
   next person to open this file.

   ── WHAT THIS COMPONENT OWNS, AND WHAT IT REFUSES TO OWN ──────────────────
   Owns:    the filter, which rows are open, which row is selected, which node's
            detail is showing, and which function was last listed.
   Refuses: the playback cursor. `canvas.view` holds S3 and the strip is driven
            from the `playback` prop — see FlowPanel.tsx for why a second cursor
            here would be the rail and the canvas disagreeing about which hop is
            lit.

   ── THE HANDBACK THE WIRING LANE TAKES ────────────────────────────────────
   `state/types.ts` declares `RailSlice {rows, expanded, filter, selectedFunctionId,
   selectedPath, detail, coverageByPath, loading}` and the store's `EMPTY_RAIL`
   is still empty, because item 2.2 shipped no rail actions — this lane may not
   add them (`store.ts` belongs to the state lane, and "one agent per file"
   is what stops twelve agents producing three specifications of one control).
   So the view state above lives in `useState` here, in exactly the shape that
   slice already declares. When the store grows `rail/*` actions the move is
   mechanical: delete the `useState` calls, take `rail` and `dispatch` as props.
   Nothing else in this file changes.

   `/api/functions` and `/api/tree` are likewise NOT fetched here. `functions`
   arrives as a prop typed `FunctionIndex` — the shape `state/types.ts` already
   declares for it — so when the store learns to fetch it, this component does
   not notice. Fetching here would put a second loader beside the store's and
   make "the rail mounted" and "the index loaded" two different events that can
   disagree.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';

import type { GetArchGraphResponse } from '@sequence/api-types';

import type {
  Coverage,
  FlowPlayback,
  FunctionId,
  FunctionIndex,
  NodeId,
  RailRow,
  RepoPath,
} from '../state/types';

import { FlowPanel } from './FlowPanel';
import { NodeDetailPanel } from './NodeDetailPanel';
import { RailIcon, iconForKind } from './RailIcon';
import { FileView } from './FileView';
import { RAIL_KEYS, railKey } from './railKeys';
import {
  NOT_TRACED,
  buildRailRows,
  coverageBadgeText,
  coverageByPath,
  filterRailRows,
  flowForFunction,
  nodeDetailViewFor,
  toRepoPath,
  type FlowTrace,
} from './railModel';

type ScannedGraph = GetArchGraphResponse;

/**
 * Sheet 11.7's three ways for the rail to have nothing to show, plus the
 * ordinary one. They are not the same thing and they do not share a sentence:
 * "'No results' for all three is the rail refusing to answer."
 */
export type RailStatus = 'idle' | 'reading' | 'stale';

export interface IndexRailProps {
  /** The scanned graph, whole, as `/archgraph.json` returned it. */
  graph: ScannedGraph | null;
  /** Derived from `/api/functions`. `null` until it has answered. */
  functions: FunctionIndex | null;
  /** The last answer's coverage. `null` when no answer has been given. */
  coverage: Coverage | null;
  /** The canvas's playback, when the canvas is in S3. The rail does not own it. */
  playback: FlowPlayback | null;
  status?: RailStatus;
  repoName?: string | null;
  /** Overrides the default "Reading …" line while `status === 'reading'`. */
  readingStatus?: string | null;
  /** For the stale strip's "last read ⟨when⟩". */
  lastReadAt?: number | null;
  onRetry?: () => void;
  /** The rail drives the canvas. Every one of these is the canvas's move. */
  onPlay: (playback: FlowPlayback) => void;
  onPlaybackChange: (next: FlowPlayback) => void;
  onClearFlow: () => void;
  onFocusNode: (nodeId: NodeId) => void;
  onOpenScope: (nodeId: NodeId) => void;
  /**
   * A path the BOARD wants shown, or null.
   *
   * The other direction of the two-pane relationship, and the half that never
   * arrived: `rail/reveal` has a reducer arm writing `rail.selectedPath`, and
   * no component read it - so clicking a card moved nothing over here and the
   * two panes that are meant to drive each other only ever talked one way.
   *
   * A PROP RATHER THAN A STORE READ, because this component still owns its
   * view state in `useState` (see the header). When that state moves to the
   * store this prop goes with it; until then, one component reaching into the
   * store while the rest of its selection lives locally would be two answers
   * to "what is selected".
   */
  revealPath?: RepoPath | null;
  /**
   * A node the BOARD asked the rail to explain, or null.
   *
   * The companion to `revealPath` for cards rather than files. `rail.detail`
   * was declared for this and written by nobody; the ID is the state and
   * `nodeDetailViewFor` derives the panel from the graph.
   */
  explainNodeId?: NodeId | null;
  /**
   * THE ANNOTATE ANSWER, keyed by node id — the canvas slice's
   * `annotations` record, passed through so `NodeDetailPanel` can show this
   * node's English beside its evidence. Absent keys draw nothing.
   */
  annotations?: Record<NodeId, string[] | undefined>;
}

export function IndexRail({
  graph,
  functions,
  coverage,
  playback,
  status = 'idle',
  repoName = null,
  readingStatus = null,
  lastReadAt = null,
  onRetry,
  onPlay,
  onPlaybackChange,
  onClearFlow,
  onFocusNode,
  onOpenScope,
  revealPath = null,
  explainNodeId = null,
  annotations,
}: IndexRailProps) {
  /* Counted, not listed. A list of 56 paths is a haystack; "tools (52)" is
     something a reader can act on. Null when the field is absent OR empty —
     two different facts, both of which mean there is nothing to say here. */
  /*
   * THE FILE THE READER IS LOOKING AT.
   *
   * Component-local rather than in the store, because it is a view state and
   * not a fact about the repository — and the rail is the only surface that
   * has it. Promoting it to the store would invite a second opener with a
   * different idea of what "open" means.
   */
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  /* Where the keyboard is in the rail. -1 means nothing here has focus, which
     is what lets Down enter at the top and Up at the bottom. */
  const [keyIndex, setKeyIndex] = useState(-1);

  const unscannedNote = useMemo(() => {
    const regions = (graph as { unscanned?: { dir: string; files: number }[] } | null)?.unscanned;
    if (!regions || regions.length === 0) return null;
    const files = regions.reduce((n, r) => n + r.files, 0);
    if (files === 0) return null;
    const named = regions
      .slice(0, 2)
      .map((r) => `${r.dir} (${r.files})`)
      .join(', ');
    const rest = regions.length > 2 ? `, +${regions.length - 2} more` : '';
    return `${files} source file${files === 1 ? '' : 's'} outside every service were not read — ${named}${rest}.`;
  }, [graph]);

  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<RepoPath>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detailNodeId, setDetailNodeId] = useState<NodeId | null>(null);
  const [trace, setTrace] = useState<FlowTrace | null>(null);
  const [untraced, setUntraced] = useState<FunctionId | null>(null);

  /*
   * DERIVED ONCE PER GRAPH, NOT PER RENDER. Hundreds of file nodes and thousands
   * of functions
   * on this repository; `buildRailRows` walks both. The state contract names
   * this defect class on the board — "rebuilding either map per render is the
   * class of defect the board already has with its per-edge box map."
   */
  const rows = useMemo(
    () => (graph ? buildRailRows(graph, functions) : []),
    [graph, functions],
  );

  /*
   * THE BOARD ASKED FOR A FILE — expand it, select it, bring it on screen.
   *
   * All three, because any one alone leaves the reader hunting: selecting a
   * row four hundred rows down highlights something they cannot see, and
   * scrolling without selecting moves the list for no visible reason.
   *
   * Keyed on the path so re-revealing the same file after the reader has
   * scrolled away brings it back rather than doing nothing.
   */
  useEffect(() => {
    if (revealPath === null) return;
    setExpanded((prev) => (prev.has(revealPath) ? prev : new Set([...prev, revealPath])));
    /* SELECTION IS KEYED ON THE ROW ID, not the path - `selected` compares
       against `row.id`, and a path put in that slot would highlight nothing
       while looking like it had worked. */
    const target = rows.find((r) => r.rung === 'file' && r.path === revealPath);
    if (target) setSelectedId(target.id);
    /* `scrollIntoView` does not exist in jsdom, and layout is not this
       component's to assert anyway - the row being SELECTED is the testable
       claim; the scroll is the courtesy on top of it. */
    /* No `CSS.escape`: it does not exist in jsdom, and it is for IDENTIFIERS -
       inside a quoted attribute selector a repo path needs no escaping. A path
       containing a quote would, so that case simply skips the scroll rather
       than building a broken selector. */
    const el = revealPath.includes('"')
      ? null
      : document.querySelector(`[data-rail-path="${revealPath}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [revealPath, rows]);

  /*
   * C4.3 — THE BOARD ASKED ABOUT A CARD. Mirror revealPath: select the matching
   * card row and scroll it into view. Detail panel already opens via
   * `explainNodeId`; without this the row highlight stayed one-way (rail→board).
   */
  useEffect(() => {
    if (explainNodeId === null) return;
    const target = rows.find((r) => r.rung === 'card' && r.id === explainNodeId);
    if (!target) return;
    setSelectedId(target.id);
    const id = String(explainNodeId);
    const el = id.includes('"')
      ? null
      : document.querySelector(
          `[data-testid="rail-row"][data-rung="card"][data-row-id="${id}"]`,
        );
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [explainNodeId, rows]);
  const badges = useMemo(
    () => (graph ? coverageByPath(graph, coverage) : {}),
    [graph, coverage],
  );
  const pathById = useMemo(() => {
    const map = new Map<NodeId, RepoPath>();
    for (const node of graph?.nodes ?? []) {
      map.set(node.id, toRepoPath(node.path ?? node.label));
    }
    return map;
  }, [graph]);

  const filtering = filter.trim() !== '';
  const filtered = useMemo(() => filterRailRows(rows, filter), [rows, filter]);

  /*
   * WHAT IS ACTUALLY ON SCREEN. Two different rules, and the sheet is explicit
   * that the second overrides the first: outside filter mode a function row is
   * drawn only when its file is open; inside it, "every match is shown with its
   * ancestors revealed, so a hit is never hidden behind a collapsed parent."
   */
  const visible = useMemo(() => {
    if (filtering) return filtered.rows;
    const out: RailRow[] = [];
    let openFile = false;
    for (const row of rows) {
      if (row.rung === 'card') {
        openFile = false;
        out.push(row);
        continue;
      }
      if (row.rung === 'file') {
        openFile = expanded.has(row.path);
        out.push(row);
        continue;
      }
      if (openFile) out.push(row);
    }
    return out;
  }, [filtering, filtered.rows, rows, expanded]);

  /*
   * THE NODE BEING EXPLAINED — whichever was asked for most recently.
   *
   * The board's request wins over the rail's own last click, because it IS the
   * more recent gesture: a reader who clicks a card on the board is asking
   * about that card, not about whatever they last opened over here.
   */
  const explaining = explainNodeId ?? detailNodeId;
  const detailView = useMemo(
    () => (graph && explaining ? nodeDetailViewFor(graph, explaining) : null),
    [graph, explaining],
  );

  function toggleFile(path: RepoPath): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  /**
   * SHEET 11.6, THE WHOLE PURPOSE OF THE RAIL, AND ITS ONE REFUSAL.
   *
   * "A function row that the scan could not resolve to a node on the board does
   * not play. It selects its card instead, and says so — it never plays a flow
   * assembled from a guess."
   *
   * Measured on this repository: the great majority of functions take the second
   * branch, because every call they make stays inside their own file. That is
   * the common case, not the error case, and it gets a word rather than a dead
   * row or a flow of length zero pretending to be a flow.
   */
  function clickFunction(id: FunctionId): void {
    if (!graph) return;
    setSelectedId(id);
    const next = flowForFunction(id, functions, graph);
    if (!next.traced) {
      setTrace(null);
      setUntraced(id);
      if (next.originNodeId) onFocusNode(next.originNodeId);
      return;
    }
    setUntraced(null);
    setTrace(next);
    onPlay({ functionId: id, hops: next.hops, cursor: 0, playing: true });
  }

  function clickCard(id: NodeId): void {
    setSelectedId(id);
    setDetailNodeId(id);
    setUntraced(null);
    onFocusNode(id);
  }

  function clearFlow(): void {
    setTrace(null);
    setUntraced(null);
    onClearFlow();
  }

  /* ── The rows ──────────────────────────────────────────────────────────── */

  function renderRow(row: RailRow, index: number) {
    const selected = selectedId === row.id;

    if (row.rung === 'card') {
      const path = pathById.get(row.id) ?? '';
      const badge = badges[path];
      const badgeText = badge ? coverageBadgeText(path, badge) : null;
      const node = graph?.nodes.find((n) => n.id === row.id);
      /* The next row is a file iff this card has one — the flat list is the
         tree, so "has children" is a look at the neighbour and never a scan. */
      const hasFiles = visible[index + 1]?.rung === 'file';
      return (
        <li key={row.id} className="rail-item">
          <button
            type="button"
            className="rail-row rail-card"
            data-testid="rail-row"
            data-rung="card"
            data-row-id={row.id}
            data-selected={selected ? 'true' : undefined}
            onClick={() => clickCard(row.id)}
          >
            <RailIcon name={iconForKind(node?.kind ?? 'service')} />
            <span className="rail-name">{row.label}</span>
            <span className="rail-trail">
              <RailIcon name="fn" size={12} />
              {/*
                Same rule as the file rows below: `count` sums the function ids the
                index supplied, so an absent index makes it 0 for every card. The gate
                caught all ten printing 0 behind a proxy that 404s /api/functions.
                An em dash says "not known"; a 0 asserts a scan result we do not have.
              */}
              <span className="mono">{functions === null ? '—' : row.count}</span>
            </span>
          </button>
          {badgeText ? (
            /*
              ITEM 4.4, THE STRONGEST THING SEQUENCE HAS, rendered as one line.
              CANON §3: "Codex and Claude Code structurally cannot tell you what
              they did not read." The glyph is beside the sentence and never
              instead of it — sheet 11.7: "Every coloured state on this sheet
              also carries a word. A reader who cannot see the hue still gets
              the fact."
            */
            <p className="rail-badge" data-testid="rail-badge" data-path={path}>
              <RailIcon name="alert" size={12} />
              <span>{badgeText}</span>
            </p>
          ) : null}
          {!filtering && !hasFiles ? (
            <p className="rail-cardempty" data-testid="rail-card-empty">
              Nothing the scan could name.
            </p>
          ) : null}
        </li>
      );
    }

    if (row.rung === 'file') {
      const open = expanded.has(row.path);
      const showsFunctions = filtering || open;
      return (
        <li key={row.id} className="rail-item">
          <button
            type="button"
            className="rail-row rail-file"
            data-testid="rail-row"
            data-rung="file"
            data-row-id={row.id}
            data-rail-path={row.path}
            /* A FILE ROW COULD NOT SHOW SELECTION AT ALL - only the card and
               function rungs rendered this. So revealing a file set state that
               nothing displayed, which looks exactly like the reveal having
               done nothing. */
            data-selected={selectedId === row.id ? 'true' : undefined}
            data-open={open ? 'true' : undefined}
            aria-expanded={open}
            title={row.path}
            onClick={() => toggleFile(row.path)}
          >
            <RailIcon name={open ? 'chevdown' : 'chevright'} size={12} />
            <RailIcon name="file" />
            {/*
              Sheet 11.2: "a path truncates at the front, because the identity of
              …/board/boardFocusModel.ts is its tail". The row shows the file's
              own name and carries the whole path as its title; the front-truncated
              form belongs to the path line under it, in rail.css.
            */}
            <span className="rail-name">{row.label}</span>
            <span className="rail-trail">
              <RailIcon name="fn" size={12} />
              {/*
                A COUNT IS A CLAIM ABOUT A SCAN. `functionCount` is derived from
                `functions`, so when that index is absent it is 0 for every row —
                and printing 0 asserts "this file has no functions" when the truth
                is "nobody looked". The gate proved it: behind a proxy that 404s
                only /api/functions, 526 file rows and 10 card rows all printed 0.
                Grounded-not-guessed (docs/CANON.md §1) forbids that, so an unread
                index prints an em dash — the absence, not a number.
              */}
              <span className="mono">{functions === null ? '—' : row.functionCount}</span>
            </span>
          </button>
          {/* READ IT. Expanding a file shows its FUNCTIONS; this shows its
              source. Two different questions about the same row, so two
              controls rather than one gesture that has to guess. */}
          <button
            type="button"
            className="rail-read"
            data-testid="rail-read"
            data-path={row.path}
            aria-label={`Read ${row.label}`}
            onClick={() => setViewingFile(row.path)}
          >
            Read
          </button>
          {functions !== null && showsFunctions && row.functionCount === 0 && !filtering ? (
            <p className="rail-cardempty" data-testid="rail-file-empty">
              The scan read this file and could not name a function in it.
            </p>
          ) : null}
          {/*
            REACHABLE NOW. This branch previously read
            `row.functionCount > 0 && ... && functions === null`, which is a
            contradiction — the count is derived FROM `functions`, so it is 0
            whenever that is null and the guard could never be true. It was dead
            code standing in for the honesty the row above was quietly breaking.
          */}
          {open && functions === null && !filtering ? (
            <p className="rail-cardempty" data-testid="rail-file-unread">
              The function index has not been read yet.
            </p>
          ) : null}
        </li>
      );
    }

    return (
      <li key={row.id} className="rail-item rail-indent">
        <button
          type="button"
          className="rail-row rail-fn"
          data-testid="rail-row"
          data-rung="function"
          data-row-id={row.id}
          data-selected={selected ? 'true' : undefined}
          data-playing={playback?.functionId === row.id ? 'true' : undefined}
          onClick={() => clickFunction(row.id)}
        >
          <RailIcon name="fn" />
          <span className="rail-name mono">{row.label}</span>
          <span className="rail-line mono" data-testid="rail-line">{`:${row.line}`}</span>
        </button>
        {untraced === row.id ? (
          <p className="rail-nottraced" data-testid="rail-nottraced">
            {NOT_TRACED}
          </p>
        ) : null}
      </li>
    );
  }

  /* ── The body: rows, or the one honest sentence that replaces them ─────── */

  let body: JSX.Element;
  if (graph === null) {
    body = (
      <p className="rail-empty" data-testid="rail-empty">
        Open a repository and the index fills as the board draws.
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="rail-empty" data-testid="rail-empty">
        The scan read this repository and could not name anything in it.
      </p>
    );
  } else if (filtering && filtered.rows.length === 0) {
    body = (
      <p className="rail-empty" data-testid="rail-empty">
        {`Nothing in this repository is named “${filter.trim()}”.`}
      </p>
    );
  } else {
    body = (
      /*
       * KEYBOARD NAVIGATION — rank 30. The rail was a plain list of buttons:
       * Tab visited every row, so reaching a file four hundred rows down meant
       * four hundred presses, and nothing expanded or collapsed without a
       * mouse.
       *
       * The decision lives in `railKey`, which is pure and tested; this only
       * carries the press to it and applies the answer. preventDefault is on
       * the ACTION, never the key — see RAIL_KEYS.
       */
      <ul
        className="rail-rows"
        onKeyDown={(event) => {
          if (!RAIL_KEYS.has(event.key)) return;
          const keyRows = visible.map((row) => ({
            id: row.id,
            expandable: row.rung === 'file',
            expanded: row.rung === 'file' && expanded.has(row.path),
          }));
          const action = railKey({ key: event.key, index: keyIndex, rows: keyRows });
          if (action.kind === 'none') return;
          event.preventDefault();

          if (action.kind === 'move') {
            setKeyIndex(action.index);
            /* Found by POSITION among the rendered rows rather than by an
               attribute selector: a row id can contain any path character, and
               `CSS.escape` is not implemented everywhere a test runs. The two
               lists are the same list, so the index is the identity. */
            const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[data-row-id]');
            buttons[action.index]?.focus();
            return;
          }
          const row = visible[action.index];
          if (!row || row.rung !== 'file') return;
          if (action.kind === 'expand' || action.kind === 'collapse') toggleFile(row.path);
          if (action.kind === 'activate') toggleFile(row.path);
        }}
      >
        {visible.map(renderRow)}
      </ul>
    );
  }

  return (
    <div className="rail-scope rail" data-testid="rail" aria-label="Index">
      {/*
        Sheet 11.5: "One field, always visible, directly under the header and
        above the scroller so it never scrolls away."
      */}
      <div className="rail-top">
        <span className="rail-inputwrap">
          <RailIcon name="search" className="rail-inputicon" />
          <input
            type="search"
            className="rail-input"
            data-testid="rail-filter"
            aria-label="Filter the index"
            placeholder="Filter files and functions"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
          {filtering ? (
            <button
              type="button"
              className="rail-iconbtn rail-inputclear"
              data-testid="rail-filter-clear"
              aria-label="Clear the filter"
              onClick={() => setFilter('')}
            >
              <RailIcon name="x" size={12} />
            </button>
          ) : null}
        </span>

        {status !== 'idle' ? (
          <p className="rail-status" data-testid="rail-status" data-status={status}>
            {status === 'reading' ? (
              <>
                <span className="rail-dot rail-pulse" />
                {readingStatus ?? `Reading ${repoName ?? 'the repository'}`}
              </>
            ) : (
              <>
                <RailIcon name="alert" size={12} />
                {lastReadAt === null
                  ? 'Not tracking'
                  : `Not tracking · last read ${new Date(lastReadAt).toLocaleTimeString()}`}
                {onRetry ? (
                  <button
                    type="button"
                    className="rail-retry"
                    data-testid="rail-retry"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                ) : null}
              </>
            )}
          </p>
        ) : null}

        {filtered.matches !== null ? (
          <p className="rail-matches" data-testid="rail-matches">
            {filtered.matches === 1 ? '1 match' : `${filtered.matches} matches`}
            {/* WHAT THE CAP WITHHELD, SAID. A list that quietly stops at 300
                tells a reader their repository contains 300 matches, and the
                number they are shown is the one thing they cannot check from
                the screen. The next instruction is theirs to act on: type
                another character. */}
            {filtered.omitted > 0 ? (
              <span className="rail-omitted" data-testid="rail-omitted">
                {` · showing ${filtered.rows.length}, ${filtered.omitted} more — narrow the filter`}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="rail-scroll">{body}</div>

      {/* ══ WHAT WAS NOT READ — owner walk 2026-08-22 (A7) ══════════════════

          "Index is cool. It shows the files. Missing a couple, actually,
          unfortunately, but so be it."

          Fifty-six tracked source files were absent, none of them parse
          failures: all of them outside every discovered service, because the
          scan walks service directories and nothing else. `unfollowed`
          reported `[]` throughout — which its contract defines as "looked, and
          everything was readable" — so the graph asserted coverage over files
          it had never opened.

          "So be it" is a reader deciding the tool is lossy. This product's
          first claim is that coverage is KNOWABLE, so the rail says the number
          instead of letting absence pass for completeness.

          ABSENT AND EMPTY ARE DIFFERENT. Absent means an older graph that
          predates the field; claiming full coverage on its behalf would invent
          the exact assurance this exists to stop being invented. Both render
          nothing, for two different reasons. */}
      {/* READING A FILE — the rail listed them all and could not show one. */}
      <FileView path={viewingFile} onClose={() => setViewingFile(null)} />

      {unscannedNote ? (
        <p className="rail-unscanned" data-testid="rail-unscanned">
          {unscannedNote}
        </p>
      ) : null}

      {/* A PLAYBACK WITH NO HOP IS NOT A FLOW — item playback. The panel is
          headed "Plays on board", and drawn over an empty hop list that heading
          announces a flow nothing resolved. `flowForFunction` returns
          `traced: false` for most of this repository's functions and the
          rail's rule for those is sheet 11.6's: say so, and do not play. The
          guard is here rather than inside the panel because the question is
          whether the panel EXISTS, and a component that renders itself away is
          harder to reason about than a caller that does not mount it. */}
      {/*
        FINDING F3: a zero-hop `trace` mounted the panel, so the rail drew the
        heading "Plays on board" over an EMPTY hop list — while the strip beneath
        it was driven by a different, stale flow. A panel about a flow with no hops
        is a panel about nothing; the honest surface is no panel.
        The guard is now the same question for both sources: does this have hops?
      */}
      {(trace && trace.hops.length > 0) || (playback && playback.hops.length > 0) ? (
        <FlowPanel
          trace={trace}
          playback={playback}
          graph={graph as ScannedGraph}
          onPlaybackChange={onPlaybackChange}
          onClear={clearFlow}
        />
      ) : null}

      {detailView ? (
        <NodeDetailPanel
          view={detailView}
          annotations={annotations?.[detailView.node.id] ?? null}
          onOpenScope={onOpenScope}
          onClose={() => setDetailNodeId(null)}
        />
      ) : null}
    </div>
  );
}
