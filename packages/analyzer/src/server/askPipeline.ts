/**
 * Shared ask pipeline — buffered `/api/ask` and streaming `/api/ask/stream`.
 * Yields trace events for work that already happens server-side (intents, file
 * reads, provider call, usage). Includes a mid-turn tool loop: after each
 * provider call the model may request allowlisted read-only tools
 * (`read_file`, `search_files`); the server executes them through the SAME
 * jail as GET /api/file, emits honest `tool:start`/`tool:done` (and
 * `file:read`/`file:done` for reads), feeds the real results back into the
 * next provider call, and repeats up to {@link MAX_ASK_TOOL_ROUNDS} rounds.
 *
 * Evidence is CUMULATIVE across those rounds: every round's tool results go
 * into a per-turn evidence ledger and the whole (bounded) ledger is rendered
 * into each subsequent prompt. Before this, each round's prompt was rebuilt
 * from the base plus only the newest round's results, so the model lost what
 * it had read one round earlier and re-read it. See `selectCarriedEvidence`.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  runAllowlistedRepoCommand,
  runAskDoneWhen,
  type AskDoneWhen,
  type AskVerifyResult,
} from '../harness/verifyGate.js';
import { wrapUntrustedLines } from '../llm/untrusted.js';
import {
  applyProseDiffFile,
  parseProseDiffs,
} from './proseDiff.js';
import type { ArchGraph, SeqChart } from '@sequence/schema';
import { validateChart } from '@sequence/schema';
import { PLAN_MODE_INSTRUCTIONS } from '@sequence/acp';
import type { AiConfig } from './provider.js';
import {
  buildAdvisorPrompt,
  parseAdvisorReply,
  resolveRoleConfig,
  shouldConsultAdvisor,
  type AdvisorNote,
  type AdvisorSeverity,
} from './modelRoles.js';
import type { AskCoverage, AskComposition, DesignAskContext } from '../explain/explain.js';
import {
  buildAskPrompt,
  buildAskPromptWithCoverage,
  buildDesignAskPrompt,
  buildDigest,
  deriveAskDiagram,
  renderAskHistorySection,
} from '../explain/explain.js';
import {
  executeAskIntents,
  renderAskIntentSection,
  renderAskContextSection,
  type AskIntentInvocation,
} from '../explain/askIntents.js';
import {
  gatherAskFileResearchTraced,
  renderAskFileResearchSection,
} from '../explain/askFileResearch.js';
import {
  renderAskSurfaceSection,
  type AskSurfaceContext,
} from '../explain/askSurface.js';
import { checkAnswerClaims, checkQuestionPremise } from '../moat/claimCheck.js';
import { CANVAS_STORY_TOOL, isCanvasToolName } from './canvasTools.js';
import { attemptNextPictureCheckIn, buildConceptChart, deriveCheckIn, deriveNextPictureCheckIn } from './conceptChart.js';
import { EMPTY_CARRY, excerptsReachable, extendCarry, pathsNamedIn, renderCarry } from './turnCarry.js';

/*
 * STAGE FOUR'S TREATMENT FLAG. Default OFF, so the control arm and the
 * treatment arm are the SAME BUILD and this env var is the only difference
 * between them -- the control law applied at design time rather than
 * discovered after a run. Registered in
 * docs/research/carry-redesign-registration.md.
 *
 * Read through a function, not captured into a module constant, so a test can
 * set the variable and observe the change without reloading the module -- ESM
 * caches transitive modules, and a constant here would make the flag
 * untestable in-process.
 */
export const carryReferentsEnabled = (): boolean =>
  process.env.SEQUENCE_ASK_CARRY_REFERENTS === '1';

/** The section header the `before-question` placement inserts ahead of. */
export const ASK_QUESTION_MARKER = '--- QUESTION ---';

/**
 * Where the carried block is placed. Default `tail` - the shipped behaviour and
 * the control arm of the registered placement measurement.
 */
export const carryPlacement = (): 'tail' | 'before-question' | 'last' => {
  const v = process.env.SEQUENCE_ASK_CARRY_PLACE;
  return v === 'before-question' || v === 'last' ? v : 'tail';
};
import type { TurnCarry } from './turnCarry.js';
import { buildExamplePlot, buildPlot } from './mathKind.js';
import {
  gradeCheckIn,
  TEACH_CLOSING_COMPREHENSION_EXAMPLE,
  TEACH_CLOSING_PREDICTION_EXAMPLE,
} from './checkIn.js';
import {
  ASK_MUTATING_TOOLS,
  ASK_TOOL_ALLOWLIST,
  MAX_ASK_TOOL_ROUNDS,
  resolveUnproductiveRoundLimit,
  executeAskTool,
  isAskToolCacheable,
  isDrawishAskQuestion,
  isOncePerTurnAskTool,
  mergeToolRequests,
  oncePerTurnAskToolAlreadySucceeded,
  oncePerTurnAskToolRefusal,
  parseAllToolRequests,
  parseFencedSeqdProposals,
  resolveAskEvidenceLedgerCap,
  resolveAskRoundCap,
  resolveTurnDeadlineMs,
  salvageBareSeqdProposals,
  salvageBareToolRequests,
  renderAskToolHintSection,
  renderCanvasToolHintSection,
  renderChartToolHintSection,
  renderDesignTopologyHintSection,
  renderToolResultsSection,
  selectCarriedEvidence,
  stableAskToolCacheKey,
  type AskEvidenceEntry,
  type AskJobMode,
  type AskToolContext,
  type AskToolRequest,
  type AskToolResult,
} from './askTools.js';
import { classifyAskIntent, isTeachAskQuestion, type AskClassifiedIntent } from './askIntent.js';
import { answerEchoesUntrustedBlock, UNTRUSTED_ECHO_REFUSAL } from '../llm/untrusted.js';
import { approxTokens, planContextFit, type ContextPlan } from '../llm/tokenBudget.js';
import { permissionAutoWrites } from './applyAskFileWrites.js';
import {
  PermissionCircuitBreaker,
  evaluatePermission,
  loadPermissionPolicy,
  sourceLabel,
  type PermissionPolicy,
} from './permissionRules.js';
import {
  AUTO_APPROVE_STEP_ID,
  approveAskVerdict,
  isAskVerdict,
  isAutoApproveActive,
} from './autoApprove.js';

export interface AskUsagePayload {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface AskMetricsPayload {
  wallMs?: number;
  rounds: number;
  stopReason: 'complete' | 'ceiling' | 'no-progress' | 'breaker' | 'deadline';
  designMode: boolean;
  intent?: AskClassifiedIntent;
  inputTokens?: number;
  outputTokens?: number;
  /** Per callProvider invocation — diagnoses slow turns vs tool-loop churn. */
  providerCallMs?: number[];
}

/** Prompt-window breakdown for the ContextRing popover (B3.4). */
export interface AskContextSectionPayload {
  id: 'grounding' | 'instructions' | 'tools' | 'other';
  label: string;
  tokens: number;
  estimated: boolean;
}

export interface AskContextBreakdownPayload {
  sections: AskContextSectionPayload[];
  totalApprox: number;
  totalMeasured?: number;
}

export interface AskDiagramPayload {
  type: 'flow' | 'sequence';
  scopeNodeIds: string[];
}

export interface AskPipelineResult {
  text: string;
  diagram?: AskDiagramPayload;
  unsupportedIntents?: string[];
  usage?: AskUsagePayload;
  source?: 'surface' | 'provider' | 'lesson';  /* 'lesson': a teach ask refused for want of a subject, answered with no
     provider call and nothing metered — see lessonState.subjectlessRefusal. */
  metrics?: AskMetricsPayload;
  /** Named slices of what filled the prompt (B3.4). */
  contextBreakdown?: AskContextBreakdownPayload;
  /** Optional advisor note (MADR model-roles). Absent when no advisor is bound. */
  advisor?: AdvisorNote;
  /**
   * WHAT THIS ANSWER WAS ABLE TO SEE — item 1.1, and the one claim a terminal
   * agent cannot make. `edgesTotal` is the whole scanned graph; `edgesSeen` is
   * what survived the digest cap, the ask scoping and the token budget;
   * `packagesMissed` names the components that contributed nothing.
   *
   * ABSENT, NEVER ZEROED, when there is no scanned graph to count against
   * (design mode, or a surface answer that consulted no digest). A zero
   * denominator would read as "saw nothing" instead of "nothing to measure",
   * and inventing a denominator is the failure this field exists to prevent.
   */
  coverage?: AskCoverage;
  /**
   * The next-picture prediction this turn asked, for the caller to persist so
   * the NEXT turn can reveal it with the arrow that decides it. Absent unless
   * `SEQUENCE_TEACH_CHECKIN_FORM=next-picture`.
   */
  openPrediction?: { question: string; expect: string; arrow: string };
  /**
   * Why no derived check-in was appended, when a turn was otherwise eligible.
   * Absent when one was appended, or when the turn never reached the gate.
   */
  checkInSkipped?: string;
  /**
   * WHAT THIS TURN FOUND, for the caller to hand the next one.
   *
   * Files read with their text, the chart drawn as structure, the concept
   * taught with the turn's own opening line. The caller persists it; the next
   * turn passes it back as `carry`. See server/turnCarry.ts for why it refuses
   * to hold anything no turn produced.
   */
  carryOut?: TurnCarry;
  /**
   * WHAT THE GRAPH COULD NOT CONFIRM — the lie detector's report.
   *
   * Absent when the answer is clean or when there was no scanned graph to check
   * against. Present only when there is something a reader should see, so the
   * field's mere presence means "look at this".
   */
  claims?: AskClaimCheck;
  /**
   * THE PREMISE THE QUESTION ASSERTED, when the graph refutes it.
   *
   * `claims` checks what the model said; this checks what the USER said, which
   * nothing did before — so a false premise arrived, steered the turn, and only
   * its consequence was examined. Present only when there is something to say.
   */
  premise?: AskPremiseCheck;
  /**
   * Whether the assembled prompt fits the window a local model will run.
   *
   * Attached only for a local Ollama profile, and only when there is something to
   * say — `refuse` (it will be truncated) or `unknown` (the window could not be
   * read). A prompt that comfortably fits reports nothing, so the field's
   * presence means "look at this", like `claims` and `premise`.
   */
  contextFit?: ContextPlan;
  /**
   * THE DONE-WHEN RECEIPT — what the caller's acceptance command said about
   * the turn's writes. Present ONLY when the turn was given a `doneWhen` AND
   * actually wrote a file: a turn that changed nothing has nothing to gate,
   * and a zeroed receipt would read as "ran and passed nothing" instead of
   * "there was nothing to run". Only `status: 'passed'` is a pass; a refusal
   * carries `refuseReason` and a skip carries the caller's reason.
   */
  verify?: AskVerifyResult;
  /**
   * Paths that actually reached disk this turn — the loop's own
   * `writtenFilesThisTurn`, which the done-when gate already keys on. Present
   * on every provider turn, `[]` included: a turn that wrote nothing measured
   * that. Absent on a surface answer, where no loop ran. Exposed for the run
   * receipt (`runReceipt.ts`), which otherwise could not say what changed.
   */
  filesWritten?: string[];
  /**
   * Which permission files governed the turn — `PermissionPolicy.sources`, in
   * precedence order, as loaded for THIS turn. `[]` means no file anywhere
   * and the built-in default decided. Absent on a surface answer. Exposed for
   * the run receipt; the breaker note above already cites the same list.
   */
  permissionSources?: string[];
}

/**
 * WHAT THE GRAPH COULD NOT CONFIRM ABOUT THIS ANSWER.
 *
 * The first real answer this product gave said the system used "MySQL
 * databases" when zero files mention MySQL and `db.py` calls
 * `sqlite3.connect`. Nothing checked, because nothing could. A confident false
 * sentence reads exactly like a true one, and a GROUNDED tool that ships one
 * spends the credibility grounding was supposed to earn.
 *
 * Only two categories are checked, because only two are genuine closed worlds:
 * a datastore technology the scan enumerates, and a cited file path the scan
 * holds. Everything else a model writes is prose a scan cannot refute, and
 * flagging it would produce warnings that teach a reader to click past the one
 * that mattered.
 *
 * IT IS A FLAG, NEVER A VERDICT. Nothing is suppressed or rewritten on its
 * say-so — the model may be contrasting, quoting the user, or discussing a
 * migration. Absent when there is nothing to report OR nothing could be
 * checked, and `checked` says which.
 */
export interface AskClaimCheck {
  /** Technologies named in the answer that the scan did not find anywhere. */
  unsupportedTechnologies: {
    term: string;
    /** What the scan DID find, so the correction is in hand. */
    found: string[];
    /** The sentence it appeared in, so a reader can judge intent. */
    quote: string;
  }[];
  /** Cited paths that resolve to no file in the scan. */
  unknownPaths: { path: string; quote: string }[];
  /** Which checks actually ran — an empty finding list from a check that could
   *  not run is not a clean bill of health. */
  checked: { datastores: boolean; files: boolean };
}

/**
 * A premise in the QUESTION that the graph refutes.
 *
 * Same shape as a claim finding, minus paths: a path in an answer that resolves
 * to nothing may be a fabrication, while a path in a question is just a user
 * guessing at a filename, and flagging that would be noise.
 *
 * WHAT THE HARNESS DOES WITH THIS IS DELIBERATELY NOT DECIDED HERE. The answer
 * check is documented "A FLAG, NEVER A VERDICT" and that restraint is right for
 * an answer. A question may be different — leading with the correction and then
 * answering what was probably meant is more useful and more likely to be read,
 * but it is also the harness contradicting the user out loud, which is a tone
 * decision and the owner's to make. Until then this is carried as evidence.
 */
export interface AskPremiseCheck {
  unsupportedTechnologies: { term: string; found: string[]; quote: string }[];
  /**
   * Premises the scan is NOT ENTITLED to refute, and why.
   *
   * A different answer from an empty finding list, not a weaker one. "There is
   * no Python here" and "I never read the directories where Python would live"
   * are opposite claims. Omitting this made a check that ran and correctly
   * declined look identical, on the wire, to a check that never ran — which
   * cost two rounds of debugging before anyone thought to measure it.
   */
  unverifiable: { term: string; blockedBy: string[]; reasons: string[]; quote: string }[];
  /** Which worlds could actually be checked. `truncated` = the file walk hit
   *  its cap, so an absence proves nothing. */
  checked: { datastores: boolean; languages: 'checked' | 'none-found' | 'truncated' | 'unknown' };
}

export type AskStreamEvent =
  /**
   * One fragment of the answer as it is generated — a FRAGMENT, not the answer
   * so far, because the client appends and a stream that re-sends its own prefix
   * renders quadratically.
   *
   * Declared here AND in `@sequence/api-types`, which is a duplication this file
   * already carries for every other variant and which `tools/ci/api-types.test.mjs`
   * exists to police. Adding a member to one copy and not the other is the drift
   * that test catches.
   */
  | { type: 'delta'; text: string }
  | { type: 'intent:start'; id: string }
  | { type: 'intent:done'; id: string }
  | { type: 'file:read'; path: string }
  | { type: 'file:done'; path: string }
  | { type: 'step:start'; id: string }
  | { type: 'step:done'; id: string }
  | { type: 'tool:start'; id: string; name?: string; evidence?: string }
  | { type: 'tool:done'; id: string; name?: string; evidence?: string }
  | {
      type: 'canvas:block';
      id: string;
      blockType: 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';
      title?: string;
      payload: string;
      status: 'live' | 'landed';
    }

  | {
      /**
       * A chart the model asked Sequence to DRAW (`propose_chart`). The payload
       * is a VALIDATED SeqChart spec — data, never render code — so the client
       * owns the pixels and the harness already owned the truth check (every
       * nodeId exists in the scanned graph or the tool refused).
       *
       * Declared here AND in `@sequence/api-types`, per this union's own rule.
       *
       * TYPED as `SeqChart` (was `unknown`): the sentence above was already the
       * contract, and leaving it unknown meant the client could not read the
       * spec without a cast — part of why `SeqChartView` had no caller while
       * every chart landed in state unread.
       */
      type: 'chart:proposal';
      chart: SeqChart;
    }
  | {
      /**
       * THE LESSON'S PLAN, written once at the opening turn for a lesson the
       * graph cannot order. Emitted so the caller can STORE it — the model is
       * never asked for it again, and a plan re-derived each turn is not a plan
       * but a fresh opinion.
       */
      type: 'plan:proposed';
      concepts: { title: string; nodeId?: string }[];
    }
  | {
      /**
       * ONE STEP OF A LESSON — `docs/teach-mode.md` §3. Teach turns only, and
       * always alongside the chart it describes.
       *
       * IT RIDES THE CHART. The first attempt captioned from the answer `text`
       * and was reverted (604fa893) because the harness overwrites `text` with
       * its own apology on a bad ending — so a failed lesson captioned the
       * board with harness prose. A chart's `title`/`caption` cannot be
       * overwritten that way and are about ONE concept, which is what a step
       * is; `litNodeIds` are ids `validateChart` already checked against the
       * scanned graph, so nothing is invented here.
       *
       * `flow` and `fit` are in the doc and deliberately NOT here: no tracer
       * can build a FlowPlayback, and canvas/fit needs bounds only the board
       * computes. See the api-types declaration for the full reasoning.
       *
       * Declared here AND in `@sequence/api-types`, per this union's own rule.
       */
      type: 'teach:step';
      caption: string;
      litNodeIds?: string[];
    }
  | {
      /**
       * A SYMBOL LOOKUP FOUND WHERE IT IS DECLARED — ids and nothing else.
       *
       * Deliberately NOT `teach:step`. That event's caption asserts a lesson,
       * and a lookup is not one; emitting it here would stamp the turn as a
       * lesson step it never was. No caption, no lesson state, no chart — a
       * lookup has nothing to say on the canvas, only somewhere to point.
       *
       * Declared here AND in `@sequence/api-types`, per this union's own rule.
       */
      type: 'lookup:located';
      nodeIds: string[];
    }
  | {
      type: 'canvas:story';
      title: string;
      steps: Array<{ blockId: string; caption: string }>;
    }
  | {
      type: 'edit:proposal';
      title?: string;
      rationale?: string;
      files: { path: string; content: string }[];
      /** P3 — Auto-edit / Full already wrote these files. */
      applied?: boolean;
    }
  | {
      /* The architecture half of a proposal. Declared here AND in api-types,
         the duplication tools/ci/api-types.test.mjs polices. */
      type: 'topology:proposal';
      title?: string;
      rationale?: string;
      nodes: { id: string; label: string; kind: string }[];
      edges: { id: string; from: string; to: string; family: string; label?: string }[];
    }
  | {
      type: 'command:log';
      cmd: string;
      exitCode: number | null;
      output: string;
      ok: boolean;
    }
  | { type: 'provider:start' }
  | { type: 'provider:done' }
  | { type: 'advisor'; severity: AdvisorSeverity; note: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimated: boolean }
  | {
      type: 'trajectory:start';
      runId: string;
      /** sha256 (truncated) of the instruction belt: tool/canvas/plan-mode hints. */
      instructionHash: string;
    }
  | {
      type: 'result';
      text: string;
      diagram?: AskDiagramPayload;
      unsupportedIntents?: string[];
      usage?: AskUsagePayload;
      metrics?: AskMetricsPayload;
      contextBreakdown?: AskContextBreakdownPayload;
      source?: 'surface' | 'provider' | 'lesson';  /* 'lesson': a teach ask refused for want of a subject, answered with no
     provider call and nothing metered — see lessonState.subjectlessRefusal. */
      advisor?: AdvisorNote;
      /** See {@link AskPipelineResult.coverage} — a streaming client is told the same. */
      coverage?: AskCoverage;
      /** See {@link AskPipelineResult.claims}. */
      claims?: AskClaimCheck;
      /** See {@link AskPipelineResult.verify} — absent unless a done-when gate ran. */
      verify?: AskVerifyResult;
    }
  | { type: 'error'; error: string; providerResponse?: string; httpStatus?: number; fix?: 'provider' };

export interface AskPipelineInput {
  /**
   * WHAT THE PREVIOUS TURN OF THIS CONVERSATION FOUND — see server/turnCarry.ts.
   * Absent on the first turn, and absent means an empty block rather than an
   * empty header.
   */
  carry?: TurnCarry;
  /** Which turn of the conversation this is, for the carry's own record. */
  turnIndex?: number;

  question: string;
  intents: readonly AskIntentInvocation[];
  scopeLines: readonly string[];
  surface: AskSurfaceContext | undefined;
  deictic: boolean;
  design: DesignAskContext | undefined;
  designMode: boolean;
  askMode: 'implementation' | 'research';
  /** Work | Code — Work omits run_command from the default tool belt. */
  jobMode?: AskJobMode;
  /** Teach Mode (docs/teach-mode.md): one concept, one visual, one check-in per turn. */
  teach?: boolean;
  /**
   * The lesson slots for this turn. Both callers already pass it -- the ask
   * handler and the bench, through `buildTeachContext` -- and it was typed only
   * on the instruction-hash input, so the pipeline could render it into the belt
   * and not read it. The derived visual needs the concept, which is the first
   * thing outside the prompt to want it.
   */
  teachContext?: TeachTurnContext;
  /**
   * What the USER said the agent may do, from the control under the composer.
   *
   *   - `plan`     — reading tools only
   *   - `propose`  — proposals stage; human Accepts
   *   - `autoEdit` — proposals write to disk without Accept; no shell
   *   - `full`     — auto-write plus `run_command` under permission rules
   */
  permission?: string;
  /**
   * When Auto-edit / Full is on, the host supplies this so the pipeline can
   * write proposed files through the same jail + pre-write hooks as PUT
   * `/api/file`. Absent ⇒ proposals stay staged (propose mode).
   */
  applyProposedFiles?: (
    files: readonly { path: string; content: string }[],
  ) => Promise<{
    written: string[];
    refused: { path: string; reason: string }[];
    blockedByHook?: string;
    /**
     * Which of `written` already existed — the files the turn CHANGED rather
     * than created. Optional so an older caller still type-checks; absent is
     * read as "none known", which is the conservative direction (the salvage
     * paths then behave exactly as they did before this field existed).
     */
    modified?: string[];
  }>;
  /**
   * How many tool rounds this question may use. Absent means the default.
   *
   * Clamped by `clampAskRounds` — see `ASK_ROUNDS_CEILING`. Every round is a
   * metered provider call, so this raises a limit; it never removes one.
   */
  maxRounds?: number;
  /**
   * Wall-clock budget for the whole turn, in ms. Omitted takes
   * `ASK_TURN_DEADLINE_MS`; <= 0 means no deadline. SOFT: it stops the loop
   * from starting another tool round, and never aborts a call in flight.
   */
  turnDeadlineMs?: number;
  /**
   * THE ACCEPTANCE GATE FOR A WRITE TURN. Until it existed the verify
   * contract could only TELL the model its edit was unverified and then end
   * the turn anyway (see the verify-contract block in the rounds loop); nothing
   * the caller stated as "done when" was ever executed by the harness itself.
   * With a `command` here, a turn that wrote at least one file runs it after
   * the rounds loop and reports the outcome in `AskPipelineResult.verify` and
   * in the answer's closing sentence. A `skip` records why the caller declined
   * the gate. Absent means no gate — the historical behaviour.
   *
   * A failing gate NEVER reverts the edit: it is named, and the turn's
   * checkpoint is the rollback point.
   */
  doneWhen?: AskDoneWhen;
  /** The repository's own standing instructions, as rendered prompt lines. */
  instructionLines?: readonly string[];
  /** Rendered attachment section - what the user pasted or dropped in. */
  attachmentLines?: readonly string[];
  /** Prior chat turns (workspace memory) as rendered prompt lines. */
  historyLines?: readonly string[];
  /**
   * The window a LOCAL OLLAMA will actually run, when that is what we are
   * talking to. Present means the check applies; `window: null` inside it means
   * the Modelfile sets no `num_ctx`, so the server default decides and
   * `/api/show` does not report it — unknown, never "fine".
   *
   * Supplied by the caller rather than probed here: the pipeline owns the prompt
   * and therefore the token count, the caller owns the network. That keeps a
   * loopback fetch out of a function every pipeline test would then have to stub.
   */
  localContext?: { window: number | null };
  /** Phase 3 — always-loaded skill summaries (rendered prompt lines). */
  skillSummaryLines?: readonly string[];
  /** Phase 3 — the matched skill's full body (rendered prompt lines). */
  skillBodyLines?: readonly string[];
  surfaceAnswer?: string;
  graph: ArchGraph | null;
  digest: ReturnType<typeof buildDigest> | undefined;
  cfg: AiConfig;
  resolveReadable: (rel: string) => string | null;
  /** Canonical repo root for the tool walk; `null` in design mode. */
  repoRoot?: string | null;
  /**
   * P3 phase 2 — the merged allow/ask/deny policy. Omitted ⇒ the pipeline loads
   * it from `repoRoot` itself, so every caller gets the rules without a second
   * wiring site. Pass one explicitly (a test, or a caller that already resolved
   * it) to skip the disk read.
   */
  permissions?: PermissionPolicy;
  /**
   * `onDelta` is optional and the JSON route never passes one: a non-streaming
   * caller must keep behaving byte-identically, and a token handed to nobody is
   * a wasted allocation per chunk on the hot path.
   */
  /**
   * When aborted, the pipeline stops before the next provider call or tool
   * execution and rejects with `RequestAbortedError` — no fake answer.
   */
  signal?: AbortSignal;
  callProvider: (
    cfg: AiConfig,
    prompt: string,
    onDelta?: (text: string) => void,
    /** Prompt-caching hint: where the turn's invariant prefix ends (chars). */
    opts?: { cacheBreakpointChars?: number },
  ) => Promise<{
    text: string;
    usage?: AskUsagePayload;
    /** Structured tool requests returned by the provider (honest only — never fabricated). */
    toolRequests?: ReadonlyArray<{
      id: string;
      name: string;
      args?: Record<string, unknown>;
      evidence?: string;
    }>;
  }>;
}

function throwIfAskAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('request aborted by the client');
    err.name = 'RequestAbortedError';
    throw err;
  }
}

