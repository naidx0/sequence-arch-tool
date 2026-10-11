/* ══════════════════════════════════════════════════════════════════════════
   BOARDS — one store for every drawing surface of a project
   packages/analyzer/src/boards/boardStore.ts

   Round 8 (lab/specs/r8-boards.md). The Architecture board (the scanned graph
   with a drawing layer on top) and any number of whiteboards live here, one
   folder per project:

     <root>/.sequence/boards/index.json   the boards: id, name, kind, rev
     <root>/.sequence/boards/<id>.json    one board's items

   Shared by the app server (`boardsRoutes.ts`) and the MCP server, which runs
   in ANOTHER process. That is why every write is a list of OPS applied to the
   file as it is on disk now (read, apply, write to a temp file, rename), and
   never a whole document from memory: a person's stroke and an agent's shape
   land a second apart without one erasing the other.

   A DRAWING IS NEVER A FINDING. No item has evidence, and nothing here becomes
   a graph node. An `anchor` is a pointer to a node id (the item sits relative
   to that node), not a copy of it.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

export type BoardKind = 'architecture' | 'whiteboard';

export interface BoardMeta {
  id: string;
  name: string;
  kind: BoardKind;
  /** Bumped on every write to the board's items or its name. */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardsIndex {
  version: 1;
  boards: BoardMeta[];
}

export interface BPoint {
  x: number;
  y: number;
  /** Strokes only: milliseconds since the pen went down. Absent on strokes drawn before timestamps were recorded. */
  t?: number;
}

interface ItemBase {
  id: string;
  /** Who drew it. Agent marks are tinted so a reader can tell. */
  by?: 'agent' | 'person';
  /** A graph node id: the item's coordinates are offsets from that node's top-left. */
  anchor?: string;
}

export interface BStroke extends ItemBase {
  kind: 'stroke';
  points: BPoint[];
  width: number;
}
export interface BShape extends ItemBase {
  kind: 'shape';
  shape: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow';
  from: BPoint;
  to: BPoint;
  label?: string;
  /** An arrow bound to an item id on this board, or (architecture board) a node id. */
  fromId?: string;
  toId?: string;
}
export interface BText extends ItemBase {
  kind: 'text';
  at: BPoint;
  text: string;
  /** A sticky note: text on a tinted card, `at` its top-left corner. */
  sticky?: boolean;
  w?: number;
  h?: number;
}
export interface BNodeRef extends ItemBase {
  kind: 'noderef';
  at: BPoint;
  nodeId: string;
  label: string;
  path?: string;
  lines?: { from: number; to: number };
  excerpt?: string;
}

export type BoardItem = BStroke | BShape | BText | BNodeRef;

export interface BoardDoc {
  version: 1;
  id: string;
  rev: number;
  items: BoardItem[];
}

export type BoardOp = { op: 'put'; item: unknown } | { op: 'remove'; id: string };

export const ARCH_BOARD_ID = 'architecture';
export const DEFAULT_WHITEBOARD_ID = 'whiteboard';

export const BOARD_CAPS = {
  boards: 50,
  items: 2000,
  text: 500,
  label: 200,
  name: 60,
  points: 2000,
  coord: 1_000_000,
  opsPerCall: 200,
} as const;

/** Thrown for a refused request; the message is safe to show the caller. */
export class BoardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export function boardsDir(root: string): string {
  return path.join(root, '.sequence', 'boards');
}

function now(): string {
  return new Date().toISOString();
}

function writeAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  /* Encode first, then write: a throw inside stringify must not leave a
     truncated file behind. */
  const text = JSON.stringify(data);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    /* Windows refuses a rename over a file another process holds open for a
       moment; one retry after copying is the honest fallback. */
    try {
      fs.copyFileSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    if (!fs.existsSync(file)) throw e;
  }
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function defaultIndex(): BoardsIndex {
  const t = '1970-01-01T00:00:00.000Z';
  return {
    version: 1,
    boards: [
      { id: ARCH_BOARD_ID, name: 'Architecture', kind: 'architecture', rev: 0, createdAt: t, updatedAt: t },
      { id: DEFAULT_WHITEBOARD_ID, name: 'Whiteboard', kind: 'whiteboard', rev: 0, createdAt: t, updatedAt: t },
    ],
  };
}

