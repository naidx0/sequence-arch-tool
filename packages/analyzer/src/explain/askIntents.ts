/**
 * Ask INTENTS — the composer's `+` picks as server-side capabilities.
 *
 * ================================ WHY THIS EXISTS ==========================
 * Owner, verbatim: "Is the tool calling working? Is it included in the prompt?
 * Can the user see that we're including it in a prompt? It shouldn't be seen.
 * It should just be added as a tool, and our backend runs that way."
 *
 * He was right. Until this module, an attached chip ("Plan tasks", "What
 * breaks", "Break it down") was a paragraph of prose the CLIENT glued onto the
 * front of the user's typed words (`composeOutgoingMessage`) before POSTing one
 * merged string to `/api/ask`. An earlier round only stopped RENDERING that
 * paragraph — the instruction was still literally part of the user's message on
 * the wire.
 *
 * Now the client sends the user's words and a STRUCTURED list of invoked
 * intents (`{ id, subject?, subjectNodeId? }`). This module is the server-side
 * registry that turns each invocation into:
 *
 *   1. a DIRECTIVE — the instruction text, authored HERE, never on the client;
 *   2. GROUNDED FACTS — for the intents that can be answered from the real
 *      graph, computed by the SAME deterministic engines the canvas uses
 *      (`serviceLevelRisksInput` + `computeImpact`, real containment edges).
 *      The model narrates those numbers; it never derives them.
 *
 * ============================ WHY NOT NATIVE TOOL-CALLING ==================
 * `llm/label.ts` proves we can drive Anthropic's native tool-calling and an
 * OpenAI-compatible JSON mode. Neither is the right shape here, and pretending
 * otherwise would be the exact dishonesty this round exists to remove:
 *
 *   - Native tool-calling exists so the MODEL can decide which capability to
 *     invoke. Here the user already decided — they clicked the chip. Handing
 *     the model a `tools:[...]` array so it can "choose" the thing it was told
 *     to do buys a second provider round trip, a second chance to hallucinate
 *     arguments, and nothing else.
 *   - The capabilities that carry real value (`impact`, `break-down`) are
 *     DETERMINISTIC: the answer comes from the graph, not from the model. A
 *     tool call would only be a slower way for the server to call its own
 *     function.
 *
 * So every provider — Anthropic api-key, any OpenAI-compatible BYO key, and the
 * hosted default gateway — takes the SAME server-composed path. There is no
 * provider capability branch to get wrong, and therefore no invisible
 * degradation: a provider with no tool support behaves identically to one with
 * it, because tool support is not on this path at all. What is genuinely
 * deferred is named in the report, not hidden behind a rename.
 *
 * ================================ HONESTY GUARDS ===========================
 *   - An intent id we do not implement injects NOTHING and is reported back as
 *     `unsupported` — a version-skewed client can never make the server invent
 *     a capability (the fabrication-guard stance of `llm/label.ts`, where a
 *     returned id that was never requested is dropped).
 *   - A `subject` that resolves to no real node is stated as such in the facts;
 *     the server never renames the user's subject onto a node that merely looks
 *     similar, and never emits a component name that is not in the graph.
 *   - Every fact line is derived from `graph`. Nothing here is generated text.
 *
 * PURE + DOM-free + provider-free, so the whole registry is testable without a
 * server or a key.
 */

import type { ArchGraph, ArchNode } from '@sequence/schema';
import { computeImpact } from '@sequence/schema';
import { serviceLevelRisksInput, liftToTopLevel } from './serviceGraph.js';
import { cutToBudget } from '../llm/tokenBudget.js';
import { neutralizeUntrusted, wrapUntrustedLines } from '../llm/untrusted.js';

/* ============================================================== the wire === */

/** One invoked intent as it arrives on the `/api/ask` wire. */
export interface AskIntentInvocation {
  /** Registry id — matches a composer action / research skill / workflow intent. */
  id: string;
  /** The label of whatever the user had selected when they attached the chip. */
  subject?: string;
  /** The real graph node id of that selection, when there was one. Preferred over `subject`. */
  subjectNodeId?: string;
}

