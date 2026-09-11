/**
 * SURFACE CONTEXT — what the user is actually looking at when they ask.
 *
 * ================================ WHY THIS EXISTS ==========================
 * Owner, verbatim (AAA_FIXES E2, residual G5): *"I sent that workbook flow
 * thing, and it looks confusing itself."* He was on the **Agents** surface,
 * looking at one of Sequence's own agent workflows, and asked the assistant
 * about "this workflow". The assistant searched the scanned REPOSITORY for
 * workflow files and answered that the digest contains "no workflow definitions
 * (no CI/CD pipeline, no BPMN…)" — a perfectly grounded answer to a question
 * nobody asked.
 *
 * The bug was not the copy. It was that the only thing the assistant knew about
 * the user's screen was the graph SELECTION. "This workflow", "this board",
 * "what am I looking at" were therefore resolved against the only noun the
 * server had: the repo. So the composer now carries the ACTIVE SURFACE, and —
 * when the surface has one — the object focused on it (the Program being
 * viewed, its step count, the selected component, the open file).
 *
 * ================================= WHAT IT DOES ============================
 *   1. {@link parseAskSurface} strictly parses and bounds the wire field.
 *   2. {@link answerSurfaceQuestion} answers a DEICTIC question about a
 *      Sequence workflow DETERMINISTICALLY, off the Program the client sent —
 *      no provider call, so it works with no key and no network (local-first),
 *      and it cannot drift from what is on screen.
 *   3. {@link renderAskSurfaceSection} states the surface plainly in the prompt
 *      for every other turn, so the model stops guessing which noun "this" is.
 *
 * ================================ HONESTY GUARDS ===========================
 *   - NOTHING is invented. Every line below is built from fields the client
 *     read out of real workspace state; a surface with no focus produces no
 *     focus copy, and an absent `surface` field produces NO lines at all —
 *     the pre-surface prompt, byte for byte.
 *   - The deterministic answer only fires when there really is a workflow with
 *     real steps to describe. Otherwise the turn takes the normal model path
 *     with the surface merely STATED.
 *   - Titles are repo/user text interpolated into our own instruction lines, so
 *     they are defanged with `neutralizeUntrusted` exactly like the intent
 *     directives are.
 *
 * PURE + DOM-free + provider-free.
 */

import { neutralizeUntrusted } from '../llm/untrusted.js';

/* ============================================================== the wire === */

/**
 * The workspace surfaces the assistant can be told about. Wire ids are stable
 * for ask clients (Whiteboard still uses `task-board`); web2 maps chrome to
 * these ids via `workspaceAskSurface`. Anything else is not a surface a
 * question can point at and is simply not sent.
 */
export const ASK_SURFACE_IDS = [
  'architecture',
  'agents',
  'task-board',
  'terminal',
  'localhost',
  'settings',
  'editor',
  'design',
  'domain',
  'scratch',
  'ai-canvas',
] as const;

export type AskSurfaceId = (typeof ASK_SURFACE_IDS)[number];

/** One step of the workflow on screen — the Program's own node, nothing added. */
export interface AskSurfaceStep {
  title: string;
  kind: string;
}

/** The object focused on the active surface, when the surface has one. */
export interface AskSurfaceFocus {
  /** What sort of thing it is — decides how the answer talks about it. */
  kind: 'workflow' | 'component' | 'file';
  /** Its real name as the user sees it on screen. */
  title: string;
  /** Workflow only: how many steps the Program really has. */
  nodeCount?: number;
  /** Workflow only: how many connections between those steps. */
  edgeCount?: number;
  /** Workflow only: the steps themselves, in the Program's own order. */
  steps?: AskSurfaceStep[];
}

/** What the user is looking at, as it arrives on the `/api/ask` wire. */
export interface AskSurfaceContext {
  id: AskSurfaceId;
  /** The tab's own title, when it differs from the surface's generic name. */
  title?: string;
  focus?: AskSurfaceFocus;
}

/* ============================================================== validation = */

const MAX_TITLE_CHARS = 160;
const MAX_STEPS = 40;
const MAX_KIND_CHARS = 40;
/** Steps past {@link MAX_STEPS} are reported as a count, never silently dropped. */

function cleanString(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function parseCount(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw < 0) return undefined;
  return Math.floor(raw);
}

/**
 * Strictly parse the wire's `surface` field.
 *
 * Absent/null ⇒ `{}` (the legacy request shape — the payload and prompt stay
 * byte-identical). PRESENT but malformed ⇒ `{ error }`, so a client bug surfaces
 * as a 400 instead of the assistant quietly guessing the noun again. That is the
 * same stance `parseAskIntents` takes, for the same reason.
 */
