/**
 * ASK TOOLS — allowlisted mid-turn tools the provider may request during an ask.
 *
 * Six tools, all read-only / no-silent-write, all funnelled through the SAME
 * jail as GET /api/file (`resolveReadable`):
 *
 *   - `read_file`     — read one repo-relative file body, capped.
 *   - `search_files`  — walk the attached repo and grep for a query and/or a
 *     path glob, returning capped match snippets.
 *   - `propose_files` — accept a multi-file edit proposal WITHOUT writing it;
 *     every path is jail-checked, the proposal is attached to the result for
 *     the pipeline to emit as `edit:proposal` SSE so the web client can stage
 *     a FileEditProposalBar. Nothing is written to disk.
 *   - `run_command`   — run an allowlisted relative command (the verifyGate
 *     allowlist + safe-char check) under `repoRoot` via `spawnSync` (no shell,
 *     no metacharacters, no `..`). stdout/stderr capped and fed back.
 *   - `git_status`     — `git status --porcelain` against the attached repo
 *     (wraps gitWorkspace; same jail, no ambient shell).
 *   - `git_diff`      — `git diff` for one repo-relative path (wraps
 *     gitWorkspace; the path is jail-checked before git is spawned).
 *   - `call_mcp`      — call one tool on one configured MCP server (the
 *     `.sequence/mcp.json` allowlist); content capped and fed back.
 *   - `call_plugin`   — call one declared readonly tool from
 *     `.sequence/plugins.json` (closed builtins + honest no-handler).
 *   - `fetch_url`     — fetch one public https URL under SSRF/size caps;
 *     returns measured status + truncated plain text (no cookie jar).
 *
 * No tool here invents paths or topology. Every path a tool reads comes from
 * the model's request and is re-validated through `resolveReadable`; every
 * search result comes from a real on-disk walk. In design mode (no attached
 * repo / no `repoRoot`), every tool is refused — the chat must not fabricate a
 * file list out of a design sketch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { neutralizeUntrusted, wrapUntrustedLines } from '../llm/untrusted.js';
import {
  runAllowlistedRepoCommand,
} from '../harness/verifyGate.js';
import { repoExecutionRefusal } from './repoTrust.js';
import { gitDiff, gitStatus, GitWorkspaceError } from './gitWorkspace.js';
import type { ArchGraph } from '@sequence/schema';
import { validatePlan, type Concept } from './lessonState.js';
import { validateChart, CHART_KINDS } from '@sequence/schema';
import type { Digest } from '../explain/explain.js';
import {
  SEQ_DIAGRAM_EDGE_FAMILIES,
  SEQ_DIAGRAM_KINDS,
  SEQ_DIAGRAM_NODE_KINDS,
  inferSeqDiagramKind,
  seqDiagramLayoutForKind,
  validateSeqDiagram,
  type SeqDiagramEdge,
  type SeqDiagramNodeDetail,
  type SeqDiagramV1,
} from '@sequence/schema';

import {
  callMcpTool,
  McpTransportError,
  UnknownMcpServerError,
} from './mcpClient.js';
import { loadPluginManifestV0 } from './pluginManifest.js';
import { IGNORE_DIRS } from '../ignoreDirs.js';
import { netFetchUrl } from './netFetch.js';
import {
  executeCanvasWrite,
  executeCanvasStoryRoute,
  CANVAS_STORY_TOOL,
  CANVAS_STORY_TOOL_SCHEMA,
  CANVAS_TOOL_NAMES,
  isCanvasToolName,
  type CanvasToolName,
} from './canvasTools.js';
import {
  evaluatePermission,
  type PermissionPolicy,
  type PermissionSubject,
  type PermissionVerdict,
} from './permissionRules.js';
import { approveAskVerdict, isAskVerdict } from './autoApprove.js';
import {
  isIdentifier,
  locateDeclarations,
  makeFileReader,
  renderLocateEvidence,
} from './locateSymbol.js';

/** The only tool names the ask pipeline will execute. */
export type AskToolName =
  | 'read_file'
  | 'edit_file'
  | 'search_files'
  | 'read_topology'
  | 'locate_symbol'
  | 'who_calls'
  | 'propose_files'
  | 'propose_topology'
  | 'propose_chart'
  | 'propose_plan'
  | 'run_command'
  | 'git_status'
  | 'git_diff'
  | 'call_mcp'
  | 'call_plugin'
  | 'fetch_url';

export const ASK_TOOL_ALLOWLIST: readonly AskToolName[] = [
  'read_file',
  'edit_file',
  'search_files',
  'read_topology',
  'locate_symbol',
  'who_calls',
  'propose_files',
  'propose_topology',
  'propose_chart',
  'propose_plan',
  'run_command',
  'git_status',
  'git_diff',
  'call_mcp',
  'call_plugin',
  'fetch_url',
];

/**
 * Every name `executeAskTool` will dispatch — the set the permission gate runs
 * for. `ASK_TOOL_ALLOWLIST` is not that set: the AI Canvas writers and
 * `canvas.set_story_route` are recognised by `isCanvasToolName` /
 * `CANVAS_STORY_TOOL` and never appear in it.
 *
 * Note the dotted names. `RULE_RE` in `permissionRules.ts` accepts snake_case
 * tool names only, so a rule cannot NAME a canvas tool today — it is refused
 * out loud as "not a rule — DROPPED". They are policy subjects all the same:
 * `deny *` and `"default": "deny"` reach them through the gate like every other
 * tool. Naming one by rule needs the grammar to accept a dot; that is a
 * `permissionRules.ts` change, not an `executeAskTool` one.
 */
export const ASK_DISPATCHABLE_TOOLS: readonly string[] = [
  ...ASK_TOOL_ALLOWLIST,
  ...CANVAS_TOOL_NAMES,
  CANVAS_STORY_TOOL,
];

export type AskJobMode = 'work' | 'code';

export function parseAskJobMode(raw: unknown): AskJobMode | undefined {
  return raw === 'work' || raw === 'code' ? raw : undefined;
}

/**
 * Tools that CHANGE something, as opposed to reading it.
 *
 * `propose_files` is included and is the one worth arguing about. It writes
 * nothing to disk — a proposal is reviewed and accepted by a human first — but
 * plan mode's contract is that the turn ends in WORDS, and a turn that ends in
 * a diff sitting in the review pane has ended in something else. A reader who
 * asked for a plan and found a pending change did not get what they chose.
 */
export const ASK_MUTATING_TOOLS: readonly AskToolName[] = [
  'propose_files',
  /* Stages the same reviewable proposal `propose_files` does, by the same
     argument: a turn that ends with a diff waiting in Review did not end in
     words. */
  'edit_file',
  /*
   * A TOPOLOGY PROPOSAL WRITES NOTHING TO DISK AND IS STILL A MUTATION HERE,
   * by exactly the argument `propose_files` is: plan mode's contract is that
   * the turn ends in WORDS, and a turn that ends with a dashed service sitting
   * on the reader's board has ended in something else. Someone who asked for a
   * plan and found a pending change to their architecture did not get what
   * they chose.
   */
  'propose_topology',
  'run_command',
];
/*
 * propose_chart is deliberately NOT mutating. propose_topology proposes a
 * CHANGE to the architecture (a dashed graph edit to accept/deny); a chart is
 * an explanatory VISUAL that writes nothing to disk and changes no graph —
 * and it is the very tool teach mode requires each concept to draw. Listing it
 * as mutating made plan/teach refuse it, so the teach contract demanded a
 * visual the harness then refused, bouncing every lesson turn to the ceiling.
 */

/**
 * What the agent may reach for, given the job mode and the PERMISSION mode.
 *
 * THE PERMISSION MODE USED TO GO NOWHERE. The composer offers a control that
 * says what the agent is allowed to do, `PostAskRequest` had no field for it,
 * and the server enforced its own rules and never learned what the user had
 * chosen. The control was decorative — it implied a choice the reader was not
 * actually making.
 *
 *   - `plan`     — reading tools only (strictly weaker than default).
 *   - `propose`  — full belt; `propose_files` stages, never writes.
 *   - `autoEdit` — same as propose minus `run_command`; pipeline auto-writes
 *                  accepted proposals (P3).
 *   - `full`     — auto-write plus `run_command`, still under
 *                  `evaluatePermission` rules.
 */
export function askToolsForJobMode(
  jobMode?: AskJobMode,
  permission?: string,
  opts?: { teach?: boolean },
): readonly AskToolName[] {
  const base = jobMode === 'work' ? ASK_TOOL_ALLOWLIST.filter((t) => t !== 'run_command') : ASK_TOOL_ALLOWLIST;
  /*
   * A TEACH TURN IS AS NARROW AS PLAN, AND THE BELT HAS TO SAY SO.
   *
   * `runAskPipeline` refuses every ASK_MUTATING_TOOLS call on a teach turn
   * (edit_file, propose_files, propose_topology, run_command) whatever the
   * permission is. While this function ignored teach, the belt still taught the
   * model to call them — and the propose_topology hint carries "ask ONE short
   * clarifying question in chat first: compact overview or detailed diagram",
   * which is the exact interrogation the teach contract forbids ~30 lines
   * later. One prompt both ordering and forbidding the same question is how the
   * owner's 2026-09-02 turn opened with "system-architecture or data-flow?".
   * The belt the model is TOLD about is the belt it is given.
   */
  if (permission === 'plan' || opts?.teach === true) {
    return base.filter((t) => !ASK_MUTATING_TOOLS.includes(t));
  }
  /*
   * ONLY FULL KEEPS THE SHELL, and the ladder's own names are why.
   *
   * `propose` — the OUT-OF-THE-BOX DEFAULT — used to fall through to the full
   * belt, `run_command` included, while the control that sets it says "Changes
   * arrive as proposals you accept" and the autonomy matrix marks its
   * `runCommands` cell false. Both statements were false at once: a user on the
   * default, told twice that nothing happens without their accept, had an agent
   * that could invoke the attached repository's `pnpm test` — arbitrary code out
   * of a package.json nobody audited — with no accept step anywhere. That is the
   * surface asserting a consent the engine never collected, which is the exact
   * defect this module's header says it exists to prevent.
   *
   * The safer reading of the ladder wins: Propose and Auto-edit stage changes,
   * Full is the mode that runs things.
   */
  if (permission === 'autoEdit' || permission === 'propose' || permission === undefined) {
    return base.filter((t) => t !== 'run_command');
  }
  return base;
}

/**
 * The CEILING on mid-turn tool rounds — a backstop, not the everyday limit.
 *
 * This was 3, and a fixed count is wrong in both directions at once: it cut off
 * the question that genuinely needed a sixth lookup, and it still paid for
 * three full provider rounds for a model that was re-reading one file and
 * learning nothing. The register carried the first half as a row — "a hard
 * question ends with the loop admitting it spent all three rounds still
 * looking" — gated as "a question needing 5 lookups completes".
 *
 * The everyday limit is now {@link UNPRODUCTIVE_ROUND_LIMIT}: the loop runs
 * while rounds bring back evidence it has not seen. This number only decides
 * how long a run that is genuinely learning something every single round may
 * continue, which is the case where no cheaper signal exists to stop it.
 */
export const MAX_ASK_TOOL_ROUNDS = 8;

/**
 * Design / no-repo draw questions — one provider round to ask, one to land the
 * diagram. Seven-minute design draws were a product defect; this is the everyday
 * cap, not {@link MAX_ASK_TOOL_ROUNDS}.
 */
export const DESIGN_DRAW_ASK_TOOL_ROUNDS = 2;

import { isDrawishAskQuestion } from './askIntent.js';

/** Draw / diagram intent — re-exported from `askIntent.ts`. */
export { isDrawishAskQuestion };

/** User asked for a detailed (not compact) topology — A5.1 soft-warn threshold. */
export function isDetailedTopologyAsk(question: string | undefined | null): boolean {
  if (!question) return false;
  const q = question.toLowerCase();
  if (/\bcompact\b/.test(q) || /\boverview\b/.test(q) || /\bhigh[- ]?level\b/.test(q)) {
    return false;
  }
  return (
    /\bdetailed?\b/.test(q) ||
    /\bmore detail\b/.test(q) ||
    /\bfull(er)? diagram\b/.test(q) ||
    /\bexhaustive\b/.test(q) ||
    /\bwith descriptions?\b/.test(q)
  );
}

/** User named compact/simple or detailed — server may allow propose_topology. */
export function hasTopologyScopePreference(question: string | undefined | null): boolean {
  if (!question) return false;
  const q = question.toLowerCase();
  if (isDetailedTopologyAsk(question)) return true;
  return (
    /\bcompact\b/.test(q) ||
    /\boverview\b/.test(q) ||
    /\bhigh[- ]?level\b/.test(q) ||
    /\bsimple\b/.test(q) ||
    /\bfew nodes\b/.test(q) ||
    /\bminimal\b/.test(q)
  );
}

/**
 * Draw asks without a scope pick must clarify in chat first — enforced server-side
 * so the model cannot skip straight to a 15-node diagram (owner dogfood 2026-08-28).
 */
export function needsTopologyScopeClarification(question: string | undefined | null): boolean {
  if (!question) return false;
  return isDrawishAskQuestion(question) && !hasTopologyScopePreference(question);
}

/** Share of proposal nodes that carry a non-empty `detail.whatItDoes`. */
export function topologyWhatItDoesCoverage(
  nodes: readonly { detail?: { whatItDoes?: string } | null }[],
): number {
  if (nodes.length === 0) return 1;
  let withDoes = 0;
  for (const n of nodes) {
    if (n.detail?.whatItDoes?.trim()) withDoes += 1;
  }
  return withDoes / nodes.length;
}

/** Soft-warn floor when the user asked for a detailed diagram (A5.1). */
export const DETAILED_TOPOLOGY_WHAT_IT_DOES_MIN = 0.8;

/**
 * True when the short draw path applies (lower round cap + tighter evidence).
 *
 * B1.2 — any draw / diagram intent, attached repo or design mode. Previously
 * only design/no-repo draws got the 2-round cap; attached-repo "draw the
 * gateway" still burned up to {@link MAX_ASK_TOOL_ROUNDS}.
 */
export function isDesignShortPathAsk(input: {
  designMode: boolean;
  repoRoot?: string | null;
  question: string;
}): boolean {
  void input.designMode;
  void input.repoRoot;
  return isDrawishAskQuestion(input.question);
}

/**
 * Resolve the round cap for this ask — honour explicit `maxRounds`, but draw
 * questions never exceed {@link DESIGN_DRAW_ASK_TOOL_ROUNDS} (B1.2).
 */
/**
 * Full-permission EDIT turns get twice the everyday budget by default.
 *
 * Measured live (shopfront, minimax-m3, 2026-08-29): "add a route, then
 * verify it" spent all 8 default rounds on read_topology/search alone and
 * ended with nothing written. Eight rounds is a chat budget — right when a
 * reader is waiting on an answer, wrong for the mode whose deliverable is
 * an edit THAT RAN: read, edit, run the tests, read the failure, fix. An
 * explicit maxRounds from the caller still wins in both directions.
 */
export const FULL_EDIT_ASK_TOOL_ROUNDS = 16;

/**
 * A TURN IS BOUNDED IN ROUNDS AND NOBODY EXPERIENCES ROUNDS.
 *
 * `AiParams.timeoutMs` bounds ONE provider call. A turn is rounds x calls, and
 * until this existed nothing bounded the product: eight rounds that each pass
 * the per-call timeout is a turn with no upper bound in the only unit the
 * person waiting can feel.
 *
 * Practical ML's teach walk hit it — turn 4 was still running when its own
 * 900-second clock killed it, having already drawn its board. That turn was not
 * hung and was not looping; it was spending a round budget at a cost per round
 * nobody had measured. Measured here, a teach turn against small fixtures costs
 * 17-18s, and the slowest fixture conversation in the same run cost 115s per
 * turn -- a 6x spread before a real repository is involved, where the context
 * is larger and every round is slower.
 *
 * WHERE THE NUMBER COMES FROM, since a made-up default is worse than none.
 * Two anchors, both already in this repository: the worst measured fixture turn
 * (115s), and `DESIGN_DRAW_ASK_TOOL_ROUNDS`, whose comment records that
 * seven-minute draws were judged a product defect. Three minutes sits above the
 * first with margin and well under the second. It is a FIRST SETTING chosen
 * from two anchors, not a derived constant, and it should be re-tuned against a
 * real repository -- which is why it is a parameter and why this comment says
 * so rather than implying more rigour than was applied.
 */
export const ASK_TURN_DEADLINE_MS = 180_000;

/**
 * Resolve the wall-clock budget for one turn.
 *
 * SOFT BY CONSTRUCTION: the caller uses this to stop STARTING new tool rounds,
 * never to abort a call in flight. Killing a running generation throws away
 * work the user already waited for and yields nothing, which is the failure
 * being fixed, not a fix for it. Worst case is therefore the deadline plus the
 * round already running.
 *
 * `autoWrites` turns get NO deadline. A benchmark turn's whole job is to spend
 * its budget obtaining the deliverable -- the same reasoning the repeating edit
 * nudge already applies one function over -- and no reader is waiting on it.
 */
export function resolveTurnDeadlineMs(input: {
  turnDeadlineMs?: number;
  autoWrites?: boolean;
}): number | undefined {
  if (typeof input.turnDeadlineMs === 'number' && Number.isFinite(input.turnDeadlineMs)) {
    /* Zero or negative is a caller who meant "no deadline"; it is not a turn
       that may take no time, which would end every turn before its first round. */
    return input.turnDeadlineMs > 0 ? input.turnDeadlineMs : undefined;
  }
  if (input.autoWrites === true) return undefined;
  return ASK_TURN_DEADLINE_MS;
}

export function resolveAskRoundCap(input: {
  maxRounds?: number;
  designMode: boolean;
  repoRoot?: string | null;
  question: string;
  /** Set for Full-permission edit-intent turns — the agentic editing mode. */
  agenticEdit?: boolean;
  /** A teach turn, which owes grounding AND a visual and cannot do both in two. */
  teach?: boolean;
}): number {
  if (input.maxRounds === undefined && input.agenticEdit === true && !input.designMode) {
    return FULL_EDIT_ASK_TOOL_ROUNDS;
  }
  const capped = clampAskRounds(input.maxRounds);
  /*
   * A TEACH TURN NEVER TAKES THE DESIGN-DRAW SHORT PATH.
   *
   * The two-round budget exists for design mode with NO repository: one round to
   * ask, one to land the diagram, nothing to read. A teach turn's contract is the
   * opposite — it must ground the concept in this repository, naming the real
   * node or file and citing file:line, AND ship a visual. Reading takes a round
   * and drawing takes a round, so the grounding has nowhere to go.
   *
   * Worse, the clamp fired on the QUESTION'S WORDING. The teach contract says
   * every concept ships a visual, so every teach turn draws — but only turns
   * phrased drawishly were clamped, and the same lesson got eight rounds or two
   * depending on whether the learner typed "teach me how this works" or "show me
   * on the board". Practical ML's walk hit it with "Now show me on the board how
   * a slot moves from queue to turn": two rounds, one spent on propose_topology.
   *
   * An EXPLICIT `maxRounds` from the caller still wins, here as everywhere — this
   * removes an automatic clamp, it does not override a decision someone made.
   */
  if (input.teach === true) return capped;
  if (isDesignShortPathAsk(input)) return Math.min(capped, DESIGN_DRAW_ASK_TOOL_ROUNDS);
  return capped;
}

/**
 * How many consecutive rounds may bring back nothing new before the loop stops.
 *
 * One would end a turn on a single unlucky round — a model often follows a
 * re-read with the search that actually lands. Two is the smallest number that
 * tolerates that and still refuses to pay for a third identical round.
 *
 * "Nothing new" is measured over an id-INDEPENDENT signature of each tool
 * result. A failed tool is fed back to the model as `### tool <id> (<name>): …`
 * and the id changes every round, so a signature taken over the whole body
 * would score the same refusal as fresh evidence forever and run every failing
 * loop to the ceiling collecting nothing.
 */
export const UNPRODUCTIVE_ROUND_LIMIT = 2;

/**
 * B1.3 — explore asks get one extra dead-end round before no-progress stop.
 *
 * A typical explore turn is search → read → (miss) → search again. Stopping at
 * two identical rounds cuts that path mid-dig; three still refuses a fourth
 * spin while allowing one recovery after a dead end. Draw/edit/chat keep the
 * tighter {@link UNPRODUCTIVE_ROUND_LIMIT}.
 *
 * `teach` shares it: a lesson turn reads the real code before teaching it (the
 * must-read rule, docs/teach-mode.md W1), which is the same search→read→miss
 * path under another name. Teach used to BE 'explore' in askPipeline for
 * exactly this budget; it became its own bucket so the belt could see it, and
 * the budget follows it here rather than being lost in the split.
 */
export const EXPLORE_UNPRODUCTIVE_ROUND_LIMIT = 3;

/** Resolve unproductive-round budget from classified intent (B1.3). */
export function resolveUnproductiveRoundLimit(
  intent: 'teach' | 'draw' | 'explore' | 'edit' | 'chat',
  maxRounds?: number,
): number {
  const base =
    intent === 'explore' || intent === 'teach'
      ? EXPLORE_UNPRODUCTIVE_ROUND_LIMIT
      : UNPRODUCTIVE_ROUND_LIMIT;
  /*
   * A caller that RAISED the round budget raised the dead-end budget with it.
   *
   * Measured on SWE-bench (minimax-m3, mini-50 run v6): --rounds 32 was
   * granted, and turns still died at rounds two-to-five because a couple of
   * refused commands or cached re-reads tripped the everyday limit — the
   * 32-round grant was unspendable. The everyday limit is a chat-UX budget
   * (a reader is waiting); an explicitly-raised budget says nobody is. One
   * extra dead end per eight granted rounds keeps the spin bound proportional.
   */
  if (maxRounds !== undefined && maxRounds > MAX_ASK_TOOL_ROUNDS) {
    return Math.max(base, Math.ceil(maxRounds / 8));
  }
  return base;
}

