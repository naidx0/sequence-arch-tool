/**
 * SystemBoard writers — diagram.upsert / diagram.layout for SeqDraw.
 *
 * Model emits IR (no coordinates). Layout + materialize produce board wire items.
 */
import {
  validateSystemBoard,
  type SystemBoardV0,
  type SystemBoardLayoutProfile,
  SYSTEM_BOARD_LAYOUT_PROFILES,
} from '@sequence/schema';

import type { BoardItem, BoardKnown } from './boardTools.js';
import { materializeSystemBoard } from './diagramMaterialize.js';

export type DiagramToolName = 'diagram.upsert' | 'diagram.layout' | 'diagram.delete';

export const DIAGRAM_TOOL_NAMES: readonly DiagramToolName[] = [
  'diagram.upsert',
  'diagram.layout',
  'diagram.delete',
];

export function isDiagramToolName(name: string): name is DiagramToolName {
  return (DIAGRAM_TOOL_NAMES as readonly string[]).includes(name);
}

export const DIAGRAM_TOOL_SCHEMAS: Record<DiagramToolName, object> = {
  'diagram.upsert': {
    type: 'object',
    properties: {
      title: { type: 'string' },
      layoutProfile: { type: 'string', enum: [...SYSTEM_BOARD_LAYOUT_PROFILES] },
      nodes: { type: 'array' },
      edges: { type: 'array' },
      issues: { type: 'array' },
    },
    required: ['layoutProfile', 'nodes'],
  },
  'diagram.layout': {
    type: 'object',
    properties: {
      layoutProfile: { type: 'string', enum: [...SYSTEM_BOARD_LAYOUT_PROFILES] },
      respectPins: { type: 'boolean' },
    },
  },
  'diagram.delete': {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['ids'],
  },
};

export interface DiagramToolOk {
  ok: true;
  /** Wire items to stream as board:item (materialized marks). */
  items: BoardItem[];
  /** Ids the client should remove before appending (delete / replace). */
  removeIds?: string[];
  evidence: string;
  content: string;
  /** Validated IR for optional client store. */
  systemBoard?: SystemBoardV0;
}

export interface DiagramToolFail {
  ok: false;
  evidence: string;
}

export type DiagramToolResult = DiagramToolOk | DiagramToolFail;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function parseBoard(raw: Record<string, unknown>): SystemBoardV0 | null {
  const profile = raw.layoutProfile;
  if (
    typeof profile !== 'string' ||
    !(SYSTEM_BOARD_LAYOUT_PROFILES as readonly string[]).includes(profile)
  ) {
    return null;
  }
  return {
    version: 0,
    layoutProfile: profile as SystemBoardLayoutProfile,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    nodes: Array.isArray(raw.nodes) ? (raw.nodes as SystemBoardV0['nodes']) : [],
    edges: Array.isArray(raw.edges) ? (raw.edges as SystemBoardV0['edges']) : [],
    issues: Array.isArray(raw.issues) ? (raw.issues as SystemBoardV0['issues']) : [],
  };
}

/**
 * Geometric lint — overlaps / empty tracks. Returns human-readable lines for the tool result.
 */
export function lintSystemBoardGeometry(
  items: readonly { id: string; kind: string; at?: { x: number; y: number } }[],
): string[] {
  const notes: string[] = [];
  const texts = items.filter((i) => i.at);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (!a.at || !b.at) continue;
      if (Math.abs(a.at.x - b.at.x) < 8 && Math.abs(a.at.y - b.at.y) < 8) {
        notes.push(`overlap risk: ${a.id} and ${b.id} share nearly the same origin`);
      }
    }
  }
  return notes;
}

function applyRespectPins(items: BoardItem[], known: BoardKnown): BoardItem[] {
  const byId = new Map(known.items.filter((i) => i.at).map((i) => [i.id, i.at!]));
  if (byId.size === 0) return items;
  return items.map((it) => {
    const pinned = byId.get(it.id);
    if (!pinned) return it;
    if (it.kind === 'text' || it.kind === 'noderef') {
      return { ...it, at: { x: pinned.x, y: pinned.y } };
    }
    if (it.kind === 'shape') {
      const dx = pinned.x - it.from.x;
      const dy = pinned.y - it.from.y;
      return {
        ...it,
        from: { x: it.from.x + dx, y: it.from.y + dy },
        to: { x: it.to.x + dx, y: it.to.y + dy },
      };
    }
    return it;
  });
}

