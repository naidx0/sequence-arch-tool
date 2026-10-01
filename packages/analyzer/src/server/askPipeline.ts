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

import { PRODUCT_QUESTION_MODEL } from './productQuestionModel.js';
import { PLAN_SURFACE, PLANNING_CANVAS_WRITES, PLANNING_GUIDANCE } from './planTurn.js';
import fs from 'node:fs';
import path from 'node:path';
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
import { pathToSegments, segmentsMatch } from '../join/join.js';
import { CANVAS_STORY_TOOL, isCanvasToolName } from './canvasTools.js';
import {
  attemptNextPictureCheckIn,
  buildAnswerFlowChart,
  buildConceptChart,
  deriveBeforeAfterChart,
  deriveCheckIn,
  deriveNextPictureCheckIn,
  redrawOf,
  withGroundedLesson,
  withPicturePointer,
  withWorkedExample,
  type AnswerFlowTrace,
} from './conceptChart.js';
import { gatherTeachEvidence } from './teachEvidence.js';
import { drawVisual, type VisualSpec } from './visuals.js';
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
  deriveFlowCheckIn,
  gradeCheckIn,
  lastParagraphAsksReader,
  removeClosingOffer,
  TEACH_CLOSING_COMPREHENSION_EXAMPLE,
  TEACH_CLOSING_PREDICTION_EXAMPLE,
  teachPredictionExample,
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
  repairAskToolRequests,
  withRepairNote,
  oncePerTurnAskToolAlreadySucceeded,
  oncePerTurnAskToolRefusal,
  parseAllToolRequests,
  parseFencedSeqdProposals,
  resolveAskEvidenceLedgerCap,
  resolveAskRoundCap,
  resolveTurnDeadlineMs,
  salvageBareSeqdProposals,
  salvageBareToolRequests,
  ASK_DRAWING_PREFER_NATIVE_TOOLS_LINE,
  ASK_MCP_TOOL_HINT_LINES,
  renderAskToolHintSection,
  boardMarksFit,
  renderCanvasToolHintSection,
  renderWorkspaceToolHintSection,
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
import { classifyAskIntent, isArchitectureDesignAsk, isExplainFileAsk, isPlotOrMathDrawAsk, isTeachAskQuestion, type AskClassifiedIntent } from './askIntent.js';
import { renderWalkToolHintSection } from './teachWalk.js';
import { renderBoardToolHintSection } from './boardTools.js';
import { seedBoardFromDigest } from './boardSeed.js';
import { diagramToolsPromptBlock } from './diagramTools.js';
import { diffTodos, renderTodoSection, type TodoItem } from './todoList.js';
import { renderGoalSection } from './goalPlan.js';
import type { AskGoalContext, PlanStep } from '@sequence/api-types';
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

/**
 * WHAT THE FIRST PROMPT CARRIED, SAID ON THE STREAM (2026-09-23).
 *
 * The fourth measurement: the battery's `teach-flow` case failed 6/6 on
 * "expected at least one tool call and made none" — because the harness now
 * does the research before the first call, and the stream never carries the
 * prompt. So the turn says what it was handed: the section's length, the files
 * it cites, and every traced hop as `from>to`, which is what a landed chart's
 * steps are checked against. On the `result` event rather than an event of its
 * own: web2's stream reducer is exhaustive over the wire union and returns no
 * state for a type it does not know, so a new event would break the client.
 */
export interface AskEvidenceSummary {
  chars: number;
  sources: string[];
  hops: string[];
}

export interface AskPipelineResult {
  text: string;
  /**
   * THE SESSION'S PLAN AS THIS TURN LEFT IT — present only when the turn was
   * GIVEN a goal context, `[]` included.
   *
   * The goal runner reads it to decide whether the step it aimed at closed, and
   * it reads it from HERE rather than from the plan file it just wrote, so that
   * "did the step close" is answered by the turn's own outcome and not by a
   * second read that another window could have raced. Absent means the turn was
   * never given a plan, which is different from a turn that had one and changed
   * nothing.
   */
  goalPlan?: PlanStep[];
  /**
   * How many tool calls this turn actually EXECUTED.
   *
   * The goal runner's narration rule keys on it, and it must come from the
   * pipeline rather than be inferred from the answer text: "announced a move
   * and called no tool" is a statement about calls, and reading the prose for
   * it is exactly the phrase-matching that `goalPlan.ts`'s first rule forbids.
   * Absent on a surface answer, where no loop ran.
   */
  toolCallsMade?: number;
  /** See {@link AskEvidenceSummary}. Present only on a turn the harness handed evidence. */
  evidence?: AskEvidenceSummary;
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
  /** The model's thinking channel, streamed. See `@sequence/api-types` ask.ts. */
  | { type: 'reasoning'; text: string }
  | { type: 'intent:start'; id: string }
  | { type: 'intent:done'; id: string }
  | { type: 'file:read'; path: string }
  | { type: 'file:done'; path: string }
  | {
      /**
       * THE TURN'S WORK LIST, AS THE MODEL LAST SET IT.
       *
       * The WHOLE list every time, never a delta: `update_todos` replaces, and
       * a client that patched deltas across sixteen rounds would drift away
       * from what the server is actually carrying. `todoList.ts` has the rules.
       *
       * Not `step:start`/`step:done`: those are the PIPELINE's own phases
       * (intents, file-research, provider), fixed and product-owned. This is
       * the model's description of the job, and the reader needs to be able to
       * tell the two apart.
       */
      type: 'todo:list';
      items: { id: string; title: string; status: 'pending' | 'active' | 'done' | 'blocked'; note?: string }[];
    }
  | {
      /**
       * ONE OR TWO ITEMS THE AGENT DREW ON THE WHITEBOARD.
       *
       * Sent per accepted `board.*` / `diagram.*` call rather than as a whole
       * document: the person may be mid-stroke on that surface, and replacing
       * their document with the agent's copy would fight them.
       * `Whiteboard.tsx` appends by id, so a replay cannot double-draw.
       * `removeIds` clears marks before append (delete / SystemBoard replace).
       */
      type: 'board:item';
      items: import('./boardTools.js').BoardItem[];
      removeIds?: string[];
    }
  | {
      /**
       * ONE CONCRETE INPUT, TRACED THROUGH THE PICTURE THAT WAS JUST DRAWN.
       * The fourth beat of the teaching journey — see `teachWalk.ts`.
       */
      type: 'teach:walk';
      input: string;
      steps: { partId: string; says: string }[];
    }
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
      /** The AI Canvas tab (planTurn.ts); absent is the default. */
      surface?: string;
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
      surface?: string;
      /**
       * SET WHEN THIS CHART IS A REDRAW of one this same turn already drew on the
       * same surface: the 0-based position of that chart among this turn's
       * charts. The client swaps it in place instead of adding a frame. One
       * request drew three frames in the owner's run 3. Absent on every first
       * drawing, so a client that ignores it appends exactly as before.
       */
      replacesTurnChart?: number;
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
      /** P3 — Build already wrote these files. */
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
      /** See {@link AskEvidenceSummary}. */
      evidence?: AskEvidenceSummary;
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
  /**
   * THE SESSION'S STANDING GOAL AND PLAN — see `AskGoalContext` in api-types
   * for why this is derived server-side from the session rather than sent by
   * the client, and why `runLive` switches the prompt between two voices.
   *
   * ABSENT IS THE WHOLE OLD BEHAVIOUR. No goal section, no plan tools, and a
   * prompt byte-identical to one built before this field existed — which is
   * what the CLI, the bench and every pipeline test rely on.
   */
  goal?: AskGoalContext;
  /**
   * Put the session's plan on disk the moment a plan tool changes it.
   *
   * Supplied by the caller that OWNS the session, never derived here: this
   * function is handed a question and a config and has no idea which thread it
   * is serving, and inventing one so it could write a file would be the
   * pipeline reaching past its own contract. Absent ⇒ the plan lives for the
   * turn, which is the honest behaviour for a caller with no session.
   */
  persistPlan?: (plan: readonly PlanStep[]) => void;
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
   * A `/plan` turn (planTurn.ts): the planning guidance joins the belt, the
   * canvas writers are offered, and up to PLANNING_CANVAS_WRITES blocks may
   * land instead of one. On the hash input because it changes the belt.
   */
  planning?: boolean;
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
   * When Build is on, the host supplies this so the pipeline can
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
   * THE LOCAL WORKSPACE — where a General chat keeps its work (`workspace.ts`).
   *
   * Separate from `repoRoot` on purpose and never a substitute for it: a
   * non-null `repoRoot` asserts a scanned repository the digest describes, and
   * pointing it at an empty folder would make the prompt claim one. With no
   * repo attached, this is what `WORKSPACE_TOOLS` read and write.
   */
  workspaceRoot?: string | null;
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
    opts?: {
      cacheBreakpointChars?: number;
      /** The thinking channel, fragment by fragment. Absent ⇒ nobody sees it. */
      onReasoning?: (text: string) => void;
    },
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
    /**
     * Why the provider stopped: `stop`, `length`, `tool_calls`, or absent when
     * it said nothing. `length` is the one this pipeline acts on — see
     * {@link TRUNCATED_ANSWER_NOTE}.
     */
    finishReason?: string;
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
  if (tr.name === 'run_command' && input.permission !== 'build') return false;
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
  /** Set when the block landed from a tool that {@link countsAsTeachDrawing}. */
  teachCanvasDrawingThisTurn: { value: boolean };
  filesProposalSucceededThisTurn: { value: boolean };
  /** How many charts this turn drew — the teach contract's visual receipt. */
  chartsThisTurn: { value: number };
  /** The charts this turn put on the canvas, in order, so a redraw can replace its original. */
  chartsDrawnThisTurn: { value: SeqChart[] };
  /** Everything this turn DREW, in order — see {@link describeTurnArtefacts}. */
  artefactsThisTurn: { value: TurnArtefact[] };
  /**
   * THE WORK LIST, CARRIED ACROSS ROUNDS.
   *
   * A holder rather than a return value because `update_todos` can be called in
   * any round and the next round's PROMPT has to show the result: the list the
   * model set in round two is the list it must be shown in round nine, or it
   * writes a different plan. `todoAdvanced` is read by the unproductive-round
   * rule — see the comment there.
   */
  todos: { value: TodoItem[] };
  /** The SESSION's plan, carried across rounds for the same reason. */
  goalPlan: { value: PlanStep[] };
  todoAdvanced: { value: boolean };
  /**
   * The item ids of the chart drawn THIS TURN — the only parts `walk_example`
   * may name. Taken from the chart the pipeline actually EMITTED, never from
   * the model's second telling of it, so a walk cannot invent the picture it
   * claims to be walking through.
   */
  drawnPartIds: { value: string[] };
  /**
   * The board as it stands MID-ROUND. A connection resolves its endpoints out
   * of this, so two cards drawn and then joined in one round must find each
   * other — refreshing only between turns would refuse the agent's own work.
   */
  boardKnown: { value: { nodeIds: readonly string[]; items: { id: string; at?: { x: number; y: number } }[] } };
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
  /** The flows `trace_flow` proved this turn, in call order (a cached repeat is one). */
  traceFlows: AnswerFlowTrace[];
}

/**
 * THE SYNTAX GATE — a write that does not parse is named in the same round.
 *
 * Measured on the mini-50 official eval (django-12304, 2026-08-30): an edit
 * landed cleanly, the turn ended claiming success, and the evaluator's very
 * first import died on an IndentationError — the entire instance lost to a
 * file that never parsed, which one free interpreter call would have caught.
 * So under Build, every written .py/.js/.mjs/.cjs file is compile-
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
/** The surface each chart this turn was drawn on ('' for the default), so a redraw is matched only on its own surface. */
const DRAWN_ON = new WeakMap<SeqChart, string>();