export function parseAskSurface(
  raw: unknown,
): { surface?: AskSurfaceContext } | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '"surface" must be an object when present' };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.trim() === '') {
    return { error: '"surface" needs a non-empty string "id"' };
  }
  const id = o.id.trim();
  if (!(ASK_SURFACE_IDS as readonly string[]).includes(id)) {
    return { error: `"surface.id" must be one of: ${ASK_SURFACE_IDS.join(', ')}` };
  }
  const ctx: AskSurfaceContext = { id: id as AskSurfaceId };
  const title = cleanString(o.title, MAX_TITLE_CHARS);
  if (title !== '') ctx.title = title;

  const rawFocus = o.focus;
  if (rawFocus !== undefined && rawFocus !== null) {
    if (typeof rawFocus !== 'object' || Array.isArray(rawFocus)) {
      return { error: '"surface.focus" must be an object when present' };
    }
    const f = rawFocus as Record<string, unknown>;
    const kind = typeof f.kind === 'string' ? f.kind.trim() : '';
    if (kind !== 'workflow' && kind !== 'component' && kind !== 'file') {
      return { error: '"surface.focus.kind" must be one of: workflow, component, file' };
    }
    const focusTitle = cleanString(f.title, MAX_TITLE_CHARS);
    // A focus with no name names nothing. Dropping it is honest; inventing a
    // placeholder ("the selected item") would put a noun on screen that is not there.
    if (focusTitle !== '') {
      const focus: AskSurfaceFocus = { kind, title: focusTitle };
      const nodeCount = parseCount(f.nodeCount);
      if (nodeCount !== undefined) focus.nodeCount = nodeCount;
      const edgeCount = parseCount(f.edgeCount);
      if (edgeCount !== undefined) focus.edgeCount = edgeCount;
      if (Array.isArray(f.steps)) {
        const steps: AskSurfaceStep[] = [];
        for (const s of f.steps.slice(0, MAX_STEPS)) {
          if (!s || typeof s !== 'object') continue;
          const st = s as Record<string, unknown>;
          const stepTitle = cleanString(st.title, MAX_TITLE_CHARS);
          if (stepTitle === '') continue;
          steps.push({ title: stepTitle, kind: cleanString(st.kind, MAX_KIND_CHARS) || 'step' });
        }
        if (steps.length > 0) focus.steps = steps;
      }
      ctx.focus = focus;
    }
  }
  return { surface: ctx };
}

/* ================================================================ deixis === */

/**
 * Does the question point AT THE SCREEN rather than at the repository?
 *
 * Deliberately narrow and literal. Every alternative below is a phrase whose
 * referent is something visible — "this workflow", "this board", "what am I
 * looking at". A broad heuristic ("any question containing 'this'") would start
 * hijacking ordinary repo questions ("does this repo use redis?"), which is the
 * mirror image of the bug being fixed.
 */
