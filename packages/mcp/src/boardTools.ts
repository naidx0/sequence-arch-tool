/**
 * Round 8 — THE AGENT'S PEN. Tools that let an agent list the project's
 * boards, create a whiteboard, and draw on a board: rectangles, ellipses,
 * arrows, lines, polylines, titled frames, text, sticky notes and hosted SVG,
 * optionally anchored to a real architecture node so a note sits next to the
 * service it is about.
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
 *
 * STYLE IS THEME-FIRST. `stroke` / `fill` are names from a fixed palette
 * derived from the Graphite tokens (analyzer boards/boardPalette.ts); the
 * renderer maps a name to its CSS variable, so a board follows light/dark and
 * the app font and radius. A raw #hex is accepted only with `ownTheme: true`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ARCH_BOARD_ID,
  ARROWHEADS,
  BoardError,
  DASHES,
  FONT_SIZES,
  LABEL_POSITIONS,
  applyBoardOps,
  createBoard,
  findBoard,
  linkedWorktreeBase,
  listBoards,
  readBoard,
  scanRepoCached,
  NODE_CARD_W as CORE_NODE_CARD_W,
  DRAW_SIZES as SIZES,
  STYLE_KEYS,
  boardBounds,
  buildItem as build,
  composeOps,
  type CoreDrawOp,
  checkMediaPath,
  MEDIA_EXTS,
  POSTER_EXTS,
  validateItem,
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
export const NODE_CARD_W = CORE_NODE_CARD_W;
export { composeOps };

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

/*
 * Every listing entry must stay under 2 KB (mcpHygiene.test.ts), so the colour
 * fields are plain strings here and the palette is named in the description;
 * the board store refuses an unknown name and lists the valid ones.
 */
const opShape = z.object({
  op: z.enum(['add', 'update', 'remove', 'compose']),
  id: z.string().optional(),
  type: z.enum(['rect', 'ellipse', 'diamond', 'arrow', 'line', 'path', 'frame', 'text', 'sticky', 'svg', 'video', 'scene']).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  text: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  anchor: z.string().optional(),
  stroke: z.string().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().optional(),
  /* Plain strings: an enum costs ~40 bytes each in the 2 KB listing entry; the store names the valid values on a refusal. */
  dash: z.string().optional(),
  arrowStart: z.string().optional(),
  arrowEnd: z.string().optional(),
  points: z.array(z.unknown()).optional(),
  labelPos: z.string().optional(),
  fontSize: z.string().optional(),
  group: z.string().optional(),
  ownTheme: z.boolean().optional(),
  svg: z.string().optional(),
  src: z.string().optional(),
  poster: z.string().optional(),
  fps: z.number().optional(),
  easing: z.string().optional(),
  keyframes: z.array(z.unknown()).optional(),
  duration: z.number().optional(),
  layout: z.enum(['row', 'column', 'grid']).optional(),
  gap: z.number().optional(),
  columns: z.number().optional(),
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  connect: z.array(z.array(z.number())).optional(),
});
export type DrawOp = Omit<z.infer<typeof opShape>, 'dash' | 'arrowStart' | 'arrowEnd' | 'labelPos' | 'fontSize'> & Pick<CoreDrawOp, 'dash' | 'arrowStart' | 'arrowEnd' | 'labelPos' | 'fontSize'>;