/** How an intent is answered. Reported so the shape is inspectable, never guessed. */
export type AskIntentExecution = 'deterministic' | 'model';

/** One executed intent, ready to be rendered into the prompt. */
export interface ExecutedAskIntent {
  id: string;
  label: string;
  execution: AskIntentExecution;
  /** The instruction — authored server-side. */
  directive: string;
  /** Grounded lines computed from the real graph. Empty when nothing could be grounded. */
  facts: string[];
}

export interface ExecutedAskIntents {
  executed: ExecutedAskIntent[];
  /** Ids with no server capability — injected NOWHERE, reported honestly. */
  unsupported: string[];
}

/* ============================================================== validation = */

/** Hard cap on invocations per turn — a chip list is short; anything longer is noise or abuse. */
const MAX_INTENTS = 12;
const MAX_SUBJECT_CHARS = 200;
const MAX_ID_CHARS = 80;

/**
 * Strictly parse the wire's `intents` field. Returns `[]` for an absent/empty
 * field (the legacy request shape — see the backwards-compat note on
 * `/api/ask`), and `{ error }` only when the field is PRESENT and malformed, so
 * a client bug surfaces instead of silently dropping the user's intent.
 */
export function parseAskIntents(raw: unknown): { intents: AskIntentInvocation[] } | { error: string } {
  if (raw === undefined || raw === null) return { intents: [] };
  if (!Array.isArray(raw)) return { error: '"intents" must be an array when present' };
  if (raw.length > MAX_INTENTS) return { error: `"intents" may hold at most ${MAX_INTENTS} entries` };
  const out: AskIntentInvocation[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { error: 'each intent must be an object' };
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.trim() === '') {
      return { error: 'each intent needs a non-empty string "id"' };
    }
    const id = o.id.trim().slice(0, MAX_ID_CHARS);
    // Attaching the same chip twice is a no-op client-side; enforce it here too
    // so a duplicated id can never double an instruction in the prompt.
    if (seen.has(id)) continue;
    seen.add(id);
    if (o.subject !== undefined && typeof o.subject !== 'string') {
      return { error: `intent "${id}": "subject" must be a string when present` };
    }
    if (o.subjectNodeId !== undefined && typeof o.subjectNodeId !== 'string') {
      return { error: `intent "${id}": "subjectNodeId" must be a string when present` };
    }
    const inv: AskIntentInvocation = { id };
    const subject = typeof o.subject === 'string' ? o.subject.trim().slice(0, MAX_SUBJECT_CHARS) : '';
    if (subject !== '') inv.subject = subject;
    const nodeId = typeof o.subjectNodeId === 'string' ? o.subjectNodeId.trim() : '';
    if (nodeId !== '') inv.subjectNodeId = nodeId;
    out.push(inv);
  }
  return { intents: out };
}

/* ============================================================ the registry = */

/** The `it` in a directive when nothing was selected — never a made-up name. */
const ANY = 'this system';

/** Bounded fact lists: the compiled-context budget must survive an intent. */
const MAX_PART_LINES = 24;
const MAX_FILE_LINES = 16;
const MAX_IMPACT_LINES = 20;

interface ResolvedSubject {
  /** The real node the subject resolved to, when it resolved at all. */
  node?: ArchNode;
  /** What the user's chip said the subject was — for honest "not in the scan" copy. */
  requested?: string;
}

interface Capability {
  id: string;
  label: string;
  execution: AskIntentExecution;
  directive: (subject: string | undefined) => string;
  /**
   * Deterministic evidence from the real graph. Never called without a graph.
   *
   * `grounded` is the honesty flag: TRUE only when something was actually
   * COMPUTED. An honest negative ("that component is not in the scan") is still
   * worth putting in the prompt, but reporting it as a deterministic execution
   * would claim an answer we never computed.
   */
  gather?: (graph: ArchGraph, subject: ResolvedSubject) => GatherResult;
}

interface GatherResult {
  lines: string[];
  grounded: boolean;
}

