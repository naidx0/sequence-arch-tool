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

import { liveWorktree } from './sessionGroups';

export interface ProjectNode {
  /** Stable key: the folder, or `__workspace` for the home workspace while it is the active root. */
  key: string;
  /** The folder; null for the home workspace while it is the active root (its path is not in the answer). */
  path: string | null;
  name: string;
  home: boolean;
  current: boolean;
  /** Its chats, newest first, pinned leading; the current project's worktree chats are under Worktrees instead. */
  chats: SessionIndexEntry[];
  /** The catalog section a switch opens; null for the current project. */
  section: RepoSessionsSection | null;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function orderChats<E extends SessionIndexEntry>(rows: readonly E[]): E[] {
  return [...rows].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.id.localeCompare(b.id),
  );
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
}): ProjectNode[] {
  const { repoPath, repoName, sessions, repos } = input;
  const currentHome = repoPath === null;
  const current: ProjectNode = {
    key: repoPath ? norm(repoPath) : '__workspace',
    path: repoPath,
    name: currentHome ? 'Workspace' : repoName?.trim() || baseName(repoPath),
    home: currentHome,
    current: true,
    chats: orderChats(sessions.filter((e) => !liveWorktree(e))),
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
export function worktreeChats<E extends SessionIndexEntry>(sessions: readonly E[]): E[] {
  return orderChats(sessions.filter((e) => liveWorktree(e)));
}

/**
 * WORKSPACES KEEP THEIR PLACE. `buildProjects` puts the attached one first and
 * the catalog is most-recent-first, so every cross-workspace switch would
 * reshuffle the folders under the reader's pointer. The rail has no primary
 * workspace, so its order is the order the reader met them in: `saved` (the
 * keys already seen, persisted) first, then any new folder in the order
 * `buildProjects` gave. The home workspace is a folder like the rest, so it
 * keeps its place too (its key is `HOME_KEY` whether or not it is attached).
 */
export const HOME_KEY = '__workspace';
export const workspaceKey = (p: ProjectNode): string => (p.home ? HOME_KEY : p.key);

export function orderWorkspaces(nodes: readonly ProjectNode[], saved: readonly string[]): ProjectNode[] {
  const rank = new Map(saved.map((k, i) => [k, i]));
  const known = nodes.filter((n) => rank.has(workspaceKey(n))).sort((a, b) => rank.get(workspaceKey(a))! - rank.get(workspaceKey(b))!);
  const fresh = nodes.filter((n) => !rank.has(workspaceKey(n)));
  return [...known, ...fresh];
}