/** Cacheable read tools in one round may run concurrently; everything else stays serial. */
function canParallelizeAskToolInRound(
  tr: AskToolRequest,
  input: AskPipelineInput,
  onceFlags: { topology: boolean; canvas: boolean; files: boolean },
): boolean {
  if (!isAskToolCacheable(tr.name)) return false;
  if ((input.permission === 'plan' || input.teach === true) && ASK_MUTATING_TOOLS.includes(tr.name as never)) return false;
  if (tr.name === 'run_command' && input.permission !== 'full') return false;
  if (isOncePerTurnAskTool(tr.name) && oncePerTurnAskToolAlreadySucceeded(tr.name, onceFlags)) {
    return false;
  }
  return true;
}

interface AskToolRoundSink {
  push: (event: AskStreamEvent) => void;
  input: AskPipelineInput;
  breaker: PermissionCircuitBreaker;
  toolResultBodies: string[];
  seenEvidence: Set<string>;
  roundBroughtSomethingNew: { value: boolean };
  topologySucceededThisTurn: { value: boolean };
  canvasWriteSucceededThisTurn: { value: boolean };
  filesProposalSucceededThisTurn: { value: boolean };
  /** How many charts this turn drew — the teach contract's visual receipt. */
  chartsThisTurn: { value: number };
  /**
   * The last list a tool result produced this turn — what a follow-up question
   * will point at with "those". Recorded unconditionally; whether it reaches
   * the next turn's PROMPT is the treatment flag's business, so the control arm
   * and the treatment arm run the same code down to the render.
   */
  referentsThisTurn: { value?: { tool: string; subject: string; items: readonly string[]; total: number } };
  fileWriteCallsThisTurn: { value: number };
  trippedBreaker: { value: boolean };
  /**
   * Repo-relative paths that actually REACHED DISK this turn. Distinct from
   * `fileWriteCallsThisTurn`, which counts attempts (a refused or hook-blocked
   * write still spends budget) — the done-when gate keys off writes that
   * landed, because a gate run over an untouched tree verifies nothing.
   */
  writtenFilesThisTurn: string[];
  /**
   * Of those, the ones that ALREADY EXISTED — the files this turn changed
   * rather than created. The two salvage paths key off this, not off a write
   * count: a brand-new file is a repro or a scratch note, and treating it as
   * "the fix is written" is what cost mini-50 v17 sixteen of its 25 empty
   * patches.
   */
  modifiedExistingThisTurn: string[];
}

/**
 * THE SYNTAX GATE — a write that does not parse is named in the same round.
 *
 * Measured on the mini-50 official eval (django-12304, 2026-08-30): an edit
 * landed cleanly, the turn ended claiming success, and the evaluator's very
 * first import died on an IndentationError — the entire instance lost to a
 * file that never parsed, which one free interpreter call would have caught.
 * So under Full permission, every written .py/.js/.mjs/.cjs file is compile-
 * checked harness-side (py_compile / node --check) and a failure is appended
 * to the SAME tool result the model reads next round. Best-effort by design:
 * no interpreter, unsafe path, or unknown extension mean no check — never a
 * refusal of the write itself, and never a claim the file is fine.
 */
function syntaxCheckWrittenFiles(
  written: readonly string[],
  repoRoot: string,
): string[] {
  const problems: string[] = [];
  for (const rel of written.slice(0, 8)) {
    const lower = rel.toLowerCase();
    let cmd: string | null = null;
    if (lower.endsWith('.py')) cmd = `python -m py_compile "${rel}"`;
    else if (/\.(mjs|cjs|js)$/.test(lower)) cmd = `node --check "${rel}"`;
    if (!cmd) continue;
    const ran = runAllowlistedRepoCommand(cmd, repoRoot, {
      widenToRunnerBins: true,
      timeoutMs: 10_000,
      outputCap: 600,
    });
    if (ran.refuseReason) continue; // no interpreter / unsafe path: silence, not a verdict
    if (!ran.ok) {
      problems.push(`${rel} DOES NOT PARSE after your edit: ${ran.output.trim() || `exit ${ran.exitCode}`}`);
      continue;
    }
    /*
     * THE IMPORT SMOKE — py_compile is not enough. Measured twice on the
     * mini-50 (django-12304, runs v10 and v13): an edit that parsed cleanly
     * raised at IMPORT time ("Cannot extend enumerations"), the whole package
     * became unimportable, and the official evaluator's first import lost the
     * instance. Importing the edited module catches that class in ~1s.
     * Full-permission only (run_command already executes arbitrary test
     * runners here, so importing an edited module is a lesser power), and
     * only for paths whose every segment is a plain identifier — anything
     * else is silence, never a verdict.
     */
    if (lower.endsWith('.py')) {
      const mod = rel
        .replace(/\.py$/i, '')
        .replace(/\\/g, '/')
        .split('/')
        .filter((seg) => seg.length > 0);
      const importable =
        mod.length > 0 &&
        mod.every((seg) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) &&
        mod[mod.length - 1] !== '__init__';
      if (importable) {
        const imp = runAllowlistedRepoCommand(`python -c "import ${mod.join('.')}"`, repoRoot, {
          widenToRunnerBins: true,
          timeoutMs: 15_000,
          outputCap: 600,
        });
        /*
         * BLAME THE FILE, NOT THE ENVIRONMENT. Measured on django-11790
         * (probe, 2026-08-31): `import django.contrib.auth.forms` fails with
         * ImproperlyConfigured on ANY correct edit — settings-coupled
         * packages cannot import standalone — and the phantom "DOES NOT
         * IMPORT" warning sent the model into a repair spiral that broke the
         * most stable instance we had. A warning is emitted only when the
         * traceback's failing frames include the EDITED file itself; an
         * environment that refuses to import is silence, not a verdict.
         */
        /*
         * Match the FULL edited path in the traceback, not a bare basename:
         * two files named `models.py` are common, and a transitive import
         * error in some OTHER models.py would otherwise be blamed on the one
         * we edited. A syntax/indentation error anywhere is still ours to own
         * (py_compile would have caught it, but a late parse in an imported
         * sibling still means the edit made the tree unimportable).
         */
        const relPosix = rel.replace(/\\/g, '/');
        if (
          !imp.refuseReason &&
          !imp.ok &&
          (imp.output.replace(/\\/g, '/').includes(relPosix) ||
            /SyntaxError|IndentationError/.test(imp.output))
        ) {
          problems.push(
            `${rel} DOES NOT IMPORT after your edit: ${imp.output.trim() || `exit ${imp.exitCode}`}`,
          );
        }
      }
    }
  }
  return problems;
}

