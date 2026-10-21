/**
 * The ask turn, shared by POST /api/ask, POST /api/ask/stream and the goal-run turn.
 *
 * What the server hands the ask routes (`AskEnv`) is named here once, as callbacks and getters over
 * createRepoServer's state, so the route module never closes over it.
 */

import type http from 'node:http';
import type { Digest } from '../explain/explain.js';
import type { AiConfig, ProviderStreamOptions, ProviderToolRequest } from './provider.js';
import type { AskGoalContext, PlanStep } from '@sequence/api-types';
import type { AskGoalDepth } from './askTools.js';
import type { BuiltAskHistory } from './askHistory.js';
import type { RepoServerOptions } from './repoServer.js';
import type { ArchGraph } from '@sequence/schema';
import { parsePlanCommand } from './planTurn.js';
import { agentMapLinesFor, readAgentSettings } from './askAgentMap.js';
import { resolveAskThreadId } from './askSession.js';
import { historyMetaOf } from './askHistory.js';
import { readCarry, writeCarry } from './carryStore.js';
import { beginTeachTurn } from './teachTurn.js';
import { readAttachment, readAttachmentText, renderAttachmentSection } from './attachmentStore.js';
import { renderTrustedInstructionsSection } from '../explain/instructions.js';
import { probeEffectiveContextCached, readRepoInstructionsCached } from './askMemo.js';
import type { DesignAskContext } from '../explain/explain.js';
import { parseAskIntents, parseAskMode, parseAskContextLines } from '../explain/askIntents.js';
import { parseAskSurface, isDeicticSurfaceQuestion, answerSurfaceQuestion } from '../explain/askSurface.js';
import { isArchitectureDesignAsk, isTeachTurn, type AskPipelineResult, type AskPipelineInput } from './askPipeline.js';
import { parseAskJobMode, askToolsForJobMode, askOpenAiToolSupplemental, openaiAskToolDefinitions, isPlotOrMathDrawAsk } from './askTools.js';
import { parseAskDoneWhen } from '../harness/verifyGate.js';
import { isLocalOllama, askHistoryWindow } from './localProviders.js';
import { MAX_BODY_BYTES,  sendError, isJsonRequest, readBody,     requestAbort } from './routeHttp.js';

export interface ProviderMeteredResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
  toolRequests?: ProviderToolRequest[];
  /** The provider layer's retry count for this call, passed through untouched for the run receipt. */
  retries?: number;
  /**
   * Why the provider stopped. Passed through untouched, for the same reason
   * `retries` is: this layer meters and does not interpret. The ask pipeline
   * is what turns `length` into a sentence the reader can act on.
   */
  finishReason?: string;
}

/**
 * What the ask routes need from createRepoServer. Callbacks and getters, so a route module never closes over the
` * server's state: \`getRoot()\` and \`getGraph()\` are read at each use, where the original code read the live variable.
 */
export interface AskEnv {
  requireOwner: () => boolean;
  /** The signed-in user id under hosted auth (undefined locally). */
  sessionId: string | undefined;
  /** The metering identity of this request. */
  identity: string;
  userConfigDir: string;
  userConfigDirFor: (sessionId: string | undefined) => string;
  sessionsRoot: () => string;
  extractIdentity: (req: http.IncomingMessage) => string;
  loadAiConfig: () => AiConfig | undefined;
  askDigest: () => Digest;
  resolveReadablePath: (rel: string) => string | null;
  askWorkspaceRoot: () => string | null;
  applyAskProposedFiles: (
    files: readonly { path: string; content: string }[],
    trackWrite?: (rel: string) => void,
    lock?: { runId: string; signal?: AbortSignal },
  ) => Promise<{
    written: string[];
    refused: { path: string; reason: string }[];
    blockedByHook?: string;
    modified?: string[];
    warnings?: string[];
  }>;
  goalDepthFor: (ctx: { goal: AskGoalContext } | undefined) => AskGoalDepth;
  buildSkillLines: (question: string) => { summaryLines: string[]; bodyLines: string[]; noteLines: string[]; noteMatchedLines: string[] };
  buildHistoryForAsk: (
    cfg: AiConfig,
    identity: string,
    body: { history?: unknown; historyDropped?: unknown },
    question: string,
    contextWindow: number | null | undefined,
    thread: { threadId?: string; source: string },
    signal?: AbortSignal,
  ) => Promise<BuiltAskHistory>;
  askTurnCheckpointTracker: (
    rawSessionId: unknown,
    question: string,
  ) => { trackWrite: ((rel: string) => void) | undefined; rollbackPoint: () => number | undefined };
  askGoalContextFor: (
    threadId: string | undefined,
    turn?: { permission?: string; question?: unknown },
  ) => { goal: AskGoalContext; persistPlan: (plan: readonly PlanStep[]) => void } | undefined;
  nameThreadFromPrompt: (threadId: string | null | undefined, question: string, identity: string) => void;
  callProviderMeteredWithUsage: (
    cfg: AiConfig,
    prompt: string,
    identity: string,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
    tools?: ProviderStreamOptions['tools'],
    cacheBreakpointChars?: number,
    onReasoning?: (text: string) => void,
  ) => Promise<ProviderMeteredResult>;
  opts: RepoServerOptions;
  /** The attached repo root, read live (null when none is attached). */
  getRoot: () => string | null;
  /** The current scanned graph, read live. */
  getGraph: () => ArchGraph | null;
}


