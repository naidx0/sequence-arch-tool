/* ══════════════════════════════════════════════════════════════════════════
   BOARD CONTROLS — the board's toolbar, in the style of Nx's project graph
   packages/web2/src/canvas/BoardControls.tsx

   A fixed strip along the top of the board pane (board.css): the view
   switcher, Find (Enter fits the matches), the "+N groups" chip and More.
   The board is laid out and fitted below the strip, so nothing sits under
   it. More opens a panel under the strip: trace a path between two cards,
   show only a card's neighbourhood, choose the layout direction, composite or
   flat, and save the board as a PNG. Plain words, no colour of its own.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { BoardIcon } from './BoardIcon.js';
import { LazyBoardControlsBody } from './preloadable.js';

/* The More body loads on first open (perf ratchet, bootJsBytes). */
const ControlsBody = LazyBoardControlsBody.Component;

export interface BoardControlsProps {
  query: string;
  onQuery: (q: string) => void;
  /** Cards whose name contains the query; null when there is no query. */
  matches: number | null;
  onFitMatches: () => void;
  /** The one selected card, if exactly one is selected. */
  selectedLabel: string | null;
  pathStart: string | null;
  pathEnd: string | null;
  /** A sentence about the traced path, or null before both ends are set. */
  pathNote: string | null;
  onPathStart: () => void;
  onPathEnd: () => void;
  onPathClear: () => void;
  focusLabel: string | null;
  proximity: 1 | 2 | 3;
  onFocusSelected: () => void;
  onFocusClear: () => void;
  onProximity: (p: 1 | 2 | 3) => void;
  direction: 'auto' | 'LR' | 'TB';
  onDirection: (d: 'auto' | 'LR' | 'TB') => void;
  flat: boolean;
  onFlat: (flat: boolean) => void;
  /** Open every group the pane can read (autoExpand.ts); absent when there
   *  is none to open. */
  onExpandAll?: () => void;
  /** Close every open group. */
  onCollapseAll?: () => void;
  /** How many cards the reader has placed by hand on this board (C.1). */
  moved?: number;
  /** Forget the hand-placed positions; absent: no Reset layout row. */
  onResetLayout?: () => void;
  onExport: () => void;
  exportNote: string | null;
  /** The views (Map, Grid, Diff, Hotspots) as ONE dropdown pill at every width (views/ViewMenu.tsx). */
  viewMenu?: ReactNode;
  /** Round 13 (A6): the board tags (boards/BoardTabs.tsx), first in the row, so the board's whole toolbar is one line. */
  leading?: ReactNode;
  /** The "+N groups" chip, after Find, when Expand all left groups closed. */
  extra?: ReactNode;
}


export function BoardControls(props: BoardControlsProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  /* B's MENU BEHAVIOUR (UX audit, 2026-10-06: the panel stayed open on Esc and
     on an outside click, 4 of 4 runs). Escape closes it and puts focus back
     on More; a press outside the toolbar closes it. */
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      host.current?.querySelector<HTMLButtonElement>('[data-testid="board-controls-toggle"]')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    /* data-toast-avoid: the agent toasts stack clear of marked elements
       (chat/AgentToasts.tsx), so a toast never covers the board toolbar.

       DECISION 49: B's view pills, then Find as a glass pill, then More as a
       round glass icon button, floating over the board's top-left corner. The
       top-right corner is the shell's (its pane head floats there), so
       nothing of the board's sits on that side. */
    <div className="board-controls" ref={host} data-testid="board-controls" data-open={open ? 'true' : 'false'} data-toast-avoid="">
      {props.leading ?? null}
      {props.viewMenu ?? null}
      <label className="bfind" title="Find a card by name (Enter fits the matches)">
        <BoardIcon name="b-search" size={14} />
        <input
          type="search"
          data-testid="board-search"
          aria-label="Find on the board"
          placeholder="Find"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onFitMatches();
            if (e.key === 'Escape') props.onQuery('');
          }}
        />
        {props.matches !== null ? (
          <span className="bfind-n" data-testid="board-search-count">
            {props.matches === 1 ? '1 match' : `${props.matches} matches`}
          </span>
        ) : null}
      </label>
      {props.extra ?? null}
      <span className="bc-morewrap">
        <button
          type="button"
          className="bbtn"
          data-testid="board-controls-toggle"
          data-on={open ? 'true' : 'false'}
          aria-expanded={open}
          aria-label={open ? 'Hide board controls' : 'Show board controls'}
          title={open ? 'Hide board controls' : 'More: path, neighbours, layout, groups, keys, save as PNG'}
          onClick={() => setOpen((o) => !o)}
        >
          {/* Layers, not dots: the dock beside it has its own more-menu (dots), and two identical buttons in one pane read as a bug. */}
          <BoardIcon name="b-layers" size={16} />
        </button>
        {open ? <ControlsBody {...props} /> : null}
      </span>
    </div>
  );
}
