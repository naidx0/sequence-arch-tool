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

/**
 * WHEN A CHAT LAST HAD ACTIVITY, in epoch ms. The server stamps `updatedAt` when the reader sends a message, the
 * plan or the canvas changes (never on a title edit, a pin or merely opening it), so it is the activity clock and
 * creation time is only the fallback for a row without one. It is compared as a TIME: the old string comparison
 * ordered "2026-10-06T09:00:00+02:00" after "2026-10-06T08:00:00.000Z" though it is an hour earlier. `runAt` is the
 * newest agent run the page knows of for the chat (a run's reply does not stamp `updatedAt` on the server).
 */
export function activityMs(entry: Pick<SessionIndexEntry, 'updatedAt' | 'createdAt'>, runAt = 0): number {
  const time = (iso: unknown): number => {
    const n = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
    return Number.isNaN(n) ? 0 : n;
  };
  return Math.max(time(entry.updatedAt) || time(entry.createdAt), runAt);
}

/** Newest activity first; ties broken by id so the order is stable. */
export function byActivity<E extends SessionIndexEntry>(runAt?: (id: string) => number): (a: E, b: E) => number {
  return (a, b) => activityMs(b, runAt?.(b.id) ?? 0) - activityMs(a, runAt?.(a.id) ?? 0) || a.id.localeCompare(b.id);
}

function ordered<E extends SessionIndexEntry>(rows: readonly E[]): E[] {
  const recent = byActivity<E>();
  return [...rows].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || recent(a, b));
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
