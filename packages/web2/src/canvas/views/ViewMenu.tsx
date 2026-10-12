/* ══════════════════════════════════════════════════════════════════════════
   THE VIEW MENU — Map, Grid, Diff, Hotspots in ONE dropdown pill
   packages/web2/src/canvas/views/ViewMenu.tsx

   Jaden, round 13 (after the screenshots): "the top is just super polluted
   with map, grid, diff, hotspots ... should always be a drop down option."
   The row of view pills is gone at every width. This pill shows the view on
   screen (its icon, its name, a chevron) and opens the list of every view,
   the chosen one marked. On a narrow board (board.css, container boardstack)
   the name folds away and the icon and chevron stay.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { BoardIcon, type BoardIconName } from '../BoardIcon.js';
import type { SwitchableView } from './viewModel.js';

const LABEL: Record<SwitchableView, string> = { map: 'Map', grid: 'Grid', flow: 'Flow', diff: 'Diff', hotspots: 'Hotspots' };
const ICON: Record<SwitchableView, BoardIconName> = { map: 'b-map', grid: 'b-grid', flow: 'b-flow', diff: 'b-diff', hotspots: 'b-flame' };

export function ViewMenu({
  views,
  value,
  onChange,
}: {
  views: readonly SwitchableView[];
  value: SwitchableView;
  onChange: (v: SwitchableView) => void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      host.current?.querySelector<HTMLButtonElement>('[data-testid="board-view-menu"]')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  /* Keyboard (menu pattern, as the board fold list in BoardTabs): opening puts focus on the chosen view; Up and Down wrap,
     Home and End jump; Enter and Space pick (they are buttons); Escape closes and returns focus to the pill. Arrow keys on
     the closed pill open it. */
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const items = host.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const on = host.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    (on ?? items?.[0])?.focus();
  }, [open, focusOnOpen]);
  const pillKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (open) setFocusOnOpen((n) => !n);
    else setOpen(true);
  };
  const listKey = (e: ReactKeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = [...(host.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };
  return (
    <span className="bview-menu-wrap" ref={host}>
      <button
        type="button"
        className="bview-menu"
        data-testid="board-view-menu"
        data-view={value}
        data-on={open ? 'true' : 'false'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${LABEL[value]}. Switch board view`}
        title={`${LABEL[value]}: switch view (Map, Grid, Diff and the rest)`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={pillKey}
      >
        <BoardIcon name={ICON[value]} size={14} />
        <span className="bview-menu-t" data-testid="board-view-menu-name">
          {LABEL[value]}
        </span>
        <BoardIcon name="b-chev" size={12} />
      </button>
      {open ? (
        <div className="bview-list" role="menu" aria-label="Board views" data-testid="board-view-list" onKeyDown={listKey}>
          {views.map((v, i) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={v === value}
              className={`bview-item${v === value ? ' on' : ''}`}
              data-testid={`board-view-menu-${v}`}
              onClick={() => {
                setOpen(false);
                host.current?.querySelector<HTMLButtonElement>('[data-testid="board-view-menu"]')?.focus();
                if (v !== value) onChange(v);
              }}
            >
              <BoardIcon name={ICON[v]} size={14} />
              <span className="bview-item-t">{LABEL[v]}</span>
              <kbd className="bview-item-k mono">{`Ctrl+${i + 1}`}</kbd>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

export default ViewMenu;