/** Post-execute handling shared by sequential and parallel tool paths. */
async function applyAskToolRoundResult(
  tr: AskToolRequest,
  result: AskToolResult,
  toolDoneEmitted: boolean,
  sink: AskToolRoundSink,
): Promise<void> {
  const { push, input, breaker, toolResultBodies, seenEvidence } = sink;
  /* Every path that can produce referents comes through here: the other two
     executeAskTool sites are draw-only (`isDrawTool`) and propose_topology. */
  if (result.referents !== undefined) sink.referentsThisTurn.value = result.referents;
  let toolEvidence = result.evidence;
  let fedBack = false;
  if (result.proposal) {
    sink.filesProposalSucceededThisTurn.value = true;
    sink.fileWriteCallsThisTurn.value += 1;
    let applied = false;
    if (
      permissionAutoWrites(input.permission) &&
      input.applyProposedFiles &&
      result.proposal.files.length > 0
    ) {
      const write = await input.applyProposedFiles(result.proposal.files);
      if (write.blockedByHook) {
        toolEvidence = `proposed but NOT written — ${write.blockedByHook}`;
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${toolEvidence}`);
        fedBack = true;
      } else if (write.refused.length > 0) {
        const reasons = write.refused.map((r) => `${r.path}: ${r.reason}`).join('; ');
        toolEvidence = `proposed but NOT written — ${reasons}`;
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${toolEvidence}`);
        fedBack = true;
      } else if (write.written.length > 0) {
        applied = true;
        // One entry per FILE, not per write: a path edited twice in a turn is
        // one file on disk, and the done-when sentence and the receipt count files.
        for (const rel of write.written) {
          if (!sink.writtenFilesThisTurn.includes(rel)) sink.writtenFilesThisTurn.push(rel);
        }
        /* WHICH OF THEM CHANGED CODE THAT ALREADY EXISTED — the signal the two
           salvage guards actually want. See `modified` on
           ApplyAskFileWritesResult for the run this cost. */
        for (const rel of write.modified ?? []) {
          if (!sink.modifiedExistingThisTurn.includes(rel)) sink.modifiedExistingThisTurn.push(rel);
        }
        toolEvidence =
          `wrote ${write.written.length} file` +
          `${write.written.length === 1 ? '' : 's'} under Auto-edit/Full ` +
          `(${write.written.join(', ')})`;
        if (input.permission === 'full' && input.repoRoot) {
          const broken = syntaxCheckWrittenFiles(write.written, input.repoRoot);
          if (broken.length > 0) {
            toolEvidence += ` — WARNING: ${broken.join('; ')}. Fix the syntax before anything else.`;
          }
        }
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${toolEvidence}`);
        fedBack = true;
      }
    }
    push({
      type: 'edit:proposal',
      ...(result.proposal.title ? { title: result.proposal.title } : {}),
      ...(result.proposal.rationale ? { rationale: result.proposal.rationale } : {}),
      files: result.proposal.files,
      ...(applied ? { applied: true } : {}),
    });
  }
  if (result.plan && result.plan.length > 0) {
    push({ type: 'plan:proposed', concepts: result.plan });
  }
  if (result.chart) {
    sink.chartsThisTurn.value += 1;
    push({ type: 'chart:proposal', chart: result.chart });
    /*
     * A TEACH TURN'S STEP RIDES ITS CHART. The teach contract already demands
     * one concept and one visual per turn, so the chart IS the step: its
     * caption is the model's sentence about that concept, and its nodeIds are
     * ids `validateChart` checked against the scanned graph before this event
     * was allowed to exist. Nothing is invented and nothing can overwrite it —
     * which is the failure that reverted the first attempt (604fa893), where
     * the caption came from the answer text and a harness apology could take
     * its place.
     */
    if (sink.input.teach === true) {
      const lit = result.chart.items
        .map((item) => item.nodeId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      push({
        type: 'teach:step',
        caption: result.chart.caption ?? result.chart.title,
        ...(lit.length > 0 ? { litNodeIds: lit } : {}),
      });
    }
  }
  /*
   * A LOOKUP POINTS AT THE BOARD — and says nothing else.
   *
   * Unconditional, unlike `teach:step` above, which is gated on
   * `sink.input.teach`. A lookup is not a lesson and does not become one inside
   * a lesson: the engineer who asks where a symbol lives wants the same thing
   * either way, and gating this on teach mode would leave the map still and
   * silent for exactly the person the feature is for.
   *
   * `resolveGraphTargets` produced these ids from the scanned graph, so there
   * is nothing to validate here that was not already true when the field was
   * set - and the field is absent, not empty, when there was nothing to point
   * at, so this cannot emit a spotlight on nothing.
   */
  if (result.located && result.located.length > 0) {
    push({ type: 'lookup:located', nodeIds: result.located });
  }
  if (result.topology) {
    sink.topologySucceededThisTurn.value = true;
    push({
      type: 'topology:proposal',
      ...(result.topology.title ? { title: result.topology.title } : {}),
      ...(result.topology.rationale ? { rationale: result.topology.rationale } : {}),
      nodes: result.topology.nodes,
      edges: result.topology.edges,
    });
  }
  if (result.canvasBlock) {
    sink.canvasWriteSucceededThisTurn.value = true;
    push({
      type: 'canvas:block',
      id: result.canvasBlock.id,
      blockType: result.canvasBlock.type,
      ...(result.canvasBlock.title ? { title: result.canvasBlock.title } : {}),
      payload: result.canvasBlock.payload,
      status: 'live',
    });
  }
  if (!toolDoneEmitted) {
    push({
      type: 'tool:done',
      id: tr.id,
      ...(tr.name ? { name: tr.name } : {}),
      evidence: toolEvidence,
    });
  }
  if (result.storyRoute) {
    push({
      type: 'canvas:story',
      title: result.storyRoute.title,
      steps: result.storyRoute.steps,
    });
  }
  if (result.commandLog) {
    push({ type: 'command:log', ...result.commandLog });
  }
  if (!fedBack) {
    if (result.ok && result.content) {
      /*
       * A CACHE HIT MEANS THE MODEL ASKED FOR SOMETHING IT ALREADY HAS.
       *
       * The body still goes back — the ledger recognises it as the same evidence
       * and moves the existing copy forward rather than paying for it twice — but
       * a line beside it now says what happened. Observed on a local ornith:9b:
       * four identical `read_file` calls on a 2,997-line file, each returning the
       * identical first 233 lines, because nothing in the result said so.
       */
      if (result.cacheHit) {
        toolResultBodies.push(
          `### tool ${tr.id} (${tr.name}): you already ran this exact call this turn — ` +
            'nothing new was fetched and the earlier result is still in the evidence above. ' +
            'To see more of a large file, call read_file again with a different "offset"; ' +
            'to look somewhere else, change the arguments.',
        );
      }
      toolResultBodies.push(result.content);
    } else if (result.content) {
      /*
       * A FAILED COMMAND'S OUTPUT IS THE POINT, NOT NOISE.
       *
       * A non-zero run_command still carries its full stdout/stderr in
       * `content`; feeding back only the short `evidence` label ("ran … (exit
       * 1)") left the write→test→fix loop blind to WHY the tests failed — the
       * one thing the next round needs. It also broke the verify contract's
       * lastCommandRound detection, which keys on the `### run_command:` header
       * that lives in `content`, so a real failed run read as a refusal. Feed
       * the content whenever a result carries it, pass or fail; only a result
       * with no content at all (a refusal) falls back to the evidence line.
       */
      toolResultBodies.push(result.content);
    } else {
      toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${result.evidence}`);
    }
  }
  const signature = `${tr.name ?? '?'}\u0000${result.content ?? result.evidence}`;
  if (!seenEvidence.has(signature)) {
    seenEvidence.add(signature);
    sink.roundBroughtSomethingNew.value = true;
  }
  if (breaker.record(result.permission?.decision ?? 'allow')) sink.trippedBreaker.value = true;
}

/** Hex length of the truncated sha256 instruction-belt digest on the wire. */
export const ASK_INSTRUCTION_HASH_HEX_LEN = 16;

/** Inputs that determine which instruction-belt fragments are composed for a turn. */
export interface AskInstructionHashInput {
  designMode: boolean;
  /**
   * The design turn is a PROPOSAL, not a scoping round.
   *
   * It sits on the hash input for the same reason `teachContext` does: it
   * changes the rendered belt - it removes the "ask ONE short clarifying
   * question" line from the design topology hint and replaces it with an
   * instruction to choose the level and draw - so it must change the hash by
   * construction rather than by anyone remembering to.
   */
  proposeArchitecture?: boolean;
  repoRoot?: string | null;
  jobMode?: AskJobMode;
  /**
   * What THIS lesson turn knows — the concept it owes, what it already taught,
   * the prediction it must resolve, the numbers it may work.
   *
   * It sits on the HASH input on purpose. `computeAskInstructionHash` hashes the
   * rendered belt, so a context that changes the belt changes the hash by
   * construction: two turns teaching different concepts cannot collide. Putting
   * it anywhere else would have needed the hash taught about it by hand, which
   * is the kind of second definition that drifts.
   */
  teachContext?: TeachTurnContext;
  /** Teach Mode (docs/teach-mode.md): one concept, one visual, one check-in per turn. */
  teach?: boolean;
  permission?: string;
  surface?: AskSurfaceContext;
  question: string;
}

/**
 * Instruction belt appended after the base ask prompt: tool hints, optional
 * canvas hints, and plan-mode instructions — not the user question or digest.
 */
export function renderAskInstructionBelt(input: AskInstructionHashInput): string {
  const parts: string[] = [];
  const teaching = isTeachTurn(input);
  /*
   * THE TOOLS SECTION, BEHIND A FLAG — the belt condition of
   * docs/research/belt-condition-registration.md.
   *
   * Measured: on a first-tier ask with a repo attached the belt is 1,363
   * tokens and this section is ALL of it; on a teach turn it is 632 of 3,087.
   * Tool calls happened on 1 turn in 104. So it is the largest removable
   * piece, and it is largest exactly where the first tier lives.
   *
   * ONLY THIS SECTION. `CHARTS` is 398 tokens against a 69% chart rate — the
   * instruction that plainly works — and removing it alongside the one that
   * plainly does not would confound them, so a run that lost charts could not
   * say which section did it. CHARTS and AI CANVAS stay.
   *
   * Absent or unset leaves the belt byte-identical, which is what keeps every
   * arm already on record comparable.
   */
  const trimTools = process.env.SEQUENCE_ASK_TRIM_TOOLS === '1';
  if (input.repoRoot && !input.designMode) {
    if (!trimTools) {
      parts.push(
        renderAskToolHintSection(input.jobMode, input.permission, { teach: teaching }).join('\n'),
      );
    }
  } else if (input.designMode && !teaching) {
    /*
     * THE DESIGN TOPOLOGY HINT IS SKIPPED ON A LESSON, because its SECOND LINE
     * is "ask ONE short clarifying question in chat first: compact overview or
     * detailed diagram", and it names `propose_topology` — a tool teach mode
     * refuses. Composed with the teach contract's "NEVER ask the learner which
     * chart kind, which format … or what level of detail", the belt both
     * ordered and forbade the interrogation the owner actually got back on
     * 2026-09-02. The chart section below is a lesson's drawing hint.
     */
    /* proposeNow: the caller has already chosen to design rather than to scope,
       so this hint must not re-order the scope question the rest of the prompt
       forbids. Two lines of one prompt disagreeing, with the model correctly
       obeying the wrong one, is what 2026-09-08 was spent on. */
    parts.push(
      renderDesignTopologyHintSection({
        proposeNow: input.proposeArchitecture === true,
      }).join('\n'),
    );
  }
  /* A teach turn owes ONE visual per concept and the contract names the call:
     it must also carry the call's syntax, whatever surface it is on. */
  if (teaching) {
    parts.push(renderChartToolHintSection().join('\n'));
  }
  if (canvasToolsEnabled(input)) {
    parts.push(renderCanvasToolHintSection().join('\n'));
  }
  if (input.permission === 'plan') {
    parts.push(`--- PLAN MODE ---\n${PLAN_MODE_INSTRUCTIONS}`);
  }
  if (isTeachTurn(input)) {
    parts.push(
      `--- TEACH MODE (binding contract) ---\n${renderTeachModeInstructions(input.teachContext)}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * A LESSON IS A LESSON WHETHER OR NOT THE TOGGLE WAS FOUND.
 *
 * Owner's screen, 2026-09-02: "teach me this: AI Overview — Learn Supervised
 * Learning …" typed with the composer's Teach row unselected. The contract
 * below never entered the belt, so nothing forbade the interrogation he got
 * back. The toggle stays the explicit way in; a teach-SHAPED question is the
 * implicit one, and both go through here so the belt, the belt hash, the tool
 * refusals and the grader can never disagree about the same turn.
 */
/**
 * Below this, a teach turn is a fragment rather than a lesson.
 *
 * 35 words is the line every stub figure in `docs/research/` was computed at —
 * and, until this constant existed, it lived ONLY in the analysis scripts that
 * read the reports. The bench source never defined it and the product never
 * knew it, so "stubs 22 and 24" and any product behaviour were two unrelated
 * numbers that happened to look like one.
 *
 * Exported and imported by the bench, so the product and the instrument that
 * measures it draw the line in the same place: the assembly-drift law applied
 * to a number instead of to a rule.
 */
export const TEACH_STUB_WORDS = 35;

/**
 * A digest of nothing, for a question with nothing behind it.
 *
 * Every collection present and empty rather than a cast: `buildAskPrompt` reads
 * `digest.services.map(...)` immediately, so an empty STRING crashed one module
 * deeper than the `design!` assertion it replaced. A shape with the right keys
 * and no contents is the honest representation of "no repository is attached",
 * and it renders a prompt that claims nothing about a codebase.
 */
const EMPTY_DIGEST = {
  repo: { id: 'none', name: 'no repository' },
  folders: [],
  services: [],
  datastores: [],
  topics: [],
  edges: [],
} as unknown as Parameters<typeof buildAskPrompt>[0];

export function isTeachTurn(input: { teach?: boolean; question: string }): boolean {
  return input.teach === true || isTeachAskQuestion(input.question);
}

/**
 * The `step:*` id that says on screen "this turn was taught as a lesson".
 *
 * Shared with the client, which turns it into a work row with English on it —
 * `packages/web2/src/state/store.ts` maps this id rather than printing the
 * slug. A constant because the two halves must agree on the spelling.
 */
export const TEACH_MODE_STEP_ID = 'teach-mode';

/** The provenance line every general-knowledge chart carries, verbatim. */
export const GENERAL_KNOWLEDGE_CAPTION =
  'Drawn from general knowledge — not from this repository’s scan.';

/**
 * ASK FOR ONE PICTURE OF A SUBJECT THIS REPOSITORY DOES NOT CONTAIN.
 *
 * One extra provider call, on the one turn shape that has nothing else to draw:
 * teach on, a graph attached, and a lesson queue that came back empty. Nothing
 * else reaches this, so an ordinary lesson pays nothing for it.
 *
 * THE OUTPUT IS TREATED AS DATA, NOT AS A DRAWING. Everything the model returns
 * is validated before it can reach the canvas, and the two rules that keep it
 * honest are enforced here rather than requested in the prompt:
 *
 *   - NO nodeIds. `executeProposeChart` already states the principle — "a chart
 *     about an idea (softmax, a doctrine) carries no nodeIds and passes; a chart
 *     that claims THIS system is checked against it". A node id here would be a
 *     claim that this repository contains the subject, which is the measured
 *     fabrication (§12) in picture form. One claimed id VOIDS THE CHART rather
 *     than being stripped: stripping keeps the model's claim and hides it.
 *   - THE CAPTION IS OURS. Provenance decided by the product, not by the model,
 *     because a drawing that sits beside repository views without saying where
 *     it came from is the same confusion in a nicer costume.
 *
 * Returns undefined on anything unusable — bad JSON, a refused shape, a claimed
 * node — because no picture is strictly better than a wrong one, and the turn
 * still has its prose.
 */
export async function drawFromGeneralKnowledge(
  subject: string,
  call: AskPipelineInput['callProvider'],
  cfg: AiConfig,
): Promise<SeqChart | undefined> {
  const prompt =
    `Draw ONE diagram of "${subject}" from general knowledge, as an architecture: the parts and ` +
    'the arrows between them.\n\n' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape:\n' +
    '{"kind":"data-flow","title":"<short title>","items":[{"id":"a","label":"<part>"}],' +
    '"links":[{"from":"a","to":"b"}]}\n\n' +
    'Rules: 3 to 6 items; every link\'s from/to must be an id in items; labels are plain English ' +
    'names for the parts. Do NOT include a "nodeId" on any item — this diagram is about the ' +
    'idea, not about any repository.';
  let raw: string;
  try {
    const out = await call(cfg, prompt, undefined, {});
    raw = String((out as { text?: unknown }).text ?? '');
  } catch {
    return undefined;
  }
  /* A fenced block is the commonest wrapper even when prose is forbidden. */
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const items = (parsed as { items?: unknown }).items;
  if (Array.isArray(items) && items.some((i) => i && typeof i === 'object' && 'nodeId' in i)) {
    /* A claim about this repository. The whole chart goes. */
    return undefined;
  }
  const checked = validateChart({
    ...(parsed as Record<string, unknown>),
    caption: GENERAL_KNOWLEDGE_CAPTION,
  });
  if (!checked.ok) return undefined;
  /* Belt and braces on the one rule that matters: the validator does not know
     this chart may cite nothing, so the absence is re-checked after it. */
  if ((checked.chart.items ?? []).some((i: { nodeId?: string }) => i.nodeId !== undefined))
    return undefined;
  return checked.chart;
}

/**
 * The teach contract (docs/teach-mode.md). Owner's charge, 2026-08-31: teach
 * "point one, ask if the user gets it, show the visual, then move on" —
 * explicitly NOT "dumping all the text right away". The contract is pacing:
 * a teach turn that delivers two concepts, or a wall of prose, has failed the
 * mode the same way an edit turn that edits nothing fails Full permission.
 */
/**
 * THE ABLATION BELT — the teach contract cut to the rules the grader enforces.
 *
 * Three interventions in a row moved check-in and stub counts the wrong way,
 * each of them adding to a 19-bullet contract. Then two runs of the IDENTICAL
 * configuration differed by 13 points of check-in, which put every one of those
 * comparisons inside the noise. So the question "is it the LENGTH?" is not
 * answerable by adding anything; it is answerable by taking almost everything
 * away and measuring twice a side.
 *
 * What survives is exactly what `gradeTeachTurn` can bounce a turn for, plus the
 * one rule that is not negotiable anywhere in this product:
 *
 *   one concept · one visual · one closing check-in · the word budget ·
 *   never assert what the repository does not show
 *
 * Everything else the full belt says — the prediction machinery, the
 * do-not-clarify test, the skip-naming rule, the quantitative rule, the reveal
 * discipline — is removed HERE and nowhere else. Several of those encode real
 * findings, and none of them is being called wrong: they are being weighed
 * against what they cost in a contract a 4B-class model has to hold all at once.
 *
 * The lesson-state slots are still supplied, as DATA rather than instruction,
 * which is the one thing the measurements so far did not make worse.
 */
export const TEACH_MODE_INSTRUCTIONS_SHORT =
  'You are TEACHING over a live architecture board the learner can see.\n' +
  '- ONE concept this turn, in at most ~150 words of plain prose. Never two.\n' +
  '- ONE visual, drawn with propose_chart: you choose the kind (data-flow, ' +
  'system-architecture, hierarchy, comparison-table, bar) and supply the items and links. ' +
  'Give an item a nodeId only when it stands for a real part of this repository.\n' +
  '- END with one short check-in question, and nothing after it.\n' +
  '- Ground every claim in this repository: name the real file or node, and cite file:line ' +
  'for anything you assert. Never state something the code does not show - not as a ' +
  'simplification, not to be corrected later.\n';

/**
 * THE MID BELT — the registered third arm (docs/research/belt-length-ablation.md).
 *
 * The short belt kept a visual bullet and lost the visual entirely: chart calls
 * 4 and 12 fell to 0 and 0. So "there is a bullet telling it to" is not what
 * makes a model reach for propose_chart. The full belt has TWO chart bullets and
 * the short one condensed them into one, dropping the half that says what a
 * chart is FOR and what it is instead of. This arm restores both and changes
 * nothing else, which is the only reason it is interpretable.
 *
 * The two bullets are LIFTED FROM THE LIVE FULL BELT rather than copied here.
 * "Verbatim" written by hand is verbatim until someone edits one copy; taken
 * from the source it cannot drift. If a bullet ever stops matching, this belt
 * omits it and `teach-belt-mid.test.ts` fails -- the mid belt is used only when
 * a caller asks for it (today, only the bench), so the gate is the guard rather
 * than a throw on a live request path.
 */
const fullBeltBullet = (needle: string): string => {
  const line = TEACH_MODE_INSTRUCTIONS.split('\n').find((l) => l.includes(needle));
  return line === undefined ? '' : `${line}\n`;
};

export const CHART_BULLET_PURPOSE_NEEDLE = 'NOT canvas.write_markdown';
export const CHART_BULLET_EVERY_CONCEPT_NEEDLE = 'EVERY concept ships ONE visual';

export const TEACH_MODE_INSTRUCTIONS_MID = (): string =>
  'You are TEACHING over a live architecture board the learner can see.\n' +
  '- ONE concept this turn, in at most ~150 words of plain prose. Never two.\n' +
  fullBeltBullet(CHART_BULLET_PURPOSE_NEEDLE) +
  fullBeltBullet(CHART_BULLET_EVERY_CONCEPT_NEEDLE) +
  '- END with one short check-in question, and nothing after it.\n' +
  '- Ground every claim in this repository: name the real file or node, and cite file:line ' +
  'for anything you assert. Never state something the code does not show - not as a ' +
  'simplification, not to be corrected later.\n';

/**
 * THE LENGTH CONTROL BELT -- the mid belt, padded to the full belt's size with
 * text the model cannot act on.
 *
 * Three belts gave 9 and 9 chart calls at 7,219 characters and 0 and 0 at both
 * 1,181 and 654 -- and the mid belt carries BOTH chart bullets byte-identical to
 * the full one. Content cannot explain that, so either the cause is inside the
 * ~6,000 characters the mid belt drops or it is length itself, and nothing
 * separates those two. This belt moves ONLY the character count.
 *
 * The padding is deliberately inert: no rules, no tool names, no imperatives,
 * nothing about this domain, nothing the model could mistake for an
 * instruction. If it carried even one actionable sentence the arm would be
 * measuring content again, which is the thing it exists to rule out.
 *
 * EXPERIMENT-ONLY, reachable solely via beltVariant 'pad' (today, only the
 * bench). It is not a contract and must never become the default.
 */
const INERT_PARAGRAPH =
  'The weather over the northern coast turns slowly through the year. Mornings arrive pale ' +
  'and level, the light coming up without much ceremony, and by the middle of the afternoon ' +
  'the same light has gone flat again. Boats move out past the headland on the tide and come ' +
  'back on it. Gulls settle on the pilings and lift off them. In late summer the grass on the ' +
  'dunes goes the colour of dry paper and stays that way until the first heavy rain, which ' +
  'may come in September or may not come until the middle of October. Nobody keeps a record ' +
  'of it. The tide tables are printed a year ahead and pinned up in the harbour office, where ' +
  'they curl at the corners. ';

export const TEACH_MODE_INSTRUCTIONS_PAD = (): string => {
  const mid = TEACH_MODE_INSTRUCTIONS_MID();
  const target = TEACH_MODE_INSTRUCTIONS.length;
  /* Padded to the FULL belt's length, measured rather than assumed, so the two
     sides of this control differ in nothing but bulk. */
  let pad = '';
  while (mid.length + pad.length < target) pad += INERT_PARAGRAPH;
  return mid + pad.slice(0, Math.max(0, target - mid.length));
};

export const TEACH_MODE_INSTRUCTIONS =
  'You are TEACHING, one step at a time, over a live architecture board the learner can see.\n' +
  '- Deliver EXACTLY ONE concept this turn, in at most ~150 words of plain prose.\n' +
  '- Ground the concept in THIS repository: name the real node/file (exact label) the ' +
  'concept lives in, and cite real evidence (file:line) when you make a claim.\n' +
  '- ASK COMPREHENSION QUESTIONS AS YOU GO — they are the point of the mode, not a closing ' +
  'formality. A comprehension question asks the learner about material you have ALREADY ' +
  'delivered in this turn ("so what do you think happens when that queue backs up?"), and it ' +
  'is answerable from the explanation you just gave. Put them where they fall naturally in ' +
  'the explanation.\n' +
  '- THEN ANSWER IT, IN THE SAME TURN. The learner cannot reply in the middle of your turn, so ' +
  'a mid-lesson question you do not answer is rhetorical — and a check whose answer never ' +
  'arrives teaches NOTHING. That is measured, not a preference: a learner who fails a check ' +
  'and is not told scores g = 0.03 with the confidence interval spanning zero, against g = ' +
  '0.73 when they are corrected. Ask, then tell, and tell WHY. The ONE question that may stay ' +
  'open is the closing check-in, because the learner’s next message is its answer and you ' +
  'grade it then.\n' +
  '- End the turn with a short check-in question as the CLOSING beat — either "' +
  TEACH_CLOSING_COMPREHENSION_EXAMPLE +
  '" or a prediction prompt ("' +
  TEACH_CLOSING_PREDICTION_EXAMPLE +
  ' You ' +
  'can also draw it on the board").\n' +
  '- NAME THE REAL COMPONENT IN THAT QUESTION. The example above says "the auth service" ' +
  'because it is an EXAMPLE; your question must name the actual part of THIS repository ' +
  'the lesson is about. A closing question still carrying a bare placeholder where the ' +
  'component name belongs is not a question the learner can answer, and does not count ' +
  'as a check-in.\n' +
  '- NEVER ask a CLARIFYING question — not one, not at the open, not mid-lesson, not at the ' +
  'close. A clarifying question asks the learner to choose the scope, pick a direction, name ' +
  'a format, or supply something you could look up yourself. THE TEST: if their answer would ' +
  'change what you do next, it is clarifying and it is banned; if it only reveals whether ' +
  'they followed you, it is a comprehension check and it is wanted. "Shall we look at why the ' +
  'scanner does this ahead of time?" offers the next step of a lesson already underway and is ' +
  'fine. "Would you like the architecture view or the data view?" makes them do your job.\n' +
  '- NEVER advance to a second concept in the same turn. NEVER dump an outline of ' +
  'everything you plan to cover — the lesson unfolds turn by turn.\n' +
  "- When the learner answers a prediction, grade it honestly against the real graph: name " +
  'what they got right, what the real component is, and the evidence for it. A wrong guess ' +
  'is a teaching moment, never a scolding.\n' +
  '- If the learner says they did not understand, re-explain the SAME concept differently ' +
  '(an analogy, a concrete request flow) — do not move on.\n' +
  '- NEVER ask the learner which chart kind, which format, which diagram dialect or what ' +
  'level of detail to use. They asked to be taught: CHOOSE, draw it, and let them redirect ' +
  'you once there is something on screen to redirect. Naming our internal formats at a ' +
  'learner — "SeqDiagram v1", "json blocks", "system-architecture or data-flow" — is ' +
  'forbidden outright; those are tool vocabulary, not words a learner asked for. A turn that ' +
  'opens by interrogating the learner about output options has taught nothing.\n' +
  '- The visual is propose_chart. It is NOT canvas.write_markdown: one chart carries the ' +
  'whole breakdown — many items, the links between them, a caption — in ONE validated call ' +
  'that is checked against the real graph and rendered in the app, while a markdown block is ' +
  'prose wearing a picture’s clothes and the canvas takes only one write per turn.\n' +
  '- EVERY concept ships ONE visual, drawn with propose_chart: you choose the chart KIND ' +
  '(data-flow, system-architecture, hierarchy, comparison-table, before-and-after, bar, ' +
  'journey-map, feedback-loop, …) and supply the items/links; Sequence renders it. Set ' +
  'focusItemId to spotlight the one piece this concept is about. Give items a nodeId when ' +
  'they stand for a real part of the repository — invented structure is refused.\n' +
  '- NAME WHAT YOU ARE NOT COVERING, in one clause. "I am skipping how the scan caches for ' +
  'now" tells the learner the gap is deliberate and bounds what they think they just missed. ' +
  'A lesson that silently omits things reads as a lesson that does not know they exist.\n' +
  '- WHEN THE CONCEPT IS QUANTITATIVE, WORK THE NUMBERS. Show the arithmetic on one real ' +
  'case from this repository — the actual counts, sizes or timings, taken from the graph or ' +
  'a file you read — not a rounded illustration. "969 files, 247,227 lines, so the mean file ' +
  'is 255" teaches; "quite a lot of files" does not.\n' +
  '- MAKE THEM COMMIT BEFORE YOU REVEAL. When the turn contains an answer worth predicting, ' +
  'ask for the guess in the CLOSING check-in and reveal it next turn UNCONDITIONALLY — ' +
  'whether or not they answered, guessed wrong, changed the subject or said they did not ' +
  'know, AND WHETHER OR NOT THEY GOT IT RIGHT. A correct guess is not a reason to skip the ' +
  'reveal: confirming a right retrieval is the same thing that makes the check worth asking. ' +
  'A prediction nobody ever resolves is the case that teaches nothing. Never state ' +
  'the answer and ' +
  'then ask them to guess it, which is the same words in the order that teaches nothing.\n' +
  '- THE REVEAL RESTATES WHAT WAS PREDICTED, in the same breath as the answer. Say "you ' +
  'guessed the scan walks imports first — it does not, and here is why", never a bare "the ' +
  'scan resolves exports first". A guess and its answer that arrive in different turns only ' +
  'teach when the answer carries the guess back with it: three separate studies found the ' +
  'benefit of guessing DISAPPEARS under delayed feedback, and the one condition that ' +
  'recovered it was the feedback appearing in the same context as the guess. In a ' +
  'conversation you rebuild that context by naming the prediction you are resolving.\n' +
  '- A WRONG OPTION MAY ONLY LIVE INSIDE A QUESTION. Offering "is it A, B or C?" where two ' +
  'are wrong is good teaching. ASSERTING something false — about this repository or about ' +
  'the world — is never permitted, not as a trap, not as a simplification, not to be ' +
  'corrected later. Grounded-not-guessed is not suspended for a lesson: a learner cannot ' +
  'tell a deliberate error from a real one, and one of those destroys the value of every ' +
  'other sentence you have written.\n' +
  '- SOMETIMES CLOSE WITH THE QUESTION THEY HAVE NOT THOUGHT TO ASK. Instead of "does this ' +
  'make sense?", the closing check-in may be the next question the concept opens — "the thing ' +
  'to ask now is why the scanner does this ahead of time rather than on demand — shall we?" ' +
  'That is still the closing beat and still their choice to take — it proposes the next step ' +
  'of a lesson already running, which is why it is not a clarifying question.\n' +
  '- Reading tools are allowed and encouraged (read the real code before teaching it); ' +
  'teaching NEVER edits or runs the learner’s repository — edit_file, propose_files, ' +
  'propose_topology and run_command are all refused in teach mode. A chart (propose_chart) ' +
  'is a visual, not a mutation, and is how you show each point.';

/* ═══════════════════════════════════════════════════════════════════════════
   THE HARNESS ASSEMBLES THE PROMPT, SO NOBODY HAS TO WRITE ONE

   The owner has said this more than anything else, and until now it was true of
   everything except the teaching belt: `TEACH_MODE_INSTRUCTIONS` was a static
   string that said the same words for a first lesson and a twentieth, for a
   novice and for the person who ships the thing being taught.

   It is now rendered from a context. The CONTRACT half stays constant, because
   those clauses are laws rather than parameters — the wrong-option rule, the
   clarifying-question ban, the tool refusals. What varies is what this turn
   knows: which concept it owes, what was already taught, what prediction is
   outstanding, and which real numbers it may work.

   BYTE-IDENTICAL WITH NO CONTEXT. `renderTeachModeInstructions()` with nothing
   to add returns exactly `TEACH_MODE_INSTRUCTIONS`, so a turn that carries no
   lesson state produces the prompt it always did. That is what makes this a
   refactor rather than a rewrite, and it is locked by a test rather than
   asserted here.

   THE HASH FOLLOWS FOR FREE, which is worth stating because the spec expected a
   change here. `computeAskInstructionHash` hashes the RENDERED belt text, so a
   context that changes the belt changes the hash by construction — provided it
   arrives on the same input object the belt is rendered from, which is why
   `teachContext` sits on `AskInstructionHashInput` and not somewhere adjacent.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A real thing this turn may cite: a node, a file:line, a count from the digest. */
export interface TeachAnchor {
  /** What it is, in the learner's words — "the scanner", "packages/analyzer". */
  label: string;
  /** Where it can be checked: a node id, or `path:line`. */
  ref: string;
  /** A number the turn should work, when the anchor carries one. */
  value?: string;
}

export interface TeachTurnContext {
  /** The concept this turn delivers. ONE. */
  concept?: { title: string; nodeId?: string };
  /**
   * The concept AFTER this one — the queue's next entry, whose chart the product
   * can already build and has not shown.
   *
   * Carried only so the next-picture check-in can ask a prediction about it. No
   * chart for it is emitted this turn, so one-visual-per-turn is unchanged.
   */
  nextConcept?: { title: string; nodeId?: string };
  /**
   * How much the learner already ships. One click, never a free-text field.
   *
   * AN ASSERTION ABOUT THE LEARNER, NOT ABOUT THE REPOSITORY, and the belt says
   * so in the same breath it says the skip. "They already ship LoRA adapters, so
   * skip fine-tuning" is sourced from a button they pressed; it can be wrong the
   * way a preference is wrong — recoverably and visibly. Grounded-not-guessed
   * governs claims about the world and is NOT weakened by this, so a model must
   * never read "assume they know X" as "assert X".
   */
  known?: 'new' | 'used-it' | 'ship-it';
  /** Named skips. Same status as `known`: about the learner, never the repo. */
  doNotExplain?: readonly string[];
  /**
   * The lesson's concepts are all taught and the learner asked to continue.
   *
   * Present ONLY when the queue is exhausted, so the turn can say so instead of
   * producing the ten-word fragment measured on 10 of 20 bench conversations.
   * `neighbours` are one hop from the concept just taught — a grounded proposal
   * rather than an invented next topic.
   */
  lessonDone?: { neighbours?: readonly string[] };
  /**
   * This lesson has no plan and the graph cannot build one — ask the model for
   * it, once, on this turn. Set only on an opening turn whose ask names no node
   * and is not sequence-shaped: 12 of the 20 bench conversations.
   */
  needsPlan?: boolean;
  /**
   * A repository IS attached and the ask matches nothing in it.
   *
   * Distinct from both neighbours: no graph at all is design mode, and a queue
   * with a head is an ordinary grounded lesson. Set by `buildTeachContext` when
   * the graph is present and the queue came back empty — the case that produced
   * the measured fabrication in §12 of
   * `docs/research/teach-mode-driven-end-to-end.md`.
   */
  subjectNotInRepo?: true;
  /**
   * An unresolved prediction from last turn. Present ⇒ this turn MUST reveal.
   *
   * This is the unconditional-reveal rule made mechanical instead of hoped for.
   * The evidence (docs/teach-mode.md) is that a check whose answer never arrives
   * teaches nothing — g = 0.03, interval spanning zero, against 0.73 when the
   * learner is corrected — and that the reveal must carry the guess back with it.
   */
  /**
   * The prediction the last turn left open.
   *
   * `arrow` is the graph edge that decides the answer, so the reveal can name
   * the REASON and not only the verdict (ruled 2026-09-06). Absent for the
   * comprehension form, which has no arrow to name.
   */
  open?: { question: string; expect: string; arrow?: string };
  /** Concepts already covered, so the turn builds instead of repeating. */
  taught?: readonly string[];
  /** Real anchors this turn may cite. */
  anchors?: readonly TeachAnchor[];
  /**
   * Which belt to render. `short` is the ABLATION — the contract cut to the
   * rules the grader actually enforces — and it exists to answer whether the
   * belt's LENGTH is what has been costing check-ins.
   *
   * NOT a product setting. The default is unchanged, and which belt ships is
   * decided on measured numbers: `docs/research/belt-length-ablation.md`.
   */
  beltVariant?: 'full' | 'short' | 'mid' | 'pad';
}

/**
 * The teaching belt for ONE turn.
 *
 * Returns {@link TEACH_MODE_INSTRUCTIONS} unchanged when there is nothing
 * specific to say, so the no-context path is the prompt that shipped before.
 */
/**
 * What a refused mutating tool is told, and — for the one case where the model
 * wanted to DRAW rather than to change anything — what to call instead.
 *
 * Measured by Practical ML's stream-json replay, 2026-09-05: a teach turn asked
 * for the board by name, called `propose_topology`, was refused, and CALLED IT
 * AGAIN. Both refusals said "explain the change you would have made instead",
 * which is the right sentence for `edit_file` and useless to a model that was
 * not trying to change anything. The turn produced no visual, and the contract
 * that promises one visual per turn had just refused the tool the model reached
 * for without naming the one that works.
 *
 * The refusal itself is CORRECT and stays: `propose_topology` proposes a change
 * to the architecture — a dashed service on the reader's board to accept or deny
 * — and teach mode changes nothing. `propose_chart` is deliberately not
 * mutating and is the teach visual. The model picked the wrong tool; the refusal
 * failed to say which was right.
 */
export function mutatingToolRefusal(name: string | undefined, teach: boolean): string {
  if (!teach) {
    return (
      'Refused — PLAN MODE reads and changes nothing. It was not run and nothing has ' +
      'been modified. Do not retry it; say what you would have done, in the plan.'
    );
  }
  if (name === 'propose_topology') {
    return (
      'Refused — TEACH MODE reads and changes nothing, and propose_topology proposes a CHANGE ' +
      "to the architecture rather than a picture of it. To put a diagram on the board in a " +
      'lesson, call propose_chart instead: it draws without changing anything, and it is the ' +
      'visual this turn owes. Do not retry propose_topology.'
    );
  }
  return (
    'Refused — TEACH MODE reads and changes nothing. Teaching never edits the ' +
    "learner's repository. Explain the change you would have made instead, as part " +
    'of the lesson.'
  );
}

export function renderTeachModeInstructions(ctx?: TeachTurnContext): string {
  const slots: string[] = [];

  if (ctx?.open) {
    /* FIRST, because everything else in the turn is subordinate to resolving it.
       A model that opens with new material has already lost the retrieval. */
    slots.push(
      `RESOLVE THE OPEN PREDICTION FIRST. Last turn you asked: "${ctx.open.question}" — and the ` +
        `answer is: ${ctx.open.expect}. Open THIS turn by naming what they predicted and ` +
        'answering it, whether they replied, guessed wrong, changed the subject, or got it ' +
        'right. A correct guess still gets the reveal: confirming a right retrieval is the ' +
        'whole point of having asked.',
    );
  }

  if (ctx?.concept) {
    const where = ctx.concept.nodeId ? ` It lives in \`${ctx.concept.nodeId}\`.` : '';
    slots.push(`THIS TURN'S CONCEPT is exactly one: ${ctx.concept.title}.${where}`);
  }

  if (ctx?.subjectNotInRepo === true) {
    /*
     * THE SUBJECT IS NOT HERE — say so, and retire the grounding demand for
     * this turn only.
     *
     * This slot exists because of a measured fabrication (§12 of
     * `docs/research/teach-mode-driven-end-to-end.md`): asked "what is machine
     * learning" against this repository, the turn replied "ML is defined in
     * mod:analyzer/3 within svc:analyzer ... packages/analyzer/src/llm/" — the
     * LLM client — and shipped it as a lesson.
     *
     * The belt's standing order is "Ground the concept in THIS repository: name
     * the real node/file (exact label)". For a subject the scan does not
     * contain, that order CANNOT be obeyed honestly, and the model obeyed it
     * anyway. So the failure is not disobedience and no louder wording reaches
     * it — the clause is right for every turn except this one, and what changes
     * here is the CONDITION, not the words.
     *
     * DRAWING IS STILL ON, because a refusal is not the deliverable either: a
     * learner asking about a subject outside the repository should still SEE it.
     * `executeProposeChart` already makes that safe and says so — "a chart about
     * an idea (softmax, a doctrine) carries no nodeIds and passes; a chart that
     * claims THIS system is checked against it". A chart with no nodeIds cites
     * no module, so it cannot carry a fabricated repository fact, and it needs
     * no new canvas hook: the payload the canvas already renders.
     */
    slots.push(
      'THE SCAN MATCHED NO FILE TO THIS ASK, so you have no grounded subject to teach from. ' +
        'This OVERRIDES the grounding rule below for this turn: do not name a node, do not ' +
        'cite a file, and do not say the subject is defined in or implemented by anything ' +
        'here — you have not been shown where it lives, so saying would be inventing it. ' +
        'Teach it from GENERAL KNOWLEDGE instead, and DRAW it: call propose_chart with items ' +
        'that have NO nodeIds (a chart about an idea needs none, and one that named a node ' +
        'would be claiming this system contains it). Open by saying in one short sentence ' +
        'that what follows is general knowledge rather than a reading of this repository, so ' +
        'the learner knows which of the two they have.',
    );
  }

  if (ctx?.taught && ctx.taught.length > 0) {
    slots.push(
      `ALREADY TAUGHT this lesson: ${ctx.taught.join('; ')}. Build on those rather than ` +
        're-explaining them, and say which one you are building on.',
    );
  }

  if (ctx?.needsPlan === true) {
    /*
     * THE PLAN, ONCE, BEFORE THE FIRST CONCEPT.
     *
     * The graph orders a lesson about files. It cannot order a lesson about an
     * attached article, a maths note, or a subject — 12 of the 20 bench
     * conversations — and those turns arrived with an empty concept slot and
     * left as ten-word fragments. So the model writes the plan here, and only
     * here: Sequence stores it and hands back one concept per turn.
     */
    slots.push(
      'FIRST, CALL propose_plan with the concepts this lesson will cover, in teaching order — ' +
        'then teach the first one in the same turn. Give a concept a nodeId only when it stands ' +
        'for a real part of this repository; a concept from an attached document needs none, and ' +
        'an invented id is refused. You write this ONCE: every later turn is handed its concept.',
    );
  }

  if (ctx?.lessonDone !== undefined) {
    /*
     * THE LESSON THE LEARNER ASKED FOR IS FINISHED, and "continue" still arrived.
     *
     * Measured: 10 of the 20 bench conversations are one-concept asks — "why is
     * the dot marker used at both ends" — and their follow-up turn had no
     * concept to deliver because there correctly was none. The model answered in
     * ten words. A finished lesson is not a failure and must not read like one:
     * say it is finished, and propose something real.
     *
     * The proposal comes from the graph's one-hop neighbours, so it is grounded
     * rather than invented to fill a turn. With no neighbours to offer, the turn
     * asks what they want next — which is a clarifying question everywhere else
     * in this contract and is the right question ONLY here, because the lesson
     * that set the scope is over.
     */
    const nb = ctx.lessonDone.neighbours ?? [];
    slots.push(
      'THE LESSON THEY ASKED FOR IS TAUGHT. Do not open a new concept as if the lesson were ' +
        'still running, and do not answer in a sentence. Say plainly that this is the lesson ' +
        'they asked for, in one line, then ' +
        (nb.length > 0
          ? `PROPOSE the next step from what actually touches it — ${nb.join(', ')} — naming one ` +
            'and saying in a clause why it follows, and ask if they want it.'
          : 'ask what they want to look at next, which is the one place in this contract ' +
            'where asking them to choose is right: the lesson that set the scope is over.'),
    );
  }

  const skips = [...(ctx?.doNotExplain ?? [])];
  if (ctx?.known === 'ship-it') skips.push('the basics of anything they already ship');
  if (skips.length > 0) {
    slots.push(
      `DO NOT EXPLAIN: ${skips.join('; ')}. That is a statement about THE LEARNER — what they ` +
        'told us they already know — and never a statement about this repository. Skipping an ' +
        'explanation is not permission to assert anything as true of the code: everything you ' +
        'say about the repo still needs its evidence.',
    );
  }

  if (ctx?.anchors && ctx.anchors.length > 0) {
    const lines = ctx.anchors.map(
      (a) => `  - ${a.label} (${a.ref})${a.value !== undefined ? ` = ${a.value}` : ''}`,
    );
    slots.push(`WORK THESE NUMBERS, they are real and already measured:\n${lines.join('\n')}`);
  }

  const belt =
    ctx?.beltVariant === 'short'
      ? TEACH_MODE_INSTRUCTIONS_SHORT
      : ctx?.beltVariant === 'mid'
        ? TEACH_MODE_INSTRUCTIONS_MID()
        : ctx?.beltVariant === 'pad'
          ? TEACH_MODE_INSTRUCTIONS_PAD()
          : TEACH_MODE_INSTRUCTIONS;
  if (slots.length === 0) return belt;
  return `${slots.map((s) => `- ${s}`).join('\n')}\n${belt}`;
}

export function hashAskInstructionBelt(text: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, ASK_INSTRUCTION_HASH_HEX_LEN);
}