/**
 * The most rounds a single request may ask for.
 *
 * CANON names the defect this closes — P7, "the round cap is still low": a
 * hard question stops at eight rounds with an apology and no way to say keep
 * going, and a throwaway question gets the same eight.
 *
 * BUT AN OVERRIDE IS NOT A LICENCE. Every round is a metered provider call, so
 * an unbounded "keep going" is an unbounded bill authored by whoever typed the
 * number. This ceiling is the point past which a caller is no longer raising a
 * limit but removing one.
 *
 * Four times the default: enough that a genuinely hard question can finish,
 * small enough that a mistake is a recoverable amount of money.
 */
export const ASK_ROUNDS_CEILING = 32;

/**
 * Resolve a requested round cap against the default and the ceiling.
 *
 * Anything that is not a usable number falls back to the default rather than
 * throwing. A malformed `maxRounds` on the wire is a client bug, and failing a
 * whole question over it would turn a small client bug into no answer at all.
 */
export function clampAskRounds(requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return MAX_ASK_TOOL_ROUNDS;
  const whole = Math.floor(requested);
  /* Below one is not "no rounds", it is a caller who meant something else — and
     zero rounds means the model may never use a tool, which is a different
     feature and not this one. */
  if (whole < 1) return MAX_ASK_TOOL_ROUNDS;
  return Math.min(whole, ASK_ROUNDS_CEILING);
}

/** Read-only tools whose identical args may be served from the per-turn cache. */
export const ASK_TOOL_CACHEABLE: readonly AskToolName[] = [
  'read_file',
  'search_files',
  'read_topology',
  'locate_symbol',
  'who_calls',
  'git_status',
  'git_diff',
  'call_mcp',
  'call_plugin',
  'fetch_url',
];

export function isAskToolCacheable(name: string): boolean {
  return (ASK_TOOL_CACHEABLE as readonly string[]).includes(name);
}

/** Stable JSON for cache keys — sorted object keys, deterministic arrays. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

/** Per-turn tool cache key: tool name + stable args hash. */
export function stableAskToolCacheKey(
  name: string,
  args: Record<string, unknown> | undefined,
): string {
  return `${name}\u0000${stableJson(args ?? {})}`;
}

/** Tools limited to one successful call per turn (topology / files / canvas). */
export function isOncePerTurnAskTool(name: string): boolean {
  return (
    name === 'propose_topology' ||
    name === 'propose_files' ||
    name === 'edit_file' ||
    isCanvasToolName(name)
  );
}

/*
 * THE FILE LATCH IS A REVIEW-SEAT RULE, NOT A WRITE RULE.
 *
 * Under `propose`, one staged proposal per turn is right: Review is the next
 * seat, a second card would stack on an unanswered first, and every further
 * round burns tokens the user cannot act on until Accept/Deny.
 *
 * Under `autoEdit`/`full` there IS no Review seat — the write lands on disk the
 * moment the tool succeeds — and the same latch was what made write→test→fix
 * impossible inside one turn: the agent edited, ran the tests, watched them
 * fail, and was then refused the fix. (Measured on SWE-bench: the model named
 * the right bug in prose and could not act twice.) So auto-write modes trade
 * the latch for a CONSEQUENCE BUDGET — a per-turn cap on file-edit calls, high
 * enough for edit→test→edit loops, low enough that a looping model cannot
 * rewrite a tree unbounded. The refusal at the cap says what was spent, so the
 * model's next move is to report, not to retry.
 */
export const ASK_TOOL_WRITE_CALLS_PER_TURN = 16;

export function oncePerTurnAskToolRefusal(name: string, autoWrites = false): string {
  if (name === 'propose_topology') {
    return (
      'Refused — this turn already placed one topology proposal on the board. ' +
      'Do not call propose_topology again; continue in words or refine the existing proposal.'
    );
  }
  if (name === 'propose_files' || name === 'edit_file') {
    if (autoWrites) {
      return (
        `Refused — this turn already spent its write budget of ` +
        `${ASK_TOOL_WRITE_CALLS_PER_TURN} file-edit calls. Do not call ${name} again; ` +
        `report what was changed, what was verified, and what remains.`
      );
    }
    return (
      'Refused — this turn already staged one file-edit proposal for Review. ' +
      `Do not call ${name} again; describe the change in words or wait for Accept/Deny.`
    );
  }
  /*
   * A REFUSAL THAT DOES NOT NAME THE WAY FORWARD SPENDS A ROUND TEACHING
   * NOTHING. Owner's screen, 2026-09-02: a teaching turn wrote one generic
   * markdown block, then burned its three remaining canvas calls being told
   * "do not call it again" — so the lesson arrived as a text block and the
   * breakdown never got drawn. `propose_chart` is the answer the old wording
   * withheld: it carries many items, links and a caption in ONE validated call,
   * so a multi-part breakdown does not need a second write at all.
   */
  return (
    `Refused — this turn already wrote to the AI Canvas. One canvas.write_* per turn; ` +
    `do not call \`${name}\` again. To draw a breakdown — several parts and how they ` +
    `connect — call propose_chart instead: one chart carries every item, link and caption ` +
    `in a single call, is checked against the real graph, and renders in the app.`
  );
}

/** True when this once-per-turn tool already succeeded earlier in the turn.
 *
 * `autoWrites` + `fileWriteCalls` switch the file tools from the one-proposal
 * latch (propose mode: Review is waiting) to the consequence budget (auto-write
 * modes: iteration is the point) — see ASK_TOOL_WRITE_CALLS_PER_TURN above.
 */
export function oncePerTurnAskToolAlreadySucceeded(
  name: string,
  flags: {
    topology: boolean;
    canvas: boolean;
    files: boolean;
    autoWrites?: boolean;
    fileWriteCalls?: number;
  },
): boolean {
  if (name === 'propose_topology') return flags.topology;
  if (name === 'propose_files' || name === 'edit_file') {
    if (flags.autoWrites) return (flags.fileWriteCalls ?? 0) >= ASK_TOOL_WRITE_CALLS_PER_TURN;
    return flags.files;
  }
  if (isCanvasToolName(name)) return flags.canvas;
  return false;
}

/** Per-read byte cap (matches the file-research per-file budget). */
export const ASK_TOOL_READ_CAP_BYTES = 12_000;

/**
 * The read window under FULL permission — four times the everyday cap.
 *
 * Measured on sphinx-8035 (mini-50 probe, 2026-08-31): one 2,148-line file
 * took 25+ read_file calls at the 12KB window — the model spent its whole
 * round budget PAGINATING and answered the verify demand with more reads.
 * MEASURED BOTH WAYS: at 4x (48KB, run v16) the fat prompts tripled wall
 * time on the free tier and resolved one FEWER instance than v14 — prefill
 * is not free. 2x keeps half the pagination win at a quarter of the cost.
 */
export const ASK_TOOL_READ_CAP_BYTES_FULL = 24_000;

/** Search caps: never let a grep flood the prompt. */
export const ASK_TOOL_SEARCH_MAX_RESULTS = 20;
/*
 * 200 EXAMINED FILES WAS 13% OF THIS REPOSITORY, and the cut bought nothing the
 * byte caps below were not already buying: a match costs
 * ASK_TOOL_SEARCH_SNIPPET_CHARS against ASK_TOOL_SEARCH_TOTAL_CAP_BYTES, and the
 * walk is bounded by ASK_TOOL_SEARCH_MAX_WALK either way. What 200 actually
 * bounded was how much of the tree the agent could ever see, and the answer on
 * any repository larger than a fixture was "not the part with the answer in it".
 * Non-text files no longer charge against it at all (see walkFiles).
 */
export const ASK_TOOL_SEARCH_MAX_FILES = 5_000;
/*
 * Files EXAMINED is the expensive budget - each one is stat'd and read. Paths CROSSED is
 * cheap: a regex against a string. Keeping them separate is what makes "narrow with a glob"
 * true advice, and the walk bound still stops a pathological tree. Well above any real source
 * tree: this monorepo crosses roughly a thousand paths with build and dependency directories
 * skipped.
 */
export const ASK_TOOL_SEARCH_MAX_WALK = 20_000;
/**
 * The per-file ceiling for a CONTENT search.
 *
 * This was 256,000 and it had exactly one victim in this repository: repoServer.ts at
 * 337,114 bytes — the file holding every API route, which is the file most questions are
 * about. It was skipped SILENTLY, so a search for a symbol declared inside it answered
 * "no matches" and a reader concluded the symbol did not exist. That is how a weak model
 * came to invent an answer to "which file builds stalePaths": the file with the answer was
 * not searchable, and nothing said so.
 *
 * A line scan does not need the whole-file budget a READ needs. One megabyte admits every
 * real source file in this repo (largest: 337KB) while still refusing a minified bundle,
 * and anything skipped is now NAMED in the evidence rather than dropped.
 */
export const ASK_TOOL_SEARCH_MAX_FILE_BYTES = 1_000_000;
export const ASK_TOOL_SEARCH_SNIPPET_CHARS = 200;
export const ASK_TOOL_SEARCH_TOTAL_CAP_BYTES = 24_000;

/** propose_files caps: never let a proposal flood the prompt or the SSE. */
export const ASK_TOOL_PROPOSE_MAX_FILES = 20;
export const ASK_TOOL_PROPOSE_MAX_FILE_BYTES = 100_000;
export const ASK_TOOL_PROPOSE_TOTAL_CAP_BYTES = 500_000;

/** run_command output cap (stdout + stderr combined) fed back to the model. */
export const ASK_TOOL_RUN_CMD_OUTPUT_CAP = 4_000;
/** run_command hard timeout — a hostile/slow command cannot pin the ask. */
export const ASK_TOOL_RUN_CMD_TIMEOUT_MS = 30_000;
/** Full-permission run_command timeout — a real test suite does not fit in 30s,
 *  and Full is the mode whose whole point is write→test→fix. */
export const ASK_TOOL_RUN_CMD_FULL_TIMEOUT_MS = 180_000;

/** git_status / git_diff output cap fed back into the next provider call. */
export const ASK_TOOL_GIT_OUTPUT_CAP = 12_000;

/** call_mcp content cap fed back into the next provider call. */
export const ASK_TOOL_MCP_OUTPUT_CAP = 4_000;

/** call_plugin content cap fed back into the next provider call. */
export const ASK_TOOL_PLUGIN_OUTPUT_CAP = 4_000;

/**
 * Closed builtin handlers for declared readonly plugin tools (C2.3).
 * A tool must appear in `.sequence/plugins.json` AND have a handler here —
 * otherwise ask refuses with an honest "no handler" (never invents output).
 */
export const BUILTIN_PLUGIN_TOOL_HANDLERS: Readonly<
  Record<
    string,
    (args: Record<string, unknown>, meta: { plugin: string; tool: string }) => string
  >
> = {
  ping: (args, meta) =>
    JSON.stringify({
      ok: true,
      pong: true,
      plugin: meta.plugin,
      tool: meta.tool,
      args,
    }),
};

/**
 * Byte budget for the mid-turn EVIDENCE LEDGER — the tool results carried
 * forward from EARLIER rounds of this turn into a later round's prompt.
 *
 * Derived from an existing cap, not invented: the largest single result the
 * loop admits is a `search_files` at ASK_TOOL_SEARCH_TOTAL_CAP_BYTES. Budget
 * the carried history at two of those, so in the common case (a read is capped
 * at ASK_TOOL_READ_CAP_BYTES = 12,000) the four most recent earlier results
 * survive whole, while total prompt growth from carrying is bounded and
 * independent of how many tools the model requests per round.
 *
 * The CURRENT round is never charged against this budget — see
 * {@link selectCarriedEvidence}.
 */
export const ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES = 2 * ASK_TOOL_SEARCH_TOTAL_CAP_BYTES;

/**
 * Tighter carried-evidence budget on the design draw short-path — same retention
 * policy as {@link selectCarriedEvidence}, half the byte cap so topology rounds
 * spend tokens on the diagram, not re-carried tool prose.
 */
export const DESIGN_SHORT_PATH_EVIDENCE_LEDGER_CAP_BYTES =
  ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES / 2;

/** Byte budget for earlier-round evidence carried into the next provider call. */
export function resolveAskEvidenceLedgerCap(input: {
  designMode: boolean;
  repoRoot?: string | null;
  question: string;
}): number {
  if (isDesignShortPathAsk(input)) return DESIGN_SHORT_PATH_EVIDENCE_LEDGER_CAP_BYTES;
  return ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES;
}

export interface AskToolRequest {
  id: string;
  name: string;
  /** Tool arguments (path / query / glob). Absent ⇒ refused as unexecutable. */
  args?: Record<string, unknown>;
  /** Optional human label the provider attached (echoed in SSE). */
  evidence?: string;
}

export interface AskToolContext {
  /** The jail choke point — same one GET /api/file uses. `null` ⇒ refused. */
  resolveReadable: (rel: string) => string | null;
  /** Canonical repo root for the search walk. `null` in design mode. */
  repoRoot: string | null;
  /** Real graph node ids, used to reject topology edges that would dangle. */
  topologyNodeIds?: ReadonlySet<string>;
  /** True when no repo is attached (design sketch). All tools refused. */
  designMode: boolean;
  /** Latest user question — drives detailed-topology soft warns (A5.1). */
  question?: string;
  /** Work omits run_command even when a repo is attached. */
  jobMode?: AskJobMode;
  /** Permission mode for this turn — `full` widens run_command to runner bins. */
  permission?: string;
  /**
   * SANDBOXED FULL EXEC — set ONLY by a runner that owns the whole machine the
   * command runs on (the SWE-bench Docker container; env SEQUENCE_SANDBOX_EXEC=1).
   *
   * Measured on the field (Claw-SWE-Bench paper arXiv:2606.12344): every harness
   * above 60% gives the model unrestricted shell, and the winning 8-phase method
   * REQUIRES writing and running a repro script before any fix — which the
   * runner-bin whitelist refuses. In an isolated container the container IS the
   * sandbox, so run_command runs arbitrary `bash -lc` here. NEVER set for the
   * product's local-repo mode, where the whitelist and jail still bind.
   */
  sandboxExec?: boolean;
  /**
   * P3 phase 2 — the user's allow/ask/deny rules, already merged across
   * sources. Absent ⇒ no rule file anywhere ⇒ nothing here changes: the jail,
   * the verifyGate allowlist and `propose_files`-never-writes are code and are
   * unaffected either way. See `permissionRules.ts`.
   */
  permissions?: PermissionPolicy;
  /**
   * AUTO-APPROVE — the unattended autonomy mode, resolved for THIS TURN.
   *
   * True only when the user switched it on for this repository AND the
   * repository is still trusted; the pipeline asks `isAutoApproveActive` once
   * per turn and never caches the answer across turns, so attaching an
   * untrusted repo with the mode already on does not run autonomously
   * (`server/autoApprove.ts` carries the reasoning).
   *
   * It changes exactly one thing: an `ask` verdict becomes `allow`. A `deny` is
   * untouched, and every CODE refusal below — the jail, the runner allowlist,
   * the resolved-script check, Work mode's missing `run_command` — is
   * unaffected, because auto-approve removes the prompt and never the ceiling.
   */
  autoApprove?: boolean;
  /** When true, `canvas.write_*` tools may run (AI Canvas tab or diagram intent). */
  canvasToolsEnabled?: boolean;
  /**
   * The structure digest this turn was built from — what `read_topology` expands.
   *
   * Absent ⇒ `read_topology` refuses honestly rather than inventing a service
   * list. It is the SAME object the prompt was rendered from, so an expansion
   * can never disagree with the index the model was shown.
   */
  digest?: Digest | null;
  /**
   * The scanned graph — what `who_calls` walks. Absent ⇒ that tool refuses.
   * Sequence's whole claim is that this graph exists; handing it to the model
   * is the difference between a grounded answer and a grep.
   */
  graph?: ArchGraph | null;
}

/**
 * What a permission SPECIFIER is matched against, for one tool call.
 *
 * This function is the only place that knows an ask tool's argument shape, and
 * it lives here rather than in `permissionRules.ts` for exactly that reason —
 * the matcher must not have to be edited when a tool gains an argument.
 *
 * Two tools deliberately expose NO subject:
 *
 *   `git_status` takes no path. Only a bare `git_status` (or `*`) rule reaches
 *   it, which is the truth.
 *
 *   `search_files` takes a `glob`, and it would be very easy to hand that glob
 *   over as if it were the set of files the tool touches. IT IS NOT. The walk
 *   OPENS AND GREPS every file under the jail in order to decide which ones
 *   match the query; the glob only filters what comes back. A rule reading
 *   `search_files(/src/**)` would therefore promise a containment the tool does
 *   not honour, and a permission rule that promises something it cannot keep is
 *   worse than no rule. `search_files` is constrained at the tool level or not
 *   at all — and the read jail still bounds it.
 */
export function permissionSubjects(
  name: string,
  args: Record<string, unknown> | undefined,
): PermissionSubject[] {
  const a = args ?? {};
  switch (name) {
    case 'locate_symbol':
    case 'read_file':
    case 'edit_file':
    case 'git_diff': {
      const p = asString(a.path);
      return p ? [{ kind: 'path', value: p }] : [];
    }
    case 'propose_files': {
      const files = Array.isArray(a.files) ? a.files : [];
      const out: PermissionSubject[] = [];
      for (const f of files) {
        if (!f || typeof f !== 'object') continue;
        const p = asString((f as Record<string, unknown>).path);
        if (p) out.push({ kind: 'path', value: p });
      }
      return out;
    }
    case 'run_command': {
      const cmd = asString(a.cmd);
      return cmd ? [{ kind: 'command', value: cmd }] : [];
    }
    case 'call_mcp': {
      const server = asString(a.server);
      const tool = asString(a.tool);
      return server ? [{ kind: 'mcp', value: `${server}:${tool ?? ''}` }] : [];
    }
    case 'call_plugin': {
      const plugin = asString(a.plugin);
      const tool = asString(a.tool);
      return plugin ? [{ kind: 'plugin', value: `${plugin}:${tool ?? ''}` }] : [];
    }
    case 'fetch_url': {
      const u = asString(a.url);
      return u ? [{ kind: 'url', value: u }] : [];
    }
    default:
      return [];
  }
}

export type AskToolFileEvent =
  | { type: 'file:read'; path: string }
  | { type: 'file:done'; path: string };

/**
 * A proposed CHANGE TO THE ARCHITECTURE, attached to a tool result for SSE
 * emission. Never written to any document — the board draws it dashed and the
 * reader accepts or denies it.
 */
export interface AskToolTopology {
  title?: string;
  rationale?: string;
  nodes: { id: string; label: string; kind: string; detail?: SeqDiagramNodeDetail }[];
  edges: { id: string; from: string; to: string; family: string; label?: string }[];
}

/** A multi-file edit proposal attached to a tool result for SSE emission. */
export interface AskToolProposal {
  /** Optional human title the model attached to the proposal. */
  title?: string;
  /**
   * WHY THIS IS THE RIGHT CHANGE, in the model's own words.
   *
   * `TopologyProposal` has carried one from the start and the board renders
   * it, so a proposed change to the ARCHITECTURE explains itself. A proposed
   * change to the CODE could not: this tool took a title and files and nothing
   * else, so the most consequential thing this product does - rewriting a
   * reader's files - arrived as a title and a diff.
   *
   * A title NAMES the change. A rationale says why it is the right one, which
   * is what a reviewer needs in order to disagree with it.
   */
  rationale?: string;
  /** Jail-checked, repo-relative files with their proposed contents. */
  files: { path: string; content: string }[];
}

