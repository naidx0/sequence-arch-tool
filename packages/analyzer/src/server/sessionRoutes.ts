/**
 * Session routes, moved out of repoServer.ts unchanged:
 *
 *   POST /api/sessions/move                     file a chat under a different project
 *   GET|POST /api/sessions                      the index and a new chat
 *   GET  /api/sessions/search, PUT /api/sessions/active
 *   /api/sessions/:id/{worktree,pr,fanout,rewind,goal-run}   sub-resources, matched BEFORE the :id block
 *   /api/fanout[/:id[/choose|discard-others]]   best-of-N (fanoutRoutes.ts)
 *   GET|PUT|DELETE /api/sessions/:id            one chat
 *   POST /api/goal-tick                         an agent's `goal` tool ticks its run's plan
 *   GET|PUT /api/chat-memory, /api/canvas-doc   compat shims onto the active session
 *
 * `/api/goal-tick` sat between the goal-run comment and its block in repoServer.ts; its path is exact and
 * distinct, so it keeps its place in the sequence here and its behaviour is unchanged.
 *
 * Auth, owner and root checks arrive as callbacks; live state arrives as getters or hub objects.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { type ArchGraph } from '@sequence/schema';
import type { PlanStep } from '@sequence/api-types';
import { isOriginAllowed } from './terminal.js';
import { PR_ROUTE, handlePrRoute } from './prRoutes.js';
import { FANOUT_ROUTE, handleFanoutRoute } from './fanoutRoutes.js';
import { rewindChat, undoRewind } from './agentRewind.js';
import { createChatWorktree, readWorktreeSettings, removeChatWorktree, type ChatWorktreeRef } from './chatWorktree.js';
import { CHAT_WORKTREE_ROUTE, handleChatWorktreeRoute } from './chatWorktreeRoutes.js';
import { getAgent } from './agentsStore.js';
import { type AcpSessionCache } from './acpSessionCache.js';
import { searchChats } from './sessionsSearch.js';
import { interruptedChatsIn, listInterruptedChats, runOwnedElsewhere } from './agentChatStore.js';
import { readRecent, readRecentAsync } from './store.js';
import { ensureSessionsMigrated, ensureSessionsMigratedAsync, listRepoSessionSectionsAsync, readSessionIndexAsync, createSession, forkSession, readSessionChat, readSessionGoal, readSessionMeta, readSessionBoard, readSessionCanvas, setActiveSession, updateSession, deleteSession, listRepoSessionSections, moveSession, readSessionIndex, readSessionWorktree, writeSessionWorktree } from './sessionsStore.js';
import { validatePlan } from './goalPlan.js';
import { goalRunState, goalRunDoorRefusal, startGoalRun, stopGoalRun, type GoalRunnerDeps } from './goalRunner.js';
import { goalToolCall } from './goalAgentTools.js';
import { peerIsLoopback } from './agentEvents.js';
import { buildStamp } from './buildStamp.js';
import { migrateCheckpoint, readCheckpoint } from './checkpoint.js';
import { parseAskJobMode, type AskJobMode } from './askTools.js';
import { OfferBook } from '../components/inject.js';
import { ThreadNoteLedger } from '../harness/refineNotes.js';
import { type AiConfig } from './provider.js';
import { MAX_BODY_BYTES, sendJson, sendError, readBody } from './routeHttp.js';
import type { GoalLease } from './repoServer.js';
import { sameRepoPath } from './sessionsStore.js';
/** Constant-time comparison of a presented run key. */
function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export interface SessionRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  requireOwner: () => boolean;
  sessionId: string | undefined;
  identity: string;
  acpGate: () => { available: boolean; originOk: boolean; reason?: string };
  sessionsRoot: () => string;
  sessionsScope: () => 'workspace' | 'repo';
  sessionWriteRoot: (repoPath: unknown, caller: string | undefined) => { root: string } | { error: string };
  userConfigDir: string;
  userConfigDirFor: (sessionId: string | undefined) => string;
  recentStoreFor: (sessionId: string | undefined) => string;
  browseRootFor: (sessionId: string | undefined) => string;
  /** The attached repo root, read live at each use (null when none is attached). */
  getRoot: () => string | null;
  /** The current scanned graph, read live at each use. */
  getGraph: () => ArchGraph | null;
  acpSessions: AcpSessionCache;
  goalLeases: Map<string, GoalLease>;
  chatBusy: (root: string, chatId: string) => boolean;
  liveTurnRoots: Map<string, number>;
  noteLedger: ThreadNoteLedger;
  componentOffers: OfferBook;
  reapGoalRunsOnce: (root: string) => void;
  nameGoalWithModel: (goal: string, identity: string) => Promise<string | null>;
  loadAiConfig: () => AiConfig | undefined;
  extractIdentity: (req: http.IncomingMessage) => string;
  goalRunDeps: (root: string, threadId: string, permission: 'plan' | 'build', jobMode: AskJobMode | undefined, identity: string, workRootOf?: () => string | undefined) => GoalRunnerDeps;
  goalAgentDeps: (root: string, threadId: string, permission: 'plan' | 'build', jobMode: AskJobMode | undefined, identity: string, agentRef: string, self: { port: number; cookie?: string }) => { deps: GoalRunnerDeps; lease: GoalLease };
}

export function isSessionRoutePath(pathname: string): boolean {
  return (
    pathname === '/api/sessions' ||
    pathname.startsWith('/api/sessions/') ||
    pathname === '/api/fanout' ||
    pathname.startsWith('/api/fanout/') ||
    pathname === '/api/goal-tick' ||
    pathname === '/api/chat-memory' ||
    pathname === '/api/canvas-doc'
  );
}