export const drawShape = {
  repoPath: z.string().describe('Path to the repo.'),
  board: z.string().optional(),
  ops: z.array(opShape),
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

/** A stored item seen as the flat fields an op speaks. */
function flatten(item: BoardItem): Partial<DrawOp> {
  const base = { id: item.id, anchor: item.anchor, ...(item.group ? { group: item.group } : {}) };
  switch (item.kind) {
    case 'shape': {
      const style: Record<string, unknown> = {};
      for (const k of STYLE_KEYS) if (item[k] !== undefined) style[k] = item[k];
      return {
        ...base,
        ...style,
        type: item.shape,
        x: Math.min(item.from.x, item.to.x),
        y: Math.min(item.from.y, item.to.y),
        w: Math.abs(item.to.x - item.from.x),
        h: Math.abs(item.to.y - item.from.y),
        ...(item.shape === 'arrow' || item.shape === 'line' ? { x: item.from.x, y: item.from.y, w: item.to.x - item.from.x, h: item.to.y - item.from.y } : {}),
        ...(item.points ? { points: item.points.map((p) => [p.x, p.y]) } : {}),
        text: item.label,
        from: item.fromId,
        to: item.toId,
      };
    }
    case 'text':
      return {
        ...base,
        ...(item.color ? { stroke: item.color } : {}),
        ...(item.fontSize ? { fontSize: item.fontSize } : {}),
        ...(item.ownTheme ? { ownTheme: true } : {}),
        ...(item.sticky
          ? { type: 'sticky' as const, x: item.at.x, y: item.at.y, w: item.w, h: item.h, text: item.text }
          : { type: 'text' as const, x: item.at.x, y: item.at.y, text: item.text }),
      };
    case 'svg':
      return { ...base, type: 'svg', x: item.at.x, y: item.at.y, w: item.w, h: item.h, svg: item.svg, text: item.label };
    case 'video':
      return { ...base, type: 'video', x: item.at.x, y: item.at.y, w: item.w, h: item.h, src: item.src, poster: item.poster, text: item.label };
    case 'scene':
      return {
        ...base,
        type: 'scene',
        x: item.at.x,
        y: item.at.y,
        w: item.w,
        h: item.h,
        duration: item.duration,
        keyframes: item.keyframes,
        fps: item.fps,
        easing: item.easing,
        text: item.title,
        ...(item.ownTheme ? { ownTheme: true } : {}),
      };
    default:
      return base;
  }
}

/**
 * A clip or poster is checked as a project-relative path and, when the agent rendered it in a chat
 * worktree, queued to be copied to the same place under the project root the app serves (a Space
 * belongs to the base project, and the file route serves from there).
 *
 * The source is judged inside the worktree first, by the same rules a save uses (its real path stays
 * inside the worktree: no symlink or junction out; no hard link; not a reserved folder). Nothing is
 * copied here: the returned step runs only after every op of the call has validated. A copy is
 * refreshed when the source differs from the project's copy (size) or is newer.
 */
function planMedia(rel: unknown, what: string, exts: readonly string[], root: string, repoPath: string): (() => void) | null {
  const clean = checkMediaPath(rel, what, exts);
  const wt = path.resolve(repoPath);
  const sameRoot = (() => {
    try {
      return fs.realpathSync(wt) === fs.realpathSync(root);
    } catch {
      return path.resolve(root) === wt;
    }
  })();
  const src = path.join(wt, clean);
  if (sameRoot || !fs.existsSync(src)) return null;
  checkMediaPath(rel, what, exts, { roots: [wt], mustExist: true });
  const st = fs.statSync(src);
  if (st.size > 512 * 1024 * 1024) throw new BoardError(`${what}: ${clean} is over 512 MB`);
  const dest = path.join(root, clean);
  let have: fs.Stats | null = null;
  try {
    have = fs.statSync(dest);
  } catch {
    have = null;
  }
  if (have && have.size === st.size && have.mtimeMs >= st.mtimeMs) return null;
  return () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fs.utimesSync(dest, st.atime, st.mtime);
  };
}

const previewOf = (board: string, group: string | undefined, ids: string[]): string | null => {
  if (group) return `inline preview: /api/boards/${encodeURIComponent(board)}/render.svg?group=${encodeURIComponent(group)}; open on surface: board ${board}`;
  if (ids.length > 0) return `inline preview: /api/boards/${encodeURIComponent(board)}/render.svg?items=${ids.slice(0, 20).map(encodeURIComponent).join(',')}; open on surface: board ${board}`;
  return null;
};

const MAX_OPS = 100;
const MAX_COMPOSE_ITEMS = 60;