export interface AskToolResult {
  ok: boolean;
  /** Set by `propose_topology`. The server emits it as `topology:proposal`. */
  topology?: AskToolTopology;
  /** Set by `propose_plan`: the lesson's concept list, stored once. */
  plan?: Concept[];
  /** Set by `propose_chart`. The server emits it as `chart:proposal`. */
  chart?: import('@sequence/schema').SeqChart;
  /** Set by `canvas.write_*`. The server emits it as `canvas:block`. */
  canvasBlock?: import('./canvasTools.js').CanvasBlock;
  /** Set by `canvas.set_story_route`. The server emits it as `canvas:story`. */
  storyRoute?: import('./canvasTools.js').CanvasStoryRoutePayload;
  /**
   * Set by `locate_symbol` when it found the symbol AND the files it found it
   * in are nodes of the scanned graph. The server emits it as `lookup:located`
   * so the board can light the part that holds the declaration.
   *
   * Graph node ids, never file paths: the board dims by node id, and handing it
   * a path would be a value it has to guess how to match. Absent when the
   * lookup missed, or when it hit in files this graph has no node for — an
   * absent field says "nothing to point at", which an empty array does not.
   */
  located?: string[];
  /**
   * The items this result's answer is ABOUT, for the next turn to refer back
   * to. Set by tools that return a LIST a follow-up question can point at with
   * a pronoun. Carried only when `SEQUENCE_ASK_CARRY_REFERENTS=1`.
   *
   * Only `who_calls` sets it today. That is deliberate rather than unfinished:
   * it is the tool the registered seat conversation uses, and a slot filled by
   * three tools at once could not say which one the result came from.
   */
  referents?: { tool: string; subject: string; items: readonly string[]; total: number };
  /** Short human label for the SSE `tool:done` event, e.g. `read gateway/...`. */
  evidence: string;
  /** Prompt-section body fed back into the next provider call. */
  content?: string;
  /**
   * Structured multi-file edit proposal (from `propose_files`). When present,
   * the ask pipeline emits an `edit:proposal` SSE event so the web client can
   * stage a FileEditProposalBar from structured data — not by hoping to parse
   * it out of the model text. The proposal is NEVER written to disk by this
   * tool; applying it is a separate, user-confirmed step.
   */
  proposal?: AskToolProposal;
  /**
   * Structured command log entry (from `run_command` after spawn). Emitted as
   * `command:log` SSE so the web client can append to the Index command seat.
   * Not set for allowlist refusals before spawn.
   */
  commandLog?: { cmd: string; exitCode: number | null; output: string; ok: boolean };
  /**
   * True when this result came from the per-turn cache rather than a fresh
   * execution — i.e. the model asked for something it already has.
   *
   * Set by the pipeline, never by a tool. It exists so the model can be TOLD,
   * because silence here is what let a local model call `read_file` on the same
   * path four rounds running: each identical call returned the identical first
   * 233 lines and nothing in the result said "you already ran this".
   */
  cacheHit?: boolean;
  /**
   * The permission verdict, when a rule decided this call. Present on BOTH a
   * refusal and an explicit allow, so a caller can tell "no rule matched" from
   * "a rule said yes" — those are different states and the circuit breaker
   * counts them differently.
   */
  permission?: PermissionVerdict;
}

/**
 * Execute one allowlisted tool. Unknown names and design mode are refused with
 * `ok: false` and an honest `evidence` — never a fabricated result. Async
 * because `git_status` / `git_diff` wrap the async gitWorkspace layer.
 */
export async function executeAskTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): Promise<AskToolResult> {
  if (!ASK_DISPATCHABLE_TOOLS.includes(name)) {
    return { ok: false, evidence: `refused: unknown tool "${name}"` };
  }
  /*
   * P3 PHASE 2 — THE RULE ALGEBRA, APPLIED BEFORE THE TOOL RUNS.
   *
   * `deny` and `ask` both REFUSE, and both refuse OUT LOUD: the verdict's
   * reason names the rule as written and the file it is in, and the pipeline
   * feeds that whole sentence back to the model as this tool's result. Nothing
   * is dropped — `askTools.ts` already carries one silent path
   * (`parseFencedToolRequests` drops a malformed block) and a second one here
   * would leave the model waiting on a tool result that never arrives, which is
   * the one outcome the "a turn always ends in words" rule exists to prevent.
   *
   * `ask` refuses rather than proceeding because THERE IS NORMALLY NO APPROVAL
   * CHANNEL OPEN IN AN ASK TURN, and treating `ask` as `allow` would be the
   * surface asserting a consent the engine never collected. The verdict text
   * says exactly that, so the model can ask the user in words instead of
   * retrying.
   *
   * `ctx.autoApprove` IS that channel, opened in advance: the user turned the
   * unattended mode on for a repository they had already trusted
   * (`server/autoApprove.ts`). It converts `ask` and ONLY `ask`, and the turn
   * says so on screen — see `AUTO_APPROVE_STEP_ID`.
   *
   * THE GATE IS THE FIRST THING A KNOWN TOOL MEETS — above the canvas branch,
   * the Work-mode `run_command` refusal, `fetch_url` and the design-mode
   * branch, all of which live in {@link executeAskToolUnderModeGates}. It
   * used to sit BELOW them, and each of those branches returned before it
   * ran: `deny fetch_url(*)` parsed, validated against `knownTools`, raised no
   * warning and never fired (harness-checklist audit G2). Worse than the
   * missed refusal, a bypassed call carried no `permission` verdict, which
   * `applyAskToolRoundResult` reads as `allow` — so a call the user had
   * denied RESET the circuit breaker's deny streak. One gate, every tool: the
   * canvas writers and the story route are policy subjects like everything
   * else, because a `"default": "deny"` file that still let the model write
   * to the canvas would not be the allowlist-only posture it promises.
   *
   * The mode gates below are CODE, not rules, and an explicit allow verdict
   * rides along on their refusals unchanged: a `run_command` allowed by rule
   * but refused by Work mode is not a permission event, and the breaker must
   * not count it as one.
   */
  if (ctx.permissions) {
    const verdict = evaluatePermission(ctx.permissions, {
      tool: name,
      subjects: permissionSubjects(name, args),
      repoRoot: ctx.repoRoot,
    });
    /*
     * AUTO-APPROVE IS THIS ONE LINE, AND IT IS ONE LINE ON PURPOSE.
     *
     * `ask` means "the user has to say yes and there is nobody here to ask".
     * Auto-approve is the user having said yes in advance, for this session,
     * on a repository they have trusted. So the mode is exactly `ask -> allow`
     * and nothing else — the `deny` list is not consulted differently, the
     * subjects are not re-matched, no rule is skipped.
     *
     * `isAskVerdict` is not a stylistic guard: `approveAskVerdict` takes an
     * `AskPermissionVerdict`, which is only obtainable through it, so a future
     * edit that widened this to `verdict.decision !== 'allow'` would not
     * compile. That is the difference between a rule and a comment asking
     * people to be careful — the deny path here has been the one thing this
     * mode may never touch since it was specified.
     */
    const effective =
      ctx.autoApprove === true && isAskVerdict(verdict) ? approveAskVerdict(verdict) : verdict;
    if (effective.decision !== 'allow') {
      return {
        ok: false,
        evidence: `refused: ${effective.reason}`,
        permission: effective,
      };
    }
    /*
     * An explicit allow is recorded so the circuit breaker can tell it from a
     * call that simply matched nothing — and an AUTO-APPROVED call is recorded
     * even when no rule named it (a `"default": "ask"` document produces a
     * ruleless ask), because a call that ran unattended must leave a receipt
     * saying so. `effective !== verdict` is true exactly when the transform
     * fired.
     */
    if (effective.rule !== undefined || effective !== verdict) {
      const result = await executeAskToolUnderModeGates(name, args, ctx, onFile);
      return { ...result, permission: effective };
    }
  }
  return executeAskToolUnderModeGates(name, args, ctx, onFile);
}

/**
 * The per-turn MODE gates, after the permission gate has said yes (or there is
 * no policy). Canvas tools need `canvasToolsEnabled`; Work mode has no
 * `run_command`; `fetch_url` needs no repo; everything else refuses without one
 * because it would fabricate file evidence. Order and refusal text are exactly
 * what {@link executeAskTool} produced before the permission gate was hoisted
 * above them — with no policy on the context, the two are the same function.
 */
async function executeAskToolUnderModeGates(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): Promise<AskToolResult> {
  if (isCanvasToolName(name)) {
    if (!ctx.canvasToolsEnabled) {
      return {
        ok: false,
        evidence: `refused: ${name} — AI Canvas tools are not active for this turn`,
      };
    }
    const result = executeCanvasWrite(name, args);
    if (result.ok && result.block) {
      return {
        ok: true,
        evidence: result.evidence,
        content: result.content,
        canvasBlock: result.block,
      };
    }
    return { ok: false, evidence: result.evidence };
  }
  if (name === CANVAS_STORY_TOOL) {
    if (!ctx.canvasToolsEnabled) {
      return {
        ok: false,
        evidence: `refused: ${name} — AI Canvas tools are not active for this turn`,
      };
    }
    const result = executeCanvasStoryRoute(args);
    if (result.ok && result.storyRoute) {
      return {
        ok: true,
        evidence: result.evidence,
        content: result.evidence,
        storyRoute: result.storyRoute,
      };
    }
    return { ok: false, evidence: result.evidence };
  }
  if (name === 'run_command' && ctx.jobMode === 'work') {
    return { ok: false, evidence: 'refused: run_command is not a Work-mode default' };
  }
  if (name === 'fetch_url') {
    return dispatchAskTool(name, args, ctx, onFile);
  }
  if (ctx.designMode || ctx.repoRoot === null) {
    /* Design / blank workspace: topology proposals and canvas writers are honest
       without a repo — every other tool would fabricate file evidence. */
    if (name === 'propose_topology' || name === 'propose_chart' || name === CANVAS_STORY_TOOL || (isCanvasToolName(name) && ctx.canvasToolsEnabled)) {
      return dispatchAskTool(name, args, ctx, onFile);
    }
    return { ok: false, evidence: `refused: ${name} needs an attached repo` };
  }
  return dispatchAskTool(name, args, ctx, onFile);
}

async function dispatchAskTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): Promise<AskToolResult> {
  switch (name) {
    case 'read_file':
      return executeReadFile(args ?? {}, ctx, onFile);
    case 'edit_file':
      return executeEditFile(args ?? {}, ctx, onFile);
    case 'read_topology':
      return executeReadTopology(args ?? {}, ctx);
    case 'locate_symbol':
      return executeLocateSymbol(args ?? {}, ctx);
    case 'who_calls':
      return executeWhoCalls(args ?? {}, ctx);
    case 'search_files':
      return executeSearchFiles(args ?? {}, ctx, onFile);
    case 'propose_files':
      return executeProposeFiles(args ?? {}, ctx);
    case 'propose_chart':
      return executeProposeChart(args ?? {}, ctx);
    case 'propose_plan':
      return executeProposePlan(args ?? {}, ctx);
    case 'propose_topology':
      return executeProposeTopology(args ?? {}, ctx);
    case 'run_command':
      return executeRunCommand(args ?? {}, ctx);
    case 'git_status':
      return executeGitStatus(args ?? {}, ctx);
    case 'git_diff':
      return executeGitDiff(args ?? {}, ctx, onFile);
    case 'call_mcp':
      return executeCallMcp(args ?? {}, ctx);
    case 'call_plugin':
      return executeCallPlugin(args ?? {}, ctx);
    case 'fetch_url':
      return executeFetchUrl(args ?? {}, ctx);
    default:
      if (isCanvasToolName(name)) {
        const result = executeCanvasWrite(name as CanvasToolName, args);
        if (result.ok && result.block) {
          return {
            ok: true,
            evidence: result.evidence,
            content: result.content,
            canvasBlock: result.block,
          };
        }
        return { ok: false, evidence: result.evidence };
      }
      return { ok: false, evidence: `refused: unknown tool "${name}"` };
  }
}

/**
 * `read_file` — one repo-relative file, or one RANGE of one file.
 *
 * ── WHY THE RANGE ARGUMENTS EXIST ──────────────────────────────────────────
 *
 * This used to take exactly `{ path }` and return `raw.slice(0, 12_000)`. The
 * cap is right — an uncapped read floods the prompt — but a head slice with no
 * way to ask for the rest is not a cap, it is a ceiling. MEASURED on this
 * repository: 201 of the 912 tracked `.ts`/`.tsx` files under `packages/` are
 * larger than 12,000 bytes (22%), and this file is one of them. An agent asked
 * about a function below byte 12,000 could see the imports, could not see the
 * function, and had NO follow-up call that would get it — the honest
 * "(truncated)" marker named a problem the belt could not solve. Worse, the
 * result was cached under a key derived from the arguments, and the arguments
 * could not vary, so every later read in the turn returned the same head.
 *
 * `offset` (1-based first line) and `limit` (line count) fix both: the model can
 * page, and each page is a different cache key. The truncation notice now names
 * the exact call that continues the read, because advice a reader cannot act on
 * is the defect this module's search comments already record once.
 *
 * LINES ARE NUMBERED, `cat -n` style, so an answer can cite a line and
 * {@link executeEditFile} has something to anchor against. The gutter is
 * display only — `stripReadFileGutter` reverses it when a model copies numbered
 * text back into an edit.
 */
export const ASK_TOOL_READ_MAX_LINES = 2_000;

function executeReadFile(
  args: Record<string, unknown>,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): AskToolResult {
  const rel = asString(args.path);
  if (!rel) return { ok: false, evidence: 'refused: read_file missing "path"' };
  const normalized = rel.replace(/\\/g, '/');
  onFile?.({ type: 'file:read', path: normalized });
  const abs = ctx.resolveReadable(rel);
  if (!abs) {
    onFile?.({ type: 'file:done', path: normalized });
    return { ok: false, evidence: `refused: "${normalized}" not readable (jail or reserved)` };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    onFile?.({ type: 'file:done', path: normalized });
    return { ok: false, evidence: `refused: "${normalized}" not found` };
  }
  if (!stat.isFile()) {
    onFile?.({ type: 'file:done', path: normalized });
    return { ok: false, evidence: `refused: "${normalized}" is not a file` };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    onFile?.({ type: 'file:done', path: normalized });
    return { ok: false, evidence: `refused: "${normalized}" unreadable` };
  }
  onFile?.({ type: 'file:done', path: normalized });

  const allLines = raw.split('\n');
  const totalLines = allLines.length;
  /* A non-number, a zero or a negative is a client/model slip, not a request for
     "no lines" — fall back to the whole file rather than answering with nothing. */
  const offset = Math.min(Math.max(asNumber(args.offset) ?? 1, 1), Math.max(totalLines, 1));
  const limit = Math.min(asNumber(args.limit) ?? ASK_TOOL_READ_MAX_LINES, ASK_TOOL_READ_MAX_LINES);

  const window = allLines.slice(offset - 1, offset - 1 + limit);
  const numbered: string[] = [];
  let bytes = 0;
  let byteCut = false;
  const byteCap =
    ctx.permission === 'full' ? ASK_TOOL_READ_CAP_BYTES_FULL : ASK_TOOL_READ_CAP_BYTES;
  for (let i = 0; i < window.length; i++) {
    const row = `${String(offset + i).padStart(5, ' ')}|${window[i]}`;
    if (bytes + row.length + 1 > byteCap) {
      byteCut = true;
      break;
    }
    bytes += row.length + 1;
    numbered.push(row);
  }
  const lastLine = offset + numbered.length - 1;
  const more = lastLine < totalLines;
  const rangeLabel = `lines ${offset}-${Math.max(lastLine, offset - 1)} of ${totalLines}`;
  const cut = more
    ? ` (${rangeLabel}${byteCut ? `, cut at ${ASK_TOOL_READ_CAP_BYTES} bytes` : ''}` +
      ` — call read_file again with {"path":"${normalized}","offset":${lastLine + 1}} for more)`
    : offset > 1
      ? ` (${rangeLabel})`
      : '';
  const header = `### ${normalized}${cut}`;
  const content = wrapUntrustedLines([
    header,
    '```',
    neutralizeUntrusted(numbered.join('\n')),
    '```',
  ]).join('\n');
  return {
    ok: true,
    evidence: `read ${normalized}${more ? ` (${rangeLabel} — more remains)` : ''}`,
    content,
  };
}

/**
 * EXPORTED so the user-facing search route can call the SAME function.
 *
 * Repo-wide search existed as an agent-internal tool and as nothing a person
 * could reach — the reader had to ask the assistant to grep for them, which
 * spends a provider round on a question the machine can answer for free.
 *
 * Exposed by reuse rather than reimplemented: a second search would be a
 * second set of caps, a second jail check and a second answer to "what is in
 * this repository", and the two would drift.
 */
export function executeSearchFiles(
  args: Record<string, unknown>,
  ctx: AskToolContext,
  _onFile?: (event: AskToolFileEvent) => void,
): AskToolResult {
  const query = asString(args.query);
  const glob = asString(args.glob);
  if (!query && !glob) {
    return { ok: false, evidence: 'refused: search_files needs "query" or "glob"' };
  }
  const maxResults = asNumber(args.maxResults) ?? ASK_TOOL_SEARCH_MAX_RESULTS;
  const globRe = glob ? globToRegex(glob) : null;
  const queryLower = query ? query.toLowerCase() : null;
  const matches: string[] = [];
  let filesExamined = 0;
  let pathsCrossed = 0;
  let totalBytes = 0;
  let resultsTruncated = false;

  walkFiles(ctx.repoRoot!, (rel) => {
    if (filesExamined >= ASK_TOOL_SEARCH_MAX_FILES) return false;
    if (pathsCrossed >= ASK_TOOL_SEARCH_MAX_WALK) return false;
    pathsCrossed++;
    /*
     * THE GLOB DECIDES BEFORE THE BUDGET IS SPENT. This increment used to sit
     * above the glob test, so a file the glob EXCLUDED still consumed one of
     * the 200 - and the walk therefore stopped in the same place however narrow
     * the glob was. Measured through GET /api/search on this monorepo: a glob
     * naming the single file that contains `isOriginAllowed` answered "no
     * matches (stopped after 200 files ... narrow with a glob)". The remedy the
     * message offers was inert, which is worse than offering none: the reader
     * does what they were told, gets the identical answer, and concludes the
     * symbol is not in their repository.
     */
    if (globRe && !globRe.test(rel)) return true;
    /*
     * A SCREENSHOT IS NOT A SEARCH RESULT, and it used to cost the same as a
     * source file. Only a CONTENT search filters by extension: a glob-only
     * listing reads no bodies, so it stays able to answer "what PNGs are here".
     */
    if (queryLower && !isSearchableTextFile(rel)) return true;
    filesExamined++;
    // Jail-check the path before reading. Reserved / escaped paths ⇒ skip.
    const abs = ctx.resolveReadable(rel);
    if (!abs) return true;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return true;
    }
    if (!stat.isFile() || stat.size > ASK_TOOL_SEARCH_MAX_FILE_BYTES) return true;
    // glob-only matches: emit the path without reading the body.
    if (!queryLower) {
      if (matches.length >= maxResults) {
        resultsTruncated = true;
        return false;
      }
      matches.push(rel);
      return true;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      return true;
    }
    if (raw.includes('\0')) return true; // binary
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(queryLower)) {
        if (matches.length >= maxResults) {
          resultsTruncated = true;
          return false;
        }
        const snippet = line.slice(0, ASK_TOOL_SEARCH_SNIPPET_CHARS);
        const entry = `${rel}:${i + 1}: ${snippet}`;
        if (totalBytes + entry.length > ASK_TOOL_SEARCH_TOTAL_CAP_BYTES) return false;
        totalBytes += entry.length;
        matches.push(entry);
      }
    }
    return true;
  });

  /*
   * WHAT THE SEARCH DID NOT LOOK AT.
   *
   * MEASURED: `ASK_TOOL_SEARCH_MAX_FILES` is 200 and this repository has over
   * 950 tracked files, so the walk stops long before the end. Searching for
   * `deriveImportEdges`, which exists, answered "no matches".
   *
   * It did not fail to find it. It STOPPED LOOKING and said nothing, which is
   * the precise failure this product exists to catch in other tools: an answer
   * silent about its own coverage. The agent has been receiving that answer
   * too, and reading it as "this symbol is not in the repository".
   *
   * The cap stays: an uncapped grep floods the prompt, which is what it is
   * for. What changes is that the truncation is SAID.
   */
  const examinedCut = filesExamined >= ASK_TOOL_SEARCH_MAX_FILES;
  const walkCut = !examinedCut && pathsCrossed >= ASK_TOOL_SEARCH_MAX_WALK;
  const cut = resultsTruncated
    ? ` (stopped after ${maxResults} matches - there may be more; narrow the query or use a glob)`
    : examinedCut
      ? ` (stopped after ${ASK_TOOL_SEARCH_MAX_FILES} files - there may be more; narrow with a glob)`
      : walkCut
        ? /*
           * A DIFFERENT CUT NEEDS DIFFERENT ADVICE. Hitting the walk bound means
           * the tree is bigger than this search crosses, and a narrower glob does
           * NOT reach further - it only spends the same crossings on fewer reads.
           * Repeating "narrow with a glob" here would be the inert advice again,
           * one layer down.
           */
          ` (stopped after crossing ${ASK_TOOL_SEARCH_MAX_WALK} paths - there may be more, and a narrower glob will not reach further)`
        : '';

  if (matches.length === 0) {
    /* "No matches" alone is a claim about the REPOSITORY. With the cut named
       it is a claim about the search, which is all it ever was. */
    return { ok: true, evidence: `search "${query ?? glob}" — no matches${cut}`, content: '' };
  }
  const header = `### search results for "${query ?? glob}" (${matches.length})${cut}`;
  const body = matches.map((m) => neutralizeUntrusted(m)).join('\n');
  const content = wrapUntrustedLines([header, '```', body, '```']).join('\n');
  return {
    ok: true,
    evidence: `search "${query ?? glob}" — ${matches.length} match${matches.length === 1 ? '' : 'es'}${cut}`,
    content,
  };
}

/* ============================================================== edit_file ===== */