export function computeAskInstructionHash(input: AskInstructionHashInput): string {
  return hashAskInstructionBelt(renderAskInstructionBelt(input));
}

/** AI Canvas writers when the tab is active or the question asks for a drawing. */
function canvasToolsEnabled(input: AskInstructionHashInput): boolean {
  // Teaching IS drawing: every concept ships a visual, so the canvas belt is
  // always offered in teach mode regardless of surface.
  if (isTeachTurn(input)) return true;
  if (input.surface?.id === 'ai-canvas') return true;
  return isDrawishAskQuestion(input.question);
}

function resultPayload(result: AskPipelineResult): AskStreamEvent {
  return {
    type: 'result',
    text: result.text,
    ...(result.diagram ? { diagram: result.diagram } : {}),
    ...(result.unsupportedIntents?.length ? { unsupportedIntents: result.unsupportedIntents } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.metrics ? { metrics: result.metrics } : {}),
    ...(result.contextBreakdown ? { contextBreakdown: result.contextBreakdown } : {}),
    ...(result.source ? { source: result.source } : {}),
    ...(result.advisor ? { advisor: result.advisor } : {}),
    ...(result.coverage ? { coverage: result.coverage } : {}),
    ...(result.claims ? { claims: result.claims } : {}),
    ...(result.premise ? { premise: result.premise } : {}),
    ...(result.verify ? { verify: result.verify } : {}),
  };
}

function buildAskMetrics(input: {
  wallMs: number;
  rounds: number;
  stopReason: 'ceiling' | 'no-progress' | 'deadline' | null;
  trippedBreaker: boolean;
  designMode: boolean;
  intent?: AskClassifiedIntent;
  inputTokens?: number;
  outputTokens?: number;
  providerCallMs?: number[];
}): AskMetricsPayload {
  const stopReason: AskMetricsPayload['stopReason'] = input.trippedBreaker
    ? 'breaker'
    : input.stopReason === 'ceiling'
      ? 'ceiling'
      : input.stopReason === 'no-progress'
        ? 'no-progress'
        : input.stopReason === 'deadline'
          ? 'deadline'
          : 'complete';
  return {
    wallMs: input.wallMs,
    rounds: input.rounds,
    stopReason,
    designMode: input.designMode,
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
    ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
    ...(input.providerCallMs && input.providerCallMs.length > 0
      ? { providerCallMs: input.providerCallMs }
      : {}),
  };
}

/**
 * B3.4 — named slices of the last prompt assembly. Counts use approxTokens
 * (estimated: true). Provider input total rides as totalMeasured when known.
 */
export function buildAskContextBreakdown(input: {
  groundingText: string;
  instructionsText: string;
  toolsText: string;
  measuredInput?: number;
}): AskContextBreakdownPayload {
  const sections: AskContextSectionPayload[] = [];
  const pushSec = (
    id: AskContextSectionPayload['id'],
    label: string,
    text: string,
  ): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const tokens = approxTokens(trimmed);
    if (tokens <= 0) return;
    sections.push({ id, label, tokens, estimated: true });
  };
  pushSec('grounding', 'Architecture digest + question', input.groundingText);
  pushSec('instructions', 'Tool & plan instructions', input.instructionsText);
  pushSec('tools', 'Tool results this turn', input.toolsText);
  const totalApprox = sections.reduce((n, s) => n + s.tokens, 0);
  return {
    sections,
    totalApprox,
    ...(input.measuredInput !== undefined ? { totalMeasured: input.measuredInput } : {}),
  };
}

/** Summarize executed tool names for forced final answers (B2.1). */
function summarizeExecutedTools(toolNames: readonly string[]): string {
  if (toolNames.length === 0) return '';
  const unique = [...new Set(toolNames)].sort();
  return (
    ` I ran ${toolNames.length} tool call${toolNames.length === 1 ? '' : 's'} ` +
    `(${unique.join(', ')}) before stopping.`
  );
}

/**
 * THE TEACH CONTRACT'S GRADER (docs/teach-mode.md W1, hardened live).
 *
 * Measured on the makemore exemplar (minimax-m3, 2026-08-31, first real
 * lesson): asked to teach "bit by bit", the model returned 964 words, six
 * numbered sections, and a table of "Concrete Evidence" citing files that DO
 * NOT EXIST (char_freq.js, backend/app/models/, a class Bigr) — after one
 * failed search and zero reads. Instructions alone do not pace a weak model;
 * the harness grades the turn and bounces ONCE, exactly like the edit
 * contract. Violations are named precisely so the retry can fix them.
 */
/*
 * THE BOUNCE NAMES EVERY PROBLEM, AND THAT IS THE MEASURED LESSER HARM.
 *
 * A one-complaint-at-a-time ladder was built here and REMOVED after two runs a
 * side (docs/research/mid-belt-arm-result.md). It was registered with the
 * condition that would condemn it, and the condition fired in the wrong
 * direction by a wide margin:
 *
 *   stubs         22, 24  ->  31, 34
 *   median words  33, 58  ->  22, 21
 *   check-in       3,  4  ->   3,  2
 *
 * Told exactly one thing to fix, the model fixed that one thing and stopped.
 * Chart calls did rise (5-7 -> 9), so it obeyed the rung it was given -- and
 * delivered nothing around it. The wall dilutes and the ladder tunnels, and
 * they fail in opposite directions, which is what says the count of complaints
 * was never the mechanism: a turn that satisfies one rule and abandons the rest
 * is not closer to a lesson than a turn that satisfies none.
 *
 * So this is not "the wall is good". It is the lesser harm, measured. Anyone
 * rebuilding the ladder should read that file first and beat 22-24 stubs.
 */

export function drewInProse(text: string): boolean {
  // \x60 = backtick, escaped for the tools/ci lexer (see the check-in rule below).
  return /\x60{3}seqd/.test(text) || /[│─└├┌┐┘►▶↓]/.test(text);
}

export function gradeTeachTurn(
  text: string,
  graphBasenames: ReadonlySet<string> | null,
  readBasenames?: ReadonlySet<string>,
  visualThisTurn?: boolean,
): string[] {
  const problems: string[] = [];
  /*
   * A COPIED EXAMPLE IS NOT A CHECK-IN, and the grader has to say so or the belt
   * asks for something nothing enforces.
   *
   * Measured across two 20-conversation runs: 3 of the 13 closing checks read
   * "Which component do you think X talks to next?" -- the belt's own template
   * variable emitted literally. The turn looks compliant to every other rule
   * here and asks the learner nothing, which is the failure mode this whole
   * grader exists to catch.
   */
  const check = gradeCheckIn(text);
  if (check.parrotedExample === true) {
    problems.push(
      'your closing question copies the EXAMPLE from this contract, or still has a placeholder ' +
        'where a name belongs — ask about the actual component this lesson covered, by name',
    );
  }
  const words = text.trim().split(/\s+/).length;
  if (words > 250) {
    problems.push(
      `your reply is ${words} words — the contract is ONE concept in at most ~150 words. ` +
        'Cut everything past the first concept; the rest of the lesson comes in later turns',
    );
  }
  /*
   * The check-in must be the CLOSING beat — but a trailing fenced diagram or a
   * blockquote after the question is fine and must not trigger a spurious
   * bounce (measured false-positive). Strip a trailing fenced block, then
   * require the remainder to end in a question.
   */
  /*
   * Quote and backtick characters are written as \x22 \x27 \x60 here ON
   * PURPOSE: tools/ci/reachability.test.mjs reads this file through a
   * three-state lexer (code / comment / string) that has no notion of a regex
   * literal, so a bare `"` inside a regex opened a phantom string that
   * swallowed every `push({ type: ... })` after it and the gate reported real
   * stream events as unproduced. The escapes are the same characters to the
   * regex engine and invisible to the lexer.
   */
  const afterFence = text.trim().replace(/\x60{3}[\s\S]*?\x60{3}\s*$/, '').trim();
  if (!/\?[\x22\x27’)\]]?\s*$/.test(afterFence)) {
    problems.push(
      'your reply does not END with the closing check-in question the contract requires',
    );
  } else if (check.endsWithCheck === false && check.parrotedExample !== true) {
    /*
     * ENDING WITH A QUESTION MARK IS NOT ENDING WITH A CHECK, and until now this
     * rule could not tell the difference.
     *
     * Measured over the two 20-conversation runs: 24 of 94 turns close on a
     * CLARIFYING offer -- "would you like me to show how the counting works?",
     * "or would you prefer to see a visual representation?" -- the one shape the
     * belt bans outright, and the product bounced NONE of them. The existing
     * clarifying rule below keys on OUR TOOL VOCABULARY (chart kinds, formats),
     * a deliberately closed class, and caught 0 of those 24: an offer to explain
     * something needs no vocabulary of ours.
     *
     * NARROW ON PURPOSE: this bounces the CLOSING BEAT only. The contract
     * explicitly permits an offer mid-lesson -- "Shall we look at why the scanner
     * does this ahead of time?" offers the next step of a lesson already underway
     * and is fine. What an offer cannot do is stand in for the check-in: the
     * learner can answer it without having understood anything, and the next turn
     * then has nothing to grade.
     */
    problems.push(
      check.shape === 'clarifying'
        ? 'your reply ends by OFFERING the learner a choice, not by checking what they ' +
          'understood. They can answer that without having followed any of it. Close ' +
          'instead with a question about what you just taught, or a prediction about ' +
          'what comes next'
        : 'your reply ends with a question, but not with a CHECK: it neither asks the ' +
          'learner about what you just taught nor asks them to predict what comes next. ' +
          'Those are the two closing shapes the contract wants',
    );
  }
  /*
   * CLARIFYING vs COMPREHENSION — the distinction the old contract conflated.
   *
   * "EXACTLY ONE check-in question" was written to kill the interrogation bug: a
   * turn that opens with "system-architecture or data-flow?" and teaches nothing.
   * It caught a second thing by accident — the mid-lesson comprehension check,
   * which is what teaching actually IS. The owner asked for those back ("the
   * question pop ups when learning not just one final question"), so the COUNT is
   * no longer the rule. The KIND is.
   *
   * A comprehension question asks about material already delivered and changes
   * nothing the harness does next. A clarifying question makes the learner choose
   * scope, direction or format. Only the second bounces, and it bounces ANYWHERE
   * in the turn rather than only at the open — lifting the count without this
   * check would have re-legalised precisely the bug the old rule existed to stop,
   * which is why both halves land together.
   *
   * The signal is OUR OWN TOOL VOCABULARY inside a question sentence. That is a
   * closed class, not a guess at intent: these are words the learner never
   * supplied and cannot be expected to rank. Prose may still name a chart kind
   * while describing what was drawn — asking the learner to pick one is the
   * violation. Fences are stripped first so a \x60\x60\x60seqd visual and its
   * contents cannot trip it.
   */
  const unfenced = text.replace(/\x60{3}[\s\S]*?\x60{3}/g, ' ');
  const TOOL_VOCAB =
    /(?:system-architecture|data-flow|before-and-after|comparison-table|journey-map|feedback-loop|seqdiagram|seqd|json block|mermaid|chart kind|chart type|diagram dialect|level of detail|output format)/i;
  if (unfenced.split(/(?<=[.!?])\s+/).some((s) => s.includes('?') && TOOL_VOCAB.test(s))) {
    problems.push(
      'your reply asks the learner to choose an output option — a chart kind, a format, a ' +
        'diagram dialect or a level of detail. That is a CLARIFYING question and teach mode ' +
        'allows NONE, at any point in the turn: choose it yourself, draw it, and let them ' +
        'redirect once there is something on screen. Comprehension questions about what you ' +
        'just explained are wanted and are not this',
    );
  }
  /*
   * HANDING THE LESSON BACK TO THE LEARNER — the purest form of the banned shape,
   * and until now the one nothing named.
   *
   * Measured over the nine `teach-eval-sequence-*` arm files, 296 concept-bearing
   * turns, granite42-hermes Q4_K_M: FIFTEEN turns reply with some form of "I am
   * ready to proceed with the task. Please provide the specific question or
   * instruction you would like me to address regarding the repository structure."
   * Thirteen of those are among the 102 turns that never named their concept,
   * against two of the 194 that did. They arrive at turns 1, 2 and 3 — inside a
   * lesson already underway, with a queue of concepts waiting.
   *
   * The contract already bans it in as many words ("...or supply something you
   * could look up yourself"), so this is NOT a louder clause — the clause is
   * present and unconditional, verified by dumping the composed belt. The gap is
   * that no CHECK named the fault:
   *
   *   - the TOOL_VOCAB rule above needs a `?` in the sentence and one of our own
   *     format words; this shape is a request and has neither;
   *   - the closing-beat rule does fire, but reports "your reply does not END
   *     with the closing check-in question the contract requires" — a verdict
   *     about PUNCTUATION. Every one of the fifteen ran 4 to 6 rounds against
   *     that bounce and none recovered, which is what a misdiagnosis looks like
   *     from the inside: the reply's problem is not a missing question mark, it
   *     is that there is no lesson in it.
   *
   * NARROW BY CONSTRUCTION, on the same principle as TOOL_VOCAB: it keys on a
   * request that the LEARNER supply the subject. An offer to continue a lesson
   * already running ("Shall we look at why the scanner does this?") is named in
   * the contract as permitted and must keep passing.
   *
   * WHAT THIS DOES NOT CLAIM: that naming the fault changes the behaviour. That
   * is a bench question needing a registered arm. What it fixes today is that
   * the violation was invisible — scored as a punctuation slip, so nobody
   * counting bounces could see it.
   */
  const ASKS_FOR_THE_TASK = new RegExp(
    String.raw`\b(?:provide|give|tell|share|specify|let me know)\b[^.?!]{0,80}` +
      String.raw`\b(?:question|task|topic|concept|instruction|point|subject)\b[^.?!]{0,80}` +
      /* `you have` was in the first draft and matched NOTHING across 424 recorded
         turns, so it shipped untested surface for no coverage. Every one of the
         27 distinct spans this rule matches on that corpus ends in one of the
         three below, and all 27 are the banned shape. */
      String.raw`\b(?:you(?:[\x27’]d| would)? like|you want)\b` +
      String.raw`|\bwhat would you like (?:me )?to (?:learn|cover|address|answer|explain)\b`,
    'i',
  );
  if (ASKS_FOR_THE_TASK.test(unfenced)) {
    problems.push(
      'your reply asks the learner to supply the question or the task. They asked to be ' +
        'TAUGHT: the next concept is already in the lesson queue, so teach it. Asking them ' +
        'what to cover is the clarifying question the contract bans outright — and a turn ' +
        'that hands the lesson back has taught nothing',
    );
  }
  /*
   * ASK, THEN TELL — a check whose answer never arrives teaches NOTHING.
   *
   * Rowland 2014 (k = 159) crossed feedback against initial retrieval success:
   * no feedback with initial success below 50% scores g = 0.03, confidence
   * interval [-0.21, 0.27] — spanning zero — against g = 0.73 when the learner
   * is corrected. The testing effect is a property of retrieving successfully or
   * of being told, never of being asked.
   *
   * THE LEARNER CANNOT REPLY IN THE MIDDLE OF A TURN. So a mid-lesson question
   * that is not answered before the turn ends is rhetorical, and it lands in
   * exactly the cell where the interval spans zero. This corrects wording this
   * contract itself shipped hours earlier — "withhold the answer until the
   * learner commits" — which is right for the closing beat and wrong for every
   * question before it, because there is no way to commit mid-turn.
   *
   * THE CLOSING CHECK-IN IS THE ONE EXEMPTION, and it is not a loophole: the
   * learner's next message IS its answer, and the contract already requires the
   * next turn to grade it honestly. So exactly one question may be outstanding,
   * it is always the last one, and everything before it owes an answer here.
   *
   * EIGHT WORDS is a floor on "something was said", not a measure of quality —
   * enough to exclude a bare transition ("Right.", "Exactly.") while admitting a
   * real clause with a reason in it. A grader cannot check that prose answers a
   * question; it can check that the lesson did not ask and walk away, which is
   * the failure the evidence names.
   */
  const spoken = unfenced
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const questionAt = spoken.flatMap((s, i) => (s.includes('?') ? [i] : []));
  if (questionAt.length > 1) {
    const closing = questionAt[questionAt.length - 1]!;
    for (const qi of questionAt) {
      if (qi === closing) continue;
      const nextQ = questionAt.find((j) => j > qi)!;
      const between = spoken.slice(qi + 1, nextQ).join(' ').trim();
      const words = between === '' ? 0 : between.split(/\s+/).length;
      if (words < 8) {
        problems.push(
          'you asked a question mid-lesson and moved on without answering it. The learner ' +
            'cannot reply inside your turn, so an unanswered check is rhetorical and teaches ' +
            'nothing — ask, then TELL, and tell why. Only the closing check-in may stay open',
        );
        break;
      }
    }
  }
  /*
   * THE VISUAL IS PART OF THE LESSON, NOT A GARNISH.
   *
   * Measured over 54 graded conversations (2026-09-01): pacing hit 100% the
   * moment it was graded, while visuals — asked for in prose only — sat at
   * 13.8%. A rule the harness does not check is a rule a small model does not
   * follow. So a concept turn owes a picture: a propose_chart call, or a
   * diagram fence in the answer.
   */
  /*
   * NO GRAPH, NO VISUAL DEMANDED.
   *
   * `graphBasenames === null` means no repository is attached, and
   * `buildConceptChart` correctly draws nothing without one. Demanding a visual
   * anyway is the belt asking for something the product cannot produce: the
   * turn bounces, the model cannot satisfy it, and it bounces again.
   *
   * Measured on the repository-less condition with a canned provider: THREE
   * provider calls for one turn, two of them spent on a rule that cannot be
   * met. Across twenty conversations that is the difference between one card
   * slot and three.
   *
   * This changes nothing where a graph exists -- every figure on record is from
   * makemore, which has one -- and it is the same principle as the derived
   * chart's own refusal: do not ask for a picture of a structure that is not
   * there.
   */
  if (visualThisTurn === false && graphBasenames !== null) {
    /*
     * A visual is a real box-drawing sketch or a ```seqd fence — NOT a bare
     * arrow. `=>` / `-->` match incidental code (every JS snippet has `=>`),
     * which would silently disable this bounce the moment a lesson shows code.
     * Box-drawing glyphs (│─└├┐►) are the ascii-diagram signal; a lone ASCII
     * arrow is not enough.
     *
     * ```mermaid USED TO COUNT AND MUST NOT: only ```seqd is lifted out of the
     * answer onto the board (parseFencedSeqdProposals, below), and the
     * transcript renders a mermaid fence as its own SOURCE TEXT — the client
     * draws mermaid for canvas BLOCKS only. So a lesson could satisfy "every
     * concept ships one visual" with a wall of `graph TD` the learner reads
     * instead of sees, the bounce never fired, and the canvas stayed empty:
     * the owner's verdict shape ("we need to SEE the breakdown on our app")
     * passing the grader that exists to prevent it.
     */
    if (!drewInProse(text)) {
      problems.push(
        'this concept has NO VISUAL — call propose_chart with a kind that fits (data-flow, ' +
          'system-architecture, hierarchy, comparison-table, bar, …) so the learner can SEE ' +
          'the point, not only read it',
      );
    }
  }
  if (graphBasenames && graphBasenames.size > 0) {
    const cited = new Set(
      [...text.matchAll(/[\w./\\-]*[\w-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|rb|json|txt|yaml|yml|toml)\b/g)]
        .map((m) => m[0].replace(/\\/g, '/').split('/').pop()!.toLowerCase()),
    );
    const ghosts = [...cited].filter((b) => !graphBasenames.has(b));
    if (ghosts.length > 0) {
      problems.push(
        `you cited files that DO NOT EXIST in this repository: ${ghosts.join(', ')}. ` +
          'Every file you name must be one you can read_file right now — teach only from ' +
          'what is actually here',
      );
    }
    /*
     * CITING WITHOUT READING IS THE SUBTLER FABRICATION. Measured on the
     * makemore rematch (2026-08-31): every cited file EXISTED, and the lesson
     * still invented an nn_bigram.predict() API, line ranges past the end of
     * the file, and the wrong model order — because the model existence-
     * checked names and imagined the contents. A file may be cited only in a
     * turn that actually read it.
     */
    if (readBasenames) {
      const unread = [...cited].filter(
        (b) => graphBasenames.has(b) && !readBasenames.has(b),
      );
      if (unread.length > 0) {
        problems.push(
          `you cited ${unread.join(', ')} WITHOUT reading ${unread.length === 1 ? 'it' : 'them'} ` +
            'this turn — call read_file first, then teach from the real contents',
        );
      }
    }
  }
  return problems;
}