export async function drawTool(
  a: { repoPath: string; board?: string; ops: DrawOp[] },
  loadGraph: (root: string) => Promise<ArchGraph> = (root) => scanRepoCached(root, { cluster: true }),
): Promise<ToolResult> {
  if (a.ops.length > MAX_OPS) return fail(`draw refused, nothing was drawn: at most ${MAX_OPS} ops per call (got ${a.ops.length}); split the drawing`);
  const big = a.ops.find((o) => (o.items?.length ?? 0) > MAX_COMPOSE_ITEMS);
  if (big) return fail(`draw refused, nothing was drawn: compose takes at most ${MAX_COMPOSE_ITEMS} items (got ${big.items!.length})`);
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
    const staging: (() => void)[] = [];
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const taken = new Set(have.keys());
    /* O(1) per id: a counter per type that only moves forward past ids already taken. */
    const counters = new Map<string, number>();
    const freshId = (type: string): string => {
      let n = counters.get(type) ?? 1;
      while (taken.has(`${type}-${n}`)) n += 1;
      counters.set(type, n + 1);
      const id = `${type}-${n}`;
      taken.add(id);
      return id;
    };
    /* A compose op becomes the add ops it stands for, placed where it stood. */
    const queue: { op: DrawOp; where: string }[] = a.ops.map((op, i) => ({ op, where: `ops[${i}]` }));
    for (let qi = 0; qi < queue.length; qi += 1) {
      const { op, where } = queue[qi]!;
      if (op.op === 'compose') {
        try {
          const expanded = composeOps(op, freshId, where, [...have.values()]);
          queue.splice(qi + 1, 0, ...expanded.map((e, k) => ({ op: e, where: `${where}.${k}` })));
        } catch (e) {
          errors.push((e as Error).message);
        }
        continue;
      }
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
        if (fields.type === 'video') {
          const s1 = planMedia(fields.src, 'src', MEDIA_EXTS, root, a.repoPath);
          if (s1) staging.push(s1);
          const s2 = fields.poster ? planMedia(fields.poster, 'poster', POSTER_EXTS, root, a.repoPath) : null;
          if (s2) staging.push(s2);
        }
        const item = build(fields, where, Boolean(fields.anchor));
        ops.push({ op: 'put', item });
        have.set(item.id, item);
        (op.op === 'update' ? updated : added).push(item.id);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (errors.length > 0) return fail(`draw refused, nothing was drawn: ${errors.join('; ')}`);
    /* Judge every item exactly as the store will, BEFORE anything is copied: a refusal leaves no stray file behind. */
    for (const op of ops) {
      if (op.op !== 'put') continue;
      const v = validateItem(op.item, { roots: [root, path.resolve(a.repoPath)], mustExist: true });
      if (!v.ok) errors.push(v.error);
    }
    if (errors.length > 0) return fail(`draw refused, nothing was drawn: ${errors.join('; ')}`);
    for (const copy of staging) copy();
    const next = applyBoardOps(root, meta.id, ops, [root, path.resolve(a.repoPath)]);
    const touched = new Set([...added, ...updated]);
    const groups = [...new Set(next.items.filter((i) => touched.has(i.id) && i.group).map((i) => i.group!))];
    const preview = previewOf(meta.id, groups[0], [...touched]);
    return okJson({
      board: { id: meta.id, name: meta.name, kind: meta.kind },
      rev: next.rev,
      added,
      updated,
      removed,
      items: next.items.length,
      ...(groups[0] ? { group: groups[0] } : {}),
      ...(groups.length > 1 ? { groups } : {}),
      ...(preview ? { preview } : {}),
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
  'Draw on a board. ARCHITECTURE board (default): the drawing explains the real system; anchor to node ids. ' +
  'WHITEBOARD for a free sketch. Ops: add, update, remove, compose {text, layout, items, connect [i,j]}. ' +
  'video {src}; scene {duration ms, keyframes [{t,target,x,y}]}. stroke/fill: palette names; #hex needs ownTheme.';