/**
 * `edit_file` — change part of a file by naming the text to replace.
 *
 * ── WHY THIS TOOL EXISTS ───────────────────────────────────────────────────
 *
 * Until it did, the ONLY way to change a file was `propose_files`, whose schema
 * is `{ path, content }` — the whole new file body. To change one line in a
 * 1,800-line file the model had to re-emit all 1,800 lines, which is expensive
 * (output tokens cost several times input on every rate table this repo carries,
 * `llm/costEstimate.ts`) and, worse, WRONG: `read_file` capped what it could see
 * at {@link ASK_TOOL_READ_CAP_BYTES}, so a whole-file rewrite of a large file
 * was a reconstruction of the part it had read, silently dropping the rest.
 *
 * The contract is pi's and Claude Code's, and it is exact-match-or-refuse:
 * `oldString` must appear EXACTLY ONCE unless `replaceAll` is set. A fuzzy
 * match here would be a tool that quietly edits the wrong line, which is the
 * one failure mode a review pane cannot catch — the diff would look right.
 *
 * ONE TOLERANCE, and it is deterministic: {@link executeReadFile} numbers the
 * lines it returns, so a model that copies its own tool output back into
 * `oldString` brings the numbers with it. Stripping a leading `<digits>|` from
 * every line of `oldString` and retrying is a reversal of a transformation THIS
 * MODULE applied, not a guess about what the model meant.
 *
 * Nothing is written. The result carries the same {@link AskToolProposal} shape
 * `propose_files` produces, so the Review pane, the permission rules, the
 * auto-write path and the SSE event are all the existing ones.
 */
export const ASK_TOOL_EDIT_MAX_EDITS = 20;

/** Strip the `   12| ` gutter `read_file` emits, so a copied snippet still matches. */
export function stripReadFileGutter(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\|/, ''))
    .join('\n');
}

interface AskEditRequest {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

function parseEditRequests(args: Record<string, unknown>): AskEditRequest[] | string {
  /* Weak local models emit both spellings, and a refusal over an underscore is a
     wasted round the user pays for. Both are read; neither is guessed at. */
  const raw = Array.isArray(args.edits)
    ? args.edits
    : [
        {
          oldString: args.oldString ?? args.old_string,
          newString: args.newString ?? args.new_string,
          replaceAll: args.replaceAll ?? args.replace_all,
        },
      ];
  if (raw.length === 0) return 'edit_file needs a non-empty "edits" array';
  if (raw.length > ASK_TOOL_EDIT_MAX_EDITS) {
    return `edit_file exceeds ${ASK_TOOL_EDIT_MAX_EDITS} edits`;
  }
  const out: AskEditRequest[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return 'edit_file entry is not an object';
    const e = entry as Record<string, unknown>;
    const oldString = typeof (e.oldString ?? e.old_string) === 'string'
      ? String(e.oldString ?? e.old_string)
      : undefined;
    const newString = typeof (e.newString ?? e.new_string) === 'string'
      ? String(e.newString ?? e.new_string)
      : undefined;
    if (oldString === undefined) return 'edit_file entry missing "oldString"';
    if (oldString === '') return 'edit_file "oldString" is empty — name the exact text to replace';
    if (newString === undefined) return 'edit_file entry missing "newString"';
    out.push({
      oldString,
      newString,
      replaceAll: (e.replaceAll ?? e.replace_all) === true,
    });
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function executeEditFile(
  args: Record<string, unknown>,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): AskToolResult {
  const rel = asString(args.path);
  if (!rel) return { ok: false, evidence: 'refused: edit_file missing "path"' };
  const normalized = rel.replace(/\\/g, '/');
  if (isGitInternalPath(normalized)) {
    return { ok: false, evidence: `refused: edit_file "${normalized}" targets a reserved git-internal path` };
  }
  const parsed = parseEditRequests(args);
  if (typeof parsed === 'string') return { ok: false, evidence: `refused: ${parsed}` };

  const abs = ctx.resolveReadable(rel);
  if (!abs) {
    return { ok: false, evidence: `refused: "${normalized}" not writable (jail or reserved)` };
  }
  onFile?.({ type: 'file:read', path: normalized });
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    onFile?.({ type: 'file:done', path: normalized });
    return {
      ok: false,
      evidence: `refused: "${normalized}" not found or unreadable — edit_file changes an EXISTING file; use propose_files to create one`,
    };
  }
  onFile?.({ type: 'file:done', path: normalized });

  let applied = 0;
  for (let i = 0; i < parsed.length; i++) {
    const edit = parsed[i];
    let needle = edit.oldString;
    let hits = countOccurrences(content, needle);
    if (hits === 0) {
      const degutted = stripReadFileGutter(needle);
      if (degutted !== needle && countOccurrences(content, degutted) > 0) {
        needle = degutted;
        hits = countOccurrences(content, needle);
      }
    }
    if (hits === 0) {
      /* HONEST, AND ACTIONABLE. The model gets one corrective round out of this
         sentence: it says which edit failed and that the text was not there. */
      return {
        ok: false,
        evidence:
          `refused: edit ${i + 1} of ${parsed.length} — "oldString" does not appear in ` +
          `${normalized}. Read the file (read_file, with offset/limit for a large one) and ` +
          `copy the exact text, whitespace included.`,
      };
    }
    if (hits > 1 && !edit.replaceAll) {
      return {
        ok: false,
        evidence:
          `refused: edit ${i + 1} of ${parsed.length} — "oldString" appears ${hits} times in ` +
          `${normalized}. Include more surrounding lines so it is unique, or set replaceAll.`,
      };
    }
    content = edit.replaceAll
      ? content.split(needle).join(edit.newString)
      : content.replace(needle, () => edit.newString);
    applied += hits;
  }

  if (content.length > ASK_TOOL_PROPOSE_MAX_FILE_BYTES) {
    return {
      ok: false,
      evidence: `refused: edit_file "${normalized}" result exceeds ${ASK_TOOL_PROPOSE_MAX_FILE_BYTES} bytes`,
    };
  }

  const title = asString(args.title);
  const rationale = asString(args.rationale);
  const header = `### edited ${normalized} (NOT written — staged for user review)`;
  const summary = JSON.stringify({
    path: normalized,
    edits: parsed.length,
    replacements: applied,
    bytes: content.length,
  });
  return {
    ok: true,
    evidence: `edited ${normalized} — ${applied} replacement${applied === 1 ? '' : 's'}`,
    content: wrapUntrustedLines([header, '```json', neutralizeUntrusted(summary), '```']).join('\n'),
    proposal: {
      ...(title ? { title } : {}),
      ...(rationale ? { rationale } : {}),
      files: [{ path: normalized, content }],
    },
  };
}

/* =========================================================== read_topology ===== */

/**
 * `read_topology` — expand ONE service of the structure digest back to detail.
 *
 * The ask prompt now ships an orientation INDEX rather than the whole digest
 * (see `indexDigestForAsk` in `explain/explain.ts`): every service, its dir, its
 * languages, its module labels, the cross-component edges, and an honest count
 * of the files it did NOT list. This is the tool that gets those files back, one
 * service at a time, so the common question pays for the map and only a question
 * that needs a package pays for that package.
 *
 * It reads the digest the pipeline already built. It never re-scans, never walks
 * the disk, and never invents a service: an unknown name is refused WITH the
 * list of real ones, so a weak model can recover inside the same turn instead of
 * guessing again.
 */
export const ASK_TOOL_TOPOLOGY_OUTPUT_CAP = 12_000;

function digestServiceKeys(svc: {
  id: string;
  name: string;
  dir?: string;
}): string[] {
  const keys = [svc.id, svc.name];
  const tail = svc.id.includes(':') ? svc.id.slice(svc.id.indexOf(':') + 1) : svc.id;
  keys.push(tail);
  if (svc.dir) {
    const dir = svc.dir.replace(/\\/g, '/');
    keys.push(dir);
    const seg = dir.split('/').filter(Boolean).pop();
    if (seg) keys.push(seg);
  }
  return keys.map((k) => k.toLowerCase());
}

function executeReadTopology(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  const digest = ctx.digest;
  if (!digest) {
    return { ok: false, evidence: 'refused: read_topology has no scanned structure digest for this turn' };
  }
  const names = digest.services.map((s) => s.id).join(', ');
  const wanted = asString(args.service);
  if (!wanted) {
    const overview = digest.services.map((s) => ({
      id: s.id,
      name: s.name,
      dir: s.dir,
      files: s.files.length + (s.truncatedFiles ?? 0),
      modules: s.modules.length,
    }));
    const body = JSON.stringify({ services: overview, datastores: digest.datastores, topics: digest.topics });
    return {
      ok: true,
      evidence: `read_topology — ${overview.length} services`,
      content: wrapUntrustedLines([
        '### topology index (call read_topology with a `service` id for one service\'s files)',
        '```json',
        neutralizeUntrusted(body),
        '```',
      ]).join('\n'),
    };
  }
  const key = wanted.replace(/\\/g, '/').toLowerCase();
  const svc = digest.services.find((s) => digestServiceKeys(s).includes(key));
  if (!svc) {
    return {
      ok: false,
      evidence: `refused: read_topology unknown service "${wanted}" — real service ids are: ${names}`,
    };
  }
  const edges = digest.edges.filter(
    (e) =>
      e.from === svc.id ||
      e.to === svc.id ||
      svc.files.some((f) => f.id === e.from || f.id === e.to) ||
      svc.modules.some((m) => m.fileIds.includes(e.from) || m.fileIds.includes(e.to)),
  );
  const payload = {
    id: svc.id,
    name: svc.name,
    dir: svc.dir,
    framework: svc.framework,
    languages: svc.languages,
    modules: svc.modules,
    files: svc.files,
    truncatedFiles: svc.truncatedFiles,
    edges,
  };
  let body = JSON.stringify(payload);
  let cut = '';
  if (body.length > ASK_TOOL_TOPOLOGY_OUTPUT_CAP) {
    /* Cut the FILE LIST, which is the long part, and say by how much — never
       silently return a shorter object that reads as the whole service. */
    const keep = Math.max(0, svc.files.length - 1);
    let files = svc.files.slice(0, keep);
    while (files.length > 0 && JSON.stringify({ ...payload, files }).length > ASK_TOOL_TOPOLOGY_OUTPUT_CAP) {
      files = files.slice(0, Math.floor(files.length * 0.8));
    }
    const dropped = svc.files.length - files.length;
    body = JSON.stringify({ ...payload, files });
    cut = ` (${dropped} more file paths omitted — narrow with search_files)`;
  }
  return {
    ok: true,
    evidence: `read_topology ${svc.id} — ${svc.files.length} files, ${edges.length} edges${cut}`,
    content: wrapUntrustedLines([
      `### topology for ${svc.id}${cut}`,
      '```json',
      neutralizeUntrusted(body),
      '```',
    ]).join('\n'),
  };
}

/* ========================================================== locate_symbol ===== */

/**
 * Dispatch for `locate_symbol`. The resolver itself lives in `locateSymbol.ts` and is a
 * pure function over a file set; this supplies the repo walk and the jail-checked reader,
 * which are the only things it needs from the server.
 */
function executeLocateSymbol(args: Record<string, unknown>, ctx: AskToolContext): AskToolResult {
  const name = asString(args.name);
  if (!name) return { ok: false, evidence: 'refused: locate_symbol missing "name"' };
  if (!isIdentifier(name)) {
    /* Refusing early is the honest move: a regex built out of arbitrary prose matches
       nothing, and an empty result reads as "this symbol does not exist". */
    return {
      ok: false,
      evidence:
        `refused: locate_symbol takes one identifier, not ${JSON.stringify(name)}. ` +
        'Use search_files for a phrase.',
    };
  }
  if (!ctx.repoRoot) {
    return { ok: false, evidence: 'refused: locate_symbol has no attached repo' };
  }

  let examined = 0;
  const eachFile = (visit: (rel: string) => boolean): void => {
    walkFiles(ctx.repoRoot!, (rel) => {
      if (examined >= ASK_TOOL_SEARCH_MAX_FILES) return false;
      if (!isSearchableTextFile(rel)) return true;
      examined += 1;
      return visit(rel);
    });
  };

  const skippedForSize: string[] = [];
  const outcome = locateDeclarations(
    name,
    eachFile,
    makeFileReader(ctx.resolveReadable, ASK_TOOL_SEARCH_MAX_FILE_BYTES, (rel) => {
      skippedForSize.push(rel);
    }),
    skippedForSize,
  );
  const evidence = renderLocateEvidence(name, outcome);
  /* A miss is `ok: false` so the loop treats it as an unproductive round and the model is
     told to try something else, rather than being handed an empty success. */
  if (outcome.hits.length === 0) return { ok: false, evidence };

  /*
   * THE BOARD'S HALF OF THE ANSWER — `lookup:located`, docs/teach-mode.md.
   *
   * Measured on `teach/symbol-index`: this tool answered 4 of 4 in the chat
   * rail and the map did not move. The engineer was told where the symbol was
   * and the picture of their repository sat there unchanged, which is the exact
   * gap in Max's second sentence — hand Sequence a repository and SEE it.
   *
   * Resolved through `resolveGraphTargets`, the same resolver `who_calls` uses,
   * because it NEVER INVENTS: an id comes back only when a node of the scanned
   * graph really carries that path. A file the graph has no node for
   * contributes nothing rather than a fabricated id, and if that leaves the
   * list empty the field is omitted entirely — the board is never handed an
   * empty spotlight, and `undefined` says "nothing to point at" in a way `[]`
   * does not.
   *
   * De-duplicated because two declarations in one file are two hits and one
   * node, and a repeated id would make the client's `sameDim` miss a no-op.
   */
  const graph = ctx.graph;
  if (!graph) return { ok: true, evidence };
  const located: string[] = [];
  for (const hit of outcome.hits) {
    for (const id of resolveGraphTargets(graph, hit.file)) {
      if (!located.includes(id)) located.push(id);
    }
  }
  return located.length > 0 ? { ok: true, evidence, located } : { ok: true, evidence };
}

/* ============================================================== who_calls ===== */

/**
 * `who_calls` — the grounded dependency answer, on the agent's own belt.
 *
 * Sequence exports twelve grounded graph tools to OTHER agents over MCP
 * (`packages/mcp/src/index.ts`) and gave its own model none of them. Asked "what
 * breaks if I change this", the in-app agent grepped — over a substring walk, on
 * the product whose entire claim is that it built the dependency graph already.
 *
 * This walks the SAME `ArchGraph` the digest was built from: real edges, real
 * ids, no invention. Both directions in one call, because "who calls this" and
 * "what does this depend on" are the same question asked from two ends and a
 * weak model should not have to know which tool to reach for. The transitive
 * upstream closure is the blast radius — the number the risk answer needs.
 */
export const ASK_TOOL_WHO_CALLS_MAX_ROWS = 40;
export const ASK_TOOL_WHO_CALLS_MAX_DEPTH = 6;

/** Resolve a user/model-supplied target to real graph node ids. Never invents. */
export function resolveGraphTargets(
  graph: Pick<ArchGraph, 'nodes'>,
  target: string,
): string[] {
  const t = target.replace(/\\/g, '/').toLowerCase();
  const exact: string[] = [];
  const suffix: string[] = [];
  const label: string[] = [];
  for (const n of graph.nodes) {
    const p = (n.path ?? '').replace(/\\/g, '/').toLowerCase();
    if (n.id.toLowerCase() === t || p === t) {
      exact.push(n.id);
      continue;
    }
    if (p && (p.endsWith(`/${t}`) || t.endsWith(`/${p}`))) {
      suffix.push(n.id);
      continue;
    }
    if (n.label.toLowerCase() === t) label.push(n.id);
  }
  if (exact.length > 0) return exact;
  if (suffix.length > 0) return suffix;
  return label;
}

function executeWhoCalls(args: Record<string, unknown>, ctx: AskToolContext): AskToolResult {
  const graph = ctx.graph;
  if (!graph) {
    return { ok: false, evidence: 'refused: who_calls has no scanned graph for this turn' };
  }
  const target = asString(args.target);
  if (!target) return { ok: false, evidence: 'refused: who_calls missing "target"' };
  const seeds = resolveGraphTargets(graph, target);
  if (seeds.length === 0) {
    return {
      ok: false,
      evidence:
        `refused: who_calls found no node matching "${target}" in the scanned graph. ` +
        `Pass a repo-relative file path, a graph node id, or a service name (read_topology lists them).`,
    };
  }
  const seedSet = new Set(seeds);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nameOf = (id: string): string => {
    const n = byId.get(id);
    if (!n) return id;
    return (n.path ?? n.label ?? id).replace(/\\/g, '/');
  };

  const callers: string[] = [];
  const callees: string[] = [];
  /*
   * THE CALLER NAMES, kept separately from the rendered rows above.
   *
   * `callers` holds display rows ("a.ts --import--> b.ts") because that is what
   * reads well in a tool result. The fourth carry slot needs the NAMES — a
   * follow-up asking "of those, which one first" is asking about files, and
   * handing the next turn a list of arrows would make it rank edges. Built here
   * from the same edges in the same pass, so the two can never describe
   * different sets.
   */
  const callerNames: string[] = [];
  const incomingBySrc = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (seedSet.has(e.dstId) && !seedSet.has(e.srcId)) {
      callers.push(`${nameOf(e.srcId)} --${e.kind}--> ${nameOf(e.dstId)}`);
      const name = nameOf(e.srcId);
      if (!callerNames.includes(name)) callerNames.push(name);
    }
    if (seedSet.has(e.srcId) && !seedSet.has(e.dstId)) {
      callees.push(`${nameOf(e.srcId)} --${e.kind}--> ${nameOf(e.dstId)}`);
    }
    const list = incomingBySrc.get(e.dstId);
    if (list) list.push(e.srcId);
    else incomingBySrc.set(e.dstId, [e.srcId]);
  }

  /* BLAST RADIUS — everything that reaches the target transitively. Bounded by
     depth AND by a visited set, so a cyclic graph terminates. */
  const reached = new Set<string>(seeds);
  let frontier = [...seeds];
  let depth = 0;
  while (frontier.length > 0 && depth < ASK_TOOL_WHO_CALLS_MAX_DEPTH) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const src of incomingBySrc.get(id) ?? []) {
        if (reached.has(src)) continue;
        reached.add(src);
        next.push(src);
      }
    }
    frontier = next;
    depth += 1;
  }
  const blastRadius = reached.size - seeds.length;

  const cutList = (rows: string[]): { rows: string[]; cut: string } =>
    rows.length > ASK_TOOL_WHO_CALLS_MAX_ROWS
      ? {
          rows: rows.slice(0, ASK_TOOL_WHO_CALLS_MAX_ROWS),
          cut: ` (…${rows.length - ASK_TOOL_WHO_CALLS_MAX_ROWS} more)`,
        }
      : { rows, cut: '' };
  const inCut = cutList(callers);
  const outCut = cutList(callees);
  const lines = [
    `### who_calls "${target}" — matched ${seeds.length} node${seeds.length === 1 ? '' : 's'}: ${seeds.join(', ')}`,
    '```',
    `INCOMING (${callers.length})${inCut.cut}:`,
    ...(inCut.rows.length > 0 ? inCut.rows : ['(none)']),
    `OUTGOING (${callees.length})${outCut.cut}:`,
    ...(outCut.rows.length > 0 ? outCut.rows : ['(none)']),
    `BLAST RADIUS: ${blastRadius} node${blastRadius === 1 ? '' : 's'} reach this transitively ` +
      `(depth ≤ ${ASK_TOOL_WHO_CALLS_MAX_DEPTH}).`,
    '```',
  ];
  return {
    ok: true,
    evidence: `who_calls ${target} — ${callers.length} in, ${callees.length} out, blast radius ${blastRadius}`,
    content: wrapUntrustedLines(lines.map((l) => neutralizeUntrusted(l))).join('\n'),
    /*
     * THE ANSWER'S REFERENTS — what the NEXT question will be about.
     *
     * A seat read on 2026-09-06 asked "which files depend on scan.ts", got this
     * list, then asked "of those, which one would I have to change first?" —
     * and the follow-up turn had never been handed the list. It ranked nothing
     * and pointed back at the file the engineer already knew about.
     *
     * These are the node ids the answer was built from, straight off the
     * scanned edges. Not scraped back out of `content`: a referent parsed from
     * prose is a guess about what the tool said, and the first law does not
     * stop at the answer.
     */
    referents: {
      tool: 'who_calls',
      subject: target,
      items: callerNames,
      /* The DISTINCT callers, which is what the names are. Two edges from one
         file are one file to change, and a total that counted them twice would
         tell the next turn to rank a number that does not exist. */
      total: callerNames.length,
    },
  };
}

/* ============================================================ propose_files ===== */

/**
 * `propose_files` — accept a multi-file edit proposal WITHOUT writing it.
 *
 * Args: `{ title?: string, files: [{ path, content }] }`. Every path is
 * jail-checked through `ctx.resolveReadable` (the SAME choke point as
 * GET /api/file): an escaping, reserved (`.git/`), or symlink-escaping path
 * is refused and the whole proposal is dropped — never partially accepted.
 * `.git/` internals are always refused (a proposal must never touch repo
 * plumbing). Nothing is written to disk; the proposal is attached to the
 * result so the ask pipeline can emit an `edit:proposal` SSE event.
 */
/* ────────────────────────────────────────────────────────────────────────
   propose_topology — the agent proposes a change to the ARCHITECTURE
   ──────────────────────────────────────────────────────────────────────── */

/** A proposal is a sketch, not a system. Past this it is a redesign nobody asked for. */
/**
 * Node budget for a draw ask that never named a scope.
 *
 * Unscoped draws land a SMALL diagram on the first round and the answer offers the
 * detailed version; a model that ignores the budget is told to send a compact one.
 * That keeps the owner 'no 15-node dump' ruling without making the board unreachable.
 */
export const ASK_TOOL_COMPACT_TOPOLOGY_MAX_NODES = 8;

export const ASK_TOOL_TOPOLOGY_MAX_NODES = 24;
export const ASK_TOOL_TOPOLOGY_MAX_EDGES = 48;

