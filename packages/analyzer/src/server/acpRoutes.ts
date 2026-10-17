/**
 * ACP control routes, moved out of repoServer.ts unchanged (POST /api/acp/run-node stays there):
 *
 *   GET  /api/acp/available, /agents, /capabilities     probes and the configured local agents
 *   DELETE /api/acp/agents/:id, POST /api/acp/agents/connect
 *   GET|POST /api/acp/full-access                       the one-time per-project confirmation
 *   GET  /api/import/sessions, POST /api/import/session   import a Claude Code / Codex CLI chat
 *   POST /api/acp/auto-resume, /stop, /steer            drive a live turn
 *   GET  /api/acp/live, /attach, /runs, /turn-log       what is running and what ran
 *   POST /api/acp/permission, /question                 answer a pending approval or question
 *
 * The ACP gate and the owner/repo checks arrive as callbacks; the session registry and the pending
 * approval/question maps arrive as hub objects. Nothing here closes over createRepoServer state.
 */

import http from 'node:http';
import { agentLaunch, createProviderProbe, defaultExtraDirs, defaultProviderProbe } from './providerProbe.js';
import { addAgent, listAgents, getAgent, removeAgent, type AgentEntry } from './agentsStore.js';
import { handleAgentCatalogRoute, isAgentCatalogPath } from './agentCatalogRoutes.js';
import { createAgentClient, isSandboxed, canSteer, isQuestionAnswers, type AgentQuestionAnswers, type AgentCapabilities, createRespawnGate, type PermissionDecision } from '@sequence/acp';
import { FULL_ACCESS_PROMPT, hasFullAccessConsent, recordFullAccessConsent } from './fullAccessConsent.js';
import { type AcpSessionCache } from './acpSessionCache.js';
import { AgentTurnRuntime } from './agentTurnRuntime.js';
import { claimAutoResume, declineAutoResume } from './autoResume.js';
import { importSession, listImportable } from './importHistory.js';
import { readAgentRunsChecked, readArchivePage, readTurnLog, recordSteer, runsForWire } from './agentChatStore.js';
import { TurnChannels } from './turnChannels.js';
import { MAX_BODY_BYTES, sendJson, sendError, isJsonRequest, readBody, startSse, writeSseData } from './routeHttp.js';
import type { RepoServerOptions } from './repoServer.js';

export interface AcpRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  requireOwner: () => boolean;
  authOn: boolean;
  acpGate: () => { available: boolean; originOk: boolean; reason?: string };
  acpProjectRoot: () => string | null;
  sessionsRoot: () => string;
  /** The attached repo root, read live (null when none is attached). */
  getRoot: () => string | null;
  userConfigDir: string;
  opts: RepoServerOptions;
  onboardingProbe: ReturnType<typeof createProviderProbe> | undefined;
  acpSessions: AcpSessionCache;
  activeAcpTurns: Map<string, { rt: AgentTurnRuntime; stop: () => void }>;
  acpTurnChannels: TurnChannels;
  pendingAcpApprovals: Map<string, (d: PermissionDecision, by: 'person') => void>;
  pendingAcpQuestions: Map<string, (answers: AgentQuestionAnswers | null, by: 'person' | 'cancel') => void>;
  agentCapabilities: Map<string, Promise<AgentCapabilities>>;
  capabilitiesGate: ReturnType<typeof createRespawnGate>;
  forgetAgentCapabilities: (id: string) => void;
  recoveryForResponse: (e: unknown) => Record<string, unknown>;
}

export function isAcpRoutePath(pathname: string): boolean {
  return (pathname.startsWith('/api/acp/') && pathname !== '/api/acp/run-node') || pathname.startsWith('/api/import/');
}

