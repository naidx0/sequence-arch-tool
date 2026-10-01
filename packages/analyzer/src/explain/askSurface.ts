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

/** The five block types the AI Canvas renders — the writer set, closed. */
export const CANVAS_BLOCK_TYPES = ['markdown', 'mermaid', 'html', 'react', 'svg'] as const;
export type AskSurfaceCanvasBlockType = (typeof CANVAS_BLOCK_TYPES)[number];

/** One block already on the AI Canvas, as the agent is allowed to see it. */
export interface AskSurfaceCanvasBlock {
  id: string;
  type: AskSurfaceCanvasBlockType;
  title?: string;
  chars: number;
  excerpt?: string;
}

/**
 * WHAT IS ALREADY DRAWN — the read half of the canvas protocol.
 *
 * `docs/research/agent-drawing-and-teaching-visuals.md` §3, measured there:
 * "What Sequence does not have is the READ half — the agent cannot see what is
 * on the canvas, in any resolution, ever." Every `canvas.write_*` therefore
 * appended a new block, because appending is the only thing you can do to a
 * document you cannot read. Asking for a change to the diagram got a second
 * diagram.
 *
 * PORTED AS PROMPT PARTS, NOT AS A TOOL, which is what tldraw's template
 * actually does and is the cheaper design besides: the canvas lives in the
 * client's session store and the server holds none of it, so a `canvas.read`
 * tool would have had to round-trip to the browser mid-turn for state the
 * request could simply have carried. Two resolutions rather than tldraw's
 * three — "peripheral" is a viewport concept and the AI Canvas has no camera.
 */
export interface AskSurfaceCanvas {
  blocks: AskSurfaceCanvasBlock[];
  /** Blocks past the cap — a count, never a silent drop. */
  omitted?: number;
}

/** The item kinds a whiteboard document holds (`whiteboardModel.ts`). */
export const BOARD_ITEM_KINDS = ['stroke', 'shape', 'text', 'noderef'] as const;
export type AskSurfaceBoardItemKind = (typeof BOARD_ITEM_KINDS)[number];

/** One item already on the whiteboard, as the agent is allowed to see it. */
export interface AskSurfaceBoardItem {
  /** The item's real id — the only id a revision or a connection may name. */
  id: string;
  kind: AskSurfaceBoardItemKind;
  /** The words on it, when it has any. A stroke has none. */
  label?: string;
  /** Where it sits, rounded — the agent places things NEAR other things. */
  at?: { x: number; y: number };
  /** Present only on a `noderef`: the scanned node this item stands for. */
  nodeId?: string;
}

/**
 * WHAT IS ALREADY DRAWN ON THE WHITEBOARD.
 *
 * The same hole the AI Canvas had until this week, on the other spatial
 * surface: `packages/web2/src/whiteboard/` has had a camera, a document, an
 * edit vocabulary and fifty frames of undo since it was written, and
 * `grep` for it across `packages/analyzer/` returns two comment mentions and no
 * code. The agent could not see the board and could not draw on it.
 *
 * POSITIONS ARE CARRIED, which is the one way this differs from the canvas's
 * read half. The AI Canvas is a document — blocks are an ordered list and
 * "where" is meaningless. A whiteboard is SPATIAL: "put the cache next to the
 * database" is an instruction that cannot be followed by an agent that knows
 * only what exists, and an agent that places every new item at the origin draws
 * a pile rather than a diagram. Rounded to whole units because a board
 * coordinate's sub-pixel precision is noise in a prompt.
 */
export interface AskSurfaceBoard {
  items: AskSurfaceBoardItem[];
  /** Items past the cap — a count, never a silent drop. */
  omitted?: number;
}

/** What the user is looking at, as it arrives on the `/api/ask` wire. */
export interface AskSurfaceContext {
  id: AskSurfaceId;
  /** The tab's own title, when it differs from the surface's generic name. */
  title?: string;
  focus?: AskSurfaceFocus;
  /** AI Canvas only: the blocks already on it. */
  canvas?: AskSurfaceCanvas;
  /** Whiteboard only: the items already drawn on it. */
  board?: AskSurfaceBoard;
}

/* ============================================================== validation = */

const MAX_TITLE_CHARS = 160;
const MAX_STEPS = 40;
const MAX_KIND_CHARS = 40;
/**
 * Caps on the canvas part of the prompt.
 *
 * 24 blocks at one line each is about 300 tokens — the blurry pass is cheap by
 * construction, which is the point of having one. The excerpt is the expensive
 * half, so exactly one block gets it and it is capped at 1 500 characters:
 * enough to recognise a mermaid graph or an SVG's structure, nowhere near
 * enough to pay for a whole 120k-byte HTML block (`CANVAS_BLOCK_PAYLOAD_CAP`).
 */
