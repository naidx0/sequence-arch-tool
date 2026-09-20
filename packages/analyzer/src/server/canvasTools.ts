/**
 * AI Canvas — closed-set native tool writers.
 *
 * Contract: docs/research/ai-canvas-tool-contract.md
 */

import crypto from 'node:crypto';

export type CanvasToolName =
  | 'canvas.write_markdown'
  | 'canvas.write_mermaid'
  | 'canvas.write_html'
  | 'canvas.write_react'
  | 'canvas.write_svg';

export const CANVAS_TOOL_NAMES: readonly CanvasToolName[] = [
  'canvas.write_markdown',
  'canvas.write_mermaid',
  'canvas.write_html',
  'canvas.write_react',
  'canvas.write_svg',
];

export type CanvasBlockType = 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';

export interface CanvasBlock {
  id: string;
  type: CanvasBlockType;
  title?: string;
  payload: string;
  createdAt: string;
}

/**
 * THE FIELD THAT TURNS FIVE APPENDERS INTO FIVE EDITORS.
 *
 * `executeCanvasWrite` has always taken a `blockId` parameter and no caller
 * ever had one to pass, because nothing told the model which blocks existed —
 * the read half did not exist (`askSurface.ts`, AskSurfaceCanvas). With the
 * canvas now serialised into the prompt, a revision is a write that names the
 * block it replaces, and this is how it names it.
 *
 * Spelled into all five schemas rather than shared by reference: the provider
 * tool list is JSON on the wire, a shared object would be inlined five times
 * anyway, and one visible definition per tool is what a reader of this file
 * needs to see.
 */
const BLOCK_ID_PROPERTY = {
  type: 'string',
  description:
    'Optional. The id of an existing canvas block to REPLACE in place. Must be an id listed ' +
    'in "ALREADY ON THE AI CANVAS"; any other id is refused. Omit to add a new block.',
} as const;

/** JSON-schema fragments fed to the provider tool list when AI Canvas is active. */
export const CANVAS_TOOL_SCHEMAS: Record<CanvasToolName, object> = {
  'canvas.write_markdown': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional block heading' },
      content: { type: 'string', description: 'Markdown body' },
      blockId: BLOCK_ID_PROPERTY,
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_mermaid': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional diagram title' },
      content: { type: 'string', description: 'Mermaid source' },
      blockId: BLOCK_ID_PROPERTY,
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_html': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional frame title' },
      content: {
        type: 'string',
        description:
          'Sandboxed HTML. SCRIPTS RUN: a slider, a play button, a canvas animation or a ' +
          'keypress handler all work, and an interactive explanation beats a static one. The ' +
          'frame has a unique opaque origin and a Content-Security-Policy of default-src none, ' +
          'so there is NO network: fetch, XHR and WebSocket are blocked by design, and a remote ' +
          'script or web font renders an EMPTY BOX rather than an error. Everything the widget ' +
          'shows must be inline in this document. ANIMATION NEEDS NO SCRIPT AT ALL: an inline ' +
          '<style> with @keyframes is permitted by the policy (style-src unsafe-inline), so ' +
          'prefer it over a timer loop, and keep one cycle under about 4 seconds. Use Graphite ' +
          'CSS variables (var(--ink-1), var(--accent)) so it matches the theme.',
      },
      blockId: BLOCK_ID_PROPERTY,
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_react': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional component title' },
      content: { type: 'string', description: 'TSX source for bounded preview mount' },
      blockId: BLOCK_ID_PROPERTY,
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_svg': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional diagram title' },
      content: {
        type: 'string',
        description:
          'SVG markup. NO <script> — this one is inlined into the page rather than framed. ' +
          'IT MAY MOVE: SVG SMIL runs, so <animate>, <animateTransform> and <animateMotion> ' +
          'written inline are rendered, as is CSS @keyframes inside an inline <style>. Set a ' +
          'viewBox so it scales, label every edge, and colour from Graphite variables ' +
          '(var(--ink-1), var(--accent)) so it matches the theme. No remote images, fonts or ' +
          'xlink:href to anything off-document.',
      },
      blockId: BLOCK_ID_PROPERTY,
    },
    required: ['content'],
    additionalProperties: false,
  },
};

export function canvasBlockTypeForTool(name: CanvasToolName): CanvasBlockType {
  switch (name) {
    case 'canvas.write_markdown':
      return 'markdown';
    case 'canvas.write_mermaid':
      return 'mermaid';
    case 'canvas.write_html':
      return 'html';
    case 'canvas.write_react':
      return 'react';
    case 'canvas.write_svg':
      return 'svg';
  }
}

