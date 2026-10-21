/* ══════════════════════════════════════════════════════════════════════════
   AN EMPTY CHAT IS NOT MADE TWICE
   packages/web2/src/sessions/emptyChat.ts

   The Opus walk of 2026-10-15: "Each 'New chat in second' click leaves an empty chat behind". The engine writes a
   chat the moment New chat is pressed, so a reader who pressed it three times held three chats with nothing in
   them. A chat nobody has said anything in is the chat New chat would make: pressing New chat there goes to it
   instead of writing another. At most one empty chat exists in a workspace, and it is the one the reader is
   about to type into.

   "Empty" is read from what the index records, so it needs no read of the chat: still named "New chat", never
   renamed, no goal, no worktree, and not written to since it was made (a first message moves `updatedAt`).
   ══════════════════════════════════════════════════════════════════════════ */

import type { SessionIndexEntry } from '@sequence/api-types';

/** The name the engine gives a chat nobody has spoken in. */
export const UNTITLED = 'New chat';

type Entry = Pick<SessionIndexEntry, 'id' | 'title' | 'createdAt' | 'updatedAt'> & Partial<Pick<SessionIndexEntry, 'pinned' | 'titleEdited' | 'titleGenerated' | 'goal' | 'clonedFromId' | 'mode'>> & { agentThreads?: unknown; worktree?: unknown };

/** True for a chat made and never written to. */
export function isPristineChat(entry: Entry): boolean {
  return (
    entry.title.trim() === UNTITLED &&
    !entry.titleEdited &&
    !entry.titleGenerated &&
    !entry.pinned &&
    !entry.goal &&
    !entry.worktree &&
    !entry.clonedFromId &&
    !entry.agentThreads &&
    entry.createdAt !== '' &&
    entry.updatedAt === entry.createdAt
  );
}

/** The empty chat of this kind in the list, newest first, or null. Work and Code chats are different kinds (a missing mode is work). */
export function reusableEmptyChat(entries: readonly Entry[], mode: 'work' | 'code'): Entry | null {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.find((e) => (e.mode ?? 'work') === mode && isPristineChat(e)) ?? null;
}