/** Resolve an invocation's subject to a REAL node: id first (exact), then label. */
function resolveSubject(graph: ArchGraph | undefined, inv: AskIntentInvocation): ResolvedSubject {
  const requested = inv.subject;
  if (!graph) return requested ? { requested } : {};
  if (inv.subjectNodeId) {
    const byId = graph.nodes.find((n) => n.id === inv.subjectNodeId);
    if (byId) return { node: byId, requested: requested ?? byId.label };
  }
  if (requested) {
    const wanted = requested.toLowerCase();
    // Exact label match only. A fuzzy match would let the assistant answer about
    // a component the user never named — the "grounded, never guessed" line.
    const byLabel = graph.nodes.find((n) => n.label.toLowerCase() === wanted);
    if (byLabel) return { node: byLabel, requested };
  }
  return requested ? { requested } : {};
}

/** One display line for a real node — kind, label, and its real path when it has one. */
function nodeLine(n: ArchNode): string {
  return n.path ? `${n.kind}: ${n.label} — ${n.path}` : `${n.kind}: ${n.label}`;
}

/** "not in the scan" copy — honest, and never guesses a replacement. */
function notInScan(subject: string | undefined, what: string): GatherResult {
  if (!subject) return { lines: [], grounded: false };
  return {
    lines: [
      `No component named "${subject}" is in the scan, so ${what} could not be computed for it. ` +
        `Say so plainly rather than answering about a different component.`,
    ],
    grounded: false,
  };
}

/** Direct children of `node` in the real containment tree. */
function childrenOf(graph: ArchGraph, id: string): ArchNode[] {
  return graph.nodes.filter((n) => n.parentId === id);
}

/** Every node inside `id`'s subtree (itself excluded). */
function descendantsOf(graph: ArchGraph, id: string): ArchNode[] {
  const out: ArchNode[] = [];
  const frontier = [id];
  const seen = new Set<string>([id]);
  while (frontier.length > 0) {
    const cur = frontier.pop()!;
    for (const child of childrenOf(graph, cur)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      frontier.push(child.id);
    }
  }
  return out;
}

/**
 * BREAK IT DOWN — deterministic. The parts of a component are its real children
 * in the scanned containment tree; "shared" parts are the ones a component
 * OUTSIDE the subtree actually has an edge to. Both come from the graph, so the
 * model has nothing left to invent.
 */
function gatherBreakdown(graph: ArchGraph, subject: ResolvedSubject): GatherResult {
  const node = subject.node;
  if (!node) return notInScan(subject.requested, 'its parts');
  const parts = childrenOf(graph, node.id);
  if (parts.length === 0) {
    // Still a COMPUTED answer: the scan really does show no children.
    return {
      lines: [`"${node.label}" (${node.kind}) has no child components in the scan — it is a leaf.`],
      grounded: true,
    };
  }
  const inside = new Set(descendantsOf(graph, node.id).map((n) => n.id));
  inside.add(node.id);
  const sharedIds = new Set<string>();
  for (const e of graph.edges) {
    if (inside.has(e.srcId) && !inside.has(e.dstId)) sharedIds.add(e.srcId);
    if (inside.has(e.dstId) && !inside.has(e.srcId)) sharedIds.add(e.dstId);
  }
  const lines: string[] = [
    `Parts of "${node.label}" (${node.kind}) — ${parts.length} direct child component(s) in the scan:`,
  ];
  for (const p of parts.slice(0, MAX_PART_LINES)) {
    const shared =
      sharedIds.has(p.id) || descendantsOf(graph, p.id).some((d) => sharedIds.has(d.id));
    lines.push(`- ${nodeLine(p)}${shared ? '  [connects outside this component]' : ''}`);
  }
  if (parts.length > MAX_PART_LINES) {
    lines.push(`- (+${parts.length - MAX_PART_LINES} more child component(s) not listed here)`);
  }
  return { lines, grounded: true };
}

/**
 * PLAN TASKS — the decomposition itself is genuine reasoning, so it runs on the
 * model. What is deterministic is the SCOPE it must plan against: the real files
 * inside the subject. Handing those over is what keeps a task list from naming a
 * file that does not exist.
 */