/**
 * Validate and normalise a proposed topology.
 *
 * ── IT STRIPS EVIDENCE, AND THAT IS THE WHOLE SAFETY PROPERTY ───────────
 *
 * `SeqDiagramNode` carries an optional `evidenceRef` — "grounded evidence
 * pointer, e.g. `scan:src/handler.ts:41`" — and the board's Generate gate keys
 * off its ABSENCE to decide a node is unproven. A model that supplied one
 * would make a node it invented indistinguishable from a node the scanner
 * found, in a product whose first non-negotiable is that every claim traces to
 * real evidence. So the field is not merely optional here: it is REFUSED, and
 * the proposal is rejected rather than quietly cleaned, because a model that
 * tried to attach evidence to something it made up has told us something about
 * the answer we are otherwise about to draw.
 *
 * The kinds and families are checked against the schema's own lists rather
 * than a copy, so a node kind that does not exist cannot reach the reducer.
 */
/**
 * WHAT TO TRY INSTEAD, when an edge endpoint names nothing.
 *
 * The dangling-endpoint guard is right, and the code beside it already states
 * its purpose: "Refusal reaches the MODEL while it can still repair the call."
 * It handed back nothing to repair WITH. Measured on the owner's run:
 *
 *   refused: propose_topology edge "e2" endpoint "svc:api" is not present
 *            in the proposal or attached graph
 *
 * The model invented `svc:api`, was told no, and had no way to learn what a real
 * id looks like - so half of a proposal was discarded before it could reach the
 * board. A guard that refuses without teaching is a loop, not a gate.
 *
 * Ranked, not dumped: ids sharing the rejected id's kind prefix come first
 * (`svc:api` far more likely meant another `svc:`), then by how much of the name
 * they share. Bounded to a handful, because a refusal that pastes two hundred
 * ids into the transcript is its own flood - the thing every other cap in this
 * file exists to prevent.
 *
 * PURE.
 */
export function nearestNodeIds(missing: string, known: Iterable<string>, limit = 4): string[] {
  const all = [...known];
  if (all.length === 0) return [];
  const prefixOf = (id: string) => (id.includes(':') ? id.slice(0, id.indexOf(':')) : '');
  const wanted = prefixOf(missing);
  const tail = missing.slice(missing.indexOf(':') + 1).toLowerCase();

  const shared = (id: string): number => {
    const other = id.slice(id.indexOf(':') + 1).toLowerCase();
    let i = 0;
    while (i < tail.length && i < other.length && tail[i] === other[i]) i += 1;
    return i;
  };

  return all
    .map((id) => ({ id, kind: prefixOf(id) === wanted ? 1 : 0, shared: shared(id) }))
    .sort((a, b) => b.kind - a.kind || b.shared - a.shared || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}

function parseNodeDetail(raw: unknown): SeqDiagramNodeDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const whatItDoes = asString(d.whatItDoes);
  const whatItIs = asString(d.whatItIs);
  const parts = Array.isArray(d.parts)
    ? d.parts.map((p) => asString(p)).filter((p): p is string => Boolean(p))
    : undefined;
  const talksTo = Array.isArray(d.talksTo)
    ? d.talksTo.map((p) => asString(p)).filter((p): p is string => Boolean(p))
    : undefined;
  if (!whatItDoes && !whatItIs && !parts?.length && !talksTo?.length) return undefined;
  return {
    ...(whatItIs ? { whatItIs } : {}),
    ...(whatItDoes ? { whatItDoes } : {}),
    ...(parts?.length ? { parts } : {}),
    ...(talksTo?.length ? { talksTo } : {}),
  };
}

function executeProposeTopology(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  /*
   * COMPACT BY DEFAULT, NOT REFUSED. This used to hard-refuse every drawish ask
   * that had not said "compact" or "detailed", so the most natural request in the
   * product ("draw me an architecture of X on the board") produced an empty board
   * and burned both of DESIGN_DRAW_ASK_TOOL_ROUNDS on refusals. The owner report it
   * answered was a 15-node dump; the budget below fixes that without the dead end.
   */
  const unscopedDraw = needsTopologyScopeClarification(ctx.question);

  const title = asString(args.title);
  const rationale = asString(args.rationale);

  const nodesRaw = args.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) {
    return { ok: false, evidence: 'refused: propose_topology needs a non-empty "nodes" array' };
  }
  if (nodesRaw.length > ASK_TOOL_TOPOLOGY_MAX_NODES) {
    return {
      ok: false,
      evidence: `refused: propose_topology exceeds ${ASK_TOOL_TOPOLOGY_MAX_NODES} nodes`,
    };
  }
  if (unscopedDraw && nodesRaw.length > ASK_TOOL_COMPACT_TOPOLOGY_MAX_NODES) {
    return {
      ok: false,
      evidence:
        `refused: this draw did not name a scope, so it gets a COMPACT overview — ` +
        `send at most ${ASK_TOOL_COMPACT_TOPOLOGY_MAX_NODES} nodes covering the main flows, ` +
        `then tell the user they can ask for the detailed diagram.`,
    };
  }

  const nodes: { id: string; label: string; kind: string; detail?: SeqDiagramNodeDetail }[] = [];
  const ids = new Set<string>();
  for (const entry of nodesRaw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, evidence: 'refused: propose_topology node is not an object' };
    }
    const n = entry as Record<string, unknown>;
    const id = asString(n.id);
    const label = asString(n.label);
    const kind = asString(n.kind);
    if (!id) return { ok: false, evidence: 'refused: propose_topology node missing "id"' };
    if (!label) return { ok: false, evidence: `refused: propose_topology node "${id}" missing "label"` };
    if (!kind || !SEQ_DIAGRAM_NODE_KINDS.includes(kind as never)) {
      return {
        ok: false,
        evidence: `refused: propose_topology node "${id}" has kind "${kind ?? ''}" — expected one of ${SEQ_DIAGRAM_NODE_KINDS.join(', ')}`,
      };
    }
    if (ids.has(id)) {
      return { ok: false, evidence: `refused: propose_topology repeats node id "${id}"` };
    }
    if (n.evidenceRef !== undefined) {
      /* THE ONE REFUSAL THAT IS NOT ABOUT SHAPE. See the docblock: a proposed
         node wearing a scan citation is the exact fabrication this product
         exists to detect, arriving from the product itself. */
      return {
        ok: false,
        evidence: `refused: propose_topology node "${id}" carries evidenceRef — a proposed node has no evidence, that is what makes it a proposal`,
      };
    }
    ids.add(id);
    const detail = parseNodeDetail(n.detail);
    nodes.push({ id, label, kind, ...(detail ? { detail } : {}) });
  }

  const edgesRaw = Array.isArray(args.edges) ? args.edges : [];
  if (edgesRaw.length > ASK_TOOL_TOPOLOGY_MAX_EDGES) {
    return {
      ok: false,
      evidence: `refused: propose_topology exceeds ${ASK_TOOL_TOPOLOGY_MAX_EDGES} edges`,
    };
  }
  const edges: { id: string; from: string; to: string; family: string; label?: string }[] = [];
  for (const entry of edgesRaw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, evidence: 'refused: propose_topology edge is not an object' };
    }
    const e = entry as Record<string, unknown>;
    const id = asString(e.id);
    const from = asString(e.from);
    const to = asString(e.to);
    const family = asString(e.family);
    const label = asString(e.label);
    if (!id || !from || !to) {
      return { ok: false, evidence: 'refused: propose_topology edge needs "id", "from" and "to"' };
    }
    if (!family || !SEQ_DIAGRAM_EDGE_FAMILIES.includes(family as never)) {
      return {
        ok: false,
        evidence: `refused: propose_topology edge "${id}" has family "${family ?? ''}" — expected one of ${SEQ_DIAGRAM_EDGE_FAMILIES.join(', ')}`,
      };
    }
    /*
     * AN EDGE MUST LAND ON A NODE THE PROPOSAL DECLARES OR THE REAL GRAPH
     * ALREADY HAS. The pipeline passes only the graph's id set — enough to
     * validate referential integrity without giving this mutating tool a second
     * graph representation. Refusal reaches the MODEL while it can still repair
     * the call, instead of disappearing after Accept.
     */
    const endpointExists = (nodeId: string) =>
      ids.has(nodeId) || ctx.topologyNodeIds?.has(nodeId) === true;
    const missingEndpoint = !endpointExists(from) ? from : !endpointExists(to) ? to : null;
    if (missingEndpoint) {
      const known = new Set<string>([...ids, ...(ctx.topologyNodeIds ?? [])]);
      const near = nearestNodeIds(missingEndpoint, known);
      const hint =
        near.length > 0
          ? ` — ids that exist: ${near.join(', ')}${known.size > near.length ? ` (${known.size} in all)` : ''}`
          : ' — the proposal declares no nodes and no graph is attached, so there is no id it could name';
      return {
        ok: false,
        evidence: `refused: propose_topology edge "${id}" endpoint "${missingEndpoint}" is not present in the proposal or attached graph${hint}`,
      };
    }
    edges.push({ id, from, to, family, ...(label ? { label } : {}) });
  }

  const drawn = `${nodes.length} node${nodes.length === 1 ? '' : 's'}, ${edges.length} edge${edges.length === 1 ? '' : 's'}`;
  let evidence = `proposed ${drawn}${title ? ` — ${title}` : ''}`;
  /* A5.1 — detailed asks should carry whatItDoes on most nodes; soft warn only. */
  if (isDetailedTopologyAsk(ctx.question)) {
    const coverage = topologyWhatItDoesCoverage(nodes);
    if (coverage < DETAILED_TOPOLOGY_WHAT_IT_DOES_MIN) {
      const pct = Math.round(coverage * 100);
      const need = Math.round(DETAILED_TOPOLOGY_WHAT_IT_DOES_MIN * 100);
      evidence +=
        ` — soft warn: detailed ask but only ${pct}% of nodes have detail.whatItDoes` +
        ` (want ≥${need}%); enrich descriptions on the next propose_topology`;
    }
  }
  return {
    ok: true,
    evidence,
    /* What goes back into the next provider round: the model must be able to
       see what it proposed without the client echoing it. */
    content: `Proposed topology (${drawn}): ${nodes.map((n) => `${n.kind} ${n.label}`).join(', ')}`,
    topology: {
      ...(title ? { title } : {}),
      ...(rationale ? { rationale } : {}),
      nodes,
      edges,
    },
  };
}

function executeProposeFiles(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  const title = asString(args.title);
  /* Optional: the model may have nothing worth saying beyond the title, and
     refusing the edit for want of prose would lose real work to a formatting
     rule. A non-string is dropped rather than rendered as junk. */
  const rationale = asString(args.rationale);
  const filesRaw = args.files;
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    return { ok: false, evidence: 'refused: propose_files needs a non-empty "files" array' };
  }
  if (filesRaw.length > ASK_TOOL_PROPOSE_MAX_FILES) {
    return {
      ok: false,
      evidence: `refused: propose_files exceeds ${ASK_TOOL_PROPOSE_MAX_FILES} files`,
    };
  }
  const accepted: { path: string; content: string }[] = [];
  let totalBytes = 0;
  for (const entry of filesRaw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, evidence: 'refused: propose_files entry is not an object' };
    }
    const e = entry as Record<string, unknown>;
    const rel = asString(e.path);
    const content = typeof e.content === 'string' ? e.content : undefined;
    if (!rel) {
      return { ok: false, evidence: 'refused: propose_files entry missing "path"' };
    }
    if (content === undefined) {
      return { ok: false, evidence: `refused: propose_files "${rel}" missing "content"` };
    }
    if (content.length > ASK_TOOL_PROPOSE_MAX_FILE_BYTES) {
      return {
        ok: false,
        evidence: `refused: propose_files "${rel}" exceeds ${ASK_TOOL_PROPOSE_MAX_FILE_BYTES} bytes`,
      };
    }
    totalBytes += content.length;
    if (totalBytes > ASK_TOOL_PROPOSE_TOTAL_CAP_BYTES) {
      return {
        ok: false,
        evidence: `refused: propose_files total exceeds ${ASK_TOOL_PROPOSE_TOTAL_CAP_BYTES} bytes`,
      };
    }
    const normalized = rel.replace(/\\/g, '/');
    if (isGitInternalPath(normalized)) {
      return { ok: false, evidence: `refused: propose_files "${normalized}" targets a reserved git-internal path` };
    }
    // Jail-check the path through the SAME choke point as GET /api/file. A
    // proposal for a not-yet-existing file is fine — resolveReadable walks up
    // to the deepest existing ancestor and proves containment — but an
    // escaping or symlink-escaping path is refused.
    const abs = ctx.resolveReadable(rel);
    if (!abs) {
      return { ok: false, evidence: `refused: propose_files "${normalized}" not writable (jail or reserved)` };
    }
    accepted.push({ path: normalized, content });
  }

  const summary = {
    ...(title ? { title } : {}),
    ...(rationale ? { rationale } : {}),
    files: accepted.map((f) => ({ path: f.path, bytes: f.content.length })),
  };
  const header = `### proposed files (NOT written — staged for user review)`;
  const body = JSON.stringify(summary);
  const content = wrapUntrustedLines([header, '```json', neutralizeUntrusted(body), '```']).join('\n');
  return {
    ok: true,
    evidence: `proposed ${accepted.length} file${accepted.length === 1 ? '' : 's'}`,
    content,
    proposal: { ...(title ? { title } : {}), ...(rationale ? { rationale } : {}), files: accepted },
  };
}

/* ============================================================ run_command ===== */

/**
 * `run_command` — run an allowlisted relative command under `repoRoot`.
 *
 * Reuses the verifyGate allowlist + safe-char check (no `..`, no shell
 * metacharacters). Spawned via `spawnSync` with `shell: false` and a fixed
 * argv — there is NO ambient shell anywhere here. stdout/stderr are capped
 * and fed back to the model; a non-zero exit is an honest `ok: false` with
 * the trimmed output, never a fabricated success.
 */
/**
 * `propose_chart` — the model names a chart KIND and fills its data contract;
 * Sequence draws the pixels (packages/schema/src/chart.ts explains why).
 *
 * The validator is the point: any `nodeId` an item claims must be a real node
 * in the scanned graph, so a picture cannot assert structure the repository
 * does not have. A chart about an idea (softmax, a doctrine) carries no
 * nodeIds and passes; a chart that claims THIS system is checked against it.
 */
function executeProposeChart(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  const raw = (args.chart ?? args) as unknown;
  const known = ctx.graph ? new Set(ctx.graph.nodes.map((n) => n.id)) : undefined;
  /*
   * NO GRAPH ⇒ NO GROUNDING ⇒ NO nodeId. Without a scanned graph (design mode),
   * validateChart cannot check a nodeId, so the grounding guard silently
   * passed and a fabricated `nodeId` could ride onto the canvas doc under the
   * "every nodeId real" promise. A nodeId is a claim about a repository that is
   * not attached, so it is refused here rather than accepted unverifiable.
   */
  if (known === undefined) {
    const claimed = (((raw as { items?: unknown }).items as { nodeId?: unknown }[] | undefined) ?? []).filter(
      (it) => it && typeof it === 'object' && typeof it.nodeId === 'string',
    );
    if (claimed.length > 0) {
      return {
        ok: false,
        evidence:
          'refused: propose_chart — no repository is attached, so item nodeIds cannot be grounded. ' +
          'Omit nodeId (a chart about an idea needs none), or attach a repo to chart its real structure.',
      };
    }
  }
  /*
   * A FILE STEM IS NOT A NODE ID, and the model reaches for one constantly.
   *
   * Measured across the teach bench: every refused propose_chart call cited a
   * nodeId, and the commonest shape was the file the concept lives in —
   * `"nn_bigram.py" is not a node in this repository`. The model is not
   * inventing there; it is naming a real file by the only name it has seen, and
   * the graph knows exactly which node that is.
   *
   * So a stem that resolves to EXACTLY ONE node is rewritten to that node's id.
   * That is a lookup, not a guess: the answer comes from the graph, and a stem
   * matching two nodes is REFUSED WITH BOTH CANDIDATES rather than resolved to
   * whichever sorted first — picking one would be the fabrication this validator
   * exists to prevent.
   *
   * A name matching nothing is left exactly as it was, so `softmax_output` and
   * `bigram_counts` — invented concept nodes with no file behind them — still
   * hit validateChart's refusal. Those are a different defect from this one, and
   * this fix must not paper over them.
   */
  const stems = resolveNodeIdStems(raw, ctx.graph ?? undefined);
  if (stems.ambiguous !== undefined) {
    return {
      ok: false,
      evidence:
        `refused: propose_chart — "${stems.ambiguous.stem}" matches ${stems.ambiguous.ids.length} ` +
        `nodes (${stems.ambiguous.ids.join(', ')}). Name the one you mean.`,
    };
  }
  /* The scanned edges, so an arrow between two REAL nodes has to be one the
     repository actually has. Built here rather than passed in because `known`
     is built the same way one line above, and the two must come from the same
     graph or the chart is checked against a mixture. */
  const knownEdges = new Set<string>(
    (ctx.graph?.edges ?? []).map((e) => `${e.srcId}>${e.dstId}`),
  );
  const result = validateChart(stems.raw, known, knownEdges);
  if (!result.ok) {
    const lines = result.problems.slice(0, 6).map((p) => `${p.path || '(root)'}: ${p.message}`);
    return {
      ok: false,
      evidence: `refused: propose_chart — ${lines.join('; ')}`,
    };
  }
  const chart = result.chart;
  return {
    ok: true,
    chart,
    evidence: `charted ${chart.kind} "${chart.title}" (${chart.items.length} items)`,
    content:
      `### propose_chart: drew a ${chart.kind} titled "${chart.title}" with ` +
      `${chart.items.length} item(s)${chart.links?.length ? ` and ${chart.links.length} link(s)` : ''}. ` +
      'The reader can see it; do not restate the whole picture in prose.',
  };
}

/**
 * Rewrite item nodeIds that are file stems into the node id the graph knows.
 *
 * Keys a name can arrive as, in the order the model actually produces them: the
 * node's own id (already fine), its repo-relative path, that path's basename
 * (`nn_bigram.py`), and the basename without its extension (`nn_bigram`). Node
 * labels are deliberately NOT keys — two services can share a label, and a
 * label collision resolved silently is exactly the fabrication the validator
 * refuses.
 *
 * Case-insensitive, because a stem typed from memory is not reliably cased.
 * Returns the original object untouched when nothing needs rewriting, so the
 * common path allocates nothing.
 */