async function applyAskToolRoundResult(
  tr: AskToolRequest,
  result: AskToolResult,
  toolDoneEmitted: boolean,
  sink: AskToolRoundSink,
): Promise<void> {
  const { push, input, breaker, toolResultBodies, seenEvidence } = sink;
  /* Read BEFORE the result is applied: `diffTodos` compares what the list was
     at the top of this call against what the model just sent. */
  const priorTodos = sink.todos.value;
  /* Same rule, same reason: read the plan BEFORE the result is applied, so
     "did this round finish a step" compares two real states. */
  const priorGoalPlan = sink.goalPlan.value;
  /* Every path that can produce referents comes through here: the other two
     executeAskTool sites are draw-only (`isDrawTool`) and propose_topology. */
  if (result.referents !== undefined) sink.referentsThisTurn.value = result.referents;
  if (result.flow !== undefined && !sink.traceFlows.includes(result.flow)) sink.traceFlows.push(result.flow);
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
          `${write.written.length === 1 ? '' : 's'} under Build ` +
          `(${write.written.join(', ')})`;
        if (input.permission === 'build' && input.repoRoot) {
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
    /*
     * A PICTURE OF SOMETHING THIS REPOSITORY DOES NOT CONTAIN MUST SAY SO.
     *
     * MEASURED, 2026-09-11, through the shipped route on the shopfront fixture
     * — eight services of e-commerce, no machine learning anywhere — asked
     * "what is machine learning?" in Teach mode. The learner was shown a chart
     * titled "How a request reaches the ML model" with items `User (Composer)`,
     * `Prediction Service`, `ML Engine (trained model)`, `Feature Store`. None
     * of those is in that repository, and `caption` was null.
     *
     * EVERY EXISTING GUARD HELD. `nodeIds` were all absent, so
     * zero-fabrication-by-construction did its job: the chart claimed no node of
     * this graph. That is not enough. An uncaptioned diagram on an attached
     * repository's canvas READS as that repository's own, and no node id is
     * needed to make that claim — the fabrication had simply moved from the ids
     * into the picture.
     *
     * WHY THE CAPTION WAS MISSING, AND WHY THE FIX IS HERE. It lives inside
     * `drawFromGeneralKnowledge`, which is a floor for when the model draws
     * NOTHING (`chartsThisTurn === 0`, below). The model drew, so the floor
     * never ran. That gate is right when the subject is IN the repository — a
     * chart the model wrote about the code beats a derived one — and exactly
     * wrong when `subjectNotInRepo` is true. So the provenance is stamped at the
     * emit site, where the flag is already known, rather than by widening a gate
     * whose reasoning is correct for the case it was written for.
     *
     * THE MODEL'S OWN CAPTION IS REPLACED, not appended to. It would be a
     * sentence about the idea, written as though about this repository, and two
     * captions would let the reader keep the wrong one.
     */
    const chart =
      sink.input.teachContext?.subjectNotInRepo === true
        ? { ...result.chart, caption: GENERAL_KNOWLEDGE_CAPTION }
        : result.chart;
    sink.chartsThisTurn.value += 1;
    const chartSurface = result.chartSurface ?? (sink.input.planning === true ? PLAN_SURFACE : undefined);
    /*
     * ONE REQUEST, ONE FRAME (cloud patch 0007). A second propose_chart in the
     * same turn that draws the same picture (same title, or mostly the same
     * boxes) replaces the first instead of stacking beside it, and is not
     * counted again in what the turn drew. Only a chart on the SAME surface is
     * a redraw: head routes charts to surfaces (the plan tab), and a picture
     * moved to another tab is a new frame there, not a correction here.
     */
    const drawn = sink.chartsDrawnThisTurn.value;
    const sameSurface = drawn.map((c, i) => ({ c, i })).filter(({ c }) => (DRAWN_ON.get(c) ?? '') === (chartSurface ?? ''));
    const hit = redrawOf(sameSurface.map(({ c }) => c), chart);
    const redraw = hit === undefined ? undefined : sameSurface[hit]!.i;
    if (redraw === undefined) {
      drawn.push(chart);
      DRAWN_ON.set(chart, chartSurface ?? '');
      sink.artefactsThisTurn.value.push({ kind: 'chart', label: chart.title });
      push({ type: 'chart:proposal', chart, ...(chartSurface ? { surface: chartSurface } : {}) });
    } else {
      drawn[redraw] = chart;
      DRAWN_ON.set(chart, chartSurface ?? '');
      push({ type: 'chart:proposal', chart, ...(chartSurface ? { surface: chartSurface } : {}), replacesTurnChart: redraw });
    }
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
    /* The parts of the picture, for `walk_example`. Recorded whatever mode the
       turn is in: the tool is teach-only, and gating the RECORD as well would
       put one condition in two places where one of them can drift. */
    sink.drawnPartIds.value = chart.items
      .map((i) => i.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (sink.input.teach === true) {
      const lit = chart.items
        .map((item) => item.nodeId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      push({
        type: 'teach:step',
        /* `chart`, not `result.chart`: the step is the line shown beside the
           picture, so it must carry the same provenance the picture now does. */
        caption: chart.caption ?? chart.title,
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
    sink.artefactsThisTurn.value.push({
      kind: 'topology',
      label: result.topology.title ?? 'untitled diagram',
    });
    push({
      type: 'topology:proposal',
      ...(result.topology.title ? { title: result.topology.title } : {}),
      ...(result.topology.rationale ? { rationale: result.topology.rationale } : {}),
      nodes: result.topology.nodes,
      edges: result.topology.edges,
    });
  }
  if (
    (result.boardItems && result.boardItems.length > 0) ||
    (result.boardRemoveIds && result.boardRemoveIds.length > 0)
  ) {
    /*
     * APPENDED TO THE KNOWN SET AS WE GO, which is the one thing the writers
     * cannot do for themselves. `boardTools` resolves a connection's endpoints
     * out of `known.items`, so a round that draws two cards and then connects
     * them would have its own connect refused if the set were only refreshed
     * between turns. The agent that built the module flagged exactly this.
     */
    if (result.boardRemoveIds && result.boardRemoveIds.length > 0) {
      const drop = new Set(result.boardRemoveIds);
      sink.boardKnown.value.items = sink.boardKnown.value.items.filter((i) => !drop.has(i.id));
    }
    for (const item of result.boardItems ?? []) {
      const at = 'at' in item ? item.at : undefined;
      sink.boardKnown.value.items = [
        ...sink.boardKnown.value.items,
        at ? { id: item.id, at } : { id: item.id },
      ];
    }
    if ((result.boardItems ?? []).length > 0) {
      sink.artefactsThisTurn.value.push({
        kind: 'board',
        label: String((result.boardItems ?? []).length),
      });
    }
    push({
      type: 'board:item',
      items: result.boardItems ?? [],
      ...(result.boardRemoveIds && result.boardRemoveIds.length > 0
        ? { removeIds: result.boardRemoveIds }
        : {}),
    });
  }
  if (result.walk) {
    /* The picture is already on the canvas and the ids were checked against
       it; this is the story that moves across it. */
    push({ type: 'teach:walk', input: result.walk.input, steps: result.walk.steps });
  }
  if (result.goalPlan) {
    sink.goalPlan.value = result.goalPlan;
    /*
     * A TICKED STEP IS ADVANCEMENT, on exactly the terms a completed todo is —
     * see `todoAdvanced` below. A round that finished a step of the JOB got
     * somewhere whatever the evidence ledger thinks, and the unproductive-round
     * rule must not cut a turn that is working the plan down.
     *
     * Compared by count of `done` rather than by `writePlan` having been
     * called: writing a plan is not doing any of it, and a model that could buy
     * rounds by rewriting its plan would rewrite it every round.
     */
    const wasDone = priorGoalPlan.filter((s) => s.status === 'done').length;
    const nowDone = result.goalPlan.filter((s) => s.status === 'done').length;
    if (nowDone > wasDone) sink.todoAdvanced.value = true;
  }
  if (result.todos) {
    sink.todos.value = result.todos;
    /* Only a step reaching `done` counts as advancement — writing the list down
       is not the same as doing any of it. `diffTodos` refuses to count a row
       moving backwards, so rounds cannot be bought by toggling one. */
    if (diffTodos(priorTodos, result.todos).advanced) sink.todoAdvanced.value = true;
    push({ type: 'todo:list', items: result.todos });
  }
  if (result.canvasBlock) {
    sink.canvasWriteSucceededThisTurn.value = true;
    if (countsAsTeachDrawing(tr.name)) sink.teachCanvasDrawingThisTurn.value = true;
    sink.artefactsThisTurn.value.push({
      kind: 'canvas',
      label: result.canvasBlock.title
        ? `${result.canvasBlock.title} (${result.canvasBlock.type})`
        : result.canvasBlock.type,
    });
    push({
      type: 'canvas:block',
      id: result.canvasBlock.id,
      blockType: result.canvasBlock.type,
      ...(result.canvasBlock.title ? { title: result.canvasBlock.title } : {}),
      payload: result.canvasBlock.payload,
      status: 'live',
      /* On a planning turn the Plan tab is the default: measured live, the model
         drew a chart for the plan and named no tab, and it landed on the scratch
         canvas where the plan's reader was not looking. */
      ...((result.canvasBlock.surface ?? (sink.input.planning === true ? PLAN_SURFACE : undefined))
        ? { surface: result.canvasBlock.surface ?? PLAN_SURFACE }
        : {}),
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
            (tr.name === 'read_topology'
              ? 'For more of a service, add a `module` id from the modules it listed; '
              : 'To see more of a large file, call read_file again with a different "offset"; ') +
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
  /** Prior chat lines; read only by a product-mode teach turn (SEQUENCE_TEACH_PRODUCT_MODE). */
  historyLines?: readonly string[];
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
  /*
   * ON THE HASH INPUT because it CHANGES THE BELT: with a workspace present and
   * no repo, `renderAskInstructionBelt` adds the workspace section naming the
   * four tools that work there. A belt fragment that can appear must change the
   * hash by construction rather than by anyone remembering to — the same rule
   * `teachContext` and `proposeArchitecture` are on this interface for.
   */
  workspaceRoot?: string | null;
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
  /**
   * The repository part the teach belt's closing example names
   * ({@link teachExampleLabel}). On the hash input because it changes the belt.
   */
  teachExampleLabel?: string;
  /** Teach Mode (docs/teach-mode.md): one concept, one visual, one check-in per turn. */
  teach?: boolean;
  /**
   * A `/plan` turn (planTurn.ts): the planning guidance joins the belt, the
   * canvas writers are offered, and up to PLANNING_CANVAS_WRITES blocks may
   * land instead of one. On the hash input because it changes the belt.
   */
  planning?: boolean;
  permission?: string;
  surface?: AskSurfaceContext;
  question: string;
}

/* `isArchitectureDesignAsk` lives in askIntent.ts (explain.ts needs it too);
   re-exported here so the route and the tests keep their import. */
export { isArchitectureDesignAsk } from './askIntent.js';

/**
 * THE SUBSTITUTION, not a note appended under the design brief.
 *
 * This tree's own record is explicit about the mechanism: a prompt law is
 * REMOVED for the mode it is wrong for, never argued with from a later line —
 * an appended counter-instruction measured 0 of 1, the substitution 3 of 3. So
 * on an explanatory home-workspace turn the architecture section is not
 * rendered at all and this stands in its place.
 *
 * LOCAL-FIRST IS PART OF THE INSTRUCTION because the ask that produced it was
 * "using visuals in 3D": the honest way to draw that here is inline SVG/CSS in
 * an html or react block. The frame has a unique opaque origin and
 * `default-src none`, so a remote three.js tag does not fail loudly — it
 * renders an empty box.
 */
const HOME_WORKSPACE_CANVAS_SECTION =
  '--- HOME WORKSPACE (binding) ---\n' +
  'This is the home workspace and this ask is an EXPLANATION, not a system to design: ' +
  'draw with the AI Canvas tools — a `canvas.write_mermaid` or `canvas.write_svg` block for a ' +
  'diagram, `canvas.write_markdown` for prose, `canvas.write_html` or `canvas.write_react` for ' +
  'something the reader can move — not an architecture proposal unless they asked for one. ' +
  'Do NOT state numbered design assumptions, do NOT name modules by role (Input Handler, ' +
  'Processing Engine, Output Layer), do NOT call `propose_topology` and do NOT emit a seqd fence. ' +
  'An html or react block has NO NETWORK (unique opaque origin, default-src none): build a 3D or ' +
  'animated picture from inline SVG, CSS transforms and inline script, and never load a remote ' +
  'script or font. Write the explanation in plain English beside the picture, never instead of it.';

/**
 * THE ASK THIS PRODUCT EXISTS FOR, FINALLY ALLOWED TO DRAW.
 *
 * Paired with the `isExplainFileAsk` arm of `canvasToolsEnabled`: the tools
 * and the instruction arm together or not at all. Grounding is restated inside
 * the section rather than left to the base prompt, because a DIAGRAM is the
 * shape an invention hides best — a box labelled "Cache" in a picture reads as
 * a finding, while the same word in a sentence would have wanted a path.
 */
const EXPLAIN_ON_CANVAS_SECTION = [
  '--- EXPLAIN IT ON THE CANVAS (binding) ---',
  'This ask names a file or a symbol of the attached repository. A wall of prose is not the answer to it: draw the thing, then explain the drawing.',
  'READ IT FIRST. Call `read_file`, `locate_symbol` or `who_calls` and build the picture out of what actually came back. A diagram of what a file with that name USUALLY contains is the one failure this section exists to prevent.',
  'Then write AT LEAST ONE canvas block: `canvas.write_mermaid` for the flow through it (what calls it, what it calls, what it returns, where it fails), or `canvas.write_svg` when the honest picture is spatial — layers, boundaries, a shape with labels.',
  'EVERY NODE MUST BE A REAL NAME you read — a file, an exported symbol, a module. No placeholder boxes (Input, Processing, Output), no invented helpers.',
  'Cite `path:line` in the prose for each claim about behaviour, exactly as you would without a picture. The block does not lower the evidence bar; it raises it, because a drawing looks more certain than a sentence.',
  'If you could NOT read the file — wrong path, not in the scan, refused — say that plainly and draw NOTHING. An empty canvas is honest; a guessed diagram is not.',
  'Beside the picture, in plain English: what the file is for, what it owns that nothing else does, and the one thing a reader would get wrong about it.',
].join('\n');

/**
 * BLOCK CRAFT — twelve lines, and every one of them is a choice the model was
 * making blind.
 *
 * Twelve because this rides on EVERY canvas turn, and this belt's own measured
 * lesson (see `renderAskInstructionBelt`) is that the tools section was the
 * single largest removable piece of a first-tier ask. A craft section that grew
 * to forty lines would be that defect wearing a better name.
 */
const CANVAS_BLOCK_CRAFT_SECTION = [
  '--- CANVAS BLOCK CRAFT (binding) ---',
  'Pick the kind by the ask: `mermaid` for a flow, a sequence or a state machine; `svg` for a spatial diagram whose labels you place yourself; `html` or `react` for anything that MOVES or that the reader can drive; `markdown` for prose, lists and maths.',
  'ONE IDEA PER BLOCK. Two diagrams in one block is one block nobody can point at — write two, each with its own `title`.',
  'EVERY BLOCK GETS A `title`. It names the block in the reader\'s navigator and it is the only handle a follow-up has.',
  'AT MOST 8 NODES in a diagram. Past that, draw the layer above it and write a second block for the part that needs the detail.',
  /* Rewritten 2026-09-22, measured live: "LABEL EVERY EDGE" was obeyed to the
     letter — fourteen arrows each labelled "import" on one diagram, 1,854px
     wide, which the owner could not read. A label that says nothing the arrow
     does not is noise; one repeated on every edge is slop. */
  'LABEL AN EDGE when the label says something the arrow does not (`POST /api/ask`, `writes rows`, `on failure`). If every edge would carry the same word, label none of them.',
  'NODE LABELS ARE PLAIN WORDS, two to five of them: `Analyzer engine`, not `svc:analyzer`. Ids belong to the architecture board, not to a picture. ' +
    'Lay flows out top to bottom (`flowchart TD`) so the drawing fits the pane; a left-to-right chain of ten boxes is wider than any pane it lands in.',
  'MOTION IS ALLOWED, AND OFTEN BETTER THAN A STILL: animate with CSS `@keyframes` in an inline `<style>`, or with SVG `<animate>` / `<animateTransform>` written inline in the markup. Both run today, in `html`, `react` and `svg` blocks alike. ' +
    'Keep one animation cycle under about 4 seconds and let it loop. Motion a reader has to wait out is worse than a picture that just sits there.',
  'NO EXTERNAL ANYTHING — no remote `<script>`, no CDN library, no web font, no `fetch`, no XHR. The frame has a unique opaque origin and `default-src \'none\'`, so a remote resource does not fail loudly: it renders an EMPTY BOX and the reader is told nothing went wrong.',
  'Colour from the Graphite variables — `var(--ink-1)`, `var(--ink-2)`, `var(--accent)`, `var(--surface-1)` — so the block matches the theme the reader is actually in, light or dark. ' +
    'Text must be legible at the size the block lands: nothing below 12px, and never assume a background you did not set yourself.',
  'Say in prose what the picture cannot. The picture carries the structure; the sentence carries the claim and where it came from.',
  /* Measured live: a longer version of this line, about telling your own
     block from an earlier one, was repeated word for word as the answer. A
     small model echoes an instruction phrased about its own output; this one
     asks only for the sentence. */
  'After you draw, say in one sentence what the drawing shows.',
].join('\n');

/**
 * Instruction belt appended after the base ask prompt: tool hints, optional
 * canvas hints, and plan-mode instructions — not the user question or digest.
 */
export function renderAskInstructionBelt(input: AskInstructionHashInput): string {
  const parts: string[] = [];
  if (input.planning === true) parts.push(PLANNING_GUIDANCE.join('\n'));
  const teaching = isTeachTurn(input);
  const canvasOn = canvasToolsEnabled(input);
  const plotAsk = isPlotOrMathDrawAsk(input.question);
  /*
   * Plot/math asks still classify as `draw`, but they must NOT arm the
   * whiteboard / diagram.upsert belt — that is what turned "draw a parabola"
   * into invented service modules on Architecture (owner walk 2026-09-15).
   */
  /* Loose board marks only where they fit — see `boardMarksFit` (owner photo,
     2026-09-22: a "flow chart on the ai canvas" drawn as two specks and a line). */
  const boardOn = !plotAsk && boardMarksFit(input.question, input.surface?.id);
  const drawingTurn = canvasOn || boardOn || plotAsk;
  /*
   * THE BLANK WORKSPACE, SPLIT IN TWO. Design mode with no repository is the
   * home workspace, and the two people who open it want opposite things: one
   * is designing a system, the other wants something explained.
   * `homeCanvasAsk` is the second, and it is what removes the architecture
   * section below.
   */
  const homeWorkspace = input.designMode === true && !input.repoRoot;
  const homeCanvasAsk =
    homeWorkspace && !teaching && !plotAsk && !isArchitectureDesignAsk(input.question);
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
        renderAskToolHintSection(input.jobMode, input.permission, {
          teach: teaching,
          deferMcpHints: drawingTurn,
          plot: plotAsk,
          proposeNow: input.planning === true,
        }).join('\n'),
      );
    }
  } else if (input.repoRoot == null && input.workspaceRoot != null) {
    /*
     * NO REPOSITORY, BUT A REAL FOLDER OF ITS OWN.
     *
     * Before this, a General chat's answer to "save that as notes.md" was
     * `refused: propose_files needs an attached repo`. The refusal was correct
     * about repositories and wrong about the product: local-first is the first
     * law, and the commonest thing anyone wants from a local assistant is
     * somewhere to keep work.
     *
     * NAMED AS NOT-A-REPOSITORY in its own first line, because the risk of
     * handing file tools to a repo-less turn is a model that reads `notes.md`
     * off disk and is one sentence away from describing "the repository".
     */
    parts.push(renderWorkspaceToolHintSection());
  } else if (input.designMode && !teaching && !plotAsk && !homeCanvasAsk) {
    /*
     * ALSO SKIPPED ON AN EXPLANATORY HOME-WORKSPACE ASK — see `homeCanvasAsk`
     * above and `HOME_WORKSPACE_CANVAS_SECTION`, which takes its place below.
     * This section IS the propose_topology grammar; handing it to somebody who
     * asked to be shown how a thing works is how "explain LLMs" came back as a
     * design brief (owner walk, 2026-09-17).
     *
     * THE DESIGN TOPOLOGY HINT IS SKIPPED ON A LESSON, because its SECOND LINE
     * is "ask ONE short clarifying question in chat first: compact overview or
     * detailed diagram", and it names `propose_topology` — a tool teach mode
     * refuses. Composed with the teach contract's "NEVER ask the learner which
     * chart kind, which format … or what level of detail", the belt both
     * ordered and forbade the interrogation the owner actually got back on
     * 2026-09-02. The chart section below is a lesson's drawing hint.
     *
     * Also skipped on plot/math asks — those must not advertise Architecture IR.
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
  /*
   * OUTSIDE THE CHAIN ABOVE ON PURPOSE. That chain's second arm fires for any
   * repo-less turn that has a workspace folder, so a home-workspace ask may
   * never reach the design arm at all and a substitution written as its
   * `else` would render on nothing. The rule is about the WORKSPACE, not
   * about which tool-hint arm won.
   */
  if (homeCanvasAsk) {
    parts.push(HOME_WORKSPACE_CANVAS_SECTION);
  }
  /*
   * CHARTS ON EVERY TURN THAT CAN DRAW — not only teach. AI Canvas and drawish
   * questions need the same worked `propose_chart` fence the lesson contract
   * already carried; line charts belong in artifact blocks, not SeqDraw.
   * Plot/math asks get the same section even when the board belt is off.
   */
  if (canvasOn || plotAsk) {
    parts.push(renderChartToolHintSection().join('\n'));
    parts.push(
      'Line charts: use `propose_chart` with kind `"line"` — Sequence renders it as an artifact block beside chat, not on SeqDraw or the whiteboard.',
    );
    if (plotAsk) {
      parts.push(
        '--- PLOT / MATH DRAW (binding) ---\n' +
          'The user asked for a math plot, curve, or chart — NOT repository architecture. ' +
          'Call `propose_chart` (prefer kind `"line"` for y=f(x) / parabola / sine). ' +
          'Do NOT call `propose_topology` or `diagram.upsert` — those invent service modules on the Architecture board.',
      );
    }
  }
  /* A teach turn owes ONE visual per concept and the beat AFTER the picture. */
  if (teaching) {
    parts.push(renderWalkToolHintSection());
  }
  if (canvasOn) {
    parts.push(renderCanvasToolHintSection().join('\n'));
    /*
     * HOW TO DRAW, NOT ONLY WHAT TO CALL IT WITH.
     *
     * The section above is a SYNTAX reference: five names, a fence, and the
     * rule about `blockId`. Measured on 2026-09-18
     * (`docs/research/ai-canvas-moat-audit.md` section b) there was nothing
     * anywhere in the belt about which writer fits which ask, how big a
     * diagram may get, or that motion is legal at all — and
     * `canvas.write_svg`'s entire schema description was the four words
     * "SVG markup (no script)".
     *
     * THE MOTION LINE IS THE ONE THAT PAYS FOR ITSELF. The sandbox has
     * permitted CSS @keyframes and SVG <animate> since scripts were allowed
     * in (`web2/src/app/aiCanvasViewers.ts` — style-src 'unsafe-inline', and
     * an SVG block is inlined outside the frame altogether), and NOTHING said
     * so, so the model had no reason to try. The network half is stated in
     * the same breath because that failure is SILENT: a remote script or font
     * under default-src 'none' does not error, it renders an empty box, and
     * the reader is told nothing.
     */
    parts.push(CANVAS_BLOCK_CRAFT_SECTION);
    /*
     * ONLY WITH A REPOSITORY. The section orders `read_file` / `locate_symbol`
     * and demands `path:line` citations; handing it to a repo-less turn would
     * order tools that are refused and evidence that does not exist — the
     * belt-fights-itself shape recorded twice already in this file.
     */
    if (input.repoRoot && !input.designMode && isExplainFileAsk(input.question)) {
      parts.push(EXPLAIN_ON_CANVAS_SECTION);
    }
  }
  /*
   * THE WHITEBOARD'S WRITERS, on the turns that can reach it.
   *
   * Gated on the surface rather than offered everywhere. The board is one tab
   * of six, and a belt advertising four tools whose result the person is not
   * looking at spends tokens on every turn to produce a drawing nobody sees —
   * the measurement that put the TOOLS section behind a flag, applied to a
   * smaller section. `isDrawishAskQuestion` is the second door, for "sketch
   * this out" asked from anywhere.
   */
  if (boardOn) {
    parts.push(renderBoardToolHintSection());
    parts.push(['--- SYSTEM BOARD (SeqDraw structured) ---', ...diagramToolsPromptBlock()].join('\n'));
  }
  if (drawingTurn) {
    parts.push(ASK_DRAWING_PREFER_NATIVE_TOOLS_LINE);
    parts.push(...ASK_MCP_TOOL_HINT_LINES);
  }
  if (input.permission === 'plan') {
    parts.push(`--- PLAN MODE ---\n${PLAN_MODE_INSTRUCTIONS}`);
  }
  if (isTeachTurn(input)) {
    const lessonCtx: TeachTurnContext | undefined = isRootOverviewTurn(
      input.teachContext,
      input.question,
    )
      ? { ...(input.teachContext ?? {}), rootOverview: true }
      : input.teachContext;
    const teachCtx: TeachTurnContext | undefined =
      input.teachExampleLabel !== undefined
        ? { ...(lessonCtx ?? {}), exampleLabel: input.teachExampleLabel }
        : lessonCtx;
    parts.push(
      `--- TEACH MODE (binding contract) ---\n${renderTeachModeInstructions(teachCtx)}`,
    );
    if (teachProductTurn(input)) {
      const readme = productReadmeInlineEnabled() ? readProductReadme(input.repoRoot) : undefined;
      parts.push(renderProductQuestionInstructions(input.historyLines, readme));
    }
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

/**
 * ASK FOR A VISUAL, NOT A BOX CHART, and draw it ourselves.
 *
 * Owner, 2026-09-13: a teach turn about how an LLM works drew three boxes and
 * his answer was "the drawings are horrible". `drawFromGeneralKnowledge` below
 * is the box-chart floor and stays as the fallback; this is tried FIRST,
 * because five of the six references he supplied carry DATA — a matrix of
 * numbers, a token sequence, a value threaded down a stack — and a node-link
 * chart can only carry labels. See
 * `docs/research/agent-drawing-and-teaching-visuals.md`.
 *
 * THE DIVISION OF LABOUR IS THE ONE THIS TREE ALREADY SETTLED: the model
 * supplies the DATA, `visuals.ts` draws the PIXELS. A model that can write a
 * JSON array can produce an attention matrix; none of them reliably produces
 * good SVG, and the builders refuse any spec they cannot draw honestly rather
 * than padding it.
 *
 * ONE CALL, AND A REFUSAL IS FREE. Every failure path returns undefined and the
 * caller falls through to the chart it already had, so a subject with no good
 * visual costs one call and loses nothing.
 */
export async function drawTeachingVisual(
  subject: string,
  call: AskPipelineInput['callProvider'],
  cfg: AiConfig,
): Promise<{ payload: string; title: string } | undefined> {
  const prompt =
    `You are drawing ONE picture that teaches "${subject}".\n\n` +
    'Pick the shape that actually carries the idea, then give its DATA as JSON. ' +
    'Reply with JSON only — no prose, no code fence.\n\n' +
    'token-strip — a sequence in reading order where the mapping is the lesson:\n' +
    '{"kind":"token-strip","title":"<short>","tokens":[{"label":"Data","id":5178}]}\n\n' +
    'matrix — a grid of REAL numbers; use null for a cell that is masked or absent:\n' +
    '{"kind":"matrix","title":"<short>","axes":{"rows":"Query","cols":"Key"},' +
    '"rows":["a","b"],"cols":["a","b"],"values":[[7.4,null],[2.1,6.8]]}\n\n' +
    'layered-stack — blocks with ONE value threaded through them, repeated N times:\n' +
    '{"kind":"layered-stack","title":"<short>","carries":"hidden state",' +
    '"layers":[{"label":"Self-attention","detail":"<one clause>"}],' +
    '"repeat":{"fromIndex":0,"toIndex":0,"times":12}}\n\n' +
    'annotated-flow — stages where what travels BETWEEN them is the lesson:\n' +
    '{"kind":"annotated-flow","title":"<short>",' +
    '"stages":[{"label":"Browser","note":"<one clause>"},{"label":"API"}],' +
    '"edges":[{"carries":"the typed question","shape":"JSON, ~40 bytes"}]}\n' +
    'edges has EXACTLY one fewer entry than stages — an edge sits between two of them.\n\n' +
    'Rules: real numbers, not placeholders — approximate ones honestly if you must, but they ' +
    'must be plausible for the subject. A matrix is at most 12 by 12 and every row must have ' +
    'exactly as many entries as there are columns. If none of these four shapes fits the ' +
    'subject, reply exactly: none';

  let raw: string;
  try {
    const out = await call(cfg, prompt, undefined, {});
    raw = String((out as { text?: unknown }).text ?? '');
  } catch {
    return undefined;
  }
  if (/^\s*none\s*$/i.test(raw)) return undefined;

  /* A fenced block is the commonest wrapper even when prose is forbidden. */
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  let spec: unknown;
  try {
    spec = JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (spec === null || typeof spec !== 'object') return undefined;

  const payload = drawVisual(spec as VisualSpec);
  if (payload === null) return undefined;
  const title = typeof (spec as { title?: unknown }).title === 'string'
    ? (spec as { title: string }).title
    : subject;
  return { payload, title };
}

export async function drawFromGeneralKnowledge(
  subject: string,
  call: AskPipelineInput['callProvider'],
  cfg: AiConfig,
): Promise<SeqChart | undefined> {
  /*
   * THE SHAPE IS CHOSEN FOR THE SUBJECT, NOT FIXED AT THE WEAKEST ONE.
   *
   * This prompt used to hard-code `"kind":"data-flow"` and "3 to 6 items", and
   * that pair is the entire explanation for the drawing the owner rejected on
   * 2026-09-13: he asked how an LLM works and got three boxes — Composer,
   * Ask pipeline, Provider — because the product asked for three boxes.
   * `schema/chart.ts` declares FORTY kinds across eight families, each with a
   * real renderer in web2/src/charts, and the drawer offered one of them.
   *
   * A transformer is a STACK of repeated blocks, so it wants `layer`; a
   * mechanism with stages wants `how-it-works`; an idea with parts that relate
   * rather than flow wants `concept-map`. Naming a short list and letting the
   * subject pick is the cheapest way to stop drawing a pipeline for everything.
   *
   * THE LIST IS CLOSED AND SPELLED OUT rather than "any valid kind". Measured
   * and recorded in schema/chart.ts: a refusal that names the offending value
   * and not the admissible set makes the model guess, and it guesses the same
   * way twice. Eight names it can copy beats forty it has to recall.
   *
   * 4 to 12 items, not 3 to 6. Six was below the number of parts most subjects
   * have, so the cap was doing the simplifying rather than the subject.
   * `docs/research/agent-drawing-and-teaching-visuals.md` carries the rest:
   * this is stage 1 of four, and it is the only stage that is purely a defect.
   */
  const prompt =
    `Draw ONE diagram that EXPLAINS "${subject}" from general knowledge — its real parts and ` +
    'how they relate.\n\n' +
    'Reply with JSON only, no prose and no code fence, in exactly this shape:\n' +
    '{"kind":"<one of the kinds below>","title":"<short title>",' +
    '"items":[{"id":"a","label":"<part>"}],"links":[{"from":"a","to":"b"}]}\n\n' +
    'Choose the kind that matches the SUBJECT, not the first one listed:\n' +
    '  how-it-works  — a mechanism with ordered stages\n' +
    '  layer         — a stack of repeated or nested levels (e.g. a transformer)\n' +
    '  progression   — stages that build on each other\n' +
    '  data-flow     — something moving between parts\n' +
    '  concept-map   — ideas that relate without flowing\n' +
    '  hierarchy     — parts that contain other parts\n' +
    '  cause-and-effect — one thing producing another\n' +
    '  feedback-loop — a cycle that returns to its start\n\n' +
    'Rules: 4 to 12 items — enough to be true to the subject; every link\'s from/to must be ' +
    'an id in items; labels are plain English names for the parts. Do NOT include a "nodeId" on ' +
    'any item — this diagram is about the idea, not about any repository.';
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
 * mode the same way an edit turn that edits nothing fails Build.
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

/**
 * THE TWO PACING BULLETS, named so the root-overview turn can swap them.
 *
 * Owner, 2026-09-22: "when I ask to teach it … dive into what that means at
 * root … explain all the working components that are supplementary". A learner
 * who knows nothing yet needs the whole flow named before one part of it means
 * anything, and these two bullets asked for the opposite on exactly that turn.
 * They stay the rule for every later turn, byte for byte.
 */
const TEACH_ONE_CONCEPT_BULLET =
  '- Deliver EXACTLY ONE concept this turn, in at most ~150 words of plain prose.\n';
const TEACH_NO_OUTLINE_BULLET =
  '- NEVER advance to a second concept in the same turn. NEVER dump an outline of ' +
  'everything you plan to cover — the lesson unfolds turn by turn.\n';

/**
 * THE FIRST TURN OF A LESSON IS THE ROOT OVERVIEW (2026-09-22).
 *
 * Written as what is wanted rather than what is forbidden: a small local model
 * reads guidance as rules, and the rules it read before were "one concept, 150
 * words, no outline" on the turn where the learner asked for the whole picture.
 * The word range is the grader's too (`gradeTeachTurn`, overview ceiling 400).
 */
export const TEACH_ROOT_OVERVIEW_BULLET =
  '- THIS TURN IS THE ROOT OVERVIEW, because the learner is starting from the top. Explain ' +
  'how the whole thing works at the root: name every component involved and every hop ' +
  'between them, in the order the data moves ("the request arrives at A, A hands it to B, ' +
  'B writes it to C"), in plain words, in about 250-350 words. Use each component’s real ' +
  'label from this repository, so the flow you draw matches the words. Then name the first ' +
  'concept you will go into next turn, and close with a check-in question about the flow ' +
  'you just laid out.\n';
const TEACH_LATER_TURNS_BULLET =
  '- From the next turn on, the lesson goes one concept per turn, about 150 words each, ' +
  'starting with the concept you named at the end of this overview.\n';

export const TEACH_MODE_INSTRUCTIONS =
  'You are TEACHING, one step at a time, over a live architecture board the learner can see.\n' +
  TEACH_ONE_CONCEPT_BULLET +
  '- Ground the concept in THIS repository: name the real node/file (exact label) the ' +
  'concept lives in, and cite real evidence (file:line) when you make a claim. ' +
  /* 2026-09-23: `/api/ask` in two finals and two drafts, in no file (`groundRoutes`). */
  'Name only routes the evidence shows; the scan lists the real ones.\n' +
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
  '"); you can also invite them to draw it on the board.\n' +
  /* Rewritten 2026-09-22, measured live: the example used to name "the auth
     service", and both Teach-off runs on ML Harness — which has none — ended
     with it word for word. The example is now built from this repository
     (`teachPredictionExample`), and this line asks for the lesson's own part. */
  '- Name the real component in that question: the part of THIS repository the lesson ' +
  'is about, by its own label. A closing question that still carries a placeholder where ' +
  'the name belongs is not one the learner can answer, and does not count as a check-in.\n' +
  '- NEVER ask a CLARIFYING question — not one, not at the open, not mid-lesson, not at the ' +
  'close. A clarifying question asks the learner to choose the scope, pick a direction, name ' +
  'a format, or supply something you could look up yourself. THE TEST: if their answer would ' +
  'change what you do next, it is clarifying and it is banned; if it only reveals whether ' +
  'they followed you, it is a comprehension check and it is wanted. "Shall we look at why the ' +
  'scanner does this ahead of time?" offers the next step of a lesson already underway and is ' +
  'fine. "Would you like the architecture view or the data view?" makes them do your job.\n' +
  TEACH_NO_OUTLINE_BULLET +
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
  /**
   * This turn is the lesson's root overview — see {@link isRootOverviewTurn}.
   * Set by the pipeline from the context AND the question, which is why it is a
   * field rather than something the renderer works out: the renderer never sees
   * the question, and a context with nothing in it still renders the constant.
   */
  rootOverview?: true;
  /**
   * A real part of the attached repository for the closing prediction example
   * to name ({@link teachExampleLabel}). Absent with no graph, and the example
   * then names no component at all.
   */
  exampleLabel?: string;
  /**
   * The harness gathered this turn's evidence before the first call
   * (`gatherTeachEvidence`, 2026-09-23). Set by the pipeline only when the
   * section is non-empty, so the rule never points at a section that is absent.
   */
  evidence?: true;
}

/**
 * THE PART THE CLOSING EXAMPLE NAMES (2026-09-22): the first scanned service
 * with an outgoing edge, so "hands off to next" is true of it; the first
 * service when none has one; nothing when there is no graph.
 */
export function teachExampleLabel(graph: ArchGraph | null | undefined): string | undefined {
  if (!graph) return undefined;
  const services = graph.nodes.filter((n) => n.kind === 'service' && n.label.trim() !== '');
  const sources = new Set(graph.edges.filter((e) => e.srcId !== e.dstId).map((e) => e.srcId));
  return (services.find((n) => sources.has(n.id)) ?? services[0])?.label;
}

/**
 * THE ROOT OVERVIEW TURN (2026-09-22).
 *
 * The first turn of a lesson (nothing taught, nothing open, not finished), a
 * learner who pressed "new to this", or a question that asks for the root, how
 * it works, or a breakdown. One predicate, read by the belt AND the grader, so
 * the turn that is asked for 250-350 words is never bounced for passing 250.
 */
const ROOT_OVERVIEW_ASK =
  /\b(?:at\s+(?:the\s+)?root|root\s+(?:flow|level|of)|how\s+(?:\w+\s+){0,4}works?\b|break\s+(?:\w+\s+){0,3}down|breakdown|big\s+picture|overview|end[\s-]to[\s-]end|from\s+the\s+top)/i;

export function isRootOverviewTurn(ctx: TeachTurnContext | undefined, question: string): boolean {
  if (ctx?.known === 'new') return true;
  if (ROOT_OVERVIEW_ASK.test(question)) return true;
  return (
    (ctx?.taught ?? []).length === 0 && ctx?.open === undefined && ctx?.lessonDone === undefined
  );
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

/*
 * ══ A PRODUCT QUESTION GETS THE PRODUCT, NOT THE FILE MAP (2026-09-24) ═══════
 *
 * Owner's session on the ML Harness repo: "what is ml harness, what does it do,
 * what is the product, whats the actual product flow" was asked three times and
 * answered three times with the same services-and-files topology, twice nearly
 * word for word, with a file-import chart and a quiz about which file hands off
 * next. Nothing in the teach contract has a newcomer's shape for "what is this
 * product", and nothing stopped an answer being sent again.
 *
 * On by default since blind check 4 (2026-09-24; SEQUENCE_TEACH_PRODUCT_MODE=0 turns it off): a teach turn whose
 * question asks what the product is, why it exists, how it works or what its
 * advantages are gets the shape below, reads the README and docs before the
 * topology, draws the product flow as concepts rather than files, and is shown
 * the start of its own last answer so it does not send it again. The file-chart
 * floor and the derived file check-in stay out of such a turn.
 */
/*
 * RECOGNISER v2 (2026-09-24). v1 was fitted to the owner's three questions and
 * fired on 5 of 24 questions in a sealed blind set: "whats shopfront? is it a
 * real store", "what's the point of it existing", "who is this for" all missed.
 * Wider: what/who/why/point/problem/versus-questions about the thing itself.
 * And STICKY: once a conversation has asked a product question, its follow-ups
 * ("show that on the canvas", "walk me thru what happens") stay in product mode,
 * until a question names a file.
 */
const PRODUCT_QUESTION = new RegExp(
  [
    String.raw`\bwhat(?:'s|s| is| does| do)\b[^?.!]{0,40}\b(?:product|app|this|it|thing|tool)\b`,
    String.raw`\bwhat(?:'s|s| is| are)\s+(?!the\b|a\b|an\b)[a-z][\w-]*\s*(?:\?|$|,|and\b|for\b)`,
    String.raw`\bwho\b[^?]{0,30}\b(?:for|use|uses|using)\b`,
    String.raw`\b(?:point|purpose) of\b`,
    String.raw`\bwhat problem\b`,
    String.raw`\bwhy (?:would|should|do|does) (?:i|you|anyone|someone|it|this)\b`,
    String.raw`\bwhy (?:does )?(?:it|this|the app) exi\w*`,
    String.raw`\b(?:instead of|over|vs\.?|versus) (?:just )?(?:asking|using|a normal|chatgpt|an? )`,
    String.raw`\bthe (?:actual )?(?:product|app)\b`,
    String.raw`\bproduct flow\b`,
    String.raw`\badv\w{0,4}ages?\b`,
    String.raw`\baway from the (?:actual )?(?:files|code)\b`,
    String.raw`\bis it an? (?:real|product|tool|demo|training|learning)\b`,
    String.raw`\bexplain (?:it )?like i'?m\b`,
    /* v3 (2026-09-24, from the 9 misses in sealed bank 6): the reader's own words for the product. */
    String.raw`\bthis (?:product|tool|project|shop|store|app)\b`,
    String.raw`\bwhat (?:the |a )?(?:user|you|people|customers?|person) (?:is |are )?(?:get|gets|getting|receive|receives|receiving|end up with)\b`,
    String.raw`\bwhat (?:this|it|the) [\w-]+ does\b`,
    String.raw`\bwhy (?:anyone|anybody|someone|people) would\b`,
    String.raw`\b(?:stack up|compare[sd]?|comparison) (?:against|to|with)\b|\bhow (?:does )?(?:it|this)s? compare`,
    String.raw`\bworth (?:building|using|it|learning|my time|the time)\b`,
    String.raw`\bsumm?ari[sz]e what (?:it|this) is\b|\bend result\b`,
    String.raw`\bstages? (?:a|the) (?:user|person) goes? through\b|\bsteps? (?:a|the) (?:user|person) (?:goes|takes)\b`,
    String.raw`\b(?:useful|usefull|good) for (?:me|us|my|a )\b`,
  ].join('|'),
  'i',
);
/** A question that names a file or code is about code, whatever else it says. */
const NAMES_CODE = /`[^`]+`|\b[\w-]+\.(?:py|ts|tsx|js|jsx|go|java|rs|json|toml|ya?ml|mjs|cjs)\b/i;

/** Words and word pairs, as the classifier was trained on them. */
export function productQuestionTokens(q: string): string[] {
  const w = q.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [...w];
  for (let i = 0; i + 1 < w.length; i++) out.push(`${w[i]}_${w[i + 1]}`);
  if (/\b[\w-]+\.(py|ts|tsx|js|go|java|rs|json)\b|`|\(\)/.test(q)) out.push('__codeish');
  return out;
}

/**
 * Naive Bayes log-odds that a question asks about the product, not the code
 * (2026-09-24). The patterns reach 15 of 30 sealed held-out product questions; the
 * classifier reaches 23, and both together 26, with 0 of 30 code questions caught.
 * The threshold was picked on training folds (at most 1% code false hits).
 */
export function productQuestionScore(question: string): number {
  const m = PRODUCT_QUESTION_MODEL as unknown as {
    docs: { product: number; code: number };
    n: { product: number; code: number };
    V: number;
    product: Record<string, number>;
    code: Record<string, number>;
  };
  let s = Math.log(m.docs.product / m.docs.code);
  for (const t of productQuestionTokens(question)) {
    s += Math.log(((m.product[t] ?? 0) + 1) / (m.n.product + m.V)) - Math.log(((m.code[t] ?? 0) + 1) / (m.n.code + m.V));
  }
  return s;
}

/**
 * Words that put a pattern hit back on the code side (2026-09-24). "What does the app do
 * when the user loses connection, where is that handled in the code" matched the
 * patterns. On sealed set 10 this cut code false hits from 16 to 11 of 40, with product
 * recall still 35 of 40. It applies to the patterns only; the classifier still decides.
 * "library" and "codebase" stay out: product questions use them too.
 */
const PATTERN_CODE_VETO =
  /\b(?:in the code|folder|modules?|package|build (?:setup|step|script)|services?|layer|handled|handler|frontend|backend|query|queries|debounce|config|function|method|endpoint|fixture|hook|middleware|schema|migration|regex|environment variables?|entry point|makefile|dockerfile|pre-commit)\b|^\s*where(?:'s| is| does| do)?\b|\b[a-z]+_[a-z_]+\b|\.[A-Z]{2,}\b/i;

export function isProductQuestion(question: string): boolean {
  if (NAMES_CODE.test(question)) return false;
  if (PRODUCT_QUESTION.test(question) && !PATTERN_CODE_VETO.test(question)) return true;
  return process.env.SEQUENCE_TEACH_PRODUCT_CLASSIFIER !== '0' && productQuestionScore(question) > PRODUCT_QUESTION_MODEL.threshold;
}

const POINTS_AT_REPO =
  /\bthis\b|\b(?:the|your) (?:app|tool|project|product|repo|repository|thing|codebase|site|service|platform|software|program)\b/i;

/** SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO=0 restores the old subject check (A/B 2026-09-25). */
/**
 * A bare "it" also points at the repo ("who uses it?"), unless the question names its own subject
 * first ("what is an llm, break it down", "teach me recursion, why does it matter").
 * On by default since the set 18 A/B (full product answer 47% -> 80%); SEQUENCE_TEACH_PRODUCT_BARE_IT=0 turns it off.
 */
const NAMES_OWN_SUBJECT =
  /\b(?:what(?:'s| is| are) (?:a|an)|teach me(?: about)?|tell me about|explain(?: what)?(?: a| an)?) (?!it\b|this\b|the (?:app|tool|project|product|repo)\b)[a-z][\w-]*/i;
const BARE_IT = /\bit\b|\buser journey\b/i;

export function pointsAtRepo(question: string): boolean {
  if (process.env.SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO === '0') return false;
  if (POINTS_AT_REPO.test(question)) return true;
  return process.env.SEQUENCE_TEACH_PRODUCT_BARE_IT !== '0' && BARE_IT.test(question) && !NAMES_OWN_SUBJECT.test(question);
}

export function teachProductTurn(input: {
  teach?: boolean;
  question: string;
  historyLines?: readonly string[];
  repoRoot?: string | null;
  teachContext?: { subjectNotInRepo?: boolean };
}): boolean {
  if (process.env.SEQUENCE_TEACH_PRODUCT_MODE === '0' || input.teach !== true) return false;
  /* A product is a repository's product: with none attached, or a subject that is not the repo
     ("what is an llm, break it down"), this is a general lesson, not a product question. */
  if (!input.repoRoot) return false;
  /* The lesson-subject check reads "what does this thing do?" as a subject that is not in the
     repo (2026-09-25: 18-23 of 34-39 product questions per sealed set never reached product
     mode). A question that points at the repo itself ("this", "the app", "the tool") is about the
     repo, whatever that check says. "what is an llm, break it down" names its own subject and
     still bails. */
  if (input.teachContext?.subjectNotInRepo === true && !pointsAtRepo(input.question)) return false;
  if (NAMES_CODE.test(input.question)) return false;
  if (isProductQuestion(input.question)) return true;
  /* Sticky: an earlier question in this conversation was a product question. */
  return (input.historyLines ?? []).some((l) => l.startsWith('User: ') && isProductQuestion(l.slice('User: '.length)));
}

/** The answer's own numbered steps (3 to 8) as a user-flow chart; nothing else is drawn. */
export function productStepsChart(text: string, question: string): SeqChart | undefined {
  const steps = [...text.matchAll(/^\s*(?:\d+[.)]|step \d+[:.])\s+(.+)$/gim)]
    .map((m) => m[1]!.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  if (steps.length < 3) return undefined;
  const picked = steps.slice(0, 8);
  const label = (line: string): string => {
    const head = line.split(/[:.;,(]|\s[-–—]\s/)[0]!.trim();
    const short = head.length > 0 ? head : line;
    return short.length > 48 ? `${short.slice(0, 47).trimEnd()}…` : short;
  };
  const chart = {
    version: 1,
    kind: 'user-flow',
    title: question.length > 60 ? 'How it works, step by step' : `How it works: ${question.replace(/[?!.]+$/, '')}`,
    items: picked.map((line, i) => ({ id: `s${i + 1}`, label: label(line), detail: line })),
    links: picked.slice(1).map((_, i) => ({ from: `s${i + 1}`, to: `s${i + 2}` })),
  };
  const checked = validateChart(chart, undefined, undefined);
  return checked.ok ? checked.chart : undefined;
}

export function productSectionsCheckEnabled(): boolean {
  return process.env.SEQUENCE_TEACH_PRODUCT_SECTIONS === '1';
}

/**
 * Which of the five parts a product answer is missing (2026-09-24: the full shape
 * landed on 46% of blind answers). Plain-text checks, generous on wording.
 */
export function missingProductParts(text: string): string[] {
  const t = text.toLowerCase();
  const missing: string[] = [];
  if (!/\b(?:is an?|are an?|is the|helps|lets you|it's an?)\b/.test(t)) missing.push('what it is');
  if (!/\b(?:for (?:people|teams|developers|anyone|you|users|learners|students|engineers|shop|store|owners)|who (?:it'?s|is it|uses|would)|aimed at|built for|designed for|used by)\b/.test(t)) {
    missing.push('who it is for');
  }
  if (!/\b(?:why|problem|so that|because|instead of having to|saves?|without having to)\b/.test(t)) missing.push('why it exists');
  if ((text.match(/^\s*(?:\d+[.)]|step \d+[:.])\s+/gim) ?? []).length < 3) missing.push('how it works, as numbered steps');
  if (!/\b(?:advantages?|benefits?|better than|compared (?:to|with)|unlike|instead of)\b/.test(t)) missing.push('its advantages');
  return missing;
}

/**
 * A PRODUCT ANSWER IS NOT SENT BACK FOR ITS SHAPE (on by default; SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE=0 turns it off).
 * The teach contract bounces a lesson whose only faults are its length or its closing
 * question, and the bounce is a second full generation. A product answer ends on the
 * answer (the derived check-in is never appended to one), so the rewrite buys a question
 * the reader did not ask for at the cost of the turn's time. Measured on set 18 (bench
 * b99b2712): 8 of 32 turns were product answers sent back only for their closing question. With
 * the flag, such a product draft settles as written, with the repairs that cost no call.
 */
export function productShapeSettles(productTurn: boolean, rest: readonly string[], text: string): boolean {
  /* Not `isLessonDraft`: that wants the reader addressed ("you") or a closing "?", and a
     product answer is written about the product ("ML Harness is ..."). With it, the first
     A/B (bank, 2f90d546) settled almost none: 42 closing-question resends became 33. */
  return (
    /* Kept on the sealed bank (afb9b7a0): mean turn 9.20 s to 7.82 s (4.1 SE); full answers
       and quality held; closing-question resends 42 to 8. */
    process.env.SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE !== '0' &&
    productTurn &&
    (rest.length === 0 || isShapeOnlyBounce(rest)) &&
    !isPlanningNotAnswer(text) &&
    text.trim().split(/\s+/).length >= TEACH_STUB_WORDS
  );
}

export function productNoQuizEnabled(): boolean {
  return process.env.SEQUENCE_TEACH_PRODUCT_NO_QUIZ === '1';
}

/**
 * A PRODUCT ANSWER DOES NOT QUIZ THE READER (2026-09-24). The owner asked what the
 * product is and was asked "which part hands off next?" back. 13-35% of product
 * answers still ended on the model's own question. A short closing paragraph that
 * is a question is dropped when the answer has other paragraphs; a question that
 * is part of a longer paragraph, or the only paragraph, is left alone.
 */
export function withoutClosingQuestion(text: string): string {
  const paras = text.trim().split(/\n{2,}/);
  if (paras.length < 2) return text;
  const last = paras[paras.length - 1]!.trim();
  if (!/\?\s*\**\s*$/.test(last) || last.split(/\s+/).length > 40) return text;
  return paras.slice(0, -1).join('\n\n');
}

export function productReadmeInlineEnabled(): boolean {
  /* On by default since the 2026-09-24 A/B: turns 3.8 s faster (SE 1.9), shape and quality not lower. */
  return process.env.SEQUENCE_TEACH_PRODUCT_README_INLINE !== '0';
}

/**
 * The start of the repository's README, for a product turn to read without a tool
 * round (2026-09-24: product turns ran 4.3 s slower, SE 1.4, most of it the
 * read_file round the instructions ask for).
 */
export function readProductReadme(repoRoot: string | null | undefined, maxChars = 2500): string | undefined {
  if (!repoRoot) return undefined;
  let names: string[];
  try {
    names = fs.readdirSync(repoRoot);
  } catch {
    return undefined;
  }
  const name = names.find((n) => /^readme(?:\.md|\.markdown|\.txt|\.rst)?$/i.test(n));
  if (name === undefined) return undefined;
  try {
    const text = fs.readFileSync(path.join(repoRoot, name), 'utf8').replace(/\r\n/g, '\n').trim();
    if (text.length === 0) return undefined;
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n[... README continues]` : text;
  } catch {
    return undefined;
  }
}

export function productLeanDigestEnabled(): boolean {
  return process.env.SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST === '1';
}

/** A product turn whose repository has a README, with the lean flag on: the digest is dropped. */
export function leanProductTurn(input: Parameters<typeof teachProductTurn>[0]): boolean {
  return productLeanDigestEnabled() && teachProductTurn(input) && readProductReadme(input.repoRoot) !== undefined;
}

/**
 * SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK=1: product turns stop asking the model for a chart and
 * rely on productStepsChart (A/B 2026-09-25: the skeleton made turns 3.0 s slower, with more
 * model chart rounds, 0.68 vs 0.38 per turn).
 */
export function productChartAskEnabled(): boolean {
  /* On by default since the set 15 A/B: turns 5.0 s faster (SE 1.2), flow charts not fewer. =0 asks again. */
  return process.env.SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK === '0';
}

/** A literal five-heading skeleton for product answers (A/B 2026-09-24; =0 turns it off). */
export function productTemplateEnabled(): boolean {
  /* On by default since the set 13 A/B (72 pairs): full product answer +0.08 (SE 0.04). */
  return process.env.SEQUENCE_TEACH_PRODUCT_TEMPLATE !== '0';
}

/**
 * A SHORT PRODUCT ANSWER (SEQUENCE_TEACH_PRODUCT_SHORT=1, under A/B). On the sealed bank at
 * 753a2c3d a one-call product turn costs about 1.9 s plus 21 ms per output token, and the
 * shortest third of answers (164 words) were as often full product answers (100%) and scored
 * higher (68.3 vs 63.5) than the longest third (258 words), at 6.3 s against 9.0 s.
 */
export function productShortEnabled(): boolean {
  return process.env.SEQUENCE_TEACH_PRODUCT_SHORT === '1';
}

export function renderProductQuestionInstructions(historyLines?: readonly string[], readme?: string): string {
  const lastAnswer = [...(historyLines ?? [])].reverse().find((l) => l.startsWith('Assistant: '));
  const lines = [
    '--- PRODUCT QUESTION (this turn) ---',
    'The learner asked what this product is and how it works, as a NEWCOMER. Answer the product, not the code.',
    readme !== undefined
      ? '- The start of the README is below. Answer from it; do not read_file it again. Read other files only if the README does not say what the product is.'
      : '- Read README.md (and docs/ if it exists) with read_file BEFORE the topology. If there is none, work the product out from what the code does (entry points, services, what a user sends and gets back) and answer anyway: never answer that you cannot answer.',
    '- Answer in this order, in plain words: what it is (one sentence); who it is for; why it exists (the problem it solves); how it works, as 5 numbered steps a user goes through; its advantages (2-3).',
    '- No service ids, file paths or edge counts unless the learner asks for them. No invented risks, numbers or failure points.',
    productChartAskEnabled()
      ? '- Draw the 5 steps with ONE propose_chart, kind user-flow: plain step labels, no nodeId, a link between consecutive steps.'
      : '- Do not call propose_chart: Sequence draws your numbered steps as the flow.',
    '- Do not end with a quiz. End on the answer.',
    ...(productShortEnabled() ? ['- Keep the whole answer to about 150 words: one short sentence per part and one short line per step.'] : []),
  ];
  if (lastAnswer !== undefined) {
    lines.push(
      `- Your last answer did not land. Do NOT send it again or reword it; say something new. It began: "${lastAnswer
        .slice(11, 311)
        .replace(/\s+/g, ' ')}"`,
    );
  }
  if (productTemplateEnabled()) {
    lines.push(
      '- Write the answer by filling in this skeleton, keeping the five headings exactly:\n' +
        '**What it is:** <one sentence>\n**Who it is for:** <the people and their situation>\n' +
        '**Why it exists:** <the problem it solves>\n**How it works:**\n1. <step>\n2. <step>\n3. <step>\n4. <step>\n5. <step>\n' +
        '**Advantages:** <2-3, compared with what people do without it>',
    );
  }
  if (readme !== undefined) lines.push(`README (start):\n"""\n${readme}\n"""`);
  return lines.join('\n');
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
    slots.push(
      ctx.rootOverview === true
        ? `THE FIRST CONCEPT, to name at the end of the overview and teach next turn: ${ctx.concept.title}.${where}`
        : `THIS TURN'S CONCEPT is exactly one: ${ctx.concept.title}.${where}`,
    );
  }

  if (ctx?.evidence === true) {
    /* 2026-09-23, the third measurement: with thinking off the model stopped
       digging — trace_flow 0/6; r5 answered in 3.2 s with no tool call. The
       harness walks the scan for it now; this line says where that went.
       2026-09-23, the fifth: `app/diagnosis.py` named 4/6 and described 0/6
       ("gateway logic", "run validation"); the section now quotes what each
       target file says it is, and this line asks for those words.
       2026-09-23, the sixth: three answers put the gates "on the token path"
       over `app/main.py:27`, an import; the section now says which hop is
       which, and this line says what each kind names. */
    slots.push(
      'The evidence section below was gathered for you from the scan; build the overview from ' +
        'it, cite its lines, and describe each part in its own words from the section. ' +
        'An import hop names what a file loads; a request hop names what it calls.',
    );
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

  const chosen =
    ctx?.beltVariant === 'short'
      ? TEACH_MODE_INSTRUCTIONS_SHORT
      : ctx?.beltVariant === 'mid'
        ? TEACH_MODE_INSTRUCTIONS_MID()
        : ctx?.beltVariant === 'pad'
          ? TEACH_MODE_INSTRUCTIONS_PAD()
          : ctx?.rootOverview === true
            ? /* The full belt with its two pacing bullets swapped, nothing else:
                 the bench arms above are experiments and keep their own text. */
              TEACH_MODE_INSTRUCTIONS.replace(
                TEACH_ONE_CONCEPT_BULLET,
                TEACH_ROOT_OVERVIEW_BULLET,
              ).replace(TEACH_NO_OUTLINE_BULLET, TEACH_LATER_TURNS_BULLET)
            : TEACH_MODE_INSTRUCTIONS;
  /* The example names a real part of THIS repository when the turn has one
     (2026-09-22): the static one was copied word for word by a lesson about a
     repository it did not describe. */
  const belt =
    ctx?.exampleLabel !== undefined
      ? chosen.replace(TEACH_CLOSING_PREDICTION_EXAMPLE, teachPredictionExample(ctx.exampleLabel))
      : chosen;
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
  /* A plan is written on the Plan tab of the AI Canvas (planTurn.ts). */
  if (input.planning === true) return true;
  if (input.surface?.id === 'ai-canvas') return true;
  /*
   * THE HOME WORKSPACE IS A DRAWING SURFACE, ALWAYS.
   *
   * Design mode with no repository had the canvas writers only when the
   * question happened to say "draw" or "diagram". So the blank workspace — the
   * first screen a new person sees, and the one with no code to talk about —
   * was the surface with the fewest ways to show them anything, while the
   * belt offered an architecture proposal instead. `canvas.write_*` writes
   * nothing to disk and touches no repository, so there is nothing to spend
   * here but belt tokens on a turn that carries no digest.
   */
  if (input.designMode === true && !input.repoRoot) return true;
  /*
   * "EXPLAIN THIS FILE" DRAWS.
   *
   * Everything below this line used to be `isDrawishAskQuestion` alone, and
   * that pattern is about the WORD draw: "diagram", "sketch", "on the board".
   * The commonest ask in a repository-reading tool contains none of them, so
   * "explain src/server/askPipeline.ts" reached the model with the five canvas
   * writers refused at the door (`askTools.ts`, the `canvasToolsEnabled`
   * branch) and could only ever answer in prose — measured 2026-09-18,
   * `docs/research/ai-canvas-moat-audit.md`.
   *
   * The matching instruction is `EXPLAIN_ON_CANVAS_SECTION`, gated on the SAME
   * predicate: a belt that armed the tools without ordering the drawing would
   * spend the tokens and change nothing.
   */
  if (isExplainFileAsk(input.question)) return true;
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
    ...(result.evidence ? { evidence: result.evidence } : {}),
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

/* What each tool did, in the reader's words. The stop note is read by the person who asked, and
   the belt already keeps tool names away from them: "propose_topology, read_topology" in a note
   is the harness reading out its own API (seen live on Bastion, 09-22). */
const TOOL_PLAIN_WORDS: Record<string, string> = {
  read_file: 'opened files',
  search_files: 'searched the code',
  read_topology: 'read the architecture',
  propose_topology: 'drew on the architecture board',
  propose_chart: 'drew on the canvas',
  propose_files: 'drafted files',
  propose_plan: 'drafted a plan',
  write_plan: 'wrote the plan',
  edit_file: 'edited files',
  run_command: 'ran commands',
};
export function toolInPlainWords(name: string): string {
  if (TOOL_PLAIN_WORDS[name]) return TOOL_PLAIN_WORDS[name];
  if (name.startsWith('canvas.')) return 'wrote on the canvas';
  return 'looked things up';
}

/** Summarize executed tools for forced final answers (B2.1), in plain words. */
export function summarizeExecutedTools(toolNames: readonly string[]): string {
  if (toolNames.length === 0) return '';
  const acts = [...new Set(toolNames.map(toolInPlainWords))];
  const list = acts.length === 1 ? acts[0] : `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}`;
  return ` Before stopping I ${list} (${toolNames.length} step${toolNames.length === 1 ? '' : 's'}).`;
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
  /** The root-overview turn (`isRootOverviewTurn`): asked for 250-350 words. */
  overview?: boolean,
  /** The closing examples this turn's belt rendered, so a copy of one is caught. */
  closingExamples: readonly string[] = [],
  /** The files read and scanned as paths: a citation is then checked by its path, not its name. */
  paths?: CitationPaths,
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
  const check = gradeCheckIn(text, closingExamples);
  if (check.parrotedExample === true) {
    problems.push(
      'your closing question copies the EXAMPLE from this contract, or still has a placeholder ' +
        'where a name belongs — ask about the actual component this lesson covered, by name',
    );
  }
  const words = text.trim().split(/\s+/).length;
  /*
   * THE OVERVIEW TURN HAS ITS OWN CEILING (2026-09-22). The belt asks that turn
   * for 250-350 words naming every component and hop; bouncing it at 250 would
   * punish the model for doing what it was asked, and the bounce is the louder
   * of the two voices.
   */
  if (overview === true && words > 400) {
    problems.push(
      `your reply is ${words} words — the root overview is about 250-350 words: every ` +
        'component and every hop in the order the data moves, one plain sentence each',
    );
  } else if (overview !== true && words > 250) {
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
      [...text.matchAll(CITED_FILE)].map((m) => citedBasename(m).toLowerCase()),
    );
    const ghosts = [
      ...new Set(
        [...text.matchAll(CITED_FILE)]
          .filter((m) => isGhostCitation(m, graphBasenames, paths))
          .map((m) => citedBasename(m).toLowerCase()),
      ),
    ];
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
      const unread = paths
        ? unreadCitations(text, graphBasenames, readBasenames, paths)
        : [...cited].filter((b) => graphBasenames.has(b) && !readBasenames.has(b));
      if (unread.length > 0) {
        problems.push(
          `you cited ${unread.join(', ')} WITHOUT reading ${unread.length === 1 ? 'it' : 'them'} ` +
            'this turn — call read_file first, then teach from the real contents',
        );
      }
    }
    /*
     * A FILE NAME AT THE WRONG PATH (2026-09-23). The fourth measurement, r2:
     * `app/tools/asking.py` for `app/asking.py` passed, because only the
     * basename was checked, and `asking.py` had been read.
     */
    if (paths) {
      const off = misplacedCitations(text, graphBasenames, paths);
      const named = [...off.moved.map((m) => m.cited), ...off.unscanned];
      if (named.length > 0) {
        problems.push(
          `you cited ${named.join(', ')} at a path that is not in this repository — name each ` +
            'file by the path you read it at',
        );
      }
    }
  }
  return problems;
}

/*
 * A FILE AS THE GRADER READS ONE OUT OF PROSE, with the backticks around it and
 * any `:line` claim after it, so the grader and the repair below see the same
 * citations. Group 1 is a backticked path, group 2 a bare one.
 */
const CITED_PATH = String.raw`[\w./\\-]*[\w-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|rb|json|txt|yaml|yml|toml)\b`;
const LINE_CLAIM = String.raw`(?::\d+(?:[-–]\d+)?)?`;
const CITED_FILE = new RegExp(
  String.raw`\x60(${CITED_PATH})${LINE_CLAIM}\x60|(${CITED_PATH})${LINE_CLAIM}`,
  'g',
);
const citedBasename = (m: RegExpMatchArray): string =>
  (m[1] ?? m[2]!).replace(/\\/g, '/').split('/').pop()!;

/*
 * ══ THE GRADER REPAIRS A CITATION; IT DOES NOT ASK FOR A REWRITE (2026-09-23) ══
 *
 * The third measurement, r1: a 1,975-character overview that named
 * `security_boundary`, `_check_database_opens`, `_check_schema_agrees` and the
 * `/oc` facade — all real in `app/main.py` — was bounced for one file, "you
 * cited hwdetect.py WITHOUT reading it this turn", and the rewrite the reader
 * then watched stream in was 96 words. Streamed against final: 4801/691,
 * 4153/1535, 3329/716. A rewrite trades a rich draft for a thin one.
 *
 * So a lesson whose only fault is a file it did not read is kept, and the file
 * is marked in place: its name stays, the path and any line number go, and the
 * note says which one. Nothing is put in its place — the repair says what was
 * taken out, never what might be true.
 */
export function unreadCitations(
  text: string,
  graphBasenames: ReadonlySet<string> | null,
  readBasenames: ReadonlySet<string>,
  paths?: CitationPaths,
): string[] {
  if (!graphBasenames || graphBasenames.size === 0) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(CITED_FILE)) {
    const b = citedBasename(m).toLowerCase();
    if (!graphBasenames.has(b)) continue;
    const cited = citedPath(m);
    /* By path when there is one: a scanned file this turn did not read is
       unread even when a file of the same name was read; a path in no scan is
       `misplacedCitations`' to repair. */
    if (paths && cited.includes('/')) {
      if (!pathIn(cited, paths.read) && pathIn(cited, paths.scan)) out.add(b);
      continue;
    }
    if (!readBasenames.has(b)) out.add(b);
  }
  return [...out];
}

/** The draft with each unread citation cut to its file name and marked as unread. */
export function markUnreadCitations(text: string, unread: readonly string[], paths?: CitationPaths): string {
  if (unread.length === 0) return text;
  const names = new Set(unread);
  return text.replace(CITED_FILE, (...args: string[]) => {
    const m = args as unknown as RegExpMatchArray;
    const base = citedBasename(m);
    if (!names.has(base.toLowerCase())) return m[0]!;
    const cited = citedPath(m);
    if (paths && cited.includes('/') && (pathIn(cited, paths.read) || !pathIn(cited, paths.scan))) return m[0]!;
    return m[1] !== undefined ? `\x60${base}\x60 (not read this turn)` : `${base} (not read this turn)`;
  });
}

/*
 * ══ A CITATION IS CHECKED BY ITS PATH (2026-09-23) ═══════════════════════════
 *
 * The fourth measurement, r2: "queues a sub-agent via `app/tools/asking.py`" —
 * the file is `app/asking.py`, it was read, and the grader passed the claim
 * because it compared basenames only. A cited path now names a file when it is
 * that file's repo path or a whole-segment suffix of it. A path that names no
 * scanned file is repaired: to the one file read this turn with that name, said
 * in the note, or — with none or several to choose from — marked, never guessed.
 */
export interface CitationPaths {
  /** Repo paths of the files this turn read (the gathered evidence counts). */
  read: ReadonlySet<string>;
  /** Repo paths of the scanned files. */
  scan: ReadonlySet<string>;
  /** Whether a repo-relative path is a file on disk under the repo root (`isGhostCitation`). */
  onDisk?: (rel: string) => boolean;
}

/*
 * ══ THE GRADER KNOWS WHAT A FILE IS (Slice 11, 2026-09-23) ═════════════════════
 *
 * Sixth measurement, r2: the grader read "Solid.js" — a framework — as a cited
 * file that does not exist, and `docs/diagnosis_engine.yaml` — on disk, named in
 * the docstring the section quoted — as missing, because it is not a scanned
 * file; the redo opened with "I can't name `solid.js`". A cited name is a file
 * that does not exist only when it is in no scan (by name, or by path suffix),
 * is not a file on disk under the repo root, and is shaped like a file: a bare
 * capitalised one-word name (`Solid.js`, `Next.js`) is a product's name, not a
 * citation. A bare lower-case name in neither (`char_freq.js`) is still a
 * fabricated file, as measured on the makemore rematch.
 */
const PRODUCT_NAME = /^[A-Z][A-Za-z0-9]*\.(?:js|py)$/;

function isGhostCitation(
  m: RegExpMatchArray,
  graphBasenames: ReadonlySet<string>,
  paths?: CitationPaths,
): boolean {
  const cited = citedPath(m);
  if (graphBasenames.has(citedBasename(m).toLowerCase())) return false;
  if (paths !== undefined && pathIn(cited, paths.scan)) return false;
  if (paths?.onDisk?.(cited) === true) return false;
  return cited.includes('/') || !PRODUCT_NAME.test(cited);
}

export interface MisplacedCitations {
  /** A cited path in no scan, and the one file read this turn with its name. */
  moved: { cited: string; real: string }[];
  /** A cited path in no scan, with no single read file to put in its place. */
  unscanned: string[];
}

const citedPath = (m: RegExpMatchArray): string => (m[1] ?? m[2]!).replace(/\\/g, '/').replace(/^\.?\//, '');
const pathNames = (cited: string, file: string): boolean => {
  const c = cited.toLowerCase();
  const f = file.replace(/\\/g, '/').toLowerCase();
  return f === c || f.endsWith(`/${c}`);
};
const pathIn = (cited: string, files: ReadonlySet<string>): boolean => {
  for (const f of files) if (pathNames(cited, f)) return true;
  return false;
};

export function misplacedCitations(
  text: string,
  graphBasenames: ReadonlySet<string> | null,
  paths: CitationPaths,
): MisplacedCitations {
  const found: MisplacedCitations = { moved: [], unscanned: [] };
  if (!graphBasenames || graphBasenames.size === 0) return found;
  for (const m of text.matchAll(CITED_FILE)) {
    const cited = citedPath(m);
    const b = citedBasename(m).toLowerCase();
    if (!cited.includes('/') || !graphBasenames.has(b)) continue;
    if (pathIn(cited, paths.read) || pathIn(cited, paths.scan)) continue;
    if (found.moved.some((x) => x.cited === cited) || found.unscanned.includes(cited)) continue;
    const named = [...paths.read].filter((f) => f.replace(/\\/g, '/').split('/').pop()!.toLowerCase() === b);
    if (named.length === 1) found.moved.push({ cited, real: named[0]!.replace(/\\/g, '/') });
    else found.unscanned.push(cited);
  }
  return found;
}

/** The draft with each misplaced citation put at its real path, or marked. */
export function repairMisplacedCitations(text: string, found: MisplacedCitations): string {
  if (found.moved.length === 0 && found.unscanned.length === 0) return text;
  return text.replace(CITED_FILE, (...args: string[]) => {
    const m = args as unknown as RegExpMatchArray;
    const cited = citedPath(m);
    const moved = found.moved.find((x) => x.cited === cited);
    if (moved !== undefined) return m[0]!.replace(m[1] ?? m[2]!, moved.real);
    if (found.unscanned.includes(cited)) return `${m[0]!} (path not in the scan)`;
    return m[0]!;
  });
}

export function misplacedCitationNote(found: MisplacedCitations): string {
  const said = [
    ...found.moved.map((x) => `\x60${x.cited}\x60 → \x60${x.real}\x60: the file is at this path`),
    ...found.unscanned.map((c) => `\x60${c}\x60 is a path not in the scan`),
  ];
  return `(Sequence checked the file paths the lesson cited against the files read this turn: ${said.join('; ')}.)`;
}

/** The problem line `gradeTeachTurn` writes for a file cited at a path in no scan. */
const MISPLACED_CITATION_PROBLEM = /^you cited .* at a path that is not in this repository/;
/** The closing-question faults the harness repairs by appending the derived check-in. */
const CLOSING_CHECK_PROBLEM =
  /^your reply does not END with|^your reply ends (?:with a question, but not|by OFFERING)|^your closing question copies/;
/** A comprehension question mid-lesson: kept as written (2026-09-23). */
const MID_LESSON_QUESTION_PROBLEM = /^you asked a question mid-lesson/;

/** The one line that says which closing question the harness took out, and why. */
export function closingQuestionNote(closed: { removed?: string; copied?: boolean; list?: boolean }): string {
  const said = (closed.removed ?? '').replace(/\s+/g, ' ').trim();
  if (closed.list === true) {
    return `(Sequence took out the closing choice list "${said}": an option can be picked without having followed the lesson.)`;
  }
  return closed.copied === true
    ? `(Sequence took out the closing question "${said}": it copied the lesson contract's example.)`
    : `(Sequence took out the closing offer "${said}": an offer can be answered without having followed the lesson.)`;
}

export function unreadCitationNote(unread: readonly string[]): string {
  const one = unread.length === 1;
  return (
    `(Sequence marked ${unread.join(', ')} as named without being read this turn: the file ` +
    `name stays, and what the lesson says about ${one ? 'it' : 'them'} was not checked against ` +
    `the file.)`
  );
}

/** The problem line `gradeTeachTurn` writes for a file cited without a read. */
const UNREAD_CITATION_PROBLEM = /^you cited .* WITHOUT reading /;
/** The overview's ceiling: long is still a lesson on the turn asked for the whole flow. */
const OVERVIEW_TOO_LONG = /^your reply is \d+ words — the root overview/;
/** Below this an overview is far under the 250-350 words it was asked for. */
const TEACH_OVERVIEW_FLOOR_WORDS = 150;

/**
 * A draft that is a lesson for the reader, whatever else is wrong with it:
 * not the model planning, spoken to the learner, and in its word range — or
 * over it, on the overview turn.
 */
export function isLessonDraft(text: string, overview: boolean): boolean {
  if (isPlanningNotAnswer(text)) return false;
  const words = text.trim().split(/\s+/).length;
  if (words < (overview ? TEACH_OVERVIEW_FLOOR_WORDS : TEACH_STUB_WORDS)) return false;
  if (!overview && words > 250) return false;
  return ADDRESSES_THE_READER.test(text) || /\?\s*$/.test(text.trim());
}

/*
 * THE BOUNCE ASKS FOR ONE CHANGE AND HANDS THE DRAFT BACK (2026-09-23).
 *
 * Every problem is still named — the one-complaint ladder was measured worse
 * (see the bounce's comment above `drewInProse`) — but "Rewrite it now" sent the
 * model back to a blank page it did not have: its own draft is not in the next
 * prompt, and r1's rewrite came back at 96 words. So the ask is the one thing
 * missing, with the draft to keep. A draft that is only planning has nothing to
 * keep, and its one change is the lesson itself.
 */
export function teachOneChange(problems: readonly string[], draft: string, overview: boolean): string {
  const scope = overview
    ? 'the root overview, every component and every hop in the order the data moves, in about 250-350 words'
    : 'one concept, in about 100-150 words';
  if (isPlanningNotAnswer(draft)) {
    return (
      `Make this ONE change: write the lesson itself, to the learner, from the evidence above — ` +
      `${scope}, closing with one check-in question about it.`
    );
  }
  const words = draft.trim().split(/\s+/).length;
  const change =
    words < (overview ? TEACH_OVERVIEW_FLOOR_WORDS : TEACH_STUB_WORDS)
      ? `say more: ${scope}`
      : !ADDRESSES_THE_READER.test(draft)
        ? 'speak to the learner as you, and close with one check-in question about what you taught'
        : (problems.find((p) => !UNREAD_CITATION_PROBLEM.test(p) && !MISPLACED_CITATION_PROBLEM.test(p)) ??
          problems[0] ??
          'close with one check-in question');
  return `Make this ONE change and keep the rest of your draft as it is: ${change}. Your draft:\n\n${draft.trim()}`;
}

/*
 * AN ANSWER IS NOT SENT TWICE (on by default since blind check 4, 2026-09-24; SEQUENCE_TEACH_REPEAT_GUARD=0 turns it off).
 *
 * 2026-09-24: the owner asked three different product questions and got the same
 * answer three times; a prompt line telling the model not to repeat itself did
 * not stop it (product-mode run 2, similarity 0.79 and 1.0). So the grader checks
 * the draft against the last assistant answer in the history, and a draft that is
 * mostly the same (character 5-gram Jaccard >= 0.6) is sent back once for a new
 * answer, and is never kept as the "richer" one.
 */
const REPEAT_PROBLEM = 'it repeats your previous answer almost word for word';
const REPEAT_THRESHOLD = 0.6;
const REPEAT_RETRIES = 2;
const REPEAT_RETRY_TEMPERATURE = 0.8;
export const REPEAT_FALLBACK =
  'I already covered that in my last answer. Which part do you want me to go deeper on, or should I explain it a different way?';

function fiveGrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  for (let i = 0; i + 5 <= s.length; i += 1) out.add(s.slice(i, i + 5));
  return out;
}

export function answerSimilarity(a: string, b: string): number {
  const A = fiveGrams(a);
  const B = fiveGrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/**
 * WHAT TO SEND WHEN THE HOT RETRIES STILL REPEAT (SEQUENCE_TEACH_REPEAT_FALLBACK=new-only).
 *
 * The canned "already covered" line ended 9 of 54 guard turns and cost product
 * shape and quality (2026-09-24). A repeated draft usually still carries a few
 * sentences the last answer did not: send those, introduced as an addition, when
 * there are at least two; otherwise the short line.
 */
export function repeatFallback(draft: string, historyLines?: readonly string[]): string {
  if (process.env.SEQUENCE_TEACH_REPEAT_FALLBACK !== 'new-only') return REPEAT_FALLBACK;
  const last = [...(historyLines ?? [])].reverse().find((l) => l.startsWith('Assistant: '));
  if (last === undefined) return REPEAT_FALLBACK;
  const lastSentences = last
    .slice('Assistant: '.length)
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x.trim().length > 0);
  const fresh = draft
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.split(/\s+/).length >= 6)
    .filter((x) => lastSentences.every((y) => answerSimilarity(x, y) < 0.5));
  if (fresh.length < 2) return REPEAT_FALLBACK;
  return `Adding to my last answer:\n\n${fresh.join(' ')}`;
}

export function repeatsLastAnswer(text: string, historyLines?: readonly string[]): boolean {
  if (process.env.SEQUENCE_TEACH_REPEAT_GUARD === '0') return false;
  const last = [...(historyLines ?? [])].reverse().find((l) => l.startsWith('Assistant: '));
  if (last === undefined) return false;
  /* The history keeps 1,200 characters of an answer; compare like with like. */
  return answerSimilarity(text.slice(0, 1200), last.slice('Assistant: '.length).replace(/… \[memory trimmed\]$/, '')) >= REPEAT_THRESHOLD;
}

/** The one line that says the kept answer is the earlier, fuller one. */
export const KEPT_RICHER_NOTE =
  '(The rewrite the lesson contract asked for came back shorter than this earlier answer, ' +
  'so the earlier one stands.)';

/*
 * ══ A ROUTE IN A LESSON IS ONE THE SCAN SHOWS (2026-09-23) ══════════════════
 *
 * The third measurement: `/api/ask` in two finals and two drafts, and it exists
 * nowhere in the repository. The scanned http edges carry the real ones — the
 * caller's path skeleton and the route it matched — so a route-shaped string in
 * a lesson is checked against those, with `*` and `:id` segments as wildcards
 * (`pathToSegments`, the joiner's own normalisation). One that matches nothing
 * is marked where it stands and named in the note. A scan with no http edges has
 * nothing to check a route against, so it leaves the text alone.
 *
 * MARKED, NOT REPLACED (2026-09-23). The fourth measurement: a replacement left
 * "renders an AI engine that sends (a route not in the scan) and related HTTP
 * calls" — a sentence with a hole in it. The route stays, with a suffix.
 */
const ROUTE_SPAN =
  /(?<![\w./:-])(\x60?)((?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?)(\/[\w.*:{}<>~%-]+(?:\/[\w.*:{}<>~%-]+)+\/?)\1(?![\w/])/g;

export function groundRoutes(
  text: string,
  graph: ArchGraph | null | undefined,
): { text: string; marked: string[] } {
  const known: string[][] = [];
  for (const e of graph?.edges ?? []) {
    if (e.kind !== 'http') continue;
    for (const p of [e.detail?.pathPattern, e.detail?.['matchedRoute']]) {
      if (typeof p !== 'string') continue;
      const segs = pathToSegments(p.replace(/^[A-Z*]+\s+/, ''));
      if (segs.length > 0) known.push(segs);
    }
  }
  if (known.length === 0) return { text, marked: [] };
  const marked: string[] = [];
  const out = text.replace(ROUTE_SPAN, (span: string, tick: string, method: string, raw: string) => {
    const route = raw.replace(/[.:]+$/, '');
    const trailing = raw.slice(route.length);
    const segs = pathToSegments(route);
    /* A path to a file is not a route. */
    if (segs.length < 2 || /\.[a-z]{1,5}$/i.test(route)) return span;
    if (known.some((k) => segmentsMatch(segs, k))) return span;
    if (!marked.includes(route)) marked.push(route);
    return tick !== '' ? `${span} (not in the scan)` : `${method}${route} (not in the scan)${trailing}`;
  });
  return { text: out, marked };
}

export function routeNote(marked: readonly string[]): string {
  return (
    `(Sequence marked ${marked.length} route${marked.length === 1 ? '' : 's'} the scan does ` +
    `not show: ${marked.join(', ')}.)`
  );
}

/**
 * ONE THING THIS TURN DREW: a chart, a canvas block, a board write, a diagram.
 *
 * Recorded as it is emitted rather than reconstructed at the end, because the
 * only honest source for "what did this turn produce" is the events the turn
 * actually pushed. A late re-derivation would be a second answer the stream is
 * free to disagree with.
 */
export interface TurnArtefact {
  kind: 'chart' | 'canvas' | 'board' | 'topology';
  /** Chart/diagram title, `title (type)` for a block, or a count for the board. */
  label: string;
}

/**
 * THE SENTENCE A TURN THAT ONLY DREW ENDS IN.
 *
 * Owner, walking the installed app 2026-09-17: "the model just drew and
 * returned. It didn't say anything." A turn whose final round was one
 * `propose_chart` call leaves `text` empty — the tool fence is stripped out of
 * the answer — and the funnel below then printed "I did not produce an answer
 * for this one. Nothing was found and nothing is being hidden", beside a
 * freshly drawn parabola. Both halves of that are false: something was
 * produced, and the reader can see it.
 *
 * CANON's law is that a turn always ends in words, and the funnel exists to
 * honour it. What it lacked was the one fact that makes the words true, so it
 * defaulted to the sentence for a turn that did NOTHING. This builds the line
 * from the work rows themselves — the titles that went out on the wire — so it
 * cannot describe a picture that was not drawn.
 *
 * Returns `undefined` when the turn drew nothing, which is the case the old
 * fallback was always right about.
 */
export function describeTurnArtefacts(artefacts: readonly TurnArtefact[]): string | undefined {
  if (artefacts.length === 0) return undefined;
  const of = (kind: TurnArtefact['kind']): TurnArtefact[] =>
    artefacts.filter((a) => a.kind === kind);
  const parts: string[] = [];
  const charts = of('chart');
  if (charts.length === 1) parts.push(`Drew a chart: ${charts[0]!.label}.`);
  else if (charts.length > 1) {
    parts.push(`Drew ${charts.length} charts: ${charts.map((c) => c.label).join(', ')}.`);
  }
  const blocks = of('canvas');
  if (blocks.length === 1) parts.push(`Added a block to the AI Canvas: ${blocks[0]!.label}.`);
  else if (blocks.length > 1) {
    parts.push(
      `Added ${blocks.length} blocks to the AI Canvas: ${blocks.map((b) => b.label).join(', ')}.`,
    );
  }
  const topology = of('topology');
  if (topology.length > 0) {
    parts.push(
      `Put a diagram on the architecture board: ${topology.map((t) => t.label).join(', ')}.`,
    );
  }
  const board = of('board');
  if (board.length > 0) {
    const items = board.reduce((sum, b) => sum + (Number(b.label) || 0), 0);
    parts.push(`Wrote ${items} item${items === 1 ? '' : 's'} on the whiteboard.`);
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(' ')} I drew this turn rather than writing it out — ask about any part of it and I will explain it in words.`;
}

/**
 * WHEN THE ANSWER STOPS MID-WORD BECAUSE THE MODEL RAN OUT OF ROOM.
 *
 * Owner, 2026-09-19: "it also seems to render incomplete under certain changes
 * when I ran the breakdown skill" — with a Break-it-down answer that ended on
 * a bare list marker and a product that presented it as a finished reply.
 *
 * THE BYTES WERE NEVER LOST; THE FACT WAS. `provider.ts` has read
 * `finish_reason` since the audit that found "a completion truncated at
 * max_tokens was indistinguishable from a complete one", and it used the value
 * at exactly one site, to put a number in an error message. Everything
 * downstream got the text and no way to know whether it was all of it. So this
 * pipeline could not tell a finished answer from a severed one, and neither
 * could the reader.
 *
 * NAMED AS ROOM, NOT AS max_tokens. The same `length` arrives when a small
 * model's context window is full of the question — the owner's turn was 4.9k
 * in and 191 out on a local model — and "the model hit max_tokens" would be
 * the harness describing a knob instead of what happened. Both cases are the
 * same fact to the person reading: there was no room left to finish.
 *
 * IT DOES NOT TRY TO CONTINUE. Re-asking is the reader's call, because a
 * continuation costs another turn and the harness does not get to spend one
 * on their behalf — the rule `buildForcedFinalAnswer` already follows.
 */
export const TRUNCATED_ANSWER_NOTE =
  'The model ran out of room and this answer stops part-way through — it is not ' +
  'finished, and nothing below the cut exists. Ask again to continue from here, or ' +
  'narrow the question so the whole answer fits.';

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
/**
 * ══ THE FORCED DRAW ROUND ASKS, IT DOES NOT SHOUT ══════════════════════════
 *
 * Owner, 2026-09-22, photos 1 and 3. The old demand opened with a banner
 * ("--- YOU HAVE NOT DRAWN ANYTHING ---"), said "Prose is not a drawing",
 * required "EXACTLY ONE ```sequence-tool fence", and ended "Do not call read
 * tools". A 2.5B model trying hard to obey wrote the fence with its label on
 * the wrong line, and the fragment leaked into his transcript.
 *
 * And it asked for the wrong thing: whenever canvas tools were live it led
 * with `canvas.write_*`, so "show me on the arch board" was asked, twice, for
 * an AI Canvas block — photo 1's note said so in as many words.
 *
 * Now it says what is missing and which tool fits the surface the person
 * named, in a sentence. The tool protocol is already in the prompt above; the
 * demand does not restate its syntax.
 */
export type DrawSurface = 'board' | 'canvas' | 'chart';

/**
 * Which surface a draw ask means. The two are different tools (owner,
 * 2026-09-22): the ARCHITECTURE BOARD is grounded — real services, real edges,
 * proposals on top; the AI CANVAS is free-form — anything that is not the
 * mapped system. A named surface wins; otherwise architecture words mean the
 * board, and the canvas takes the rest when its tools are live.
 */
export function drawSurfaceFor(question: string, canvasLive: boolean): 'board' | 'canvas' {
  const q = question.toLowerCase();
  const namesBoard = /\b(?:arch(?:itecture)?\s+board|board|topology)\b/.test(q);
  const namesCanvas = /\b(?:ai\s+canvas|canvas|whiteboard)\b/.test(q);
  if (namesBoard && !namesCanvas) return 'board';
  if (namesCanvas && !namesBoard) return canvasLive ? 'canvas' : 'board';
  if (!canvasLive) return 'board';
  return /\b(?:architecture|services?|system|topology|repo(?:sitory)?|backend|infra(?:structure)?)\b/.test(q)
    ? 'board'
    : 'canvas';
}

/**
 * A LESSON ON THE CANVAS OWES A FLOW (2026-09-22). Owner: "create a detailed …
 * diagram on the AI canvas which shows the flows". The canvas demand below
 * offered "a diagram, a chart or a note", and a note is what a small model
 * reached for — words in a box, the thing the lesson already was.
 */
export const TEACH_FLOW_DEMAND =
  'You have not drawn the flow yet. Draw it with `propose_chart` (kind data-flow): one item ' +
  'per component you named, links in the order the data moves, each labelled with what ' +
  'moves. Then say in a sentence what it shows.';

/**
 * WHAT COUNTS AS A DRAWING ON A TEACH TURN — one definition, read by the teach
 * floor, the forced round's trigger and the forced round's own loop.
 *
 * A chart, a mermaid or svg diagram, a topology: the tools that can draw a
 * flow. A note does not. Slice 1 applied this only inside the forced round, so
 * a note written in the MAIN loop (2026-09-22, Slice 1's concern 1) still set
 * `canvasWriteSucceededThisTurn`, and the floor and the forced round both stood
 * down: the lesson ended with a note and no flow.
 */
const TEACH_DRAWING_TOOLS: ReadonlySet<string> = new Set([
  'propose_chart',
  'propose_topology',
  'canvas.write_mermaid',
  'canvas.write_svg',
]);

export function countsAsTeachDrawing(toolName: string | undefined): boolean {
  return toolName !== undefined && TEACH_DRAWING_TOOLS.has(toolName);
}

export function forcedDrawDemand(surface: DrawSurface, teach = false): string {
  if (teach && surface === 'canvas') return TEACH_FLOW_DEMAND;
  if (surface === 'chart') {
    return (
      'You have not drawn the chart yet. Call `propose_chart` now — a line chart suits a ' +
      'curve. Then say in a sentence what it shows.'
    );
  }
  if (surface === 'board') {
    return (
      'You have not put anything on the architecture board yet. Call `propose_topology` now ' +
      'with the services and connections you found — a small proposal is fine. Then say in a ' +
      'sentence or two what you proposed.'
    );
  }
  return (
    'You have not drawn anything on the AI Canvas yet. Draw it now with a `canvas.write_*` ' +
    'tool — a diagram, a chart or a note, whichever fits what they asked. Then say in a ' +
    'sentence what you drew.'
  );
}

/**
 * The answer's last sentence is a promise to draw. "Let me draw this on the
 * canvas." closed a live turn that drew nothing (2026-09-22); a promise the
 * harness can see is a drawing it can ask for.
 */
export function endsWithDrawPromise(text: string): boolean {
  const tail = text.trim().split(/(?<=[.!?])\s+/).pop() ?? '';
  return /\b(?:let me|i(?:'| wi)ll|i will|i am going to|i'm going to|now i(?:'ll| will)?)\s+(?:draw|sketch|chart|render|put)\b[^.!?]{0,80}[.!?]?$/i.test(tail);
}

/** One factual line, named for the surface that was asked for. */
export function nothingDrawnNote(surface: DrawSurface): string {
  if (surface === 'board') return '(Nothing was put on the architecture board this turn.)';
  if (surface === 'chart') return '(No chart was drawn this turn.)';
  return '(Nothing was drawn on the AI Canvas this turn.)';
}

/** The planning turn's version of the answer round. */
export const PLAN_FROM_EVIDENCE =
  'You have read enough. Write the plan now from what you found, in Markdown: the goal in one ' +
  'line, the steps as a numbered list, then what changes, where it sits in the system, and the ' +
  'risks. Do not call any tools.';

/** The numbered steps of a Markdown plan, as `write_plan` takes them. */
export function planStepsFromMarkdown(markdown: string): string[] {
  const numbered = numberedSteps(markdown);
  return numbered.length >= 2 ? numbered : stepsUnderHeading(markdown);
}

/** Bullets under a "Steps" heading or label — what the live rescue actually wrote. */
function stepsUnderHeading(markdown: string): string[] {
  const steps: string[] = [];
  let inSteps = false;
  for (const line of markdown.split('\n')) {
    const bare = line.replace(/[*_#>]/g, '').trim();
    if (/^steps\b/i.test(bare)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    const bullet = /^\s*[-*+]\s+(.+?)\s*$/.exec(line);
    if (bullet && bullet[1]) {
      steps.push(bullet[1].replace(/\*\*/g, '').trim());
      if (steps.length >= 12) break;
    } else if (bare !== '') break;
  }
  return steps;
}

function numberedSteps(markdown: string): string[] {
  const steps: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line);
    if (m && m[1]) steps.push(m[1].replace(/\*\*/g, '').trim());
    if (steps.length >= 12) break;
  }
  return steps;
}

/** What the chat says when the plan went to the Plan tab: its opening, not all of it. */
export function planChatSummary(markdown: string): string {
  const lines = markdown.split('\n').filter((l) => l.trim() !== '');
  const head = lines.slice(0, 3).join('\n');
  return `${head}\n\n(The full plan is on the Plan tab of the AI Canvas.)`;
}

/** The answer round's one sentence — see the block that sends it. */
export const ANSWER_FROM_EVIDENCE =
  'You have read enough. Answer the question now from what you found above, in plain prose. ' +
  'Do not call any tools.';

/*
 * ══ THE MODEL'S THINKING IS NOT THE ANSWER (2026-09-22) ═════════════════════
 *
 * Owner's re-measure, r1: the `result` began "I need to ground my teaching in
 * files I've actually read this turn" and ended on a think close tag, while a
 * root overview the grader had bounced — for its grounding, in that run —
 * streamed from t=102 s and was dropped. Thinking that leaks into the content
 * channel is cut out here; what is left is judged on its own, and a reply that
 * is only the model planning its next move ("I need to…", "Let me…", never a
 * word to the reader) is not accepted as an answer.
 */
const THINK_CLOSE = '</think>';
const THINK_OPEN = '<think>';

/** The reply with any leaked thinking cut out: a closed block, a stray close, an unclosed open. */
export function withoutLeakedThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const close = out.toLowerCase().lastIndexOf(THINK_CLOSE);
  if (close !== -1) out = out.slice(close + THINK_CLOSE.length);
  const open = out.toLowerCase().indexOf(THINK_OPEN);
  if (open !== -1) out = out.slice(0, open);
  return out === text ? text : out.trim();
}

/**
 * A reply that is the model planning, not answering: it opens in the first
 * person on what it is about to do and never once addresses the reader.
 */
export function isPlanningNotAnswer(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  return OPENS_ON_A_PLAN.test(t) && !ADDRESSES_THE_READER.test(t);
}
const OPENS_ON_A_PLAN =
  /^(?:i need to|i should|i must|i will|i\x27ll|i am going to|i\x27m going to|let me|first,? (?:i|let me)|now,? let me|okay,? (?:so |let me)|wait\b)/i;
const ADDRESSES_THE_READER = /\byou(?:r|rs|\x27re|\x27ll|\x27ve|\x27d)?\b/i;

/*
 * ══ A PLANNING LEAD IN A TOOL ROUND IS NOT THE READER'S TEXT (2026-09-23) ══
 *
 * The third measurement: "I need to read the key files to teach you…" streamed
 * as chat text, and then the round turned out to be a tool call. The sentence
 * was the model talking to itself before a read. The leading sentences that open
 * on a plan are held until the round is over: a tool round drops them, and a
 * round with no calls sends them on, because then they may be the start of the
 * answer. The first sentence that is not a plan sends everything held, so an
 * answer that opens "Let me explain" still streams as it is written.
 *
 * PLANNING WITH NO OPENING TAG (Slice 12, 2026-09-23). Seventh measurement, r2:
 * the retry streamed 14,065 characters — "The user is asking for a visual
 * breakdown of how the app works at the root level. I need to provide a
 * proposal using `propose_chart`…" through "Let me make the call.\n</think>" —
 * and then made two tool calls. "The digest shows three services" is not a plan
 * sentence, so it sent everything held. A round that opens on the user in the
 * third person ("The user is asking", "They want") or on a plan, and has not
 * spoken to the reader in its first 200 characters, is now held whole: a bare
 * close tag drops everything before it and what follows is the answer; a tool
 * round drops it; a round with no calls sends it at the end, as the final text
 * keeps it too. Past 2,000 held characters it goes to the thinking fold as it
 * arrives (`think`, the `reasoning` event web2 renders as "Thinking"), so the
 * reader is not left on a blank pane for a whole long round.
 */
const OPENS_ON_THE_USER =
  /^(?:(?:okay|ok|alright|so)[,.]?\s+)?(?:the (?:user|learner)(?:\x27s question|\s+(?:is|was|wants?|wanted|asks?|asked|has|had|needs?|would|seems|just|said|says|mentioned|requested|did)\b)|they\s+(?:want|wanted|asked|are asking|need|would like)\b)/i;
const PLAN_READER_WINDOW = 200;
const PLAN_FOLD_AFTER = 2000;

export function holdPlanningLead(
  emit: (text: string) => void,
  think?: (text: string) => void,
): {
  onDelta: (text: string) => void;
  settle: (toolRound: boolean) => void;
} {
  let held = '';
  /** How much of `held` is whole sentences already judged to be a plan. */
  let planned = 0;
  let passing = false;
  /** Held whole: the round opened on the user or a plan and did not speak to the reader. */
  let thinking = false;
  /** How much of `held` has gone to the thinking fold. */
  let folded = 0;
  const release = (): void => {
    passing = true;
    if (held !== '') emit(held);
    held = '';
  };
  const opensOnThought = (s: string): boolean => OPENS_ON_A_PLAN.test(s) || OPENS_ON_THE_USER.test(s);
  /** A bare close tag: the text before it was thinking, what follows is the answer. */
  const closed = (): boolean => {
    const close = held.toLowerCase().indexOf(THINK_CLOSE);
    if (close === -1) return false;
    if (think && folded > 0 && close > folded) think(held.slice(folded, close));
    held = held.slice(close + THINK_CLOSE.length).replace(/^\s+/, '');
    release();
    return true;
  };
  const fold = (): void => {
    if (!think || held.length < PLAN_FOLD_AFTER) return;
    /* A tail that could still be the close tag waits for the rest of it. */
    let keep = 0;
    for (let k = Math.min(held.length, THINK_CLOSE.length - 1); k >= 1; k -= 1) {
      if (THINK_CLOSE.startsWith(held.slice(-k).toLowerCase())) {
        keep = k;
        break;
      }
    }
    const upTo = held.length - keep;
    if (upTo > folded) think(held.slice(folded, upTo));
    folded = Math.max(folded, upTo);
  };
  return {
    onDelta: (text) => {
      if (passing) {
        emit(text);
        return;
      }
      held += text;
      if (closed()) return;
      if (thinking) {
        fold();
        return;
      }
      const opening = held.trimStart();
      if (opensOnThought(opening) && !ADDRESSES_THE_READER.test(opening.slice(0, PLAN_READER_WINDOW))) {
        if (opening.length >= PLAN_READER_WINDOW) {
          thinking = true;
          fold();
        }
        return;
      }
      for (;;) {
        const tail = held.slice(planned);
        const lead = tail.trimStart();
        if (lead === '') return;
        const end = /[.!?…:](?=\s)|\n/.exec(lead);
        if (end === null) {
          /* Still inside the first words: hold while they could open a plan. */
          if (lead.length > 40 && !OPENS_ON_A_PLAN.test(lead)) release();
          return;
        }
        if (!OPENS_ON_A_PLAN.test(lead)) {
          release();
          return;
        }
        planned += tail.length - lead.length + end.index + end[0].length;
      }
    },
    settle: (toolRound) => {
      if (passing) return;
      const tail = held.slice(planned);
      /* In a tool round an unfinished sentence that opens on a plan goes too;
         so does a round held whole, and one that opened on the user. */
      if (toolRound) held = thinking || tail.trim() === '' || opensOnThought(tail.trimStart()) ? '' : tail;
      release();
    },
  };
}

/**
 * The bounce problems that are about the SHAPE of a lesson — its length or its
 * closing question — and not about what it claims. An answer bounced only for
 * these was a real answer; one bounced for citing a file nobody read was not.
 */
export function isShapeOnlyBounce(problems: readonly string[]): boolean {
  return (
    problems.length > 0 &&
    problems.every((p) =>
      /^your reply is \d+ words|^your reply does not END with|^your reply ends (?:with a question, but not|by OFFERING)|^your closing question copies/.test(p),
    )
  );
}

/** The one line that says the kept answer is the earlier one, and why. */
export const KEPT_ANSWER_NOTE =
  '(The rewrite the lesson contract asked for came back as the model planning, not answering, ' +
  'so this is the answer written before it; it was sent back only for its length or its closing question.)';

/*
 * ══ A TOOL CALL IS NEVER STREAMED AS TEXT (2026-09-22) ══════════════════════
 *
 * r1's deltas carried the model's tool fences verbatim, so a reader watching the
 * stream saw the call's JSON as chat text until the final answer replaced it.
 * The final text was always stripped (`parseAllToolRequests`); the stream was
 * not. This holds back any text that could still turn out to open a tool block
 * — three backticks, the fenced label on the same line or the next, or the
 * tagged form — until it is known either way, drops the block, and lets every
 * other fence (a code sample) through unchanged.
 */
const TOOL_LABEL = 'sequence-tool';
const TOOL_TAG_OPEN = `<${TOOL_LABEL}>`;
const TOOL_TAG_CLOSE = `</${TOOL_LABEL}>`;
const FENCE = '\x60\x60\x60';

export function holdToolFences(emit: (text: string) => void): {
  onDelta: (text: string) => void;
  flush: () => void;
} {
  let pending = '';
  /** Inside a tool block: the text that ends it. */
  let closer: string | null = null;
  const tailThatCouldOpen = (s: string): number => {
    for (let k = Math.min(s.length, TOOL_TAG_OPEN.length - 1); k >= 1; k -= 1) {
      const tail = s.slice(-k);
      if (TOOL_TAG_OPEN.startsWith(tail) || FENCE.startsWith(tail)) return k;
    }
    return 0;
  };
  /* After three backticks: could the label still arrive (same line or next)? */
  const couldStillBeTool = (s: string): boolean => {
    const m = /^\x60{3}[ \t]*(?:\r?\n[ \t]*|\r)?([\s\S]*)$/.exec(s);
    return m !== null && TOOL_LABEL.startsWith(m[1]!);
  };
  const drain = (final: boolean): void => {
    for (;;) {
      if (closer !== null) {
        const end = pending.indexOf(closer);
        /* An unclosed block at the end is a call cut off: still a call. */
        if (end === -1) {
          if (final) pending = '';
          return;
        }
        pending = pending.slice(end + closer.length);
        closer = null;
        continue;
      }
      const fence = pending.indexOf(FENCE);
      const tag = pending.indexOf(TOOL_TAG_OPEN);
      const at = fence === -1 ? tag : tag === -1 ? fence : Math.min(fence, tag);
      if (at === -1) {
        const hold = final ? 0 : tailThatCouldOpen(pending);
        if (pending.length > hold) emit(pending.slice(0, pending.length - hold));
        pending = pending.slice(pending.length - hold);
        return;
      }
      if (at > 0) emit(pending.slice(0, at));
      pending = pending.slice(at);
      if (pending.startsWith(TOOL_TAG_OPEN)) {
        pending = pending.slice(TOOL_TAG_OPEN.length);
        closer = TOOL_TAG_CLOSE;
        continue;
      }
      const opened = /^\x60{3}[ \t]*(?:\r?\n[ \t]*)?sequence-tool/.exec(pending);
      if (opened) {
        pending = pending.slice(opened[0].length);
        closer = `\n${FENCE}`;
        continue;
      }
      if (!final && couldStillBeTool(pending)) return;
      emit(FENCE);
      pending = pending.slice(FENCE.length);
    }
  };
  return {
    onDelta: (text) => {
      pending += text;
      drain(false);
    },
    flush: () => drain(true),
  };
}

/*
 * ══ A THINK BLOCK IS HELD LIKE A FENCE (Slice 10, 2026-09-23) ═══════════════
 *
 * Fifth measurement, r6: call 3 streamed ~10,661 characters of the model's
 * reasoning as chat text — "Okay, the user is teaching me about this app from
 * the root. … </think>" — before the answer after it. The final text was
 * always cut (`withoutLeakedThinking`); the stream was not. So text from a
 * think tag, or from a bare reasoning opener ("Okay, the user …") that has not
 * spoken to the reader within its first 200 characters, is held until the
 * close tag and dropped. A bare opener that turns to the reader is sent on; one
 * that never closes is sent at the end, as the final text keeps it too.
 */
const BARE_THINK_OPENER = /^(?:okay|ok|alright|hmm+)[,.]?\s+(?:so,?\s+)?(?:the user\b|let me\b|let's\b|i need\b|i should\b)/i;
const THINK_READER_WINDOW = 200;

export function holdThinking(emit: (text: string) => void): {
  onDelta: (text: string) => void;
  flush: () => void;
} {
  let pending = '';
  /** `lead`: the round's first words, undecided. `bare`: a bare opener, held. `think`: inside a tag. */
  let mode: 'lead' | 'pass' | 'bare' | 'think' = 'lead';
  const tailThatCouldOpen = (s: string): number => {
    for (let k = Math.min(s.length, THINK_OPEN.length - 1); k >= 1; k -= 1) {
      if (THINK_OPEN.startsWith(s.slice(-k).toLowerCase())) return k;
    }
    return 0;
  };
  const drain = (final: boolean): void => {
    for (;;) {
      if (mode === 'think' || mode === 'bare') {
        const close = pending.toLowerCase().indexOf(THINK_CLOSE);
        if (close !== -1) {
          pending = pending.slice(close + THINK_CLOSE.length).replace(/^\s+/, '');
          mode = 'pass';
          continue;
        }
        if (mode === 'bare') {
          const window = pending.trimStart().slice(0, THINK_READER_WINDOW);
          if (ADDRESSES_THE_READER.test(window) || final) {
            mode = 'pass';
            continue;
          }
        } else if (final) pending = '';
        return;
      }
      if (mode === 'lead') {
        const lead = pending.trimStart();
        if (lead.toLowerCase().startsWith(THINK_OPEN)) {
          pending = lead.slice(THINK_OPEN.length);
          mode = 'think';
          continue;
        }
        if (BARE_THINK_OPENER.test(lead)) {
          mode = 'bare';
          continue;
        }
        /* Still inside the first words: hold while they could open either. */
        if (!final && lead.length < 24 && !/[.!?\n]/.test(lead)) return;
        mode = 'pass';
        continue;
      }
      /* Passing: a think tag later in the round is held from where it opens. */
      const open = pending.toLowerCase().indexOf(THINK_OPEN);
      if (open !== -1) {
        if (open > 0) emit(pending.slice(0, open));
        pending = pending.slice(open + THINK_OPEN.length);
        mode = 'think';
        continue;
      }
      const hold = final ? 0 : tailThatCouldOpen(pending);
      if (pending.length > hold) emit(pending.slice(0, pending.length - hold));
      pending = pending.slice(pending.length - hold);
      return;
    }
  };
  return {
    onDelta: (text) => {
      pending += text;
      drain(false);
    },
    flush: () => drain(true),
  };
}

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
  /* Whether a plan document reached the Plan tab this turn — read by the
     planning floor after the loop. Watched here because every writer's event
     passes through this one function. */
  let planDocLanded = false;
  /* Whether a chart with steps — a flow the canvas can play — landed this turn.
     Watched here for the same reason: every chart, the model's or the floor's,
     passes through this one function (Slice 10, 2026-09-23). */
  let flowChartLanded = false;
  const push = (event: AskStreamEvent): void => {
    if (event.type === 'canvas:block' && event.surface === PLAN_SURFACE && event.blockType === 'markdown') {
      planDocLanded = true;
    }
    if (event.type === 'chart:proposal' && (event.chart.steps?.length ?? 0) > 0) flowChartLanded = true;
    emit?.(event);
  };
  /* The worker's thinking reaches the reader; the advisor's never does, for
     the same reason its tokens do not stream (see the worker call below). */
  const pushReasoning = (text: string): void => {
    if (text) push({ type: 'reasoning', text });
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
    /*
     * THE SAME PREDICATE THE BELT USES, so the prompt and the belt cannot
     * disagree about whether this turn is a lesson (see AskComposition.teach).
     * `isTeachTurn`, not `input.teach` — a teach-SHAPED question with the
     * toggle off is a lesson too, and that rule already has one home.
     */
    teach: isTeachTurn(input),
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
  /* A LEAN PRODUCT TURN (SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST=1): with a README in hand, the
     structure digest is dropped. 2026-09-25: 50 of 76 product answers ignored the skeleton, and 40
     of those talked about "the scan" instead of the product. */
  const leanProduct = leanProductTurn(input);
  if (leanProduct) {
    basePrompt = buildAskPrompt(EMPTY_DIGEST, input.question, compose);
  } else if (input.digest && input.graph) {
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
  /* The closing example names a real part of THIS repository (2026-09-22); the
     grader below is handed the same sentence, so a copy of it is caught. */
  const exampleLabel = teachExampleLabel(input.graph);
  const closingExamples = [teachPredictionExample(exampleLabel)];
  /*
   * THE LESSON'S FIRST TURN IS HANDED ITS EVIDENCE (Slice 8a, 2026-09-23).
   *
   * The third measurement: with thinking off the 7B model stops digging —
   * "trace_flow 0/6; r5 answered in 3.2 s with no tool call" — and no answer
   * reached the model hop or the gates. So on the root overview, with a scan,
   * the harness runs the services brief, a trace from each service's entry
   * file and from each part the question names, and the first lines of the
   * deepest hop's file, BEFORE the first call. Gathered here, above the belt,
   * because the belt's one-line pointer at the section is rendered only when
   * the section exists. Not on a subject the scan does not hold: that turn is
   * told to cite nothing from this repository.
   */
  const teachEvidence =
    input.teach === true &&
    input.graph &&
    !input.designMode &&
    input.teachContext?.subjectNotInRepo !== true &&
    isRootOverviewTurn(input.teachContext, input.question)
      ? await gatherTeachEvidence(
          {
            resolveReadable: input.resolveReadable,
            repoRoot: input.repoRoot ?? null,
            designMode: input.designMode,
            question: input.question,
            ...(input.jobMode !== undefined ? { jobMode: input.jobMode } : {}),
            ...(input.permission !== undefined ? { permission: input.permission } : {}),
            permissions,
            autoApprove,
            graph: input.graph,
            digest: input.digest ?? null,
            seenEdgeKeys: new Set<string>(),
          },
          input.question,
        )
      : undefined;
  const evidenceGathered = teachEvidence !== undefined && teachEvidence.text !== '';
  const instructionBelt = renderAskInstructionBelt({
    ...input,
    proposeArchitecture: input.design?.proposeArchitecture === true,
    ...(exampleLabel !== undefined ? { teachExampleLabel: exampleLabel } : {}),
    ...(evidenceGathered ? { teachContext: { ...(input.teachContext ?? {}), evidence: true } } : {}),
  });
  let promptWithTools =
    instructionBelt.length > 0 ? `${basePrompt}\n\n${instructionBelt}` : basePrompt;
  if (carryAfterBelt !== '') promptWithTools = `${promptWithTools}\n\n${carryAfterBelt}`;
  /*
   * ── THE GOAL SECTION, AND WHY IT IS LAST ─────────────────────────────────
   *
   * After the instruction belt and after the carry, i.e. as close to generation
   * as the invariant prefix gets. A standing instruction placed above the tool
   * belt is read, then buried under several thousand characters of tool
   * grammar; placed here it is the last thing before the evidence and the
   * question. `todoList.ts` makes the same argument for its own list and puts
   * it above the evidence for the same reason.
   *
   * IT IS PART OF THE INVARIANT PREFIX, not of the per-round tail: the goal and
   * plan do not change between rounds of one turn unless a plan tool moved them,
   * and `lastToolSectionText` is what the loop rebuilds each round. Keeping it
   * here means it is inside the prompt-cache breakpoint the loop hands the
   * provider (`cacheBreakpointChars: promptWithTools.length`) — a section that
   * moved every round would invalidate that cache on every round.
   *
   * EMPTY GOAL AND EMPTY PLAN ⇒ NOTHING IS APPENDED, so every session without a
   * goal assembles a prompt byte-identical to one built before this feature
   * existed. That is the property `goal-prompt.test.ts` locks.
   */
  /*
   * THE SESSION'S PLAN, WHICH IS NOT INITIALISED EMPTY.
   *
   * Every other per-turn holder in this function starts at zero because it
   * describes THIS TURN. This one starts at whatever the session already has,
   * because it describes the JOB — and that single difference is the whole
   * long-running feature. A weaker model cannot hold a twenty-step job across
   * twenty turns; it does not have to, because the job is on disk and the turn
   * is handed one step of it.
   *
   * Absent goal context ⇒ `[]` ⇒ no plan section, no plan tools, and a prompt
   * byte-identical to one built before this existed.
   */
  let planThisTurn: PlanStep[] = [...(input.goal?.plan ?? [])];
  const goalSection =
    input.goal === undefined
      ? []
      : renderGoalSection({
          ...(input.goal.goal === undefined ? {} : { goal: input.goal.goal }),
          plan: planThisTurn,
          runLive: input.goal.runLive,
          ...(input.goal.aimingAt === undefined ? {} : { aimingAt: input.goal.aimingAt }),
          ...(input.goal.audit === true ? { audit: true } : {}),
          ...(input.goal.planDocument ? { planDocument: input.goal.planDocument } : {}),
        });
  if (goalSection.length > 0) {
    promptWithTools = `${promptWithTools}\n\n${goalSection.join('\n')}`;
  }

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
    /* Only when there is no repository — with one attached, the repo IS the
       place files come from and a second root would be ambiguous. */
    workspaceRoot: input.repoRoot == null ? (input.workspaceRoot ?? null) : null,
    /* The ids the prompt listed, so the executor and the prompt agree. */
    canvasBlockIds: (input.surface?.canvas?.blocks ?? []).map((b) => b.id),
    /* The board the writers validate against. A getter for the same reason
       `todos` is one: the context is built once per TURN, and the board grows
       within it. */
    get boardKnown() {
      return boardKnownThisTurn;
    },
    /* A getter, not a snapshot: this context object is built once per TURN and
       `update_todos` may be called in any round, so a captured array would go
       stale after the first call and every later diff would compare against
       round one. */
    get todos(): readonly TodoItem[] {
      return todosThisTurn;
    },
    /* A getter for the same reason, and one more: the plan is SESSION state,
       not turn state, so `mark_step_done` in round seven must see the plan as
       `write_plan` left it in round two. A snapshot taken when this context was
       built would let the model tick a step off a plan that no longer exists. */
    get goalPlan(): readonly PlanStep[] {
      return planThisTurn;
    },
    /*
     * PERSIST BEFORE THE RESULT GOES BACK. The runner re-reads the plan from
     * DISK before every turn, so a tick that lives only in this closure means
     * the next turn aims at the step that was just finished. `askTools.ts`
     * carries the full argument on the field.
     */
    ...(input.persistPlan ? { persistPlan: input.persistPlan } : {}),
    /* A getter for the reason `todos` is one: the context is built once per
       TURN and the chart may land in any round of it. */
    get drawnPartIds(): readonly string[] {
      return drawnPartIdsThisTurn;
    },
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
    /* One per turn: an edge `read_topology` showed once is a count after that. */
    seenEdgeKeys: new Set<string>(),
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
  /* ONE clock for the turn: the loop's top-of-round check and the two rounds
     after the loop (the answer rescue, the forced draw) all read this. */
  const pastTurnDeadline = (): boolean =>
    turnDeadlineMs !== undefined && Date.now() - wallStartedAt >= turnDeadlineMs;
  process.stderr.write(
    `sequence: ask seat permission=${input.permission ?? 'unset'} turnDeadlineMs=${turnDeadlineMs}\n`,
  );

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
  /*
   * THE WORK LIST FOR THIS TURN. Empty until the model calls `update_todos`, so
   * every turn that does not is byte-identical to one built before this
   * existed — no section in the prompt, no event on the wire.
   */
  let todosThisTurn: TodoItem[] = [];
  /* `planThisTurn` is the sibling of this holder and is declared ABOVE, with
     the prompt assembly, because the goal section is rendered from it before
     the rounds loop starts. See its comment there for why it is the one holder
     that does NOT start empty. */
  /* The picture's own parts, so a walk in a LATER round of the same turn is
     checked against the chart that was drawn in an earlier one. */
  let drawnPartIdsThisTurn: string[] = [];
  /* Seeded from what the CLIENT says is on the board, then grown as this turn
     draws. `input.surface.board` is capped at forty for the PROMPT; the ids
     still all arrive, which is what the duplicate check needs. */
  const boardKnownThisTurn = {
    nodeIds: (input.graph?.nodes ?? []).map((n) => n.id),
    items: (input.surface?.board?.items ?? []).map((i) =>
      i.at ? { id: i.id, at: i.at } : { id: i.id },
    ),
  };
  /** True when the permission circuit breaker stopped the loop. */
  let trippedBreaker = false;
  /** Per-turn cache for identical read-tool args — skips re-exec in later rounds. */
  const toolResultCache = new Map<string, AskToolResult>();
  /** One successful propose_topology per turn. */
  let topologySucceededThisTurn = false;
  /** One successful canvas.write_* per turn. */
  let canvasWriteSucceededThisTurn = false;
  /** A canvas block that {@link countsAsTeachDrawing} — a diagram, not a note. */
  let teachCanvasDrawingThisTurn = false;
  /** One successful propose_files per turn (B1.4). */
  let filesProposalSucceededThisTurn = false;
  /** File-edit calls spent this turn — the consequence budget under auto-writes. */
  let fileWriteCallsThisTurn = 0;
  /** Paths that reached disk this turn — see `AskToolRoundSink.writtenFilesThisTurn`. */
  const writtenFilesThisTurn: string[] = [];
  /** Of those, the ones that already existed — see the sink field's comment. */
  const modifiedExistingThisTurn: string[] = [];
  /** Every `trace_flow` that succeeded this turn — the flow the teach floor draws first. */
  const traceFlowsThisTurn: AnswerFlowTrace[] = [];
  /** One corrective make-the-change nudge per turn (edit intent, auto-writes). */
  let editNudgeSpent = false;
  let lastChanceDiffSpent = false;
  let teachBounces = 0;
  /** The draft the one bounce sent back, so a retry identical to it is not graded again. */
  let bouncedDraft: string | undefined;
  /* See repeatsLastAnswer: hot retries spent on a draft that repeats the last answer. */
  let repeatRetries = 0;
  let retryHot = false;
  /* See missingProductParts: the section-check retry and the draft it would fall back to. */
  let sectionRetries = 0;
  let sectionBest: { text: string; missing: number } | undefined;
  /** The harness settled on a draft (`settleClose`): the check-in is held when its close already asks the reader. */
  let settledOnDraft = false;
  /** The fullest answer the grader sent back only for its shape — see `isShapeOnlyBounce`. */
  let keptAnswer: string | undefined;
  /** The notes for the citations repaired in `keptAnswer`, so a restored answer carries them. */
  let keptNotes: string[] = [];
  /** What the grader repaired in the answer, said once after it (`unreadCitationNote`, `routeNote`). */
  let teachRepairNotes: string[] = [];
  let chartsThisTurn = 0;
  /** See `AskToolRoundSink.chartsDrawnThisTurn`. The array itself is shared with every round. */
  const chartsDrawnThisTurn: SeqChart[] = [];
  /** What this turn DREW, in order — the rows the ends-in-words line is built from. */
  const artefactsThisTurn: TurnArtefact[] = [];
  /** See `AskToolRoundSink.referentsThisTurn`. */
  let referentsThisTurn: { tool: string; subject: string; items: readonly string[]; total: number } | undefined;
  /* The last picture this turn put on screen, model-authored or derived. The
     derived check-in asks about what the learner can see. */
  let lastChartThisTurn: SeqChart | undefined;
  /** Basenames of files actually read this turn — the teach grader's receipts. */
  const filesReadThisTurn = new Set<string>();
  /** The same files as repo paths, so a citation is checked by its path (2026-09-23). */
  const pathsReadThisTurn = new Set<string>();
  /** What the harness handed the first prompt — see {@link AskEvidenceSummary}. */
  let evidenceAttached: AskEvidenceSummary | undefined;
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
  /*
   * ROUTE BEFORE STOP (wave A3). One steer per turn: when the unproductive
   * count would end the turn, the model is first told what repeated and asked
   * to change one thing; the stop follows only if the next round repeats. The
   * signatures of each round's calls are what "repeated" is measured on.
   */
  let steeredThisTurn = false;
  const roundCallSignatures: string[][] = [];
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
  /** Why the provider stopped on the round that produced the answer. */
  let lastFinishReason: string | undefined;

  /*
   * ── THE AUTO SEED (carrying-harness plan, wave B4) ───────────────────────
   *
   * Before round one, on a turn that can reach the board and has a scan, the
   * HARNESS places the frame: one card per service in the ask's scope, with
   * the scan's own node ids, and the edges between them, laid out by the
   * deterministic lane layout (`boardSeed.ts` says why each of those is the
   * harness's job and not the model's). The model then annotates and patches
   * BY ID rather than inventing coordinates — the failure measured on the
   * owner walk, where a small model asked to draw four services drew four
   * boxes at the origin.
   *
   * SAME CHANNEL AS THE MODEL'S OWN MARKS: a `board:item` event, and the
   * seeded ids join `boardKnownThisTurn` so `board.connect` can reach them in
   * the same turn. The note goes in the evidence ledger at round 0, exactly as
   * the harness pre-read does, so the transcript never claims the model asked.
   */
  const boardSeedOn =
    boardKnownThisTurn.nodeIds.length > 0 &&
    input.digest !== undefined &&
    !isPlotOrMathDrawAsk(input.question) &&
    (input.surface?.id === 'task-board' ||
      input.surface?.id === 'ai-canvas' ||
      isDrawishAskQuestion(input.question));
  if (boardSeedOn) {
    const seed = seedBoardFromDigest({
      digest: input.digest!,
      question: input.question,
      subjectNodeId,
      known: boardKnownThisTurn.items,
    });
    if (seed && seed.items.length > 0) {
      push({ type: 'board:item', items: seed.items });
      for (const item of seed.items) {
        boardKnownThisTurn.items = [
          ...boardKnownThisTurn.items,
          'at' in item ? { id: item.id, at: item.at } : { id: item.id },
        ];
      }
      artefactsThisTurn.push({ kind: 'board', label: String(seed.items.length) });
      evidenceLedger.push({ round: 0, body: seed.note });
      lastToolSectionText = renderToolResultsSection(
        selectCarriedEvidence(evidenceLedger, 0, evidenceLedgerCap),
      ).join('\n');
      prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
    }
  }
  /*
   * THE GATHERED EVIDENCE, AS ROUND-ZERO RESULTS (Slice 8a, 2026-09-23).
   *
   * In the ledger rather than on the invariant prefix: it reaches the first
   * call like the pre-read does, rides later rounds of THIS turn while the
   * ledger has room (a bounce that says "grounded ONLY in files you have read"
   * is answered with it still in view), and no later turn repeats it. Its tool
   * calls go in the cache, so a repeat call reads "(cached)", and its files
   * count as read for the grader's "cited WITHOUT reading" rule.
   */
  /* Which traces the harness gathered, so the floor takes an aimed path before
     the model's own and those before the entry traces (fourth measurement,
     2026-09-23: all six charts opened on the side hop `client.ts → hwdetect.py`). */
  const gatheredFlows = new Set<AnswerFlowTrace>();
  if (teachEvidence && evidenceGathered) {
    for (const c of teachEvidence.calls) {
      toolResultCache.set(stableAskToolCacheKey(c.name, c.args), c.result);
      /* A trace the harness gathered is a trace this turn: the floor draws it
         hop by hop instead of scanned order (third measurement, 2026-09-23:
         all six floor charts were scanned order because no run had a trace). */
      if (c.result.flow !== undefined && !traceFlowsThisTurn.includes(c.result.flow)) {
        traceFlowsThisTurn.push(c.result.flow);
        gatheredFlows.add(c.result.flow);
      }
    }
    for (const f of teachEvidence.sources) {
      const base = f.split('/').pop();
      if (base) filesReadThisTurn.add(base.toLowerCase());
      pathsReadThisTurn.add(f);
    }
    evidenceLedger.push({ round: 0, body: teachEvidence.text });
    /* Said on the result, so the battery can see what the first prompt carried. */
    evidenceAttached = {
      chars: teachEvidence.text.length,
      sources: [...teachEvidence.sources],
      hops: [
        ...new Set(
          teachEvidence.calls.flatMap((c) => (c.result.flow?.hops ?? []).map((h) => `${h.from}>${h.to}`)),
        ),
      ],
    };
    lastToolSectionText = renderToolResultsSection(
      selectCarriedEvidence(evidenceLedger, 0, evidenceLedgerCap),
    ).join('\n');
    prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
  }

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
    const roundLead = holdPlanningLead((t) => push({ type: 'delta', text: t }), pushReasoning);
    const roundDeltas = holdToolFences(roundLead.onDelta);
    /* Thinking streamed as content is held before anything else reads it (`holdThinking`). */
    const roundThought = holdThinking(roundDeltas.onDelta);
    try {
      call = await input.callProvider(
        retryHot ? { ...workerCfg, params: { ...workerCfg.params, temperature: REPEAT_RETRY_TEMPERATURE } } : workerCfg,
        prompt,
        roundThought.onDelta,
        { cacheBreakpointChars: promptWithTools.length, onReasoning: pushReasoning },
      );
    } catch (e) {
      if (providerCallMs.length === 0) throw e; // nothing established yet — fail loudly
      providerFailedMidTurn = e instanceof Error ? e.message : String(e);
      break; // `text` still holds the last completed round; the exit funnel reports the cut
    } finally {
      roundThought.flush();
      roundDeltas.flush();
    }
    providerCallMs.push(Date.now() - callStarted);
    /* THE LAST CALL IS THE ONE THAT WROTE THE ANSWER, so the last reason is
       the one that describes it. Earlier rounds end on `tool_calls` by
       design and say nothing about whether the prose finished. */
    lastFinishReason = call.finishReason;
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
    /* Thinking that leaked into the content is never the answer (see
       `withoutLeakedThinking`); the calls inside it were parsed above. */
    text = withoutLeakedThinking(text);
    /* Structured tool_calls never pass through the fence parser, so their
       arguments are repaired here (wave A1); fenced ones already carry theirs. */
    const toolRequests: AskToolRequest[] = mergeToolRequests(
      repairAskToolRequests(call.toolRequests ?? []),
      parsedTools.requests,
    );
    /* A planning lead is dropped from the stream once the round is known to be a
       tool round (`holdPlanningLead`); a malformed call counts, it was one too. */
    roundLead.settle(toolRequests.length > 0 || parsedTools.malformed.length > 0);

    /*
     * TWO WAYS TO RUN OUT, AND THEY ARE DIFFERENT EVENTS.
     *
     * `atCeiling` is the backstop: every round was genuinely novel and the
     * model still has not finished. `spentOnNothing` is the common one: the
     * last few rounds brought back only material already in the ledger, so
     * another provider call is money spent to be told the same thing again.
     */
    const atCeiling = rounds >= roundCap;
    let spentOnNothing = unproductiveRounds >= unproductiveLimit;
    /*
     * ROUTE BEFORE STOP — wave A3 of docs/research/carrying-harness-plan.md.
     *
     * The unproductive rule is the right rule for a model going in circles,
     * and it used to end the turn without a word: the model was never told
     * that it was repeating itself, so on a small model the same call came
     * back on the next turn too. One steer, once per turn, names what
     * repeated and asks for one changed variable — a different tool, target
     * or path — or an answer from the evidence already held. It costs no
     * round of its own: it rides into the prompt of the round that follows,
     * and the counter is set so that one more barren round ends the turn on
     * the usual terms. A steer never counts as a strike in a goal run,
     * because it makes no tool call.
     */
    /* ONLY WHEN THE MODEL ASKED FOR TOOLS AGAIN: a reply with no tool calls is
       the model answering, and steering an answer is noise on the wire. */
    if (spentOnNothing && toolRequests.length > 0 && !steeredThisTurn && !atCeiling && rounds > 0) {
      steeredThisTurn = true;
      spentOnNothing = false;
      unproductiveRounds = Math.max(0, unproductiveLimit - 1);
      const recent = roundCallSignatures.slice(-unproductiveLimit);
      const counts = new Map<string, number>();
      for (const sigs of recent) for (const s of new Set(sigs)) counts.set(s, (counts.get(s) ?? 0) + 1);
      const repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
      const steerId = `harness-steer-${rounds}`;
      const steer =
        `### harness steer (round ${rounds}): the last ${recent.length} round${recent.length === 1 ? '' : 's'} ` +
        `brought back nothing new` +
        (repeated.length > 0
          ? ` — you repeated ${repeated.slice(0, 4).join(', ')}`
          : ' — every result was already in the evidence above') +
        `. Do not make a call whose result is already above. Change ONE thing: a different tool, ` +
        `a different target or path, or a different question of the evidence. If the evidence ` +
        `above already answers the question, stop calling tools and answer now.`;
      push({ type: 'tool:start', id: steerId, name: 'steer' });
      push({ type: 'tool:done', id: steerId, name: 'steer', evidence: steer });
      evidenceLedger.push({ round: rounds, body: steer });
      lastToolSectionText = renderToolResultsSection(
        selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
      ).join('\n');
      const steerTodo = renderTodoSection(todosThisTurn);
      const steerTodoText = steerTodo.length === 0 ? '' : `${steerTodo.join('\n')}\n\n`;
      prompt = withBudgetCheck(`${promptWithTools}

${steerTodoText}${lastToolSectionText}`);
    }
    /*
     * THE THIRD WAY TO RUN OUT, and the only one the waiting reader can feel.
     * Checked HERE -- at the top of the loop, before another round is started --
     * so the deadline never interrupts a call already in flight. The round that
     * was running when the clock passed is finished and its evidence kept.
     */
    const outOfTime = pastTurnDeadline();
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
     * Measured on SWE-bench (django-11790, granite4-hermes, Build,
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
       * A REWRITE THAT IS ONLY PLANNING DOES NOT REPLACE THE ANSWER IT WAS ASKED
       * TO FIX (2026-09-22). r1 of the owner's re-measure: the bounce's retry came
       * back "I need to ground my explanation in actual file contents. Let me read
       * the key files first." and the lesson before it was thrown away. When that
       * lesson was sent back only for its length or its closing question, it is
       * the better answer, and the note says it is the earlier one.
       */
      /*
       * ONE CLOSING QUESTION, ON EVERY PATH (Slice 12, 2026-09-23). Seventh
       * measurement: r5's kept richer draft was restored ending "Which part would
       * you like to explore next?" and r6's retry stood ending on the belt's own
       * example ("Check-in: which part do you think ml-harness hands off to
       * next?"); neither path ran the closing repair, so the derived check-in
       * followed and each answer ended on two questions. Whatever draft the
       * harness settles on — restored, kept, identical, repaired, or the retry
       * as given — has its closing offer, choice list or copied example taken
       * out here, once, with a note; and the check-in below is held back when
       * its last paragraph already asks the reader.
       */
      const settleClose = (draft: string): string => {
        settledOnDraft = true;
        const closedDraft = removeClosingOffer(draft, closingExamples);
        if (closedDraft.removed !== undefined) teachRepairNotes.push(closingQuestionNote(closedDraft));
        return closedDraft.text;
      };
      let keptRestored = false;
      if (
        input.teach === true &&
        keptAnswer !== undefined &&
        (text.trim() === '' || isPlanningNotAnswer(text))
      ) {
        text = `${settleClose(keptAnswer.trim())}\n\n${KEPT_ANSWER_NOTE}`;
        keptRestored = true;
        teachRepairNotes.push(...keptNotes);
      }
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
      /* A NOTE IS NOT THE LESSON'S DRAWING (2026-09-22): `countsAsTeachDrawing`
         decides here as it does for the forced round, so a markdown block written
         in the main loop no longer stands the floor down. */
      /* A CHART WITH NO STEPS DOES NOT STAND IN FOR THE ASKED-FOR FLOW (Slice 10,
         2026-09-23). Fifth measurement, r6: the model's own system-architecture
         chart, 6 items and 0 steps, stood the floor down, and no flow landed while
         the harness held the path the question aimed at. With an aimed path on
         hand, the floor draws beside a step-less chart. */
      const aimedPathOnHand =
        input.teachContext?.subjectNotInRepo !== true &&
        traceFlowsThisTurn.some((t) => gatheredFlows.has(t) && t.to !== undefined);
      /* A PRODUCT ANSWER KEEPS A PICTURE (blind check 2, 2026-09-24: product mode lost
         19 visual points because the file-chart floor is off and the model rarely
         draws). Its own numbered steps become the flow, when it drew nothing. */
      if (input.teach === true && chartsThisTurn === 0 && teachProductTurn(input)) {
        const stepsChart = productStepsChart(text, input.question);
        if (stepsChart !== undefined) {
          chartsThisTurn += 1;
          lastChartThisTurn = stepsChart;
          artefactsThisTurn.push({ kind: 'chart', label: stepsChart.title });
          push({ type: 'chart:proposal', chart: stepsChart });
        }
      }
      if (
        input.teach === true &&
        (chartsThisTurn === 0 || (aimedPathOnHand && !flowChartLanded)) &&
        /* A product question is answered with the product's flow, not a file chart. */
        !teachProductTurn(input) &&
        !topologySucceededThisTurn &&
        !teachCanvasDrawingThisTurn
      ) {
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
        /*
         * NO CONCEPT NODE IS NOT NOTHING TO DRAW (2026-09-22). The first turn of
         * a broad lesson has no concept node, and it is the root overview that
         * names every part in the order the data moves — so the floor draws that
         * flow from the parts the answer named (`buildAnswerFlowChart`). Not when
         * the subject is not in the repository: the belt told that turn to name
         * no node, and drawing one it named anyway would be the claim it avoided.
         *
         * A TRACE THIS TURN IS THE FLOW (2026-09-22): the re-measure's floor drew
         * the order of mention ("the arrows follow the order the answer gave")
         * while `trace_flow` had returned `app/main.py — 24 hops` in the same
         * turn. The traced hops go first; see `buildAnswerFlowChart`.
         */
        const concept = input.teachContext?.concept;
        const derived =
          input.graph
            ? concept?.nodeId !== undefined
              ? buildConceptChart(input.graph, concept)
              : input.teachContext?.subjectNotInRepo === true
                ? undefined
                : buildAnswerFlowChart(
                    input.graph,
                    text,
                    traceFlowsThisTurn.map((t) => (gatheredFlows.has(t) ? { ...t, gathered: true } : t)),
                    input.question,
                  )
            : (buildPlot(text)?.chart ?? buildExamplePlot(input.question)?.chart);
        if (derived !== undefined) {
          chartsThisTurn += 1;
          lastChartThisTurn = derived;
          artefactsThisTurn.push({ kind: 'chart', label: derived.title });
          push({ type: 'chart:proposal', chart: derived });
        } else if (input.teachContext?.subjectNotInRepo === true || input.graph === undefined) {
          /*
           * THE CASES THE FLOOR ABOVE CANNOT COVER, and there are TWO of them.
           *
           * The first was the only one this branch knew about: a repository IS
           * attached and the subject is not in it, so `buildConceptChart` has
           * no concept to draw. That is Max's own example — "a learner asks
           * what is machine learning and gets the architecture DRAWN, not
           * described".
           *
           * THE SECOND IS NO REPOSITORY AT ALL, added 2026-09-13, and it is the
           * case that example is most often asked in. Measured on the owner's
           * own session: Teach mode, nothing attached, "what is an LLM, break
           * it down for me" — and the answer came back with an `Architecture`
           * heading and NOTHING UNDER IT. Every path was closed at once:
           *
           *   buildConceptChart   needs `input.graph`            — absent
           *   buildPlot           needs an expression in the text — prose
           *   buildExamplePlot    needs a maths topic             — conceptual
           *   drawFromGeneralKnowledge  gated on `subjectNotInRepo`, which
           *     `buildTeachContext` only ever sets when `graph !== undefined`
           *
           * So the one function written for "the learner gets it DRAWN" was
           * unreachable in exactly the state a learner starts in — a fresh
           * window with no repository. The gate was asking "is the subject
           * missing from the repository?" when the question it needed to ask is
           * "did anything else manage to draw?". A guard that names a narrower
           * condition than the thing it protects is this tree's oldest defect
           * shape, and it cost the product its whole teaching advantage on the
           * first question a new user asks.
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
          /*
           * THE RICHER PICTURE IS TRIED FIRST, and the box chart is what it
           * falls back to. Owner, 2026-09-13: three boxes for "how does an LLM
           * work" — "the drawings are horrible". A node-link chart carries
           * labels; a token strip, an attention matrix and a layered stack
           * carry DATA, which is what his references teach with.
           *
           * A refusal is free: `drawTeachingVisual` returns undefined for a
           * subject none of the three shapes fits, or for a spec `visuals.ts`
           * will not draw honestly, and the chart below runs exactly as it did.
           */
          const visual = await drawTeachingVisual(
            input.question,
            (c, p, onDelta, opts) => input.callProvider(c, p, onDelta, opts),
            input.cfg,
          );
          if (visual !== undefined) {
            canvasWriteSucceededThisTurn = true;
            teachCanvasDrawingThisTurn = true; /* an svg picture, drawn by the product */
            artefactsThisTurn.push({ kind: 'canvas', label: `${visual.title} (svg)` });
            push({
              type: 'canvas:block',
              id: `visual-${rounds}`,
              blockType: 'svg',
              title: visual.title,
              payload: visual.payload,
              status: 'landed',
            });
          } else {
            const gk = await drawFromGeneralKnowledge(
              input.question,
              (c, p, onDelta, opts) => input.callProvider(c, p, onDelta, opts),
              input.cfg,
            );
            if (gk !== undefined) {
              chartsThisTurn += 1;
              lastChartThisTurn = gk;
              artefactsThisTurn.push({ kind: 'chart', label: gk.title });
              push({ type: 'chart:proposal', chart: gk });
            }
          }
        }
      }
      if (input.teach === true && text.trim().length > 0 && !keptRestored) {
        const basenames: Set<string> | null = input.graph
          ? new Set(
              input.graph.nodes
                .map((n) => (n.label ?? n.id).replace(/\\/g, '/').split('/').pop()!.toLowerCase())
                .filter((b) => b.includes('.')),
            )
          : null;
        const overviewTurn = isRootOverviewTurn(input.teachContext, input.question);
        const citePaths: CitationPaths = {
          read: pathsReadThisTurn,
          scan: new Set(
            (input.graph?.nodes ?? []).flatMap((n) =>
              n.kind === 'file' && typeof n.path === 'string' ? [n.path.replace(/\\/g, '/')] : [],
            ),
          ),
          /* A file the scan skipped is still a file (2026-09-23, `docs/diagnosis_engine.yaml`). */
          onDisk: (rel) => {
            try {
              const abs = input.resolveReadable(rel);
              return abs !== null && fs.statSync(abs).isFile();
            } catch {
              return false;
            }
          },
        };
        const problems = gradeTeachTurn(
          text,
          basenames,
          filesReadThisTurn,
          chartsThisTurn > 0 || canvasWriteSucceededThisTurn,
          overviewTurn,
          closingExamples,
          citePaths,
        )
          /* 2026-09-23: a comprehension question mid-lesson is what the mode
             wants. r1 was bounced for one and ended on its thinner retry. */
          .filter((p) => !MID_LESSON_QUESTION_PROBLEM.test(p));
        const repeated = repeatsLastAnswer(text, input.historyLines);
        /* THE FIVE PARTS (SEQUENCE_TEACH_PRODUCT_SECTIONS=1): one hot retry names the missing
           parts, and the draft with more parts ships. */
        const productParts = productSectionsCheckEnabled() && teachProductTurn(input) ? missingProductParts(text) : [];
        if (sectionBest !== undefined && productParts.length > sectionBest.missing) {
          text = sectionBest.text;
        }
        /*
         * REPAIR FIRST, BOUNCE ONCE, NEVER END THINNER (2026-09-23; see
         * `unreadCitations`, `misplacedCitations`, `removeClosingOffer` and
         * `teachOneChange`). A lesson whose only faults are ones the harness can
         * repair — a file it did not read, a file at the wrong path, a closing
         * question that offers a choice or is missing — is repaired in place and
         * accepted, at no round: the check-in derived from the picture is
         * appended below. Any other fault is sent back once, for one change, with
         * the draft to keep; and when the retry fails too and is shorter than the
         * fullest draft sent back for its shape, that draft is the answer.
         */
        const unread = unreadCitations(text, basenames, filesReadThisTurn, citePaths);
        const misplaced = misplacedCitations(text, basenames, citePaths);
        const marked = markUnreadCitations(repairMisplacedCitations(text, misplaced), unread, citePaths);
        const citeNotes = [
          ...(misplaced.moved.length + misplaced.unscanned.length > 0 ? [misplacedCitationNote(misplaced)] : []),
          ...(unread.length > 0 ? [unreadCitationNote(unread)] : []),
        ];
        const rest = problems.filter(
          (p) => !UNREAD_CITATION_PROBLEM.test(p) && !MISPLACED_CITATION_PROBLEM.test(p),
        );
        const closingFaults = rest.filter((p) => CLOSING_CHECK_PROBLEM.test(p));
        const closed = removeClosingOffer(marked, closingExamples);
        /* The check-in appended below needs a picture to ask about, and a turn
           that did not run out (`checkInGate`). */
        const closable =
          closingFaults.length === 0 ||
          gradeCheckIn(closed.text, closingExamples).endsWithCheck ||
          ((deriveCheckIn(lastChartThisTurn) ?? deriveFlowCheckIn(lastChartThisTurn)) !== undefined &&
            !atCap &&
            closed.text.trim().split(/\s+/).length > TEACH_STUB_WORDS);
        /*
         * A RETRY THAT IS THE DRAFT IS NOT RE-GRADED (Slice 11, 2026-09-23).
         * Sixth measurement, r3: the retry came back byte-identical, the harness
         * graded it again and appended its check-in, and the answer ended on
         * three questions ("Did this make sense so far? Which part do you think
         * ml-harness hands off to next?" and then "Looking at the picture: …").
         * The draft stands with the repairs that cost no call, and the check-in
         * below is held back when its last paragraph already asks the reader.
         */
        if (!repeated && productParts.length > 0 && sectionRetries < 1 && !atCap) {
          sectionRetries += 1;
          sectionBest = { text, missing: productParts.length };
          retryHot = true;
          rounds++;
          const bounce =
            `### harness: your answer to "${input.question}" is missing: ${productParts.join('; ')}. ` +
            'Write the whole answer again with every part: what it is (one sentence), who it is for, why it ' +
            'exists, how it works as numbered steps, and its advantages.';
          evidenceLedger.push({ round: rounds, body: bounce });
          if (!seenEvidence.has(bounce)) seenEvidence.add(bounce);
          lastToolSectionText = renderToolResultsSection(
            selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
          ).join('\n');
          prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
          continue;
        } else if (repeated && repeatRetries < REPEAT_RETRIES) {
          /* A retry at the same temperature returns the same text (repeat-guard A/B,
             2026-09-24), so the retry samples hot, and it is checked again. */
          repeatRetries += 1;
          retryHot = true;
          rounds++;
          const bounce =
            `### harness: your answer is REJECTED — ${REPEAT_PROBLEM}. The learner asked something ` +
            `new: "${input.question}". Write a NEW answer to that question: do not reuse your ` +
            'previous sentences, and give information your last answer did not.';
          evidenceLedger.push({ round: rounds, body: bounce });
          if (!seenEvidence.has(bounce)) seenEvidence.add(bounce);
          lastToolSectionText = renderToolResultsSection(
            selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
          ).join('\n');
          prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
          continue;
        } else if (repeated) {
          /* Still the same after the hot retries: say so briefly instead of sending it again. */
          text = repeatFallback(text, input.historyLines);
        } else if (bouncedDraft !== undefined && text.trim() === bouncedDraft.trim()) {
          teachRepairNotes.push(...citeNotes);
          text = settleClose(marked);
        } else if (
          (citeNotes.length > 0 || closingFaults.length > 0) &&
          isLessonDraft(text, overviewTurn) &&
          closable &&
          rest.every((p) => OVERVIEW_TOO_LONG.test(p) || CLOSING_CHECK_PROBLEM.test(p))
        ) {
          teachRepairNotes.push(...citeNotes);
          text = settleClose(marked);
        } else if (
          problems.length > 0 &&
          productShapeSettles(teachProductTurn(input), rest, text)
        ) {
          teachRepairNotes.push(...citeNotes);
          text = settleClose(marked);
        } else if (problems.length > 0) {
          if (
            (rest.length === 0 || isShapeOnlyBounce(rest)) &&
            !repeated &&
            !isPlanningNotAnswer(text) &&
            marked.length > (keptAnswer?.length ?? -1)
          ) {
            keptAnswer = marked;
            keptNotes = citeNotes;
          }
          if (teachBounces < 1) {
            teachBounces += 1;
            bouncedDraft = text;
            rounds++;
            const listed = citeNotes.length > 0 ? rest : problems;
            const bounce =
              '### harness (teach contract): your lesson turn is REJECTED — ' +
              (listed.length > 0 ? listed.join('; ') : 'it is not yet a lesson for the learner') +
              '. ' +
              teachOneChange(listed, marked, overviewTurn);
            evidenceLedger.push({ round: rounds, body: bounce });
            if (!seenEvidence.has(bounce)) seenEvidence.add(bounce);
            lastToolSectionText = renderToolResultsSection(
              selectCarriedEvidence(evidenceLedger, rounds, evidenceLedgerCap),
            ).join('\n');
            prompt = withBudgetCheck(`${promptWithTools}\n\n${lastToolSectionText}`);
            continue;
          }
          if (keptAnswer !== undefined && text.trim().length < keptAnswer.trim().length) {
            teachRepairNotes.push(...keptNotes);
            text = settleClose(keptAnswer);
            teachRepairNotes.push(KEPT_RICHER_NOTE);
          } else {
            text = settleClose(text);
          }
        }
      }
      /* Past the grader, a lesson that is still only the model planning is not
         accepted: the turn ends on the rescue or the funnel's honest line. */
      if (input.teach === true && isPlanningNotAnswer(text)) text = '';
      if (input.teach === true && text.trim() !== '') {
        const routes = groundRoutes(text, input.graph);
        if (routes.marked.length > 0) {
          text = routes.text;
          teachRepairNotes.push(routeNote(routes.marked));
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
      /* A turn that is still a stub, or still hands the work back, after its
         bounces leads with a small lesson read off its own chart and the scan
         (withGroundedLesson). Before the check-in, so the check-in sees a lesson
         to ask about. Behind SEQUENCE_TEACH_DEFLECT_FLOOR=1 (keep the model's words)
         or =drop (drop only its hand-back sentences) until measured. */
      /*
       * THE PICTURE ON SCREEN, whoever drew it. `lastChartThisTurn` is only
       * written by the product's own floors (turnCarry.reach.test.ts holds it
       * there), so a turn where the MODEL drew had none, and the lines below
       * that read the picture never fired on the model's own chart. The
       * model's latest chart this turn is the fallback; it is read here and
       * never written back to the slot.
       */
      const pictureOnScreen = lastChartThisTurn ?? chartsDrawnThisTurn[chartsDrawnThisTurn.length - 1];
      const deflectFloor = process.env.SEQUENCE_TEACH_DEFLECT_FLOOR;
      if (
        (deflectFloor === '1' || deflectFloor === 'drop') &&
        input.teach === true &&
        pictureOnScreen !== undefined
      ) {
        text = withGroundedLesson(
          text,
          input.graph ?? undefined,
          pictureOnScreen,
          TEACH_STUB_WORDS,
          deflectFloor === 'drop' ? 'drop' : 'keep',
        );
      }
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
        if (gradeCheckIn(text, closingExamples).endsWithCheck) return 'own-check-in';
        /* r3 (2026-09-23): a retry identical to its draft ended on three questions;
           r5 and r6 (Slice 12): so did a kept draft and a retry that stood. */
        if (settledOnDraft && lastParagraphAsksReader(text)) return 'own-question-to-the-reader';
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
        /* A traced flow has no focus for `deriveCheckIn`; its last hop is asked
           about instead (2026-09-23, `deriveFlowCheckIn`). */
        const derivedCheck =
          nextPicture?.question ?? deriveCheckIn(lastChartThisTurn) ?? deriveFlowCheckIn(lastChartThisTurn);
        if (derivedCheck !== undefined && !teachProductTurn(input)) {
          /* No new stream event: the question is in the answer, which is where
             the learner reads it, and a derived check is countable by its
             opening ("Looking at the picture:") without widening the event
             union the client also has to know about. */
          text = `${text.trim()}

${derivedCheck}`;
        }
      }
      /* A product answer ends on the answer (SEQUENCE_TEACH_PRODUCT_NO_QUIZ=1). */
      if (input.teach === true && productNoQuizEnabled() && teachProductTurn(input)) {
        text = withoutClosingQuestion(text);
      }
      /* The repair notes go last, after the check-in, so the lesson still ends
         on its own question and the reader is told what was changed in it. */
      if (teachRepairNotes.length > 0 && text.trim() !== '') {
        text = `${text.trim()}\n\n${teachRepairNotes.join('\n')}`;
      }
      teachRepairNotes = [];
      /*
       * THE PICTURE POINTER — one line, from the chart on screen, when the
       * lesson never mentions its own picture (withPicturePointer). Behind a
       * flag for the same reason as the check-in form: a teach contract changed
       * before its measurement is a contract nobody can score. Unset leaves
       * every turn byte for byte as before.
       */
      /* THE WORKED EXAMPLE — one real file:line off the scanned edge the
         picture stands on (withWorkedExample). Same flag rule as the pointer
         below, and it runs first so the example reads before the pointer. */
      if (
        process.env.SEQUENCE_TEACH_WORKED_EXAMPLE === '1' &&
        input.teach === true &&
        pictureOnScreen !== undefined &&
        !atCap
      ) {
        text = withWorkedExample(text, input.graph ?? undefined, pictureOnScreen);
      }
      if (
        process.env.SEQUENCE_TEACH_PICTURE_POINTER === '1' &&
        input.teach === true &&
        pictureOnScreen !== undefined &&
        !atCap
      ) {
        text = withPicturePointer(text, pictureOnScreen);
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
        input.permission === 'build' &&
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
    roundCallSignatures.push(
      toolRequests.map((r) => `${r.name}(${JSON.stringify(r.args ?? {})})`),
    );
    const toolResultBodies: string[] = [];
    const roundBroughtSomethingNew = { value: false };
    const topologyFlag: { value: boolean } = { value: topologySucceededThisTurn };
    const canvasFlag: { value: boolean } = { value: canvasWriteSucceededThisTurn };
    const teachCanvasFlag: { value: boolean } = { value: teachCanvasDrawingThisTurn };
    const filesFlag: { value: boolean } = { value: filesProposalSucceededThisTurn };
    const chartFlag: { value: number } = { value: chartsThisTurn };
    /* The ARRAY itself, not a copy: every round appends to the one list the
       ending sentence is built from. */
    const artefactsHolder: { value: TurnArtefact[] } = { value: artefactsThisTurn };
    const writeCalls: { value: number } = { value: fileWriteCallsThisTurn };
    const trippedFlag: { value: boolean } = { value: trippedBreaker };
    const todoHolder: { value: TodoItem[] } = { value: todosThisTurn };
    const goalPlanHolder: { value: PlanStep[] } = { value: planThisTurn };
    const todoAdvancedFlag = { value: false };
    const drawnPartsHolder: { value: string[] } = { value: drawnPartIdsThisTurn };
    const boardKnownHolder = { value: boardKnownThisTurn };
    const referentsHolder: {
      value?: { tool: string; subject: string; items: readonly string[]; total: number };
    } = referentsThisTurn === undefined ? {} : { value: referentsThisTurn };
    const onFileEvent = (ev: { type: 'file:read' | 'file:done'; path: string }): void => {
      if (ev.type === 'file:read') {
        push({ type: 'file:read', path: ev.path });
        const base = ev.path.replace(/\\/g, '/').split('/').pop();
        if (base) filesReadThisTurn.add(base.toLowerCase());
        pathsReadThisTurn.add(ev.path.replace(/\\/g, '/'));
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
      /* One canvas block per turn, except on a planning turn, where the plan,
         its before-and-after and its decisions are several blocks by design. */
      canvas:
        input.planning === true
          ? artefactsHolder.value.filter((a) => a.kind === 'canvas').length >= PLANNING_CANVAS_WRITES
          : canvasFlag.value,
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
      teachCanvasDrawingThisTurn: teachCanvasFlag,
      filesProposalSucceededThisTurn: filesFlag,
      chartsThisTurn: chartFlag,
      chartsDrawnThisTurn: { value: chartsDrawnThisTurn },
      artefactsThisTurn: artefactsHolder,
      referentsThisTurn: referentsHolder,
      fileWriteCallsThisTurn: writeCalls,
      trippedBreaker: trippedFlag,
      todos: todoHolder,
      goalPlan: goalPlanHolder,
      todoAdvanced: todoAdvancedFlag,
      drawnPartIds: drawnPartsHolder,
      boardKnown: boardKnownHolder,
      writtenFilesThisTurn,
      modifiedExistingThisTurn,
      traceFlows: traceFlowsThisTurn,
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
      if (tr.name === 'run_command' && input.permission !== 'build') {
        const refusal =
          `Refused — only Full access runs commands; this session is ` +
          `${input.permission ?? 'plan'} mode. Say what should be run and why, or ask the ` +
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
          if (candidate.name === 'run_command' && input.permission !== 'build') break;
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
            const result = withRepairNote(btr, await executeAskTool(btr.name, btr.args, toolCtx, onFileEvent));
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
        result = withRepairNote(tr, await executeAskTool(tr.name, tr.args, toolCtx, onFileEvent));
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
    teachCanvasDrawingThisTurn = teachCanvasFlag.value;
    filesProposalSucceededThisTurn = filesFlag.value;
    fileWriteCallsThisTurn = writeCalls.value;
    trippedBreaker = trippedFlag.value;

    /* Counted AFTER the round's tools have all run: one novel result anywhere
       in the round makes the whole round productive, because a model that found
       one new thing has a reason to look again. */
    todosThisTurn = todoHolder.value;
    planThisTurn = goalPlanHolder.value;
    drawnPartIdsThisTurn = drawnPartsHolder.value;
    /*
     * A ROUND THAT FINISHED A STEP GOT SOMEWHERE, WHATEVER THE LEDGER THINKS.
     *
     * The unproductive-round rule ends a turn whose last few rounds brought
     * back only evidence it already had — the right rule for a model going in
     * circles, and exactly wrong for one working a list. Re-reading the file it
     * already read in order to apply the edit it already planned is "nothing
     * new" to the ledger and is the whole job to the person waiting. So a
     * completed step resets the counter the same way novel evidence does.
     *
     * It cannot be gamed into an unbounded turn: `roundCap` and the wall-clock
     * deadline are untouched, `diffTodos` counts only forward movement, and a
     * step can complete once.
     */
    unproductiveRounds =
      roundBroughtSomethingNew.value || todoAdvancedFlag.value ? 0 : unproductiveRounds + 1;

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
    /*
     * THE LIST GOES BACK EVERY ROUND, ABOVE THE EVIDENCE.
     *
     * Above it deliberately: the evidence ledger is capped and re-selected each
     * round (`selectCarriedEvidence`), so anything inside it can be dropped to
     * fit the budget. The work list must not be — a model shown its evidence
     * and not its plan writes a new plan, which is the failure this whole
     * feature exists to prevent. Forty rows at one line each is small enough
     * that carrying it whole is not a budget question.
     *
     * Empty list ⇒ empty string ⇒ the prompt is byte-identical to the one this
     * loop built before `update_todos` existed.
     */
    const todoSection = renderTodoSection(todosThisTurn);
    const todoText = todoSection.length === 0 ? '' : `${todoSection.join('\n')}\n\n`;
    prompt = withBudgetCheck(`${promptWithTools}

${todoText}${lastToolSectionText}`);

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
      (topologySucceededThisTurn ||
        canvasWriteSucceededThisTurn ||
        (isPlotOrMathDrawAsk(input.question) && chartsThisTurn > 0))
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
  /*
   * ══ A TURN THAT RESEARCHED AND SAID NOTHING IS ASKED ONCE TO ANSWER ═══════
   *
   * Owner, 2026-09-22: "they stop, they freeze up, they stop responding". The
   * live battery after that walk caught it on his own compound question: eleven
   * reads and three who_calls, 39,000 characters of thinking, and not one word
   * of answer — the rounds ran out while the model was still looking. The stop
   * copy was honest about that, and it was still no answer.
   *
   * So a turn that DID research and wrote nothing gets one more call, with the
   * evidence it gathered and one plain sentence: answer now from what you
   * found. No tools are run from it. If it still writes nothing, the funnel
   * below says so exactly as before.
   */
  /*
   * AND A PLANNING TURN THAT ENDED WITHOUT ITS PLAN. Measured over three live
   * /plan runs: one ended on a promise ("I'll survey the current architecture,
   * then propose…") and landed nothing. The person asked for a plan; the floor
   * writes one from the evidence, the way the plot floor draws the curve the
   * model only described. It never refuses and never repeats a plan that landed.
   */
  const planningFloor =
    input.planning === true && !planDocLanded && providerCallMs.length > 0 && !trippedBreaker;
  /*
   * NEITHER EXTRA ROUND STARTS PAST THE TURN'S DEADLINE. Owner's baseline,
   * 2026-09-22: "the forced round began 94 s past the deadline and ran another
   * 136 s". The loop checked the clock; the rounds after it did not. Soft, like
   * the loop: a round started with a few seconds left still runs (one provider
   * call); a round whose clock is already over does not start, and the turn
   * ends on what it has plus the harness's own note.
   */
  if (
    ((text.trim().length === 0 && executedToolNames.length > 0) || planningFloor) &&
    providerCallMs.length > 0 &&
    !trippedBreaker &&
    providerFailedMidTurn === null &&
    !pastTurnDeadline()
  ) {
    throwIfAskAborted(input.signal);
    const answerStarted = Date.now();
    /*
     * THINKING OFF FOR THIS ONE CALL. Measured on the /plan case the same day:
     * the answer round came back with 30 output tokens and 53,000 characters of
     * thought — a thinking model spending the rescue deciding again. The turn
     * has already thought; this call only has to write. His profile sets an
     * effort, so the provider's own reasoning-only retry (which drops thinking
     * only when no effort is set) never fires for him.
     */
    const answerCfg: AiConfig =
      workerCfg.provider === 'openai-compatible'
        ? { ...workerCfg, params: { ...(workerCfg.params ?? {}), reasoningEffort: 'none' } }
        : workerCfg;
    const planningRescue = input.planning === true;
    const rescueDeltas = holdToolFences((t) => push({ type: 'delta', text: t }));
    const rescueThought = holdThinking(rescueDeltas.onDelta);
    try {
      const answerCall = await input
        .callProvider(
          answerCfg,
          `${prompt}\n\n${planningRescue ? PLAN_FROM_EVIDENCE : ANSWER_FROM_EVIDENCE}`,
          rescueThought.onDelta,
          { cacheBreakpointChars: promptWithTools.length, onReasoning: pushReasoning },
        )
        .finally(() => {
          rescueThought.flush();
          rescueDeltas.flush();
        });
      providerCallMs.push(Date.now() - answerStarted);
      rounds++;
      if (answerCall.usage) {
        totalInput += answerCall.usage.inputTokens;
        totalOutput += answerCall.usage.outputTokens;
        lastCallInput = answerCall.usage.inputTokens;
        anyEstimated = anyEstimated || answerCall.usage.estimated;
        hadUsage = true;
      }
      const rescueParsed = parseAllToolRequests(answerCall.text ?? '');
      /*
       * A PLAN WRITTEN AS TOOL CALLS IS STILL THE PLAN. Told not to call tools,
       * a tool-trained small model may answer with exactly the calls a plan is
       * made of — write_plan, a canvas block, a chart — and stripping them left
       * the floor with nothing to lay down (live rate B, run 2: a good plan in
       * prose above, no document on the tab). On a planning rescue those calls
       * run; nothing else does.
       */
      if (planningRescue) {
        const rescueCalls = mergeToolRequests(answerCall.toolRequests, rescueParsed.requests);
        for (const tr of rescueCalls) {
          if (tr.name !== 'write_plan' && tr.name !== 'propose_chart' && !isCanvasToolName(tr.name)) continue;
          if (tr.name === 'write_plan' && !input.persistPlan) continue;
          push({ type: 'tool:start', id: tr.id, ...(tr.name ? { name: tr.name } : {}) });
          const r = await executeAskTool(tr.name, tr.args, toolCtx);
          if (r.canvasBlock) {
            canvasWriteSucceededThisTurn = true;
            if (countsAsTeachDrawing(tr.name)) teachCanvasDrawingThisTurn = true;
            artefactsThisTurn.push({ kind: 'canvas', label: r.canvasBlock.title ?? r.canvasBlock.type });
            push({
              type: 'canvas:block',
              id: r.canvasBlock.id,
              blockType: r.canvasBlock.type,
              ...(r.canvasBlock.title ? { title: r.canvasBlock.title } : {}),
              payload: r.canvasBlock.payload,
              status: 'landed',
              surface: r.canvasBlock.surface ?? PLAN_SURFACE,
            });
          }
          if (r.chart) {
            chartsThisTurn += 1;
            push({ type: 'chart:proposal', chart: r.chart, surface: r.chartSurface ?? PLAN_SURFACE });
          }
          if (r.goalPlan) planThisTurn = r.goalPlan;
          push({ type: 'tool:done', id: tr.id, ...(tr.name ? { name: tr.name } : {}), evidence: r.evidence });
        }
      }
      /* The rescue's reply is judged like any answer: leaked thinking cut out, and
         a reply that only plans its next read is no answer (2026-09-22). */
      const unthought = withoutLeakedThinking(rescueParsed.stripped).trim();
      const answered = isPlanningNotAnswer(unthought) ? '' : unthought;
      if (answered.length > 0 && planningRescue && planDocLanded) {
        /* The calls above put the document on the tab; the prose is the caption. */
        text = planChatSummary(answered);
      } else if (answered.length > 0 && planningRescue) {
        /*
         * A PLAN WRITTEN AS PROSE STILL LANDS AS A PLAN — the plot floor's rule
         * (the product draws the curve the model only described), applied to
         * the plan. The Markdown goes on the Plan tab, its numbered steps go
         * through `write_plan` exactly as the model's own call would, and the
         * chat carries the first lines rather than the whole document twice.
         */
        const planId = `plan-${Date.now().toString(36)}`;
        canvasWriteSucceededThisTurn = true;
        artefactsThisTurn.push({ kind: 'canvas', label: 'Plan (markdown)' });
        push({
          type: 'canvas:block',
          id: planId,
          blockType: 'markdown',
          title: 'Plan',
          payload: answered,
          status: 'landed',
          surface: PLAN_SURFACE,
        });
        const steps = planStepsFromMarkdown(answered);
        if (steps.length >= 2 && input.persistPlan) {
          const stepCallId = `${planId}-steps`;
          push({ type: 'tool:start', id: stepCallId, name: 'write_plan' });
          const written = await executeAskTool('write_plan', { steps }, toolCtx);
          if (written.goalPlan) planThisTurn = written.goalPlan;
          push({ type: 'tool:done', id: stepCallId, name: 'write_plan', evidence: written.evidence });
        }
        text = planChatSummary(answered);
      } else if (answered.length > 0 && !planningRescue) {
        text = answered;
      }
    } catch (e) {
      if ((e as Error)?.name === 'RequestAbortedError') throw e;
      /* The funnel below still explains the empty turn. */
    }
  }

  const endsWithQuestion = /\?\s*$/.test(text.trim());
  let pendingDrawNote: string | null = null;
  const plotAsk = isPlotOrMathDrawAsk(input.question);
  const teachingTurn = isTeachTurn(input);
  /* A chart is a drawing whoever drew it: a landed chart satisfies the ask. On a
     teach turn the canvas block has to be a diagram (`countsAsTeachDrawing`),
     wherever it was written: a note from the main loop stood this round down
     until 2026-09-22, and the lesson ended with a note and no flow. */
  const drewSomething =
    topologySucceededThisTurn ||
    (teachingTurn ? teachCanvasDrawingThisTurn : canvasWriteSucceededThisTurn) ||
    chartsThisTurn > 0;
  const demandSurface: DrawSurface = plotAsk
    ? 'chart'
    : drawSurfaceFor(input.question, canvasToolsEnabled(input));
  /*
   * ══ WHO OWES A DRAWING (owner walk on ML Harness, 2026-09-22) ═════════════
   *
   * His question ended "…draw on the ai canvas the visual breakdown to teach me
   * about the elements", so it classified TEACH, and this contract keyed on the
   * DRAW intent alone. The teach floor was gated on the Teach toggle (off in a
   * Plan chat) and on a lesson concept a first broad question has not got. The
   * reply ended "Let me draw this on the canvas." and nothing checked that
   * promise. The canvas said "Nothing drawn yet".
   *
   * So a drawing is owed when the question asked for one in any intent, or
   * when the answer PROMISED one. And a teach turn's closing check-in question
   * — the contract requires it — is not the scoping question the
   * `endsWithQuestion` guard was written for.
   */
  const drawOwed =
    askIntent === 'draw' ||
    (teachingTurn && isDrawishAskQuestion(input.question)) ||
    endsWithDrawPromise(text);
  const forcedDrawDue =
    drawOwed &&
    /* PLAN MODE STILL DRAWS ON THE CANVAS. The guard was written for the board:
       `propose_topology` is a mutation Plan refuses, so demanding it there asks
       for a call that will be refused. A canvas block or a chart is not a
       mutation. Measured live, 2026-09-22: his "draw the plan as a flow chart
       on the ai canvas" in Plan read the architecture ten times, promised to
       draw, and this round never ran. */
    (input.permission !== 'plan' || demandSurface !== 'board') &&
    !drewSomething &&
    providerCallMs.length > 0 &&
    !trippedBreaker &&
    (!endsWithQuestion || teachingTurn || endsWithDrawPromise(text));
  /* Read AFTER the rescue, which may itself have spent the time left. */
  const drawOutOfTime = pastTurnDeadline();
  if (forcedDrawDue && drawOutOfTime && !plotAsk) {
    /* Past the deadline the owed drawing is not asked for (see above): the
       answer already written stands, and the reader is told nothing was drawn. */
    pendingDrawNote = nothingDrawnNote(demandSurface);
  }
  if (forcedDrawDue && !drawOutOfTime) {
    throwIfAskAborted(input.signal);
    const drawDemand = forcedDrawDemand(demandSurface, teachingTurn);
    const forcedStarted = Date.now();
    const forcedCall = await input.callProvider(workerCfg, `${prompt}\n\n${drawDemand}`, undefined, {
      cacheBreakpointChars: promptWithTools.length,
      onReasoning: pushReasoning,
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
      if (
        topologySucceededThisTurn ||
        (teachingTurn ? teachCanvasDrawingThisTurn : canvasWriteSucceededThisTurn) ||
        (plotAsk && chartsThisTurn > 0)
      ) {
        break;
      }
      /* Any drawing tool answers the demand; a chart is a drawing on every surface.
         On a TEACH turn a note is not a drawing (2026-09-22): the lesson owes a
         flow, so only the tools that draw one count — a chart, a mermaid or svg
         diagram, a topology. A note here is left unrun and the turn says plainly
         that nothing was drawn. */
      const isDrawTool = plotAsk
        ? tr.name === 'propose_chart'
        : teachingTurn
          ? countsAsTeachDrawing(tr.name)
          : tr.name === 'propose_topology' ||
            tr.name === 'propose_chart' ||
            tr.name === CANVAS_STORY_TOOL ||
            isCanvasToolName(tr.name);
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
      if (forcedResult.chart) {
        chartsThisTurn += 1;
        lastChartThisTurn = forcedResult.chart;
        push({
          type: 'chart:proposal',
          chart: forcedResult.chart,
          ...(forcedResult.chartSurface ? { surface: forcedResult.chartSurface } : {}),
        });
      }
      if (forcedResult.canvasBlock) {
        canvasWriteSucceededThisTurn = true;
        if (countsAsTeachDrawing(tr.name)) teachCanvasDrawingThisTurn = true;
        push({
          type: 'canvas:block',
          id: forcedResult.canvasBlock.id,
          blockType: forcedResult.canvasBlock.type,
          ...(forcedResult.canvasBlock.title ? { title: forcedResult.canvasBlock.title } : {}),
          payload: forcedResult.canvasBlock.payload,
          status: 'live',
          ...(forcedResult.canvasBlock.surface ? { surface: forcedResult.canvasBlock.surface } : {}),
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
    const drew =
      topologySucceededThisTurn ||
      (teachingTurn ? teachCanvasDrawingThisTurn : canvasWriteSucceededThisTurn) ||
      chartsThisTurn > 0;
    const forcedText = forcedParsed.stripped.trim();
    if (drew && forcedText.length > 0) {
      // The forced round's words are the drawing's caption — they replace the
      // prose that failed to draw, not append to it.
      text = forcedText;
    } else if (!drew && !plotAsk) {
      /* One factual line, not a verdict on the model. The old note ran three
         sentences blaming it ("it never called a drawing tool. The words above
         are the best it did"), appended under whatever it did write — the
         owner read that as the harness scolding its own worker. The reader
         still learns nothing was drawn, which is the honest part. */
      /* APPENDED AFTER THE FUNNEL, never in place of an answer: a note that
         fills an empty text hides the funnel's explanation (the same defect
         the file note below records, measured again on 2026-09-22). */
      pendingDrawNote = nothingDrawnNote(demandSurface);
    }
  }

  /*
   * PLOT FLOOR — product draws when the model never called `propose_chart`.
   *
   * Owner walk 2026-09-16: "plot a parabola … Use AI Canvas" came back as
   * architecture prose, empty ```seqd fences, and ASCII Markdown — never a
   * line chart. Teach mode already has this floor (`buildPlot` /
   * `buildExamplePlot`); ordinary AI Canvas plot asks did not. The forced
   * round above only helps when the model finally emits a tool fence; when it
   * keeps designing a "plotting system" in words, Sequence draws the curve.
   *
   * Same promise as teach: an expression the model stated wins; otherwise the
   * product's canonical example for the topic (parabola → x^2). Non-mutating.
   */
  if (
    isPlotOrMathDrawAsk(input.question) &&
    chartsThisTurn === 0 &&
    !trippedBreaker &&
    providerCallMs.length > 0
  ) {
    const derived =
      buildPlot(text)?.chart ?? buildExamplePlot(input.question)?.chart;
    if (derived !== undefined) {
      const floorId = `plot-floor-${rounds}`;
      push({ type: 'tool:start', id: floorId, name: 'propose_chart' });
      chartsThisTurn += 1;
      lastChartThisTurn = derived;
      push({ type: 'chart:proposal', chart: derived });
      push({
        type: 'tool:done',
        id: floorId,
        name: 'propose_chart',
        evidence:
          `charted ${derived.kind} "${derived.title}" (${derived.items.length} items) — ` +
          'Sequence plotted this when the model did not call propose_chart',
      });
    }
  }

  /*
   * PLAN MODE: THE BEFORE/AFTER IS ALREADY IN THE PLAN. Rule 2 of plan mode
   * makes the model name the files that change, and plan mode refuses
   * propose_topology, so a plan turn had no way to show its change (the /plan
   * battery: before/after diagram 0/9). When the plan names files the scan
   * knows and the model drew nothing, Sequence draws them as they are and as
   * the plan leaves them. Behind SEQUENCE_PLAN_BEFORE_AFTER=1 until measured.
   *
   * It does not take the chart slot (`lastChartThisTurn`): that slot carries a
   * lesson's focus into the next turn, and turnCarry.reach.test.ts holds every
   * write to it inside a teach or plot gate. A plan's picture has no focus to
   * carry.
   */
  if (
    process.env.SEQUENCE_PLAN_BEFORE_AFTER === '1' &&
    input.permission === 'plan' &&
    chartsThisTurn === 0 &&
    !trippedBreaker &&
    providerCallMs.length > 0
  ) {
    const derived = deriveBeforeAfterChart(input.graph ?? undefined, text);
    if (derived !== undefined) {
      const floorId = `plan-before-after-${rounds}`;
      push({ type: 'tool:start', id: floorId, name: 'propose_chart' });
      chartsThisTurn += 1;
      push({ type: 'chart:proposal', chart: derived });
      push({
        type: 'tool:done',
        id: floorId,
        name: 'propose_chart',
        evidence:
          `charted ${derived.kind} "${derived.title}" (${derived.items.length} items) — ` +
          "Sequence drew this from the files the plan names, when the model did not call propose_chart",
      });
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
      /* A TURN THAT DREW SAYS SO HERE TOO. The note below is about files; the
         sentence above it must still be the truth about the turn, and "I did
         not produce an answer" above a chart is not. */
      const drawn = describeTurnArtefacts(artefactsThisTurn);
      text = `${
        drawn ??
        buildForcedFinalAnswer({
          stopReason,
          roundCap,
          rounds,
          executedToolNames,
          unproductiveLimit,
        })
      }\n\n${note}`;
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

  /*
   * A CUT-OFF ANSWER SAYS SO — BEFORE the empty-answer funnel, and the order
   * is the argument.
   *
   * These are two different failures with two different sentences, and a turn
   * can only be one of them: this one HAS words and they stop mid-way; the
   * funnel below has no words at all. Checked in this order, a severed answer
   * keeps its own words and gains one line; checked after, nothing would
   * change, because the funnel only fires on emptiness. The order is written
   * down so the next person does not "simplify" them into one branch, which
   * is how a reader ends up told the model wrote nothing when they can see
   * half a list on their screen.
   */
  if (lastFinishReason === 'length' && text.trim().length > 0) {
    text = `${text.trimEnd()}\n\n${TRUNCATED_ANSWER_NOTE}`;
  }

  if (text.trim().length === 0) {
    /*
     * THREE ENDINGS, AND EACH HAS A CASE THAT PRODUCES ONLY IT.
     *
     *   drew nothing            → the forced ending, exactly as before.
     *   drew, ran to completion → the work rows, in one sentence.
     *   drew, then hit a stop   → both: what it made, then why it stopped.
     *
     * The middle case is the owner's ("the model just drew and returned. It
     * didn't say anything"), and the third is why the artefact line does not
     * simply replace the funnel: a turn cut off at the round ceiling owes the
     * reader that fact whether or not it managed to draw first.
     */
    const drawn = describeTurnArtefacts(artefactsThisTurn);
    const forced = buildForcedFinalAnswer({
      stopReason,
      roundCap,
      rounds,
      executedToolNames,
      unproductiveLimit,
    });
    text = drawn === undefined ? forced : stopReason === null ? drawn : `${drawn}\n\n${forced}`;
  }
  if (pendingDrawNote !== null) text = `${text.trimEnd()}\n\n${pendingDrawNote}`;

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
   *
   * Plot/math asks must NOT salvage topology onto Architecture — that is how
   * "plot a parabola" became InputModule service cards (owner walk 2026-09-15).
   */
  const plotAskFinal = isPlotOrMathDrawAsk(input.question);
  if (!plotAskFinal) {
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
  } else {
    /* Still strip seqd/tool fences from the transcript on plot turns. */
    const seqdParsed = parseFencedSeqdProposals(text);
    if (seqdParsed.proposals.length > 0) text = seqdParsed.stripped;
    const bareSeqd = salvageBareSeqdProposals(text);
    if (bareSeqd.proposals.length > 0) text = bareSeqd.stripped;
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
      if (plotAskFinal) continue;
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
    /* Present only when the turn was GIVEN a goal — see the field. A turn with
       no goal context must return no plan, not an empty one, so a caller cannot
       read "this session's plan is empty" out of a turn that was never told
       there was a session. */
    ...(input.goal === undefined ? {} : { goalPlan: [...planThisTurn] }),
    toolCallsMade: executedToolNames.length,
    ...(evidenceAttached ? { evidence: evidenceAttached } : {}),
    source: 'provider',
  };
  push(resultPayload(result));
  return result;
}