function gatherTaskScope(graph: ArchGraph, subject: ResolvedSubject): GatherResult {
  const node = subject.node;
  if (!node) return notInScan(subject.requested, 'a file scope');
  const files = descendantsOf(graph, node.id).filter((n) => n.kind === 'file' && n.path);
  if (files.length === 0) {
    return {
      lines: [`"${node.label}" (${node.kind}) has no scanned files — do not name files for it.`],
      grounded: true,
    };
  }
  const lines = [
    `Real files inside "${node.label}" (${files.length} scanned) — every file a task names must be one of these:`,
  ];
  for (const f of files.slice(0, MAX_FILE_LINES)) lines.push(`- ${f.path}`);
  if (files.length > MAX_FILE_LINES) {
    lines.push(`- (+${files.length - MAX_FILE_LINES} more; ask before naming a file not listed)`);
  }
  return { lines, grounded: true };
}

/**
 * WHAT BREAKS — fully deterministic. Lifted to the SERVICE level (the level a
 * human reasons about) and computed by `computeImpact` over the same projection
 * the digest's `risks` section and the canvas impact overlay use, so the chat,
 * the canvas, and the digest can never disagree about a blast radius.
 */
function gatherImpact(graph: ArchGraph, subject: ResolvedSubject): GatherResult {
  const node = subject.node;
  if (!node) {
    if (subject.requested) return notInScan(subject.requested, 'a blast radius');
    // Nothing was selected: the digest already carries a precomputed `risks`
    // section, so point at it rather than computing a second, competing answer.
    return {
      lines: [
        'No component was selected, so no single blast radius was computed. Answer from the ' +
          "digest's precomputed `risks` section instead — do not recompute it.",
      ],
      grounded: false,
    };
  }
  const lift = liftToTopLevel(graph);
  const top = lift(node.id);
  if (!top) {
    return {
      lines: [
        `"${node.label}" is not inside any service, datastore, or topic in the scan, so it has no ` +
          'service-level blast radius. Say that rather than estimating one.',
      ],
      grounded: true,
    };
  }
  const ri = serviceLevelRisksInput(graph);
  const labelOf = new Map(ri.nodes.map((n) => [n.id, n.label]));
  const impact = computeImpact(ri.edges, top.id);
  // `impactedBy` = "breaks if this fails" (the headline); `dependsOn` = what it needs.
  const breaks = impact.impactedBy.map((id) => labelOf.get(id) ?? id);
  const breaksDirect = new Set(impact.impactedByDirect.map((id) => labelOf.get(id) ?? id));
  const needs = impact.dependsOn.map((id) => labelOf.get(id) ?? id);
  const lifted = top.id === node.id ? '' : ` (via its owning ${top.kind} "${top.label}")`;
  const lines: string[] = [
    `Blast radius of "${top.label}" (${top.kind})${lifted}, computed from the real dependency ` +
      `edges over ${ri.nodes.length} top-level component(s):`,
    breaks.length === 0
      ? '- Nothing in the scan breaks if it fails: no component depends on it.'
      : `- ${breaks.length} component(s) break if it fails:`,
  ];
  for (const label of breaks.slice(0, MAX_IMPACT_LINES)) {
    lines.push(`  · ${label}${breaksDirect.has(label) ? ' (direct dependent — fails hard)' : ' (indirect — reached through another component)'}`);
  }
  if (breaks.length > MAX_IMPACT_LINES) {
    lines.push(`  · (+${breaks.length - MAX_IMPACT_LINES} more)`);
  }
  if (needs.length > 0) {
    lines.push(`- It depends on: ${needs.slice(0, MAX_IMPACT_LINES).join(', ')}`);
  }
  lines.push(
    'These counts are computed, not estimated — use them verbatim and do not add components ' +
      'that are not on this list.',
  );
  return { lines, grounded: true };
}

/**
 * The capability registry. Every id the composer can attach MUST appear here —
 * `packages/web/src/panels/composerActions.registry.test.ts` locks that both
 * ways, so a new chip cannot ship without a server capability behind it.
 *
 * The directive text lives HERE and only here. The client's `ComposerAction.prompt`
 * survives as menu copy / the (unused-on-the-wire) `composeOutgoingMessage`
 * primitive; it is no longer what the model reads.
 */
