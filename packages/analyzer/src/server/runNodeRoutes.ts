/**
 * POST /api/acp/run-node, moved out of repoServer.ts unchanged: ONE ACP prompt turn against a named local agent (a program node, a typed
 * agent message, a goal-run turn). It has its own pipeline and is deliberately not part of the ask core.
 *
 * Owner, ACP gate and live state arrive as callbacks and getters; nothing here closes over createRepoServer state.
 */

import { ASK_LEDGER_INSTRUCTION, isAskAgain, parseAskLine, stripAskLine } from '@sequence/schema';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { type ArchGraph } from '@sequence/schema';
import type { Unvalidated, PostAcpRunNodeRequest, PostAcpRunNodeResponse } from '@sequence/api-types';
import { diffPaths } from './snapshot.js';
import { TurnSnapshotGate } from './turnSnapshotGate.js';
import { clearUsageLimit, recordUsageLimit } from './agentLimits.js';
import { AgentEventHub } from './agentEvents.js';
import { RunNodeEventFeed } from './runNodeAgentEvents.js';
import { agentMapBlockForThread, markMapBlock, readAgentSettings } from './askAgentMap.js';
import { genuiIngestUrl } from './genuiRoutes.js';
import { referencedDrawingIds, sequenceMcpServer } from './sequenceMcp.js';
import { reaAgentServer } from '../components/reaInstall.js';
import { resolveRunNodeAttachments } from './runNodeAttachments.js';
import { handoffPrompt, planHandoffBudgeted, type HandoffKind } from './agentHandoff.js';
import { seededPrompt, settledRewind, settleRewind } from './agentRewind.js';
import { nodeContextPrompt } from '../agentMap.js';
import { getAgent } from './agentsStore.js';
import { AccessModeRefusedError, allowsTool, planRefuses, PLAN_REFUSAL, commandPrefix, agentKindOf, recoveryOf as acpRecoveryOf, ResumeUnavailableError, TurnHungError, TurnWatchdog, systemWatchdogClock, type WatchdogClock, createAgentClient, defaultPermissionPolicy, type AcpAgentClient, type AgentQuestionAnswers, type AgentQuestionRequest, type AcpClientConfig, type AgentTurnHooks, type AgentMode, type PromptAttachment, type PermissionDecision, type TurnUsage } from '@sequence/acp';
import { FULL_ACCESS_PROMPT, hasFullAccessConsent } from './fullAccessConsent.js';
import { type AcpSessionCache } from './acpSessionCache.js';
import { AgentTurnRuntime } from './agentTurnRuntime.js';
import { readAgentRuns } from './agentChatStore.js';
import { DEFAULT_DETACH_GRACE_MS, TurnChannel, TurnChannels } from './turnChannels.js';
import { readSessionChat, readAgentThread, type AgentThreadRef, type PendingRewind, writeAgentThread, readSessionWorktree } from './sessionsStore.js';
import { cacheFile as historyCacheFile, historyBudgetTokens, type HistorySummarizer } from './askHistory.js';
import { readGoalRun } from './goalRunner.js';
import { isCheckpointSessionId } from './checkpointStore.js';
import { StreamCoalescer, acpTextOf, acpWithText } from './streamCoalescer.js';
import { capAcpEvent, streamBodyDir } from './streamBodies.js';
import { probeEffectiveContextCached } from './askMemo.js';
import { OfferBook, COMPONENTS_OFF_MESSAGE, componentEvents, markComponents, planComponents } from '../components/inject.js';
import { bundledCatalogRoot, loadMergedCatalog } from '../components/catalog.js';
import { readComponentSettings, componentsLaunchOpts } from '../components/settings.js';
import { ThreadNoteLedger, buildAgentBlock, markAgentBlock } from '../harness/refineNotes.js';
import { worseNoteIds } from '../harness/refineOutcome.js';
import { listRefineProposals } from '../harness/refineProposal.js';
import { isLocalOllama, askHistoryWindow } from './localProviders.js';
import { type AiConfig } from './provider.js';
import { MAX_BODY_BYTES, sendJson, sendError, isJsonRequest, readBody, startSse, writeSseData, wantsEventStream } from './routeHttp.js';
import type { RepoServerOptions, GoalLease } from './repoServer.js';
/** The component ids a run-node body asks for (the + menu, /components <id>, an accepted card). */
function forcedComponentIds(body: object): string[] {
  const c = (body as { components?: unknown }).components;
  return Array.isArray(c) ? [...new Set(c.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, 8) : [];
}

/* ==================== WAVE 1 ITEM 1.10 — ACP PERMISSIONS =====================
 * The two notification/permission parameter types are derived FROM the config
 * this server already passes rather than re-declared here, so they can never
 * drift from `@sequence/acp`'s contract, and so this file needs no dependency on
 * the ACP SDK it does not otherwise speak.
 */
export type AcpPermissionRequest = Parameters<NonNullable<AcpClientConfig['onPermission']>>[0];
export type AcpSessionNotification = Parameters<NonNullable<AcpClientConfig['onUpdate']>>[0];

/** Where a turn's `session/update` and permission events go. */
export interface AcpTurnSink {
  onUpdate: (n: AcpSessionNotification) => void;
  /** Real progress (turnWatchdog.ts): the idle countdown starts over. */
  onProgress: () => void;
  /** S3 turn snapshots for this turn's chat (codex bridge, in-process). */
  turnHooks?: AgentTurnHooks;
  /** May wait: an interactive approval resolves when the person answers. */
  onPermission: (r: AcpPermissionRequest) => PermissionDecision | Promise<PermissionDecision>;
  /** May wait: the agent's question (codex requestUserInput), answered by the person or with none. */
  onQuestion: (q: AgentQuestionRequest, signal: AbortSignal) => Promise<AgentQuestionAnswers | null>;
}

/**
 * An approval request as the edit approval card already draws one
 * (`web2/src/chat/EditApprovalCard.tsx` props: proposalId, title, rationale,
 * files[{ path, diff, decision }]). A codex file change carries its own unified
 * diff in `rawInput.changes`; an ACP agent's request names its paths in
 * `locations`, with no diff, which the card renders as "no diff".
 */
function acpApprovalProposal(requestId: string, r: AcpPermissionRequest): Record<string, unknown> {
  const raw = (r.toolCall?.rawInput ?? {}) as { changes?: unknown; reason?: unknown };
  const changes = Array.isArray(raw.changes) ? (raw.changes as { path?: unknown; diff?: unknown; kind?: unknown }[]) : [];
  /* `kind` is codex's PatchChangeKind type ('add' | 'delete' | 'update'). It
     says what `diff` holds: a new file's content, an old file's content, or
     unified hunks. The card needs it to draw the right diff; without it the
     client has to guess from the text. */
  const fromChanges = changes
    .filter((c) => typeof c.path === 'string')
    .map((c) => {
      const kind = (c.kind as { type?: string } | undefined)?.type;
      return {
        path: c.path as string,
        diff: typeof c.diff === 'string' ? c.diff : null,
        kind: typeof kind === 'string' ? kind : null,
        decision: 'pending',
      };
    });
  const files =
    fromChanges.length > 0
      ? fromChanges
      : (r.toolCall?.locations ?? []).map((l) => ({ path: l.path, diff: null, kind: null, decision: 'pending' }));
  return {
    proposalId: requestId,
    title: r.toolCall?.title ?? null,
    rationale: typeof raw.reason === 'string' ? raw.reason : null,
    files,
    /* S2b: Claude's ExitPlanMode carries its plan; the page shows it in the plan card. */
    ...(typeof (raw as { plan?: unknown }).plan === 'string' ? { plan: (raw as { plan: string }).plan } : {}),
  };
}

/**
 * The prefix an "Always" answer to this request would cover (`npm test`,
 * `git checkout`), or null when the request is not a command. Read from the
 * command the agent sent (codex and Claude's adapter both carry
 * `rawInput.command`), falling back to a `Run <command>` title.
 */
function acpAlwaysPrefix(r: AcpPermissionRequest): string | null {
  if (r.toolCall?.kind !== 'execute') return null;
  const raw = (r.toolCall?.rawInput ?? {}) as { command?: unknown };
  const cmd = Array.isArray(raw.command)
    ? raw.command.filter((x): x is string => typeof x === 'string').join(' ')
    : typeof raw.command === 'string'
      ? raw.command
      : (r.toolCall?.title ?? '').replace(/^Run\s+/, '');
  return cmd.trim() ? commandPrefix(cmd) : null;
}

/**
 * The autonomy dial for one ACP turn. Each wire value names ONE Sequence
 * access mode (`@sequence/acp` `accessMode.ts`), which reaches the agent
 * unchanged. Claude's own names and Sequence's are both accepted:
 *
 *  - `default` / `propose`         — Ask: read/fetch/search/think only.
 *                                    Byte-identical to the pre-1.10 decision.
 *  - `acceptEdits` / `autoEdit`    — Auto-edit: additionally allows `edit`,
 *                                    never `execute`/`delete`/`move`.
 *  - `plan`                        — read-only planning.
 *  - `bypassPermissions` / `full`  — Full access: skip permissions. Needs the
 *                                    project's one-time confirmation
 *                                    (`fullAccessConsent.ts`).
 */
const ACP_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'propose',
  'autoEdit',
  'full',
] as const;
type AcpPermissionMode = (typeof ACP_PERMISSION_MODES)[number];