/**
 * Execute a diagram.* tool. Materializes SystemBoard IR → board wire items
 * (lane layout lives in diagramMaterialize / diagramLayout).
 */
export function executeDiagramTool(
  name: DiagramToolName,
  args: Record<string, unknown>,
  known: BoardKnown,
): DiagramToolResult {
  if (name === 'diagram.delete') {
    const ids = Array.isArray(args.ids)
      ? args.ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    if (ids.length === 0) {
      return { ok: false, evidence: 'refused: diagram.delete needs non-empty "ids"' };
    }
    const knownIds = new Set(known.items.map((i) => i.id));
    const missing = ids.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        evidence: `refused: unknown board id(s): ${missing.join(', ')}`,
      };
    }
    return {
      ok: true,
      items: [],
      removeIds: ids,
      evidence: `deleted ${ids.length} board item(s)`,
      content: `Removed ${ids.length} mark(s) from SeqDraw: ${ids.join(', ')}.`,
    };
  }

  /* diagram.upsert and diagram.layout both take (or re-take) IR */
  const board = parseBoard(args);
  if (!board) {
    return {
      ok: false,
      evidence:
        name === 'diagram.layout'
          ? 'refused: diagram.layout needs layoutProfile + nodes[] (same IR as upsert)'
          : 'refused: diagram.upsert needs layoutProfile (lane|layered|poster) and nodes[]',
    };
  }
  const knownNodeIds = new Set(known.nodeIds);
  const validated = validateSystemBoard(board, {
    knownNodeIds: knownNodeIds.size > 0 ? knownNodeIds : undefined,
  });
  if (!validated.ok) {
    return {
      ok: false,
      evidence: `refused: ${validated.errors.join('; ')}`,
    };
  }

  let items = materializeSystemBoard(board);
  const respectPins = args.respectPins !== false;
  if (respectPins) items = applyRespectPins(items, known);

  /* Replace prior SystemBoard marks (sb-*) so re-upsert does not pile duplicates. */
  const removeIds = known.items.map((i) => i.id).filter((id) => id.startsWith('sb-'));

  const lint = lintSystemBoardGeometry(
    items.map((it) => {
      if (it.kind === 'text') return { id: it.id, kind: it.kind, at: it.at };
      if (it.kind === 'noderef') return { id: it.id, kind: it.kind, at: it.at };
      return { id: it.id, kind: it.kind };
    }),
  );
  const lintNote = lint.length ? `\nLint: ${lint.join('; ')}` : '';
  const verb = name === 'diagram.layout' ? 'Laid out' : 'Drew';
  return {
    ok: true,
    items,
    ...(removeIds.length > 0 ? { removeIds } : {}),
    evidence: `${name} ${board.nodes.length} node(s), ${board.edges.length} edge(s), ${board.issues.length} issue(s)`,
    content:
      `${verb} SystemBoard "${board.title ?? 'untitled'}" (${board.layoutProfile}): ` +
      `${board.nodes.length} nodes, ${board.edges.length} edges, ${board.issues.length} issues.` +
      lintNote,
    systemBoard: board,
  };
}

export function diagramToolsPromptBlock(): string[] {
  return [
    'SYSTEM BOARD (SeqDraw structured):',
    '- `diagram.upsert` {layoutProfile, nodes[], edges?, issues?, title?} — emit IR only; the product lays out geometry.',
    '- FOR REPOSITORY ARCHITECTURE / FLOW WORKSHEETS ONLY — never for math plots, parabolas, curves, or generic charts (use `propose_chart` / kind line for those).',
    '- Node roles: component | action | state | store | runtime | note. Use `track` for narrative bands.',
    '- Grounded cards: evidence.nodeId must be a scanned node id; otherwise use role note.',
    '- `diagram.delete` {ids[]} — remove existing board marks by id (from ALREADY ON THE WHITEBOARD).',
    '- Prefer diagram.upsert over freehand board.add_* for architecture / flow worksheets.',
  ];
}