const CAPABILITIES: Capability[] = [
  {
    id: 'break-down',
    label: 'Break it down',
    execution: 'deterministic',
    directive: (s) =>
      `Break ${s ?? ANY} down into its parts. For each part: what it is, what it does, and the ` +
      `evidence (file, line). List the parts that connect outside this component separately.`,
    gather: gatherBreakdown,
  },
  {
    id: 'multi-task',
    label: 'Plan tasks',
    execution: 'model',
    directive: (s) =>
      `Propose a short list of concrete tasks for ${s ?? ANY}, each one scoped to a single ` +
      `component and small enough to finish in one sitting. For each task give a title, the ` +
      `files it touches, and how the user would know it is done.`,
    gather: gatherTaskScope,
  },
  {
    id: 'impact',
    label: 'What breaks',
    execution: 'deterministic',
    directive: (s) =>
      `If ${s ?? ANY} changed or failed, what else breaks? Report the computed blast radius ` +
      `below, name each affected component, and say which of them fail hard versus degrade.`,
    gather: gatherImpact,
  },
  /* The two entries the owner unlisted from the `+` menu (E1). Their capability
   * stays real so a later surface can re-offer them without re-deriving text. */
  {
    id: 'trace-flow',
    label: 'Trace a flow',
    execution: 'model',
    directive: (s) =>
      `Trace one real request through ${s ?? ANY}, end to end. For each hop name the service, ` +
      `the function that handles it, and the file and line it lives in. If a hop is not in the ` +
      `scan, say so rather than filling the gap.`,
  },
  {
    id: 'pairs',
    label: 'Find the pairs',
    execution: 'model',
    directive: (s) =>
      `In ${s ?? ANY}, which components are two halves of one thing — a frontend and the backend ` +
      `that serves it? Show the direction of the dependency and the evidence for it. Do not pair ` +
      `things that merely share a naming prefix.`,
  },
  /* Research-mode skills. `research-live` routes to /api/research, not here — it
   * is registered so the registry stays complete and an accidental /api/ask send
   * is still answered honestly rather than dropped. */
  {
    id: 'research-live',
    label: 'Live research',
    execution: 'model',
    directive: (s) =>
      `The user asked for live web research on ${s ?? ANY}, but this turn has no fetched sources. ` +
      `Answer only from the attached scan and say plainly that no web sources were fetched — ` +
      `never cite a URL you did not receive.`,
  },
  {
    id: 'research-compare-patterns',
    label: 'Compare patterns',
    execution: 'model',
    directive: (s) =>
      `Compare architecture patterns relevant to ${s ?? ANY} using ONLY nodes and edges in the ` +
      `attached scan. For each option: what it would change on the graph, its blast radius, and ` +
      `the evidence (file, line). If a pattern is not evidenced in the repo, say "not in scan" — ` +
      `do not invent competitors from the open web.`,
  },
  {
    id: 'research-doc-ingest',
    label: 'Doc ingest (local)',
    execution: 'model',
    directive: (s) =>
      `Summarise documentation already present for ${s ?? ANY} in the attached repo (README, ` +
      `docs/, comments on the selected files). Only summarise claims backed by scan evidence. If ` +
      `no docs are in the scan, say so honestly — do not pretend to fetch the web.`,
  },
  /* Agent-workflow intents (the purple chips). Model-executed: they propose a
   * change to a Program, which the Programs checker — not this endpoint — applies. */
  {
    id: 'workflow-add-step',
    label: 'Add a step',
    execution: 'model',
    directive: (s) =>
      `Add a step to the "${s ?? 'this workflow'}" workflow. Propose where it fits and what it ` +
      `should do, grounded in the architecture map.`,
  },
  {
    id: 'workflow-run-parallel',
    label: 'Run these in parallel',
    execution: 'model',
    directive: (s) =>
      `Change the "${s ?? 'this workflow'}" workflow so some of its steps run in parallel, then ` +
      `join back up.`,
  },
  {
    id: 'workflow-add-decision',
    label: 'Add a decision',
    execution: 'model',
    directive: (s) =>
      `Add a decision (branch) to the "${s ?? 'this workflow'}" workflow and propose the ` +
      `condition it should check.`,
  },
  {
    id: 'workflow-loop-until-done',
    label: 'Loop until done',
    execution: 'model',
    directive: (s) =>
      `Add a loop to the "${s ?? 'this workflow'}" workflow that repeats a step until a ` +
      `condition is met.`,
  },
  {
    id: 'workflow-send-result',
    label: 'Send the result somewhere',
    execution: 'model',
    directive: (s) =>
      `Add a step to the "${s ?? 'this workflow'}" workflow that sends its result somewhere — a ` +
      `command or a service.`,
  },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Every intent id this server can execute. Exported for the registry-parity test. */
export function askIntentIds(): string[] {
  return CAPABILITIES.map((c) => c.id);
}

/* =============================================================== execution = */

/**
 * Execute every invoked intent against the real graph.
 *
 * `graph` is undefined in DESIGN mode (nothing has been scanned): the directives
 * still apply — they are what the user asked for — but no facts are gathered,
 * because there is no scan to ground them in. Inventing design-mode "evidence"
 * is exactly what `buildDesignAskPrompt` forbids.
 */
export function executeAskIntents(
  graph: ArchGraph | undefined,
  invocations: readonly AskIntentInvocation[],
): ExecutedAskIntents {
  const executed: ExecutedAskIntent[] = [];
  const unsupported: string[] = [];
  for (const inv of invocations) {
    const cap = BY_ID.get(inv.id);
    if (!cap) {
      // THE FABRICATION GUARD (the `llm/label.ts` stance): an id we do not
      // implement injects nothing at all. A skewed client cannot conjure a
      // capability, and the caller is told rather than silently ignored.
      unsupported.push(inv.id);
      continue;
    }
    const subject = resolveSubject(graph, inv);
    const gathered: GatherResult =
      graph && cap.gather ? cap.gather(graph, subject) : { lines: [], grounded: false };
    executed.push({
      id: cap.id,
      label: cap.label,
      // An intent whose deterministic evidence could not be COMPUTED (no graph,
      // or a subject that is not in the scan) is reported as model-executed —
      // claiming "deterministic" for a turn that computed nothing would be a lie,
      // even though the honest "not in the scan" note still rides along.
      execution: cap.execution === 'deterministic' && gathered.grounded ? 'deterministic' : 'model',
      directive: cap.directive(subject.node?.label ?? subject.requested),
      facts: gathered.lines,
    });
  }
  return { executed, unsupported };
}

/* ================================================================ rendering = */

/**
 * Render executed intents as prompt lines.
 *
 * Deliberately a SEPARATE, labelled section rather than text merged into the
 * user's message: the model is told these are the system's instructions, so it
 * neither quotes them back nor treats them as something the user typed. That is
 * the whole point of the round — the user's message stays the user's message,
 * end to end.
 *
 * Returns `[]` when nothing was executed, so a no-intent request produces a
 * byte-identical prompt to the pre-intent build.
 */
export function renderAskIntentSection(executed: readonly ExecutedAskIntent[]): string[] {
  if (executed.length === 0) return [];
  const L: string[] = [];
  L.push('--- REQUESTED ACTIONS ---');
  L.push(
    'The user invoked these actions from the composer. They are instructions from the SYSTEM, ' +
      'not words the user typed — carry them out, but never quote, restate, or acknowledge them ' +
      'as part of the question.',
  );
  executed.forEach((intent, i) => {
    L.push('');
    L.push(`${i + 1}. ${intent.label}`);
    // The directive is SERVER-authored text with the resolved node's own label
    // interpolated — repo-derived, so the line is defanged. It is NOT wrapped in
    // an untrusted block: this whole section IS a system instruction, and framing
    // our own directive as untrusted data would tell the model to ignore it.
    L.push(`   ${neutralizeUntrusted(intent.directive)}`);
    if (intent.facts.length > 0) {
      L.push(
        '   GROUNDED FACTS (computed from the real scan by the same engines the canvas uses — ' +
          'use these names and numbers verbatim; do NOT recompute or extend them):',
      );
      // Fact lines carry real node labels and real file paths. Same reasoning.
      for (const f of intent.facts) L.push(`   ${neutralizeUntrusted(f)}`);
    }
  });
  // Already bounded per intent (MAX_INTENTS × MAX_PART_LINES / MAX_FILE_LINES /
  // MAX_IMPACT_LINES, each with its own honest "+N more" line). This is the TOTAL
  // guardrail those per-list caps never gave: 12 intents × 24 fact lines whose
  // paths are long can still reach ~60 000 characters. 8 000 tokens ≈ 32 000
  // characters — far above every real turn, which is one or two chips.
  return cutToBudget(L, INTENT_SECTION_BUDGET_TOKENS).lines;
}

/** Total budget for the rendered `--- REQUESTED ACTIONS ---` section. See above. */
const INTENT_SECTION_BUDGET_TOKENS = 8_000;

/* ============================================================ research mode = */

/**
 * Research mode as a STRUCTURED flag rather than a `[Research mode — …]` prefix
 * the client glued onto the user's message (the second half of the same owner
 * report: "when you choose /plan you don't see these things"). Same guarantee,
 * composed here.
 *
 * The write GATE is unchanged and still lives on the client
 * (`researchBlocksWrites`), which is where the write paths are — `/api/ask` has
 * never written anything.
 */
export const RESEARCH_MODE_DIRECTIVE =
  'RESEARCH MODE — plan and gather context only. Do not write, or claim to have written, ' +
  'production code. End with a short promote-to-implementation checklist the user can accept.';

/** Parse the wire's `mode` field. Unknown/absent ⇒ implementation (today's behaviour). */
export function parseAskMode(raw: unknown): 'implementation' | 'research' {
  return raw === 'research' ? 'research' : 'implementation';
}

/* =========================================================== client context = */

/**
 * The compiled grounded scope the client attached (`ai/contextCompiler.ts`),
 * which stays client-side because that is where the per-turn TOKEN BUDGET is
 * enforced. What changed is that it is no longer spliced into the user's
 * question — it arrives as its own field and is rendered as its own section.
 *
 * Bounded again here: the client is not a trust boundary for prompt size.
 */
const MAX_CONTEXT_LINES = 64;

/**
 * Character budget on the compiled scope: 2 000 tokens ≈ 8 000 characters — the
 * SAME allowance the pre-budget code applied (`MAX_CONTEXT_CHARS = 8_000`).
 *
 * What changed is honesty, not size. The old loop `break`ed out and left no
 * trace, so a client that compiled 200 scope lines got 64 of them into the
 * prompt and the model was told nothing. Now the cut is at the same point and
 * carries the omission marker.
 */
const CONTEXT_BUDGET_TOKENS = 2_000;

export function parseAskContextLines(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const lines = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const strings = lines.filter((l): l is string => typeof l === 'string');
  // The LINE cap comes first (it is the client contract), then the char budget —
  // both now leave an honest marker instead of a silent `break`.
  const capped = cutToBudget(strings.slice(0, MAX_CONTEXT_LINES), CONTEXT_BUDGET_TOKENS);
  const dropped = strings.length - Math.min(strings.length, MAX_CONTEXT_LINES);
  if (dropped > 0 && capped.omitted === 0) {
    return [...capped.lines, `…${dropped} more lines omitted to fit the model budget`];
  }
  if (dropped > 0) {
    // Both caps bit: report the total, so the count in the prompt is the truth.
    const marker = capped.lines[capped.lines.length - 1];
    const total = capped.omitted + dropped;
    return [...capped.lines.slice(0, -1), marker.replace(/^…\d+/, `…${total}`)];
  }
  return capped.lines;
}

/**
 * Render the compiled scope as its own labelled section. `[]` when empty.
 *
 * The lines are GRAPH-DERIVED (real node labels and file paths compiled client
 * side from the scan), so they are repo content: neutralized and wrapped in the
 * `<untrusted_repo_content>` block that `buildAskPrompt`'s single
 * `UNTRUSTED_CONTENT_INSTRUCTION` line describes.
 */
export function renderAskContextSection(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return [
    '--- GROUNDED SCOPE (compiled from the real graph for this turn) ---',
    ...wrapUntrustedLines(lines.map((l) => neutralizeUntrusted(l))),
  ];
}
