/* ══════════════════════════════════════════════════════════════════════════
   THE SIDEBAR'S PROJECTS (round 7, B5)
   packages/web2/src/shell2/projectList.ts

   Jaden: "It doesn't let you switch projects on the side rail... It should
   show all your projects, like in Codex." Every project the reader opened,
   the current one marked and first, each with its chats; the home workspace
   is a project too (B6: "The default workspace should be a project").

   READ, NOT INVENTED. The list is `GET /api/sessions`: `repos` is the
   recent-repos catalog (every attached folder, per tenant) plus the home
   workspace (`home: true`) when it is not the active root; `index` is the
   active root's own chats, already in the store. Nothing here asks the
   server anything new.
   ══════════════════════════════════════════════════════════════════════════ */

import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { byActivity, liveWorktree } from './sessionGroups';

export interface ProjectNode {
  /** Stable key: the folder, or `__workspace` for the home workspace while it is the active root. */
  key: string;
  /** The folder; null for the home workspace while it is the active root (its path is not in the answer). */
  path: string | null;
  name: string;
  home: boolean;
  current: boolean;
  /** Its chats, newest activity first; the current project's worktree chats are under Worktrees instead. */
  chats: SessionIndexEntry[];
  /** The catalog section a switch opens; null for the current project. */
  section: RepoSessionsSection | null;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** A project's chats, the one with the newest activity first (see `activityMs`). Pinned chats are shown apart, in the Pinned group. */
export function orderChats<E extends SessionIndexEntry>(rows: readonly E[], runAt?: (id: string) => number): E[] {
  return [...rows].sort(byActivity<E>(runAt));
}

/**
 * HOW MANY CHATS A PROJECT SHOWS (owner, 0.1.6: "over 10 chats, don't show it on the dropdown, that's a rule. Over 10
 * chats, specify the number. Otherwise forget about it."). A project with more than CHAT_CAP chats says how many it has
 * and lists the newest CHAT_CAP, with a quiet "Show all N" row that opens the rest in place. With CHAT_CAP or fewer there
 * is no count and every chat is shown. A search shows every match.
 */
export const CHAT_CAP = 10;

/** The count a project row wears: its number of chats when over the cap, else nothing. */
export function chatCountLabel(total: number): number | null {
  return total > CHAT_CAP ? total : null;
}

/** The chats a project draws, newest first: all of them when 10 or fewer, `expanded` or searched; else the first CHAT_CAP. */
export function capChats<E extends { id: string }>(rows: readonly E[], expanded: boolean, keepId: string | null = null): { shown: E[]; hidden: number } {
  if (expanded || rows.length <= CHAT_CAP) return { shown: [...rows], hidden: 0 };
  const shown = rows.slice(0, CHAT_CAP);
  /* The open chat is never hidden by the cap: when it is older than the newest ten it follows them. */
  const open = keepId ? rows.slice(CHAT_CAP).find((r) => r.id === keepId) : undefined;
  if (open) shown.push(open);
  return { shown, hidden: rows.length - shown.length };
}

/**
 * The Projects group: the current project first (marked), then every other
 * catalogued project in the catalog's own order, the home workspace last.
 * A folder listed twice (catalog spelling vs the attached root) is one row.
 */
export function buildProjects(input: {
  repoPath: string | null;
  repoName: string | null;
  sessions: readonly SessionIndexEntry[];
  repos: readonly RepoSessionsSection[];
  /** The newest agent run the page knows of per chat of the CURRENT project (run records are the open engine's only). */
  runAt?: (id: string) => number;
}): ProjectNode[] {
  const { repoPath, repoName, sessions, repos, runAt } = input;
  const currentHome = repoPath === null;
  const current: ProjectNode = {
    key: repoPath ? norm(repoPath) : '__workspace',
    path: repoPath,
    name: currentHome ? 'Workspace' : repoName?.trim() || baseName(repoPath),
    home: currentHome,
    current: true,
    chats: orderChats(sessions.filter((e) => !liveWorktree(e)), runAt),
    section: null,
  };
  const seen = new Set<string>([current.key]);
  const others: ProjectNode[] = [];
  let home: ProjectNode | null = null;
  for (const section of repos) {
    const key = norm(section.path);
    if (seen.has(key)) continue;
    if (currentHome && section.home) continue;
    seen.add(key);
    const node: ProjectNode = {
      key,
      path: section.path,
      name: section.home ? 'Workspace' : section.name?.trim() || baseName(section.path),
      home: Boolean(section.home),
      current: false,
      chats: orderChats(section.index.sessions),
      section,
    };
    if (node.home) home = node;
    else others.push(node);
  }
  return [current, ...others, ...(home ? [home] : [])];
}

/** The current project's worktree chats: the Worktrees group, as before. */
export function worktreeChats<E extends SessionIndexEntry>(sessions: readonly E[], runAt?: (id: string) => number): E[] {
  return orderChats(sessions.filter((e) => liveWorktree(e)), runAt);
}

/**
 * WORKSPACES KEEP THEIR PLACE. `buildProjects` puts the attached one first and
 * the catalog is most-recent-first, so every cross-workspace switch would
 * reshuffle the folders under the reader's pointer. The rail has no primary
 * workspace, so its order is the order the reader met them in: `saved` (the
 * keys already seen, persisted) first, then any new folder in the order
 * `buildProjects` gave. The home workspace is a folder like the rest, so it
 * keeps its place too (its key is `HOME_KEY` whether or not it is attached).
 *
 * THE WORKSPACE IS ALWAYS FIRST (owner, 0.1.6): the home workspace leads the list whatever order was saved and
 * wherever a drag put it; `moveWorkspace` below cannot put anything above it either.
 */
export const HOME_KEY = '__workspace';
export const workspaceKey = (p: ProjectNode): string => (p.home ? HOME_KEY : p.key);

export function orderWorkspaces(nodes: readonly ProjectNode[], saved: readonly string[]): ProjectNode[] {
  const rank = new Map(saved.map((k, i) => [k, i]));
  const known = nodes.filter((n) => rank.has(workspaceKey(n))).sort((a, b) => rank.get(workspaceKey(a))! - rank.get(workspaceKey(b))!);
  const fresh = nodes.filter((n) => !rank.has(workspaceKey(n)));
  const all = [...known, ...fresh];
  return [...all.filter((n) => n.home), ...all.filter((n) => !n.home)];
}

/**
 * `key` moved to sit where `before` sits (or last, when `before` is null), in `keys` as drawn. The home workspace
 * stays first: it is never moved, and nothing is dropped above it. A key not in `keys`, or a drop where it already
 * is, answers the same list.
 */
export function moveWorkspace(keys: readonly string[], key: string, before: string | null): string[] {
  if (key === HOME_KEY || !keys.includes(key) || before === key) return [...keys];
  const rest = keys.filter((k) => k !== key);
  let at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) at = rest.length;
  const home = rest.indexOf(HOME_KEY);
  if (home >= 0 && at <= home) at = home + 1;
  rest.splice(at, 0, key);
  return rest;
}