const ACP_WIRE_TO_AGENT_MODE: Record<AcpPermissionMode, AgentMode> = {
  default: 'propose',
  propose: 'propose',
  acceptEdits: 'autoEdit',
  autoEdit: 'autoEdit',
  plan: 'plan',
  bypassPermissions: 'full',
  full: 'full',
};

/** Absent ⇒ `default`. A PRESENT but unrecognised value is a 400, never a guess. */
function parseAcpPermissionMode(
  raw: unknown,
): { mode: AcpPermissionMode; agentMode: AgentMode } | { error: string } {
  if (raw === undefined || raw === null) return { mode: 'default', agentMode: 'propose' };
  if (typeof raw !== 'string' || !(ACP_PERMISSION_MODES as readonly string[]).includes(raw)) {
    return {
      error: `"permissionMode" must be one of: ${ACP_PERMISSION_MODES.join(', ')}`,
    };
  }
  const mode = raw as AcpPermissionMode;
  return { mode, agentMode: ACP_WIRE_TO_AGENT_MODE[mode] };
}

function acpPermissionDecision(r: AcpPermissionRequest, mode: AgentMode): PermissionDecision {
  if (mode === 'propose') return defaultPermissionPolicy(r);
  return allowsTool(mode, r.toolCall?.kind ?? undefined) ? 'allow' : 'deny';
}

export interface RunNodeRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  acpGate: () => { available: boolean; originOk: boolean; reason?: string };
  acpProjectRoot: () => string | null;
  sessionsRoot: () => string;
  getRoot: () => string | null;
  getGraph: () => ArchGraph | null;
  sessionId: string | undefined;
  identity: string;
  userConfigDir: string;
  userConfigDirFor: (sessionId: string | undefined) => string;
  opts: RepoServerOptions;
  loadAiConfig: () => AiConfig | undefined;
  askWorkspaceRoot: () => string | null;
  historySummarizerFor: (cfg: AiConfig | undefined, identity: string) => HistorySummarizer | undefined;
  acpSessions: AcpSessionCache;
  activeAcpTurns: Map<string, { rt: AgentTurnRuntime; stop: () => void }>;
  acpTurnChannels: TurnChannels;
  pendingAcpApprovals: Map<string, (d: PermissionDecision, by: 'person') => void>;
  pendingAcpQuestions: Map<string, (answers: AgentQuestionAnswers | null, by: 'person' | 'cancel') => void>;
  acpTurnSinks: Map<string, AcpTurnSink>;
  acpChatRules: Map<string, Set<string>>;
  acpApprovalTimeoutMs: number;
  noteLedger: ThreadNoteLedger;
  noteThreads: Map<string, string>;
  componentOffers: OfferBook;
  componentTurns: Map<string, (event: Record<string, unknown>) => void>;
  liveTurnRoots: Map<string, number>;
  liveChatTurns: Map<string, number>;
  goalLeases: Map<string, GoalLease>;
  snapshotGate: TurnSnapshotGate;
  agentEvents: AgentEventHub;
  /** Adds to the count of turns in flight (the idle warmer waits while any run) and returns the new count. */
  adjustRunningTurns: (delta: number) => number;
}

export function isRunNodeRoutePath(pathname: string): boolean {
  return pathname === '/api/acp/run-node';
}

