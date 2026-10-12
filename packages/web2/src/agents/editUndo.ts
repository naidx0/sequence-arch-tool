/* ══════════════════════════════════════════════════════════════════════════
   THE LAST EDIT, KEPT UNTIL THE NEXT SEND
   packages/web2/src/agents/editUndo.ts

   "Edit from here" removes runs from the page and the server keeps them (a
   backup file) until the next message is sent. This holds what the page needs
   to put them back: the removed runs, the text the composer had before, and
   the message that went into it.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun } from './agentRuns';

export interface EditUndo {
  sessionId: string;
  removed: AgentRun[];
  /** What went into the composer. */
  prompt: string;
  /** What the composer held before (an unsent draft the person agreed to replace). */
  prevDraft: string;
  /** The files were also put back; undo does not undo that. */
  filesReverted: number;
  at: number;
}

let current: EditUndo | null = null;
const listeners = new Set<() => void>();

export const editUndo = {
  get: (): EditUndo | null => current,
  set(u: EditUndo | null): void {
    current = u;
    for (const l of [...listeners]) l();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