/* ============================ the shared ask turn ============================
 * POST /api/ask and POST /api/ask/stream used to repeat this preparation line for line, and
 * `ask-stream-parity.test.ts` existed because the copies drifted. They now call ONE preparation, ONE pipeline
 * input and ONE provider callback; what a route does differently is a parameter here, named where it is used.
 */

/**
 * The request body both ask routes accept. PARITY WITH EACH OTHER IS NOT COSMETIC: a field one route read and the
 * other did not meant four separately-shipped features did nothing for every real user (the client only posts to
 * the stream route): a pasted attachment was ignored, choosing Plan changed nothing, the per-request round cap
 * could not be lowered, and the repository's own AGENTS.md was never read. One declaration, so the next field
 * cannot drift.
 */
export interface AskRequestBody {
  question?: unknown;
  design?: unknown;
  intents?: unknown;
  context?: unknown;
  mode?: unknown;
  surface?: unknown;
  history?: unknown;
  historyDropped?: unknown;
  maxRounds?: unknown;
  permission?: unknown;
  jobMode?: unknown;
  teach?: unknown;
  teachKnown?: unknown;
  attachmentIds?: unknown;
  sessionId?: unknown;
  doneWhen?: unknown;
  threadId?: unknown;
}

/** Which ask route is preparing the turn. The differences between them are listed where they are used. */
export type AskRoute = 'buffered' | 'stream';

const HANDLED = { kind: 'handled' as const };

/**
 * The window the chat history is sized to.
 *
 * THE WINDOW A LOCAL MODEL WILL ACTUALLY RUN, probed once per ask.
 *
 * Only for the local Ollama profile: for a hosted provider we neither know
 * nor control the window, and reporting "unknown" on every cloud turn would
 * be a warning nobody reads. The probe is a bounded loopback call that fails
 * to null, so a slow or absent Ollama costs this turn its timeout and
 * nothing else — and null is a real answer here, meaning the Modelfile sets
 * no num_ctx so the server default silently decides. The chat history is
 * sized to it (askHistoryBudget).
 * `withLocalContext` is the buffered route's only: it also hands the pipeline the probed window as `localContext`.
 */
export async function resolveAskWindow(
  cfg: AiConfig,
  withLocalContext: boolean,
): Promise<{ localContext: { window: number | null } | undefined; askWindow: number | null | undefined }> {
  const localContext = withLocalContext && isLocalOllama(cfg.provider, cfg.baseUrl)
    ? { window: await probeEffectiveContextCached(cfg.baseUrl!, cfg.model, fetch) }
    : undefined;
  const askWindow = localContext ? localContext.window : await askHistoryWindow(cfg.provider, cfg.baseUrl, cfg.model, fetch, probeEffectiveContextCached);
  return { localContext, askWindow };
}

/**
 * Everything both ask routes do before the provider is called: owner gate, body, validation, the teach turn, the
 * thread and its carry, the goal, the surface, the design brief, the config, the digest, the history, the repo's
 * instructions, attachments and skills. A route that gets `handled` back has already answered (an error); `surface`
 * and `lesson` are answers that need no provider and are rendered by the route in its own wire format.
 */
