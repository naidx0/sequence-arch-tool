/* WHO NEEDS TO LOOK AGAIN WHEN THE PAGE MOVES TO ANOTHER WORKSPACE (no reload).
   A page-held stream or cache that points at "the attached repository" registers here; sessions/workspaceSwitch.ts
   announces after the new workspace is on screen. No imports, so any module may register without a cycle. */

export interface WorkspaceTarget {
  /** The repo root, or null for the home workspace. */
  root: string | null;
  sessionId: string;
}

type Switched = (to: WorkspaceTarget) => void;
const switched = new Set<Switched>();

/** Register something page-held that points at the workspace. Returns the remover. */
export function onWorkspaceSwitched(fn: Switched): () => void {
  switched.add(fn);
  return () => switched.delete(fn);
}

export function announceWorkspaceSwitched(to: WorkspaceTarget): void {
  for (const fn of [...switched]) {
    try {
      fn(to);
    } catch {
      /* one listener failing must not stop the others */
    }
  }
}

/** The home workspace's key (the sidebar's `HOME_KEY` is this same string). */
export const HOME_WORKSPACE_KEY = '__workspace';

/**
 * A folder spelled one way, however it was given: separators forward, doubled and trailing slashes gone. Case is folded
 * ONLY for a Windows path (a drive letter or a UNC share: "C:\\Work\\App\\" and "c:/work/app" are one folder there).
 * A POSIX path keeps its case: on Linux "/srv/App" and "/srv/app" are two folders, and the engine's realpath does not fold
 * case on macOS either, so folding there would merge two workspaces' runs.
 */
export function normalizeWorkspacePath(p: string): string {
  const raw = p.trim();
  const s = raw.replace(/\\/g, '/').replace(/(.)\/{2,}/g, '$1/');
  const windows = /^[a-z]:([\\/]|$)/i.test(raw) || raw.startsWith('\\\\');
  const cased = windows ? s.toLowerCase() : s;
  const trimmed = cased.replace(/\/+$/, '');
  return trimmed === '' && s.startsWith('/') ? '/' : trimmed;
}

/** THE workspace key: the run store stamps and compares with it, and the sidebar looks a project's runs up with it. */
export const workspaceKeyOf = (root: string | null): string => (root === null || root.trim() === '' ? HOME_WORKSPACE_KEY : normalizeWorkspacePath(root));