const DEICTIC =
  /\bthis\s+(workflow|work\s?flow|workbook|program|agent|agents|board|task\s?board|canvas|diagram|screen|page|tab|surface|view|graph|terminal|preview)\b|\bwhat\s+(?:am\s+i|are\s+we)\s+(?:looking\s+at|seeing|on)\b|\bwhat(?:'s|’s|s|\s+is)\s+(?:this|on\s+(?:my|the)\s+screen)\b|\bexplain\s+this\b/i;

export function isDeicticSurfaceQuestion(question: string): boolean {
  return DEICTIC.test(question);
}

/* ============================================================== the copy === */

/** Plain-English name for each surface — what the user calls it in the app. */
const SURFACE_NAMES: Record<AskSurfaceId, string> = {
  architecture: 'the Architecture canvas (the grounded architecture graph of the scanned repo)',
  agents: "the Agents surface (Sequence's own runnable agent workflows)",
  /* Wire id stays `task-board` for ask clients; copy must name Whiteboard only. */
  'task-board': 'the Whiteboard (freehand / generate)',
  terminal: 'the Terminal surface (not shipped in web2 yet)',
  localhost: 'the Localhost preview (embedded browser — not shipped in web2 yet)',
  settings: 'the Settings page',
  editor: 'a file editor tab',
  design: 'the Design surface (a from-scratch system the user is drawing)',
  domain: 'the Domain-model surface (entities and their relationships)',
  scratch: 'the Scratch pad',
  'ai-canvas':
    'the AI Canvas (typed artifact blocks — markdown, mermaid, HTML, React, SVG — via native tool writers)',
};

/** Which surfaces are SEQUENCE'S OWN objects rather than the scanned repo. */
const OWN_SURFACES: ReadonlySet<AskSurfaceId> = new Set<AskSurfaceId>([
  'agents',
  'task-board',
  'ai-canvas',
  'design',
  'domain',
  'scratch',
  'settings',
]);

function focusLine(focus: AskSurfaceFocus): string {
  if (focus.kind === 'workflow') {
    const counts: string[] = [];
    if (focus.nodeCount !== undefined) counts.push(`${focus.nodeCount} step(s)`);
    if (focus.edgeCount !== undefined) counts.push(`${focus.edgeCount} connection(s)`);
    const tail = counts.length > 0 ? ` — ${counts.join(', ')}` : '';
    return `The workflow open on it is "${focus.title}"${tail}.`;
  }
  if (focus.kind === 'file') return `The file open on it is ${focus.title}.`;
  return `The component selected on it is "${focus.title}".`;
}

/**
 * Render the surface as its own labelled prompt section. `[]` when there is no
 * surface context, so a request without the field builds the same prompt it
 * always did.
 *
 * `deictic` is passed in rather than re-derived so the caller decides once, and
 * the extra disambiguation sentence appears exactly when the user's words point
 * at the screen.
 */
export function renderAskSurfaceSection(
  surface: AskSurfaceContext | undefined,
  deictic: boolean,
): string[] {
  if (!surface) return [];
  const L: string[] = ['--- WHAT THE USER IS LOOKING AT ---'];
  const named = surface.title ? ` (tab: "${surface.title}")` : '';
  L.push(`The user is on ${SURFACE_NAMES[surface.id]}${named}.`);
  if (surface.focus) L.push(focusLine(surface.focus));
  if (surface.focus?.kind === 'workflow' && surface.focus.steps?.length) {
    L.push('Its steps, in order:');
    for (const s of surface.focus.steps) L.push(`- ${s.title} (${s.kind})`);
    const total = surface.focus.nodeCount;
    if (total !== undefined && total > surface.focus.steps.length) {
      L.push(`- (+${total - surface.focus.steps.length} more step(s) not listed here)`);
    }
  }
  if (deictic && OWN_SURFACES.has(surface.id)) {
    L.push(
      'The question uses a pointing phrase ("this workflow", "this board", "what am I looking ' +
        'at"). It refers to THIS surface — an object inside Sequence, described above — not to ' +
        'files in the scanned repository. Do NOT go looking in the repo for CI/CD pipelines, ' +
        'BPMN files, or workflow definitions, and do NOT answer that the repository contains no ' +
        'workflows. Answer about what is on screen.',
    );
  }
  L.push(
    'This section describes the app window, not the repository. Never claim anything about the ' +
      'surface that is not stated here.',
  );
  return L.map((l) => neutralizeUntrusted(l));
}

/* ==================================================== deterministic answer = */

/**
 * The answer to "what is this workflow?", assembled from the Program itself.
 *
 * Returns `undefined` unless there is genuinely something to describe: a
 * pointing question, a Sequence-owned surface, and a focused workflow with real
 * steps. When it DOES return, the caller answers with it and never calls the
 * provider — the same stance `askIntents` takes for `impact` / `break-down`.
 * That keeps this working with no key and no network, and makes it impossible
 * for the answer to disagree with the canvas.
 */
export function answerSurfaceQuestion(
  surface: AskSurfaceContext | undefined,
  question: string,
): string | undefined {
  if (!surface) return undefined;
  if (!isDeicticSurfaceQuestion(question)) return undefined;
  const focus = surface.focus;
  if (surface.id !== 'agents' || !focus || focus.kind !== 'workflow') return undefined;
  const steps = focus.steps ?? [];
  if (steps.length === 0) return undefined;

  const nodeCount = focus.nodeCount ?? steps.length;
  const L: string[] = [];
  L.push(
    `You are on the **Agents** surface, looking at **${focus.title}** — one of Sequence's own ` +
      `agent workflows, not something found in the repository you scanned.`,
  );
  L.push('');
  L.push(
    `It has ${nodeCount} step(s)` +
      (focus.edgeCount !== undefined ? ` and ${focus.edgeCount} connection(s)` : '') +
      ', in this order:',
  );
  steps.forEach((s, i) => L.push(`${i + 1}. **${s.title}** — ${s.kind}`));
  if (nodeCount > steps.length) {
    L.push(`…and ${nodeCount - steps.length} more step(s) not listed here.`);
  }
  L.push('');
  L.push(
    'Run it with **Run** on the Agents tab; edit it by dragging a step or using the `+` actions ' +
      'in the composer (Add a step, Add a decision, Run these in parallel, Loop until done, Send ' +
      'the result somewhere).',
  );
  L.push('');
  L.push(
    'Read straight off the workflow on screen — no model call, so nothing here is guessed.',
  );
  return L.join('\n');
}