export async function prepareAskTurn(env: AskEnv, req: http.IncomingMessage, res: http.ServerResponse, route: AskRoute) {
  const { requireOwner, sessionsRoot, extractIdentity, loadAiConfig, askDigest, buildSkillLines, buildHistoryForAsk, askTurnCheckpointTracker, askGoalContextFor, nameThreadFromPrompt, getRoot, getGraph } = env;
  if (requireOwner()) return HANDLED;
  if (!isJsonRequest(req)) {
    sendError(res, 415, 'expected content-type application/json');
    return HANDLED;
  }
  let body: AskRequestBody;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (e) {
    sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
    return HANDLED;
  }
  /* `/plan <task>` — a planning turn about <task> (planTurn.ts). */
  const planCommand = parsePlanCommand(body.question);
  const question = planCommand.question;
  if (typeof question !== 'string') {
    sendError(res, 400, 'body must include a non-empty string "question"');
    return HANDLED;
  }
  const askCheckpoint = askTurnCheckpointTracker(body.sessionId, question);
  /* The done-when gate, narrowed by the same `parseAskDoneWhen` the CLI
     uses: a malformed gate — a skip with no reason above all — is a 400,
     never a silent no-gate. */
  const parsedDoneWhen = parseAskDoneWhen(body.doneWhen);
  if ('error' in parsedDoneWhen) {
    sendError(res, 400, parsedDoneWhen.error);
    return HANDLED;
  }
  // A PRESENT but malformed `intents` field is a client bug, and dropping it
  // would silently answer without the capability the user asked for — 400 so
  // it is visible. An ABSENT field is the legacy shape and stays legal.
  const parsedIntents = parseAskIntents(body.intents);
  if ('error' in parsedIntents) {
    sendError(res, 400, parsedIntents.error);
    return HANDLED;
  }
  // A chip-only send is a complete request (Cursor-style: the chip alone is
  // the message) — the invoked intents ARE the instruction, so an empty
  // `question` is legal exactly when at least one intent came with it. With
  // neither, there is nothing to answer, and the pre-intent 400 stands
  // byte-for-byte for every legacy caller.
  if (question.trim() === '' && parsedIntents.intents.length === 0) {
    sendError(res, 400, 'body must include a non-empty string "question"');
    return HANDLED;
  }
  const askMode = parseAskMode(body.mode);
  const jobMode = parseAskJobMode(body.jobMode);
  const teach = body.teach === true;
  /* ONE CLICK, three values, closed union — anything else is absent rather
     than an error, because a client sending a value we do not know is not a
     reason to fail a lesson. A fourth value is deliberately unreachable: see
     PostAskRequest.teachKnown. */
  const teachKnown =
    body.teachKnown === 'new' || body.teachKnown === 'used-it' || body.teachKnown === 'ship-it'
      ? body.teachKnown
      : undefined;
  /* ONE assembly of a teach turn, shared with /api/ask/stream -- see
     server/teachTurn.ts. Built here so the lesson exists BEFORE the first
     turn rather than after it.
     THE CLASSIFIED TURN, not the toggle (2026-09-22): the owner asked to be
     taught from a Plan chat with Teach off, the pipeline already read it as
     a lesson, and this handed over only the toggle -- so no lesson, no
     concept, and thinking left on. `teach` keeps the toggle's own meaning
     everywhere else in this route. */
  const askTurn = beginTeachTurn({
    teach: isTeachTurn({ teach, question }),
    question,
    threadIdFromRequest: (body as { threadId?: unknown }).threadId,
    sessionsRoot: sessionsRoot(),
    ...(getGraph() ? { graph: getGraph()! } : {}),
    ...(teachKnown ? { teachKnown } : {}),
  });
  /*
   * THE CARRY'S KEY. The RESOLVED thread, which includes the active-session
   * fallback -- `askTurn.threadId` is deliberately request-only, and using
   * it here would give every no-threadId client a permanently empty carry.
   *
   * NOT `body.sessionId`: on this route that is the AUTHENTICATED USER, and
   * keying a conversation's material on the person would hand one
   * conversation's files and lists to another of theirs.
   */
  const carryThread = resolveAskThreadId((body as { threadId?: unknown }).threadId, sessionsRoot());
  const carryThreadId = carryThread.threadId;
  const carriedIn = readCarry(carryThreadId);
  /* Only a request that NAMES its thread gets that thread named: the app
     always sends one (connect.tsx), while the battery and the route tests
     fall back to the active session and count provider calls. */
  if (carryThread.source === 'request') nameThreadFromPrompt(carryThreadId, question, extractIdentity(req));
  /* The session's standing goal and plan. See `askGoalContextFor`. */
  /* Two rungs since 2026-09-13. An unknown value — an old client's `propose` / `autoEdit` / `full` included —
     becomes undefined, which stages and refuses the shell. Default-deny. */
  const askPermission = body.permission === 'plan' || body.permission === 'build' ? body.permission : undefined;
  /* ROUTE DIFFERENCE, kept as it was: /api/ask told the goal context only about a Plan turn ('build' became
     undefined), /api/ask/stream passed the permission through. */
  const goalPermission = route === 'buffered' ? (body.permission === 'plan' ? 'plan' : undefined) : askPermission;
  const askGoal = askGoalContextFor(carryThreadId, { permission: goalPermission, question });
  const scopeLines = parseAskContextLines(body.context);
  // SURFACE CONTEXT (owner report E2/G5: "I sent that workbook flow thing,
  // and it looks confusing itself"). Until now the only thing the assistant
  // knew about the user's screen was the graph selection, so "this workflow"
  // asked on the Agents surface was resolved against the only noun the
  // server had — the repo — and answered "the digest contains no workflow
  // definitions". The composer now carries WHICH surface is active and what
  // is focused on it. Absent field ⇒ nothing added anywhere; present but
  // malformed ⇒ 400, same stance as `intents`, because silently dropping it
  // brings the reported bug straight back.
  const parsedSurface = parseAskSurface(body.surface);
  if ('error' in parsedSurface) {
    sendError(res, 400, parsedSurface.error);
    return HANDLED;
  }
  const surface = parsedSurface.surface;
  const deictic = isDeicticSurfaceQuestion(question);
  /* Everything decided so far: what a route needs to answer without a provider call (a surface answer, a refusal). */
  const head = {
    body, question, planCommand, askCheckpoint, parsedDoneWhen, parsedIntents, askMode, jobMode, teach, askPermission,
    askTurn, carryThread, carryThreadId, carriedIn, askGoal, scopeLines, surface, deictic,
  };
  // DETERMINISTIC SURFACE ANSWER — "what is this workflow?" asked while a
  // Program is on the Agents canvas is answered FROM THAT PROGRAM, before
  // any repo requirement and before any provider call: it needs no scan, no
  // key and no network (local-first), and it cannot drift from the canvas.
  // Skipped whenever the user attached a chip — those are instructions that
  // genuinely want the model, and answering them from a step list would be
  // ignoring what they asked for.
  if (parsedIntents.intents.length === 0) {
    const surfaceAnswer = answerSurfaceQuestion(surface, question);
    if (surfaceAnswer) {
      // `source` is the honest marker: this text came off the surface, not
      // from a provider, so nothing was metered and nothing was generated.
      return { kind: 'surface' as const, text: surfaceAnswer, head };
    }
  }
  // A LESSON REQUEST WITH NO SUBJECT is refused BEFORE any provider call —
  // see server/lessonState.ts:subjectlessRefusal and
  // docs/research/design-the-subjectless-lesson.md. Without it the model
  // fills the gap with a paraphrase of the architecture digest: confident
  // prose, no concept, no picture, and no sign that no subject was found.
  // `source: 'lesson'` is the honest marker, as `surface` is above: nothing
  // was metered and nothing was generated.
  /* BOTH ROUTES consult the refusal on every request. (/api/ask/stream used to consult it only when the request
     carried no intents, so a subject-less lesson ask with an intent chip reached the provider on the route the
     client posts to and was refused on the other.) */
  {
    const refusal = askTurn.refusal();
    if (refusal !== undefined) return { kind: 'lesson' as const, text: refusal };
  }
  // The design payload is only honoured when it can actually ground an answer:
  // an object with a non-empty outline string. Anything else is ignored, so a
  // junk/empty `design` still falls through to the honest no-repo 409.
  const rawDesign = body.design;
  const design: DesignAskContext | undefined =
    rawDesign !== null &&
    typeof rawDesign === 'object' &&
    typeof (rawDesign as { outline?: unknown }).outline === 'string' &&
    (rawDesign as { outline: string }).outline.trim() !== ''
      ? {
          title:
            typeof (rawDesign as { title?: unknown }).title === 'string'
              ? (rawDesign as { title: string }).title
              : '',
          outline: (rawDesign as { outline: string }).outline,
          /*
           * THE CLIENT'S FLAG IS HONOURED ONLY FOR A DESIGN BRIEF.
           *
           * web2 sets `proposeArchitecture: true` on EVERY non-teach turn
           * with nothing attached, because the blank workspace was built
           * for the person who opened it to design something. Owner walk,
           * 2026-09-17: he opened it to be SHOWN something — "explain LLMs
           * and their internal architecture using visuals in 3D" — and the
           * flag turned that into PROPOSE NOW's numbered assumptions and a
           * seqd fence. Dropped HERE rather than in the prompt builder
           * because the flag is a claim about what the person asked for,
           * and the route is where that claim arrives.
           */
          ...((rawDesign as { proposeArchitecture?: unknown }).proposeArchitecture === true &&
          isArchitectureDesignAsk(question)
            ? { proposeArchitecture: true }
            : {}),
        }
      : undefined;
  const repoAttached = getRoot() !== null && getGraph() !== null;
  /* See `/api/ask/stream` below: a missing repo is a missing DIGEST, not a
     refusal. The two routes must agree — `ask-stream-parity.test.ts` exists
     because they have drifted before, and this guard is the kind of thing
     that drifts. */
  const designMode = !repoAttached;
  const cfg = loadAiConfig();
  if (!cfg) {
    sendError(res, 400, 'AI provider not configured — connect your AI key in Settings to chat', { fix: 'provider' });
    return HANDLED;
  }
  const digest = designMode ? undefined : askDigest();
  /* ROUTE DIFFERENCE, kept as it was: only /api/ask probes the local model's real window (see resolveAskWindow). */
  const { localContext, askWindow } = await resolveAskWindow(cfg, route === 'buffered');
  /* Made before the history summary so a Stop or closed tab cancels that call too. */
  const askAbort = requestAbort(res);
  const builtHistory = await buildHistoryForAsk(cfg, extractIdentity(req), body, question, askWindow, carryThread, askAbort.signal);
  const historyLines = builtHistory.lines;
  /*
   * THE REPOSITORY'S OWN RULES. Every competitor reads a project
   * instruction file; this product read none, while carrying AGENTS.md and
   * CLAUDE.md at its own root written expressly to be read by an
   * assistant. Read per request rather than cached, so editing the file
   * takes effect on the next question rather than the next restart.
   */
  /*
   * ONLY WHEN A REPOSITORY IS ATTACHED. `activeRoot()` THROWS when none is
   * — and `/api/ask` legitimately answers without one on the design path,
   * which this turned into a 500. Instructions belong to a repository, so
   * having no repository is simply having no instructions.
   */
  /*
   * AND ONLY WHEN THE REPOSITORY IS TRUSTED. `renderTrustedInstructionsSection`
   * asks that question; this line used to call the renderer directly, which
   * meant attaching a repository was consenting to take its orders. The text
   * is still READABLE — `GET /api/repo-trust` serves it to the surface as
   * content — it just does not enter the belt as instruction.
   */
  const instructionLines = renderTrustedInstructionsSection(getRoot(), undefined, readRepoInstructionsCached);
  /*
   * ATTACHMENTS THE TURN NAMED. Ids only on the wire, never content: the
   * text is already on disk, and re-sending it every turn would put the
   * same log through the request body once per follow-up.
   *
   * An id that names nothing is SKIPPED rather than 400ing the whole turn.
   * A sweep can remove an attachment the client still has a chip for, and
   * refusing the question because one piece of evidence aged out would
   * lose the question too.
   */
  const attachmentLines = ((): string[] => {
    const root = getRoot();
    if (root === null || !Array.isArray(body.attachmentIds)) return [];
    const found = (body.attachmentIds as unknown[])
      .map((id) => {
        const record = readAttachment(root, String(id));
        const text = readAttachmentText(root, String(id));
        return record && text !== null
          ? { name: record.name, text, truncated: record.truncated }
          : null;
      })
      .filter((a): a is { name: string; text: string; truncated: boolean } => a !== null);
    return renderAttachmentSection(found);
  })();
  const skillLines = buildSkillLines(question);
  return {
    kind: 'ready' as const,
    turn: {
      ...head, design, designMode, cfg, digest, localContext, askAbort, builtHistory, historyLines,
      instructionLines, attachmentLines, skillLines,
    },
  };
}

