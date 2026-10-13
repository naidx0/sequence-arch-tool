import type { WireResult } from '../boot';
import { request, wireMessage } from '../review/reviewClient';

/* ══════════════════════════════════════════════════════════════════════════
   BRANCH WORKFLOW TRANSPORT (no UI)
   packages/web2/src/git/gitClient.ts

   Typed helpers for the routes in packages/analyzer/src/server/gitBranchRoutes.ts
   and the `git:head` / `graph:updated` server events. Same four-outcome
   `WireResult` ladder and same-origin rule as the review client, which it
   reuses rather than re-declaring.
   ══════════════════════════════════════════════════════════════════════════ */

export interface BranchCommit {
  sha: string;
  subject: string;
  /** ISO 8601 committer date. */
  date: string;
}

export interface BranchInfo {
  name: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** What ahead/behind count against: the upstream, else the default branch. */
  against?: string;
  lastCommit: BranchCommit;
}

export interface RemoteBranchInfo {
  /** `origin/feature`. */
  name: string;
  remote: true;
  lastCommit: BranchCommit;
}

/** GET /api/git/branches */
export interface GitBranchesResponse {
  /** null when HEAD is detached or unborn. */
  current: string | null;
  detached: boolean;
  sha: string | null;
  branches: BranchInfo[];
  /** Remote branches with no local branch of the same name. */
  remoteBranches: RemoteBranchInfo[];
  /** Files `git status` reports (staged, unstaged or untracked), excluding `.sequence/`. */
  dirty: number;
}

/** POST /api/git/switch body. `from` is only valid with `create`. */
export interface GitSwitchRequest {
  branch: string;
  create?: boolean;
  from?: string;
}

/** POST /api/git/switch, 200. `rescan` is true when the architecture board is being rescanned. */
export interface GitSwitchResponse {
  ok: true;
  branch: string;
  sha: string | null;
  created: boolean;
  /** False when the requested branch was already checked out. */
  changed: boolean;
  previous: string | null;
  rescan: boolean;
}

/** POST /api/git/switch, non-200 bodies. `dirty` is 409 with `files`; nothing was changed. */
export interface GitSwitchRefusal {
  ok: false;
  reason: 'dirty' | 'invalid' | 'exists' | 'not-found' | 'git';
  error: string;
  /** Files git says the switch would overwrite (reason `dirty`). */
  files?: string[];
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R';

export interface FileChange {
  status: ChangeStatus;
  added: number;
  removed: number;
  binary?: true;
}

export interface BranchChangeFile {
  path: string;
  /** Source path when status is R. */
  oldPath?: string;
  /** merge-base -> working tree. Untracked files are A with 0/0 counts. */
  status: ChangeStatus;
  added: number;
  removed: number;
  binary?: true;
  /** merge-base -> HEAD. */
  committed?: FileChange;
  /** HEAD -> index. */
  staged?: FileChange;
  /** index -> working tree. */
  unstaged?: FileChange;
  untracked?: true;
}

/** GET /api/git/branch-changes?base= */
export interface BranchChangesResponse {
  branch: string | null;
  base: string | null;
  mergeBase: string | null;
  head: string | null;
  noBase?: true;
  files: BranchChangeFile[];
}

/** GET /api/git/diff?scope= . `worktree` is `git diff HEAD` (staged + unstaged together). */
export type GitDiffScopeParam =
  | { kind: 'worktree' | 'staged' | 'unstaged' }
  | { kind: 'branch'; base?: string }
  | { kind: 'commit'; rev: string };

/** SSE `event: git:head` */
export interface GitHeadEvent {
  type: 'git:head';
  branch: string | null;
  sha: string | null;
  detached: boolean;
  previous: { branch: string | null; sha: string | null };
  /** True when a branch change started an architecture rescan (a plain commit does not). */
  rescan: boolean;
}

/** SSE `event: graph:updated`: the rescan a `git:head` started has landed; re-read /archgraph.json. */
export interface GraphUpdatedEvent {
  type: 'graph:updated';
  reason: 'git:head';
  branch: string | null;
  sha: string | null;
  scannedAt?: string;
}

export type GitServerEvent = GitHeadEvent | GraphUpdatedEvent;

export const GIT_BRANCH_ROUTES = [
  '/api/git/branches',
  '/api/git/switch',
  '/api/git/branch-changes',
  '/api/git/diff',
  '/api/git/events',
] as const;

export interface GitClient {
  branches(signal?: AbortSignal): Promise<WireResult<GitBranchesResponse>>;
  /** Refusals arrive as `outcome: 'error'` with a {@link GitSwitchRefusal} body. */
  switchBranch(req: GitSwitchRequest, signal?: AbortSignal): Promise<WireResult<GitSwitchResponse>>;
  /** `base` defaults server-side to origin/HEAD, else main, else master. */
  branchChanges(base?: string, signal?: AbortSignal): Promise<WireResult<BranchChangesResponse>>;
  diff(path: string, scope: GitDiffScopeParam, signal?: AbortSignal): Promise<WireResult<{ path: string; diff: string }>>;
}

export function diffQuery(path: string, scope: GitDiffScopeParam): string {
  const q = new URLSearchParams({ path, scope: scope.kind });
  if (scope.kind === 'branch' && scope.base) q.set('base', scope.base);
  if (scope.kind === 'commit') q.set('rev', scope.rev);
  return q.toString();
}

export function createGitClient(fetchImpl: typeof fetch = globalThis.fetch): GitClient {
  return {
    branches: (signal) => request<GitBranchesResponse>(fetchImpl, '/api/git/branches', { method: 'GET', signal }),
    switchBranch: (req, signal) =>
      request<GitSwitchResponse>(fetchImpl, '/api/git/switch', { method: 'POST', body: req, signal }),
    branchChanges: (base, signal) =>
      request<BranchChangesResponse>(
        fetchImpl,
        base ? `/api/git/branch-changes?${new URLSearchParams({ base }).toString()}` : '/api/git/branch-changes',
        { method: 'GET', signal },
      ),
    diff: (path, scope, signal) =>
      request<{ path: string; diff: string }>(fetchImpl, `/api/git/diff?${diffQuery(path, scope)}`, { method: 'GET', signal }),
  };
}

/** A dirty-switch refusal, narrowed out of a failed switch result; null for any other outcome. */
export function dirtyFiles(result: WireResult<unknown>): string[] | null {
  if (result.outcome !== 'error' || result.status !== 409) return null;
  const body = result.body as Partial<GitSwitchRefusal> | null;
  return body?.reason === 'dirty' ? (body.files ?? []) : null;
}

export { wireMessage };

export interface EventSourceLike {
  addEventListener(type: string, listener: (e: { data: string }) => void): void;
  close(): void;
}

/**
 * Subscribe to `GET /api/git/events`. Calls `onEvent` for each `git:head` and
 * `graph:updated`; ignores frames that do not parse. Returns an unsubscribe.
 */
export function subscribeGitEvents(
  onEvent: (e: GitServerEvent) => void,
  makeSource: (url: string) => EventSourceLike = (u) => new EventSource(u) as unknown as EventSourceLike,
): () => void {
  const source = makeSource('/api/git/events');
  const handle = (e: { data: string }): void => {
    try {
      const parsed = JSON.parse(e.data) as GitServerEvent;
      if (parsed && (parsed.type === 'git:head' || parsed.type === 'graph:updated')) onEvent(parsed);
    } catch {
      /* a malformed frame is not an event */
    }
  };
  source.addEventListener('git:head', handle);
  source.addEventListener('graph:updated', handle);
  return () => source.close();
}
