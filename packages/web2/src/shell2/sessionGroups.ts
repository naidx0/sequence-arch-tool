/* ══════════════════════════════════════════════════════════════════════════
   THE SESSION PANEL'S THREE GROUPS (Decision 49)
   packages/web2/src/shell2/sessionGroups.ts

   Jaden: "I like the session rail... worktrees, earlier, today". A chat bound
   to a live worktree is under Worktrees whatever its age; the rest split on
   the reader's own calendar day. Pinned chats lead their group. Empty groups
   are not returned.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SessionIndexEntry } from '@sequence/api-types';

import type { ChatWorktree } from '../worktree/worktreeModel';

export type SessionGroupKey = 'today' | 'worktrees' | 'earlier';

export interface SessionGroup<E> {
  key: SessionGroupKey;
  label: string;
  rows: E[];
}

/** The worktree a session row carries on the wire, or null (none, or removed). */
export function liveWorktree(entry: SessionIndexEntry): ChatWorktree | null {
  const wt = (entry as SessionIndexEntry & { worktree?: ChatWorktree | null }).worktree ?? null;
  return wt && !wt.removedAt ? wt : null;
}

function sameLocalDay(iso: string, now: Date): boolean {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
}

function ordered<E extends SessionIndexEntry>(rows: readonly E[]): E[] {
  return [...rows].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.id.localeCompare(b.id),
  );
}

export function groupSessions<E extends SessionIndexEntry>(entries: readonly E[], now: Date = new Date()): SessionGroup<E>[] {
  const today: E[] = [];
  const worktrees: E[] = [];
  const earlier: E[] = [];
  for (const e of ordered(entries)) {
    if (liveWorktree(e)) worktrees.push(e);
    else if (sameLocalDay(e.updatedAt, now)) today.push(e);
    else earlier.push(e);
  }
  const groups: SessionGroup<E>[] = [
    { key: 'today', label: 'Today', rows: today },
    { key: 'worktrees', label: 'Worktrees', rows: worktrees },
    { key: 'earlier', label: 'Earlier', rows: earlier },
  ];
  return groups.filter((g) => g.rows.length > 0);
}