/** A prepared turn: the head decided before any provider call, and what the provider call needs. */
export type AskTurn = Extract<Awaited<ReturnType<typeof prepareAskTurn>>, { kind: 'ready' }>['turn'];

/** The pipeline input both routes share. The caller adds `callProvider`. Live state is read here, at call time. */
export function buildAskPipelineInput(env: AskEnv, turn: AskTurn): Omit<AskPipelineInput, 'callProvider'> {
  const { sessionId, userConfigDirFor, resolveReadablePath, askWorkspaceRoot, applyAskProposedFiles, getRoot, getGraph } = env;
  const { question, carriedIn, localContext, parsedIntents, scopeLines, surface, deictic, design, designMode, askMode, jobMode, teach, planCommand, askTurn, askGoal, instructionLines, attachmentLines, historyLines, builtHistory, body, parsedDoneWhen, skillLines, digest, cfg, askCheckpoint, askAbort, askPermission } = turn;
  return {
    question,
    /* The registered wiring. `readCarry` returns undefined when the flag
       is off, so this is exactly today's input until it is turned on. */
    ...(carriedIn ? { carry: carriedIn.carry, turnIndex: carriedIn.turnIndex } : {}),
    ...(localContext ? { localContext } : {}),
    intents: parsedIntents.intents,
    scopeLines,
    surface,
    deictic,
    design,
    designMode,
    askMode,
    jobMode,
    teach,
    ...(planCommand.planning ? { planning: true } : {}),
    /*
     * THE LESSON, KEYED BY THE CONVERSATION THIS ASK BELONGS TO.
     *
     * `TeachTurnContext.concept` was read by the belt and written by
     * nobody, because this handler could not say which conversation a turn
     * was part of — and I reported that as "/ask has no session identity",
     * which was wrong. `PUT /api/sessions/active` has been persisting
     * `SessionIndex.activeId` all along; nothing here read it. The name
     * `sessionId` in this file is the AUTHENTICATED USER, which is what
     * sent me looking for something that already existed.
     *
     * An explicit `threadId` on the request wins; the workspace's active
     * session is the fallback, which is what makes this work today with no
     * client change.
     */
    ...askTurn.contextField(),
    /* THE STANDING GOAL. Absent when the session has none, which keeps
       the assembled prompt byte-identical to the pre-goal one. */
    ...(askGoal ? { goal: askGoal.goal, persistPlan: askGoal.persistPlan } : {}),
    instructionLines,
    attachmentLines,
    historyLines,
    historyMeta: historyMetaOf(builtHistory),
    /* Clamped inside the pipeline by `clampAskRounds`, so a hostile or
       mistaken number cannot buy unbounded provider calls. Passed raw
       here on purpose: one clamp, in one place, is what keeps the
       enforced cap and the cap quoted back to the user identical. */
    maxRounds: typeof body.maxRounds === 'number' ? body.maxRounds : undefined,
    doneWhen: parsedDoneWhen.doneWhen,
    /* Modes the client may send. Two rungs since 2026-09-13; an unknown
       value — including an old client's `propose` / `autoEdit` / `full` —
       falls through to undefined, which STAGES and refuses the shell.
       Default-deny, and the safe direction for a name we do not know. */
    permission: askPermission,
    skillSummaryLines: skillLines.summaryLines,
    skillBodyLines: skillLines.bodyLines,
    notesLines: skillLines.noteLines,
    notesMatchedLines: skillLines.noteMatchedLines,
    agentMapLines: agentMapLinesFor({ storeDir: userConfigDirFor(sessionId), repoRoot: getRoot(), designMode: !!designMode }),
    boardFlowTopDown: readAgentSettings(userConfigDirFor(sessionId)).boardFlowsTopDown,
    surfaceAnswer: undefined,
    graph: designMode ? null : getGraph(),
    digest,
    cfg,
    resolveReadable: resolveReadablePath,
    applyProposedFiles: designMode
      ? undefined
      : (files) => applyAskProposedFiles(files, askCheckpoint.trackWrite, { runId: 'an ask', signal: askAbort.signal }),
    repoRoot: designMode ? null : getRoot(),
    /* No repository ⇒ the local workspace is where files live (workspace.ts). */
    workspaceRoot: askWorkspaceRoot(),
    signal: askAbort.signal,
  };
}