function parseIndex(raw: unknown): BoardsIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { version?: unknown; boards?: unknown };
  if (o.version !== 1 || !Array.isArray(o.boards)) return null;
  const boards: BoardMeta[] = [];
  for (const b of o.boards) {
    if (!b || typeof b !== 'object') continue;
    const m = b as Partial<BoardMeta>;
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) continue;
    if (m.kind !== 'architecture' && m.kind !== 'whiteboard') continue;
    boards.push({
      id: m.id,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.slice(0, BOARD_CAPS.name) : m.id,
      kind: m.kind,
      rev: typeof m.rev === 'number' && Number.isFinite(m.rev) ? m.rev : 0,
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : now(),
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now(),
    });
  }
  /* The architecture board always exists, first. */
  const arch = boards.find((b) => b.id === ARCH_BOARD_ID);
  const rest = boards.filter((b) => b.id !== ARCH_BOARD_ID && b.kind === 'whiteboard');
  return { version: 1, boards: [arch ?? defaultIndex().boards[0]!, ...rest] };
}

/** The project's boards. Reading never writes: a project nobody drew on has no folder. */
export function listBoards(root: string): BoardsIndex {
  return parseIndex(readJsonFile(path.join(boardsDir(root), 'index.json'))) ?? defaultIndex();
}

function writeIndex(root: string, index: BoardsIndex): void {
  writeAtomic(path.join(boardsDir(root), 'index.json'), index);
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new BoardError('name must be a string');
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) throw new BoardError('name is empty');
  if (n.length > BOARD_CAPS.name) throw new BoardError(`name is longer than ${BOARD_CAPS.name} characters`);
  return n;
}

/**
 * Find a board by id, or by name (case-insensitive) — an agent says "the
 * planning board", not "wb-3".
 */
export function findBoard(index: BoardsIndex, ref: string): BoardMeta | null {
  const byId = index.boards.find((b) => b.id === ref);
  if (byId) return byId;
  const low = ref.trim().toLowerCase();
  return index.boards.find((b) => b.name.toLowerCase() === low) ?? null;
}

/** Ids that are routes (`/api/boards/events`, `/api/boards/edit-log`), never boards. */
const RESERVED_IDS = new Set(['events', 'edit-log']);

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'board';
}

export function createBoard(root: string, input: { name: unknown; kind?: unknown }): BoardMeta {
  const kind = input.kind ?? 'whiteboard';
  if (kind === 'architecture') {
    throw new BoardError('a project has one architecture board (id "architecture"); draw on it instead', 409);
  }
  if (kind !== 'whiteboard') throw new BoardError('kind must be "whiteboard" or "architecture"');
  const name = cleanName(input.name);
  const index = listBoards(root);
  if (index.boards.length >= BOARD_CAPS.boards) throw new BoardError(`a project holds at most ${BOARD_CAPS.boards} boards`, 409);
  const taken = new Set(index.boards.map((b) => b.id));
  let id = slug(name);
  if (taken.has(id) || id === ARCH_BOARD_ID || RESERVED_IDS.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n += 1;
    id = `${id}-${n}`;
  }
  const t = now();
  const meta: BoardMeta = { id, name, kind: 'whiteboard', rev: 0, createdAt: t, updatedAt: t };
  writeIndex(root, { version: 1, boards: [...index.boards, meta] });
  return meta;
}

export function renameBoard(root: string, id: string, name: unknown): BoardMeta {
  const index = listBoards(root);
  const meta = index.boards.find((b) => b.id === id);
  if (!meta) throw new BoardError(`no board "${id}"`, 404);
  const next: BoardMeta = { ...meta, name: cleanName(name), rev: meta.rev + 1, updatedAt: now() };
  writeIndex(root, { version: 1, boards: index.boards.map((b) => (b.id === id ? next : b)) });
  return next;
}

