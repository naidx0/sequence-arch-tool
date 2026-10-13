import type { WireResult } from '../boot';

import { createGitClient, dirtyFiles, wireMessage } from './gitClient';
import type {
  BranchChangesResponse,
  GitBranchesResponse,
  GitServerEvent,
  GitSwitchRefusal,
  GitSwitchRequest,
  GitSwitchResponse,
} from './gitClient';
import { subscribeGitEvents } from './gitClient';

/* ══════════════════════════════════════════════════════════════════════════
   A THIN ADAPTER over the backend's gitClient.ts (which is taken verbatim)
   packages/web2/src/git/gitCalls.ts

   The UI asks four questions of a git call: did it answer, is the route not
   there (hide quietly), was it refused (say why), did it fail (say so). The
   backend client's WireResult has four outcomes of its own; this folds them
   into those four and shape-checks the bodies, because a static host answers
   unknown paths with 200 and index.html.
   ══════════════════════════════════════════════════════════════════════════ */

export type GitResult<T> =
  | { outcome: 'ok'; body: T }
  /** 404, or a 200 that is not the route's JSON: the engine has no such route. */
  | { outcome: 'missing' }
  | { outcome: 'refused'; status: number; message: string; refusal?: GitSwitchRefusal; dirty?: string[] }
  | { outcome: 'failed'; message: string };

type FetchLike = typeof fetch;
const live: FetchLike = (input, init) => fetch(input, init);

export function toGitResult<T>(result: WireResult<unknown>, check: (body: unknown) => body is T): GitResult<T> {
  if (result.outcome === 'unreachable') return { outcome: 'failed', message: result.message };
  if (result.outcome === 'not-json') return { outcome: 'missing' };
  if (result.outcome === 'error') {
    if (result.status === 404) return { outcome: 'missing' };
    const body = result.body as Partial<GitSwitchRefusal> | null;
    const refusal = body && typeof body === 'object' && body.ok === false ? (body as GitSwitchRefusal) : undefined;
    return {
      outcome: 'refused',
      status: result.status,
      message: wireMessage(result),
      ...(refusal ? { refusal } : {}),
      ...(dirtyFiles(result) ? { dirty: dirtyFiles(result)! } : {}),
    };
  }
  return check(result.body) ? { outcome: 'ok', body: result.body } : { outcome: 'missing' };
}

const isBranches = (b: unknown): b is GitBranchesResponse =>
  typeof b === 'object' && b !== null && Array.isArray((b as GitBranchesResponse).branches);
const isChanges = (b: unknown): b is BranchChangesResponse =>
  typeof b === 'object' && b !== null && Array.isArray((b as BranchChangesResponse).files);
const isSwitched = (b: unknown): b is GitSwitchResponse => typeof b === 'object' && b !== null && (b as GitSwitchResponse).ok === true;

export async function getBranches(fetchImpl: FetchLike = live, signal?: AbortSignal) {
  return toGitResult(await createGitClient(fetchImpl).branches(signal), isBranches);
}

export async function getBranchChanges(base?: string, fetchImpl: FetchLike = live, signal?: AbortSignal) {
  return toGitResult(await createGitClient(fetchImpl).branchChanges(base, signal), isChanges);
}

export async function switchBranch(request: GitSwitchRequest, fetchImpl: FetchLike = live) {
  return toGitResult(await createGitClient(fetchImpl).switchBranch(request), isSwitched);
}

/**
 * `subscribeGitEvents` that cannot throw: no EventSource (a test, an old
 * webview) or a stub that cannot take listeners simply never emits.
 */
export function subscribeGitEventsSafe(
  onEvent: (e: GitServerEvent) => void,
  makeSource?: Parameters<typeof subscribeGitEvents>[1],
): () => void {
  try {
    return subscribeGitEvents(onEvent, makeSource);
  } catch {
    return () => undefined;
  }
}
