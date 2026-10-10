/**
 * Round 8 — THE AGENT'S PEN. Tools that let an agent list the project's
 * boards, create a whiteboard, and draw on a board: rectangles, ellipses,
 * arrows, lines, text and sticky notes, optionally anchored to a real
 * architecture node so a note sits next to the service it is about.
 *
 * They write through `@sequence/analyzer`'s board store — the same files the
 * app's `/api/boards` routes write — so the open Sequence tab sees the change
 * through its boards stream with no reload (lab/specs/r8-boards.md).
 *
 * THE CHOICE OF BOARD IS THE AGENT'S, and the descriptions say how to make it:
 * the architecture board when the drawing explains the real system (its marks
 * sit on the scanned graph and can anchor to its nodes), a whiteboard for a
 * free sketch (a plan, an idea, something that does not exist yet). Nothing
 * drawn becomes a node or carries evidence.
 */

import path from 'node:path';
import { z } from 'zod';
import {
  ARCH_BOARD_ID,
  BoardError,
  applyBoardOps,
  createBoard,
  findBoard,
  linkedWorktreeBase,
  listBoards,
  readBoard,
  scanRepoCached,
  type BoardItem,
  type BoardOp,
} from '@sequence/analyzer';
import type { ArchGraph } from '@sequence/schema';
import { resolveNodeName } from './insightTools.js';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
const okJson = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** The width of an architecture card in board units (web2 `CARD_W`). */
export const NODE_CARD_W = 160;

/** Boards belong to the project the app shows: a linked worktree draws on its base's boards. */
function boardsRoot(repoPath: string): string {
  const root = path.resolve(repoPath);
  return linkedWorktreeBase(root) ?? root;
}

export const listBoardsShape = {
  repoPath: z.string().describe('Path to the repo.'),
};

export const createBoardShape = {
  repoPath: z.string().describe('Path to the repo.'),
  name: z.string().max(60).describe('Board name, e.g. "Checkout redesign".'),
  kind: z
    .enum(['whiteboard', 'architecture'])
    .optional()
    .describe('Only "whiteboard" can be created; the project has one architecture board.'),
};

const opShape = z.object({
  op: z.enum(['add', 'update', 'remove']),
  id: z.string().max(64).optional().describe('Item id. Required for update/remove; optional for add.'),
  type: z.enum(['rect', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'sticky']).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  text: z.string().max(500).optional().describe('Body of text/sticky; label of a shape.'),
  from: z.string().optional().describe('Arrow start: an item id, or a node id/name on the architecture board.'),
  to: z.string().optional(),
  anchor: z.string().optional().describe('Architecture node id or name; x,y become offsets from its top-left.'),
});
export type DrawOp = z.infer<typeof opShape>;

export const drawShape = {
  repoPath: z.string().describe('Path to the repo.'),
  board: z.string().optional().describe('Board id or name (default "architecture").'),
  ops: z.array(opShape).min(1).max(100),
};

export function listBoardsTool(a: { repoPath: string }): ToolResult {
  try {
    const root = boardsRoot(a.repoPath);
    const boards = listBoards(root).boards.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      items: readBoard(root, b.id)?.items.length ?? 0,
    }));
    return okJson({ boards });
  } catch (e) {
    return fail(`list_boards failed: ${(e as Error).message}`);
  }
}

export function createBoardTool(a: { repoPath: string; name: string; kind?: 'whiteboard' | 'architecture' }): ToolResult {
  try {
    const meta = createBoard(boardsRoot(a.repoPath), { name: a.name, kind: a.kind ?? 'whiteboard' });
    return okJson({ created: { id: meta.id, name: meta.name, kind: meta.kind } });
  } catch (e) {
    return fail(e instanceof BoardError ? e.message : `create_board failed: ${(e as Error).message}`);
  }
}

const SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 160, h: 72 },
  ellipse: { w: 140, h: 80 },
  diamond: { w: 140, h: 96 },
  sticky: { w: 180, h: 110 },
};