function resolveNodeIdStems(
  raw: unknown,
  graph: { nodes: readonly { id: string; path?: string }[] } | undefined,
): { raw: unknown; ambiguous?: { stem: string; ids: string[] } } {
  if (graph === undefined || raw === null || typeof raw !== 'object') return { raw };
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return { raw };

  const ids = new Set(graph.nodes.map((n) => n.id));
  const byKey = new Map<string, Set<string>>();
  const add = (key: string | undefined, id: string): void => {
    if (key === undefined || key === '') return;
    const k = key.toLowerCase();
    if (ids.has(k) && k !== id.toLowerCase()) return; // never shadow a real id
    const set = byKey.get(k) ?? new Set<string>();
    set.add(id);
    byKey.set(k, set);
  };
  for (const n of graph.nodes) {
    if (n.path === undefined) continue;
    const p = n.path.replace(/\\/g, '/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    add(p, n.id);
    add(base, n.id);
    if (dot > 0) add(base.slice(0, dot), n.id);
  }

  let changed = false;
  let ambiguous: { stem: string; ids: string[] } | undefined;
  const next = items.map((it) => {
    if (it === null || typeof it !== 'object') return it;
    const nodeId = (it as { nodeId?: unknown }).nodeId;
    if (typeof nodeId !== 'string' || ids.has(nodeId)) return it;
    const hit = byKey.get(nodeId.toLowerCase());
    if (hit === undefined) return it; // unknown: let validateChart refuse it
    if (hit.size > 1) {
      ambiguous ??= { stem: nodeId, ids: [...hit].sort() };
      return it;
    }
    changed = true;
    return { ...(it as Record<string, unknown>), nodeId: [...hit][0] };
  });
  if (ambiguous !== undefined) return { raw, ambiguous };
  return changed ? { raw: { ...(raw as Record<string, unknown>), items: next } } : { raw };
}

/**
 * `propose_plan` — the lesson's concept list, written once at the opening turn.
 *
 * The third source of a concept queue, and the one the other two cannot cover:
 * measured across the twenty teach-bench conversations, 12 of 20 asks name no
 * node and are not sequence-shaped, so neither the ask nor the graph can order
 * them. An attached law primer is the clearest case — its concepts live in the
 * article and no amount of edge-walking will find them.
 *
 * Grounded on exactly the same terms as a chart: a concept MAY carry a nodeId,
 * and if it does the id must be real, with a file stem resolved the same way
 * `propose_chart` resolves it. A concept with no nodeId is fine and expected —
 * demanding one would make this useless for the case it exists to serve.
 *
 * Refused WHOLE when any id is invented. Half a plan is a queue the learner
 * cannot see, half of which points at nothing.
 */
function executeProposePlan(args: Record<string, unknown>, ctx: AskToolContext): AskToolResult {
  const known = ctx.graph ? new Set(ctx.graph.nodes.map((n) => n.id)) : undefined;
  const stems = resolveNodeIdStems(
    { items: (args.concepts ?? args.plan ?? args) as unknown },
    ctx.graph ?? undefined,
  );
  if (stems.ambiguous !== undefined) {
    return {
      ok: false,
      evidence:
        `refused: propose_plan — "${stems.ambiguous.stem}" matches ${stems.ambiguous.ids.length} ` +
        `nodes (${stems.ambiguous.ids.join(', ')}). Name the one you mean.`,
    };
  }
  const resolved = (stems.raw as { items?: unknown }).items;
  const result = validatePlan(resolved, known);
  if (!result.ok) {
    return { ok: false, evidence: `refused: propose_plan — ${result.reason ?? 'invalid plan'}` };
  }
  return {
    ok: true,
    plan: result.concepts,
    evidence: `planned ${result.concepts.length} concept(s): ${result.concepts.map((c) => c.title).join('; ')}`,
    content:
      `### propose_plan: the lesson is ${result.concepts.length} concept(s). Sequence will hand ` +
      'you ONE per turn — teach the first now and do not write the plan again.',
  };
}

/**
 * Run an arbitrary command through `bash -lc` inside the sandbox container.
 * Head+tail capped like the whitelist path; stdout+stderr merged; exit code
 * always reported (null only if the process never started or timed out).
 */
function runSandboxShell(cmd: string, cwd: string): { exitCode: number | null; output: string } {
  const r = spawnSync('bash', ['-lc', cmd], {
    cwd,
    encoding: 'utf8',
    timeout: ASK_TOOL_RUN_CMD_FULL_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  const raw = `${r.stdout ?? ''}${r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''}`;
  const cap = ASK_TOOL_RUN_CMD_OUTPUT_CAP;
  let output = raw;
  if (raw.length > cap) {
    const head = Math.floor(cap * 0.35);
    output =
      raw.slice(0, head) +
      `\n… ${raw.length - cap} chars omitted …\n` +
      raw.slice(raw.length - (cap - head));
  }
  if (r.error) {
    const timedOut = (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    return {
      exitCode: null,
      output: (output ? output + '\n' : '') + (timedOut ? `[timed out after ${ASK_TOOL_RUN_CMD_FULL_TIMEOUT_MS} ms]` : String(r.error.message)),
    };
  }
  return { exitCode: r.status, output };
}

function executeRunCommand(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  const cmd = asString(args.cmd);
  if (!cmd) return { ok: false, evidence: 'refused: run_command missing "cmd"' };
  /*
   * FULL WIDENS, EVERYTHING ELSE KEEPS THE EXACT LIST. Below full this tool is
   * refused before dispatch (belt + pipeline), so the widening flag is
   * belt-and-braces — but it is derived from the permission the pipeline
   * threaded in, never assumed. Full also gets the longer clock: a suite that
   * needs 90s is the normal case for the mode built around running suites.
   */
  const widen = ctx.permission === 'full';
  /*
   * ── THE TRUST BOUNDARY, STATED HERE TOO ────────────────────────────────
   *
   * `runAllowlistedRepoCommand` carries the gate for every ordinary run, but
   * the sandbox branch below never reaches it — it goes straight to a real
   * shell. A boundary with one branch around it is not a boundary, so the
   * question is asked before the fork rather than inside one arm of it.
   */
  const untrusted = repoExecutionRefusal(ctx.repoRoot ?? null);
  if (untrusted !== null) {
    return {
      ok: false,
      evidence: `refused: run_command — ${untrusted}`,
      commandLog: { cmd, exitCode: null, output: untrusted, ok: false },
    };
  }
  /*
   * The sandbox path: a runner that set sandboxExec owns the container, so the
   * whitelist would only amputate the repro-first workflow the top harnesses
   * win with. Real shell, real heredocs, real pipes — bounded only by timeout
   * and output cap, with the exit code always reported.
   */
  if (ctx.sandboxExec === true && ctx.permission === 'full' && ctx.repoRoot) {
    const ran = runSandboxShell(cmd, ctx.repoRoot);
    const header = `### run_command: ${cmd} (exit ${ran.exitCode ?? 'null'})`;
    const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(ran.output), '```']).join(
      '\n',
    );
    return {
      ok: ran.exitCode === 0,
      evidence: content,
      commandLog: { cmd, exitCode: ran.exitCode, output: ran.output, ok: ran.exitCode === 0 },
    };
  }
  const ran = runAllowlistedRepoCommand(cmd, ctx.repoRoot!, {
    timeoutMs: widen ? ASK_TOOL_RUN_CMD_FULL_TIMEOUT_MS : ASK_TOOL_RUN_CMD_TIMEOUT_MS,
    outputCap: ASK_TOOL_RUN_CMD_OUTPUT_CAP,
    widenToRunnerBins: widen,
  });
  if (ran.refuseReason) {
    return {
      ok: false,
      evidence: `refused: run_command ${ran.refuseReason}`,
      commandLog: {
        cmd,
        exitCode: ran.exitCode,
        output: ran.output || ran.refuseReason,
        ok: false,
      },
    };
  }
  /*
   * THE RESOLUTION IS PART OF THE RECEIPT. `pnpm test` told the reader nothing
   * about what ran; the repository's package.json decided that, and the whole
   * of the allowlist hole was that nobody could see it. When the command was
   * an indirection, the header says what it resolved to — on the green run as
   * well as the red one.
   */
  const header =
    `### run_command: ${cmd}` +
    (ran.resolved !== undefined && ran.resolved !== cmd ? ` [resolves to: ${ran.resolved}]` : '') +
    ` (exit ${ran.exitCode ?? 'null'})`;
  const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(ran.output), '```']).join(
    '\n',
  );
  const commandLog = {
    cmd,
    exitCode: ran.exitCode,
    output: ran.output,
    ok: ran.ok,
  };
  if (ran.ok) {
    return {
      ok: true,
      evidence: `ran "${cmd}" (exit 0)`,
      content,
      commandLog,
    };
  }
  return {
    ok: false,
    evidence: `ran "${cmd}" (exit ${ran.exitCode ?? 'null'})`,
    content,
    commandLog,
  };
}

/* ============================================================ git_status / git_diff ===== */

/**
 * `git_status` — wraps gitWorkspace.gitStatus (no ambient shell; same jail).
 * Returns the branch + dirty file list, capped and fed back to the model.
 */
async function executeGitStatus(
  _args: Record<string, unknown>,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  let status;
  try {
    status = await gitStatus(ctx.repoRoot!);
  } catch (e) {
    return {
      ok: false,
      evidence: `refused: git_status failed: ${(e as Error).message.slice(0, 200)}`,
    };
  }
  const lines = [
    `branch: ${status.branch || '(detached)'}`,
    ...status.files.map((f) => `${f.status}\t${f.path}`),
  ];
  const body = lines.join('\n');
  const capped = body.length > ASK_TOOL_GIT_OUTPUT_CAP
    ? `${body.slice(0, ASK_TOOL_GIT_OUTPUT_CAP)}\n…(truncated)`
    : body;
  const header = `### git status (${status.files.length} file${status.files.length === 1 ? '' : 's'})`;
  const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(capped), '```']).join('\n');
  return {
    ok: true,
    evidence: `git status — ${status.files.length} file${status.files.length === 1 ? '' : 's'}`,
    content,
  };
}

/**
 * `git_diff` — wraps gitWorkspace.gitDiff for one repo-relative path. The path
 * is jail-checked inside gitDiff (resolveInRepo + reserved `.git/` guard); a
 * thrown GitWorkspaceError is surfaced honestly as `ok: false`.
 */
async function executeGitDiff(
  args: Record<string, unknown>,
  ctx: AskToolContext,
  onFile?: (event: AskToolFileEvent) => void,
): Promise<AskToolResult> {
  const rel = asString(args.path);
  if (!rel) return { ok: false, evidence: 'refused: git_diff missing "path"' };
  const normalized = rel.replace(/\\/g, '/');
  onFile?.({ type: 'file:read', path: normalized });
  let diff;
  try {
    diff = await gitDiff(ctx.repoRoot!, rel);
  } catch (e) {
    onFile?.({ type: 'file:done', path: normalized });
    if (e instanceof GitWorkspaceError) {
      return { ok: false, evidence: `refused: git_diff "${normalized}": ${e.message}` };
    }
    return { ok: false, evidence: `refused: git_diff "${normalized}" failed: ${(e as Error).message.slice(0, 200)}` };
  }
  onFile?.({ type: 'file:done', path: normalized });
  const body = diff.diff;
  const capped = body.length > ASK_TOOL_GIT_OUTPUT_CAP
    ? `${body.slice(0, ASK_TOOL_GIT_OUTPUT_CAP)}\n…(truncated)`
    : body;
  const header = `### git diff ${diff.path}${body === '' ? ' (no changes)' : ''}`;
  const content = wrapUntrustedLines([header, '```diff', neutralizeUntrusted(capped), '```']).join('\n');
  return {
    ok: true,
    evidence: `git diff ${diff.path}${body === '' ? ' — no changes' : ''}`,
    content,
  };
}

/* ============================================================ call_mcp ===== */

/**
 * `call_mcp` — call one tool on one configured MCP server.
 *
 * Args: `{ server: string, tool: string, args?: object }`. The server must be
 * named in `.sequence/mcp.json` (or `SEQUENCE_MCP_CONFIG`); unknown servers
 * and transport failures are refused honestly. Content is capped (~4k) before
 * feeding back to the model.
 */
async function executeCallMcp(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const server = asString(args.server);
  const tool = asString(args.tool);
  if (!server) return { ok: false, evidence: 'refused: call_mcp missing "server"' };
  if (!tool) return { ok: false, evidence: 'refused: call_mcp missing "tool"' };
  const mcpArgs = args.args;
  if (mcpArgs !== undefined && (mcpArgs === null || typeof mcpArgs !== 'object' || Array.isArray(mcpArgs))) {
    return { ok: false, evidence: 'refused: call_mcp "args" must be an object' };
  }
  try {
    const result = await callMcpTool(ctx.repoRoot!, server, tool, mcpArgs ?? {});
    const rawText = formatMcpToolContent(result.content);
    const capped = rawText.length > ASK_TOOL_MCP_OUTPUT_CAP
      ? `${rawText.slice(0, ASK_TOOL_MCP_OUTPUT_CAP)}\n…(truncated)`
      : rawText;
    const header = `### call_mcp: ${server}/${tool}${result.isError ? ' (error)' : ''}`;
    const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(capped), '```']).join('\n');
    if (result.isError) {
      return {
        ok: false,
        evidence: `call_mcp ${server}/${tool} returned error`,
        content,
      };
    }
    return {
      ok: true,
      evidence: `call_mcp ${server}/${tool}`,
      content,
    };
  } catch (e) {
    if (e instanceof UnknownMcpServerError) {
      return { ok: false, evidence: `refused: ${e.message}` };
    }
    const msg = e instanceof McpTransportError ? e.message : (e as Error).message;
    return {
      ok: false,
      evidence: `refused: call_mcp ${server}/${tool} failed: ${msg.slice(0, 200)}`,
    };
  }
}

function formatMcpToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
          return (c as { text: string }).text;
        }
        return JSON.stringify(c);
      })
      .join('\n');
  }
  if (content === undefined) return '(empty)';
  return JSON.stringify(content);
}

/* ========================================================= call_plugin ===== */

/**
 * `call_plugin` — call one declared readonly tool from `.sequence/plugins.json`.
 *
 * Args: `{ plugin: string, tool: string, args?: object }`. The plugin and tool
 * must appear in the manifest (mode readonly only — enforced at parse).
 * Execution is a closed set of builtins ({@link BUILTIN_PLUGIN_TOOL_HANDLERS});
 * declared tools without a handler are refused honestly — never fabricated.
 */
function executeCallPlugin(
  args: Record<string, unknown>,
  ctx: AskToolContext,
): AskToolResult {
  const plugin = asString(args.plugin);
  const tool = asString(args.tool);
  if (!plugin) return { ok: false, evidence: 'refused: call_plugin missing "plugin"' };
  if (!tool) return { ok: false, evidence: 'refused: call_plugin missing "tool"' };
  const pluginArgs = args.args;
  if (
    pluginArgs !== undefined &&
    (pluginArgs === null || typeof pluginArgs !== 'object' || Array.isArray(pluginArgs))
  ) {
    return { ok: false, evidence: 'refused: call_plugin "args" must be an object' };
  }

  const loaded = loadPluginManifestV0(ctx.repoRoot!);
  if (!loaded.ok) {
    return {
      ok: false,
      evidence: `refused: call_plugin — ${loaded.error}`,
    };
  }
  const entry = loaded.manifest.plugins.find((p) => p.id === plugin);
  if (!entry) {
    return {
      ok: false,
      evidence: `refused: unknown plugin "${plugin}" (not in .sequence/plugins.json)`,
    };
  }
  const declared = entry.tools.find((t) => t.name === tool);
  if (!declared) {
    return {
      ok: false,
      evidence: `refused: plugin "${plugin}" has no tool "${tool}"`,
    };
  }

  const handler = BUILTIN_PLUGIN_TOOL_HANDLERS[tool];
  if (!handler) {
    const known = Object.keys(BUILTIN_PLUGIN_TOOL_HANDLERS).sort().join(', ') || '(none)';
    return {
      ok: false,
      evidence: `refused: plugin tool ${plugin}/${tool} has no handler yet (readonly builtins: ${known})`,
    };
  }

  const rawText = handler((pluginArgs as Record<string, unknown> | undefined) ?? {}, {
    plugin,
    tool,
  });
  const capped =
    rawText.length > ASK_TOOL_PLUGIN_OUTPUT_CAP
      ? `${rawText.slice(0, ASK_TOOL_PLUGIN_OUTPUT_CAP)}\n…(truncated)`
      : rawText;
  const header = `### call_plugin: ${plugin}/${tool}`;
  const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(capped), '```']).join(
    '\n',
  );
  return {
    ok: true,
    evidence: `call_plugin ${plugin}/${tool}`,
    content,
  };
}

/** Output cap for fetch_url fed back into the next provider call. */
const ASK_TOOL_FETCH_OUTPUT_CAP = 6_000;

/**
 * `fetch_url` — fetch one public https URL under SSRF/size/time caps.
 * Args: `{ url: string }`. No cookie jar; body is capped plain text only.
 */
async function executeFetchUrl(
  args: Record<string, unknown>,
  _ctx: AskToolContext,
): Promise<AskToolResult> {
  const rawUrl = asString(args.url);
  if (!rawUrl) return { ok: false, evidence: 'refused: fetch_url missing "url"' };
  const fetched = await netFetchUrl(rawUrl);
  if (!fetched.ok) {
    const bits = [fetched.url];
    if (fetched.status != null) bits.push(`HTTP ${fetched.status}`);
    if (fetched.error) bits.push(fetched.error);
    const header = `### fetch_url: ${fetched.url}`;
    const content = wrapUntrustedLines([header, bits.join(' · ')]).join('\n');
    return {
      ok: false,
      evidence: `fetch_url failed — ${bits.slice(1).join(' · ') || fetched.url}`,
      content,
    };
  }
  const body = fetched.text ?? '';
  const capped =
    body.length > ASK_TOOL_FETCH_OUTPUT_CAP
      ? `${body.slice(0, ASK_TOOL_FETCH_OUTPUT_CAP)}\n…(truncated)`
      : body;
  const meta = [
    fetched.url,
    fetched.status != null ? `HTTP ${fetched.status}` : null,
    fetched.title ? `title: ${fetched.title}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const header = `### fetch_url: ${meta}`;
  const content = wrapUntrustedLines([header, '```', neutralizeUntrusted(capped), '```']).join(
    '\n',
  );
  return {
    ok: true,
    evidence: `fetch_url ${fetched.url}`,
    content,
  };
}

/** True when a repo-relative path targets `.git/` internals (never propose). */
function isGitInternalPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return norm === '.git' || norm.startsWith('.git/');
}

/**
 * Recursive repo walk yielding posix-relative paths; return false to stop.
 *
 * ── SOURCE FIRST, AND DETERMINISTIC ────────────────────────────────────────
 *
 * This was a LIFO stack over raw `readdirSync` order with no ranking. MEASURED
 * on this monorepo (1,480 tracked files): the first 200 files it examined —
 * `ASK_TOOL_SEARCH_MAX_FILES`, the whole budget — were 88 PNG screenshots out of
 * a gitignored `tmp-shots/`, 72 from `tools/`, 17 at the root, 10 from `site/`
 * and 13 from `packages/`, of which ZERO were in `packages/analyzer/src`. The
 * agent's only discovery tool spent its entire budget on screenshots and then
 * answered "no matches" about the source tree.
 *
 * Three changes, each of which alone would have caught that:
 *
 *   1. ONE skip list. `SEARCH_SKIP_DIRS` was a third private copy of a list this
 *      repository keeps canonically in `ignoreDirs.ts` — and it was missing
 *      `release`, `server-bundle`, `out`, `coverage`, `vendor` and `.turbo`.
 *      `ignoreDirs.ts` exists BECAUSE two copies of this list once diverged and
 *      made the graph lie; `release/` and `server-bundle/` are complete second
 *      copies of this repo's own source and are on disk right now.
 *   2. Directories are ranked, and files are visited before descending. `src/`
 *      beats `packages/` beats everything else beats known asset directories,
 *      ties broken by name — so the walk is reproducible and reaches source.
 *   3. Non-text extensions are skipped BEFORE the budget is charged, so a
 *      screenshot cannot cost a file read the way it used to.
 */
const SEARCH_EXTRA_SKIP_DIRS = new Set(['.idea', '.vscode', '.sequence', 'tmp-shots']);

function isSearchSkippedDir(name: string): boolean {
  return IGNORE_DIRS.has(name) || SEARCH_EXTRA_SKIP_DIRS.has(name);
}

/** Extensions worth grepping. Anything else is bytes with no lines in it. */
const SEARCH_TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php', '.cs',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.mm', '.swift', '.scala',
  '.sh', '.bash', '.zsh', '.ps1', '.sql', '.graphql', '.gql', '.proto',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.md', '.mdx', '.txt', '.rst', '.html', '.htm', '.css', '.scss', '.less',
  '.vue', '.svelte', '.astro', '.tf', '.tfvars', '.dockerfile', '.gradle',
]);

/** Extensionless files that are real config/source (Dockerfile, Makefile, …). */
const SEARCH_TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'rakefile', 'gemfile', 'justfile',
  'cmakelists.txt', '.gitignore', '.dockerignore', '.npmrc', '.nvmrc', '.env',
]);

export function isSearchableTextFile(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  if (SEARCH_TEXT_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return SEARCH_TEXT_EXTENSIONS.has(base.slice(dot));
}

/** Lower sorts first. Source trees before packages before everything else. */
function searchDirRank(name: string): number {
  const n = name.toLowerCase();
  if (n === 'src' || n === 'lib' || n === 'app') return 0;
  if (n === 'packages' || n === 'apps' || n === 'services' || n === 'internal') return 1;
  if (
    n === 'assets' ||
    n === 'public' ||
    n === 'static' ||
    n === 'images' ||
    n === 'img' ||
    n === 'docs' ||
    n === 'doc' ||
    n === 'site' ||
    n === 'examples' ||
    n === 'tools'
  ) {
    return 3;
  }
  return 2;
}

function walkFiles(repoRoot: string, visit: (rel: string) => boolean): void {
  /*
   * A RANKED DEPTH-FIRST WALK. Breadth-first would finish every shallow
   * directory before entering any deep one, so `docs/` and `tools/` would be
   * read before `packages/app/src` — the exact inversion this is here to fix.
   * Diving into the best-ranked directory first is what "source before assets"
   * means on a tree where the source is four levels down.
   */
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = rel === '' ? repoRoot : path.join(repoRoot, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
      if (isSearchSkippedDir(entry.name)) continue;
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) dirs.push(childRel);
      else if (entry.isFile()) files.push(childRel);
    }
    files.sort();
    for (const f of files) {
      if (visit(f) === false) return;
    }
    /* Sorted WORST first, because a stack is popped from the end — so the
       best-ranked directory is the next one entered. */
    dirs.sort((a, b) => {
      const an = a.slice(a.lastIndexOf('/') + 1);
      const bn = b.slice(b.lastIndexOf('/') + 1);
      return searchDirRank(bn) - searchDirRank(an) || (bn < an ? -1 : bn > an ? 1 : 0);
    });
    for (const d of dirs) stack.push(d);
  }
}

/**
 * Minimal glob → RegExp. Supports `*` (non-slash), `**` (any), `?`.
 *
 * `**` followed by `/` matches ZERO OR MORE directories, which is what every
 * other glob implementation a reader has met does — minimatch, ripgrep and
 * .gitignore all agree. This used to escape the slash and keep it mandatory, so
 * `packages/**\/*.ts` silently missed `packages/a.ts` and `**\/*.ts` missed
 * every root-level file. The tool's own truncation message advises "narrow with
 * a glob", so the advice and the implementation disagreed — and the failure was
 * a shorter list, never an error.
 */
function globToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*\\/)?';
          i += 2; // consume the second `*` and the `/`
        } else {
          re += '.*';
          i++; // consume second `*`
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeRegex(c);
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

const FENCED_TOOL_RE = /```sequence-tool\s*\n([\s\S]*?)\n```/g;

/*
 * THE SAME BLOCK IN THE WRONG DELIMITER, accepted on purpose.
 *
 * Measured 2026-09-08 on minicpm5-hermes, a 2.6B model, answering a design ask:
 * it produced a `propose_topology` call with real nodes and edges and wrapped it
 * in `<sequence-tool>` TAGS rather than a ```sequence-tool FENCE. The prompt says
 * the word "fence" and shows one; a small model read that as a tag name.
 *
 * The proposal was correct and the board never saw it, because the parser matched
 * neither form and the whole call was dropped as prose.
 *
 * THIS WIDENS THE DELIMITER AND NOTHING ELSE. What is inside still has to parse as
 * JSON, still has to carry a string `name`, and that name still has to be on the
 * allowlist - the same three checks, on the same bodies, reporting the same way
 * when they fail. A model that did the work and reached for the wrong bracket has
 * not made an error worth losing a diagram over; rubbish is refused as before.
 */
const TAGGED_TOOL_RE = /<sequence-tool>\s*([\s\S]*?)\s*<\/sequence-tool>/g;

/** Topology extracted from a ```seqd or ```json fence — same shape as propose_topology. */
export interface FencedTopologyProposal {
  title?: string;
  rationale?: string;
  nodes: { id: string; label: string; kind: string }[];
  edges: { id: string; from: string; to: string; family: string; label?: string }[];
}

const FENCED_SEQD_RE = /```(?:seqd|json)\s*\n([\s\S]*?)\n```/g;

function prepSeqDiagramDraft(raw: Record<string, unknown>): void {
  if (raw.version === undefined) raw.version = 1;
  if (typeof raw.kind !== 'string') {
    raw.kind = 'service-flow';
  } else if (!SEQ_DIAGRAM_KINDS.includes(raw.kind as never)) {
    /* Model-invented kinds like `process-sequence` — coerce so validate passes. */
    if (/agent.?workflow|agentic|orchestrat/i.test(raw.kind)) {
      raw.kind = 'agent-workflow';
    } else if (/process|business|org|product|market/i.test(raw.kind)) {
      raw.kind = 'service-flow';
      if (!raw.meta || typeof raw.meta !== 'object') raw.meta = { diagramFamily: 'process' };
      else (raw.meta as Record<string, unknown>).diagramFamily = 'process';
    } else {
      raw.kind = 'service-sequence';
    }
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    raw.title = 'Architecture proposal';
  }
  if (!raw.grounded || typeof raw.grounded !== 'object') {
    raw.grounded = { graphId: 'chat:proposal', origin: 'design' };
  } else {
    const g = raw.grounded as Record<string, unknown>;
    if (typeof g.graphId !== 'string' || g.graphId.trim() === '') g.graphId = 'chat:proposal';
    if (g.origin === undefined) g.origin = 'design';
  }
  if (Array.isArray(raw.edges)) {
    for (const entry of raw.edges) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.family !== 'string' || !SEQ_DIAGRAM_EDGE_FAMILIES.includes(e.family as never)) {
        e.family = 'http';
      }
    }
  } else {
    raw.edges = [];
  }
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = (raw.edges ?? []) as SeqDiagramEdge[];
  const inferredKind = inferSeqDiagramKind({
    nodes: nodes as { id?: string; kind?: string }[],
    edges,
    explicitKind: typeof raw.kind === 'string' ? raw.kind : undefined,
  });
  raw.kind = inferredKind;
  if (!raw.layout || typeof raw.layout !== 'object') {
    raw.layout = seqDiagramLayoutForKind(inferredKind, edges);
  } else if (inferredKind === 'agent-workflow') {
    const layout = raw.layout as Record<string, unknown>;
    if (layout.engine === undefined) {
      raw.layout = seqDiagramLayoutForKind(inferredKind, edges);
    }
  }
  if (inferredKind === 'agent-workflow' && (!raw.meta || typeof raw.meta !== 'object')) {
    raw.meta = { diagramFamily: 'process' };
  } else if (
    inferredKind === 'service-flow' &&
    (!raw.meta || typeof raw.meta !== 'object' || (raw.meta as { diagramFamily?: string }).diagramFamily === undefined)
  ) {
    raw.meta = { ...(typeof raw.meta === 'object' && raw.meta ? raw.meta : {}), diagramFamily: 'process' };
  }
}

function looksLikeSeqDiagramObject(draft: Record<string, unknown>): boolean {
  if (!Array.isArray(draft.nodes) || draft.nodes.length === 0) return false;
  /* Tool envelopes are handled by salvageBareToolRequests — skip those. */
  if (typeof draft.name === 'string') return false;
  const kind = typeof draft.kind === 'string' ? draft.kind : '';
  const title = typeof draft.title === 'string' ? draft.title : '';
  const hasProposalId = draft.nodes.some((n) => {
    if (!n || typeof n !== 'object') return false;
    const id = (n as { id?: unknown }).id;
    return typeof id === 'string' && /^(?:proposal|design):/.test(id);
  });
  const kindLooks = /sequence|workflow|flow|map/i.test(kind);
  return kindLooks || (title !== '' && (hasProposalId || Array.isArray(draft.edges))) || hasProposalId;
}

function trySeqDiagramFromObject(draft: Record<string, unknown>): FencedTopologyProposal | null {
  if (!looksLikeSeqDiagramObject(draft)) return null;
  prepSeqDiagramDraft(draft);
  const checked = validateSeqDiagram(draft);
  if (!checked.ok) return null;
  return seqDiagramToTopology(draft as unknown as SeqDiagramV1);
}

function seqDiagramToTopology(doc: SeqDiagramV1): FencedTopologyProposal {
  return {
    title: doc.title,
    nodes: doc.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      family: e.family,
      ...(e.label ? { label: e.label } : {}),
    })),
  };
}

/**
 * Parse ```seqd and ```json fences carrying SeqDiagram v1 JSON. Malformed or
 * non-diagram blocks are left in the text. Valid diagrams are stripped — the
 * board receives them via `topology:proposal`, not as a transcript dump.
 */
export function parseFencedSeqdProposals(text: string): {
  proposals: FencedTopologyProposal[];
  stripped: string;
} {
  const proposals: FencedTopologyProposal[] = [];
  const stripped = text.replace(FENCED_SEQD_RE, (_m, body: string) => {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object') return _m;
      const draft = parsed as Record<string, unknown>;
      const topo = trySeqDiagramFromObject(draft);
      if (!topo) {
        /* Still allow tool-envelope-free diagrams that only fail the shape
         * heuristic because nodes lack proposal: ids — keep prior path. */
        if (!Array.isArray(draft.nodes) || draft.nodes.length === 0) return _m;
        if (typeof draft.name === 'string') return _m;
        prepSeqDiagramDraft(draft);
        const checked = validateSeqDiagram(draft);
        if (!checked.ok) return _m;
        proposals.push(seqDiagramToTopology(draft as unknown as SeqDiagramV1));
        return '';
      }
      proposals.push(topo);
      return '';
    } catch {
      return _m;
    }
  });
  return { proposals, stripped: stripped.replace(/\n{3,}/g, '\n\n').trimEnd() };
}

/**
 * Salvage unfenced SeqDiagram-shaped JSON the model dumped into prose
 * (`kind:"process-sequence"`, proposal: nodes) so the board still opens.
 */
export function salvageBareSeqdProposals(text: string): {
  proposals: FencedTopologyProposal[];
  stripped: string;
} {
  const proposals: FencedTopologyProposal[] = [];
  const removals: { start: number; end: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    if (removals.some((r) => i >= r.start && i < r.end)) continue;
    const raw = extractBalancedObject(text, i);
    if (!raw) continue;
    let draft: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') continue;
      draft = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const topo = trySeqDiagramFromObject(draft);
    if (!topo) continue;
    const end = i + raw.length;
    if (removals.some((r) => !(end <= r.start || i >= r.end))) continue;
    proposals.push(topo);
    removals.push({ start: i, end });
    i = end - 1;
  }
  if (removals.length === 0) return { proposals, stripped: text };
  removals.sort((a, b) => b.start - a.start);
  let stripped = text;
  for (const r of removals) {
    stripped = stripped.slice(0, r.start) + stripped.slice(r.end);
  }
  return { proposals, stripped: stripped.replace(/\n{3,}/g, '\n\n').trimEnd() };
}

/** Design-mode ask: the one tool that does not need an attached repo. */
export function renderDesignTopologyHintSection(opts?: { proposeNow?: boolean }): string[] {
  /*
   * THE SECOND LINE IS THE ONE THAT ORDERS THE INTERROGATION, and on
   * 2026-09-08 it was the last thing standing between the owner and a design.
   *
   * The report was "make sure it's doing system design". Two fixes went in
   * before this one and neither worked, because this line outranked both: an
   * unconditional PROPOSE NOW clause said "do not ask", this said "ask ONE
   * short clarifying question", and the model followed THIS one — its own
   * reasoning came back as "a topology request without a prior detail level, I
   * need to ask which scope they want before proposing". It was not ignoring
   * an instruction; it was obeying the other one.
   *
   * THIS IS THE SECOND TIME THIS EXACT LINE HAS DONE THIS. The comment at its
   * only other call site records 2026-09-02, when composing it with the teach
   * contract meant the belt "both ordered and forbade the interrogation the
   * owner actually got back". That was fixed by SKIPPING the whole section on a
   * lesson. Skipping it here is not available — a design turn needs the
   * propose_topology syntax that the rest of this section carries — so the line
   * itself becomes conditional.
   *
   * The line is KEPT for the ambiguous case, where it is correct: someone who
   * drew a board and asked for "a diagram" has not chosen a scope. What changed
   * is that a caller which has ALREADY decided to propose can say so, instead of
   * writing a louder instruction somewhere else and hoping it wins a fight
   * between two lines of the same prompt.
   */
  const lines = [
    'To put a diagram ON THE ARCHITECTURE BOARD (no repository attached), call `propose_topology` inside a ```sequence-tool fence — NEVER paste bare tool JSON into the answer (bare JSON does not reach the board):',
  ];
  if (opts?.proposeNow !== true) {
    lines.push(
      'When the user asks you to draw or design a topology and has NOT said how detailed they want, ask ONE short clarifying question in chat first: compact overview (few nodes, main flows) or detailed diagram (more services, roles, and edges). Do not call `propose_topology` with a large diagram until they answer — unless they already said detailed/compact or the scope is obvious from context.',
    );
  } else {
    lines.push(
      'The user has already asked for a design of a system that does not exist yet, so the scope question is ANSWERED: do not ask whether they want a compact or a detailed diagram. Choose the level yourself, say which you chose in one line, and call `propose_topology`.',
    );
  }
  lines.push(
    '```sequence-tool',
    '{"id":"d1","name":"propose_topology","args":{"title":"Travel insurer org",',
    '  "nodes":[{"id":"proposal:uw","label":"Underwriting","kind":"service","detail":{"whatItDoes":"Rates and binds policies"}}],',
    '  "edges":[{"id":"e1","from":"proposal:ceo","to":"proposal:uw","family":"control","label":"reports to"}]}}',
    '```',
    `Node kinds: ${SEQ_DIAGRAM_NODE_KINDS.join(', ')}. Edge families: ${SEQ_DIAGRAM_EDGE_FAMILIES.join(', ')}.`,
    'Optional per-node `detail.whatItDoes` — one short English line the board shows at closer zoom.',
    'Use proposal:… or design:… ids. Write reasoning in plain English beside the call, never instead of it.',
    'Do not wrap ordinary words in **asterisks** — the transcript does not render markdown emphasis.',
  );
  return lines;
}

/**
 * Parse ```` ```sequence-tool ```` fenced blocks from model text. Each block
 * holds one JSON object `{ id, name, args?, evidence? }`. Malformed blocks are
 * dropped (never executed). Returns the parsed requests and the text with the
 * blocks stripped — the stripped text is what the user sees and what feeds
 * into the next round's prompt context.
 */
/**
 * A MALFORMED BLOCK IS NOW SAID OUT LOUD.
 *
 * It used to be stripped from the answer and dropped: no request, no error,
 * nothing appended to the round's tool results. Back in the loop that reads as
 * "the model asked for nothing", the turn ends, and the user sees a short answer
 * that cites a file nothing ever read. Neither the model nor the reader was told
 * a tool call had been thrown away.
 *
 * Weak local models — the ones a local-first product exists for — emit
 * slightly-off tool JSON constantly: a trailing comma, a smart quote, an
 * unescaped newline inside `content`. `malformed` carries the parser's own
 * message back so the pipeline can hand it to the model as a tool result and buy
 * one corrective round out of the existing budget.
 *
 * TWO REPAIRS, BOTH REVERSALS OF A KNOWN TRANSFORM, never structural guessing:
 * curly quotes become straight ones, and a comma before a closing brace or
 * bracket is dropped. Anything else stays malformed and is reported as such.
 */
export function repairToolJson(body: string): string {
  return body
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1');
}

export function parseFencedToolRequests(text: string): {
  requests: AskToolRequest[];
  stripped: string;
  /** Parser messages for blocks that could not be executed. Never silent. */
  malformed: string[];
} {
  const requests: AskToolRequest[] = [];
  const malformed: string[] = [];
  /* Both delimiters, one handler: the tagged form is rewritten into the fenced
     form first, so exactly one code path parses, validates and reports. Two loops
     would be two chances for them to disagree about what is allowed. */
  const normalised = text.replace(TAGGED_TOOL_RE, (_m, body: string) =>
    ['```sequence-tool', String(body).trim(), '```'].join('\n'));
  const stripped = normalised.replace(FENCED_TOOL_RE, (_m, body: string) => {
    try {
      let obj: unknown;
      try {
        obj = JSON.parse(body) as unknown;
      } catch (first) {
        const repaired = repairToolJson(body);
        if (repaired === body) throw first;
        obj = JSON.parse(repaired) as unknown;
      }
      if (obj && typeof obj === 'object') {
        const r = obj as Record<string, unknown>;
        if (typeof r.name === 'string') {
          const allowed =
            (ASK_TOOL_ALLOWLIST as readonly string[]).includes(r.name) ||
            isCanvasToolName(r.name) ||
            r.name === CANVAS_STORY_TOOL;
          if (!allowed) {
            malformed.push(
              `your fenced tool block named "${r.name}", which is not a tool. Allowed names: ${ASK_TOOL_ALLOWLIST.join(', ')}.`,
            );
          }
          if (allowed) {
            const id =
              typeof r.id === 'string' && r.id.trim() !== '' ? r.id : r.name;
            requests.push({
              id,
              name: r.name,
              ...(r.args && typeof r.args === 'object'
                ? { args: r.args as Record<string, unknown> }
                : {}),
              ...(typeof r.evidence === 'string' ? { evidence: r.evidence } : {}),
            });
          }
        }
      }
      if (!obj || typeof obj !== 'object' || typeof (obj as Record<string, unknown>).name !== 'string') {
        malformed.push(
          'your fenced tool block parsed as JSON but had no string "name" field. ' +
            'Emit exactly one object with keys id, name, args.',
        );
      }
    } catch (e) {
      malformed.push(
        `your sequence-tool fenced block was not valid JSON (${(e as Error).message}). ` +
          'Re-emit it as a SINGLE JSON object with keys id, name, args — no prose inside the fence, ' +
          'no trailing comma, and newlines inside string values escaped as \\n.',
      );
    }
    return '';
  });
  return { requests, stripped: stripped.replace(/\n{3,}/g, '\n\n').trimEnd(), malformed };
}

/**
 * Walk a JSON object starting at `openBrace`, respecting strings/escapes.
 * Returns the slice inclusive of the matching `}`, or null if unbalanced.
 */
function extractBalancedObject(text: string, openBrace: number): string | null {
  if (openBrace < 0 || openBrace >= text.length || text[openBrace] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openBrace; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(openBrace, i + 1);
    }
  }
  return null;
}

