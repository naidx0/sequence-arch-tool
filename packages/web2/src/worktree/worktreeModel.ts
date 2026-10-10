/* ══════════════════════════════════════════════════════════════════════════
   S7 — A CHAT IN ITS OWN WORKTREE: the web's logic, no DOM.
   packages/web2/src/worktree/worktreeModel.ts

   The server (analyzer chatWorktree.ts) owns the git. This module owns what
   the page says about it:
     - the API client for /api/sessions/:id/worktree… and /api/worktree-settings;
     - grouping agent runs by worktree for the Agents tree;
     - the merge-back decision: what the Merge button may do after a dry run,
       and the one line it says when it may not;
     - the removal dialog's text, which must name every unmerged commit
       before the server will delete a branch that holds them.
   Plain copy throughout, no exclamation, no hedging.
   ══════════════════════════════════════════════════════════════════════════ */

/** What a chat's session index entry carries (analyzer ChatWorktreeRef). */
export interface ChatWorktree {
  id: string;
  path: string;
  branch: string;
  baseCommit: string;
  baseBranch: string | null;
  createdAt: string;
  merged?: { at: string; mode: MergeMode; into: string; commit: string };
  /** The worktree was removed; the chat keeps its transcript, not its Rewind history. */
  removedAt?: string;
}

export type MergeMode = 'merge' | 'squash';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface DryRun {
  ok: true;
  target: string;
  targetHead: string;
  files: ChangedFile[];
  conflicts: string[];
  worktreeDirty: boolean;
  mainUncommitted: string[];
  method: 'merge-tree' | 'throwaway-worktree';
}

export interface UnmergedCommit {
  sha: string;
  subject: string;
}

export interface WorktreeSettings {
  cap: number;
  setupCommand: string | null;
  /** From the repo's lockfile; shown as a placeholder, never run. */
  suggestion?: string | null;
}

/* ─────────────────────────── client ─────────────────────────── */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Answer<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

async function call<T>(f: Fetch, url: string, method = 'GET', body?: unknown): Promise<Answer<T>> {
  const res = await f(url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  let parsed: unknown = {};
  try {
    parsed = await res.json();
  } catch {
    parsed = { error: `The server answered ${res.status}.` };
  }
  return { ok: res.ok, status: res.status, body: parsed as T & { error?: string } };
}

const at = (sessionId: string, part = ''): string => `/api/sessions/${encodeURIComponent(sessionId)}/worktree${part}`;

export const worktreeApi = {
  get: (sessionId: string, f: Fetch = fetch) => call<{ worktree: ChatWorktree | null }>(f, at(sessionId)),
  create: (sessionId: string, f: Fetch = fetch) => call<{ worktree: ChatWorktree; setupCommand: string | null }>(f, at(sessionId), 'POST'),
  changes: (sessionId: string, f: Fetch = fetch) => call<{ worktree: ChatWorktree; files: ChangedFile[]; dirty: boolean }>(f, at(sessionId, '/changes')),
  diff: (sessionId: string, path?: string, f: Fetch = fetch) =>
    call<{ diff: string }>(f, at(sessionId, `/diff${path ? `?path=${encodeURIComponent(path)}` : ''}`)),
  dryRun: (sessionId: string, f: Fetch = fetch) => call<DryRun>(f, at(sessionId, '/dry-run'), 'POST'),
  merge: (sessionId: string, mode: MergeMode, f: Fetch = fetch) =>
    call<{ mode: MergeMode; into: string; commit: string; files: ChangedFile[]; conflicts?: string[]; uncommitted?: string[] }>(f, at(sessionId, '/merge'), 'POST', { mode }),
  remove: (sessionId: string, confirmUnmerged: readonly string[] = [], f: Fetch = fetch) =>
    call<{ unmerged?: UnmergedCommit[]; deletedBranch?: string }>(f, at(sessionId), 'DELETE', { confirmUnmerged }),
  settings: (f: Fetch = fetch) => call<WorktreeSettings>(f, '/api/worktree-settings'),
  saveSettings: (patch: Partial<Pick<WorktreeSettings, 'cap' | 'setupCommand'>>, f: Fetch = fetch) =>
    call<WorktreeSettings>(f, '/api/worktree-settings', 'PUT', patch),
};

/* ─────────────────────────── Agents tree ─────────────────────────── */
/* In worktreeGroups.ts (the Agents panel's boot-path half); re-exported. */

import { branchLabel } from './worktreeGroups';
export { branchLabel, groupRunsByWorktree, type RunLike, type SessionLike, type WorktreeGroup } from './worktreeGroups';

/* ─────────────────────────── merge-back ─────────────────────────── */

export type MergeVerdict =
  | { can: true; summary: string; files: ChangedFile[] }
  | { can: false; reason: 'uncommitted' | 'conflicts' | 'nothing'; line: string; files: ChangedFile[]; conflicts: string[] };

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * What the Merge button may do after a dry run. The server refuses the same
 * cases; this is so the button says why before anyone presses it.
 */
export function mergeVerdict(dry: DryRun): MergeVerdict {
  if (dry.mainUncommitted.length) {
    return {
      can: false,
      reason: 'uncommitted',
      line: `Your checkout has ${plural(dry.mainUncommitted.length, 'uncommitted change')}. Commit or stash them, then merge.`,
      files: dry.files,
      conflicts: [],
    };
  }
  if (dry.conflicts.length) {
    return {
      can: false,
      reason: 'conflicts',
      line: `Merging into ${dry.target} would conflict in ${plural(dry.conflicts.length, 'file')}. Nothing was changed.`,
      files: dry.files,
      conflicts: dry.conflicts,
    };
  }
  if (!dry.files.length) {
    return { can: false, reason: 'nothing', line: 'This chat changed no files.', files: [], conflicts: [] };
  }
  return { can: true, summary: `${plural(dry.files.length, 'file')} into ${dry.target}`, files: dry.files };
}

/* ─────────────────────────── removal ─────────────────────────── */

/** Every remove-confirm says this: the worktree's Rewind history is removed with it. */
export const REWIND_GOES = 'This also removes its Rewind history.';

/** Why Revert is off for a chat whose worktree was removed (the Rewind panel). */
export const WORKTREE_REMOVED = 'Worktree removed';

/** The confirm shown for an ordinary removal (nothing unmerged). */
export function removeConfirm(branch: string): { title: string; body: string; confirmLabel: string } {
  return { title: 'Remove worktree', body: `Removes the worktree for ${branchLabel(branch)}. The chat keeps its messages. ${REWIND_GOES}`, confirmLabel: 'Remove worktree' };
}

export interface RemovalDialog {
  title: string;
  body: string;
  /** Every commit the branch holds that the user's branch does not, named. */
  commits: UnmergedCommit[];
  confirmLabel: string;
  /** What to send as `confirmUnmerged` when the user confirms. */
  confirm: string[];
}

/**
 * The dialog shown when removal was refused for unmerged commits. It names
 * every one; the server deletes the branch only when all of them are sent
 * back, so a dialog that dropped one could not confirm anything.
 */
export function removalDialog(branch: string, unmerged: readonly UnmergedCommit[]): RemovalDialog {
  const n = unmerged.length;
  return {
    title: 'Delete unmerged work',
    body: `${branchLabel(branch)} has ${plural(n, 'commit')} that your branch does not. Deleting the worktree deletes ${n === 1 ? 'it' : 'them'}. ${REWIND_GOES}`,
    commits: [...unmerged],
    confirmLabel: n === 1 ? 'Delete 1 commit' : `Delete ${n} commits`,
    confirm: unmerged.map((c) => c.sha),
  };
}
