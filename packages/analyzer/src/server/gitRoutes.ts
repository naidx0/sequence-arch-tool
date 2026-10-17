/**
 * Git read/write routes, moved out of repoServer.ts unchanged (the branch routes live in gitBranchRoutes.ts):
 *
 *   GET  /api/git/events                  SSE: `git:head` and `graph:updated`
 *   GET  /api/git/revisions               what a reviewer can name
 *   GET  /api/git/branch-files, /churn    read-only history for the board's Diff and Hotspots views
 *   GET  /api/git/status, /diff           the Changes pane
 *   POST /api/git/discard, /commit        write the working tree / history (pre-commit hooks run first)
 *   POST /api/git/branch                  create a branch
 *   GET  /api/git/worktrees               list worktrees
 *   POST|DELETE /api/git/worktree         create / remove one
 *
 * Auth, owner and attached-repo checks stay in repoServer and arrive as callbacks; live state arrives as
 * getters or hub objects. Nothing here closes over createRepoServer state.
 */

import http from 'node:http';
import { type ArchGraph } from '@sequence/schema';
import type { Unvalidated, GetGitStatusResponse, PostGitCommitRequest, PostGitCommitResponse, PostGitBranchRequest, PostGitBranchResponse, GetGitWorktreesResponse, PostGitWorktreeRequest, PostGitWorktreeResponse, DeleteGitWorktreeResponse } from '@sequence/api-types';
import type { GitDiffScope } from './gitWorkspace.js';
import { GitHistoryError, branchFiles, churn } from './gitHistory.js';
import { isTrusted, runHooks } from './hooks.js';
import type { GitEventHub } from './gitBranchRoutes.js';
import { readHookFile, readHookTrust } from './store.js';
import { gitStatus, gitDiff, gitRevisions, gitCommit, gitDiscard, gitCreateBranch, gitHandoffWorktree, gitListWorktrees, gitRemoveWorktree, GitWorkspaceError } from './gitWorkspace.js';
import { MAX_BODY_BYTES, sendJson, sendError, isJsonRequest, readBody } from './routeHttp.js';

const GIT_ROUTE_PATHS = new Set([
  '/api/git/events',
  '/api/git/revisions',
  '/api/git/branch-files',
  '/api/git/churn',
  '/api/git/status',
  '/api/git/diff',
  '/api/git/discard',
  '/api/git/commit',
  '/api/git/branch',
  '/api/git/worktrees',
  '/api/git/worktree',
]);

export interface GitRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  requireRepo: (res: http.ServerResponse) => boolean;
  requireOwner: () => boolean;
  activeRoot: () => string;
  /** The attached repo root, or null when none is attached. */
  getRoot: () => string | null;
  /** The current scanned graph, or null before the first scan. */
  getGraph: () => ArchGraph | null;
  gitEvents: GitEventHub;
  authOn: boolean;
  /** The signed-in user id under hosted auth (undefined locally). */
  sessionId: string | undefined;
  userConfigDir: string;
  markGraphStale: (relPath: string) => void;
}

export function isGitRoutePath(pathname: string): boolean {
  return GIT_ROUTE_PATHS.has(pathname);
}