export function isCanvasToolName(name: string): name is CanvasToolName {
  return (CANVAS_TOOL_NAMES as readonly string[]).includes(name);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Operational canvas tools — not format writers (see ai-canvas-tool-contract.md). */
export const CANVAS_STORY_TOOL = 'canvas.set_story_route' as const;

export type CanvasStoryToolName = typeof CANVAS_STORY_TOOL;

export interface CanvasStoryRoutePayload {
  title: string;
  steps: Array<{ blockId: string; caption: string }>;
}

export interface CanvasStoryRouteResult {
  ok: boolean;
  evidence: string;
  storyRoute?: CanvasStoryRoutePayload;
}

export function executeCanvasStoryRoute(
  args: Record<string, unknown> | undefined,
): CanvasStoryRouteResult {
  const title = asString(args?.title);
  const stepsRaw = args?.steps;
  if (!title) {
    return { ok: false, evidence: 'refused: canvas.set_story_route missing "title"' };
  }
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, evidence: 'refused: canvas.set_story_route needs at least one step' };
  }
  const steps: CanvasStoryRoutePayload['steps'] = [];
  for (const entry of stepsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as { blockId?: unknown; caption?: unknown };
    if (typeof o.blockId === 'string' && typeof o.caption === 'string') {
      steps.push({ blockId: o.blockId, caption: o.caption });
    }
  }
  if (steps.length === 0) {
    return { ok: false, evidence: 'refused: canvas.set_story_route steps invalid' };
  }
  return {
    ok: true,
    evidence: `Set guided story "${title}" (${steps.length} steps)`,
    storyRoute: { title, steps },
  };
}

export const CANVAS_STORY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Story route title' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: 'Existing canvas block id' },
          caption: { type: 'string', description: 'Step label shown in the navigator' },
        },
        required: ['blockId', 'caption'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'steps'],
  additionalProperties: false,
} as const;

/** Max payload bytes per block — keeps SSE and DOM honest. */
export const CANVAS_BLOCK_PAYLOAD_CAP = 120_000;

export interface CanvasWriteResult {
  ok: boolean;
  evidence: string;
  content?: string;
  block?: CanvasBlock;
}

/**
 * Execute one AI Canvas native writer. Does not touch disk — blocks live in the
 * session store on the client via `canvas:block` SSE.
 *
 * `knownBlockIds` is what the CLIENT said was on the canvas this turn
 * (`surface.canvas`, rendered into the prompt as "ALREADY ON THE AI CANVAS").
 * A `blockId` outside that set is REFUSED rather than treated as a new block,
 * for the same reason `propose_topology` refuses an invented node id: a write
 * that silently becomes an append after failing to find its target leaves the
 * user looking at two diagrams and the model believing it edited one.
 *
 * The third parameter used to be a caller-supplied `blockId` that no caller
 * ever supplied — the read half did not exist, so nothing could know an id.
 * It is the same seam, now with something real on the other side of it.
 */
export function executeCanvasWrite(
  name: CanvasToolName,
  args: Record<string, unknown> | undefined,
  knownBlockIds?: readonly string[],
): CanvasWriteResult {
  const content = asString(args?.content);
  if (!content) {
    return { ok: false, evidence: `refused: ${name} missing "content"` };
  }
  const requestedId = asString(args?.blockId);
  if (requestedId !== undefined && !(knownBlockIds ?? []).includes(requestedId)) {
    return {
      ok: false,
      evidence:
        `refused: ${name} names blockId "${requestedId}", which is not on the canvas. ` +
        ((knownBlockIds ?? []).length === 0
          ? 'The canvas has no blocks — omit blockId to add one.'
          : `Existing block ids: ${(knownBlockIds ?? []).join(', ')}.`),
    };
  }
  const blockId = requestedId;
  if (Buffer.byteLength(content, 'utf8') > CANVAS_BLOCK_PAYLOAD_CAP) {
    return {
      ok: false,
      evidence: `refused: ${name} content exceeds ${CANVAS_BLOCK_PAYLOAD_CAP} bytes`,
    };
  }
  const title = asString(args?.title);
  const block: CanvasBlock = {
    id: blockId ?? crypto.randomUUID(),
    type: canvasBlockTypeForTool(name),
    ...(title ? { title } : {}),
    payload: content,
    createdAt: new Date().toISOString(),
  };
  const label = title ?? block.type;
  /* "Replaced" and "Wrote" are different facts and the trail must not blur
     them: the user sees one block change vs one block appear. */
  const verb = requestedId === undefined ? 'Wrote' : 'Replaced';
  return {
    ok: true,
    block,
    evidence: label,
    content:
      `${verb} ${block.type} block ${requestedId === undefined ? 'to' : 'on'} AI Canvas` +
      (title ? ` ("${title}")` : '') +
      ` — ${content.length} chars.`,
  };
}