function tryParseAskToolRequest(raw: string): AskToolRequest | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const r = obj as Record<string, unknown>;
    if (typeof r.name !== 'string') return null;
    const allowed =
      (ASK_TOOL_ALLOWLIST as readonly string[]).includes(r.name) ||
      isCanvasToolName(r.name) ||
      r.name === CANVAS_STORY_TOOL;
    if (!allowed) return null;
    const id =
      typeof r.id === 'string' && r.id.trim() !== '' ? r.id : r.name;
    return {
      id,
      name: r.name,
      ...(r.args && typeof r.args === 'object' ? { args: r.args as Record<string, unknown> } : {}),
      ...(typeof r.evidence === 'string' ? { evidence: r.evidence } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Salvage bare tool-call JSON the model pasted into prose instead of a
 * ```sequence-tool fence (owner transcript 2026-08-26: Hermes dump left
 * `{"id":"d1","name":"propose_topology",…}` in the answer and nothing on the
 * board). Brace-matches from each allowlisted `"name":"…"`, parses, strips.
 * Malformed slices are left alone.
 */
export function salvageBareToolRequests(text: string): {
  requests: AskToolRequest[];
  stripped: string;
} {
  const requests: AskToolRequest[] = [];
  const nameHit = /"name"\s*:\s*"(?:propose_topology|propose_files|read_file|search_files|run_command|git_status|git_diff|call_mcp|call_plugin|fetch_url|canvas\.write_\w+|canvas\.set_story_route)"/g;
  const removals: { start: number; end: number }[] = [];
  let hit: RegExpExecArray | null;
  while ((hit = nameHit.exec(text)) !== null) {
    const nameAt = hit.index;
    let open = -1;
    for (let i = nameAt; i >= 0; i--) {
      if (text[i] === '{') {
        const candidate = extractBalancedObject(text, i);
        if (!candidate) continue;
        if (nameAt >= i && nameAt < i + candidate.length) {
          open = i;
          break;
        }
      }
    }
    if (open < 0) continue;
    const raw = extractBalancedObject(text, open);
    if (!raw) continue;
    const parsed = tryParseAskToolRequest(raw);
    if (!parsed) continue;
    const end = open + raw.length;
    if (removals.some((r) => !(end <= r.start || open >= r.end))) continue;
    requests.push(parsed);
    removals.push({ start: open, end });
    nameHit.lastIndex = end;
  }
  if (removals.length === 0) return { requests, stripped: text };
  removals.sort((a, b) => b.start - a.start);
  let stripped = text;
  for (const r of removals) {
    stripped = stripped.slice(0, r.start) + stripped.slice(r.end);
  }
  return { requests, stripped: stripped.replace(/\n{3,}/g, '\n\n').trimEnd() };
}

/**
 * Fence parse first, then bare-JSON salvage on the remainder. Dedupes by id
 * (fenced / earlier bare wins).
 */
/**
 * NATIVE-XML TOOL SYNTAX IS A MALFORMED CALL, NOT PROSE.
 *
 * Measured on OpenRouter's PAID minimax-m3 (mini-50 v11, 2026-08-30): the
 * model emitted its native XML tool-call channel (<tool_call><invoke ...>)
 * INTO the content stream, wrapped in mangled special tokens
 * (`]<]minimax[>[` around every tag). Nothing can parse that soup reliably —
 * but treating it as ordinary prose ended turns as "the model answered" when
 * the model had actually asked for a tool. Detecting the shape and reporting
 * it as malformed routes it into the EXISTING corrective round, which tells
 * the model the one thing that fixes it: use ```sequence-tool fences.
 */
const NATIVE_XML_TOOL_LEAK =
  /<\/?(?:tool_call|invoke|antml:invoke|function_calls)\b|\]<\]minimax\[>\[/;

export function parseAllToolRequests(text: string): {
  requests: AskToolRequest[];
  stripped: string;
  /** Parser messages for fenced blocks that could not be executed. */
  malformed: string[];
} {
  const fenced = parseFencedToolRequests(text);
  const bare = salvageBareToolRequests(fenced.stripped);
  const byId = new Map<string, AskToolRequest>();
  for (const r of fenced.requests) byId.set(r.id, r);
  for (const r of bare.requests) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const malformed = [...fenced.malformed];
  if (byId.size === 0 && NATIVE_XML_TOOL_LEAK.test(bare.stripped)) {
    malformed.push(
      'your reply used a NATIVE XML tool-call syntax (<tool_call>/<invoke>), which this ' +
        'harness does not execute. Re-issue the call as a ```sequence-tool fenced JSON block ' +
        'exactly as the tool instructions show — one JSON object with "id", "tool", "args".',
    );
  }
  return { requests: [...byId.values()], stripped: bare.stripped, malformed };
}

/**
 * Merge structured `toolRequests` (from the provider result) with fenced-block
 * requests parsed from the text. Dedupes by `id`; fenced entries win on
 * collision (they carry `args`). Structured entries without `args` are kept
 * only if no fenced entry supplies args for that id — a tool with no args is
 * later refused by `executeAskTool`, surfacing the gap honestly.
 */
export function mergeToolRequests(
  structured: ReadonlyArray<AskToolRequest> | undefined,
  fenced: ReadonlyArray<AskToolRequest>,
): AskToolRequest[] {
  const byId = new Map<string, AskToolRequest>();
  for (const r of structured ?? []) {
    byId.set(r.id, r);
  }
  for (const r of fenced) {
    const existing = byId.get(r.id);
    if (!existing || (r.args && !existing.args)) {
      byId.set(r.id, r);
    }
  }
  return [...byId.values()];
}

/** One tool result, tagged with the 1-based round of this turn that produced it. */
export interface AskEvidenceEntry {
  round: number;
  /** Prompt-ready body — already capped and untrusted-wrapped by its own tool. */
  body: string;
}

/** Header for evidence carried in from an earlier round of the SAME turn. */
export const CARRIED_EVIDENCE_HEADER =
  '### carried from earlier rounds of this turn (already fetched — still valid, do NOT re-read)';

/**
 * Select the tool evidence that goes into the next provider call.
 *
 * Why this exists: the loop used to rebuild every round's prompt as
 * `base + this round's results`, so a file read in round 1 was absent from the
 * prompt the model composed round 2's request with. Three rounds of gathering
 * produced one round of usable evidence and the model re-read its own work.
 *
 * Retention policy, in priority order:
 *  1. The CURRENT round is always carried WHOLE and is never charged against
 *     the budget. It is the evidence the model just asked for; dropping any of
 *     it would be a regression on the pre-ledger behaviour.
 *  2. Earlier rounds are carried newest-first while the running total stays
 *     within {@link ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES}, then restored to
 *     chronological order so the model reads them in the order it fetched them.
 *  3. Anything that does not fit is dropped with a VISIBLE notice. An agent
 *     that silently lost evidence would answer from a hole it cannot see.
 */
export function selectCarriedEvidence(
  entries: readonly AskEvidenceEntry[],
  currentRound: number,
  capBytes: number = ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES,
): string[] {
  const current = entries.filter((e) => e.round === currentRound).map((e) => e.body);
  const earlier = entries.filter((e) => e.round < currentRound);

  const keptReversed: string[] = [];
  let bytes = 0;
  let dropped = 0;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const body = earlier[i]!.body;
    if (bytes + body.length > capBytes) {
      // Older-than-this entries are older still; stop rather than cherry-pick,
      // so the carried window is always a contiguous run of recent evidence.
      dropped = i + 1;
      break;
    }
    bytes += body.length;
    keptReversed.push(body);
  }
  const kept = keptReversed.reverse();

  const out: string[] = [];
  if (kept.length > 0 || dropped > 0) {
    out.push(CARRIED_EVIDENCE_HEADER);
    if (dropped > 0) {
      out.push(
        `(${dropped} earlier tool result${dropped === 1 ? '' : 's'} from this turn dropped to stay ` +
          `within the ${capBytes}-byte evidence budget — re-request if needed)`,
      );
    }
    out.push(...kept);
  }
  out.push(...current);
  return out;
}

/** Render the TOOL RESULTS prompt section appended between rounds. */
export function renderToolResultsSection(results: ReadonlyArray<string>): string[] {
  if (results.length === 0) return [];
  return [
    '--- TOOL RESULTS (real reads/searches from this repo — cite paths verbatim; do NOT invent code) ---',
    ...results,
  ];
}

/** Prompt hint for AI Canvas native writers when the tab or diagram intent is active. */
export function renderCanvasToolHintSection(): string[] {
  return [
    '--- AI CANVAS (typed artifact blocks) ---',
    'To render on the AI Canvas beside chat, emit fenced tool calls — NEVER paste bare JSON into the answer:',
    '```sequence-tool',
    '{"id":"c1","name":"canvas.write_markdown","args":{"title":"Plan","content":"# Step 1\\n…"}}',
    '```',
    'Writers (closed set): `canvas.write_markdown`, `canvas.write_mermaid`, `canvas.write_html`, `canvas.write_react`, `canvas.write_svg`.',
    'Operational: `canvas.set_story_route` with `{ "title": string, "steps": [{ "blockId", "caption" }] }` for guided story navigation.',
    'Each takes `{ "title"?: string, "content": string }`. Mermaid goes in `content` as source text.',
    'Architecture topology belongs on the Architecture board (`propose_topology`); AI Canvas is for plans, diagrams, and artifacts the user reads beside chat.',
    'Do not wrap ordinary words in **asterisks** — the transcript does not render markdown emphasis.',
  ];
}

/**
 * THE ONE DRAWING CALL A LESSON HAS A WORKED EXAMPLE FOR.
 *
 * The teach contract names `propose_chart` as the visual and forbids
 * `canvas.write_markdown` — but the belt showed fence syntax for read_file,
 * propose_files, propose_topology and canvas.write_markdown, and for
 * propose_chart only its NAME in "Allowed names only: …". A fence-only local
 * model (the local-first case the fence hint exists for) had a documented call
 * for exactly one writer: the one just forbidden. With no repo attached the
 * hole was total — `repoServer` sends `tools: undefined` when
 * `designMode || repoRoot === null`, so there was no native schema to fall back
 * on either, and the lesson reproduced the reported failure by writing a
 * markdown block.
 *
 * `version` is deliberately absent from the example: it is the schema's own
 * stamp, `validateChart` supplies it, and asking a model to type a constant is
 * asking it to get one wrong.
 */
export function renderChartToolHintSection(): string[] {
  return [
    '--- CHARTS (Sequence draws the pixels) ---',
    'To put a picture the reader can SEE in the answer, call `propose_chart` inside a ```sequence-tool fence — you supply the data, Sequence renders it:',
    '```sequence-tool',
    '{"id":"k1","name":"propose_chart","args":{"kind":"data-flow","title":"How a request reaches the model",',
    '  "items":[{"id":"ui","label":"Composer"},{"id":"srv","label":"Ask pipeline"},{"id":"llm","label":"Provider"}],',
    '  "links":[{"from":"ui","to":"srv","label":"POST /api/ask"},{"from":"srv","to":"llm"}],',
    '  "focusItemId":"srv"}}',
    '```',
    `Chart kinds: ${CHART_KINDS.join(', ')}.`,
    'Items are `{ "id", "label", "nodeId"?, "detail"?, "value"?, "group"?, "tone"? }` and links are `{ "from", "to", "label"?, "value"? }`; `from`/`to` name item ids, never labels.',
    'Give an item a `nodeId` ONLY when it stands for a real node of the attached repository — an invented nodeId is refused, and a chart about an idea needs none.',
    '`focusItemId` spotlights the one item under discussion. Do not restate the whole picture in prose afterwards.',
  ];
}

/**
 * Prompt hint so models without native toolRequests can request mid-turn tools
 * via fenced ```sequence-tool JSON blocks. Only for attached-repo asks.
 *
 * B2.2 also sends OpenAI-compatible `tools` when the wire supports it — this
 * fence hint stays as the belt for models that ignore native tools.
 */
export function renderAskToolHintSection(
  jobMode?: AskJobMode,
  permission?: string,
  opts?: { teach?: boolean },
): string[] {
  /* The belt the model is TOLD about is the belt it is given. Advertising a
     tool that will be refused invites the model to spend a round asking for
     it, and then to apologise for something the user chose. */
  const belt = askToolsForJobMode(jobMode, permission, opts);
  const allowed = belt.join(', ');
  const lines = [
    '--- TOOLS (attached repo) ---',
    'The STRUCTURE DIGEST you were given may be an INDEX rather than the full structure. Retrieve before you answer: emit one or more fenced blocks, then stop.',
    '```sequence-tool',
    '{"id":"t1","name":"read_file","args":{"path":"relative/path.ts"}}',
    '```',
    'This fenced-JSON form is the ONLY tool syntax this harness executes — native XML tool ' +
      'calls (<tool_call>, <invoke>) and bare function-call channels are NOT read and waste ' +
      'the round.',
    '`read_file` args `{ "path": string, "offset"?: 1-based first line, "limit"?: line count }`. Output is line-numbered; a truncated read names the exact offset that continues it.',
    '`search_files` args `{ "query": "string", "glob"?: "packages/**/*.ts" }` — case-insensitive SUBSTRING match (not a regex), capped snippets, and it says when it stopped early.',
  ];

  /*
   * THE GROUNDED TOOLS GO FIRST, because they are the ones a grep cannot
   * replace. Sequence scanned this repository into a dependency graph before
   * the question was asked; an agent that answers "what breaks if I change
   * this" by substring-matching is not using the product it is inside.
   */
  if (belt.includes('read_topology')) {
    lines.push(
      '`read_topology` args `{ "service"?: "svc:analyzer" }` — expands one service of the digest index to its REAL file list, modules and edges. No args lists every service id. Use it before guessing a path.',
    );
  }
  if (belt.includes('who_calls')) {
    lines.push(
      '`who_calls` args `{ "target": "packages/x/src/y.ts" }` — the scanned dependency edges INTO and OUT OF a node, plus how many nodes reach it transitively. Prefer this over `search_files` for "what uses this", "what does this depend on", and "what breaks if I change this".',
    );
  }
  if (belt.includes('edit_file')) {
    lines.push(
      'To change an EXISTING file, use `edit_file` — NOT `propose_files`, which needs the whole new body:',
      '```sequence-tool',
      '{"id":"e1","name":"edit_file","args":{"path":"a.ts","title":"Fix the guard",',
      '  "edits":[{"oldString":"if (x)","newString":"if (x && y)"}]}}',
      '```',
      'Each `oldString` must match the file EXACTLY and appear exactly once (add surrounding lines until it does, or set `replaceAll`). Line numbers from `read_file` are a display gutter — they are stripped for you, but do not invent them.',
    );
  }

  /*
   * THE EXAMPLES FOLLOW THE BELT.
   *
   * These lines used to be unconditional, so plan mode still showed the model
   * how to call `propose_files` while the executor refused it — an invitation
   * to spend a round asking for something, and then to apologise for a
   * decision the USER made. A hint that advertises a refused tool is worse
   * than no hint.
   */
  if (belt.includes('propose_files')) {
    const autoWrite = permission === 'autoEdit' || permission === 'full';
    lines.push(
      autoWrite
        ? 'To create NEW files, or replace several whole files at once (Auto-edit / Full writes them immediately under permission rules):'
        : 'To create NEW files, or replace several whole files at once, WITHOUT writing them (the user reviews and applies):',
      '```sequence-tool',
      '{"id":"p1","name":"propose_files","args":{"title":"Add X route",',
      '  "rationale":"why this change is the right one","files":[{"path":"a.ts","content":"…"}]}}',
      '```',
    );
  }
  if (belt.includes('propose_topology')) {
    /*
     * THE ARCHITECTURE HALF, and the reason the ```seqd fence is gone.
     *
     * The attached-repo prompt used to ask for a ```seqd block carrying a ghost
     * proposal, and NOTHING IN THE REPOSITORY PARSED ONE — the board's whole
     * Accept/Deny layer sat behind an action no code dispatched. A tool call
     * arrives as a structured result the server can emit as an event, which is
     * the same reason `propose_files` is a tool rather than a fence.
     */
    lines.push(
      'To propose ADDITIONS to the ARCHITECTURE (the user accepts or denies them on the board):',
      'Call `propose_topology` only inside a ```sequence-tool fence — NEVER paste bare tool JSON or bare SeqDiagram JSON into the answer (bare JSON is stripped and does not land on the board):',
      'When the user asks you to draw or design a topology and has NOT said how detailed they want, ask ONE short clarifying question in chat first: compact overview (few nodes, main flows) or detailed diagram (more services, roles, and edges). Do not call `propose_topology` with a large diagram until they answer — unless they already said detailed/compact or the scope is obvious from context.',
      '```sequence-tool',
      '{"id":"a1","name":"propose_topology","args":{"title":"Add a rate limiter",',
      '  "rationale":"why this shape","nodes":[{"id":"svc:limiter","label":"limiter","kind":"service","detail":{"whatItDoes":"Throttles inbound HTTP"}}],',
      '  "edges":[{"id":"e1","from":"svc:gateway","to":"svc:limiter","family":"http"}]}}',
      '```',
      `Node kinds: ${SEQ_DIAGRAM_NODE_KINDS.join(', ')}. Edge families: ${SEQ_DIAGRAM_EDGE_FAMILIES.join(', ')}.`,
      'Optional per-node `detail.whatItDoes` — one short English line the board shows at closer zoom.',
      'A proposed node NEVER carries evidenceRef — it is a proposal precisely because nothing proves it yet.',
      'An edge may join proposed nodes or use real digest ids for nodes the scan already found; unknown endpoints are refused.',
      'This tool cannot remove or rename nodes, or delete, replace, or rewire existing edges.',
    );
  }
  if (belt.includes('run_command')) {
    lines.push(
      'To run a build/test command: `run_command` with args `{ "cmd": "python -m pytest tests/x.py" }`.',
      'Recognised runners: node/npm/pnpm/yarn/npx, python/pytest/tox, go, cargo, make/cmake, mvn/gradle, dotnet, ruby/rake, php, git, and `./script.py`-style repo scripts. No shells, no pipes, no redirects.',
      `AFTER EVERY EDIT, RUN THE RELEVANT TESTS and read the output. If they fail, edit again and re-run — you have up to ${ASK_TOOL_WRITE_CALLS_PER_TURN} file-edit calls this turn. Do not report done on an unverified change.`,
    );
  }
  lines.push(
    'To inspect the working tree: `git_status` (no args) and `git_diff` with args `{ "path": "rel.ts" }`.',
    'To call a configured MCP tool: `call_mcp` with args `{ "server": "name", "tool": "toolName", "args"?: {} }`. Servers are allowlisted in `.sequence/mcp.json` (Settings → MCP servers edits that file).',
    'To call a declared readonly plugin tool: `call_plugin` with args `{ "plugin": "id", "tool": "toolName", "args"?: {} }`. Plugins are listed in `.sequence/plugins.json`. Only tools with a closed builtin handler run; others refuse honestly.',
    'To fetch a public web page under policy: `fetch_url` with args `{ "url": "https://…" }` (SSRF-protected; capped plain text; no cookie jar).',
    `Allowed names only: ${allowed}.`,
    'Place work in the right surface: Architecture is the source of truth (topology and process). Whiteboard is for freehand / generate hand-off beside Architecture. Chat drives both. Settings holds AI connection, autonomy, and tool permissions.',
    ...(belt.includes('propose_files')
      ? [
          permission === 'autoEdit' || permission === 'full'
            ? 'Paths must be repo-relative and inside the attached repo. Successful edits are written to disk immediately.'
            : 'Paths must be repo-relative and inside the attached repo. propose_files does NOT write to disk.',
        ]
      : ['Paths must be repo-relative and inside the attached repo.']),
    'Do NOT invent file contents or topology. After tools run you will receive TOOL RESULTS and continue.',
  );
  return lines;
}

/**
 * B2.2 / B2.4 — single registry for ask tools: wire name, OpenAI JSON Schema,
 * description, and the UI verb fragment used after `Called ` in work rows.
 *
 * Anthropic Messages wire is out of scope for this slice (different schema /
 * `tool_use`). Fence salvage remains the belt when the model ignores these.
 */
export interface OpenAiAskToolDefinition {
  type: 'function';
  function: {
    name: AskToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AskToolRegistryEntry {
  description: string;
  parameters: Record<string, unknown>;
  /** Fragment after `Called ` in chat work rows (must match web2 phase maps). */
  uiVerb: AskToolName;
}

/** Canonical tool schemas — OpenAI defs and UI verbs both read from here (B2.4). */
export const ASK_TOOL_REGISTRY: Record<AskToolName, AskToolRegistryEntry> = {
  read_file: {
    uiVerb: 'read_file',
    description: 'Read a repo-relative file from the attached repository.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  edit_file: {
    uiVerb: 'edit_file',
    description:
      'Change part of an EXISTING repo file by naming the exact text to replace. Each `oldString` ' +
      'must appear exactly once in the file (set `replaceAll` to change every occurrence) — an ' +
      'ambiguous or absent `oldString` is refused with the occurrence count, never guessed. ' +
      'Prefer this over propose_files for any change to a file that already exists: propose_files ' +
      'requires the WHOLE new file body. Writes nothing to disk; stages one proposal for review.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path of an existing file' },
        title: { type: 'string', description: 'Short title for the review pane' },
        rationale: { type: 'string', description: 'Why this change is the right one' },
        edits: {
          type: 'array',
          description: 'Replacements applied in order to the file.',
          items: {
            type: 'object',
            properties: {
              oldString: {
                type: 'string',
                description:
                  'Exact text to replace, whitespace included. Include surrounding lines until it is unique.',
              },
              newString: { type: 'string', description: 'Replacement text (empty string deletes)' },
              replaceAll: {
                type: 'boolean',
                description: 'Replace every occurrence instead of requiring exactly one',
              },
            },
            required: ['oldString', 'newString'],
          },
        },
      },
      required: ['path', 'edits'],
      additionalProperties: false,
    },
  },
  read_topology: {
    uiVerb: 'read_topology',
    description:
      'Expand ONE service of the structure digest back to its real file list, modules and edges. ' +
      'The digest in the prompt is an INDEX: it names every service but not the files inside them. ' +
      'Call with no arguments for the list of service ids; call with `service` for one of them. ' +
      'Reads the scan already in memory — no re-scan, no disk walk.',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'A service id, name or directory from the digest. Omit to list them all.',
        },
      },
      additionalProperties: false,
    },
  },
  locate_symbol: {
    uiVerb: 'locate_symbol',
    description:
      'WHERE IS THIS DEFINED. Give it ONE identifier - a function, const, class, type or ' +
      'interface name - and it returns the exact file and line of every DECLARATION, best ' +
      'first, with the declaring line as proof. Use this instead of search_files whenever the ' +
      'question is "which file has X", "where is X defined", or "what package is X in": ' +
      'search_files matches every mention, so a definition sinks beneath its call sites. ' +
      'It answers from the repository, so a correct answer needs no guessing.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'One identifier, e.g. resolveShell or MAX_ASK_TOOL_ROUNDS. Not a phrase.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  who_calls: {
    uiVerb: 'who_calls',
    description:
      'Grounded dependency lookup over the scanned architecture graph: what depends on a node ' +
      '(INCOMING), what it depends on (OUTGOING), and how many nodes reach it transitively ' +
      '(BLAST RADIUS). Use this instead of search_files for "what breaks if I change this", ' +
      '"what uses this", or "what does this depend on" — it walks real scanned edges rather than ' +
      'matching text. `target` is a repo-relative file path, a graph node id, or a service name.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Repo-relative file path, graph node id, or service name',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  search_files: {
    uiVerb: 'search_files',
    description: 'Search the attached repository by query and optional glob.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  propose_files: {
    uiVerb: 'propose_files',
    description: 'Propose file edits for human review (does not write to disk unless Auto-edit/Full).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        rationale: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
  },
  propose_topology: {
    uiVerb: 'propose_topology',
    description: 'Propose an architecture topology for the Architecture board (review before apply).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        nodes: { type: 'array' },
        edges: { type: 'array' },
      },
      required: ['nodes', 'edges'],
      additionalProperties: false,
    },
  },
  propose_chart: {
    uiVerb: 'propose_chart',
    description:
      'Draw a chart the reader can SEE. You supply the kind and the data; Sequence renders it. ' +
      'kind is one of: ' + CHART_KINDS.join(', ') + '. ' +
      'items[] are {id,label,nodeId?,detail?,value?,group?,tone?} and links[] are {from,to,label?,value?}. ' +
      'nodeId must be a REAL node id from this repository when the item stands for part of the system — ' +
      'a chart that invents structure is refused. Use focusItemId to spotlight the one item under discussion.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
        caption: { type: 'string' },
        items: { type: 'array' },
        links: { type: 'array' },
        axes: { type: 'object' },
        focusItemId: { type: 'string' },
        version: { type: 'number' },
      },
      required: ['kind', 'title', 'items'],
      additionalProperties: true,
    },
  },
  propose_plan: {
    uiVerb: 'propose_plan',
    description:
      'Write the lesson plan ONCE, at the opening turn, when the lesson is about something the ' +
      'repository graph cannot order for you — an attached article, a maths note, a subject ' +
      'rather than a file. concepts[] are {title, nodeId?} in teaching order. Give a concept a ' +
      'nodeId ONLY when it stands for a real part of this repository; a plan that invents one is ' +
      'refused whole. A concept with no file behind it needs no nodeId. Sequence stores the plan ' +
      'and hands you one concept per turn — you never write it again.',
    parameters: {
      type: 'object',
      properties: {
        concepts: { type: 'array' },
      },
      required: ['concepts'],
      additionalProperties: true,
    },
  },
  run_command: {
    uiVerb: 'run_command',
    description: 'Run an allowlisted relative command under the repo root (Full permission).',
    parameters: {
      type: 'object',
      properties: { cmd: { type: 'string' } },
      required: ['cmd'],
      additionalProperties: false,
    },
  },
  git_status: {
    uiVerb: 'git_status',
    description: 'Show git status for the attached repository.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  git_diff: {
    uiVerb: 'git_diff',
    description: 'Show a git diff for an optional repo-relative path.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
  },
  call_mcp: {
    uiVerb: 'call_mcp',
    description: 'Call a tool on a configured MCP server.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['server', 'tool'],
      additionalProperties: false,
    },
  },
  call_plugin: {
    uiVerb: 'call_plugin',
    description:
      'Call a readonly tool declared in .sequence/plugins.json (closed builtins only; unknown handlers refuse honestly).',
    parameters: {
      type: 'object',
      properties: {
        plugin: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['plugin', 'tool'],
      additionalProperties: false,
    },
  },
  fetch_url: {
    uiVerb: 'fetch_url',
    description:
      'Fetch one public https URL under SSRF and size/time caps; returns status and capped plain text only.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
};

/** UI / SSE work-row verb for a tool name (falls back to the raw name). */
export function askToolUiVerb(name: string): string {
  const entry = ASK_TOOL_REGISTRY[name as AskToolName];
  return entry?.uiVerb ?? name;
}

/** Build OpenAI `tools` for the names currently on the belt. */
export function openaiAskToolDefinitions(
  names: readonly AskToolName[] = ASK_TOOL_ALLOWLIST,
): OpenAiAskToolDefinition[] {
  const out: OpenAiAskToolDefinition[] = [];
  for (const name of names) {
    const spec = ASK_TOOL_REGISTRY[name];
    if (!spec) continue;
    out.push({
      type: 'function',
      function: {
        name,
        description: spec.description,
        parameters: spec.parameters,
      },
    });
  }
  return out;
}
