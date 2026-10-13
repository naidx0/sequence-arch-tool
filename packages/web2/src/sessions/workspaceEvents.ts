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

/** The workspace key the run store partitions by. */
export const workspaceKeyOf = (root: string | null): string => root ?? 'home';