export function deleteBoard(root: string, id: string): void {
  if (id === ARCH_BOARD_ID) throw new BoardError('the architecture board cannot be deleted; clear its drawing instead', 409);
  const index = listBoards(root);
  if (!index.boards.some((b) => b.id === id)) throw new BoardError(`no board "${id}"`, 404);
  writeIndex(root, { version: 1, boards: index.boards.filter((b) => b.id !== id) });
  fs.rmSync(path.join(boardsDir(root), `${id}.json`), { force: true });
}

export function readBoard(root: string, id: string): BoardDoc | null {
  const meta = listBoards(root).boards.find((b) => b.id === id);
  if (!meta) return null;
  const raw = readJsonFile(path.join(boardsDir(root), `${id}.json`)) as Partial<BoardDoc> | null;
  const items: BoardItem[] = [];
  if (raw && Array.isArray(raw.items)) {
    for (const it of raw.items) {
      const v = validateItem(it);
      if (v.ok) items.push(v.item);
    }
  }
  return { version: 1, id, rev: meta.rev, items };
}

/* ── validation ──────────────────────────────────────────────────────── */

type Check<T> = { ok: true; item: T } | { ok: false; error: string };

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BoardError(`${what} must be a finite number`);
  if (Math.abs(v) > BOARD_CAPS.coord) throw new BoardError(`${what} is outside ±${BOARD_CAPS.coord}`);
  return Math.round(v * 100) / 100;
}

function pt(v: unknown, what: string): BPoint {
  if (!v || typeof v !== 'object') throw new BoardError(`${what} must be {x, y}`);
  const p = v as { x?: unknown; y?: unknown };
  return { x: num(p.x, `${what}.x`), y: num(p.y, `${what}.y`) };
}

/** A stroke point keeps its pen time when it has a sane one (0 to one hour, whole milliseconds). */
function strokePt(v: unknown, what: string): BPoint {
  const p = pt(v, what);
  const t = (v as { t?: unknown }).t;
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 3_600_000) p.t = Math.round(t);
  return p;
}

function str(v: unknown, what: string, cap: number): string {
  if (typeof v !== 'string') throw new BoardError(`${what} must be a string`);
  if (v.length > cap) throw new BoardError(`${what} is longer than ${cap} characters`);
  return v;
}

function optId(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > 300) throw new BoardError(`${what} must be an id string`);
  return v;
}