/** Handle the POST /api/acp/run-node routes. Returns false when the request is not one of ours. */
export async function handleRunNodeRoute(ctx: RunNodeRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { acpGate, acpProjectRoot, sessionsRoot, sessionId, identity, userConfigDir, userConfigDirFor, opts, loadAiConfig, askWorkspaceRoot, historySummarizerFor, acpSessions, activeAcpTurns, acpTurnChannels, pendingAcpApprovals, pendingAcpQuestions, acpTurnSinks, acpChatRules, acpApprovalTimeoutMs, noteLedger, noteThreads, componentOffers, componentTurns, liveTurnRoots, liveChatTurns, goalLeases, snapshotGate, agentEvents, adjustRunningTurns } = ctx;
  const { getRoot, getGraph } = ctx;
  // ---- POST /api/acp/run-node { agentRef, prompt, cwd?, sessionKey? } ----
  // Runs ONE ACP prompt turn against the named local agent and returns the REAL
  // { stopReason, text } (never fabricated). Honest errors: unknown agentRef → 400;
  // not local → 403; a spawn / protocol failure → 502.
  //
  // r31 — SESSION CONTINUITY. When the body carries a valid string `sessionKey`
  // (`${runScope}::${agentRef}`; omitted when a node opts out via
  // shareSession===false), the turn runs on ONE cached live session per key
  // (spawn + newSession on first use, reuse thereafter) and turns on that key
  // SERIALIZE — so two nodes sharing a session can't interleave prompts. The key
  // is OPAQUE: never parsed, trusted, or logged. No `sessionKey` (or a non-string /
  // empty one) → the original FRESH-session-per-call path below, byte-identical.
  // Either way a client disconnect aborts the in-flight turn (ACP cancel); on the
  // fresh path dispose() also kills the subprocess, while on the cached path the
  if (pathname === '/api/acp/run-node' && method === 'POST') {
    const g = acpGate();
    if (!g.available) {
      sendError(res, 403, g.reason ?? 'ACP is not available');
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    // `permissionMode` is item 1.10's opt-in and is not yet in the shared wire
    // contract (`@sequence/api-types` is another owner's file this wave); it is
    // narrowed here exactly as every other field on this body is.
    // `contextNodeId` ("Ask an agent about this", from a board node) is narrowed
    // the same way: the SERVER cuts that node's map slice from the graph it holds,
    // so the context is grounded and a client cannot hand in its own.
    let body: Unvalidated<PostAcpRunNodeRequest> & {
      permissionMode?: unknown;
      contextNodeId?: unknown;
      interactivePermissions?: unknown;
      /** The chat thread the turn belongs to (its Always rules, its agent thread). */
      chatId?: unknown;
      /** S2b: a compaction turn (no prompt). */
      compact?: unknown;
      /** The ask ledger (t3gap/asks): the person's setting, on or off. */
      askLedger?: unknown;
      /** S2b: { model?, effort? } for this agent. */
      config?: unknown;
      /** What the person typed, when `prompt` is the agent's copy (the kit's private hint, attached drawings). Only this is saved, titled and shown. */
      display?: unknown;
      /** S2a: images, files and board nodes for the agent (runNodeAttachments.ts). */
      attachments?: unknown;
    };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const agentRef = typeof body.agentRef === 'string' ? body.agentRef.trim() : '';
    const asked = typeof body.prompt === 'string' ? body.prompt : '';
    /* The agent gets `asked`; the chat keeps `shown`: the person's own words, never the private context sent with them. */
    const shown = typeof body.display === 'string' && body.display.trim() !== '' ? body.display : asked;
    /* A GOAL RUN'S TURNS STAY IN THE REPO THE RUN STARTED IN. The run's own lease names its root; the turn is bound to it only
       when the body carries that lease's chat and session key, so a caller cannot name an arbitrary root. Without this a
       switch to another repo mid-run sent the next turn to the new repo's cwd, which also dropped the agent's session. */
    const turnLease = typeof body.chatId === 'string' ? goalLeases.get(body.chatId) : undefined;
    const turnRepoRoot: string | null = turnLease && typeof body.sessionKey === 'string' && body.sessionKey === turnLease.sessionKey ? turnLease.root : getRoot();
    const turnSessionsRoot = (): string => (turnRepoRoot !== null ? turnRepoRoot : sessionsRoot());
    if (agentRef === '') {
      sendError(res, 400, 'body must include a non-empty string "agentRef"');
      return true;
    }
    /* S2b: a compaction is a turn with no prompt (codex thread/compact/start, ACP /compact). */
    const compacting = body.compact === true;
    if (asked.trim() === '' && !compacting) {
      sendError(res, 400, 'body must include a non-empty string "prompt"');
      return true;
    }
    /* S2b: the model and effort the person picked for this agent (codex turn/start overrides, ACP set_config_option). */
    const rawConfig = (body.config ?? {}) as { model?: unknown; effort?: unknown };
    const turnConfig = {
      ...(typeof rawConfig.model === 'string' && rawConfig.model ? { model: rawConfig.model } : {}),
      ...(typeof rawConfig.effort === 'string' && rawConfig.effort ? { effort: rawConfig.effort } : {}),
    };
    /* The Agents tree: this turn's tools, under its chat (runNodeAgentEvents.ts). */
    let turnFeed: RunNodeEventFeed | null = null;
    const runTheTurn = async (client: AcpAgentClient, signal: AbortSignal) => {
      if (turnConfig.model || turnConfig.effort) await client.setTurnConfig?.(turnConfig);
      /* Round 7 (A3): the model this turn runs on, as the agent stated it, so the pill and the status bar name it. */
      const model = client.activeModel?.();
      if (model) {
        emitAcp({ type: 'acp:model', model });
        turnRt?.setModel(model);
      }
      /* The provider's own id for this turn, noted whether the turn ends well or not: a turn it never accepted is not in its thread. */
      const noteProviderTurn = (): void => {
        if (client.lastTurnId) turnRt?.setProviderTurn(client.lastTurnId() ?? null);
      };
      if (compacting) {
        if (!client.compact) throw new Error('this agent cannot compact its context');
        try {
          return await client.compact({ signal });
        } finally {
          noteProviderTurn();
        }
      }
      const feed = chatId ? new RunNodeEventFeed({ sink: agentEvents, sessionId: chatId, source: provider === 'codex' ? 'codex' : 'acp', root: turnRoot, cwd, title: shown }) : null;
      turnFeed = feed;
      feed?.start();
      let componentKey: string | null = null;
      try {
        turnRt?.sent();
        const seed = seedOwed;
        /* What the chat owes this agent (agentHandoff.ts): the chat so far when its thread is new or it never spoke here,
           what it missed when it comes back to a chat that moved on without it. Worked out from what is saved, so a first
           prompt that failed before reaching the agent leaves it owed. */
        let owed: { kind: HandoffKind; text: string } | null = null;
        try {
          const hr = chatId ? turnSessionsRoot() : null;
          if (!seed && opened !== 'rewind' && hr && chatId) {
            /* Sized from the model window and summarized past it, not cut at 12k characters (agentHandoff.ts). */
            /* NO NEW EGRESS: an agent's transcript is summarized by a model only when that model is local (Ollama on
               loopback); otherwise the extractive summary is used and no provider is called. */
            const hcfg = loadAiConfig();
            const localModel = hcfg !== undefined && isLocalOllama(hcfg.provider, hcfg.baseUrl);
            const hwin = localModel ? await askHistoryWindow(hcfg.provider, hcfg.baseUrl, hcfg.model, fetch, probeEffectiveContextCached) : undefined;
            const summarize = localModel ? historySummarizerFor(hcfg, identity) : undefined;
            owed = await planHandoffBudgeted(
              readSessionChat(hr, chatId),
              readAgentRuns(hr, chatId),
              { forAgent: agentRef, ...(turnRt ? { currentTurnId: turnRt.turnId } : {}), currentPrompt: shown, threadReopened: opened !== 'new' },
              {
                cacheFile: historyCacheFile(hr, chatId, 'handoff-summary.json'),
                ...(summarize ? { summarize } : {}),
                ...(hwin !== undefined && hcfg ? { window: hwin, budgetTokens: historyBudgetTokens(hwin, hcfg.model) } : {}),
              },
            );
          }
        } catch {
          owed = null;
        }
        let done: Awaited<ReturnType<typeof client.prompt>>;
        /* The repo's accepted notes and skills go in FRONT of the person's message, once per thread:
           the first turn carries them, later turns carry only what is new. */
        /* A chat-less turn on a reused ACP session (a board node ask) is keyed by that session, so the same provider thread is not told everything again each turn. */
        const adhocSession = typeof body.sessionKey === 'string' && body.sessionKey !== '' ? body.sessionKey : null;
        const noteKey = chatId ? `chat::${chatId}::${agentRef}` : adhocSession ? `adhoc::${adhocSession}` : `adhoc::${agentRef}::${turnRt?.turnId ?? ''}`;
        const noteThread = noteThreads.get(noteKey) ?? null;
        componentKey = noteKey;
        componentTurns.set(noteKey, (ev) => emitAcp({ ...ev, turnId: turnRt?.turnId ?? '' }));
        const noteBlock = turnRepoRoot
          ? buildAgentBlock(turnRepoRoot, asked, noteKey, noteThread, noteLedger, worseNoteIds(turnRepoRoot, listRefineProposals(turnRepoRoot)))
          : { text: '', sent: [], tokens: 0, skillsSent: false };
        /* The architecture map (only when "Also send it to Claude and Codex" is on): once per thread, resent only when its hash changes (askAgentMap.ts).
           A node ask already carries that node's slice of it, so the whole map is not added on top. Its tokens are added to the notes entry of the turn log (injected() is a log record, not the ring). */
        const mapBlock = agentMapBlockForThread({ storeDir: userConfigDirFor(sessionId), repoRoot: turnRepoRoot ?? null, designMode: !turnRepoRoot || !!contextNodeId, key: noteKey, thread: noteThread, ledger: noteLedger });
        if (noteBlock.text || mapBlock) turnRt?.injected(noteBlock.tokens + (mapBlock?.tokens ?? 0), noteBlock.sent.length);
        /* Components: matched or asked for, never there by default (components/inject.ts). Offers and uses are announced to the chat. */
        const componentSettings = readComponentSettings(userConfigDirFor(sessionId));
        const componentCatalog = loadMergedCatalog(turnRepoRoot ?? null, bundledCatalogRoot());
        const componentPlan = planComponents({ catalog: componentCatalog, prompt: asked, enabled: componentSettings.enabled, mode: componentSettings.mode, forced: forcedComponentIds(body), noteKey, thread: noteThread, ledger: noteLedger, offers: componentOffers });
        for (const ev of componentEvents(componentPlan, turnRt?.turnId ?? '')) emitAcp(ev);
        try {
          const body = seed ? seededPrompt(seed, prompt) : owed ? handoffPrompt(owed.text, prompt, owed.kind) : prompt;
          /* Told only now, as the prompt that carries it goes out; the record keeps it for a reload. */
          if (owed && !seed) {
            turnRt?.handoff({ chars: owed.text.length, kind: owed.kind });
            emitAcp({ type: 'acp:handoff', agentRef, chars: owed.text.length, kind: owed.kind });
          }
          const lead = `${mapBlock?.text ?? ''}${componentPlan.text}${noteBlock.text}`;
          done = await client.prompt(lead ? `${lead}${body}` : body, { signal, ...(promptAttachments.length ? { attachments: promptAttachments } : {}) });
          if (turnRepoRoot) markAgentBlock(turnRepoRoot, noteKey, noteThread, noteLedger, noteBlock);
          if (mapBlock) markMapBlock(noteKey, noteThread, noteLedger, mapBlock.hash);
          markComponents(componentPlan, noteKey, noteThread, noteLedger, componentOffers, componentCatalog);
        } finally {
          noteProviderTurn();
        }
        if (seed) {
          /* The new thread has the kept conversation now; stop owing it. */
          seedOwed = '';
          try {
            const r = chatId ? turnSessionsRoot() : null;
            const t = r && chatId ? readAgentThread(r, chatId, agentRef) : null;
            if (r && chatId && t) writeAgentThread(r, chatId, agentRef, { id: t.id, kind: t.kind });
          } catch {
            /* Owing it once more costs a repeated recap, never the turn. */
          }
        }
        feed?.end(done.stopReason !== 'refusal', turnRt?.usageFor(done.usage) ?? null, done.stopReason === 'refusal' ? 'The agent refused this request.' : null);
        return done;
      } catch (e) {
        feed?.end(false, turnRt?.usageFor(null) ?? null, e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        if (turnFeed === feed) turnFeed = null;
        if (componentKey) {
          componentTurns.delete(componentKey);
          /* A chat-less run has no next prompt to carry an answer: its offers die with it. */
          if (!chatId) componentOffers.forget(componentKey);
        }
      }
    };
    let promptAttachments: PromptAttachment[] = [];
    if (forcedComponentIds(body).length > 0 && !readComponentSettings(userConfigDirFor(sessionId)).enabled) {
      sendError(res, 409, COMPONENTS_OFF_MESSAGE);
      return true;
    }
    const contextNodeId = typeof body.contextNodeId === 'string' && body.contextNodeId !== '' ? body.contextNodeId : null;
    if (contextNodeId && !getGraph()?.nodes.some((n) => n.id === contextNodeId)) {
      sendError(res, 400, `"contextNodeId" ${contextNodeId} is not a node of the attached repository's graph`);
      return true;
    }
    /* THE ASK LEDGER (setting on): a short private instruction after the
       person's words asks the agent to end a multi-request reply on one
       closing line. The agent does the splitting; the server only reads the
       line. Its own follow-up ("Your reply marked…") gets none. The person's
       message, the chat title and the saved turn keep their own words. */
    const ledgerOn = body.askLedger === true && !compacting && !isAskAgain(asked);
    const prompt = (contextNodeId && getGraph() ? nodeContextPrompt(getGraph()!, contextNodeId, asked) : asked) + (ledgerOn ? ASK_LEDGER_INSTRUCTION : '');
    const entry = getAgent(userConfigDir, agentRef);
    if (!entry) {
      sendError(res, 400, `unknown agentRef '${agentRef}' — register it with: sequence agent add ${agentRef} --command <bin>`);
      return true;
    }
    // v16 Finding 4 — CONTAIN the agent cwd to the attached repo root (getRoot),
    // mirroring the terminal (which pins cwd to getRoot()). A write-capable agent
    // must not run outside the repo. When a repo is attached, an explicit
    // `body.cwd` is honored ONLY if it resolves to a path INSIDE the root; an
    // absolute or `..`-escaping cwd is IGNORED and the turn runs at the root. With
    // no repo attached there is nothing to contain to, so we fall back to the
    // agent's OWN server-side configured cwd (never the caller-supplied one),
    // else the home workspace: the project Full access was confirmed for.
    let cwd = entry.cwd ?? askWorkspaceRoot() ?? undefined;
    const root = turnRepoRoot;
    /* S7 — A CHAT BOUND TO A WORKTREE RUNS IN IT (chatWorktree.ts). The
       worktree replaces the repo root as the jail for this turn, and its S3
       snapshots key on it below. A binding whose directory is gone refuses
       the turn rather than quietly running in the user's own checkout. */
    const boundChat = typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : null;
    const chatWorktree = root && boundChat ? readSessionWorktree(root, boundChat) : null;
    if (chatWorktree && !fs.existsSync(chatWorktree.path)) {
      sendError(res, 409, `this chat's worktree is missing (${chatWorktree.path}); remove it from the chat or restore it`);
      return true;
    }
    const turnRoot = chatWorktree ? chatWorktree.path : root ?? (body.permissionMode === 'full' || body.permissionMode === 'bypassPermissions' ? askWorkspaceRoot() : null);
    if (turnRoot) {
      cwd = turnRoot;
      const requested = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd : undefined;
      if (requested) {
        const resolved = path.resolve(turnRoot, requested);
        const rel = path.relative(turnRoot, resolved);
        if (resolved === turnRoot || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          cwd = resolved; // a contained subdirectory is allowed
        }
        // else: an escaping cwd is dropped — the turn stays pinned to the root.
      }
    }
    /* S2a: what the turn carries beside its text, resolved against what the server holds. */
    const resolvedAttachments = resolveRunNodeAttachments(body.attachments, { repoRoot: root, turnRoot, graph: getGraph() ?? null, chatId: boundChat });
    if ('error' in resolvedAttachments) {
      sendError(res, 400, resolvedAttachments.error);
      return true;
    }
    promptAttachments = resolvedAttachments.attachments;

    /* ================= WAVE 1 ITEM 1.10 — THE TWO ACP SEAMS ==================
     * Gap G9: both call sites constructed `new AcpClient(launch)` with launch
     * config ONLY. `AcpClientConfig` declares `onUpdate` and `onPermission`, and
     * the client already RECEIVES the agent's streamed `session/update`
     * notifications — so the HTTP bridge threw every one of them away, and every
     * permission request fell through to `defaultPermissionPolicy`, which denies
     * anything mutating. A local coding agent driven through Sequence was
     * read-only AND silent about it: the agent asked, the server said no, and
     * nobody was ever shown the question.
     *
     * What changes, and what deliberately does not:
     *  - `onUpdate` is wired on BOTH paths and surfaces the notification VERBATIM.
     *    It is not reshaped into an ask-stream `tool:start` row, because that
     *    projection discards the agent's own payload — the part a caller needs.
     *  - `onPermission` DEFAULTS TO EXACTLY THE OLD DECISION
     *    (`defaultPermissionPolicy`). By default the only difference is that the
     *    refusal is now VISIBLE. Allowing an edit is opt-in per request and is
     *    never inferred from the presence of a listener.
     */
    const parsedMode = parseAcpPermissionMode(body.permissionMode);
    if ('error' in parsedMode) {
      sendError(res, 400, parsedMode.error);
      return true;
    }
    const permissionMode = parsedMode.mode;
    const agentMode = parsedMode.agentMode;
    /* FULL ACCESS: one confirmation per project, then never again. Checked
       before anything spawns, so an unconfirmed request costs nothing. */
    if (agentMode === 'full' && !(await hasFullAccessConsent(acpProjectRoot()))) {
      sendError(res, 409, `Full access needs a one-time confirmation for this project: "${FULL_ACCESS_PROMPT}".`, {
        needsConfirmation: true,
        prompt: FULL_ACCESS_PROMPT,
      });
      return true;
    }
    const streaming = wantsEventStream(req, url);
    if (streaming) startSse(res);
    /* A CHAT TURN OUTLIVES ITS PAGE (turnChannels.ts): a streamed turn with a
       sessionKey keeps its events for a page that comes back after a reload,
       and its stream closing starts a grace instead of stopping the turn. */
    const channel =
      streaming && typeof body.sessionKey === 'string' && body.sessionKey !== ''
        ? new TurnChannel(
            { turnId: '', chatId: typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : null, agentRef, prompt: compacting ? '/compact' : shown, startedAt: Date.now() },
            { clock: opts.acpTurn?.clock ?? systemWatchdogClock, graceMs: opts.acpTurn?.detachGraceMs ?? DEFAULT_DETACH_GRACE_MS },
          )
        : null;
    /* The page that started the turn is gone (its socket closed): nothing more is written to it. */
    let ownerGone = false;
    if (channel) {
      res.once('close', () => {
        ownerGone = true;
        channel.ownerClosed();
      });
    }
    /* S6: text deltas merge within 50 ms, everything else flushes them and
       goes at once (streamCoalescer.ts); tool bodies over 8 KB are cut and
       kept beside the chat for GET /api/stream-body (streamBodies.ts). */
    const acpBodyDir = streamBodyDir({ repoRoot: root, chatId: boundChat, userConfigDir });
    const acpOut = new StreamCoalescer<Record<string, unknown>>({
      textOf: acpTextOf,
      withText: acpWithText,
      write: (event) => {
        if (streaming && !ownerGone && !res.writableEnded) writeSseData(res, event);
        channel?.push(event);
      },
      clock: opts.streamCoalesce?.clock ?? opts.acpTurn?.clock,
      windowMs: opts.streamCoalesce?.windowMs,
    });
    if (channel) channel.onEnd(() => acpOut.dispose());
    else if (streaming) res.once('close', () => acpOut.dispose());
    /* Gone, for a question put to the person: the stream closed, or (a chat turn) nobody came back within the grace. */
    const onTurnGone = (fn: () => void): (() => void) => {
      if (channel) return channel.onAbandoned(fn);
      res.once('close', fn);
      return () => res.off('close', fn);
    };
    const turnGone = (): boolean => (channel ? channel.abandoned : res.writableEnded);
    const emitAcp = (event: Record<string, unknown>): void => {
      if (streaming && !res.writableEnded) acpOut.push(capAcpEvent(event, acpBodyDir));
    };
    /* Round 9: the turn's live status, answered, record and log (agentTurnRuntime.ts). */
    let turnRt: AgentTurnRuntime | null = null;
    const onUpdate = (n: AcpSessionNotification): void => {
      turnRt?.update(n);
      turnFeed?.update(n);
      emitAcp({ type: 'acp:update', update: n });
    };
    /*
     * INTERACTIVE APPROVALS, OPT-IN. With `interactivePermissions: true` on a
     * STREAMED run, a request the mode would refuse is put to the person
     * instead: the stream announces it (`pending: true`, a `requestId`, and a
     * `proposal` in the edit approval card's own shape) and the turn waits for
     * `POST /api/acp/permission`. A request the mode already allows is not a
     * question and is answered at once. No opt-in, or no stream to show the
     * question on, is the old decision byte for byte. An unanswered question
     * falls back to the mode's own decision after the timeout, and to deny when
     * the stream closes: a turn must never wait on a person who has gone.
     */
    const interactive = streaming && body.interactivePermissions === true;
    /* The chat thread this turn belongs to, for its Always rules. */
    const chatId = typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : null;
    /*
     * S1 — ENDED, SETTLED, HUNG. A turn ends when the agent says so (its
     * stop reason), never on a wall clock. The watchdog (acp
     * turnWatchdog.ts) calls a turn hung only after `idleMs` without real
     * progress while nobody is being asked anything; then the turn is
     * stopped, the agent process is killed, and the person is offered a
     * Retry that resumes the same thread.
     */
    const turnClock: WatchdogClock = opts.acpTurn?.clock ?? systemWatchdogClock;
    let watchdog: TurnWatchdog | null = null;
    let hungMs = 0;
    let onHung: () => void = () => {};
    const watchTurn = (): TurnWatchdog => {
      watchdog = new TurnWatchdog({
        ...(opts.acpTurn?.idleMs !== undefined ? { idleMs: opts.acpTurn.idleMs } : {}),
        clock: turnClock,
        onHung: (ms) => {
          hungMs = ms;
          emitAcp({ type: 'acp:turn', state: 'hung', idleMs: ms });
          onHung();
        },
      });
      return watchdog;
    };
    const onProgress = (): void => watchdog?.progress();
    /*
     * S3 — CODEX TURNS ARE SNAPSHOTTED IN-PROCESS. The bridge calls these as
     * codex reports a turn starting, a file change about to land, and the
     * turn's diff; they go straight to the snapshot module (no HTTP), keyed
     * by this chat, so Rewind can revert an agent turn. Only with a repo
     * attached and a chat that names itself.
     */
    const snapRoot = turnRoot;
    const turnHooks: AgentTurnHooks | undefined =
      snapRoot && chatId && isCheckpointSessionId(chatId)
        ? {
            /* The snapshot runs alongside the turn; only a write waits for it. */
            turnStarted: (turnId) => void snapshotGate.startTurn(snapRoot, chatId, { ...(turnId ? { turnId } : {}), ...(turnRt ? { chatTurnId: turnRt.turnId } : {}) }),
            willWrite: (paths, turnId) => snapshotGate.beforeWrite(snapRoot, chatId, paths, turnId ? { turnId } : {}),
            turnDiff: (diff, turnId) => snapshotGate.beforeWrite(snapRoot, chatId, diffPaths(diff), turnId ? { turnId } : {}),
          }
        : undefined;
    const agentKind = agentKindOf(entry);
    const provider = agentKind.startsWith('codex') ? 'codex' : agentKind.startsWith('claude') ? 'claude' : null;
    const onPermission = async (r: AcpPermissionRequest): Promise<PermissionDecision> => {
      const policy = acpPermissionDecision(r, agentMode);
      const about = {
        toolCallId: r.toolCall?.toolCallId,
        title: r.toolCall?.title,
        toolKind: r.toolCall?.kind ?? undefined,
        mode: permissionMode,
      };
      /* Plan makes no changes: an edit is declined at once, with no card, and the chat says why once. */
      if (planRefuses(agentMode, r.toolCall?.kind)) {
        emitAcp({ type: 'acp:permission', ...about, decision: 'deny', answeredBy: 'mode', note: PLAN_REFUSAL });
        return 'deny';
      }
      if (!interactive || policy === 'allow' || turnGone()) {
        emitAcp({ type: 'acp:permission', ...about, decision: policy });
        return policy;
      }
      const prefix = chatId ? acpAlwaysPrefix(r) : null;
      if (prefix && acpChatRules.get(chatId!)?.has(prefix)) {
        /* Answered by the person's own rule: shown, not asked. */
        const ruleId = crypto.randomUUID();
        emitAcp({
          type: 'acp:permission',
          ...about,
          requestId: ruleId,
          pending: false,
          decision: 'allow',
          answeredBy: 'rule',
          rule: prefix,
          proposal: acpApprovalProposal(ruleId, r),
        });
        return 'allow';
      }
      const requestId = crypto.randomUUID();
      emitAcp({
        type: 'acp:permission',
        ...about,
        requestId,
        pending: true,
        decision: null,
        ...(prefix ? { always: prefix } : {}),
        proposal: acpApprovalProposal(requestId, r),
      });
      /* A person is being asked: however long they take is not the agent hanging. */
      const resume = watchdog?.pause();
      const asking = turnRt?.asked('approval');
      const { decision, by } = await new Promise<{ decision: PermissionDecision; by: string }>((resolve) => {
        let offGone: (() => void) | undefined;
        const finish = (d: PermissionDecision, how: string): void => {
          if (!pendingAcpApprovals.delete(requestId)) return;
          turnClock.clearTimeout(timer);
          offGone?.();
          resolve({ decision: d, by: how });
        };
        const timer = turnClock.setTimeout(() => finish(policy, 'timeout'), acpApprovalTimeoutMs);
        pendingAcpApprovals.set(requestId, finish);
        offGone = onTurnGone(() => finish('deny', 'disconnect'));
      });
      resume?.();
      asking?.();
      if (decision === 'always' && prefix) {
        const rules = acpChatRules.get(chatId!) ?? new Set<string>();
        rules.add(prefix);
        acpChatRules.set(chatId!, rules);
      }
      /* Always is an allow on the wire to the page, with the rule it made.
         Without a prefix to scope it to, it is an allow and nothing more. */
      const always = decision === 'always' && prefix ? { always: prefix } : {};
      emitAcp({ type: 'acp:permission', ...about, requestId, pending: false, decision: decision === 'always' ? 'allow' : decision, answeredBy: by, ...always });
      return decision === 'always' && !prefix ? 'allow' : decision;
    };
    /*
     * THE AGENT ASKS THE PERSON (codex item/tool/requestUserInput). On an
     * interactive stream the questions are announced (`acp:question`,
     * `pending: true`, a `requestId`, the questions with their options) and
     * the turn waits for `POST /api/acp/question`, with the idle watchdog
     * paused as it is for an approval. No opt-in, no stream, the timeout,
     * the stream closing, or the turn ending (the adapter aborts `signal`)
     * answer it with none, and the settling event says which.
     */
    const onQuestion = async (q: AgentQuestionRequest, signal: AbortSignal): Promise<AgentQuestionAnswers | null> => {
      if (!interactive || turnGone() || signal.aborted || q.questions.length === 0) return null;
      const requestId = crypto.randomUUID();
      emitAcp({ type: 'acp:question', requestId, pending: true, toolCallId: q.itemId, questions: q.questions });
      const resume = watchdog?.pause();
      const asking = turnRt?.asked('question');
      const { answers, by } = await new Promise<{ answers: AgentQuestionAnswers | null; by: string }>((resolve) => {
        let offGone: (() => void) | undefined;
        const finish = (a: AgentQuestionAnswers | null, how: string): void => {
          if (!pendingAcpQuestions.delete(requestId)) return;
          turnClock.clearTimeout(timer);
          offGone?.();
          signal.removeEventListener('abort', onEnded);
          resolve({ answers: a, by: how });
        };
        const onEnded = (): void => finish(null, 'ended');
        const timer = turnClock.setTimeout(() => finish(null, 'timeout'), acpApprovalTimeoutMs);
        pendingAcpQuestions.set(requestId, finish);
        offGone = onTurnGone(() => finish(null, 'disconnect'));
        signal.addEventListener('abort', onEnded, { once: true });
      });
      resume?.();
      asking?.();
      emitAcp({ type: 'acp:question', requestId, pending: false, answers, answeredBy: by });
      return answers;
    };
    /* Ended: the agent's stop reason. Settled: the server is done with the
       turn (the thread is recorded, nothing else will be sent). */
    const finishTurn = (ended: PostAcpRunNodeResponse, usage?: TurnUsage | null): void => {
      /* The ledger's closing line is read, then cut from what is shown (the runtime cuts it from what is saved). */
      const ledgerResult = ledgerOn ? parseAskLine(ended.text ?? '') : null;
      const turn: PostAcpRunNodeResponse & { askLedger?: NonNullable<typeof ledgerResult> } = ledgerOn
        ? { ...ended, text: stripAskLine(ended.text ?? ''), ...(ledgerResult ? { askLedger: ledgerResult } : {}) }
        : ended;
      turnRt?.finish('ended', { stopReason: turn.stopReason, text: ended.text, ...(usage ? { usage } : {}) });
      if (provider) clearUsageLimit(userConfigDir, provider);
      if (streaming) {
        emitAcp({ type: 'acp:turn', state: 'ended', stopReason: turn.stopReason });
        emitAcp({ type: 'acp:result', ...turn, ...(compacting ? { operation: 'compact' } : {}) });
        emitAcp({ type: 'acp:turn', state: 'settled' });
        if (!res.writableEnded) res.end();
      } else {
        sendJson(res, 200, turn);
      }
    };
    /* What the person can do next: sign in again, retry (resume), install,
       or wait for a usage limit to reset (with when, if the agent said). */
    const recoveryOf = (e: unknown): Record<string, unknown> => {
      const { kind, resetsAt, cause } = acpRecoveryOf(e);
      /* Round 7: remember a spent usage limit so the agent's status says so until it resets. */
      if (kind === 'wait' && provider && resetsAt !== undefined) recordUsageLimit(userConfigDir, provider, resetsAt);
      return {
        recovery: {
          kind,
          ...(cause ? { cause } : {}),
          ...((kind === 'signIn' || kind === 'wait') && provider ? { provider } : {}),
          ...(kind === 'wait' && resetsAt !== undefined ? { resetsAt } : {}),
        },
      };
    };
    const failTurn = (message: string, e?: unknown): void => {
      if (streaming) {
        emitAcp({ type: 'acp:error', error: message, ...recoveryOf(e ?? message) });
        if (!res.writableEnded) res.end();
      } else if (!res.headersSent) {
        sendError(res, 502, message, recoveryOf(e ?? message));
      }
    };
    /* The agent would not enter the mode asked for (Claude refuses bypass as
       root without IS_SANDBOX, or under a managed disableBypassPermissionsMode).
       Its OWN reason goes to the caller, and no turn runs in a weaker mode. */
    const failTurnWith = (e: unknown): void => {
      turnRt?.finish(e instanceof TurnHungError ? 'hung' : 'failed', { error: e instanceof Error ? e.message : String(e) });
      if (!(e instanceof AccessModeRefusedError)) {
        failTurn(e instanceof TurnHungError ? e.message : `ACP agent failed: ${(e as Error).message}`, e);
        return;
      }
      if (streaming) {
        emitAcp({ type: 'acp:error', error: e.message, refused: { mode: e.mode, reason: e.reason }, recovery: { kind: 'settings', cause: 'unknown' } });
        if (!res.writableEnded) res.end();
      } else if (!res.headersSent) {
        sendError(res, 403, e.message, { reason: e.reason, mode: permissionMode });
      }
    };

    /* S2a: the agent sees the board: Sequence's MCP server for this turn's
       repository (the chat's worktree when it has one), core tools unless
       the "all board tools" setting is on. */
    const board = turnRoot ? sequenceMcpServer(turnRoot, { allTools: readAgentSettings(userConfigDir).allBoardTools, ...componentsLaunchOpts(readComponentSettings(userConfigDirFor(sessionId)), { ...(req.socket.localPort ? { url: `http://127.0.0.1:${req.socket.localPort}` } : {}), ...(chatId ? { key: `chat::${chatId}::${agentRef}` } : {}) }), ...(root ? { drawings: { root, chat: boundChat, referenced: referencedDrawingIds(asked) } } : {}), ...(chatId ? { chat: chatId } : {}), ...(chatId && req.socket.localPort ? { genuiUrl: genuiIngestUrl(req.socket.localPort, chatId) } : {}), ...(chatId && goalLeases.has(chatId) && readGoalRun(turnSessionsRoot(), chatId)?.running === true && req.socket.localPort ? { goal: { chat: chatId, url: `http://127.0.0.1:${req.socket.localPort}`, key: goalLeases.get(chatId)!.key } } : {}) }) : null;
    /* The REA component, when a person added it: its read-only tools are pre-approved for this agent (components/reaInstall.ts). */
    const rea = reaAgentServer(turnRoot, userConfigDirFor(sessionId));
    const launch = {
      command: entry.command,
      ...(entry.args ? { args: entry.args } : {}),
      ...(cwd ? { cwd } : {}),
      ...(board || rea ? { mcpServers: [...(board ? [board] : []), ...(rea ? [rea] : [])] } : {}),
      accessMode: agentMode,
      ...(opts.acpTurn?.spawn ? { spawn: opts.acpTurn.spawn } : {}),
      ...(opts.acpTurn?.killGraceMs !== undefined ? { killGraceMs: opts.acpTurn.killGraceMs } : {}),
    };

    /*
     * S1 — THE CHAT'S AGENT THREAD. A new process for this chat first tries
     * to rejoin the thread the chat had with this agent (recorded on its
     * session index entry); only when the agent cannot does it open a new
     * one, and the stream says which happened (`acp:session`). The thread
     * it ends up on is recorded for the next time.
     */
    let seedOwed = '';
    /* How this turn got its thread: opened new, reopened, put back by a rewind, or already live in the cache. */
    let opened: 'new' | 'resumed' | 'rewind' | 'reused' = 'reused';
    const openThread = async (client: AcpAgentClient, signal?: AbortSignal): Promise<string> => {
      const root = chatId ? turnSessionsRoot() : null;
      let known: { id: string } | null = null;
      try {
        known = root && chatId ? readAgentThread(root, chatId, agentRef) : null;
      } catch {
        known = null;
      }
      let threadId: string;
      let owedSeed: PendingRewind | undefined;
      if (known && (known as AgentThreadRef).rewind) {
        /* Edit from here is waiting: roll the provider thread back, or start over from the kept conversation. */
        const settled = await settleRewind(client, known as AgentThreadRef, (known as AgentThreadRef).rewind!, cwd, signal);
        threadId = settled.threadId;
        if (root && chatId) settledRewind(root, chatId);
        /* The turns that carried the notes may be the ones cut: tell the thread again. */
        if (chatId) {
          noteLedger.forget(`chat::${chatId}::${agentRef}`);
          componentOffers.forget(`chat::${chatId}::${agentRef}`);
        }
        emitAcp({ type: 'acp:session', resumed: settled.how === 'rolled-back', threadId, rewound: settled.how, ...(settled.reason ? { reason: settled.reason } : {}) });
        if (settled.how === 'reseeded') owedSeed = { dropTurns: 0, seed: settled.seed };
        turnRt?.session(settled.how === 'rolled-back');
        opened = 'rewind';
      } else if (known && client.resumeSession) {
        try {
          threadId = await client.resumeSession(known.id, cwd, signal);
          emitAcp({ type: 'acp:session', resumed: true, threadId });
          turnRt?.session(true);
          opened = 'resumed';
        } catch (e) {
          if (signal?.aborted) throw e;
          opened = 'new';
          threadId = await client.newSession(cwd, signal);
          emitAcp({
            type: 'acp:session',
            resumed: false,
            threadId,
            reason: e instanceof ResumeUnavailableError ? e.message : `the agent could not reopen its thread: ${(e as Error).message}`,
          });
        }
      } else {
        opened = 'new';
        threadId = await client.newSession(cwd, signal);
        emitAcp({ type: 'acp:session', resumed: false, threadId });
        turnRt?.session(false);
      }
      seedOwed = owedSeed?.seed ?? '';
      turnRt?.setThread(threadId);
      if (chatId) noteThreads.set(`chat::${chatId}::${agentRef}`, threadId);
      else if (typeof body.sessionKey === 'string' && body.sessionKey !== '') noteThreads.set(`adhoc::${body.sessionKey}`, threadId);
      if (root && chatId) {
        try {
          writeAgentThread(root, chatId, agentRef, { id: threadId, kind: agentKind === 'codex-cli' ? 'codex' : 'acp', ...(owedSeed ? { rewind: owedSeed } : {}) });
        } catch {
          /* A thread we could not record is one the next process starts afresh; the turn still runs. */
        }
      }
      return threadId;
    };

    // r31 — CACHED path: a valid non-empty string sessionKey reuses one live
    // session per key with turns serialized (queue). A client disconnect aborts
    // the in-flight turn (ACP cancel) but LEAVES the shared session cached for
    // other requests — genuine agent/stream death (a non-abort throw) disposes it,
    // and the idle TTL / cap reap it otherwise.
    /* A turn is running: the idle shadow warm-up waits until it is over. */
    let answeredHook: () => void = () => {};
    turnRt = new AgentTurnRuntime({
      clock: turnClock,
      emit: emitAcp,
      agentRef,
      provider,
      chatId,
      prompt: compacting ? '/compact' : shown,
      compact: compacting,
      askLedger: ledgerOn,
      /* The refine loop reads every finished turn, whichever provider ran it. */
      refine: turnRepoRoot ? { root: turnRepoRoot, auto: readAgentSettings(userConfigDir).autoRefine } : null,
      pathRoot: chatWorktree ? chatWorktree.path : turnRepoRoot ?? null,
      nodeId: contextNodeId,
      sessionsRoot: chatId ? turnSessionsRoot() : null,
      userConfigDir,
      /* Codex ends its own turns (turn/completed); an ACP bridge may hold one open after the answer. */
      detectAnswer: provider !== 'codex' && !compacting,
      onAnswered: () => answeredHook(),
      ...(opts.acpTurn?.statusEveryMs !== undefined ? { statusEveryMs: opts.acpTurn.statusEveryMs } : {}),
      ...(opts.acpTurn?.answerQuietMs !== undefined ? { answerQuietMs: opts.acpTurn.answerQuietMs } : {}),
    });
    const rtNow = turnRt;
    /* The page keeps the server's id for this turn: an edit names the turn it goes back to by it. */
    emitAcp({ type: 'acp:turn-id', turnId: rtNow.turnId });
    adjustRunningTurns(1);
    /* A chat turn counts until it ends, not until its page goes (turnChannels.ts). */
    const whenTurnOver = (fn: () => void): void => {
      if (channel) channel.onEnd(fn);
      else res.once('close', fn);
    };
    whenTurnOver(() => ((adjustRunningTurns(-1))));
    if (channel) {
      channel.info = { ...channel.info, turnId: rtNow.turnId };
      acpTurnChannels.open(channel);
    }
    if (turnRepoRoot) {
      const liveRoot = turnRepoRoot;
      liveTurnRoots.set(liveRoot, (liveTurnRoots.get(liveRoot) ?? 0) + 1);
      whenTurnOver(() => {
        const n = (liveTurnRoots.get(liveRoot) ?? 1) - 1;
        if (n <= 0) liveTurnRoots.delete(liveRoot);
        else liveTurnRoots.set(liveRoot, n);
      });
    }
    if (chatId) {
      liveChatTurns.set(chatId, (liveChatTurns.get(chatId) ?? 0) + 1);
      whenTurnOver(() => {
        const n = (liveChatTurns.get(chatId) ?? 1) - 1;
        if (n <= 0) liveChatTurns.delete(chatId);
        else liveChatTurns.set(chatId, n);
      });
    }
    const sessionKey =
      typeof body.sessionKey === 'string' && body.sessionKey !== '' ? body.sessionKey : undefined;
    if (sessionKey) {
      const ac = new AbortController();
      /*
       * ROUND 9 — STOP FREES THE CHAT. Stop drops the stream; the agent is
       * asked to cancel. A bridge that does not answer within the grace
       * is killed, so the next turn is not locked behind it for the idle
       * limit: the cache's teardown gate waits for the exit and the next
       * turn resumes the thread. A turn still queued kills nothing.
       */
      let turnLive = false;
      let stopTimer: unknown = null;
      const onClientGone = (): void => {
        ac.abort();
        rtNow.stopping();
        if (!turnLive || stopTimer !== null) return;
        stopTimer = turnClock.setTimeout(() => {
          if (turnLive) void acpSessions.dispose(sessionKey);
        }, opts.acpTurn?.stopGraceMs ?? 3_000);
      };
      /* A turn that answered but whose bridge still holds the prompt would lock this send out
         for good: cancel it (then the grace/kill path) so this turn starts promptly. */
      const held = activeAcpTurns.get(sessionKey);
      if (held && held.rt.answered) held.stop();
      if (acpSessions.busy(sessionKey)) rtNow.queued();
      answeredHook = (): void => {
        if (acpSessions.pending(sessionKey) > 1) onClientGone();
      };
      /* A streamed chat turn is stopped by Stop (POST /api/acp/stop) or by nobody coming back within the grace; a closed stream alone does not stop it. */
      if (channel) channel.stop = onClientGone;
      else res.on('close', onClientGone);
      // A cached client OUTLIVES the request that created it, so its hooks cannot
      // close over this response. They dispatch through `acpTurnSinks`, which is
      // re-pointed at whoever owns the current turn — correct precisely because
      // `acpSessions.run` serializes turns per key, so one turn is ever active.
      const previousSink = acpTurnSinks.get(sessionKey);
      const mySink: AcpTurnSink = { onUpdate, onPermission, onQuestion, onProgress, ...(turnHooks ? { turnHooks } : {}) };
      acpTurnSinks.set(sessionKey, mySink);
      let hung = false;
      onHung = (): void => {
        hung = true;
        ac.abort();
        /* The process is not answering: kill it. The next turn waits for it
           to be gone (the cache's teardown gate) and resumes the thread. */
        void acpSessions.dispose(sessionKey);
      };
      try {
        const { stopReason, text, usage } = await acpSessions.run(
          sessionKey,
          async () => {
            const client = createAgentClient({
              ...launch,
              onUpdate: (n) => acpTurnSinks.get(sessionKey)?.onUpdate(n),
              onProgress: () => acpTurnSinks.get(sessionKey)?.onProgress(),
              turnHooks: {
                turnStarted: (id) => acpTurnSinks.get(sessionKey)?.turnHooks?.turnStarted?.(id),
                willWrite: (paths, id) => acpTurnSinks.get(sessionKey)?.turnHooks?.willWrite?.(paths, id),
                turnDiff: (diff, id) => acpTurnSinks.get(sessionKey)?.turnHooks?.turnDiff?.(diff, id),
              },
              // No sink registered (a reaped/idle turn) falls back to the
              // CONSERVATIVE default rather than to the last caller's mode —
              // an opt-in must never outlive the request that opted in.
              onPermission: (r) =>
                acpTurnSinks.get(sessionKey)?.onPermission(r) ?? defaultPermissionPolicy(r),
              // No sink (no turn owns this session now): nobody to ask, so no answer.
              onQuestion: (q, signal) => acpTurnSinks.get(sessionKey)?.onQuestion(q, signal) ?? Promise.resolve(null),
            });
            // A client that never reaches the cache is never reaped by it: a
            // failed start/session (e.g. the agent refusing bypass) kills it here.
            try {
              await client.start();
              const sessionId = await openThread(client);
              return { client, sessionId, cwd };
            } catch (e) {
              await client.dispose().catch(() => {});
              throw e;
            }
          },
          // A cached session may have been opened under another mode: switch
          // it (session/set_mode) before the turn, never run in the old one.
          async (client) => {
            turnLive = true;
            const mine = { rt: rtNow, stop: onClientGone };
            activeAcpTurns.set(sessionKey, mine);
            rtNow.started();
            await client.setAccessMode?.(agentMode);
            const wd = watchTurn();
            try {
              return await runTheTurn(client, ac.signal);
            } finally {
              wd.stop();
              turnLive = false;
              if (activeAcpTurns.get(sessionKey) === mine) activeAcpTurns.delete(sessionKey);
            }
          },
          // A disconnect (ac.abort) is an EXPECTED interruption — keep the shared
          // session; a hang or any other throw broke the client, so dispose it.
          { disposeOnError: () => hung || !ac.signal.aborted, signal: ac.signal, cwd }
        );
        if (hung) failTurnWith(new TurnHungError(hungMs));
        else if (ac.signal.aborted || stopReason === 'cancelled') {
          rtNow.finish('stopped', { stopReason, ...(usage ? { usage } : {}) });
          if (streaming && !res.writableEnded) res.end();
        } else finishTurn({ stopReason, text }, usage);
      } catch (e) {
        if (hung) failTurnWith(new TurnHungError(hungMs));
        else if (!ac.signal.aborted) failTurnWith(e);
        else {
          rtNow.finish('stopped');
          if (streaming && !res.writableEnded) res.end();
        }
      } finally {
        res.off('close', onClientGone);
        /* Every watcher's stream ends with the turn. */
        channel?.end();
        if (stopTimer !== null) turnClock.clearTimeout(stopTimer);
        if (acpTurnSinks.get(sessionKey) === mySink) {
          if (previousSink) acpTurnSinks.set(sessionKey, previousSink);
          else acpTurnSinks.delete(sessionKey);
        }
      }
      return true;
    }

    const client = createAgentClient({ ...launch, onUpdate, onPermission, onQuestion, onProgress, ...(turnHooks ? { turnHooks } : {}) });
    // v16 Finding 1 — a client disconnect must FORCEFULLY kill the subprocess (no
    // orphan, no continued real cost), like the terminal WS's killProcessTree on
    // close. So on `req 'close'` we (a) abort the in-flight turn (ACP cancel) AND
    // (b) call dispose() DIRECTLY — SIGTERM→SIGKILL — without waiting for prompt()
    // to resolve. A hung/uncooperative agent (or a hang during init) is therefore
    // still killed. The signal is also threaded into start()/newSession() so a
    // hang BEFORE the prompt is abortable too. dispose() is idempotent and guarded
    // so the normal (finally) path and the disconnect path never double-fire.
    const ac = new AbortController();
    let disposed = false;
    const forceDispose = (): void => {
      if (disposed) return;
      disposed = true;
      void client.dispose().catch(() => {});
    };
    const onClientGone = (): void => {
      ac.abort();
      rtNow.stopping();
      forceDispose();
    };
    // Listen on the RESPONSE's 'close': by the time we get here `readBody` has
    // already drained (and ended) the request stream, so a late `req.on('close')`
    // would miss the event entirely. `res` 'close' fires reliably when the client
    // disconnects mid-turn (and, harmlessly, on normal completion — forceDispose
    // is idempotent and the finally handles the normal path).
    res.on('close', onClientGone);
    let hung = false;
    onHung = (): void => {
      hung = true;
      ac.abort();
      forceDispose();
    };
    try {
      rtNow.started();
      await client.start(ac.signal);
      await openThread(client, ac.signal);
      const wd = watchTurn();
      let result: Awaited<ReturnType<typeof client.prompt>>;
      try {
        result = await runTheTurn(client, ac.signal);
      } finally {
        wd.stop();
      }
      if (hung) failTurnWith(new TurnHungError(hungMs));
      else if (ac.signal.aborted || result.stopReason === 'cancelled') {
        rtNow.finish('stopped', { stopReason: result.stopReason });
        if (streaming && !res.writableEnded) res.end();
      } else finishTurn(result, result.usage);
    } catch (e) {
      if (hung) failTurnWith(new TurnHungError(hungMs));
      else if (!ac.signal.aborted) failTurnWith(e);
      else {
        rtNow.finish('stopped');
        if (streaming && !res.writableEnded) res.end();
      }
    } finally {
      res.off('close', onClientGone);
      forceDispose();
    }
    return true;
  }

  return false;
}
