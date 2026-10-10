/* ══════════════════════════════════════════════════════════════════════════
   THE GROUP FRAME — an expanded group, drawn around its members
   packages/web2/src/canvas/GroupFrame.tsx

   A service (or module) the reader expanded in place. Its members sit inside
   the frame; the header names the group, says how many members are drawn of
   how many the scan found, and offers the two ways out: Collapse (back to one
   card) and Focus (draw this group alone).
   ══════════════════════════════════════════════════════════════════════════ */

import type { MouseEvent } from 'react';

import { BoardIcon } from './BoardIcon.js';
import type { BoardNode } from './NodeCard.js';

export interface GroupFrameProps {
  node: BoardNode;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onCollapse?: (id: string) => void;
  onFocus?: (id: string) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
}

export function GroupFrame({ node, selected, dimmed, onSelect, onCollapse, onFocus, onMenu }: GroupFrameProps) {
  const shown = node.group?.shown ?? 0;
  const total = node.group?.total ?? 0;
  const tests = node.group?.tests ?? 0;
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    fn();
  };
  return (
    <div
      className={['group-frame', selected ? 'sel' : '', dimmed ? 'dim' : ''].filter(Boolean).join(' ')}
      data-testid="board-group"
      data-node-id={node.id}
      data-selected={selected ? 'true' : 'false'}
      data-change={node.change}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenu(node.id, { x: event.clientX, y: event.clientY });
            }
          : undefined
      }
    >
      <div className="gf-hd" onClick={(event) => onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey)}>
        <span className="gf-ic" aria-hidden="true">
          <BoardIcon name={node.present.kind === 'module' ? 'module' : 'service'} size={14} />
        </span>
        <span className="gf-t" data-testid="board-group-title" title={tests > 0 ? `${node.label}: ${total} members, ${tests} test ${tests === 1 ? "file" : "files"}` : node.label}>
          {node.label}
        </span>
        <span className="gf-n" data-testid="board-group-count">
          {total}
        </span>
        {node.change ? (
          <span className={`nd-change is-${node.change}`} data-testid="board-node-change">
            {node.change}
          </span>
        ) : null}
        {/* THE +N CHIP (§3.2): members past the 50-box budget, counted, not
            drawn. Focus draws the group alone, with room for them. */}
        {shown < total ? (
          <span
            className="gf-more"
            data-testid="board-group-more"
            title={`${total - shown} more not drawn; Focus shows the group alone`}
          >
            +{total - shown}
          </span>
        ) : null}
        {/* Test files are not drawn as members; they are counted here. */}
        {tests > 0 ? (
          <span className="gf-more gf-tests" data-testid="board-group-tests" title={`${tests} test ${tests === 1 ? 'file' : 'files'}, not drawn`}>
            tests ({tests})
          </span>
        ) : null}
        {onFocus ? (
          <button
            type="button"
            className="gf-btn"
            data-testid="board-group-focus"
            aria-label={`Focus ${node.label}`}
            title="Focus: draw this group alone"
            onClick={stop(() => onFocus(node.id))}
          >
            Focus
          </button>
        ) : null}
        {onCollapse ? (
          <button
            type="button"
            className="gf-btn"
            data-testid="board-group-collapse"
            aria-label={`Collapse ${node.label}`}
            title="Collapse"
            onClick={stop(() => onCollapse(node.id))}
          >
            <BoardIcon name="minus" size={12} />
          </button>
        ) : null}
      </div>
      {/* NOTHING DRAWABLE INSIDE (every member past the 50-box budget): the
          +N becomes a readable row in the frame's body, with the way to see
          them, instead of an empty frame with a chip in its corner. */}
      {shown === 0 && total + tests > 0 ? (
        <div className="gf-empty" data-testid="board-group-empty">
          <span className="gf-empty-t">
            {total > 0 ? `${total} not drawn: the board holds 50 boxes` : `Only test files: ${tests}`}
          </span>
          {onFocus ? (
            <button
              type="button"
              className="gf-btn"
              data-testid="board-group-empty-focus"
              onClick={stop(() => onFocus(node.id))}
            >
              Focus
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
