/* ══════════════════════════════════════════════════════════════════════════
   CTRL+TAB: WHICH CHAT IS NEXT (S5)
   packages/web2/src/shell/chatCycle.ts

   In the order the rail draws them (pinned first, then most recently
   updated; v3/V3SessionsRail.tsx `order`), so the key walks down the list
   the person is looking at, and wraps at both ends.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ChatEntry {
  id: string;
  pinned?: boolean;
  updatedAt?: string;
}

export function railOrder<T extends ChatEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.id.localeCompare(b.id),
  );
}

/** The chat to open for Ctrl+Tab (+1) or Ctrl+Shift+Tab (-1), or null when there is no other. */
export function cycleChat(entries: readonly ChatEntry[], activeId: string | null, direction: 1 | -1): string | null {
  const list = railOrder(entries);
  if (list.length === 0) return null;
  const at = activeId === null ? -1 : list.findIndex((e) => e.id === activeId);
  if (at === -1) return list[direction === 1 ? 0 : list.length - 1]!.id;
  if (list.length === 1) return null;
  return list[(at + direction + list.length) % list.length]!.id;
}