const MAX_CANVAS_BLOCKS = 24;
/*
 * The board's cap is higher than the canvas's because the unit is smaller: a
 * canvas block is a whole document, a board item is one shape. Forty is about
 * 500 tokens at one line each, and a sketch with more than forty things on it
 * is one the agent should be asking about rather than enumerating.
 */
const MAX_BOARD_ITEMS = 40;
const MAX_CANVAS_ID_CHARS = 120;
const MAX_CANVAS_EXCERPT_CHARS = 1_500;
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

  const rawBoard = o.board;
  if (rawBoard !== undefined && rawBoard !== null) {
    const parsed = parseSurfaceBoard(rawBoard);
    if ('error' in parsed) return parsed;
    if (parsed.board.items.length > 0) ctx.board = parsed.board;
  }

  const rawCanvas = o.canvas;
  if (rawCanvas !== undefined && rawCanvas !== null) {
    const parsed = parseSurfaceCanvas(rawCanvas);
    if ('error' in parsed) return parsed;
    if (parsed.canvas.blocks.length > 0) ctx.canvas = parsed.canvas;
  }
  return { surface: ctx };
}

/**
 * Parse the whiteboard items the client says are on screen.
 *
 * Same stance as everything else here: absent is fine, malformed is a 400, and
 * an item without a usable ID IS DROPPED AND COUNTED rather than listed. On this
 * surface that rule is sharper than on the canvas: an id here is not only an
 * edit target, it is a CONNECTION endpoint. `board.connect` refuses an endpoint
 * the caller was not told about, so listing an item under an id that does not
 * exist would manufacture a refusal the model could not diagnose.
 */
function parseSurfaceBoard(raw: unknown): { board: AskSurfaceBoard } | { error: string } {
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '"surface.board" must be an object when present' };
  }
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.items)) {
    return { error: '"surface.board.items" must be an array' };
  }
  const items: AskSurfaceBoardItem[] = [];
  for (const entry of b.items) {
    if (items.length >= MAX_BOARD_ITEMS) break;
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = cleanString(o.id, MAX_CANVAS_ID_CHARS);
    if (id === '') continue;
    const kind = typeof o.kind === 'string' ? o.kind.trim() : '';
    if (!(BOARD_ITEM_KINDS as readonly string[]).includes(kind)) continue;
    const item: AskSurfaceBoardItem = { id, kind: kind as AskSurfaceBoardItemKind };
    const label = cleanString(o.label, MAX_TITLE_CHARS);
    if (label !== '') item.label = label;
    const at = o.at;
    if (at !== null && typeof at === 'object' && !Array.isArray(at)) {
      const pt = at as { x?: unknown; y?: unknown };
      if (typeof pt.x === 'number' && Number.isFinite(pt.x) &&
          typeof pt.y === 'number' && Number.isFinite(pt.y)) {
        /* Rounded: a board coordinate's sub-pixel precision is noise in a
           prompt, and six decimals per item is real tokens for no meaning. */
        item.at = { x: Math.round(pt.x), y: Math.round(pt.y) };
      }
    }
    const nodeId = cleanString(o.nodeId, MAX_CANVAS_ID_CHARS);
    if (nodeId !== '') item.nodeId = nodeId;
    items.push(item);
  }
  const board: AskSurfaceBoard = { items };
  const declared = parseCount(b.omitted);
  const dropped = Math.max(0, (Array.isArray(b.items) ? b.items.length : 0) - items.length);
  const omitted = (declared ?? 0) + dropped;
  if (omitted > 0) board.omitted = omitted;
  return { board };
}

/**
 * THE SAME STANCE AS THE REST OF THIS FILE: absent is fine, malformed is a 400.
 *
 * A block whose id or type the client garbled is dropped rather than guessed —
 * but an `id` is the one field a revision will name back at us, so a block
 * without a usable one cannot be listed at all. Listing it with an invented id
 * would hand the model a handle that does not open anything, which is the
 * grounding law with the subject changed.
 */