/** Handle the sessions, goal-tick, chat-memory and canvas-doc routes. Returns false when the request is not one of ours. */
export async function handleSessionRoute(ctx: SessionRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { requireOwner, sessionId, identity, acpGate, sessionsRoot, sessionsScope, sessionWriteRoot, userConfigDir, userConfigDirFor, recentStoreFor, browseRootFor, acpSessions, goalLeases, chatBusy, liveTurnRoots, noteLedger, componentOffers, reapGoalRunsOnce, nameGoalWithModel, loadAiConfig, extractIdentity, goalRunDeps, goalAgentDeps } = ctx;
  const { getRoot, getGraph } = ctx;
  /*
   * ---- POST /api/sessions/move — FILE A CHAT UNDER A DIFFERENT PROJECT ---
   *
   * Owner, 2026-09-21: "from there you can fork chats, move chats, delete
   * chats, etc."
   *
   * The ordinary case is a conversation that started in the workspace and
   * turned out to be about a repository. Its transcript, its canvas and its
   * board move with it; the id does not change, because the id names a
   * directory rather than a position.
   *
   * BOTH ROOTS GO THROUGH THE SAME DOOR every other session write uses —
   * `sessionsRootFor`, which is the browse-jail check. A move is two writes
   * to two repositories, so it needs the permission for both, and a route
   * that checked only the source would be a way to write into any path the
   * caller could name.
   */
  if (pathname === '/api/sessions/move' && method === 'POST') {
    let from = '';
    let to = '';
    let id = '';
    try {
      const parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as {
        from?: unknown;
        to?: unknown;
        id?: unknown;
      };
      if (typeof parsed.from === 'string') from = parsed.from;
      if (typeof parsed.to === 'string') to = parsed.to;
      if (typeof parsed.id === 'string') id = parsed.id;
    } catch {
      sendJson(res, 400, { error: 'bad_request', message: 'Body must be JSON: { id, from, to }.' });
      return true;
    }
    if (id === '' || from === '' || to === '') {
      sendJson(res, 400, {
        error: 'bad_request',
        message: 'A move needs the chat and both projects: { id, from, to }.',
      });
      return true;
    }

    /* THE SAME FENCE EVERY OTHER SESSION WRITE USES, twice. A move writes
       to two repositories, so it needs the permission for both; a route that
       checked only the source would be a way to write into any path the
       caller could name. */
    const fromGate = sessionWriteRoot(from, sessionId);
    const toGate = sessionWriteRoot(to, sessionId);
    if ('error' in fromGate || 'error' in toGate) {
      const why = 'error' in fromGate ? fromGate.error : (toGate as { error: string }).error;
      sendJson(res, 400, { error: 'bad_request', message: why });
      return true;
    }

    const moved = moveSession(fromGate.root, toGate.root, id);
    if (!moved) {
      /*
       * One answer for every reason it did not happen, and all of them share
       * the property that matters: NOTHING WAS LOST. The chat is still in
       * the project it started in — same root, same directory, same
       * transcript — whether the cause was a missing chat, the two projects
       * being the same one, an id already taken at the destination, or a
       * copy that did not land.
       */
      sendJson(res, 409, {
        error: 'move_failed',
        message: 'The chat was not moved and is still in its own project.',
      });
      return true;
    }

    sendJson(res, 200, { from: moved.from, to: moved.to });
    return true;
  }

    // ---- GET/POST /api/sessions — loadable per-session chat + board snapshots ----
  if (pathname === '/api/sessions') {
    if (requireOwner()) return true;
    if (method === 'GET') {
      const root = sessionsRoot();
      const index = await ensureSessionsMigratedAsync(root);
      const scope = sessionsScope();
      /* Always disclose the recent-repos catalog (owner 2026-09-14): attaching
         a project must not hide every other project's chats. The write fence
         in {@link sessionWriteRoot} accepts exactly this list. PER-TENANT via
         {@link recentStoreFor} — never the process-wide store. */
      /*
       * ── THE HOME WORKSPACE IS ALWAYS IN THE CATALOG ────────────────────
       *
       * Owner, 2026-09-21: "I click on sequence, the default workspace
       * disappears, I have no idea why ... where do workspace go? I never said
       * I wanted to get rid of it."
       *
       * `repos` was the RECENT-REPOS list and nothing else, and the home
       * workspace is not a repo — it is never added to that list. So while
       * nothing was attached its threads arrived as `index` and the rail drew
       * them; the moment a repository was attached, `index` became THAT repo's
       * threads and the workspace's had no channel at all. Not hidden, not
       * collapsed: absent from the response.
       *
       * It is disclosed here the same way the recent repos are, and for the
       * same reason the 2026-09-14 ruling gives about them — "attaching a
       * project must not hide every other project's chats". The workspace is
       * the one project a reader always has.
       *
       * `homeSessionsRoot` rather than `sessionsRoot()`, which IS the attached
       * repo once one is attached. Skipped when it is already the active root,
       * because then its threads are `index` and a section would be a second
       * copy of the list directly above it.
       */
      const homeSessionsRoot = path.dirname(userConfigDir);
      const catalogRoots = await readRecentAsync(recentStoreFor(sessionId), browseRootFor(sessionId));
      const repos = await listRepoSessionSectionsAsync(catalogRoots);
      if (!sameRepoPath(homeSessionsRoot, root)) {
        const homeIndex = await readSessionIndexAsync(homeSessionsRoot);
        if (homeIndex && homeIndex.sessions.length > 0) {
          /* FIRST, because it is the root a reader falls back to and the one
             that is always there; and NAMED, because `path.basename` of a home
             directory is a username. */
          /*
           * `home: true` — THIS ONE IS NOT A PROJECT HE OPENED.
           *
           * Every other entry in `repos` is in the list because he attached
           * that folder, and so can be reordered or taken out again (C3,
           * 2026-09-21). This one is synthesised here on every read: it is
           * where chats with no repository live. A control offering to remove
           * it from the workspace would be offering to remove the workspace
           * from the workspace — which is what the first build of that control
           * actually said, caught in a browser before it shipped.
           */
          repos.unshift({ path: homeSessionsRoot, name: 'Workspace', home: true, index: homeIndex });
        }
      }

      const body: {
        index: ReturnType<typeof ensureSessionsMigrated>;
        scope: typeof scope;
        repos: ReturnType<typeof listRepoSessionSections>;
        /** Chats whose last agent turn a restart cut off (the rail marks them). */
        interrupted?: string[];
      } = { index, scope, repos };
      const cut = interruptedChatsIn(index).map((c) => c.chatId);
      if (cut.length) body.interrupted = cut;
      sendJson(res, 200, body);
      return true;
    }
    if (method === 'POST') {
      // Optional `{ mode, forkFromId, repoPath }` body. Missing body / invalid
      // JSON ⇒ the work-less default (current createSession behaviour).
      let mode: 'work' | 'code' | undefined;
      let forkFromId: string | undefined;
      let repoPath: unknown;
      try {
        const body = await readBody(req, MAX_BODY_BYTES);
        if (body.trim() !== '') {
          const raw = JSON.parse(body) as {
            mode?: unknown;
            forkFromId?: unknown;
            repoPath?: unknown;
          };
          if (raw && typeof raw === 'object') {
            if (raw.mode === 'work' || raw.mode === 'code') mode = raw.mode;
            if (typeof raw.forkFromId === 'string' && raw.forkFromId.trim()) {
              forkFromId = raw.forkFromId.trim();
            }
            if (raw.repoPath !== undefined) repoPath = raw.repoPath;
          }
        }
      } catch {
        /* invalid JSON → fall through to default createSession */
      }
      if (forkFromId) {
        const forked = forkSession(sessionsRoot(), forkFromId, mode ? { mode } : undefined);
        if (!forked) {
          sendError(res, 404, 'session not found');
          return true;
        }
        sendJson(res, 200, {
          index: forked.index,
          session: { id: forked.id, chat: forked.chat, meta: forked.meta },
        });
        return true;
      }
      /*
       * START A CHAT IN A WORKSPACE SECTION WITHOUT ATTACHING IT.
       *
       * Same fence as the PUT — {@link sessionWriteRoot} — and deliberately
       * the same FUNCTION rather than the same rules written twice: the rail
       * offers exactly the repos `GET /api/sessions` disclosed, so "create
       * where you can see" and "write where you can see" cannot drift apart.
       * Absent `repoPath` still resolves to the active root.
       */
      const createRoot = sessionWriteRoot(repoPath, sessionId);
      if ('error' in createRoot) {
        sendError(res, 400, createRoot.error);
        return true;
      }
      const created = createSession(createRoot.root, mode ? { mode } : undefined);
      sendJson(res, 200, {
        index: created.index,
        session: { id: created.id, chat: created.chat, meta: created.meta },
      });
      return true;
    }
  }

  /* GET /api/sessions/search?q= — the words in the active root's chats (sessionsSearch.ts). Before the `:id` block below. */
  if (pathname === '/api/sessions/search' && method === 'GET') {
    if (requireOwner()) return true;
    const q = (url.searchParams.get('q') ?? '').slice(0, 200);
    if (q.trim().length < 2) {
      sendJson(res, 200, { hits: [], truncated: false });
      return true;
    }
    sendJson(res, 200, searchChats(sessionsRoot(), q, { limit: 50, maxBytes: 2 * 1024 * 1024 }));
    return true;
  }

  if (pathname === '/api/sessions/active' && method === 'PUT') {
    if (requireOwner()) return true;
    const body = await readBody(req, MAX_BODY_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      sendError(res, 400, 'invalid JSON');
      return true;
    }
    const activeId = (raw as { activeId?: unknown }).activeId;
    if (typeof activeId !== 'string' || !activeId.trim()) {
      sendError(res, 400, 'activeId required');
      return true;
    }
    const index = setActiveSession(sessionsRoot(), activeId.trim());
    if (!index) {
      sendError(res, 404, 'session not found');
      return true;
    }
    sendJson(res, 200, { index });
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     THE GOAL RUN — /api/sessions/:id/goal-run
     `server/goalRunner.ts` · `packages/web2/src/v3/useGoalRun.ts`

     BEFORE the `/api/sessions/:id` block below, which refuses any id containing
     a slash. That refusal is right — a thread id is one path segment and
     `..%2F..` is exactly what it stops — so a sub-resource cannot be served
     from inside it and has to be matched first.

     Three routes and no SSE. The run is a PERSISTED ROW that any window may
     read, so a poll every 1.5s answers the same question a stream would, and it
     recovers from a dropped connection by construction rather than by a
     `since=` cursor. `programRunner.ts` needs the stream because a program run
     emits EVENTS; this one has a state.
     ══════════════════════════════════════════════════════════════════════════ */
  /* S7 — a chat's worktree (chatWorktreeRoutes.ts). Matched before the
     `/api/sessions/:id` block for the same reason as the goal run below. */
  {
    const wtMatch = CHAT_WORKTREE_ROUTE.exec(pathname);
    if (wtMatch) {
      if (requireOwner()) return true;
      const threadId = decodeURIComponent(wtMatch[1]!);
      const wtRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, threadId);
      if ('error' in wtRoot) {
        sendError(res, 400, wtRoot.error);
        return true;
      }
      await handleChatWorktreeRoute({
        req,
        res,
        method,
        url,
        readBody: () => readBody(req, MAX_BODY_BYTES),
        sendJson,
        root: wtRoot.root,
        threadId,
        part: wtMatch[2],
        isBusy: (c) => chatBusy(wtRoot.root, c),
        dataDir: userConfigDirFor(sessionId),
      });
      return true;
    }
  }
  /* Pull request from a worktree chat (prRoutes.ts). */
  {
    const prMatch = PR_ROUTE.exec(pathname);
    if (prMatch) {
      if (requireOwner()) return true;
      const prThread = decodeURIComponent(prMatch[1]!);
      const prRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, prThread);
      if ('error' in prRoot) {
        sendError(res, 400, prRoot.error);
        return true;
      }
      await handlePrRoute({ res, method, readBody: () => readBody(req, MAX_BODY_BYTES), sendJson, root: prRoot.root, threadId: prThread, part: prMatch[2], isBusy: (c) => chatBusy(prRoot.root, c) });
      return true;
    }
  }
  /* Best-of-N (fanoutRoutes.ts). */
  {
    const fanMatch = FANOUT_ROUTE.exec(pathname);
    if (fanMatch) {
      if (requireOwner()) return true;
      const fanRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, undefined);
      if ('error' in fanRoot) {
        sendError(res, 400, fanRoot.error);
        return true;
      }
      await handleFanoutRoute({
        req,
        res,
        method,
        readBody: () => readBody(req, MAX_BODY_BYTES),
        sendJson,
        root: fanRoot.root,
        dataDir: userConfigDirFor(sessionId),
        isBusy: (c) => chatBusy(fanRoot.root, c),
        isAgent: (a) => getAgent(userConfigDir, a) !== undefined && getAgent(userConfigDir, a) !== null,
        id: fanMatch[1] ? decodeURIComponent(fanMatch[1]) : undefined,
        part: fanMatch[2],
      });
      return true;
    }
  }
  /* Edit from here: POST /api/sessions/:id/rewind { fromTurnId } and /rewind/undo (agentRewind.ts). */
  {
    const rewindMatch = /^\/api\/sessions\/([^/]+)\/rewind(\/undo)?$/.exec(pathname);
    if (rewindMatch && method === 'POST') {
      if (requireOwner()) return true;
      const threadId = decodeURIComponent(rewindMatch[1]!);
      const rwRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, threadId);
      if ('error' in rwRoot) {
        sendError(res, 400, rwRoot.error);
        return true;
      }
      const entry = readSessionIndex(rwRoot.root)?.sessions.find((s) => s.id === threadId);
      if (!entry) {
        sendError(res, 404, 'session not found');
        return true;
      }
      if (chatBusy(rwRoot.root, threadId)) {
        sendError(res, 409, 'The agent is still working in this chat. Stop it, or wait, then go back.');
        return true;
      }
      if (runOwnedElsewhere(rwRoot.root, threadId)) {
        sendError(res, 409, 'Another Sequence window is still working in this chat. Stop it there, or wait, then go back.');
        return true;
      }
      if (rewindMatch[2]) {
        const undone = undoRewind(rwRoot.root, threadId);
        if (!undone) sendError(res, 409, 'There is nothing to undo: a message has been sent since.');
        else sendJson(res, 200, undone);
        return true;
      }
      let body: { fromTurnId?: unknown } = {};
      try {
        body = JSON.parse((await readBody(req, MAX_BODY_BYTES)) || '{}') as { fromTurnId?: unknown };
      } catch {
        sendError(res, 400, 'Body must be JSON.');
        return true;
      }
      if (body.fromTurnId !== null && (typeof body.fromTurnId !== 'string' || body.fromTurnId === '')) {
        sendError(res, 400, '"fromTurnId" must be the id of the turn to go back to, or null when nothing was saved.');
        return true;
      }
      /* The chat's live agent sessions hold the old conversation: end them so the next turn reopens through the rewind. */
      await Promise.all(Object.keys(entry.agentThreads ?? {}).map((a) => acpSessions.dispose(`chat::${threadId}::${a}`).catch(() => {})));
      /* The cut turns may be the ones that carried the repo's notes: each agent thread is told again. */
      noteLedger.forget(`chat::${threadId}::`);
      componentOffers.forget(`chat::${threadId}::`);
      const out = rewindChat(rwRoot.root, threadId, body.fromTurnId);
      if (!out) {
        sendError(res, 409, 'This chat has no saved turn with that id. Reload the chat and try again.');
        return true;
      }
      sendJson(res, 200, out);
      return true;
    }
  }
  /* The `goal` tool of an agent on a goal run ticks its plan here (mcp goalTools.ts): ONE process writes the plan, so
     a tick cannot be lost to a second writer. The key is per run and only that run's agent session holds it. */
  if (pathname === '/api/goal-tick' && method === 'POST') {
    if (!isOriginAllowed(req) || !peerIsLoopback(req)) {
      sendError(res, 403, 'goal ticks are local-only');
      return true;
    }
    let b: { key?: unknown; chat?: unknown; op?: unknown; step?: unknown; steps?: unknown } = {};
    try {
      b = JSON.parse((await readBody(req, MAX_BODY_BYTES)) || '{}');
    } catch {
      sendError(res, 400, 'Body must be JSON.');
      return true;
    }
    const lease = typeof b.chat === 'string' ? goalLeases.get(b.chat) : undefined;
    if (!lease || typeof b.key !== 'string' || !sameKey(b.key, lease.key)) {
      sendError(res, 403, 'no goal run is working that chat');
      return true;
    }
    sendJson(res, 200, goalToolCall(lease.root, b.chat as string, { op: typeof b.op === 'string' ? b.op : undefined, step: b.step, steps: b.steps }));
    return true;
  }
  {
    const goalRunMatch = /^\/api\/sessions\/([^/]+)\/goal-run(\/stop)?$/.exec(pathname);
    if (goalRunMatch) {
      if (requireOwner()) return true;
      const threadId = decodeURIComponent(goalRunMatch[1]!);
      const stopPath = goalRunMatch[2] !== undefined;
      const runRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, threadId);
      if ('error' in runRoot) {
        sendError(res, 400, runRoot.error);
        return true;
      }
      const index = ensureSessionsMigrated(runRoot.root);
      if (!index.sessions.some((s) => s.id === threadId)) {
        sendError(res, 404, 'session not found');
        return true;
      }
      /* Before ANY answer about a run, including the read — a phantom reported
         once is a Stop button that does nothing. See `reapGoalRunsOnce`. */
      reapGoalRunsOnce(runRoot.root);
      if (method === 'GET' && !stopPath) {
        sendJson(res, 200, goalRunState(runRoot.root, threadId));
        return true;
      }
      if (method === 'POST' && stopPath) {
        const stopped = stopGoalRun(runRoot.root, threadId);
        /* Stop reaches the agent: its in-flight turn is cancelled and its process ended, not left to finish the step. */
        const lease = goalLeases.get(threadId);
        if (lease) {
          lease.abort.abort();
          void acpSessions.dispose(lease.sessionKey).catch(() => {});
        }
        sendJson(res, 200, { ok: true, state: stopped });
        return true;
      }
      if (method === 'POST') {
        let raw: unknown = {};
        try {
          const text = await readBody(req, MAX_BODY_BYTES);
          if (text.trim() !== '') raw = JSON.parse(text);
        } catch {
          sendError(res, 400, 'invalid JSON');
          return true;
        }
        const b = raw as { permission?: unknown; jobMode?: unknown; agentRef?: unknown };
        const permission = b.permission === 'build' || b.permission === 'plan' ? b.permission : undefined;
        const jobMode = parseAskJobMode(b.jobMode);
        /* A run on a coding agent (Claude, Codex) names it; absent, the run is the built-in model's. */
        const agentRef = typeof b.agentRef === 'string' && b.agentRef.trim() !== '' ? b.agentRef.trim() : undefined;
        const agentSide =
          agentRef === undefined
            ? null
            : goalAgentDeps(runRoot.root, threadId, permission ?? 'plan', jobMode, identity, agentRef, {
                port: req.socket.localPort ?? 0,
                ...(typeof req.headers.cookie === 'string' ? { cookie: req.headers.cookie } : {}),
              });
        const deps = agentSide ? agentSide.deps : goalRunDeps(runRoot.root, threadId, permission ?? 'plan', jobMode, identity);
        /*
         * THE DOOR REFUSALS COME FIRST, BEFORE THE PROVIDER AND REPO CHECKS.
         *
         * Not arbitrary ordering: these are the two refusals the PERSON can act
         * on. Somebody who presses Work on goal in Plan mode needs to be told
         * to switch to Build; telling them to connect an AI key — true, but not
         * the thing standing between them and the run — sends them to the wrong
         * settings page.
         */
        const refused = goalRunDoorRefusal(deps, permission);
        if (refused) {
          sendJson(res, refused.status, { error: refused.message, reason: refused.reason, state: refused.state });
          return true;
        }
        if (agentRef !== undefined) {
          /* An agent run needs no AI key: the agent has its own sign-in. It needs the local ACP bridge, a registered
             agent, and the chat's sessions under the root the agent works in (its tick tool reads them there). */
          const gate = acpGate();
          if (!gate.available) {
            sendError(res, 403, gate.reason ?? 'ACP is not available');
            return true;
          }
          if (!getAgent(userConfigDir, agentRef)) {
            sendError(res, 400, `unknown agentRef '${agentRef}' — register it with: sequence agent add ${agentRef} --command <bin>`);
            return true;
          }
          if (getRoot() === null || path.resolve(runRoot.root) !== path.resolve(sessionsRoot()) || !req.socket.localPort) {
            sendError(res, 400, "A goal run on an agent works in the open project: open this chat's project first.");
            return true;
          }
        } else if (!loadAiConfig()) {
          sendError(res, 400, 'AI provider not configured — connect your AI key in Settings to chat', { fix: 'provider' });
          return true;
        }
        /*
         * AN AGENT BUILD RUN THAT WOULD SHARE THE CHECKOUT GETS A WORKTREE (audit P1-11, the agent half).
         *
         * Agents (Claude, Codex) write files themselves, so the per-path lock the built-in model takes cannot order them.
         * Policy: the FIRST run in a repo keeps the main checkout (the person asked to work there; no surprise branch);
         * a run that starts while another goal run, or any live agent turn, holds the checkout is cut a chat worktree
         * (chatWorktree.ts, the one the Worktrees section lists, merges and PRs) and its turns run in it: run-node reads
         * the chat's worktree binding for its cwd. Plan mode never writes, so it never gets one. A folder git cannot
         * make a worktree in keeps the checkout and the person is told runs may overlap.
         */
        let runWarning: string | undefined;
        let runWorktree: ChatWorktreeRef | null = null;
        let madeWorktree = false;
        if (agentSide && permission === 'build' && !goalRunState(runRoot.root, threadId).running) {
          const bound = readSessionWorktree(runRoot.root, threadId);
          if (bound && fs.existsSync(bound.path)) runWorktree = bound;
          else {
            const shared = (liveTurnRoots.get(runRoot.root) ?? 0) > 0 || [...goalLeases.entries()].some(([id, l]) => id !== threadId && l.root === runRoot.root);
            if (shared) {
              const title = index.sessions.find((s) => s.id === threadId)?.title ?? 'goal';
              const dataDir = userConfigDirFor(sessionId);
              const made = await createChatWorktree(runRoot.root, { dataDir, title: `goal ${title}`, cap: readWorktreeSettings(dataDir, runRoot.root).cap });
              if (made.ok) {
                writeSessionWorktree(runRoot.root, threadId, made.ref);
                runWorktree = made.ref;
                madeWorktree = true;
              } else {
                runWarning = `Another run is already working in this project and this one could not get its own worktree (${made.error}) Both write to the same files and may overlap.`;
              }
            }
          }
          if (runWorktree) agentSide.lease.workRoot = runWorktree.path;
        }
        /* NO `requireRepo` HERE. The home workspace is where the owner walked
           this (2026-09-17): a General thread with a goal and no repository.
           `goalRunDeps` takes the same road `/api/ask/stream` takes when nothing
           is attached — design mode over the workspace jail — so a run there
           has exactly the tools a typed turn there has. */
        const started = startGoalRun(deps, { permission, ...(agentRef !== undefined ? { agentRef } : {}), ...(jobMode === 'work' || jobMode === 'code' ? { jobMode } : {}) });
        if (!started.ok) {
          if (madeWorktree && runWorktree) {
            /* The run never started: the worktree made for it is not left behind. */
            writeSessionWorktree(runRoot.root, threadId, { ...runWorktree, removedAt: new Date().toISOString() });
            await removeChatWorktree(runRoot.root, userConfigDirFor(sessionId), runWorktree, { confirmUnmerged: [], discardUncommitted: true }).catch(() => {});
          }
          sendJson(res, started.status, { error: started.message, reason: started.reason, state: started.state });
          return true;
        }
        /*
         * ANSWER NOW; THE RUN KEEPS GOING WITHOUT THIS REQUEST.
         *
         * `started.done` is deliberately not awaited — a run is up to
         * twenty-four provider turns and a request that waited for it would
         * time out somewhere in the middle, leaving the person with a failed
         * fetch and a run that is still working. The `.catch` is for a
         * rejection the loop's contract says cannot happen; it must not become
         * an unhandled rejection that takes the server down mid-run.
         */
        void started.done.catch((e: unknown) => {
          process.stderr.write(`sequence: goal run ${threadId} threw: ${(e as Error).message}\n`);
        });
        /* The run's agent process (it carries the `goal` tool) ends with the run. */
        if (agentSide) {
          const lease = agentSide.lease;
          goalLeases.set(threadId, lease);
          void started.done.finally(() => {
            if (goalLeases.get(threadId) === lease) goalLeases.delete(threadId);
            void acpSessions.dispose(lease.sessionKey).catch(() => {});
          });
        }
        sendJson(res, 200, { ok: true, state: started.state, ...(runWorktree ? { worktree: runWorktree } : {}), ...(runWarning ? { warning: runWarning } : {}) });
        return true;
      }
      sendError(res, 405, 'method not allowed');
      return true;
    }
  }

  if (pathname.startsWith('/api/sessions/')) {
    /* `threadId`, not `sessionId`: this block used to bind the CHAT thread id to
       the name the handler already uses for the AUTHENTICATED IDENTITY, which
       shadowed the tenant id inside the one block that most needs it — the
       write fence in {@link sessionWriteRoot} silently ran process-wide instead
       of per-caller. Two different things do not share a name here. */
    const threadId = decodeURIComponent(pathname.slice('/api/sessions/'.length));
    if (!threadId || threadId.includes('/')) {
      sendError(res, 404, 'not found');
      return true;
    }
    if (requireOwner()) return true;
    if (method === 'GET') {
      /* Optional `?repoPath=` — workspace catalog may read a thread that lives
         under another recent repo WITHOUT attaching that repo (owner: picking a
         catalog chat must not isolate the app into that project). Validated by
         the same fence as PUT/DELETE. Absent ⇒ active root, as before. */
      const readRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, threadId);
      if ('error' in readRoot) {
        sendError(res, 400, readRoot.error);
        return true;
      }
      const index = ensureSessionsMigrated(readRoot.root);
      if (!index.sessions.some((s) => s.id === threadId)) {
        sendError(res, 404, 'session not found');
        return true;
      }
      const chat = readSessionChat(readRoot.root, threadId);
      const meta = readSessionMeta(readRoot.root, threadId);
      const boardSeqd = readSessionBoard(readRoot.root, threadId);
      const canvas = readSessionCanvas(readRoot.root, threadId);
      /*
       * ── THE MIGRATION, ON THE PATH THAT SERVES THE SESSION ────────────────
       *
       * A saved chart was derived from the graph as it was when the lesson ran.
       * If the scanner has moved since, that picture is a claim about a
       * repository that no longer matches — and until now it was served anyway,
       * with nothing on screen saying so. `docs/journeys/teach-mode.md` has to
       * carry that caveat in prose precisely because the file could not.
       *
       * So: read the checkpoint, and when the build that wrote it is not this
       * build, RE-DERIVE from the current graph and serve that. The stored
       * derivation is discarded, not warned about — a stale picture shown with a
       * badge is still a false claim, and this product's first law is that a
       * claim traces to evidence.
       *
       * `migrated` rides on the payload so a reader (and the seat) can say what
       * happened rather than infer it.
       */
      const cp = readCheckpoint(readRoot.root, threadId);
      let migrated: { migrated: boolean; reason: string } | undefined;
      if (cp.checkpoint !== undefined && cp.checkpoint.charts.length > 0) {
        const m = migrateCheckpoint({
          checkpoint: cp.checkpoint,
          graph: getGraph() ?? undefined,
          builtAt: buildStamp().builtAt,
        });
        migrated = { migrated: m.migrated, reason: m.reason };
        if (m.migrated) canvas.charts = [...m.charts];
      }
      /* The goal and plan ride on the SESSION read, not on a route of their
         own: a client that has fetched the thread has everything the goalbar
         draws, and a second round trip for two fields is a second chance for
         the two to disagree about which session they describe. */
      const goalState = readSessionGoal(readRoot.root, threadId);
      sendJson(res, 200, {
        chat,
        meta,
        boardSeqd,
        canvas,
        ...goalState,
        ...(migrated ? { migrated } : {}),
      });
      return true;
    }
    if (method === 'PUT') {
      const body = await readBody(req, MAX_BODY_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        sendError(res, 400, 'invalid JSON');
        return true;
      }
      const o = raw as {
        chat?: unknown;
        meta?: unknown;
        boardSeqd?: unknown;
        canvas?: unknown;
        title?: unknown;
        pinned?: unknown;
        mode?: unknown;
        clonedFromId?: unknown;
        goal?: unknown;
        plan?: unknown;
        repoPath?: unknown;
      };
      /* `repoPath` names the repo this write belongs to — see
         {@link sessionWriteRoot} for why it is validated against the catalog
         list and never falls back. It is NOT part of the patch: the store's
         `updateSession` already takes the root as its first argument. */
      const writeRoot = sessionWriteRoot(o.repoPath, sessionId);
      if ('error' in writeRoot) {
        sendError(res, 400, writeRoot.error);
        return true;
      }
      const patch: {
        chat?: ReturnType<typeof readSessionChat>;
        meta?: ReturnType<typeof readSessionMeta>;
        boardSeqd?: string;
        canvas?: ReturnType<typeof readSessionCanvas>;
        title?: string;
        pinned?: boolean;
        mode?: 'work' | 'code';
        clonedFromId?: string;
        goal?: string;
        plan?: PlanStep[];
      } = {};
      if (o.chat && typeof o.chat === 'object') {
        const c = o.chat as { version?: unknown; sessionId?: unknown; turns?: unknown };
        if (
          (c.version === 1 || c.version === 2) &&
          typeof c.sessionId === 'string' &&
          Array.isArray(c.turns)
        ) {
          if (c.sessionId.trim() !== threadId) {
            sendError(res, 400, 'chat.sessionId must match path id');
            return true;
          }
          patch.chat = c as ReturnType<typeof readSessionChat>;
        } else {
          sendError(res, 400, 'invalid chat document');
          return true;
        }
      }
      if (o.meta && typeof o.meta === 'object') {
        patch.meta = o.meta as ReturnType<typeof readSessionMeta>;
      }
      if (typeof o.boardSeqd === 'string') {
        patch.boardSeqd = o.boardSeqd;
      }
      if (o.canvas && typeof o.canvas === 'object') {
        const c = o.canvas as { version?: unknown; sessionId?: unknown; blocks?: unknown };
        if (c.version === 1 && typeof c.sessionId === 'string' && Array.isArray(c.blocks)) {
          if (c.sessionId.trim() !== threadId) {
            sendError(res, 400, 'canvas.sessionId must match path id');
            return true;
          }
          patch.canvas = c as ReturnType<typeof readSessionCanvas>;
        } else {
          sendError(res, 400, 'invalid canvas document');
          return true;
        }
      }
      if (typeof o.title === 'string') {
        patch.title = o.title;
      }
      if (typeof o.pinned === 'boolean') {
        patch.pinned = o.pinned;
      }
      if (o.mode === 'work' || o.mode === 'code') {
        patch.mode = o.mode;
      }
      if (typeof o.clonedFromId === 'string' && o.clonedFromId.trim()) {
        patch.clonedFromId = o.clonedFromId.trim();
      }
      /*
       * `''` IS ACCEPTED AND IS NOT A NO-OP — it is the person CLEARING the
       * goal, and the store records the clear so auto-adoption never refills
       * it. That is why the test here is `typeof === 'string'` and not the
       * `&& .trim()` the title and `clonedFromId` lines use: for those an
       * empty value means "not supplied", and for this one it means something.
       */
      if (typeof o.goal === 'string') {
        patch.goal = o.goal;
      }
      /*
       * A MALFORMED PLAN IS A 400, NEVER A SILENT REPAIR.
       *
       * `validatePlan` refuses on every rule and says which — a duplicate id, a
       * status nobody recognises, a parked step carrying no reason. Storing a
       * repaired version would put a plan on the person's screen that neither
       * they nor the model wrote, and the goal run would then work THAT down.
       * The reason travels in the error so the caller can fix it.
       */
      if (o.plan !== undefined) {
        const parsed = validatePlan(o.plan);
        if (!parsed.ok) {
          sendError(res, 400, `invalid plan: ${parsed.reason}`);
          return true;
        }
        patch.plan = parsed.steps;
      }
      const goalBefore = readSessionGoal(writeRoot.root, threadId).goal;
      let index = updateSession(writeRoot.root, threadId, patch);
      if (!index) {
        sendError(res, 404, 'session not found');
        return true;
      }
      /* A NEW GOAL IS NAMED BEFORE THE ANSWER, so the goalbar the client
         re-reads next already shows the name. Bounded: a model that is down or
         slow leaves the trimmer's name, which the store has already written. */
      if (typeof patch.goal === 'string' && patch.goal.trim() && patch.goal.trim() !== goalBefore) {
        const named = await nameGoalWithModel(patch.goal.trim(), extractIdentity(req));
        if (named) index = updateSession(writeRoot.root, threadId, { goalName: named }) ?? index;
      }
      sendJson(res, 200, { ok: true, index });
      return true;
    }
    if (method === 'DELETE') {
      /* DELETE carries no body here, so the repo travels as `?repoPath=` —
         same field name, same validation, same no-fallback rule as the PUT. */
      const deleteRoot = sessionWriteRoot(url.searchParams.get('repoPath') ?? undefined, sessionId);
      if ('error' in deleteRoot) {
        sendError(res, 400, deleteRoot.error);
        return true;
      }
      /* "Always keep one live thread" is a rule about the repo you are IN. In a
         catalogued OTHER repo it re-mints the row you just deleted, so the
         delete reads as a no-op with the transcript gone — see
         {@link deleteSession}. Foreign is decided here, not from the presence
         of `?repoPath=`: naming your own repo must behave like omitting it. */
      const foreign = !sameRepoPath(deleteRoot.root, sessionsRoot());
      const index = deleteSession(deleteRoot.root, threadId, { keepOneLiveThread: !foreign });
      if (!index) {
        sendError(res, 404, 'session not found');
        return true;
      }
      sendJson(res, 200, { ok: true, index });
      return true;
    }
  }

  // ---- GET/PUT /api/chat-memory — compat shim → active loadable session ----
  // Do not write a forever shared `.sequence/chat-memory.json` blob.
  if (pathname === '/api/chat-memory') {
    if (requireOwner()) return true;
    if (method === 'GET') {
      const root = sessionsRoot();
      const index = ensureSessionsMigrated(root);
      sendJson(res, 200, readSessionChat(root, index.activeId));
      return true;
    }
    if (method === 'PUT') {
      const body = await readBody(req, MAX_BODY_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        sendError(res, 400, 'invalid JSON');
        return true;
      }
      if (
        !raw ||
        typeof raw !== 'object' ||
        ((raw as { version?: unknown }).version !== 1 &&
          (raw as { version?: unknown }).version !== 2) ||
        typeof (raw as { sessionId?: unknown }).sessionId !== 'string' ||
        !Array.isArray((raw as { turns?: unknown }).turns)
      ) {
        sendError(res, 400, 'invalid chat memory document');
        return true;
      }
      const root = sessionsRoot();
      const index = ensureSessionsMigrated(root);
      const chat = {
        ...(raw as ReturnType<typeof readSessionChat>),
        sessionId: index.activeId,
      };
      const next = updateSession(root, index.activeId, { chat });
      if (!next) {
        sendError(res, 404, 'session not found');
        return true;
      }
      /* The index goes back with the write so the rail can take a name the
         model wrote at the start of the turn (`nameThreadFromPrompt`). */
      sendJson(res, 200, {
        ok: true,
        path: `.sequence/sessions/${index.activeId}/chat.json`,
        index: next,
      });
      return true;
    }
  }

  // ---- GET/PUT /api/canvas-doc — compat shim → active session canvas.json ----
  if (pathname === '/api/canvas-doc') {
    if (requireOwner()) return true;
    if (method === 'GET') {
      const root = sessionsRoot();
      const index = ensureSessionsMigrated(root);
      const canvas = readSessionCanvas(root, index.activeId);
      /*
       * ── THE MIGRATION BELONGS ON THE ROUTE THE CANVAS ACTUALLY READS ─────
       *
       * It was wired into `GET /api/sessions/:id` first, which returns the
       * canvas and is the obvious "open the session" endpoint — and the client
       * hydrates its canvas from HERE instead (`connect.tsx` fetches
       * `/api/canvas-doc`; the other route's canvas field is not read for
       * this). So the API migrated and the SCREEN did not.
       *
       * Found by re-running the journey capture and looking at screen 4: it
       * still showed the stored chart. The endpoint test passed and the
       * product was unchanged, which is the exact shape of a claim this
       * repository has been wrong about before.
       *
       * Both routes migrate now, because a rule that lives in one of two
       * handlers is a rule that half the callers do not get.
       */
      const cp = readCheckpoint(root, index.activeId);
      if (cp.checkpoint !== undefined && cp.checkpoint.charts.length > 0) {
        const m = migrateCheckpoint({
          checkpoint: cp.checkpoint,
          graph: getGraph() ?? undefined,
          builtAt: buildStamp().builtAt,
        });
        if (m.migrated) canvas.charts = [...m.charts];
      }
      sendJson(res, 200, canvas);
      return true;
    }
    if (method === 'PUT') {
      const body = await readBody(req, MAX_BODY_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        sendError(res, 400, 'invalid JSON');
        return true;
      }
      const o = raw as { version?: unknown; sessionId?: unknown; blocks?: unknown };
      if (o.version !== 1 || !Array.isArray(o.blocks)) {
        sendError(res, 400, 'invalid canvas document');
        return true;
      }
      const root = sessionsRoot();
      const index = ensureSessionsMigrated(root);
      const canvas = {
        ...(raw as ReturnType<typeof readSessionCanvas>),
        sessionId: index.activeId,
      };
      const next = updateSession(root, index.activeId, { canvas });
      if (!next) {
        sendError(res, 404, 'session not found');
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        path: `.sequence/sessions/${index.activeId}/canvas.json`,
      });
      return true;
    }
  }

  return false;
}