/** Handle the git read and write routes. Returns false when the request is not one of ours. */
export async function handleGitRoute(ctx: GitRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { requireRepo, requireOwner, activeRoot, gitEvents, authOn, sessionId, userConfigDir, markGraphStale } = ctx;
  const { getRoot, getGraph } = ctx;
  // ---- GET /api/git/revisions — what a reviewer can NAME ----
  // `?scope=commit&rev=` and `?scope=branch&base=` exist and the pane could
  // not use either, because it had no way to name a revision or a base. This
  // is the list it picks from. Read-only, and it takes no revision from the
  // caller — the only input is a bounded count, so there is nothing to inject.
  /* ---- GET /api/git/branch-files?base=<ref>, GET /api/git/churn?days=<n> ----
     Read-only history for the board's Diff and Hotspots views
     (gitHistory.ts): the files this branch changes against the merge base
     with <ref>, and commits per file in the <n> days before HEAD's date. */
  if ((pathname === '/api/git/branch-files' || pathname === '/api/git/churn') && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    try {
      if (pathname === '/api/git/branch-files') {
        sendJson(res, 200, await branchFiles(activeRoot(), url.searchParams.get('base') ?? 'main'));
      } else {
        sendJson(res, 200, await churn(activeRoot(), Number(url.searchParams.get('days') ?? '90')));
      }
    } catch (e) {
      if (e instanceof GitHistoryError) sendError(res, e.status, e.message);
      else sendError(res, 500, (e as Error).message);
    }
    return true;
  }

  if (pathname === '/api/git/revisions' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const raw = Number(url.searchParams.get('limit') ?? '20');
    try {
      sendJson(res, 200, await gitRevisions(activeRoot(), Number.isFinite(raw) ? raw : 20));
    } catch (e) {
      if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
      else sendError(res, 500, (e as Error).message);
    }
    return true;
  }

  // ==================== Wave 3a: Index Changes git APIs ====================
  // GET /api/git/status  → { branch, files: [{ path, status }] }
  // GET /api/git/diff?path=<rel> → { path, diff }
  // POST /api/git/commit { message, paths?: string[] } → { ok, commit? }
  // All three are repo-scoped (requireRepo + owner check) and jail every
  // caller-supplied path through resolveInRepo via gitWorkspace. No ambient
  // shell — only `git` child_processes with cwd=repoRoot.

  if (pathname === '/api/git/events' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    gitEvents.attach(req, res, authOn ? sessionId : null);
    return true;
  }

  if (pathname === '/api/git/status' && method === 'GET') {
    /* Nothing attached yet (first run) is "no git here", not a 409 the console logs. */
    if (getRoot() === null || getGraph() === null) {
      const none: GetGitStatusResponse = { branch: '', files: [], notGit: true };
      sendJson(res, 200, none);
      return true;
    }
    if (requireOwner()) return true;
    try {
      const result: GetGitStatusResponse = await gitStatus(activeRoot());
      sendJson(res, 200, result);
    } catch (e) {
      sendError(res, 500, (e as Error).message);
    }
    return true;
  }

  if (pathname === '/api/git/diff' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const rel = url.searchParams.get('path') ?? '';
    if (rel === '') {
      sendError(res, 400, 'query parameter "path" is required');
      return true;
    }
    /*
     * WHAT THE DIFF IS AGAINST. This route took `?path` and nothing else, so
     * the review pane could serve two of its five scopes and rendered the
     * other three as unavailable with a note naming the missing route. These
     * are those routes.
     *
     * An UNKNOWN scope is a 400, never a silent fall back to the working
     * tree: answering a question the caller did not ask, with a diff that
     * looks right, is worse than refusing.
     */
    const scopeParam = url.searchParams.get('scope') ?? 'worktree';
    let scope: GitDiffScope;
    if (scopeParam === 'worktree' || scopeParam === 'staged' || scopeParam === 'unstaged') {
      scope = { kind: scopeParam };
    } else if (scopeParam === 'commit') {
      const rev = url.searchParams.get('rev') ?? '';
      if (rev === '') {
        sendError(res, 400, 'scope "commit" requires the query parameter "rev"');
        return true;
      }
      scope = { kind: 'commit', rev };
    } else if (scopeParam === 'branch') {
      /* `base` is optional: absent means the repo's default branch. */
      const base = url.searchParams.get('base') ?? '';
      scope = base === '' ? { kind: 'branch' } : { kind: 'branch', base };
    } else {
      sendError(
        res,
        400,
        `unknown scope ${JSON.stringify(scopeParam)} — expected worktree, staged, unstaged, commit or branch`,
      );
      return true;
    }

    try {
      const result = await gitDiff(activeRoot(), rel, scope);
      sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof GitWorkspaceError) {
        sendError(res, e.status, e.message);
      } else {
        sendError(res, 500, (e as Error).message);
      }
    }
    return true;
  }

  // ---- POST /api/git/discard { paths: string[] } ----
  if (pathname === '/api/git/discard' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch {
      sendError(res, 400, 'invalid JSON');
      return true;
    }
    const paths = (raw as { paths?: unknown }).paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      /*
       * NEVER "EVERYTHING". This is the one genuinely destructive operation
       * in the product — the content is not in the index, not in a commit,
       * and not recoverable by git once it is gone. An empty list is a
       * caller that lost its argument, and guessing here would guess
       * destructively.
       */
      sendError(res, 400, 'paths required; discard never applies to the whole tree');
      return true;
    }

    const result = await gitDiscard(activeRoot(), paths as string[]);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'discard failed');
      return true;
    }

    /*
     * THE GRAPH IS NOW OUT OF DATE, exactly as after an accepted edit.
     * Discarding restores files from HEAD, so every claim the board makes is
     * grounded in content that may no longer say what the citation says —
     * and `markGraphStale` NAMES the paths rather than setting a bare
     * boolean, which is what lets the surfaces say which claims moved.
     */
    for (const p of result.discarded ?? []) markGraphStale(p);
    sendJson(res, 200, { ok: true, discarded: result.discarded ?? [] });
    return true;
  }

  if (pathname === '/api/git/commit' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: Unvalidated<PostGitCommitRequest>;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const message = body.message;
    const paths = body.paths;
    if (typeof message !== 'string') {
      sendError(res, 400, 'body must include a string "message"');
      return true;
    }
    if (paths !== undefined && !Array.isArray(paths)) {
      sendError(res, 400, '"paths" must be an array of strings when present');
      return true;
    }
    const pathList = Array.isArray(paths) ? (paths as unknown[]) : undefined;
    if (pathList !== undefined && !pathList.every((p) => typeof p === 'string')) {
      sendError(res, 400, 'every entry in "paths" must be a string');
      return true;
    }
    /*
     * ══ pre-commit HOOK — where a project's own gate lives ═══════════════
     *
     * CANON reports this repository's three gates as "enforced by prose". A
     * commit is the moment a rule most wants to speak, and a `pre-commit`
     * hook exiting 2 stops it with its own stderr as the reason.
     *
     * Same posture as `pre-write`: it runs only if the USER trusted this repo
     * in user-level config the repo cannot write. A commit hook that ran
     * unasked would be a stranger's code executing the first time you looked
     * at their project.
     */
    const commitHook = await runHooks('pre-commit', {
      repoRoot: activeRoot(),
      file: readHookFile(activeRoot()),
      trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
      payload: { message, paths: pathList ?? null },
    });
    if (!commitHook.allowed) {
      const blocked = commitHook.outcomes.find((o) => o.kind === 'blocked');
      sendError(
        res,
        403,
        `blocked by a pre-commit hook (${blocked?.command ?? 'hook'}): ${
          blocked && 'reason' in blocked ? blocked.reason : 'no reason given'
        }`,
      );
      return true;
    }

    const result = await gitCommit(activeRoot(), message, pathList as string[] | undefined);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'commit failed');
      return true;
    }
    const committed: PostGitCommitResponse = {
      ok: true,
      ...(result.commit ? { commit: result.commit } : {}),
    };
    sendJson(res, 200, committed);
    return true;
  }

  /* ================== P12 — branch + worktree handoff ==================
   *
   * `gitWorkspace.ts` exported three functions and none of them created a
   * ref, so every branching decision left the app. These four routes are the
   * app doing the git: create a branch without moving the attached checkout,
   * hand a branch off to a second working tree beside the repo, list what
   * git knows, and remove a tree this server handed off.
   *
   * NO INBOUND FILESYSTEM PATH except the removal `?path=`, and that one is
   * gated twice (inside this repo's derived worktrees root, AND present in
   * git's own `worktree list`) before anything is deleted. `GitBranchResult`
   * and friends carry their own honest HTTP status, so a refusal reaches the
   * client as the reason git gave, never as a generic 500.
   */

  if (pathname === '/api/git/branch' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: Unvalidated<PostGitBranchRequest>;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (typeof body.name !== 'string') {
      sendError(res, 400, 'body must include a string "name"');
      return true;
    }
    if (body.from !== undefined && typeof body.from !== 'string') {
      sendError(res, 400, '"from" must be a string when present');
      return true;
    }
    const made = await gitCreateBranch(activeRoot(), body.name, {
      ...(body.from !== undefined ? { from: body.from } : {}),
    });
    if (!made.ok || !made.branch) {
      sendError(res, made.status ?? 500, made.error ?? 'branch creation failed');
      return true;
    }
    const branched: PostGitBranchResponse = {
      ok: true,
      branch: made.branch,
      ...(made.head ? { head: made.head } : {}),
    };
    sendJson(res, 200, branched);
    return true;
  }

  if (pathname === '/api/git/worktrees' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    try {
      const worktrees: GetGitWorktreesResponse = { worktrees: await gitListWorktrees(activeRoot()) };
      sendJson(res, 200, worktrees);
    } catch (e) {
      if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
      else sendError(res, 500, (e as Error).message);
    }
    return true;
  }

  if (pathname === '/api/git/worktree' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: Unvalidated<PostGitWorktreeRequest>;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (typeof body.branch !== 'string') {
      sendError(res, 400, 'body must include a string "branch"');
      return true;
    }
    if (body.from !== undefined && typeof body.from !== 'string') {
      sendError(res, 400, '"from" must be a string when present');
      return true;
    }
    const handoff = await gitHandoffWorktree(activeRoot(), body.branch, {
      ...(body.from !== undefined ? { from: body.from } : {}),
    });
    if (!handoff.ok || !handoff.path || !handoff.branch) {
      sendError(res, handoff.status ?? 500, handoff.error ?? 'worktree handoff failed');
      return true;
    }
    const handed: PostGitWorktreeResponse = {
      ok: true,
      branch: handoff.branch,
      path: handoff.path,
      createdBranch: handoff.createdBranch === true,
    };
    sendJson(res, 200, handed);
    return true;
  }

  if (pathname === '/api/git/worktree' && method === 'DELETE') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const target = url.searchParams.get('path') ?? '';
    if (target === '') {
      sendError(res, 400, 'query parameter "path" is required');
      return true;
    }
    const force = url.searchParams.get('force') === '1';
    try {
      const removed = await gitRemoveWorktree(activeRoot(), target, { force });
      if (!removed.ok || !removed.path) {
        sendError(res, removed.status ?? 500, removed.error ?? 'worktree removal failed');
        return true;
      }
      const gone: DeleteGitWorktreeResponse = { ok: true, path: removed.path };
      sendJson(res, 200, gone);
    } catch (e) {
      if (e instanceof GitWorkspaceError) sendError(res, e.status, e.message);
      else sendError(res, 500, (e as Error).message);
    }
    return true;
  }

  return false;
}