/**
 * B2.1 — when the model ends on tool-only rounds with no prose, the harness
 * speaks in its own voice: what happened, why it stopped, never silence.
 */
function buildForcedFinalAnswer(input: {
  stopReason: 'ceiling' | 'no-progress' | 'deadline' | null;
  roundCap: number;
  rounds: number;
  executedToolNames: readonly string[];
  unproductiveLimit: number;
}): string {
  const toolSummary = summarizeExecutedTools(input.executedToolNames);
  if (input.stopReason === 'ceiling') {
    return (
      `I used all ${input.roundCap} of my tool rounds on this and was still looking things ` +
      `up when I ran out, so I have not written an answer rather than guess at one.${toolSummary} ` +
      `Ask again to continue from here, or narrow the question so it needs fewer lookups.`
    );
  }
  if (input.stopReason === 'deadline') {
    /* Named as TIME, not as rounds. "I ran out of rounds" to someone who
       watched a clock is the harness describing its own bookkeeping instead
       of what the person experienced. */
    return (
      `I stopped because this turn hit its time budget while I was still looking things ` +
      `up, so I have not written an answer rather than guess at one.${toolSummary} Ask again ` +
      `to continue from here, or narrow the question so it needs fewer lookups.`
    );
  }
  if (input.stopReason === 'no-progress') {
    return (
      `I stopped looking: the last ${input.unproductiveLimit} rounds brought back only things ` +
      `I had already read, so another round would have cost you a call to be told the same ` +
      `thing again.${toolSummary} I have not written an answer rather than guess at one — the ` +
      `material I could reach does not cover this question, so pointing me at a file or a ` +
      `service is likelier to help than asking again.`
    );
  }
  return (
    `I did not produce an answer for this one.${toolSummary} Nothing was found and nothing is ` +
    `being hidden — please ask again, rephrasing if you can.`
  );
}