/**
 * The provider callback both routes share. ROUTE DIFFERENCE, kept as it was: the buffered route passes no delta or
 * reasoning sink and counts no retries; the stream route forwards both and reports each call's retry count.
 */
export function makeAskCallProvider(
  env: AskEnv,
  turn: AskTurn,
  opts: { streaming: boolean; onRetries?: (retries: number) => void },
): AskPipelineInput['callProvider'] {
  const { identity, goalDepthFor, callProviderMeteredWithUsage, getRoot } = env;
  const { question, teach, jobMode, askPermission, askGoal, surface, designMode, askTurn, askAbort } = turn;
  return async (c, prompt, onDelta, o) => {
    /* The native schemas are the same belt the prompt hint renders, so they carry the teach narrowing too — a schema
       for a tool the pipeline will refuse is the belt lying in the one channel a native-tool model actually reads. */
    const teachTurn = isTeachTurn({ teach, question });
    const plotTurn = isPlotOrMathDrawAsk(question);
    const tools =
      designMode || getRoot() === null
        ? undefined
        : openaiAskToolDefinitions(
            askToolsForJobMode(jobMode, askPermission, {
              teach: teachTurn,
              plot: plotTurn,
              /* The plan tools are offered only to a session that HAS a goal — see `askToolsForJobMode`. */
              goalDepth: goalDepthFor(askGoal),
            }),
            askOpenAiToolSupplemental({
              teachTurn,
              question,
              surfaceId: surface?.id,
              /* The home workspace has the canvas writers — this mirrors `canvasToolsEnabled`, which is the belt's own gate. */
              designMode,
            }),
          );
    /* A TEACH TURN DOES NOT THINK OUT LOUD, because the bench does not and the two must run the same configuration
       (`TeachTurn.configFor`, measured on docs/research/seat-check-2026-09-05.md). */
    const metered = await callProviderMeteredWithUsage(
      askTurn.configFor(c),
      prompt,
      identity,
      askAbort.signal,
      opts.streaming ? onDelta : undefined,
      tools,
      o?.cacheBreakpointChars,
      opts.streaming ? o?.onReasoning : undefined,
    );
    if (opts.streaming && metered.retries !== undefined) opts.onRetries?.(metered.retries);
    return {
      text: metered.text,
      usage: metered.usage,
      ...(metered.toolRequests?.length ? { toolRequests: metered.toolRequests } : {}),
    };
  };
}

/**
 * THE LESSON, WRITTEN BEFORE THE ANSWER GOES OUT — one rule, two routes. A lesson has to be CREATED on the opening
 * turn or the queue never exists; it advances only when the turn actually taught: a visual AND a closing check, the
 * grader's own two hard rules (`TeachTurn.finish`). `chartsThisTurn` is counted by the caller from what it observed.
 */
export function finishAskTurn(turn: AskTurn, result: AskPipelineResult, chartsThisTurn: number): void {
  writeCarry(turn.carryThreadId, result.carryOut);
  turn.askTurn.finish({
    text: result.text,
    ...(result.diagram === undefined ? {} : { diagram: result.diagram }),
    chartsThisTurn,
    /* Carried so the NEXT turn can reveal it with its arrow. */
    ...(result.openPrediction === undefined ? {} : { openPrediction: result.openPrediction }),
  });
}