function parseSurfaceCanvas(raw: unknown): { canvas: AskSurfaceCanvas } | { error: string } {
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '"surface.canvas" must be an object when present' };
  }
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.blocks)) {
    return { error: '"surface.canvas.blocks" must be an array' };
  }
  const blocks: AskSurfaceCanvasBlock[] = [];
  for (const entry of c.blocks) {
    if (blocks.length >= MAX_CANVAS_BLOCKS) break;
    if (!entry || typeof entry !== 'object') continue;
    const b = entry as Record<string, unknown>;
    const id = cleanString(b.id, MAX_CANVAS_ID_CHARS);
    if (id === '') continue;
    const type = typeof b.type === 'string' ? b.type.trim() : '';
    if (!(CANVAS_BLOCK_TYPES as readonly string[]).includes(type)) continue;
    const chars = parseCount(b.chars);
    const block: AskSurfaceCanvasBlock = {
      id,
      type: type as AskSurfaceCanvasBlockType,
      chars: chars ?? 0,
    };
    const title = cleanString(b.title, MAX_TITLE_CHARS);
    if (title !== '') block.title = title;
    /* The excerpt keeps its own newlines — `cleanString` would flatten the one
       thing that makes mermaid source and SVG markup readable. */
    if (typeof b.excerpt === 'string' && b.excerpt.trim() !== '') {
      block.excerpt = b.excerpt.slice(0, MAX_CANVAS_EXCERPT_CHARS);
    }
    blocks.push(block);
  }
  const canvas: AskSurfaceCanvas = { blocks };
  const declared = parseCount(c.omitted);
  const dropped = Math.max(0, (Array.isArray(c.blocks) ? c.blocks.length : 0) - blocks.length);
  const omitted = (declared ?? 0) + dropped;
  if (omitted > 0) canvas.omitted = omitted;
  return { canvas };
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
  const canvasLines = renderCanvasStateLines(surface.canvas);
  const boardLines = renderBoardStateLines(surface.board);
  return [...L, ...canvasLines, ...boardLines].map((l) => neutralizeUntrusted(l));
}

/**
 * THE WHITEBOARD, WITH POSITIONS, AND THE ONE RULE THAT MAKES IT SAFE.
 *
 * The ids listed here are the ONLY ids a board edit or a `board.connect`
 * endpoint may name, and `boardTools` enforces that at the door — this says so
 * in the prompt too, because a refusal the model could have avoided is a wasted
 * round.
 *
 * POSITIONS ARE THE POINT OF THIS SURFACE. An agent that knows what exists but
 * not where it sits cannot honour "put the cache next to the database", and
 * places every new item at the origin — which draws a pile, not a diagram.
 *
 * Empty ⇒ NOTHING. A blank board is the default state, and a line on every ask
 * saying so is the permanent hedge `renderScanCoverageSection` exists to avoid.
 */
function renderBoardStateLines(board: AskSurfaceBoard | undefined): string[] {
  if (!board || board.items.length === 0) return [];
  const L: string[] = ['', '--- ALREADY ON THE WHITEBOARD ---'];
  for (const it of board.items) {
    const where = it.at ? ` at (${it.at.x}, ${it.at.y})` : '';
    const named = it.label ? ` "${it.label}"` : '';
    const grounded = it.nodeId ? ` → node \`${it.nodeId}\`` : '';
    L.push(`- id \`${it.id}\` · ${it.kind}${named}${where}${grounded}`);
  }
  if (board.omitted !== undefined && board.omitted > 0) {
    L.push(`- (+${board.omitted} more item(s) on the board, not listed here)`);
  }
  L.push(
    'These ids are the only ones that exist: name one to move, replace or connect it, and place ' +
      'new items in free space NEAR what they relate to rather than all at one point. A `noderef` ' +
      'stands for a REAL scanned node; a `text` or `shape` is a sketch and claims nothing about ' +
      'the repository. Any id not listed above is refused.',
  );
  return L;
}

/**
 * THE CANVAS, AT TWO RESOLUTIONS, AND THE ONE RULE THAT MAKES IT SAFE.
 *
 * Blurry for every block; focused for the one carrying an excerpt. The last
 * paragraph is the load-bearing one: the ids listed here are the ONLY ids a
 * `blockId` may name. `executeCanvasWrite` enforces that at the door — this
 * says so in the prompt as well, because a refusal the model could have avoided
 * is a wasted turn, and because "you may only cite what you were given" is the
 * same rule `propose_topology` already applies to node ids.
 *
 * Empty ⇒ NOTHING, not "the canvas is empty". A blank canvas is the default
 * state and a line saying so on every ask would be a permanent hedge — the
 * defect `renderScanCoverageSection` is written to avoid.
 */
function renderCanvasStateLines(canvas: AskSurfaceCanvas | undefined): string[] {
  if (!canvas || canvas.blocks.length === 0) return [];
  const L: string[] = ['', '--- ALREADY ON THE AI CANVAS ---'];
  for (const b of canvas.blocks) {
    const named = b.title ? ` "${b.title}"` : '';
    L.push(`- id \`${b.id}\` · ${b.type}${named} · ${b.chars} chars`);
    if (b.excerpt !== undefined) {
      L.push('  It begins:');
      for (const line of b.excerpt.split('\n')) L.push(`  | ${line}`);
    }
  }
  if (canvas.omitted !== undefined && canvas.omitted > 0) {
    L.push(`- (+${canvas.omitted} more block(s) on the canvas, not listed here)`);
  }
  L.push(
    'To CHANGE one of these rather than add another, call the matching `canvas.write_*` tool ' +
      'with `blockId` set to that block\'s id — it replaces that block in place. Omit `blockId` ' +
      'to add a new block. Only the ids listed above exist; any other id is refused, so never ' +
      'invent one, and never assume a block you cannot see here is on the canvas.',
  );
  return L;
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
