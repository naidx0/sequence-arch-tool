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

/** JSON-schema fragments fed to the provider tool list when AI Canvas is active. */
export const CANVAS_TOOL_SCHEMAS: Record<CanvasToolName, object> = {
  'canvas.write_markdown': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional block heading' },
      content: { type: 'string', description: 'Markdown body' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_mermaid': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional diagram title' },
      content: { type: 'string', description: 'Mermaid source' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_html': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional frame title' },
      content: { type: 'string', description: 'Sandboxed HTML (Graphite tokens)' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_react': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional component title' },
      content: { type: 'string', description: 'TSX source for bounded preview mount' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  'canvas.write_svg': {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional diagram title' },
      content: { type: 'string', description: 'SVG markup (no script)' },
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
 */
export function executeCanvasWrite(
  name: CanvasToolName,
  args: Record<string, unknown> | undefined,
  blockId?: string,
): CanvasWriteResult {
  const content = asString(args?.content);
  if (!content) {
    return { ok: false, evidence: `refused: ${name} missing "content"` };
  }
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
  return {
    ok: true,
    block,
    evidence: label,
    content:
      `Wrote ${block.type} block to AI Canvas` +
      (title ? ` ("${title}")` : '') +
      ` — ${content.length} chars.`,
  };
}
