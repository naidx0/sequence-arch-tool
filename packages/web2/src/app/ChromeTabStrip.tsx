import { useCallback, useRef, useState } from 'react';

import { Icon, type IconName } from '../chat/Icon';
import {
  WORKSPACE_PILLS,
  type ChromeTabId,
  type ChromeTabState,
  isVisible,
  tabDef,
  toggleTab,
  visibleWorkspacePanes,
} from './chromeTabModel';

export interface WorkspacePillBarProps {
  state: ChromeTabState;
  onChange: (next: ChromeTabState) => void;
  notice?: string | null;
  repoAttached: boolean;
  onOpenFiles?: () => void;
  /**
   * How many panes the frame can seat (`workspacePaneCapacity`). A pill past
   * it is REFUSED OUT LOUD rather than opened into the offscreen region — the
   * defect this closes is a pill that reads ON while its pane is painted
   * outside an `overflow: hidden` shell. Defaults to the whole bar so a caller
   * that has not measured yet refuses nothing.
   */
  capacity?: number;
  /** Why a pill press did nothing. `null` clears the line. */
  onRefused?: (reason: string | null) => void;
}

type PlusItem = { id: string; label: string; icon: IconName; shipped: boolean };

/** In-main workspace pills — toggle on/off, no −/× chrome. */
export function WorkspacePillBar({
  state,
  onChange,
  notice = null,
  repoAttached,
  onOpenFiles,
  capacity = WORKSPACE_PILLS.length,
  onRefused,
}: WorkspacePillBarProps) {
  /* Browser ships as a workspace pill (C2.5). Plus menu keeps Files only. */
  const plusItems: PlusItem[] = [
    { id: 'files', label: 'Files', icon: 'file', shipped: repoAttached },
  ];
  const [plusOpen, setPlusOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  const shown = visibleWorkspacePanes(state).length;
  /* Only an OPEN can overflow the frame; hiding and focusing never can. */
  const atCapacity = shown >= capacity;

  const capacityReason = (id: ChromeTabId) =>
    `This window fits ${capacity} view${capacity === 1 ? '' : 's'} side by side — hide one before opening ${tabDef(id).label}.`;

  const pickPill = useCallback(
    (id: ChromeTabId) => {
      if (!isVisible(state, id) && visibleWorkspacePanes(state).length >= capacity) {
        onRefused?.(
          `This window fits ${capacity} view${capacity === 1 ? '' : 's'} side by side — hide one before opening ${tabDef(id).label}.`,
        );
        return;
      }
      onRefused?.(null);
      onChange(toggleTab(state, id));
    },
    [onChange, onRefused, state, capacity],
  );

  return (
    <div className="shell-wsbar" data-testid="workspace-tabs">
      {WORKSPACE_PILLS.map((id) => {
        const def = tabDef(id);
        const on = isVisible(state, id);
        /* Refusable, not disabled: a `disabled` button drops out of the tab
           order and shows no tooltip, so the reader who clicks it learns
           nothing. This one still takes the click and says why. */
        const refused = !on && atCapacity;
        const classes = ['shell-wpill', on ? 'shell-wpill-on' : ''].filter(Boolean).join(' ');
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className={classes}
            data-testid={`workspace-tab-${id}`}
            aria-selected={on}
            data-on={on ? 'true' : 'false'}
            aria-disabled={refused ? 'true' : undefined}
            data-refused={refused ? 'true' : undefined}
            title={refused ? capacityReason(id) : def.label}
            onClick={() => pickPill(id)}
          >
            <Icon name={def.icon} size={12} />
            <span className="shell-wpill-label">{def.label}</span>
          </button>
        );
      })}
      <span className="shell-ws-plus-wrap" ref={wrapRef}>
        <button
          type="button"
          className="shell-ws-plus"
          data-testid="workspace-plus"
          aria-expanded={plusOpen}
          aria-haspopup="menu"
          title="Open workspace views"
          onClick={() => setPlusOpen((o) => !o)}
        >
          <Icon name="plus" size={12} />
        </button>
        {plusOpen ? (
          <div className="shell-ws-menu" role="menu" data-testid="workspace-plus-menu">
            {plusItems.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-testid={`workspace-plus-${item.id}`}
                disabled={!item.shipped}
                title={
                  item.shipped
                    ? item.label
                    : item.id === 'files'
                      ? 'Files — attach a repository first'
                      : `${item.label} — not shipped yet`
                }
                onClick={() => {
                  setPlusOpen(false);
                  if (item.id === 'files' && item.shipped && repoAttached) onOpenFiles?.();
                }}
              >
                <Icon name={item.icon} size={14} />
                <span className="shell-ws-menu-label">{item.label}</span>
                {!item.shipped || (item.id === 'files' && !repoAttached) ? (
                  <span className="shell-ws-menu-hint">
                    {item.id === 'files' ? 'attach a repo' : 'not shipped'}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </span>
      {notice ? (
        <span className="shell-ws-notice" data-testid="workspace-view-refused" role="status">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

/** @deprecated use WorkspacePillBar — kept for import stability during transition */
export const ChromeTabStrip = WorkspacePillBar;
export type ChromeTabStripProps = WorkspacePillBarProps;