/** A stored item seen as the flat fields an op speaks. */
function flatten(item: BoardItem): Partial<DrawOp> {
  const base = { id: item.id, anchor: item.anchor };
  switch (item.kind) {
    case 'shape':
      return {
        ...base,
        type: item.shape,
        x: Math.min(item.from.x, item.to.x),
        y: Math.min(item.from.y, item.to.y),
        w: Math.abs(item.to.x - item.from.x),
        h: Math.abs(item.to.y - item.from.y),
        ...(item.shape === 'arrow' || item.shape === 'line' ? { x: item.from.x, y: item.from.y, w: item.to.x - item.from.x, h: item.to.y - item.from.y } : {}),
        text: item.label,
        from: item.fromId,
        to: item.toId,
      };
    case 'text':
      return item.sticky
        ? { ...base, type: 'sticky', x: item.at.x, y: item.at.y, w: item.w, h: item.h, text: item.text }
        : { ...base, type: 'text', x: item.at.x, y: item.at.y, text: item.text };
    default:
      return base;
  }
}

/**
 * Build the stored item from flat fields. Refusals are thrown as BoardError
 * with the op's index so an agent can fix the one it got wrong.
 */
function build(o: Partial<DrawOp> & { id: string }, where: string, anchored: boolean): BoardItem {
  const type = o.type;
  if (!type) throw new BoardError(`${where}: type is required to add (rect, ellipse, arrow, line, text, sticky)`);
  const by = 'agent' as const;
  const anchor = o.anchor ? { anchor: o.anchor } : {};
  /* Anchored without a position: just right of the card, top-aligned. */
  const x = o.x ?? (anchored ? NODE_CARD_W + 24 : undefined);
  const y = o.y ?? (anchored ? 0 : undefined);
  if (type === 'arrow' || type === 'line') {
    const bound = o.from && o.to;
    if (!bound && (x === undefined || y === undefined || o.w === undefined || o.h === undefined)) {
      throw new BoardError(`${where}: an ${type} needs from and to ids, or x, y, w, h (w/h is the vector to its end)`);
    }
    const fx = x ?? 0;
    const fy = y ?? 0;
    return {
      kind: 'shape',
      id: o.id,
      by,
      ...anchor,
      shape: type,
      from: { x: fx, y: fy },
      to: { x: fx + (o.w ?? 0), y: fy + (o.h ?? 0) },
      ...(o.text ? { label: o.text } : {}),
      ...(o.from ? { fromId: o.from } : {}),
      ...(o.to ? { toId: o.to } : {}),
    };
  }
  if (x === undefined || y === undefined) throw new BoardError(`${where}: x and y are required (or an anchor)`);
  if (type === 'text') {
    if (!o.text) throw new BoardError(`${where}: text needs text`);
    return { kind: 'text', id: o.id, by, ...anchor, at: { x, y }, text: o.text };
  }
  if (type === 'sticky') {
    return {
      kind: 'text',
      sticky: true,
      id: o.id,
      by,
      ...anchor,
      at: { x, y },
      text: o.text ?? '',
      w: o.w ?? SIZES.sticky!.w,
      h: o.h ?? SIZES.sticky!.h,
    };
  }
  const size = SIZES[type]!;
  return {
    kind: 'shape',
    id: o.id,
    by,
    ...anchor,
    shape: type,
    from: { x, y },
    to: { x: x + (o.w ?? size.w), y: y + (o.h ?? size.h) },
    ...(o.text ? { label: o.text } : {}),
  };
}