/** Run the ask pipeline, optionally yielding trace events for SSE clients. */
export async function runAskPipeline(
  rawInput: AskPipelineInput,
  emit?: (event: AskStreamEvent) => void,
): Promise<AskPipelineResult> {
  const wallStartedAt = Date.now();
  /*
   * THE TURN IS NORMALISED ONCE, HERE, AND EVERY LATER READER SEES ONE ANSWER.
   *
   * A teach-shaped question with the toggle off is still a lesson (see
   * `isTeachTurn`), and half-engaging the contract would be worse than not
   * engaging it: the belt tells the model "edit_file … refused in teach mode",
   * so a turn that got the belt but not the refusals would be the belt lying.
   * Raising `teach` on the input the rest of this function reads is what makes
   * that impossible — the belt, the mutating-tool refusals, the grader's
   * bounces and `teach:step` all key off the same field.
   *
   * `teach` is ALSO its own intent bucket now rather than the 'explore'
   * override it used to be. The override existed because "teach me by fixing
   * the bug" classifies as edit, and the edit contract then spends rounds
   * demanding writes from a mode whose tools refuse them; a distinct bucket
   * keeps every `askIntent === 'edit'` contract out of the classroom just as
   * firmly, carries the explore dead-end budget (resolveUnproductiveRoundLimit)
   * and — unlike the override — says "teach" in the turn's own metrics instead
   * of misreporting the mode as exploration.
   */
  const teachTurn = isTeachTurn(rawInput);
  const input: AskPipelineInput =
    teachTurn && rawInput.teach !== true ? { ...rawInput, teach: true } : rawInput;
  const askIntent: AskClassifiedIntent = teachTurn
    ? 'teach'
    : classifyAskIntent(input.question, { designMode: input.designMode });
  const unproductiveLimit = resolveUnproductiveRoundLimit(askIntent, input.maxRounds);
  const push = (event: AskStreamEvent): void => {
    emit?.(event);
  };

  if (input.surfaceAnswer) {
    const result: AskPipelineResult = {
      text: input.surfaceAnswer,
      source: 'surface',
      metrics: buildAskMetrics({
        wallMs: Date.now() - wallStartedAt,
        rounds: 0,
        stopReason: null,
        trippedBreaker: false,
        designMode: input.designMode,
        intent: askIntent,
      }),
    };
    push(resultPayload(result));
    return result;
  }

  /*
   * A MODE THE USER DID NOT PICK MUST SAY SO ON SCREEN.
   *
   * CANON's standing defect is "a surface asserting something the engine never
   * supplied"; a turn silently switched into teaching is its mirror — the
   * engine acting on a mode the user never chose, invisibly. So the lesson
   * announces itself in the work stack, using the step pair the pipeline
   * already streams for every other fact about a turn. No new event: `step:*`
   * is already in the reachability baseline and already lands a row.
   *
   * Emitted for the toggle too, not just the detected case, so the record of a
   * lesson reads the same whichever way it started.
   */
  /*
   * AND IT STAYS UNCONDITIONAL — a gate was tried here on 2026-09-10 and
   * reverted, which is worth the lines because the next reader will reach for
   * the same one.
   *
   * THE REPORTED SHAPE (§12 of `docs/research/teach-mode-driven-end-to-end.md`):
   * asked "what is machine learning" against this repository with teach on, the
   * turn answered *"ML is defined in mod:analyzer/3 within svc:analyzer, a
   * module of 11 .ts files under packages/analyzer/src/llm/"* -- the LLM client,
   * not machine learning -- and carried the work row "Taught this as a lesson"
   * while the canvas beside it read "the last answer drew nothing here".
   *
   * The obvious repair is to suppress this event when the lesson queue is empty.
   * It is wrong, because the event carries TWO claims and only one of them is
   * false:
   *
   *   1. "this turn ran in teach mode" -- TRUE, and it must stay visible. The
   *      mode engages without the toggle, and a silent switch is the defect the
   *      event exists for; `ask-tool-loop.test.ts` pins it, and gating this line
   *      turned that test red.
   *   2. "a lesson was taught" -- FALSE with no concept, and it lives in the
   *      VERB, not here. `NAMED_STEP_ROW['teach-mode'].verb` in
   *      `packages/web2/src/state/store.ts`, whose neighbouring `auto-approve`
   *      entry already states the rule: "The verb describes the MODE, not a
   *      count ... a verb claiming approvals that did not happen would be the
   *      surface asserting something the engine never supplied."
   *
   * THE SIGNAL A GATE WOULD HAVE USED IS ALSO UNUSABLE, measured before wiring:
   * the footer's "answered from 0 of N edges" reads like the marker for exactly
   * this failure, and `edgesSeen === 0` fires on 12 of the 13 registered bank
   * asks -- it counts edge rows surviving into the rendered digest, which is the
   * normal case here, not a fault. A number that reads like a measurement of the
   * ANSWER is measuring the PROMPT.
   *
   * Pinned by `test/teach-stamp-needs-a-concept.test.ts`.
   */
  if (teachTurn) {
    push({ type: 'step:start', id: TEACH_MODE_STEP_ID });
    push({ type: 'step:done', id: TEACH_MODE_STEP_ID });
  }

  /*
   * AUTO-APPROVE — ASKED ONCE PER TURN, NEVER CARRIED BETWEEN TURNS.
   *
   * `isAutoApproveActive` re-reads the trust boundary on every call, so this
   * line is the per-turn re-check the mode's whole safety rests on: a session
   * that enabled it on a trusted repository and then attached an untrusted one
   * gets `false` here and runs nothing unattended. Reading it once per TURN
   * rather than once per CALL is the same rule the permission policy follows a
   * few lines below — two identical tool calls inside one answer must not
   * resolve differently, or the transcript cannot be read back.
   *
   * AND IT SAYS SO ON SCREEN. The same reasoning as the teach row directly
   * above: a mode the user did not choose for THIS turn may not act invisibly,
   * so it announces itself through the `step:*` pair the pipeline already
   * streams. No new event, and therefore no new row in
   * `tools/ci/reachability-baseline.json`. The row is emitted whenever the mode
   * is ACTIVE, not only when a call was actually converted, because the fact
   * the user needs is "this turn was allowed to act without asking me" — which
   * is true from the first token, before any tool has been requested.
   */
  const autoApprove = isAutoApproveActive(input.repoRoot ?? null);
  if (autoApprove) {
    push({ type: 'step:start', id: AUTO_APPROVE_STEP_ID });
    push({ type: 'step:done', id: AUTO_APPROVE_STEP_ID });
  }

  for (const inv of input.intents) {
    push({ type: 'intent:start', id: inv.id });
  }

  push({ type: 'step:start', id: 'intents' });
  const intentRun = executeAskIntents(
    input.designMode ? undefined : input.graph ?? undefined,
    input.intents,
  );

  for (const inv of input.intents) {
    if (!intentRun.unsupported.includes(inv.id)) {
      push({ type: 'intent:done', id: inv.id });
    }
  }
  push({ type: 'step:done', id: 'intents' });

  const surfaceLines = renderAskSurfaceSection(input.surface, input.deictic);
  const intentLines = renderAskIntentSection(intentRun.executed);
  const subjectNodeId = input.intents.find((i) => i.subjectNodeId)?.subjectNodeId;

  /*
   * P3 phase 2 — the rule algebra, loaded once per turn.
   *
   * Once per TURN and not once per call, because a permissions file that
   * changed mid-turn would make two identical tool calls in the same answer
   * resolve differently, and the transcript could not be read back.
   *
   * `knownTools` is passed so a rule naming a tool that does not exist becomes
   * a named warning instead of a rule that can never fire.
   */
  const permissions =
    input.permissions ??
    loadPermissionPolicy(input.repoRoot ?? null, { knownTools: ASK_TOOL_ALLOWLIST });
  for (const w of permissions.warnings) {
    process.stderr.write(`sequence: permissions: ${w}\n`);
  }

  /*
   * THE SECOND DOOR, AND WHY IT IS GATED HERE.
   *
   * Gating `executeAskTool` alone was NOT a permission system. FILE RESEARCH
   * below reads real file bodies into the prompt automatically, before the
   * model has asked for anything, through its own `resolveReadable` — so a repo
   * that wrote `deny read_file(/gateway/**)` got the tool refused and the
   * gateway's source delivered anyway, in full, one section higher up the same
   * prompt. That is precisely a surface asserting something the engine never
   * supplied, and the first draft of the end-to-end lock below caught it by
   * asserting the denied body was absent and finding it present.
   *
   * The gate goes on `resolveReadable` because that is the SAME choke point the
   * tools already share, so a future third reader inherits it instead of
   * needing to remember it. `read_file` is the rule that governs it: the rule a
   * user writes to mean "these bytes must not enter the prompt" is
   * `read_file(...)`, whichever door the bytes would have come through.
   *
   * The tool context deliberately keeps the UNGATED resolver: each tool is
   * checked under its OWN name a few lines below, and wrapping the shared
   * resolver in a `read_file` verdict would make `deny read_file(/gateway/**)`
   * silently also deny `git_diff` and `propose_files` on the same paths — a
   * rule doing more than it says.
   */
  const permissionGatedResolve = (rel: string): string | null => {
    const verdict = evaluatePermission(permissions, {
      tool: 'read_file',
      subjects: [{ kind: 'path', value: rel }],
      repoRoot: input.repoRoot ?? null,
    });
    /* Auto-approve applies to BOTH doors, for the same reason the gate is on
       this resolver at all: a rule that behaves differently depending on which
       reader reached the file is a rule nobody can predict. Ask becomes allow;
       a `deny read_file(...)` still keeps those bytes out of the prompt, and
       the guard is the same compile-time one `executeAskTool` uses. */
    const effective =
      autoApprove && isAskVerdict(verdict) ? approveAskVerdict(verdict) : verdict;
    if (effective.decision !== 'allow') return null;
    return input.resolveReadable(rel);
  };

  const fileResearch =
    input.digest && !input.designMode && input.graph
      ? (() => {
          push({ type: 'step:start', id: 'file-research' });
          const result = gatherAskFileResearchTraced(
            {
              graph: input.graph,
              digest: input.digest,
              question: input.question,
              subjectNodeId,
              resolveReadable: permissionGatedResolve,
            },
            (ev) => {
              if (ev.type === 'file:read') push({ type: 'file:read', path: ev.path });
              if (ev.type === 'file:done') push({ type: 'file:done', path: ev.path });
            },
          );
          push({ type: 'step:done', id: 'file-research' });
          return result;
        })()
      : { files: [], omittedFiles: 0, refusedPaths: [] };

  const fileResearchLines = renderAskFileResearchSection(fileResearch);
  const compose: AskComposition = {
    intentLines:
      surfaceLines.length === 0
        ? intentLines
        : intentLines.length === 0
          ? surfaceLines
          : [...surfaceLines, '', ...intentLines],
    scopeLines:
      input.designMode && (input.scopeLines?.length ?? 0) === 0
        ? []
        : renderAskContextSection(input.scopeLines),
    fileResearchLines,
    instructionLines: input.instructionLines,
    attachmentLines: input.attachmentLines,
    historyLines: input.historyLines,
    skillSummaryLines: input.skillSummaryLines,
    skillBodyLines: input.skillBodyLines,
    researchMode: input.askMode === 'research',
    /* Engineer identity under auto-writes + edit intent — see AskComposition. */
    agenticEditor: permissionAutoWrites(input.permission) && askIntent === 'edit',
    subjectNodeId,
  };

  /**
   * COVERAGE (item 1.1). Built by the same call that builds the prompt, so the
   * numbers describe the bytes that were sent and not a re-derivation of them.
   * Design mode has no scanned graph and therefore no honest denominator — it
   * gets `undefined`, never a zero.
   */
  let coverage: AskCoverage | undefined;
  /* Carried out of the turn so the caller can persist it for the next one. */
  let openPrediction: { question: string; expect: string; arrow: string } | undefined;
  /** Which gate closed on the derived check-in, when one did. */
  let checkInSkipped: string | undefined;
  /** Files this turn read, with the excerpt that was read, for the carry. */
  const carriedReads: { path: string; excerpt?: string }[] = [];
  let basePrompt: string;
  if (input.digest && input.graph) {
    const built = buildAskPromptWithCoverage(input.digest, input.question, input.graph, compose);
    basePrompt = built.prompt;
    coverage = built.coverage;
  } else if (input.digest) {
    // A digest with no graph beside it: the prompt is unchanged and coverage
    // stays absent, because the denominator is the graph and there isn't one.
    basePrompt = buildAskPrompt(input.digest, input.question, compose);
  } else if (input.design) {
    basePrompt = buildDesignAskPrompt(input.design, input.question, compose);
  } else {
    /*
     * NO REPOSITORY, NO DESIGN — A QUESTION AND NOTHING ELSE.
     *
     * This branch was `input.design!`, a non-null assertion with no fourth
     * case, and it crashed with `Cannot read properties of undefined (reading
     * 'title')` several modules away. Nothing in the product reached it: the
     * web client sends `design: { title: 'Blank workspace', … }` whenever
     * nothing is attached, so the assertion held by accident of one caller.
     *
     * The repository-less bench condition is the first caller that does not,
     * and "teach me about polynomials" with no repository is a shape
     * `docs/research/lesson-kinds.md` says the product will have to answer.
     * An empty digest is the honest input: a question with no grounding
     * material, which is exactly what it is.
     *
     * Found by dry-running the condition against a canned provider before
     * spending card time on it — the crash would otherwise have surfaced twenty
     * conversations into a paid run.
     */
    basePrompt = buildAskPrompt(EMPTY_DIGEST, input.question, compose);
  }

  /*
   * WHAT THE LAST TURN FOUND, ahead of the instruction belt.
   *
   * Measured before this existed: a turn that read `brief.ts` handed the next
   * one the NAME `brief.ts` and none of its text, so the next turn re-read it or
   * answered without it — 5.4 provider calls a turn, each carrying ~5,300 tokens
   * of digest and rules rebuilt unchanged.
   *
   * Renders to nothing at all on a fresh conversation, deliberately: a header
   * promising continuity with nothing under it invites the model to invent the
   * continuity.
   */
  /*
   * WHERE THE BLOCK GOES - see docs/research/carry-placement-registration.md.
   *
   * Mechanism B refuted clause 1: the list reaches the prompt and the model does
   * not use it. Reading the assembled prompt then showed the block sits AFTER
   * the question, so "of those" points at nothing at the moment it is read, and
   * with the whole TOOLS section between it and generation.
   *
   * Two properties of a position, neither shown to be the cause. `tail` is the
   * shipped behaviour and the control; the other two each move one of them.
   */
  const carriedLines = renderCarry(input.carry);
  const carryBlock = carriedLines.join('\n');
  const place = carryPlacement();
  let carryAfterBelt = '';
  if (carryBlock !== '') {
    if (place === 'before-question') {
      const at = basePrompt.indexOf(ASK_QUESTION_MARKER);
      /* No marker means this prompt shape cannot host the placement. Falling
         back to `tail` keeps the product working; the arms assert the marker is
         present on the shape they run, so a silent fallback cannot be mistaken
         for a placement that ran. */
      basePrompt =
        at >= 0
          ? `${basePrompt.slice(0, at)}${carryBlock}\n\n${basePrompt.slice(at)}`
          : `${basePrompt}\n\n${carryBlock}`;
    } else if (place === 'last') {
      carryAfterBelt = carryBlock;
    } else {
      basePrompt = `${basePrompt}\n\n${carryBlock}`;
    }
  }

  /* The belt input carries `proposeArchitecture` explicitly: AskPipelineInput
     holds it nested under `design`, and the belt (and therefore the instruction
     hash) reads it flat. Lifting it here rather than reaching into `design`
     inside the renderer keeps the hash input one flat shape. */
  const instructionBelt = renderAskInstructionBelt({
    ...input,
    proposeArchitecture: input.design?.proposeArchitecture === true,
  });
  let promptWithTools =
    instructionBelt.length > 0 ? `${basePrompt}\n\n${instructionBelt}` : basePrompt;
  if (carryAfterBelt !== '') promptWithTools = `${promptWithTools}\n\n${carryAfterBelt}`;

  /*
   * WILL THIS FIT THE WINDOW THE MODEL ACTUALLY RUNS?
   *
   * Measured against `promptWithTools` rather than the digest, because that is
   * the string handed to the provider — the instruction belt is part of what has
   * to fit, and measuring the digest alone would under-count the thing being
   * checked.
   *
   * IT REPORTS, IT DOES NOT BLOCK, and that is deliberate. Ollama truncates a
   * long prompt silently and answers 200, so an overflowing turn produces a
   * fluent answer over a prefix; naming that is the win. Refusing to send is the
   * larger change — it decides what a person sees when their question is too big,
   * which is adjacent to the surfacing decision the owner has parked. The verdict
   * rides the result as data, the way `claims` and `premise` do, so the condition
   * is observable and testable before anyone chooses words for it.
   *
   * Attached only when there is something to say: a prompt with room reports
   * nothing, so the field's presence means "look at this".
   */
  let contextFit: ContextPlan | undefined;
  if (input.localContext) {
    const plan = planContextFit({
      need: approxTokens(promptWithTools),
      effective: input.localContext.window,
    });
    if (plan.verdict !== 'fits') contextFit = plan;
  }

  push({ type: 'step:start', id: 'provider' });
  push({ type: 'provider:start' });

  const breaker = new PermissionCircuitBreaker(permissions.denyStreak);

  const toolCtx: AskToolContext = {
    resolveReadable: input.resolveReadable,
    repoRoot: input.repoRoot ?? null,
    topologyNodeIds: new Set((input.graph?.nodes ?? []).map((node) => node.id)),
    designMode: input.designMode,
    question: input.question,
    jobMode: input.jobMode,
    permission: input.permission,
    permissions,
    /* The per-turn answer computed above, handed down rather than re-asked in
       the tool layer: one read, one truth for the whole turn. */
    autoApprove,
    /*
     * Sandboxed full exec is a RUNNER assertion, never a user's: the only
     * caller that may set it is one that owns the whole machine the command
     * lands on (the SWE-bench container). It rides the same env channel the
     * bench adapter already uses for SEQUENCE_AI_*, and is inert everywhere
     * else — the app server never sets it, so the product keeps its whitelist.
     */
    sandboxExec: process.env.SEQUENCE_SANDBOX_EXEC === '1',
    canvasToolsEnabled: canvasToolsEnabled(input),
    /*
     * THE SAME DIGEST AND THE SAME GRAPH THE PROMPT WAS BUILT FROM.
     *
     * `read_topology` expands one service of the orientation index the prompt
     * now ships, and `who_calls` walks the scanned dependency edges. Passing the
     * objects this turn already holds — rather than re-deriving them inside the
     * tools — is what makes an expansion incapable of disagreeing with the index
     * the model was shown, and costs no second scan.
     */
    digest: input.digest ?? null,
    graph: input.graph ?? null,
  };

  // Work-mode structuring (MADR model-roles): when jobMode==='work' and a `plan`
  // role is bound, the WORKER callProvider runs against the plan-resolved config
  // (a stronger-than-default model that still is not the reviewer). Otherwise the
  // worker uses the default config. resolveRoleConfig returns null when unbound.
  const planCfg =
    input.jobMode === 'work' ? resolveRoleConfig(input.cfg, 'plan') : null;
  const workerCfg: AiConfig = planCfg ?? input.cfg;

  let prompt = promptWithTools;
  /* Resolved once, at the top of the loop's scope, so every use inside the
     loop and every sentence written afterwards quote the SAME number. The
     apology at the ceiling naming a different cap than the one enforced would
     be a small lie in the one place a reader is already frustrated. */
  const roundCap = resolveAskRoundCap({
    maxRounds: input.maxRounds,
    designMode: input.designMode,
    repoRoot: input.repoRoot,
    question: input.question,
    agenticEdit: permissionAutoWrites(input.permission) && askIntent === 'edit',
    teach: input.teach === true,
  });

  /*
   * The turn's wall-clock budget, resolved once beside the round cap because it
   * is the same kind of thing: a bound on what this turn may spend. The two are
   * denominated differently on purpose -- rounds bound the COST, time bounds the
   * WAIT -- and a turn stops on whichever it reaches first.
   */
  const turnDeadlineMs = resolveTurnDeadlineMs({
    turnDeadlineMs: input.turnDeadlineMs,
    autoWrites: permissionAutoWrites(input.permission),
  });

  const evidenceLedgerCap = resolveAskEvidenceLedgerCap({

    designMode: input.designMode,
    repoRoot: input.repoRoot,
    question: input.question,
  });

  let rounds = 0;
  /**
   * The turn's EVIDENCE LEDGER — every tool result this turn produced, tagged
   * with the round that produced it.
   *
   * `prompt` used to be rebuilt each round as `promptWithTools` plus ONLY the
   * newest round's results, so round 1's file bodies were absent from the
   * prompt the model composed round 2's request with: three rounds of
   * gathering yielded one round of usable evidence and the agent re-read its
   * own work. The ledger is bounded — see
   * {@link ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES} and
   * {@link selectCarriedEvidence} for the retention policy.
   */
  const evidenceLedger: AskEvidenceEntry[] = [];

  let lastToolSectionText = '';

  /** Last rendered tool-results section (for B3.4 context breakdown). */

  /*
   * ISSUE-DRIVEN PRE-READ — the files the question names are round-zero
   * evidence, not round-three discoveries.
   *
   * Measured on the mini-50 official evals (v8-v10): the largest loss bucket
   * was 15-16 "clean wrong fix" instances — patches that applied and broke
   * nothing and fixed nothing, from a model that localized the bug by search
   * roulette. SWE-bench issues (like most bug reports) NAME their files;
   * the agent still spent its opening rounds rediscovering them. So for
   * auto-writes edit turns, any path written verbatim in the question that
   * resolves inside the repo jail is read harness-side (same jail, same
   * line-numbered format as read_file, capped at 3 files x 200 lines) and
   * seeded into the evidence ledger before the first provider call. Grounded
   * by construction — it is the same bytes read_file would return — and
   * labelled as a pre-read so the transcript never claims the model asked.
   */
  if (
    excerptsReachable({
      askIntent,
      autoWrites: permissionAutoWrites(input.permission),
      question: input.question,
    }) &&
    input.repoRoot &&
    input.resolveReadable
  ) {
    let seeded = 0;
    for (const rel of pathsNamedIn(input.question)) {
      if (seeded >= 3) break;
      const abs = input.resolveReadable(rel);
      if (abs === null || !fs.existsSync(abs)) continue;
      let body: string;
      try {
        const raw2 = fs.readFileSync(abs, 'utf8');
        const lines = raw2.split(/\r?\n/);
        const shown = lines.slice(0, 200);
        const numbered = shown.map((l, i) => `${i + 1}\t${l}`).join('\n');
        const more =
          lines.length > 200
            ? `\n(lines 201-${lines.length} not shown — read_file with {"offset": 201} continues)`
            : '';
        body =
          `### harness pre-read ${rel} (the question names this file; ` +
          `lines 1-${shown.length} of ${lines.length}):\n` +
          wrapUntrustedLines(['```', numbered, '```']).join('\n') +
          more;
      } catch {
        continue;
      }
      evidenceLedger.push({ round: 0, body });
      carriedReads.push({ path: rel, excerpt: body });
      push({ type: 'file:read', path: rel });
      push({ type: 'file:done', path: rel });
      seeded += 1;
    }
    if (seeded > 0) {
      lastToolSectionText = renderToolResultsSection(
        selectCarriedEvidence(evidenceLedger, 0, evidenceLedgerCap),
      ).join('\n');
      prompt = `${promptWithTools}\n\n${lastToolSectionText}`;
    }
  }
  /** True when the loop stopped with tool calls still pending. */
  let ranOutOfRounds = false;
  /**
   * WHICH budget ran out, because they are different events and the sentence
   * the user reads has to say which. Hitting the ceiling means the agent was
   * still learning and was cut off; stopping for no progress means it had
   * started going in circles. "Ask again to continue" is good advice for the
   * first and bad advice for the second.
   */
  let stopReason: 'ceiling' | 'no-progress' | 'deadline' | null = null;
  /*
   * A PROVIDER THAT DIES MID-TURN DOES NOT TAKE THE TURN WITH IT.
   *
   * Measured on mini-50 (free-tier M3): a provider failure on a later round
   * threw straight out of this loop, the CLI printed one stderr line and
   * exited, and every round of established evidence — including edits already
   * on disk — was reported as nothing. The failure is real and is NAMED in the
   * answer; the work that preceded it is still the user's.
   */
  let providerFailedMidTurn: string | null = null;
  /**
   * Id-independent signatures of every tool result this turn has already seen.
   *
   * The loop's budget is spent on PROGRESS, not on a count: it keeps going
   * while rounds bring back something new and stops when they stop. See
   * `UNPRODUCTIVE_ROUND_LIMIT` for why the signature cannot include the tool
   * call's id — a repeated failure would otherwise read as fresh evidence
   * forever and run every failing loop to the ceiling.
   */
  const seenEvidence = new Set<string>();
  /** Consecutive rounds that added no signature `seenEvidence` did not have. */
  let unproductiveRounds = 0;
  /** True when the permission circuit breaker stopped the loop. */
  let trippedBreaker = false;
  /** Per-turn cache for identical read-tool args — skips re-exec in later rounds. */
  const toolResultCache = new Map<string, AskToolResult>();
  /** One successful propose_topology per turn. */
  let topologySucceededThisTurn = false;
  /** One successful canvas.write_* per turn. */
  let canvasWriteSucceededThisTurn = false;
  /** One successful propose_files per turn (B1.4). */
  let filesProposalSucceededThisTurn = false;
  /** File-edit calls spent this turn — the consequence budget under auto-writes. */
  let fileWriteCallsThisTurn = 0;
  /** Paths that reached disk this turn — see `AskToolRoundSink.writtenFilesThisTurn`. */
  const writtenFilesThisTurn: string[] = [];
  /** Of those, the ones that already existed — see the sink field's comment. */
  const modifiedExistingThisTurn: string[] = [];
  /** One corrective make-the-change nudge per turn (edit intent, auto-writes). */
  let editNudgeSpent = false;
  let lastChanceDiffSpent = false;
  let teachBounces = 0;
  let chartsThisTurn = 0;
  /** See `AskToolRoundSink.referentsThisTurn`. */
  let referentsThisTurn: { tool: string; subject: string; items: readonly string[]; total: number } | undefined;
  /* The last picture this turn put on screen, model-authored or derived. The
     derived check-in asks about what the learner can see. */
  let lastChartThisTurn: SeqChart | undefined;
  /** Basenames of files actually read this turn — the teach grader's receipts. */
  const filesReadThisTurn = new Set<string>();
  /*
   * THE VERIFY CONTRACT'S LEDGER. Which round last WROTE a file, and which
   * round last actually EXECUTED a command (a refused run_command is an
   * attempt, not a verification). An edit newer than the last run is an
   * unverified edit; the contract below spends one round saying so.
   */
  let lastWriteRound = 0;
  let lastCommandRound = 0;
  /*
   * Two demands, not one. Measured on sphinx-8035 (probe, 2026-08-31): the
   * first verify demand was answered with MORE read_file calls, the loop
   * executed them, and the latched contract never spoke again — the edit
   * shipped untested at the ceiling. A model that answers the demand with
   * anything but a run gets exactly one repeat, harder-worded; then the
   * turn ends on the usual terms.
   */
  let verifyNudges = 0;
  /** The budget line every post-half prompt carries while nothing is written —
   *  appended OUTSIDE the evidence ledger so it can never mark a round
   *  productive or stale. See the block comment at the main assembly site. */
  const withBudgetCheck = (assembled: string): string => {
    if (!(autoWrites && fileWriteCallsThisTurn === 0 && rounds >= Math.ceil(roundCap / 2))) {
      return assembled;
    }
    return (
      assembled +
      `

### harness budget check: round ${rounds} of ${roundCap} is spent and NO FILE HAS ` +
      `BEEN CHANGED. The deliverable is an edited repository, not a plan. Stop investigating; ` +
      `make the smallest correct edit now (edit_file with an exact oldString you have read), ` +
      `then verify with run_command if rounds remain.`
    );
  };
  /** Auto-write modes swap the one-proposal latch for the write budget. */
  const autoWrites = permissionAutoWrites(input.permission);
  /** Tool names executed this turn — for forced final answers when prose is empty. */
  const executedToolNames: string[] = [];
  let text = '';
  let totalInput = 0;
  let totalOutput = 0;
  /*
   * THE LAST ROUND, SEPARATELY FROM THE BILL — they are different numbers and
   * only one of them is a context-window measurement.
   *
   * The prompt is REBUILT each round, not accumulated:
   * `prompt = promptWithTools + lastToolSectionText`, with the carried ledger
   * capped. So `totalInput` — the sum over up to MAX_ASK_TOOL_ROUNDS calls — is
   * roughly N times the size of any single call, and is the right number for
   * cost and for metrics: the user really did pay for N calls.
   *
   * It is the wrong number for anything that says "the prompt window". A
   * six-round turn on this repository reported ~150k input tokens against a
   * 200k window when the largest single call used ~15% of it, and the reader was
   * told to start a new conversation on arithmetic that described no call that
   * ever happened. `AskContextBreakdown` compares `totalMeasured` against
   * `totalApprox`, which is the size of ONE assembled prompt — so it gets this.
   */
  let lastCallInput: number | undefined;
  let anyEstimated = false;
  let hadUsage = false;
  const providerCallMs: number[] = [];

  for (;;) {
    throwIfAskAborted(input.signal);
    /*
     * The worker's tokens are the answer the user is waiting on, so they are the
     * ones that stream. The advisor call below deliberately gets no `onDelta` —
     * two generations interleaving their fragments into one transcript row would
     * render as garbage, and the advisor's note is not the answer.
     */
    const callStarted = Date.now();
    /*
     * THE INVARIANT PREFIX IS DECLARED, NOT DISCOVERED. `promptWithTools` is
     * byte-stable across every round of this turn — the loop only ever appends
     * this round's tool section after it — so its length is the caching
     * breakpoint. An eight-round question used to re-send that prefix eight
     * times at full price.
     */
    let call;
    try {
      call = await input.callProvider(
        workerCfg,
        prompt,
        (text) => push({ type: 'delta', text }),
        { cacheBreakpointChars: promptWithTools.length },
      );
    } catch (e) {
      if (providerCallMs.length === 0) throw e; // nothing established yet — fail loudly
      providerFailedMidTurn = e instanceof Error ? e.message : String(e);
      break; // `text` still holds the last completed round; the exit funnel reports the cut
    }
    providerCallMs.push(Date.now() - callStarted);
    text = call.text;
    if (call.usage) {
      totalInput += call.usage.inputTokens;
      totalOutput += call.usage.outputTokens;
      lastCallInput = call.usage.inputTokens;
      anyEstimated = anyEstimated || call.usage.estimated;
      hadUsage = true;
    }

    // Parse fenced ```sequence-tool blocks AND bare tool JSON pasted into
    // prose (owner 2026-08-26: propose_topology dumped inline → nothing on
    // the board). Strip both from what the user will see; merge with structured.
    const parsedTools = parseAllToolRequests(text);
    if (parsedTools.requests.length > 0 || parsedTools.malformed.length > 0) {
      text = parsedTools.stripped;
    }
    const toolRequests: AskToolRequest[] = mergeToolRequests(
      call.toolRequests,
      parsedTools.requests,
    );

    /*
     * TWO WAYS TO RUN OUT, AND THEY ARE DIFFERENT EVENTS.
     *
     * `atCeiling` is the backstop: every round was genuinely novel and the
     * model still has not finished. `spentOnNothing` is the common one: the
     * last few rounds brought back only material already in the ledger, so
     * another provider call is money spent to be told the same thing again.
     */
    const atCeiling = rounds >= roundCap;
    const spentOnNothing = unproductiveRounds >= unproductiveLimit;
    /*
     * THE THIRD WAY TO RUN OUT, and the only one the waiting reader can feel.
     * Checked HERE -- at the top of the loop, before another round is started --
     * so the deadline never interrupts a call already in flight. The round that
     * was running when the clock passed is finished and its evidence kept.
     */
    const outOfTime =
      turnDeadlineMs !== undefined && Date.now() - wallStartedAt >= turnDeadlineMs;
    const atCap = atCeiling || spentOnNothing || outOfTime;

    /*
     * A MALFORMED TOOL BLOCK GETS ONE CORRECTIVE ROUND.
     *
     * Without this the block was stripped from the answer and dropped: zero
     * requests, so the loop broke on the line below and the turn ended with a
     * short answer citing a file nothing had read, and nobody — model or user —
     * was told a tool call had been thrown away. Weak local models emit
     * slightly-off tool JSON constantly, which is what made a local-first
     * harness feel randomly broken.
     *
     * The parser message goes back as a normal tool result, so this costs one
     * round of the EXISTING budget and nothing new. It cannot spin: an identical
     * complaint twice is not new evidence, so the no-progress rule stops it on
     * the same terms as any other unproductive round.
     */
    if (toolRequests.length === 0 && parsedTools.malformed.length > 0 && !atCap) {
      rounds++;
      let brought = false;
      for (const message of parsedTools.malformed) {
        const body = `### tool (not executed): ${message}`;
        if (!seenEvidence.has(body)) {
          seenEvidence.add(body);
          brought = true;
        }
        evidenceLedger.push({ round: rounds, body });
      }
      unproductiveRounds = brought ? 0 : unproductiveRounds + 1;
      lastToolSectionText = renderToolResultsSection(
        selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
      ).join('\n');
      prompt = withBudgetCheck(`${promptWithTools}

${lastToolSectionText}`);
      continue;
    }

    /*
     * THE EDIT CONTRACT — the sibling of the draw contract, in-loop.
     *
     * Measured on SWE-bench (django-11790, granite4-hermes, Full permission,
     * post-latch-removal): one provider call, a three-phase prose PLAN naming
     * the exact file and the exact change, zero tool calls, empty patch. The
     * model does not need to remember that describing a change is not making
     * one — the harness remembers.
     *
     * The nudge is a corrective ROUND, not a special post-loop call, so the
     * full machinery still governs: the model may read before editing (an
     * edit_file oldString it has not seen is a guess), the round budget is
     * spent honestly, and the unproductive-round rule ends a model that
     * answers the nudge with more prose. One nudge per turn — a second
     * identical complaint is not new evidence.
     *
     * PROPOSE MODE GETS THE NUDGE TOO — measured on a real repo (hoppscotch,
     * 2026-08-28): "create HEALTHCHECK.md" in the default mode produced a
     * prose answer, zero proposals, and Review had nothing to show. The
     * deliverable there is the STAGED proposal; staging writes nothing to
     * disk, so there is no consent question, only the same failure one seat
     * over. Plan mode is the one mode whose deliverable IS words.
     */
    /*
     * UNDER AUTO-WRITES THE NUDGE REPEATS, AND THE ROUND BUDGET IS THE BOUND.
     *
     * Measured on SWE-bench (minimax-m3): the model proses, the single nudge
     * fires, the model proses again, and the loop ended at round two of
     * thirty-two — the harness gave up with 94% of its budget unspent. One
     * static nudge is also self-defeating mechanically: its second appearance
     * is not new evidence, so the unproductive rule ends the turn.
     *
     * So under auto-writes each nudge CARRIES THE COUNTDOWN — a different
     * deadline each round is genuinely new evidence — and keeps firing while
     * rounds remain and nothing is written. The cap is the budget itself:
     * spending it trying to obtain the deliverable is what a benchmark turn
     * is FOR. Propose mode keeps the single nudge — an interactive reader is
     * waiting, and burning their clock on a stubborn model is not the seat.
     */
    if (
      toolRequests.length === 0 &&
      !atCap &&
      (autoWrites || !editNudgeSpent) &&
      // After the last-chance diff round the answer IS the deliverable — the
      // salvage judges it post-loop; another nudge would talk over it.
      !lastChanceDiffSpent &&
      askIntent === 'edit' &&
      input.permission !== 'plan' &&
      fileWriteCallsThisTurn === 0 &&
      !filesProposalSucceededThisTurn &&
      !/\?\s*$/.test(text.trim())
    ) {
      editNudgeSpent = true;
      rounds++;
      const nudge = autoWrites
        ? `### harness (round ${rounds} of ${roundCap}): YOU HAVE CHANGED NOTHING, and ` +
          `${Math.max(0, roundCap - rounds)} round(s) remain. The user asked for a code change ` +
          'and you have write access — edits are applied to disk immediately. Do not describe ' +
          'the change; make it. If you have not read the file you are about to edit, call ' +
          'read_file first (an edit_file oldString you have not seen is a guess), then call ' +
          'edit_file with an exact oldString, then run the relevant tests with run_command.'
        : '### harness: YOU HAVE STAGED NOTHING. The user asked for a file change; in this ' +
          'mode changes are STAGED for their review — nothing touches disk until they ' +
          'Accept. Do not describe the change in words alone: call propose_files (new or ' +
          'whole files) or edit_file (exact oldString from a file you have read) so the ' +
          'Review pane has something to show.';
      evidenceLedger.push({ round: rounds, body: nudge });
      if (!seenEvidence.has(nudge)) seenEvidence.add(nudge);
      lastToolSectionText = renderToolResultsSection(
        selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
      ).join('\n');
      prompt = withBudgetCheck(`${promptWithTools}

${lastToolSectionText}`);
      continue;
    }

    if (toolRequests.length === 0 || atCap) {
      /*
       * THE TEACH BOUNCE — grade the lesson turn before accepting it. One
       * corrective round, violations named, then the retry stands as given.
       */
      /*
       * THE VISUAL, DECIDED IN CODE -- placed BEFORE the grader on purpose.
       *
       * The turn now has its chart, so `visualThisTurn` is true below and the NO
       * VISUAL complaint stops firing. That complaint fired on 44 to 47 of every
       * 47 turns and was the bulk of the wall the model was answering; removing
       * it by SATISFYING it rather than by deleting the rule is the difference
       * between fixing the turn and lowering the bar.
       *
       * ONLY WHEN THE MODEL DREW NOTHING. A chart it authored is about the
       * sentence it just wrote; this one is derived from the graph and knows
       * nothing about the lesson beyond which node it names. The model's is
       * better whenever it exists, so this is a floor, not a replacement.
       */
      if (input.teach === true && chartsThisTurn === 0 && !canvasWriteSucceededThisTurn) {
        /*
         * THE CODE KIND FIRST, THEN THE MATH KIND. A repository is the structure
         * this product is FOR, and a chart checked against a scanned graph is
         * the stronger promise; a plot is only faithful to an expression. Where
         * both could fire, the grounded one wins.
         */
        /*
         * A REPOSITORY ATTACHED IS THE CODE KIND, BY CONSTRUCTION.
         *
         * That is the classification rule `docs/research/lesson-kinds.md`
         * already states, and it is load-bearing rather than tidy. Without it
         * the math kind fires on `math-01` -- "the math of gradient descent AS
         * USED IN THIS REPO" -- which is one of the twenty makemore
         * conversations every figure of the night is measured on. A plot
         * appearing there would move numbers that are under a standing ruling
         * not to move, and it would be teaching a generic parabola to someone
         * asking about their own code.
         *
         * So the plot kinds are reachable only with no graph at all. Within
         * that, an expression the MODEL stated wins over the product's example:
         * it is about the sentence just written, and the example is the
         * fallback for a topic that named none.
         */
        const derived =
          input.graph
            ? buildConceptChart(input.graph, input.teachContext?.concept)
            : (buildPlot(text)?.chart ?? buildExamplePlot(input.question)?.chart);
        if (derived !== undefined) {
          chartsThisTurn += 1;
          lastChartThisTurn = derived;
          push({ type: 'chart:proposal', chart: derived });
        } else if (input.teachContext?.subjectNotInRepo === true) {
          /*
           * THE ONE CASE THE FLOOR ABOVE CANNOT COVER: a repository IS attached
           * and the subject is not in it, so `buildConceptChart` has no concept
           * to draw and the plot builders are unreachable (they need no graph).
           * That is Max's own example — "a learner asks what is machine learning
           * and gets the architecture DRAWN, not described".
           *
           * THE BELT WAS ASKED FIRST AND IT DID NOT WORK. `subjectNotInRepo`
           * already tells the turn its subject is absent and asks, in as many
           * words, for `propose_chart` with no nodeIds. Measured over 4 runs on
           * granite42-hermes Q4_K_M: fabricated repository facts fell to 0 of 4
           * and the draw rate stayed 0 of 4. The model does not call the tool —
           * 5 calls in 296 bench teach turns, 0 in 12 runs of this question. A
           * clause present, unconditional and unobeyed is this tree's oldest
           * failure and a louder one has never fixed it. So the product draws.
           *
           * NO nodeIds, AND A CLAIMED ONE VOIDS THE WHOLE CHART. A chart about
           * an idea carries none — `executeProposeChart` says so — and one that
           * names a node is claiming this repository contains the subject, which
           * is the fabrication in picture form. Stripping the id and keeping the
           * drawing would keep the claim and hide it.
           */
          const gk = await drawFromGeneralKnowledge(
            input.question,
            (c, p, onDelta, opts) => input.callProvider(c, p, onDelta, opts),
            input.cfg,
          );
          if (gk !== undefined) {
            chartsThisTurn += 1;
            lastChartThisTurn = gk;
            push({ type: 'chart:proposal', chart: gk });
          }
        }
      }
      if (input.teach === true && teachBounces < 2 && text.trim().length > 0) {
        const basenames: Set<string> | null = input.graph
          ? new Set(
              input.graph.nodes
                .map((n) => (n.label ?? n.id).replace(/\\/g, '/').split('/').pop()!.toLowerCase())
                .filter((b) => b.includes('.')),
            )
          : null;
        const problems = gradeTeachTurn(
          text,
          basenames,
          filesReadThisTurn,
          chartsThisTurn > 0 || canvasWriteSucceededThisTurn,
        );
        if (problems.length > 0) {
          teachBounces += 1;
          rounds++;
          const bounce =
            '### harness (teach contract): your lesson turn is REJECTED — ' +
            problems.join('; ') +
            '. Rewrite it now: ONE concept, at most ~150 words, grounded ONLY in files you ' +
            'have read (read them first if you must), ending with exactly one check-in question.';
          evidenceLedger.push({ round: rounds, body: bounce });
          if (!seenEvidence.has(bounce)) seenEvidence.add(bounce);
          lastToolSectionText = renderToolResultsSection(
            selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
          ).join('\n');
          prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
          continue;
        }
      }
      /*
       * THE CHECK-IN, DECIDED IN CODE — after the bounce, because the bounce is
       * the model's chance to write its own and this is the floor beneath it.
       *
       * Measured: the honest check-in was 3 and 4 of 47, and 24 of 94 turns
       * closed on a clarifying offer the contract bans. The queue advances only
       * on a turn that taught — a visual AND an accepted check — so a missing
       * check meant "continue" re-taught the same concept, which is what the
       * seat read found.
       *
       * Only when the model produced no check the grader accepts, and only when
       * there is a picture to ask about. It is appended, never substituted: the
       * model's own words are untouched.
       */
      /*
       * GATED ON "THIS TURN TAUGHT", NEVER ON "A CHART EXISTS".
       *
       * Measured on the first two runs: 6 of 13 and 7 of 15 derived checks
       * landed on READ-FIRST PREAMBLES -- turns whose whole prose is "First,
       * let me read the relevant file" -- and one landed straight after a
       * clarifying offer. That is not a cosmetic blemish. The queue advances on
       * a visual AND an accepted check, and the product supplies both, so a
       * preamble turn could ADVANCE THE LESSON PAST A CONCEPT NEVER TAUGHT --
       * the exact opposite of why this was built, since the queue's failure to
       * advance at all is what it was for.
       *
       * Two conditions, and each catches what the other misses:
       *
       *  · SUBSTANTIVE PROSE, at the stub boundary every reported figure uses.
       *    Measured at the append site on prose alone, this withholds 4 of 13
       *    and 6 of 15.
       *  · THE TURN DID NOT RUN OUT. `atCap` means the ceiling or the
       *    no-progress rule ended it: the model never delivered, so there is
       *    nothing to check the learner on. The 40- and 50-word preambles the
       *    word gate lets through are exactly these.
       */
      /*
       * ── THE REVEAL, IN CODE, NAMING THE ARROW ──────────────────────────
       *
       * Ruled 2026-09-06: the reveal must carry the REASON, not only the
       * verdict — the evidence page's implication 1, feedback with the why being
       * the largest lever it measured. A verdict without its reason is the
       * judge's failure turned on the learner.
       *
       * In CODE, like the visual and the check-in before it, and for the same
       * measured reason: `ctx.open` already asked the MODEL to resolve the open
       * prediction and nothing ever set it, so that branch had never once fired.
       * A reveal that depends on the model doing it is a reveal that does not
       * happen.
       *
       * The arrow is the graph's, so this is a claim the scan supports.
       */
      const openArrow = input.teachContext?.open;
      if (
        input.teach === true &&
        openArrow?.arrow !== undefined &&
        lastChartThisTurn !== undefined &&
        !atCap
      ) {
        text = `${text.trim()}

Last turn you were asked which would break. It is **${openArrow.expect}**, and the arrow that decides it is \`${openArrow.arrow}\` in the scanned graph — that is the dependency, so a change to what it returns reaches there.`;
      }

      const proseWords = text.trim().split(/\s+/).filter(Boolean).length;
      /*
       * WHICH CONDITION CLOSED THE CHECK-IN GATE — one reason per teach turn,
       * from the conditions themselves rather than from four of them re-derived
       * afterwards.
       *
       * The first version only wrote a reason when every OTHER condition had
       * passed and the chart was missing. So a turn that was at cap AND had no
       * derived chart recorded nothing, and 27 of 52 turns a run stayed silent —
       * the same invisibility that had already produced four wrong explanations
       * of the same bucket.
       *
       * Order matters and is the code's own: the first condition that closes is
       * the reason, because that is the one the turn actually failed. A turn that
       * is both short and at cap reports `stub`, since `stub` is what stopped it.
       *
       * `no-chart-derived-this-turn` is the one worth naming carefully: the
       * bench's `charts` array is NOT this quantity. That is what the turn ended
       * up with on the canvas; this is what the pipeline derived during the turn.
       */
      const checkInGate = ((): string | undefined => {
        if (input.teach !== true) return undefined; /* not a teach turn: no gate to close */
        if (proseWords <= TEACH_STUB_WORDS) return 'stub';
        if (atCap) return 'at-cap';
        if (gradeCheckIn(text).endsWithCheck) return 'own-check-in';
        if (lastChartThisTurn === undefined) return 'no-chart-derived-this-turn';
        return undefined; /* the gate is open; the derivation decides from here */
      })();
      if (checkInGate !== undefined) checkInSkipped = checkInGate;
      if (checkInGate === undefined && input.teach === true) {
        /*
         * TWO FORMS, ONE FLAGGED. The default asks the learner to READ the
         * picture on screen; `next-picture` asks them to PREDICT the one the
         * product holds and has not shown, which is the pretesting shape.
         *
         * Behind a flag because the bands are registered and unread
         * (`docs/research/next-picture-checkin.md`), and because a teach
         * contract changed before its measurement is a contract nobody can
         * score. Absent or unset puts the current form on every turn, byte for
         * byte as before.
         *
         * ONE VISUAL PER TURN IS UNCHANGED: the next concept's chart is built
         * to source the question and discarded. Nothing emits it.
         */
        const nextForm = process.env.SEQUENCE_TEACH_CHECKIN_FORM === 'next-picture';
        /*
         * THE ATTEMPT, NOT JUST ITS RESULT. Nine turns across two card runs drew
         * a chart and asked nothing, and nothing recorded which gate closed — so
         * the bucket was guessed at twice and both guesses were wrong. The reason
         * rides out on the turn now, exactly as stopReason does.
         */
        const attempt = nextForm
          ? attemptNextPictureCheckIn(input.graph ?? undefined, input.teachContext?.nextConcept)
          : undefined;
        if (attempt?.skipped !== undefined) checkInSkipped = attempt.skipped;
        const nextPicture = attempt?.prediction;
        if (nextPicture !== undefined) openPrediction = nextPicture;
        const derivedCheck = nextPicture?.question ?? deriveCheckIn(lastChartThisTurn);
        if (derivedCheck !== undefined) {
          /* No new stream event: the question is in the answer, which is where
             the learner reads it, and a derived check is countable by its
             opening ("Looking at the picture:") without widening the event
             union the client also has to know about. */
          text = `${text.trim()}

${derivedCheck}`;
        }
      }
      /*
       * THE VERIFY CONTRACT — an edit the tests never saw is a guess with a diff.
       *
       * Measured on the mini-50 official eval (2026-08-29): of 18 shipped-but-
       * unresolved patches, 6 broke previously-passing tests and 16 fixed
       * nothing — and only ~4 of 50 turns showed any test execution at all.
       * The model edits, narrates success, and stops; nothing in the loop made
       * running the suite cheaper than claiming it. So a full-permission edit
       * turn that WROTE files and is about to end without one command executed
       * since its last write gets ONE round pointed at run_command. A failing
       * run is information the next round can use; an unverified edit is the
       * one deliverable this harness refuses to present as finished silently.
       */
      if (
        askIntent === 'edit' &&
        autoWrites &&
        input.permission === 'full' &&
        fileWriteCallsThisTurn > 0 &&
        lastWriteRound > lastCommandRound &&
        verifyNudges < 2 &&
        !trippedBreaker
      ) {
        verifyNudges += 1;
        rounds++;
        const verifyNudge = (verifyNudges === 2
          ? '### harness (FINAL verification demand): you answered the previous demand with ' +
            'reads, not a run. Nothing you read changes the fact that YOUR EDIT HAS NEVER ' +
            'BEEN EXECUTED. Reply with a run_command call and nothing else. ' : '') +
          '### harness: YOUR EDIT IS UNVERIFIED. You changed files this turn and have not ' +
          'executed anything since. Run the narrowest test that covers your change NOW with ' +
          'run_command — run the WHOLE test file(s) covering the code you changed, not only your reproduction (a test runner or repo script — e.g. {"cmd": "python -m pytest ' +
          "path/to/test_file.py -x\"} or the repo's own runner). A failing run is useful " +
          'information; claiming success without running anything is not. If the tests pass, ' +
          "say so with the command's real output behind you.";
        evidenceLedger.push({ round: rounds, body: verifyNudge });
        if (!seenEvidence.has(verifyNudge)) seenEvidence.add(verifyNudge);
        lastToolSectionText = renderToolResultsSection(
          selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
        ).join('\n');
        prompt = withBudgetCheck(`${promptWithTools}

${lastToolSectionText}`);
        continue;
      }
      /*
       * THE LAST-CHANCE DIFF ROUND — spend one more call before shipping zero.
       *
       * Measured on SWE-bench (minimax-m3, mini-50 run v6): turns died at the
       * no-progress stop with the fix already diagnosed in prose — the model
       * had read the file, named the change, and the harness ended the turn
       * with an empty patch. Whatever stopped the loop (dead-end rounds, a
       * stubborn proser, the ceiling), an auto-writes edit turn that changed
       * NOTHING has one strictly-better move left: ask for the fix in the one
       * format the salvage can land. It cannot spin — the latch spends once —
       * and it costs one round against a turn already worth zero.
       */
      if (
        askIntent === 'edit' &&
        autoWrites &&
        /*
         * DELIBERATELY STILL A WRITE COUNT, and the attempt to change it is
         * worth recording.
         *
         * The salvage above now keys on `modifiedExistingThisTurn` because a
         * throwaway repro must not block applying a real diff. Making THIS
         * guard do the same is tempting — django-11790's `repro_maxlength.py`
         * disarmed exactly this round, and nine of v17's empty patches ran out
         * of rounds — but it is wrong, and four existing tests said so before
         * anything shipped: a turn whose deliverable IS new files (add a
         * module, add an endpoint) would be told it had fixed nothing and made
         * to spend a round producing a diff for work already done.
         *
         * The distinguishing signal — "was that new file the answer, or a
         * scratch pad?" — is not in the pipeline's hands. A filename heuristic
         * (`repro*`, root-level, untested) is the kind of guess this repo
         * deletes. So the salvage half of F1 ships, the forcing half does not,
         * and what it needs is a real notion of the turn's deliverable rather
         * than a cleverer count.
         */
        fileWriteCallsThisTurn === 0 &&
        !filesProposalSucceededThisTurn &&
        !lastChanceDiffSpent &&
        !trippedBreaker &&
        providerCallMs.length > 0
      ) {
        lastChanceDiffSpent = true;
        rounds++;
        const lastChance =
          '### harness: FINAL ROUND — the investigation budget is spent and NO FILE HAS ' +
          'CHANGED. Do not call tools and do not describe the change. Output the complete ' +
          'fix NOW as one or more unified diffs inside a ```diff fence: --- a/<path> and ' +
          '+++ b/<path> headers, @@ hunks whose context lines are copied EXACTLY from ' +
          'file content you have seen this turn, `--- /dev/null` for a new file. The ' +
          'harness applies matching hunks to disk directly. A ```sequence-tool fence calling edit_file with an EXACT oldString from file content in your evidence works too. A diff is a deliverable; ' +
          'anything else ships nothing.';
        evidenceLedger.push({ round: rounds, body: lastChance });
        if (!seenEvidence.has(lastChance)) seenEvidence.add(lastChance);
        lastToolSectionText = renderToolResultsSection(
          selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
        ).join('\n');
        prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
        continue;
      }
      // Remember WHICH ending this was, so the guard after the loop can name it. A
      // turn that stops because it ran out of rounds and one that stops because the
      // model had nothing more to ask are different events, and a user can only act
      // on the difference if we say which happened.
      ranOutOfRounds = atCap && toolRequests.length > 0;
      /* Time first: if the clock ran out, that is what happened, whatever else
         also became true on the same round. */
      if (ranOutOfRounds) {
        stopReason = outOfTime ? 'deadline' : atCeiling ? 'ceiling' : 'no-progress';
      }
      break;
    }

    rounds++;
    const toolResultBodies: string[] = [];
    const roundBroughtSomethingNew = { value: false };
    const topologyFlag: { value: boolean } = { value: topologySucceededThisTurn };
    const canvasFlag: { value: boolean } = { value: canvasWriteSucceededThisTurn };
    const filesFlag: { value: boolean } = { value: filesProposalSucceededThisTurn };
    const chartFlag: { value: number } = { value: chartsThisTurn };
    const writeCalls: { value: number } = { value: fileWriteCallsThisTurn };
    const trippedFlag: { value: boolean } = { value: trippedBreaker };
    const referentsHolder: {
      value?: { tool: string; subject: string; items: readonly string[]; total: number };
    } = referentsThisTurn === undefined ? {} : { value: referentsThisTurn };
    const onFileEvent = (ev: { type: 'file:read' | 'file:done'; path: string }): void => {
      if (ev.type === 'file:read') {
        push({ type: 'file:read', path: ev.path });
        const base = ev.path.replace(/\\/g, '/').split('/').pop();
        if (base) filesReadThisTurn.add(base.toLowerCase());
      }
      if (ev.type === 'file:done') push({ type: 'file:done', path: ev.path });
    };
    const onceFlags = (): {
      topology: boolean;
      canvas: boolean;
      files: boolean;
      autoWrites: boolean;
      fileWriteCalls: number;
    } => ({
      topology: topologyFlag.value,
      canvas: canvasFlag.value,
      files: filesFlag.value,
      autoWrites,
      fileWriteCalls: writeCalls.value,
    });
    const sink: AskToolRoundSink = {
      push,
      input,
      breaker,
      toolResultBodies,
      seenEvidence,
      roundBroughtSomethingNew,
      topologySucceededThisTurn: topologyFlag,
      canvasWriteSucceededThisTurn: canvasFlag,
      filesProposalSucceededThisTurn: filesFlag,
      chartsThisTurn: chartFlag,
      referentsThisTurn: referentsHolder,
      fileWriteCallsThisTurn: writeCalls,
      trippedBreaker: trippedFlag,
      writtenFilesThisTurn,
      modifiedExistingThisTurn,
    };

    let toolIdx = 0;
    while (toolIdx < toolRequests.length) {
      throwIfAskAborted(input.signal);
      const tr = toolRequests[toolIdx]!;
      if (tr.name) executedToolNames.push(tr.name);

      /*
       * A REFUSAL THE READER CANNOT SEE READS AS A CALL THAT RAN.
       *
       * These branches used to close the row with no `evidence`, so the client
       * rendered "Called edit_file", status done, and put the reason — which
       * went into `toolResultBodies`, i.e. into the MODEL's context only —
       * nowhere on screen. No file proposal appeared and nothing said why. That
       * was survivable while teach was a control the user switched on; the
       * 2026-09-02 change engages teach on the QUESTION, so a user who never
       * chose the mode can now watch an edit request come back as a lesson with
       * a row claiming the edit tool was called. `evidence` lands as the row's
       * identifier, which is the one slot on that row a reason can occupy.
       */
      if (
        (input.permission === 'plan' || input.teach === true) &&
        ASK_MUTATING_TOOLS.includes(tr.name as never)
      ) {
        const refusal = mutatingToolRefusal(tr.name, input.teach === true);
        push({
          type: 'tool:start',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          ...(tr.evidence ? { evidence: tr.evidence } : {}),
        });
        push({
          type: 'tool:done',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          evidence: refusal,
        });
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${refusal}`);
        toolIdx++;
        continue;
      }
      if (tr.name === 'run_command' && input.permission !== 'full') {
        const refusal =
          `Refused — only Full access runs commands; this session is ` +
          `${input.permission ?? 'propose'} mode. Say what should be run and why, or ask the ` +
          `user to switch to Full access.`;
        push({
          type: 'tool:start',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          ...(tr.evidence ? { evidence: tr.evidence } : {}),
        });
        push({
          type: 'tool:done',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          evidence: refusal,
        });
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${refusal}`);
        toolIdx++;
        continue;
      }
      if (
        isOncePerTurnAskTool(tr.name) &&
        oncePerTurnAskToolAlreadySucceeded(tr.name, onceFlags())
      ) {
        const refusal = oncePerTurnAskToolRefusal(tr.name, autoWrites);
        push({
          type: 'tool:start',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          ...(tr.evidence ? { evidence: tr.evidence } : {}),
        });
        push({
          type: 'tool:done',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          evidence: refusal,
        });
        toolResultBodies.push(`### tool ${tr.id} (${tr.name}): ${refusal}`);
        toolIdx++;
        continue;
      }

      if (canParallelizeAskToolInRound(tr, input, onceFlags())) {
        const batch: AskToolRequest[] = [];
        while (toolIdx < toolRequests.length) {
          const candidate = toolRequests[toolIdx]!;
          if (
            (input.permission === 'plan' || input.teach === true) &&
            ASK_MUTATING_TOOLS.includes(candidate.name as never)
          ) {
            break;
          }
          if (candidate.name === 'run_command' && input.permission !== 'full') break;
          if (
            isOncePerTurnAskTool(candidate.name) &&
            oncePerTurnAskToolAlreadySucceeded(candidate.name, onceFlags())
          ) {
            break;
          }
          if (!canParallelizeAskToolInRound(candidate, input, onceFlags())) {
            break;
          }
          batch.push(candidate);
          toolIdx++;
        }

        /*
         * A2.4 — independent cacheable reads in one round run concurrently.
         * SSE honesty: every tool:start for the batch first; tool:done may
         * complete in finish order (not necessarily request order).
         */
        for (const btr of batch) {
          push({
            type: 'tool:start',
            id: btr.id,
            ...(btr.name ? { name: btr.name } : {}),
            ...(btr.evidence ? { evidence: btr.evidence } : {}),
          });
        }

        const execs = await Promise.all(
          batch.map(async (btr) => {
            const cacheKey = stableAskToolCacheKey(btr.name, btr.args);
            const cached = toolResultCache.get(cacheKey);
            if (cached) {
              push({
                type: 'tool:done',
                id: btr.id,
                ...(btr.name ? { name: btr.name } : {}),
                evidence: `(cached) ${cached.evidence}`,
              });
              return { tr: btr, result: { ...cached, cacheHit: true }, toolDoneEmitted: true };
            }
            const result = await executeAskTool(btr.name, btr.args, toolCtx, onFileEvent);
            if (result.ok) toolResultCache.set(cacheKey, result);
            return { tr: btr, result, toolDoneEmitted: false };
          }),
        );

        for (const exec of execs) {
          await applyAskToolRoundResult(
            exec.tr,
            exec.result,
            exec.toolDoneEmitted,
            sink,
          );
        }
        continue;
      }

      push({
        type: 'tool:start',
        id: tr.id,
        ...(tr.name ? { name: tr.name } : {}),
        ...(tr.evidence ? { evidence: tr.evidence } : {}),
      });

      const cacheKey = isAskToolCacheable(tr.name)
        ? stableAskToolCacheKey(tr.name, tr.args)
        : null;
      const cached = cacheKey ? toolResultCache.get(cacheKey) : undefined;
      let result: AskToolResult;
      let toolDoneEmitted = false;
      if (cached) {
        /*
         * A CACHE HIT MEANS THE MODEL ASKED FOR SOMETHING IT ALREADY HAS, and
         * saying so is worth more than silently handing back the identical
         * bytes. Observed on ornith:9b: four identical `read_file` calls on a
         * 2,997-line file, each returning the same first 233 lines, because
         * nothing in the result said "you already ran this". The body is still
         * returned — the model may have lost it — with one line naming what
         * happened and pointing at the continuation the header already carries.
         */
        result = { ...cached, cacheHit: true };
        push({
          type: 'tool:done',
          id: tr.id,
          ...(tr.name ? { name: tr.name } : {}),
          evidence: `(cached) ${result.evidence}`,
        });
        toolDoneEmitted = true;
      } else {
        result = await executeAskTool(tr.name, tr.args, toolCtx, onFileEvent);
        if (cacheKey && result.ok) toolResultCache.set(cacheKey, result);
      }
      await applyAskToolRoundResult(tr, result, toolDoneEmitted, sink);
      toolIdx++;
    }

    chartsThisTurn = chartFlag.value;
    referentsThisTurn = referentsHolder.value;
    if (writeCalls.value > fileWriteCallsThisTurn) lastWriteRound = rounds;
    // `### run_command:` headers are emitted only by real executions; every
    // refusal path renders as `### tool <id> (run_command): refused…` instead.
    if (toolResultBodies.some((b) => b.includes('### run_command:'))) lastCommandRound = rounds;
    topologySucceededThisTurn = topologyFlag.value;
    canvasWriteSucceededThisTurn = canvasFlag.value;
    filesProposalSucceededThisTurn = filesFlag.value;
    fileWriteCallsThisTurn = writeCalls.value;
    trippedBreaker = trippedFlag.value;

    /* Counted AFTER the round's tools have all run: one novel result anywhere
       in the round makes the whole round productive, because a model that found
       one new thing has a reason to look again. */
    unproductiveRounds = roundBroughtSomethingNew.value ? 0 : unproductiveRounds + 1;

    /*
     * ONE COPY OF ANY PIECE OF EVIDENCE, DATED BY ITS MOST RECENT FETCH.
     *
     * MEASURED, driving this pipeline against a local ornith:9b on this
     * monorepo: the model called `read_file` on the same path with the same
     * arguments in four consecutive rounds. The per-turn cache stopped the disk
     * reads, but each hit still pushed the SAME 12,000-character body onto the
     * ledger, so the prompt grew by that much every round — 53,575 characters at
     * round one, 103,091 by round six, for one file read once.
     *
     * Moving the existing entry forward rather than appending a duplicate keeps
     * the evidence exactly as available as it was — `selectCarriedEvidence`
     * never charges the CURRENT round against the budget, so a re-requested
     * result is still carried whole — while the ledger stops paying for the same
     * bytes twice. Nothing is dropped and nothing is summarised.
     */
    for (const body of toolResultBodies) {
      const existing = evidenceLedger.find((e) => e.body === body);
      if (existing) existing.round = rounds;
      else evidenceLedger.push({ round: rounds, body });
    }
    const toolSection = renderToolResultsSection(
      selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
    );
    lastToolSectionText = toolSection.join('\n');
    prompt = withBudgetCheck(`${promptWithTools}

${lastToolSectionText}`);

    /*
     * THE CIRCUIT BREAKER — Codex's, and for Codex's reason: its auto-review
     * agent stops after three consecutive denials. A model that has been
     * refused N times running is not going to be un-refused by an N+1th
     * attempt, and each attempt costs a full provider round the user pays for.
     *
     * The break happens AFTER the ledger is written, so the refusals the model
     * collected are still in the transcript and in the evidence — the loop
     * stops, the record does not get thinner.
     */
    if (trippedBreaker) break;

    /*
     * B1.2 DRAW EARLY-EXIT — router → propose_topology/canvas → stop.
     *
     * Once the board or AI Canvas has a successful write this turn, further
     * tool rounds are almost always a refused second propose_topology or a
     * re-read. Cap is already ≤2 for draw; this exits after the FIRST success
     * so a clean draw is one provider call (plus forced-final synth if prose
     * was empty), not two refused loops up to the ceiling.
     */
    if (
      askIntent === 'draw' &&
      (topologySucceededThisTurn || canvasWriteSucceededThisTurn)
    ) {
      break;
    }

    /*
     * B1.4 EDIT EARLY-EXIT — propose_files staged → Review is the next seat.
     * Further tool rounds after a successful file proposal burn tokens the
     * user cannot act on until Accept/Deny; stop and leave the diff-first
     * Review surface to carry the turn.
     */
    /* Under auto-writes there is no Review seat waiting — the write already
       landed — so the turn keeps its rounds for run_command→edit iteration and
       ends when the model stops asking for tools or the budget runs out. */
    if (askIntent === 'edit' && filesProposalSucceededThisTurn && !autoWrites) {
      break;
    }
  }

  /*
   * THE DRAW CONTRACT — the deliverable is enforced by the harness, not hoped
   * from the model.
   *
   * Measured with granite4-hermes on this repository: "draw me a visual
   * component on the AI canvas" classified `draw`, canvas tools were live, the
   * model spent its rounds on read_file, answered in prose, and the canvas
   * stayed empty while the turn read as answered. A weak model does not need
   * to be smart enough to remember the deliverable — the harness remembers.
   *
   * ONE forced round, and only when: the intent was draw, nothing landed on
   * canvas or board, at least one provider round ran, the breaker did not trip,
   * and the model is not mid-conversation asking the user a scoping question
   * (the unscoped-draw hint TELLS it to ask compact-vs-detailed first — a turn
   * that ends with a question is following instructions, not failing them).
   *
   * If the model still draws nothing, the harness says so in its own voice.
   * An empty canvas with a confident answer above it is the surface asserting
   * something the engine never produced.
   */
  const endsWithQuestion = /\?\s*$/.test(text.trim());
  if (
    askIntent === 'draw' &&
    input.permission !== 'plan' &&
    !topologySucceededThisTurn &&
    !canvasWriteSucceededThisTurn &&
    providerCallMs.length > 0 &&
    !trippedBreaker &&
    !endsWithQuestion
  ) {
    throwIfAskAborted(input.signal);
    const canvasLive = canvasToolsEnabled(input);
    const drawDemand =
      '--- YOU HAVE NOT DRAWN ANYTHING ---\n' +
      `The user asked for something ON the ${canvasLive ? 'canvas' : 'board'}, and no ` +
      `${canvasLive ? 'canvas.write_* or ' : ''}propose_topology call succeeded this turn. ` +
      'Prose is not a drawing. Reply with EXACTLY ONE ```sequence-tool fence calling ' +
      (canvasLive
        ? 'one canvas.write_* tool (a diagram, chart or markdown block), or propose_topology for architecture, '
        : 'propose_topology, ') +
      'built from the evidence above. Keep it COMPACT. Do not call read tools.';
    const forcedStarted = Date.now();
    const forcedCall = await input.callProvider(workerCfg, `${prompt}\n\n${drawDemand}`, undefined, {
      cacheBreakpointChars: promptWithTools.length,
    });
    providerCallMs.push(Date.now() - forcedStarted);
    rounds++;
    if (forcedCall.usage) {
      totalInput += forcedCall.usage.inputTokens;
      totalOutput += forcedCall.usage.outputTokens;
      lastCallInput = forcedCall.usage.inputTokens;
      anyEstimated = anyEstimated || forcedCall.usage.estimated;
      hadUsage = true;
    }
    const forcedParsed = parseAllToolRequests(forcedCall.text ?? '');
    const forcedRequests = mergeToolRequests(forcedCall.toolRequests, forcedParsed.requests);
    for (const tr of forcedRequests) {
      if (topologySucceededThisTurn || canvasWriteSucceededThisTurn) break;
      const isDrawTool =
        tr.name === 'propose_topology' || tr.name === CANVAS_STORY_TOOL || isCanvasToolName(tr.name);
      if (!isDrawTool) continue; // read tools were explicitly declined — no more research
      push({
        type: 'tool:start',
        id: tr.id,
        ...(tr.name ? { name: tr.name } : {}),
      });
      const forcedResult = await executeAskTool(tr.name, tr.args, toolCtx);
      if (forcedResult.topology) {
        topologySucceededThisTurn = true;
        push({
          type: 'topology:proposal',
          ...(forcedResult.topology.title ? { title: forcedResult.topology.title } : {}),
          ...(forcedResult.topology.rationale ? { rationale: forcedResult.topology.rationale } : {}),
          nodes: forcedResult.topology.nodes,
          edges: forcedResult.topology.edges,
        });
      }
      if (forcedResult.canvasBlock) {
        canvasWriteSucceededThisTurn = true;
        push({
          type: 'canvas:block',
          id: forcedResult.canvasBlock.id,
          blockType: forcedResult.canvasBlock.type,
          ...(forcedResult.canvasBlock.title ? { title: forcedResult.canvasBlock.title } : {}),
          payload: forcedResult.canvasBlock.payload,
          status: 'live',
        });
      }
      if (forcedResult.storyRoute) {
        push({
          type: 'canvas:story',
          title: forcedResult.storyRoute.title,
          steps: forcedResult.storyRoute.steps,
        });
      }
      push({
        type: 'tool:done',
        id: tr.id,
        ...(tr.name ? { name: tr.name } : {}),
        evidence: forcedResult.evidence,
      });
    }
    const drew = topologySucceededThisTurn || canvasWriteSucceededThisTurn;
    const forcedText = forcedParsed.stripped.trim();
    if (drew && forcedText.length > 0) {
      // The forced round's words are the drawing's caption — they replace the
      // prose that failed to draw, not append to it.
      text = forcedText;
    } else if (!drew) {
      const note =
        'Nothing landed on the canvas: I asked the model to produce a canvas block twice ' +
        'this turn and it never called a drawing tool. The words above are the best it did. ' +
        'Try again, or ask for a compact architecture view (propose_topology handles that).';
      text = text.trim().length === 0 ? note : `${text.trimEnd()}\n\n${note}`;
    }
  }

  /*
   * PROSE-DIFF SALVAGE — the edit syntax models already speak.
   *
   * Measured on SWE-bench (minimax-m3, run v5): the loop ran its FULL 32-round
   * budget — engineer identity, countdown nudges, budget checks all firing —
   * and the model wrote the complete fix into markdown fences without once
   * calling an edit tool. Diff-literate models edit in prose; a harness that
   * only listens for its own syntax throws that work away. So under
   * auto-writes, when the turn wrote nothing through tools, any ```diff
   * fences in the final answer are parsed as unified diffs and applied
   * THROUGH THE SAME applyProposedFiles jail. Exact-context only; a failed
   * hunk refuses its whole file with the reason named.
   */
  if (
    askIntent === 'edit' &&
    autoWrites &&
    /*
     * "NOTHING WAS FIXED YET", not "nothing was written yet".
     *
     * This read `fileWriteCallsThisTurn === 0`. Measured on mini-50 v17
     * (django-11790): the model wrote a throwaway `repro_maxlength.py` to
     * reproduce the bug, which is a reasonable thing to do, and that one write
     * closed this door — so a real fix sitting in a ```diff fence in the same
     * answer was never applied. A file that did not exist before is a repro, a
     * scratch note or a new test; it is not a change to the code that has the
     * bug. Sixteen of that run's 25 empty patches are this shape and the one
     * below.
     */
    modifiedExistingThisTurn.length === 0 &&
    input.applyProposedFiles &&
    input.resolveReadable &&
    !trippedBreaker
  ) {
    const diffFiles = parseProseDiffs(text);
    if (diffFiles.length > 0) {
      const toWrite: { path: string; content: string }[] = [];
      const refusals: string[] = [];
      for (const df of diffFiles) {
        let current: string | null = null;
        const abs = input.resolveReadable(df.path);
        if (abs !== null && fs.existsSync(abs)) {
          try {
            current = fs.readFileSync(abs, 'utf8');
          } catch {
            current = null;
          }
        }
        const applied = applyProseDiffFile(df, current);
        if ('content' in applied) toWrite.push({ path: applied.path, content: applied.content });
        else refusals.push(`${applied.path}: ${applied.reason}`);
      }
      if (toWrite.length > 0) {
        const write = await input.applyProposedFiles(toWrite);
        if (write.written.length > 0) {
          fileWriteCallsThisTurn += 1;
          filesProposalSucceededThisTurn = true;
          for (const rel of write.written) {
            if (!writtenFilesThisTurn.includes(rel)) writtenFilesThisTurn.push(rel);
          }
          for (const rel of write.modified ?? []) {
            if (!modifiedExistingThisTurn.includes(rel)) modifiedExistingThisTurn.push(rel);
          }
          push({
            type: 'edit:proposal',
            title: 'Applied from the diff in the answer',
            files: toWrite.filter((f) => write.written.includes(f.path)),
            applied: true,
          });
          text =
            `${text.trimEnd()}

Applied the diff above to ` +
            `${write.written.length} file(s): ${write.written.join(', ')}.`;
        }
        for (const r of write.refused) refusals.push(`${r.path}: ${r.reason}`);
      }
      if (refusals.length > 0) {
        text =
          `${text.trimEnd()}

Not applied — ${refusals.join('; ')}. ` +
          'A diff applies only where its context matches the file exactly.';
      }
    }
  }

  /*
   * THE EDIT CONTRACT'S CLOSING FACT. An edit-intent turn that delivered
   * nothing says so — one factual sentence, no speculation. Under auto-writes
   * the fact is "nothing was written" (a confident answer above an untouched
   * tree is how an empty SWE-bench patch shipped looking like a solution);
   * under propose it is "nothing was staged" (Review had nothing to show and
   * nothing said so — measured on hoppscotch, 2026-08-28). Plan mode's
   * deliverable IS words, so no note; a turn ending with a question is
   * mid-conversation and the note would be noise.
   */
  if (
    askIntent === 'edit' &&
    input.permission !== 'plan' &&
    fileWriteCallsThisTurn === 0 &&
    !filesProposalSucceededThisTurn &&
    providerCallMs.length > 0 &&
    !trippedBreaker &&
    !/\?\s*$/.test(text.trim())
  ) {
    const note = autoWrites
      ? 'Note: no file was changed this turn — nothing was written to disk.'
      : 'Note: no file change was staged this turn — there is nothing new in Review.';
    /*
     * AN EMPTY ANSWER GETS THE EXPLANATION FIRST, THEN THE FACT. Measured live
     * (shopfront, minimax-m3, 2026-08-29): a turn that spent its whole budget
     * exploring ended with empty text, this note became the ENTIRE answer, and
     * the forced-final funnel below — the one that would have said "I used all
     * 8 rounds and ran out" — saw non-empty text and stayed silent. The user
     * read one orphaned sentence and had no idea why nothing happened. So an
     * empty text is explained by the funnel first; the note appends after.
     */
    if (text.trim().length === 0) {
      text = `${buildForcedFinalAnswer({
        stopReason,
        roundCap,
        rounds,
        executedToolNames,
        unproductiveLimit,
      })}\n\n${note}`;
    } else {
      text = `${text.trimEnd()}\n\n${note}`;
    }
  }

  /**
   * A TURN ALWAYS ENDS IN WORDS.
   *
   * The loop above strips ```sequence-tool fences out of `text` before breaking. A
   * model that spends its final round asking for tools therefore leaves `text` empty,
   * and the user was handed a blank answer with no explanation — no result, no error,
   * no reason. That is the harness failing to report, not the model failing to answer,
   * and silence is the one outcome a user cannot act on.
   *
   * Adopted from ml-harness, which routes every turn through a single exit funnel with
   * named endings and streams a purpose-written sentence rather than ever going quiet
   * (`app/conductor.py`). Its docstring cites the real incident this prevents: four tool
   * calls, zero words, stream closed in 5.3 s.
   *
   * The sentence is the harness's own voice and says exactly what happened. It never
   * guesses at an answer, because inventing one here would be worse than the silence.
   */
  /*
   * A STOPPED RUN SAYS SO, EVEN WHEN THE MODEL DID WRITE WORDS.
   *
   * The out-of-rounds ending below only fires when `text` is empty, which is
   * right for it: a model that answered in its last round did not lose
   * anything. The breaker is different — it CUT the turn short, and a user
   * reading a confident answer has no way to know that N tool calls in a row
   * were refused and the agent then stopped trying. That is precisely the
   * "surface asserting something the engine never supplied" failure, so the
   * note is appended unconditionally and in the harness's own voice.
   */
  if (trippedBreaker) {
    const note =
      `I stopped early: ${breaker.consecutive} tool calls in a row were refused by your ` +
      `permission rules, so I stopped asking rather than spend more rounds being told no. ` +
      `The refusals above name the exact rule and the file it is in ` +
      `(${sourceLabel(permissions.sources[0] ?? 'default')}).`;
    text = text.trim().length === 0 ? note : `${text.trimEnd()}\n\n${note}`;
  }

  if (providerFailedMidTurn !== null) {
    const note =
      `The model provider failed after ${providerCallMs.length} completed round(s) ` +
      `(${providerFailedMidTurn}), so this turn was cut short. Everything above was ` +
      'established before the failure; nothing after it exists.';
    text = text.trim().length === 0 ? note : `${text.trimEnd()}

${note}`;
  }

  if (text.trim().length === 0) {
    text = buildForcedFinalAnswer({
      stopReason,
      roundCap,
      rounds,
      executedToolNames,
      unproductiveLimit,
    });
  }

  /*
   * THE OUTPUT HALF OF THE UNTRUSTED GUARD. llm/untrusted.ts wraps repo-derived text
   * so the model treats it as data; nothing stopped the model handing that wrapper
   * back as its answer. Measured on this repo with granite4-hermes: 5,750 output
   * tokens beginning "<untrusted_repo_content> {\"repo\":{\"id\":\"repo\"…", printed to
   * the reader as the answer to their question. An answer carrying our own sentinels
   * is context, not an answer — say so instead of printing the digest.
   */
  if (answerEchoesUntrustedBlock(text)) {
    text = UNTRUSTED_ECHO_REFUSAL;
  }

  /*
   * FENCED SEQDiagram → BOARD. Design-mode prompts still teach ```seqd fences;
   * attached-repo prompts may dump JSON in prose when the model skips the tool.
   * Strip valid diagrams from the transcript and emit topology:proposal so the
   * Accept/Deny layer on the board can run — the same path as propose_topology.
   */
  const seqdParsed = parseFencedSeqdProposals(text);
  if (seqdParsed.proposals.length > 0) {
    text = seqdParsed.stripped;
    for (const proposal of seqdParsed.proposals) {
      if (topologySucceededThisTurn) break;
      push({
        type: 'topology:proposal',
        ...(proposal.title ? { title: proposal.title } : {}),
        ...(proposal.rationale ? { rationale: proposal.rationale } : {}),
        nodes: proposal.nodes,
        edges: proposal.edges,
      });
      topologySucceededThisTurn = true;
    }
  }

  /* Unfenced SeqDiagram JSON (process-sequence etc.) → board, same path. */
  const bareSeqd = salvageBareSeqdProposals(text);
  if (bareSeqd.proposals.length > 0) {
    text = bareSeqd.stripped;
    for (const proposal of bareSeqd.proposals) {
      if (topologySucceededThisTurn) break;
      push({
        type: 'topology:proposal',
        ...(proposal.title ? { title: proposal.title } : {}),
        ...(proposal.rationale ? { rationale: proposal.rationale } : {}),
        nodes: proposal.nodes,
        edges: proposal.edges,
      });
      topologySucceededThisTurn = true;
    }
  }

  /*
   * BARE propose_topology LEFT IN THE FINAL ANSWER → BOARD.
   * When the model pastes tool JSON as the answer (and the loop already broke
   * with no further round), salvage here so the board still gets the ghost.
   * Other bare tools are stripped from the transcript but not re-executed —
   * re-running a read/command on the way out would surprise the reader.
   */
  const bareLeft = salvageBareToolRequests(text);
  if (bareLeft.requests.length > 0) {
    text = bareLeft.stripped;
    for (const tr of bareLeft.requests) {
      if (tr.name !== 'propose_topology') continue;
      if (input.permission === 'plan') continue;
      if (topologySucceededThisTurn) continue;
      const result = await executeAskTool(tr.name, tr.args, toolCtx);
      if (result.topology) {
        topologySucceededThisTurn = true;
        push({
          type: 'topology:proposal',
          ...(result.topology.title ? { title: result.topology.title } : {}),
          ...(result.topology.rationale ? { rationale: result.topology.rationale } : {}),
          nodes: result.topology.nodes,
          edges: result.topology.edges,
        });
      }
    }
  }

  /*
   * ══ THE DONE-WHEN GATE ═════════════════════════════════════════════════
   *
   * The verify contract above can only ASK the model to run something; when
   * the model answers with prose instead, the turn still ends and the caller
   * reads a finished-sounding answer over an edit nothing executed. Measured on
   * the mini-50 official eval (2026-08-29): 18 shipped-but-unresolved patches,
   * ~4 of 50 turns with any test execution. So when the caller states what
   * "done" means — a command — the HARNESS runs it, after the last write and
   * before the terminal event, and the outcome is the answer's closing sentence.
   *
   * ONLY WHEN SOMETHING WAS WRITTEN. A gate run over an untouched tree would
   * pass or fail on the repo's prior state and say nothing about this turn;
   * `verify` stays absent rather than reporting that.
   *
   * A FAILING GATE DOES NOT REVERT. The edit is named as failing and left in
   * place — the turn's checkpoint is the rollback point, and a harness that
   * silently undid work would hide the very diff the reader needs to judge.
   * A refusal (un-allowlisted command, metacharacters) is reported with the
   * gate's own reason and is never a pass. The run itself is surfaced through
   * the existing `command:log` event, the same one `run_command` uses.
   */
  let verify: AskVerifyResult | undefined;
  if (input.doneWhen && writtenFilesThisTurn.length > 0 && input.repoRoot) {
    /*
     * UNDER THE SAME POLICY AS THE TOOL. A done-when command is a command the
     * harness runs in the repo, and the rule a user writes to forbid that is
     * `deny run_command(...)`. Running the gate around the policy would make
     * `--done-when` a second, ungoverned shell — the exact shape G2 closed for
     * the tool branches. A denial is a REFUSAL with the rule named, never a
     * pass, and it is not the gate's own refusal text so the reader can tell
     * "your policy said no" from "not a recognised runner".
     */
    /* Auto-approve reaches this gate too, and it has to: this is the THIRD
       place one turn consults the same algebra (the tool, the file-research
       resolver, here), and a mode that converted `ask` at two of them would
       make the same rule mean different things inside one answer. Same
       compile-time guard, same `ask`-only transform. */
    const rawGateVerdict =
      input.doneWhen.kind === 'command'
        ? evaluatePermission(permissions, {
            tool: 'run_command',
            subjects: [{ kind: 'command', value: input.doneWhen.cmd }],
            repoRoot: input.repoRoot,
          })
        : undefined;
    const gateVerdict =
      rawGateVerdict !== undefined && autoApprove && isAskVerdict(rawGateVerdict)
        ? approveAskVerdict(rawGateVerdict)
        : rawGateVerdict;
    if (input.doneWhen.kind === 'command' && gateVerdict && gateVerdict.decision !== 'allow') {
      const refuseReason = `${gateVerdict.decision === 'deny' ? 'denied' : 'not allowed without approval'} by permission rule ${gateVerdict.rule ?? '(default policy)'} — done-when commands are governed by the same run_command rules as the tool`;
      verify = { status: 'failed', cmd: input.doneWhen.cmd, exitCode: null, reason: `refused: ${refuseReason}`, refuseReason };
    } else {
      verify = runAskDoneWhen(input.doneWhen, input.repoRoot);
    }
    if (verify.cmd !== undefined && verify.refuseReason === undefined) {
      push({
        type: 'command:log',
        cmd: verify.cmd,
        exitCode: verify.exitCode ?? null,
        output: verify.output ?? '',
        ok: verify.status === 'passed',
      });
    }
    const files = `${writtenFilesThisTurn.length} file${writtenFilesThisTurn.length === 1 ? '' : 's'}`;
    const sentence =
      verify.status === 'passed'
        ? `Done-when '${verify.cmd}' passed after writing ${files}.`
        : verify.status === 'skipped'
          ? `Done-when gate skipped by the caller (${verify.reason}) — the ${files} written this turn are unverified.`
          : verify.refuseReason !== undefined
            ? `Done-when '${verify.cmd}' was refused: ${verify.refuseReason} — the ${files} written this turn are unverified.`
            : /* No promise of a checkpoint here: the pipeline cannot see whether
                 one was taken (the CLI takes none; the app does only when the
                 client sent a session id). The receipt's `rollbackPoint` says. */
              `Done-when '${verify.cmd}' FAILED (exit ${String(verify.exitCode)}) — the ${files} written this turn are left in place, not reverted. Read the diff before trusting them.`;
    text = `${text.trimEnd()}\n\n${sentence}`;
  }

  push({ type: 'provider:done' });
  push({ type: 'step:done', id: 'provider' });

  if (hadUsage) {
    push({
      type: 'usage',
      inputTokens: totalInput,
      outputTokens: totalOutput,
      estimated: anyEstimated,
    });
  }

  const diagram =
    input.digest && input.graph
      ? deriveAskDiagram(input.graph, input.question, input.digest)
      : undefined;

  const summedUsage: AskUsagePayload | undefined = hadUsage
    ? { inputTokens: totalInput, outputTokens: totalOutput, estimated: anyEstimated }
    : undefined;

  // Advisor consult (MADR model-roles). After the worker turn succeeds, if an
  // advisor is bound AND its (model, provider, baseUrl) differ from the default,
  // a read-only JSON pass runs against the advisor config. It NEVER fails the
  // ask: a thrown callProvider is swallowed and the worker text still returns.
  let advisor: AdvisorNote | undefined;
  if (shouldConsultAdvisor(input.cfg)) {
    const advisorCfg = resolveRoleConfig(input.cfg, 'advisor');
    if (advisorCfg) {
      push({ type: 'step:start', id: 'advisor' });
      try {
        const advisorReply = await input.callProvider(
          advisorCfg,
          buildAdvisorPrompt(input.question, text),
        );
        advisor = parseAdvisorReply(advisorReply.text);
        push({ type: 'advisor', severity: advisor.severity, note: advisor.note });
      } catch {
        // SKIP advisor — never fail the ask. The worker text is the answer.
        advisor = undefined;
      }
      push({ type: 'step:done', id: 'advisor' });
    }
  }

  /*
   * ══ THE LIE DETECTOR ═══════════════════════════════════════════════════
   *
   * The last thing before the answer is handed over: check it against the graph
   * that was supposed to ground it. The first real answer this product ever
   * gave said "MySQL databases" where zero files mention MySQL and `db.py`
   * calls `sqlite3.connect`, and nothing checked because nothing could.
   *
   * ONLY WITH A SCANNED GRAPH. Design mode has no repository to refute
   * anything, and running there would flag every technology a proposal names —
   * which is the point of a proposal.
   *
   * THE TEXT IS NOT TOUCHED. `claims` rides beside the answer and is never
   * applied to it. Rewriting a model's words on a heuristic's say-so would make
   * the transcript another thing nobody can trust, and the model may be
   * contrasting or quoting the user. The reader is shown the discrepancy and
   * decides.
   *
   * ATTACHED ONLY WHEN THERE IS SOMETHING TO SAY, so the field's presence means
   * "look at this" rather than "a check ran".
   */
  /*
   * THE QUESTION'S PREMISE, checked against the same graph.
   *
   * Deliberately computed even when the answer is clean: the bench failure was
   * an answer with nothing wrong in it ("I'll search for Django configuration")
   * produced by a question with everything wrong in it. Checking only the answer
   * is what let that through.
   */
  let premise: AskPremiseCheck | undefined;
  if (!input.designMode && input.graph && input.question.trim().length > 0) {
    const report = checkQuestionPremise(input.question, input.graph);
    if (report.hasFindings) {
      premise = {
        unsupportedTechnologies: report.unsupportedTechnologies,
        unverifiable: report.unverifiable,
        checked: {
          datastores: report.datastoreEvidence === 'checked',
          languages: report.languageEvidence,
        },
      };
    }
  }

  let claims: AskClaimCheck | undefined;
  if (!input.designMode && input.graph && text.trim().length > 0) {
    const report = checkAnswerClaims(text, input.graph);
    if (report.hasFindings) {
      claims = {
        unsupportedTechnologies: report.unsupportedTechnologies,
        unknownPaths: report.unknownPaths,
        checked: {
          datastores: report.datastoreEvidence === 'checked',
          files: report.fileEvidence === 'checked',
        },
      };
    }
  }

  const contextBreakdown = buildAskContextBreakdown({
    groundingText: basePrompt,
    instructionsText: instructionBelt,
    toolsText: lastToolSectionText,
    ...(lastCallInput !== undefined ? { measuredInput: lastCallInput } : {}),
  });

  /*
   * A DESIGN ANSWER THAT CITES A SCAN IS CITING SOMETHING IT WAS NEVER GIVEN.
   *
   * Measured 2026-09-09. Asked to design a URL shortener -- a system that does
   * not exist -- minicpm5-hermes answered, in the middle of an otherwise good
   * proposal: "the risks in the digest show 11 total items, with empty single
   * points of failure and cycles arrays ... the system is structurally sound
   * given what's scanned."
   *
   * None of that was in the prompt. This pipeline already withholds both: the
   * graph is passed as undefined when designMode is set, and the digest section
   * is gated on !input.designMode. So the numbers were invented, in the one mode
   * built to have no grounding at all, and they read exactly like evidence.
   *
   * THE PROMPT ALREADY FORBIDS THIS AND THE MODEL DID IT ANYWAY. buildDesignAskPrompt
   * opens with "nothing below has been built, detected, or read from a repository".
   * That makes three separate instructions this model has been given and not
   * followed -- retrieve-before-you-answer, do-not-clarify, and now do-not-cite-a-scan
   * -- which is why this is a check on the output rather than a fourth sentence
   * in the input.
   *
   * IT APPENDS, IT DOES NOT EDIT. Deleting the sentence would leave a confident
   * answer with a hole in it and no sign anything happened; the reader needs to
   * know which part of what they just read was invented. The proposal itself is
   * often fine -- it was here -- so the diagram is not thrown away either.
   */
  /*
   * A TURN THAT OPENED NO FILE MUST NOT SAY IT OPENED FILES.
   *
   * Measured 2026-09-09 against the ml-harness repository. Asked what the main
   * services were and to cite the files it read, the model answered with three
   * correct service names and then:
   *
   *   "Files we opened to answer this (as reported by the scan) include:
   *    app/main.py, frontend/src/components/FilesPane.tsx, ..."
   *
   * The receipt for that turn reads `tools: none, rounds: 0`. It opened
   * nothing. The file names are real -- they come from the digest -- and the
   * sentence around them is not.
   *
   * THIS CHECK IS STRUCTURAL, NOT LEXICAL, which is why it is worth more than
   * the design-mode one below it. That one matches phrases and can be worded
   * around; this one compares a claim against a COUNT the pipeline already
   * keeps. A turn with no rounds made no tool call, and no wording can make
   * that false.
   *
   * It appends rather than edits, for the same reason as the clause below: the
   * cited files usually exist and the answer is usually right about them, so
   * deleting the sentence would remove a useful pointer and leave no trace
   * that anything happened. What the reader needs is to know the difference
   * between a file that was read and a file that was named.
   */
  if (rounds === 0) {
    const OPENED_CLAIM =
      /\b(files? (?:we|I) (?:opened|read)|(?:we|I) (?:opened|read|inspected) the files?|after reading|having read)\b/i;
    if (OPENED_CLAIM.test(text)) {
      text = [
        text,
        '> **No file was opened for this answer.** This turn made no tool calls, so any' +
          ' file named above comes from the scan summary rather than from reading it. The' +
          ' names are real; the claim to have opened them is not.',
      ].join(String.fromCharCode(10, 10));
    }
  }

  if (input.designMode) {
    const BLANK_LINE = String.fromCharCode(10, 10);
    const SCAN_CLAIM =
      /\b(the digest|single points? of failure|cycles? array|what(?:'s| is) scanned|the scan(?:ned)? (?:repo|repository|graph)|in this repository)\b/i;
    if (SCAN_CLAIM.test(text)) {
      text = [text, '> **This was a design, not a scan.** The answer above refers to a repository digest, scan or risk report. No repository was read for this turn - design mode is given no graph and no digest - so any number or finding stated as if it came from one was invented. The proposed architecture stands; the scan facts do not.'].join(BLANK_LINE);
    }
  }

  const result: AskPipelineResult = {
    text,
    ...(diagram ? { diagram } : {}),
    ...(intentRun.unsupported.length > 0 ? { unsupportedIntents: intentRun.unsupported } : {}),
    ...(summedUsage ? { usage: summedUsage } : {}),
    metrics: buildAskMetrics({
      wallMs: Date.now() - wallStartedAt,
      rounds,
      stopReason,
      trippedBreaker,
      designMode: input.designMode,
      intent: askIntent,
      ...(hadUsage ? { inputTokens: totalInput, outputTokens: totalOutput } : {}),
      ...(providerCallMs.length > 0 ? { providerCallMs } : {}),
    }),
    ...(contextBreakdown.sections.length > 0 ? { contextBreakdown } : {}),
    ...(advisor ? { advisor } : {}),
    ...(coverage ? { coverage } : {}),
    ...(openPrediction ? { openPrediction } : {}),
    ...(checkInSkipped === undefined ? {} : { checkInSkipped }),
    /*
     * The carry the NEXT turn should receive: what came in, plus what this turn
     * actually found. Built even when nothing was found, so a caller can persist
     * one object per conversation without branching.
     */
    carryOut: extendCarry(input.carry ?? EMPTY_CARRY, input.turnIndex ?? 0, {
      ...(carriedReads.length > 0 ? { filesRead: carriedReads } : {}),
      ...(lastChartThisTurn?.focusItemId !== undefined
        ? {
            chart: {
              title: lastChartThisTurn.title ?? 'chart',
              focus:
                lastChartThisTurn.items?.find((i) => i.id === lastChartThisTurn.focusItemId)?.label ??
                lastChartThisTurn.focusItemId,
              neighbours: (lastChartThisTurn.items ?? [])
                .filter((i) => i.id !== lastChartThisTurn.focusItemId)
                .map((i) => i.label),
            },
          }
        : {}),
      ...(input.teachContext?.concept?.title
        ? { concept: { title: input.teachContext.concept.title, text } }
        : {}),
      /* The ONE difference between the control arm and the treatment arm. */
      ...(carryReferentsEnabled() && referentsThisTurn !== undefined
        ? { referents: referentsThisTurn }
        : {}),
    }),
    ...(claims ? { claims } : {}),
    ...(premise ? { premise } : {}),
    ...(contextFit ? { contextFit } : {}),
    ...(verify ? { verify } : {}),
    filesWritten: [...writtenFilesThisTurn],
    permissionSources: [...permissions.sources],
    source: 'provider',
  };
  push(resultPayload(result));
  return result;
}
