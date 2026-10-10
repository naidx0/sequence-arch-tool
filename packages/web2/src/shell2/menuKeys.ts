/* ══════════════════════════════════════════════════════════════════════════
   A MENU'S KEYS (UX audit: Esc did nothing on the chat's More menu or a chat
   row's "…")
   packages/web2/src/shell2/menuKeys.ts

   While a menu is open: focus moves to its first item, the arrow keys walk its
   items, and Escape closes it and gives focus back to the control that opened
   it. One hook, so every B menu answers the same keys.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, type RefObject } from 'react';

const ITEMS = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])';

export function useMenuKeys(open: boolean, menu: RefObject<HTMLElement | null>, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        if (opener && opener.isConnected) opener.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]!.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, menu]);
}
