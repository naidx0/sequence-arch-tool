/* ══════════════════════════════════════════════════════════════════════════
   S7 — AGENTS GROUPED BY WORKTREE (moved out of worktreeModel.ts)
   packages/web2/src/worktree/worktreeGroups.ts

   The Agents panel is on the boot path; this is all of the worktree logic it
   needs, so the rest of worktreeModel (the API client, merge-back, removal)
   loads only with the panels that use it. worktreeModel re-exports both.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChatWorktree } from './worktreeModel';

export interface RunLike {
  id: string;
  sessionId: string | null;
}

export interface SessionLike {
  id: string;
  worktree?: ChatWorktree | null;
}

export interface WorktreeGroup<R extends RunLike> {
  /** `main` for the user's own checkout, else the worktree id. */
  key: string;
  /** The branch to show: null for the main checkout. */
  branch: string | null;
  label: string;
  merged: boolean;
  runs: R[];
}

/**
 * Runs grouped by where they ran: the main checkout first, then one group per
 * worktree in the order its first run appears. A run whose chat is unknown or
 * unbound ran in the main checkout. Empty groups are not returned.
 */
export function groupRunsByWorktree<R extends RunLike>(runs: readonly R[], sessions: readonly SessionLike[]): WorktreeGroup<R>[] {
  const bySession = new Map(sessions.map((s) => [s.id, s.worktree ?? null]));
  const main: WorktreeGroup<R> = { key: 'main', branch: null, label: 'Main checkout', merged: false, runs: [] };
  const groups = new Map<string, WorktreeGroup<R>>();
  for (const run of runs) {
    const wt = run.sessionId ? bySession.get(run.sessionId) ?? null : null;
    if (!wt) {
      main.runs.push(run);
      continue;
    }
    let g = groups.get(wt.id);
    if (!g) {
      g = { key: wt.id, branch: wt.branch, label: branchLabel(wt.branch), merged: Boolean(wt.merged), runs: [] };
      groups.set(wt.id, g);
    }
    g.runs.push(run);
  }
  return [main, ...groups.values()].filter((g) => g.runs.length > 0);
}

/** `sequence/fix-login-3fa2` → `fix-login-3fa2`: the prefix is the same on every chat branch. */
export function branchLabel(branch: string): string {
  return branch.replace(/^sequence\//, '');
}