/** One item, checked and normalised. Unknown kinds are refused, not kept. */
export function validateItem(raw: unknown): Check<BoardItem> {
  try {
    if (!raw || typeof raw !== 'object') throw new BoardError('item must be an object');
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) {
      throw new BoardError('item.id must be 1-64 characters of letters, digits, _ . : -');
    }
    const base: ItemBase = { id: o.id };
    if (o.by === 'agent' || o.by === 'person') base.by = o.by;
    const anchor = optId(o.anchor, 'anchor');
    if (anchor) base.anchor = anchor;
    switch (o.kind) {
      case 'stroke': {
        if (!Array.isArray(o.points) || o.points.length < 2) throw new BoardError('a stroke needs at least 2 points');
        if (o.points.length > BOARD_CAPS.points) throw new BoardError(`a stroke holds at most ${BOARD_CAPS.points} points`);
        const width = o.width === undefined ? 2 : num(o.width, 'width');
        return {
          ok: true,
          item: { ...base, kind: 'stroke', points: o.points.map((p, i) => strokePt(p, `points[${i}]`)), width: Math.min(20, Math.max(0.5, width)) },
        };
      }
      case 'shape': {
        if (o.shape !== 'rect' && o.shape !== 'ellipse' && o.shape !== 'diamond' && o.shape !== 'line' && o.shape !== 'arrow') {
          throw new BoardError('shape must be rect, ellipse, diamond, line or arrow');
        }
        const item: BShape = { ...base, kind: 'shape', shape: o.shape, from: pt(o.from, 'from'), to: pt(o.to, 'to') };
        if (o.label !== undefined && o.label !== '') item.label = str(o.label, 'label', BOARD_CAPS.label);
        const fromId = optId(o.fromId, 'fromId');
        const toId = optId(o.toId, 'toId');
        if (fromId) item.fromId = fromId;
        if (toId) item.toId = toId;
        return { ok: true, item };
      }
      case 'text':
      /* `kind: "sticky"` is read as the sticky text it means. */
      case 'sticky': {
        const item: BText = { ...base, kind: 'text', at: pt(o.at, 'at'), text: str(o.text, 'text', BOARD_CAPS.text) };
        if (o.kind === 'sticky' || o.sticky === true) {
          item.sticky = true;
          if (o.w !== undefined) item.w = Math.min(600, Math.max(60, num(o.w, 'w')));
          if (o.h !== undefined) item.h = Math.min(600, Math.max(40, num(o.h, 'h')));
        }
        return { ok: true, item };
      }
      case 'noderef': {
        const item: BNodeRef = {
          ...base,
          kind: 'noderef',
          at: pt(o.at, 'at'),
          nodeId: str(o.nodeId, 'nodeId', 300),
          label: str(o.label, 'label', BOARD_CAPS.label),
        };
        if (typeof o.path === 'string') item.path = str(o.path, 'path', 500);
        if (o.lines && typeof o.lines === 'object') {
          const l = o.lines as { from?: unknown; to?: unknown };
          if (typeof l.from === 'number' && typeof l.to === 'number') item.lines = { from: l.from, to: l.to };
        }
        if (typeof o.excerpt === 'string') item.excerpt = str(o.excerpt, 'excerpt', 4000);
        return { ok: true, item };
      }
      default:
        throw new BoardError(`unknown item kind "${String(o.kind)}"`);
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Apply ops to a board, ALL OR NOTHING: one refused op refuses the call, with
 * every reason listed, and the file is untouched. A half-applied diagram (the
 * boxes without their arrows) is worse than a clear refusal.
 */
export function applyBoardOps(root: string, id: string, ops: readonly BoardOp[]): BoardDoc {
  if (!Array.isArray(ops)) throw new BoardError('ops must be an array');
  if (ops.length > BOARD_CAPS.opsPerCall) throw new BoardError(`at most ${BOARD_CAPS.opsPerCall} ops per call`);
  const index = listBoards(root);
  const meta = index.boards.find((b) => b.id === id);
  if (!meta) throw new BoardError(`no board "${id}"`, 404);
  const doc = readBoard(root, id) ?? { version: 1 as const, id, rev: meta.rev, items: [] };
  const items = new Map(doc.items.map((it) => [it.id, it]));
  const errors: string[] = [];
  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') {
      errors.push(`ops[${i}]: not an object`);
      return;
    }
    if (op.op === 'remove') {
      if (typeof op.id !== 'string') errors.push(`ops[${i}]: remove needs an id`);
      else if (!items.delete(op.id)) errors.push(`ops[${i}]: no item "${op.id}" on board "${id}"`);
      return;
    }
    if (op.op === 'put') {
      const v = validateItem(op.item);
      if (!v.ok) errors.push(`ops[${i}]: ${v.error}`);
      else {
        /* Re-inserting keeps the original z-order for an update. */
        items.set(v.item.id, v.item);
      }
      return;
    }
    errors.push(`ops[${i}]: op must be "put" or "remove"`);
  });
  if (errors.length > 0) throw new BoardError(errors.join('; '));
  if (items.size > BOARD_CAPS.items) throw new BoardError(`a board holds at most ${BOARD_CAPS.items} items`, 409);
  const rev = meta.rev + 1;
  const next: BoardDoc = { version: 1, id, rev, items: [...items.values()] };
  const fresh = listBoards(root);
  writeAtomic(path.join(boardsDir(root), `${id}.json`), next);
  writeIndex(root, {
    version: 1,
    boards: (fresh.boards.some((b) => b.id === id) ? fresh.boards : [...fresh.boards, meta]).map((b) =>
      b.id === id ? { ...b, rev, updatedAt: now() } : b,
    ),
  });
  return next;
}