/** Handle the ACP control routes. Returns false when the request is not one of ours. */
export async function handleAcpRoute(ctx: AcpRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { requireOwner, authOn, acpGate, acpProjectRoot, sessionsRoot, userConfigDir, opts, onboardingProbe, acpSessions, activeAcpTurns, acpTurnChannels, pendingAcpApprovals, pendingAcpQuestions, agentCapabilities, capabilitiesGate, forgetAgentCapabilities, recoveryForResponse } = ctx;
  const getRoot = ctx.getRoot;
  // ---- /api/acp/catalog*: every ACP agent, one click to connect (agentCatalogRoutes.ts) ----
  if (isAgentCatalogPath(pathname)) {
    return handleAgentCatalogRoute({ req, res, url, method, acpGate, userConfigDir, search: opts.providerSearch ?? { extraDirs: defaultExtraDirs() }, ...(opts.catalogFetch ? { fetchImpl: opts.catalogFetch } : {}), ...(opts.catalogTar ? { tarCommand: opts.catalogTar } : {}), ...(opts.catalogDockerCheck ? { dockerCheck: opts.catalogDockerCheck } : {}), ...(opts.catalogClientFactory ? { clientFactory: opts.catalogClientFactory } : {}), ...(opts.catalogProbeMs ? { probeMs: opts.catalogProbeMs } : {}), forgetAgentCapabilities, getRoot, ...(opts.profilesHome ? { home: opts.profilesHome } : {}) });
  }
  // ---- GET /api/acp/available → { available, reason? } (capability probe) ----
  // 200 for any LOCAL caller (so a same-origin web client can feature-detect,
  // incl. an honest `available:false` in hosted mode); a genuinely non-local
  // (cross-origin / rebound) prober is refused with 403.
  if (pathname === '/api/acp/available' && method === 'GET') {
    const g = acpGate();
    if (!g.originOk) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    sendJson(res, 200, { available: g.available, ...(g.reason ? { reason: g.reason } : {}) });
    return true;
  }

  // ---- GET /api/acp/agents → { agents: [...] } (the configured local agents) ----
  if (pathname === '/api/acp/agents' && method === 'GET') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    sendJson(res, 200, { agents: listAgents(userConfigDir) });
    return true;
  }

  // ---- DELETE /api/acp/agents/:id → { removed: true, agents } ----
  // Settings' Disconnect: what `sequence agent remove <id>` does. A name that
  // is not registered is a 404, never a quiet success.
  {
    const m = /^\/api\/acp\/agents\/([^/]+)$/.exec(pathname);
    if (m && m[1] !== 'connect' && method === 'DELETE') {
      const g = acpGate();
      if (!g.available) {
        sendError(res, 403, g.reason ?? 'ACP is not available');
        return true;
      }
      let id: string;
      try {
        id = decodeURIComponent(m[1]!);
      } catch {
        sendError(res, 400, 'malformed agent id');
        return true;
      }
      const out = removeAgent(userConfigDir, id);
      if (!out.removed) {
        sendError(res, 404, `no agent '${id}' is connected`);
        return true;
      }
      /* 0.1.5 G1: what was learnt of it goes with it, so a reconnect reads it afresh. */
      forgetAgentCapabilities(id);
      sendJson(res, 200, { removed: true, agents: out.agents });
      return true;
    }
  }

  // ---- POST /api/acp/agents/connect { provider } → { agent, agents } ----
  // One click from the composer (and Settings): register a provider the
  // first-run probe detected, as `sequence agent add` would. The caller names
  // a PROVIDER, never a command line: the launch comes from agentLaunch().
  // A provider that is not signed in is refused with its sign-in command (a
  // state, not an error the reader caused); one with no launch on this
  // machine (Claude without its ACP adapter) is refused with what is missing.
  if (pathname === '/api/acp/agents/connect' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { provider?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const provider = typeof body?.provider === 'string' ? body.provider : '';
    const status = (await (onboardingProbe ?? defaultProviderProbe).get(true)).providers.find((p) => p.id === provider);
    if (!status) {
      sendJson(res, 404, { error: `unknown provider '${provider}'`, state: 'unknown' });
      return true;
    }
    if (status.state !== 'ready') {
      sendJson(res, 409, {
        error:
          status.state === 'signIn'
            ? `${status.label} is signed out`
            : status.state === 'install'
              ? `${status.label} is not installed`
              : status.state === 'adapter'
                ? `${status.label} needs its bridge, claude-agent-acp (${status.adapterInstall ?? 'npm install -g claude-agent-acp'})`
                : `${status.label} is not ready`,
        state: status.state,
        signInCommand: status.signInCommand,
        installHint: status.installHint,
      });
      return true;
    }
    const launch = agentLaunch(provider, opts.providerSearch ?? {});
    if (!launch.ok) {
      sendJson(res, 409, { error: launch.message, state: launch.reason });
      return true;
    }
    const agent: AgentEntry = { id: provider, command: launch.command, ...(launch.args.length ? { args: launch.args } : {}), label: launch.label };
    try {
      const agents = addAgent(userConfigDir, agent);
      /* 0.1.5 G1: a (re)connect is a person asking again: an old failed or cached read does not stand. */
      forgetAgentCapabilities(provider);
      sendJson(res, 200, { agent, agents });
    } catch (e) {
      sendError(res, 409, (e as Error).message);
    }
    return true;
  }

  // ---- GET /api/acp/capabilities?agentRef=[&refresh=1] (S2b) ----
  // What the agent offers the model picker and the `/` menu: its models and
  // reasoning efforts, its own slash commands, its skills. Asked of a short-
  // lived agent process once per agent per server (codex model/list +
  // skills/list; an ACP agent's session/new config options and commands),
  // then cached; `refresh=1` asks again.
  if (pathname === '/api/acp/capabilities' && method === 'GET') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    const agentRef = url.searchParams.get('agentRef') ?? '';
    const entry = agentRef ? getAgent(userConfigDir, agentRef) : undefined;
    if (!entry) {
      sendError(res, 400, `unknown agentRef '${agentRef}'`);
      return true;
    }
    if (url.searchParams.get('refresh') === '1') {
      agentCapabilities.delete(agentRef);
      capabilitiesGate.reset(agentRef);
    }
    let pending = agentCapabilities.get(agentRef);
    if (!pending) {
      /* This GET would START an agent, and a Docker one starts a container. A cross-site <img> sends no Origin, so
         the gate lets it through: a sandboxed agent starts only from a request that proves it is the page itself
         (an Origin the gate allowed, or the browser's own same-origin marker). */
      if (isSandboxed(entry.args, entry.command)) {
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        if (!(typeof origin === 'string' && origin !== '') && site !== 'same-origin' && site !== 'none') {
          sendError(res, 403, 'a sandboxed agent is started only from the app itself, not from a link or another site');
          return true;
        }
      }
      const verdict = capabilitiesGate.check(agentRef);
      if (!verdict.allowed) {
        sendJson(res, 503, {
          error: `the agent could not say what it offers: ${verdict.lastError}`,
          gaveUp: verdict.gaveUp,
          retryInMs: verdict.retryInMs,
          failures: verdict.failures,
          ...recoveryForResponse(new Error(verdict.lastError)),
        });
        return true;
      }
      pending = (async () => {
        const client = createAgentClient({
          command: entry.command,
          ...(entry.args ? { args: entry.args } : {}),
          cwd: acpProjectRoot() ?? entry.cwd ?? process.cwd(),
          accessMode: 'propose',
          ...(opts.acpTurn?.spawn ? { spawn: opts.acpTurn.spawn } : {}),
          ...(opts.acpTurn?.killGraceMs !== undefined ? { killGraceMs: opts.acpTurn.killGraceMs } : {}),
        });
        try {
          await client.start();
          if (!client.capabilities) return { models: [], commands: [], skills: [], configOptions: [] };
          return await client.capabilities();
        } finally {
          await client.dispose().catch(() => {});
        }
      })();
      agentCapabilities.set(agentRef, pending);
      pending.then(
        () => capabilitiesGate.succeed(agentRef),
        (e) => {
          agentCapabilities.delete(agentRef);
          capabilitiesGate.fail(agentRef, e);
        },
      );
    }
    try {
      const caps = await pending;
      sendJson(res, 200, { agentRef, models: caps.models, efforts: caps.efforts ?? [], commands: caps.commands, skills: caps.skills });
    } catch (e) {
      sendError(res, 502, `the agent could not say what it offers: ${(e as Error).message}`, recoveryForResponse(e));
    }
    return true;
  }


  // shared session survives for other requests (reaped by the idle TTL / cap).
  // ---- GET/POST /api/acp/full-access — the one-time per-project confirmation ----
  // GET → { confirmed, prompt }. POST { confirm: true } records it in the
  // project's gitignored .sequence/ store; nothing else records anything.
  if (pathname === '/api/acp/full-access' && (method === 'GET' || method === 'POST')) {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    const project = acpProjectRoot();
    if (method === 'GET') {
      sendJson(res, 200, { confirmed: await hasFullAccessConsent(project), prompt: FULL_ACCESS_PROMPT, projectKey: project });
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { confirm?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (body?.confirm !== true) {
      sendError(res, 400, `body must be {"confirm": true} to confirm: "${FULL_ACCESS_PROMPT}"`);
      return true;
    }
    if (!project) {
      sendError(res, 400, 'no project: attach a repository (or pass ?agentRef= for an agent with a configured cwd)');
      return true;
    }
    try {
      recordFullAccessConsent(project);
    } catch (e) {
      sendError(res, 400, (e as Error).message);
      return true;
    }
    sendJson(res, 200, { confirmed: true, prompt: FULL_ACCESS_PROMPT, projectKey: project });
    return true;
  }

  /*
   * ---- GET /api/acp/runs?chatId=  → { runs }  (round 9) ----
   * ---- GET /api/acp/turn-log?chatId= → { turns } ----
   * The chat's agent turns as the run-node handler recorded them
   * (agentChatStore.ts), so a relaunch shows the conversation again; and
   * each turn's diagnostic record (no words), for the run's details.
   */
  /*
   * GET  /api/import/sessions        → { sessions }  Claude Code / Codex CLI sessions that ran in the opened repo
   * POST /api/import/session { source, providerSessionId } → { chatId, turns, already }
   * Read-only on the CLIs' folders (importHistory.ts); the chat is written to Sequence's own store.
   */
  /* The CLIs' folders are this machine's user's: a hosted (signed-in) server never reads them. */
  if (pathname.startsWith('/api/import/') && authOn) {
    sendError(res, 403, 'importing CLI history is only available when Sequence runs on your own machine');
    return true;
  }
  /* Imported chats resume through ACP, so the kill switch covers them. */
  if (pathname.startsWith('/api/import/') && !acpGate().available) {
    sendError(res, 403, acpGate().reason ?? 'ACP is not available');
    return true;
  }
  if (pathname === '/api/import/sessions' && method === 'GET') {
    sendJson(res, 200, { sessions: await listImportable(sessionsRoot(), opts.importHomes) });
    return true;
  }
  if (pathname === '/api/import/session' && method === 'POST') {
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let b: { source?: unknown; providerSessionId?: unknown };
    try {
      b = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const source = b.source === 'claude' || b.source === 'codex' ? b.source : null;
    const id = typeof b.providerSessionId === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(b.providerSessionId) ? b.providerSessionId : null;
    if (!source || !id) {
      sendError(res, 400, 'body must carry source ("claude" or "codex") and providerSessionId');
      return true;
    }
    const out = await importSession(sessionsRoot(), source, id, opts.importHomes);
    if (!out.ok) sendError(res, out.reason === 'not-found' ? 404 : 422, out.reason === 'too-large' ? 'That session is too large to import.' : out.reason === 'empty' ? 'That session has no messages to import.' : 'That session was not found for this project.');
    else sendJson(res, 200, out);
    return true;
  }

  /* POST /api/acp/auto-resume { chatId, resetsAt } → { claimed }  (one sender per chat and limit window)
     POST /api/acp/auto-resume { chatId, resetsAt, decline: true } → { declined }  ("Don't" on that limit window) */
  if (pathname === '/api/acp/auto-resume' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let b: { chatId?: unknown; resetsAt?: unknown; decline?: unknown };
    try {
      b = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (typeof b.chatId !== 'string' || b.chatId === '') {
      sendError(res, 400, 'body must carry "chatId"');
      return true;
    }
    if (b.decline === true) sendJson(res, 200, { declined: typeof b.resetsAt === 'number' && declineAutoResume(sessionsRoot(), b.chatId, b.resetsAt) });
    else sendJson(res, 200, { claimed: typeof b.resetsAt === 'number' && claimAutoResume(sessionsRoot(), b.chatId, b.resetsAt) });
    return true;
  }

  /* POST /api/acp/stop { turnId } → { stopped }  (Stop for a turn this page did not start: after a reload the
     browser has no stream to drop, so the server is asked to cancel the turn by its id) */
  if (pathname === '/api/acp/stop' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let b: { turnId?: unknown };
    try {
      b = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (typeof b.turnId !== 'string' || b.turnId === '') {
      sendError(res, 400, 'body must carry "turnId"');
      return true;
    }
    let stopped = false;
    for (const held of activeAcpTurns.values()) {
      if (held.rt.turnId === b.turnId) {
        held.stop();
        stopped = true;
      }
    }
    /* A chat turn (running or still queued): its stream closing no longer stops it, so Stop names it. */
    const ch = acpTurnChannels.get(b.turnId);
    if (ch && !ch.ended) {
      ch.stop();
      stopped = true;
    }
    sendJson(res, 200, { stopped });
    return true;
  }

  /* GET /api/acp/live → { turns: [{ turnId, chatId, agentRef, prompt, startedAt }] }: the chat turns running now,
     so a page that reloaded (or opened another workspace) follows every one of them again. */
  if (pathname === '/api/acp/live' && method === 'GET') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    sendJson(res, 200, { turns: acpTurnChannels.live() });
    return true;
  }

  /* GET /api/acp/attach?turnId= (event stream): what the turn streamed so far, then the rest of it live.
     404 when the turn is not running (it ended: its record is in GET /api/acp/runs). Closing it never stops the turn. */
  if (pathname === '/api/acp/attach' && method === 'GET') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    const ch = acpTurnChannels.get(url.searchParams.get('turnId') ?? '');
    if (!ch || ch.ended) {
      sendError(res, 404, 'no running turn with that turnId');
      return true;
    }
    startSse(res);
    const detach = ch.attach({
      send: (event) => {
        if (!res.writableEnded) writeSseData(res, event);
      },
      end: () => {
        if (!res.writableEnded) res.end();
      },
    });
    res.once('close', detach);
    return true;
  }

  if ((pathname === '/api/acp/runs' || pathname === '/api/acp/turn-log') && method === 'GET') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    const chatId = url.searchParams.get('chatId') ?? '';
    if (!chatId) {
      sendError(res, 400, 'query must carry "chatId"');
      return true;
    }
    if (pathname === '/api/acp/runs' && url.searchParams.has('older')) {
      /* Older turns kept in the chat's archive, a page at a time: ?older=<turns already loaded from its end>. */
      const page = readArchivePage(sessionsRoot(), chatId, Number(url.searchParams.get('older')) || 0);
      sendJson(res, 200, { runs: runsForWire(page.runs), remaining: page.remaining });
    } else if (pathname === '/api/acp/runs') {
      const read = readAgentRunsChecked(sessionsRoot(), chatId);
      sendJson(res, 200, { runs: runsForWire(read.runs), ...(read.damaged ? { damaged: read.damaged } : {}), ...(read.archived ? { archived: read.archived } : {}) });
    }
    else sendJson(res, 200, { turns: readTurnLog(sessionsRoot(), chatId, userConfigDir) });
    return true;
  }

  // ---- POST /api/acp/steer { sessionKey, text } (S5) ----
  // Puts the person's words into the turn the chat's agent is running (codex
  // `turn/steer`). No live client, or one that cannot steer (every ACP
  // agent), is a 409 `{ steered: false, reason: 'no-steer' }`; the page then
  // queues the text for after the turn. A steer codex refuses is a 200
  // carrying `steered: false` and its reason.
  if (pathname === '/api/acp/steer' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { sessionKey?: unknown; text?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (typeof body?.sessionKey !== 'string' || typeof body.text !== 'string') {
      sendError(res, 400, 'body must carry "sessionKey" and "text" strings');
      return true;
    }
    const c = acpSessions.peek(body.sessionKey);
    if (!c || !canSteer(c)) {
      sendJson(res, 409, { steered: false, reason: 'no-steer' });
      return true;
    }
    const answer = await c.steer(body.text);
    /* A steer the agent took is part of the turn: kept with its record so a reload draws it (`chat::<chat>::<agent>`). */
    const key = /^chat::(.+)::([^:]+)$/.exec(body.sessionKey);
    if (key && (answer as { steered?: unknown }).steered === true) {
      try {
        recordSteer(sessionsRoot(), key[1]!, key[2]!, body.text);
      } catch {
        /* an unwritable chat costs the saved bubble, never the steer */
      }
    }
    sendJson(res, 200, answer);
    return true;
  }

  // ---- POST /api/acp/permission { requestId, decision: 'allow' | 'deny' } ----
  // Answers ONE approval a streamed, interactive run-node announced with
  // `acp:permission` { pending: true, requestId }. Unknown or already-settled
  // ids are a 404: an answer that arrives late must not look accepted.
  if (pathname === '/api/acp/permission' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { requestId?: unknown; decision?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const decision = body?.decision;
    if (decision !== 'allow' && decision !== 'deny' && decision !== 'always') {
      sendError(res, 400, 'body must carry "decision": "allow", "always" or "deny"');
      return true;
    }
    const settle = typeof body.requestId === 'string' ? pendingAcpApprovals.get(body.requestId) : undefined;
    if (!settle) {
      sendError(res, 404, 'no pending approval with that requestId');
      return true;
    }
    settle(decision, 'person');
    sendJson(res, 200, { requestId: body.requestId, decision });
    return true;
  }

  // ---- POST /api/acp/question { requestId, answers } | { requestId, cancel: true } ----
  // Answers ONE question a streamed, interactive run-node announced with
  // `acp:question` { pending: true, requestId }: `answers` maps each question
  // id to the answers given (an option's label, or the person's own words).
  // `cancel` answers with none, and the agent goes on without. Unknown or
  // already-settled ids are a 404.
  if (pathname === '/api/acp/question' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { requestId?: unknown; answers?: unknown; cancel?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const cancel = body?.cancel === true;
    if (!cancel && !isQuestionAnswers(body?.answers)) {
      sendError(res, 400, 'body must carry "answers" ({ questionId: string[] }) or "cancel": true');
      return true;
    }
    const settle = typeof body.requestId === 'string' ? pendingAcpQuestions.get(body.requestId) : undefined;
    if (!settle) {
      sendError(res, 404, 'no pending question with that requestId');
      return true;
    }
    settle(cancel ? null : (body.answers as AgentQuestionAnswers), cancel ? 'cancel' : 'person');
    sendJson(res, 200, { requestId: body.requestId, ...(cancel ? { cancelled: true } : { answered: true }) });
    return true;
  }

  return false;
}
