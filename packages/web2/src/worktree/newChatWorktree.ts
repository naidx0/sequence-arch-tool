/* ══════════════════════════════════════════════════════════════════════════
   S7 — NEW CHAT IN ITS OWN WORKTREE (loaded when New Chat runs with the
   "In a worktree" box on; v3/V3SessionsRail.tsx)
   packages/web2/src/worktree/newChatWorktree.ts

   Makes the chat's worktree, puts the binding on the chat's session index
   entry (written before the worktree existed; the chat header's chip reads it
   there), and answers the rail's status line: the server's error, or the
   setup command to run (shown, never run), or nothing.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Store } from '../state';
import { worktreeApi } from './worktreeModel';

export type WorktreeNote = { kind: 'error' | 'setup'; text: string } | null;

export async function startChatWorktree(store: Store, sessionId: string): Promise<WorktreeNote> {
  const r = await worktreeApi.create(sessionId).catch((e: unknown) => ({ ok: false, status: 0, body: { error: `The worktree was not made: ${e instanceof Error ? e.message : String(e)}` } }) as Awaited<ReturnType<typeof worktreeApi.create>>);
  if (!r.ok) return { kind: 'error', text: r.body.error ?? `The worktree was not made (${r.status}).` };
  if (r.body.worktree) {
    const now = store.getState().session;
    store.dispatch({ type: 'session/index', sessions: now.sessions.map((e) => (e.id === sessionId ? { ...e, worktree: r.body.worktree } : e)), activeId: now.activeId });
  }
  return r.body.setupCommand ? { kind: 'setup', text: `Run \`${r.body.setupCommand}\` in the worktree to install dependencies.` } : null;
}
