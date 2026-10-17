/* ══════════════════════════════════════════════════════════════════════════
   THE FILES RIGHT-CLICK MENU (round 9, ask 20)
   packages/web2/src/files/FileContextMenu.tsx

   Jaden: "a right-click menu to edit anything about them (more mutability)".
   One menu for a file, a folder, and the empty space under the tree. It reuses
   shell2's menu look (.s2-menu / .s2-mi) and is portalled to <body> so a
   clipped, transformed or scrolled ancestor cannot move or cut it.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { S2Icon } from '../shell2/icons';
import type { S2IconName } from '../shell2/icons';

export type FileMenuAction =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'copy-path'
  | 'reveal';

export interface FileMenuTarget {
  /** The row's repo path; '' for the empty space (the project root). */
  path: string;
  kind: 'file' | 'dir' | 'root';
  x: number;
  y: number;
}

interface Item {
  id: FileMenuAction;
  label: string;
  icon: S2IconName;
  danger?: boolean;
  /** A rule above this item. */
  sep?: boolean;
}

export function menuItems(kind: FileMenuTarget['kind']): Item[] {
  const make: Item[] = [
    { id: 'new-file', label: 'New file', icon: 'file' },
    { id: 'new-folder', label: 'New folder', icon: 'folder' },
  ];
  if (kind === 'root') return make;
  return [
    ...make,
    { id: 'rename', label: 'Rename', icon: 'pen', sep: true },
    { id: 'duplicate', label: 'Duplicate', icon: 'layers' },
    { id: 'copy-path', label: 'Copy path', icon: 'import' },
    { id: 'reveal', label: 'Reveal in file manager', icon: 'repo' },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, sep: true },
  ];
}

export interface FileContextMenuProps {
  target: FileMenuTarget;
  onPick: (action: FileMenuAction) => void;
  onClose: () => void;
}

export function FileContextMenu({ target, onPick, onClose }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const items = menuItems(target.kind);

  /* Keep it on screen: flip up/left when it would run off the window. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(target.x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(target.y, window.innerHeight - r.height - 8));
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [target.x, target.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (buttons.length === 0) return;
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="s2">
      <div
        ref={ref}
        className="s2-menu files-ctx"
        role="menu"
        aria-label={target.path === '' ? 'Project folder' : `Actions for ${target.path}`}
        data-testid="files-ctx-menu"
        style={{ position: 'fixed', left: pos.left, top: pos.top, width: 208, zIndex: 400 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => (
          <div key={item.id} style={{ display: 'contents' }}>
            {item.sep ? <div role="separator" style={{ height: 1, margin: '4px 6px', background: 'var(--b-edge2, var(--edge))' }} /> : null}
            <button
              type="button"
              role="menuitem"
              className={`s2-mi${item.danger ? ' s2-mi-danger' : ''}`}
              data-testid={`files-ctx-${item.id}`}
              onClick={() => onPick(item.id)}
            >
              <S2Icon name={item.icon} small />
              <span className="s2-mi-d">{item.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