export async function drawTool(
  a: { repoPath: string; board?: string; ops: DrawOp[] },
  loadGraph: (root: string) => Promise<ArchGraph> = (root) => scanRepoCached(root, { cluster: true }),
): Promise<ToolResult> {
  try {
    const root = boardsRoot(a.repoPath);
    const index = listBoards(root);
    const meta = findBoard(index, a.board ?? ARCH_BOARD_ID);
    if (!meta) {
      return fail(`no board "${a.board}". Boards: ${index.boards.map((b) => `${b.id} (${b.name})`).join(', ')}. create_board makes one.`);
    }
    const arch = meta.kind === 'architecture';
    const doc = readBoard(root, meta.id);
    const have = new Map((doc?.items ?? []).map((i) => [i.id, i]));
    let graph: ArchGraph | null = null;
    const errors: string[] = [];
    /* A node named by id OR name; ambiguity is a refusal that lists the candidates. */
    const node = async (ref: string, where: string): Promise<string | null> => {
      if (!arch) {
        errors.push(`${where}: "${ref}" is not an item on this whiteboard (node anchors are for the architecture board)`);
        return null;
      }
      graph ??= await loadGraph(root);
      const r = resolveNodeName(graph, ref);
      if ('id' in r) return r.id;
      errors.push(
        r.candidates.length === 0
          ? `${where}: no architecture node matches "${ref}"`
          : `${where}: "${ref}" is ambiguous: ${r.candidates.join(', ')}`,
      );
      return null;
    };
    const ops: BoardOp[] = [];
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const taken = new Set(have.keys());
    const freshId = (type: string): string => {
      let n = 1;
      while (taken.has(`${type}-${n}`)) n += 1;
      const id = `${type}-${n}`;
      taken.add(id);
      return id;
    };
    for (const [i, op] of a.ops.entries()) {
      const where = `ops[${i}]`;
      if (op.op === 'remove') {
        if (!op.id || !have.has(op.id)) errors.push(`${where}: no item "${op.id ?? ''}" on "${meta.id}"`);
        else {
          ops.push({ op: 'remove', id: op.id });
          have.delete(op.id);
          removed.push(op.id);
        }
        continue;
      }
      let fields: Partial<DrawOp> & { id: string };
      if (op.op === 'update') {
        const prev = op.id ? have.get(op.id) : undefined;
        if (!prev || !op.id) {
          errors.push(`${where}: no item "${op.id ?? ''}" to update on "${meta.id}"`);
          continue;
        }
        const defined = Object.fromEntries(Object.entries(op).filter(([, v]) => v !== undefined));
        fields = { ...flatten(prev), ...defined, id: op.id };
      } else {
        if (op.id && have.has(op.id)) {
          errors.push(`${where}: "${op.id}" already exists; use update`);
          continue;
        }
        if (op.id) taken.add(op.id);
        fields = { ...op, id: op.id ?? freshId(op.type ?? 'item') };
      }
      if (op.anchor) {
        const id = await node(op.anchor, `${where}.anchor`);
        if (!id) continue;
        fields.anchor = id;
      }
      for (const end of ['from', 'to'] as const) {
        const ref = op[end];
        if (!ref || have.has(ref) || taken.has(ref)) continue;
        const id = await node(ref, `${where}.${end}`);
        if (!id) continue;
        fields[end] = id;
      }
      try {
        const item = build(fields, where, Boolean(fields.anchor));
        ops.push({ op: 'put', item });
        have.set(item.id, item);
        (op.op === 'update' ? updated : added).push(item.id);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (errors.length > 0) return fail(`draw refused, nothing was drawn: ${errors.join('; ')}`);
    const next = applyBoardOps(root, meta.id, ops);
    return okJson({
      board: { id: meta.id, name: meta.name, kind: meta.kind },
      rev: next.rev,
      added,
      updated,
      removed,
      items: next.items.length,
    });
  } catch (e) {
    return fail(e instanceof BoardError ? `draw refused, nothing was drawn: ${e.message}` : `draw failed: ${(e as Error).message}`);
  }
}

export const LIST_BOARDS_DESCRIPTION =
  "List the project's drawing boards (id, name, kind, item count): the one architecture board " +
  '(the scanned graph with a drawing layer) and any whiteboards. Keyless.';

export const CREATE_BOARD_DESCRIPTION =
  'Create a named whiteboard: a free canvas for a sketch, plan or idea that is not the real ' +
  'system. To explain the real system, draw on the architecture board instead (it exists already).';

export const DRAW_DESCRIPTION =
  'Draw on a board the user sees live in Sequence. Choose the ARCHITECTURE board (default) when ' +
  'the drawing explains the real system: anchor notes and shapes to node ids or names so they sit ' +
  'beside the services they are about (x,y become offsets from the card\'s top-left; a card is 160 ' +
  'wide, so x:184 is just right of it). Choose a WHITEBOARD (by name) for a free sketch. Ops: add ' +
  '{type rect|ellipse|arrow|line|text|sticky, x, y, w, h, text}, update {id, fields}, remove {id}. ' +
  'An arrow takes from/to item ids (or node ids). All ops apply or none do. Drawings are never ' +
  'nodes and carry no evidence.';
