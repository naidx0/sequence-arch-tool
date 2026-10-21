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
import {
  ARROWHEADS,
  DASHES,
  FILL_COLORS,
  FONT_SIZES,
  LABEL_POSITIONS,
  STROKE_COLORS,
  isHexColor,
  type BoardArrowhead,
  type BoardDash,
  type BoardFontSize,
  type BoardLabelPos,
} from './boardPalette.js';
import { SvgError, sanitizeSvg } from './svgSanitize.js';

export type BoardKind = 'architecture' | 'whiteboard';

export interface BoardMeta {
  id: string;
  name: string;
  kind: BoardKind;
  /** Bumped on every write to the board's items or its name. */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /**
   * The chats this board belongs to. Absent on a board from before Spaces were per chat ("earlier"): it is in no chat's
   * list and is offered in the add-from picker. The architecture board is the project's and never has it.
   */
  chats?: string[];
  /** Explicit agent delivery, distinct from a person's edit or a rename. */
  delivery?: { chat: string; rev: number };
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
  /** Composes items into one diagram: items sharing a group id move and select together. */
  group?: string;
}

/**
 * Style fields (shapes, paths, frames). `stroke` and `fill` are palette NAMES
 * (boardPalette.ts) that the renderer maps to Graphite custom properties; a
 * #hex is stored only when `ownTheme` is true. Absent = the theme default.
 */
export interface ItemStyle {
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: BoardDash;
  arrowStart?: BoardArrowhead;
  arrowEnd?: BoardArrowhead;
  labelPos?: BoardLabelPos;
  fontSize?: BoardFontSize;
  ownTheme?: boolean;
}

export interface BStroke extends ItemBase {
  kind: 'stroke';
  /** Pen colour: a palette name (or #hex with ownTheme). Absent = the theme's pen colour. */
  stroke?: string;
  ownTheme?: boolean;
  points: BPoint[];
  width: number;
}
export interface BShape extends ItemBase, ItemStyle {
  kind: 'shape';
  /** `path` is a polyline through `points` (from/to are its bounding box); `frame` is a titled container (label = title). */
  shape: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'path' | 'frame';
  from: BPoint;
  to: BPoint;
  /** path only: the vertices, absolute board coordinates. */
  points?: BPoint[];
  label?: string;
  /** An arrow bound to an item id on this board, or (architecture board) a node id. */
  fromId?: string;
  toId?: string;
}
export interface BText extends ItemBase {
  kind: 'text';
  /** Text colour: a palette name (or #hex with ownTheme). */
  color?: string;
  fontSize?: BoardFontSize;
  ownTheme?: boolean;
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

/** An SVG hosted on the board: `svg` is the SANITIZED markup (svgSanitize.ts), drawn inline in the w x h box at `at`. */
export interface BSvg extends ItemBase {
  kind: 'svg';
  at: BPoint;
  w: number;
  h: number;
  svg: string;
  /** Short description for screen readers and the item list. */
  label?: string;
}

/** A rendered clip on the board: `src` is a workspace-relative path to an .mp4/.webm/.gif inside the project. */
export interface BVideo extends ItemBase {
  kind: 'video';
  at: BPoint;
  w: number;
  h: number;
  src: string;
  /** A workspace-relative image shown before play (and in the inline preview). */
  poster?: string;
  label?: string;
}

export const SCENE_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type SceneEasing = (typeof SCENE_EASINGS)[number];

/** One keyframe of a scene: at `t` ms the item `target` (another item's id on this board) takes these values. */
export interface SceneKeyframe {
  t: number;
  target: string;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  stroke?: string;
  fill?: string;
  text?: string;
  easing?: SceneEasing;
}

/** A native animated scene: a stage frame (`at`, `w`, `h`) that plays keyframes over other items on the board. */
export interface BScene extends ItemBase {
  kind: 'scene';
  at: BPoint;
  w: number;
  h: number;
  /** Milliseconds, 100..600000. */
  duration: number;
  fps?: number;
  easing?: SceneEasing;
  title?: string;
  ownTheme?: boolean;
  keyframes: SceneKeyframe[];
}

export const MEDIA_EXTS = ['.mp4', '.webm', '.gif'] as const;
export const POSTER_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;
export const SCENE_CAPS = { keyframes: 500, minDuration: 100, maxDuration: 600_000, text: 500 } as const;

export type BoardItem = BStroke | BShape | BText | BNodeRef | BSvg | BVideo | BScene;

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

async function readJsonFileAsync(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
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
    const chats = Array.isArray(m.chats)
      ? [...new Set(m.chats.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 200))].slice(0, 200)
      : [];
    boards.push({
      ...(chats.length > 0 && m.kind === 'whiteboard' ? { chats } : {}),
      ...(m.delivery && typeof m.delivery.chat === 'string' && typeof m.delivery.rev === 'number'
        ? { delivery: { chat: m.delivery.chat, rev: m.delivery.rev } } : {}),
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

/** {@link listBoards} for the request path: no sync filesystem call. */
export async function listBoardsAsync(root: string): Promise<BoardsIndex> {
  return parseIndex(await readJsonFileAsync(path.join(boardsDir(root), 'index.json'))) ?? defaultIndex();
}

/** {@link listBoardsForChat} for the request path. */
export async function listBoardsForChatAsync(root: string, chat: string): Promise<BoardsIndex> {
  const index = await listBoardsAsync(root);
  return { version: 1, boards: index.boards.filter((b) => b.id === ARCH_BOARD_ID || (b.chats ?? []).includes(chat)) };
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
const RESERVED_IDS = new Set(['events', 'edit-log', 'linkable']);

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'board';
}

export function createBoard(root: string, input: { name: unknown; kind?: unknown; chat?: unknown }): BoardMeta {
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
  const chat = typeof input.chat === 'string' && input.chat.trim() ? input.chat.trim().slice(0, 200) : null;
  const meta: BoardMeta = { id, name, kind: 'whiteboard', rev: 0, createdAt: t, updatedAt: t, ...(chat ? { chats: [chat] } : {}) };
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

/** The architecture board (the project's map) and the boards that belong to this chat. */
export function listBoardsForChat(root: string, chat: string): BoardsIndex {
  const index = listBoards(root);
  return { version: 1, boards: index.boards.filter((b) => b.id === ARCH_BOARD_ID || (b.chats ?? []).includes(chat)) };
}

const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * What the add-from picker offers a chat: the other chats' boards grouped by chat, and "earlier" boards (no chats field,
 * from before Spaces were per chat). The never-drawn seeded default is not offered: it holds nothing to lose.
 */
export function linkableBoards(root: string, chat: string): { groups: { chat: string; boards: BoardMeta[] }[]; earlier: BoardMeta[] } {
  const groups = new Map<string, BoardMeta[]>();
  const earlier: BoardMeta[] = [];
  for (const b of listBoards(root).boards) {
    if (b.kind !== 'whiteboard') continue;
    const cs = b.chats ?? [];
    if (cs.length === 0) {
      if (!(b.rev === 0 && b.createdAt === EPOCH)) earlier.push(b);
      continue;
    }
    if (cs.includes(chat)) continue;
    for (const c of cs) groups.set(c, [...(groups.get(c) ?? []), b]);
  }
  return { groups: [...groups].map(([c, boards]) => ({ chat: c, boards })), earlier };
}

/** Add a chat to a board's chats: the same board, linked, not copied. Idempotent. */
export function linkBoard(root: string, id: string, chat: unknown): BoardMeta {
  if (typeof chat !== 'string' || !chat.trim()) throw new BoardError('chat must be a non-empty string');
  if (id === ARCH_BOARD_ID) throw new BoardError('the architecture board is project-wide; it is in every chat already', 409);
  const c = chat.trim().slice(0, 200);
  const index = listBoards(root);
  const meta = index.boards.find((b) => b.id === id);
  if (!meta) throw new BoardError(`no board "${id}"`, 404);
  if ((meta.chats ?? []).includes(c)) return meta;
  const next: BoardMeta = { ...meta, chats: [...(meta.chats ?? []), c] };
  writeIndex(root, { version: 1, boards: index.boards.map((b) => (b.id === id ? next : b)) });
  return next;
}

/** Publish a saved drawing to its chat, without pretending a browser opened it. */
export function deliverBoard(root: string, id: string, chat: string): void {
  const index = listBoards(root);
  const meta = index.boards.find((b) => b.id === id);
  if (!meta || meta.kind !== 'whiteboard') return;
  const next = { ...meta, chats: [...new Set([...(meta.chats ?? []), chat])], delivery: { chat, rev: meta.rev } };
  writeIndex(root, { version: 1, boards: index.boards.map((b) => b.id === id ? next : b) });
}

/** Remove a board from one chat: unlink while another chat holds it, delete with the last one. */
export function removeBoardFromChat(root: string, id: string, chat: unknown): { deleted: boolean } {
  if (id === ARCH_BOARD_ID) throw new BoardError('the architecture board cannot be deleted; clear its drawing instead', 409);
  if (typeof chat !== 'string' || !chat.trim()) throw new BoardError('chat must be a non-empty string');
  const index = listBoards(root);
  const meta = index.boards.find((b) => b.id === id);
  if (!meta) throw new BoardError(`no board "${id}"`, 404);
  const cs = meta.chats ?? [];
  /* A board no chat holds (an earlier one) is in no chat to remove it from: it is not deleted by a chat's remove. */
  if (!cs.includes(chat)) throw new BoardError(`board "${id}" is not in this chat`, 409);
  const rest = cs.filter((c) => c !== chat);
  if (rest.length === 0) {
    deleteBoard(root, id);
    return { deleted: true };
  }
  writeIndex(root, { version: 1, boards: index.boards.map((b) => (b.id === id ? { ...b, chats: rest } : b)) });
  return { deleted: false };
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

function enumOf<T extends string>(v: unknown, list: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new BoardError(`${what} must be one of ${list.join(', ')}`);
  return v as T;
}

/** A colour: a palette name or, with ownTheme, a #hex. */
function colour(v: unknown, what: string, names: readonly string[], ownTheme: boolean): string {
  if (typeof v === 'string' && names.includes(v)) return v;
  if (isHexColor(v)) {
    if (!ownTheme) throw new BoardError(`${what}: raw colour "${v}" is only allowed with ownTheme:true; use a palette name (${names.join(', ')})`);
    return v;
  }
  throw new BoardError(`${what}: unknown colour ${JSON.stringify(v)}; use one of ${names.join(', ')}`);
}

function readStyle(o: Record<string, unknown>): ItemStyle {
  const s: ItemStyle = {};
  const own = o.ownTheme === true;
  if (own) s.ownTheme = true;
  if (o.stroke !== undefined) s.stroke = colour(o.stroke, 'stroke', STROKE_COLORS, own);
  if (o.fill !== undefined) s.fill = colour(o.fill, 'fill', FILL_COLORS, own);
  if (o.strokeWidth !== undefined) s.strokeWidth = Math.min(8, Math.max(1, num(o.strokeWidth, 'strokeWidth')));
  if (o.dash !== undefined) s.dash = enumOf(o.dash, DASHES, 'dash');
  if (o.arrowStart !== undefined) s.arrowStart = enumOf(o.arrowStart, ARROWHEADS, 'arrowStart');
  if (o.arrowEnd !== undefined) s.arrowEnd = enumOf(o.arrowEnd, ARROWHEADS, 'arrowEnd');
  if (o.labelPos !== undefined) s.labelPos = enumOf(o.labelPos, LABEL_POSITIONS, 'labelPos');
  if (o.fontSize !== undefined) s.fontSize = enumOf(o.fontSize, FONT_SIZES, 'fontSize');
  return s;
}

/** Where a write is happening: the project roots a media path may live under, and whether the file must exist now. */
export interface ItemCtx {
  roots: readonly string[];
  mustExist: boolean;
}

const RESERVED_DIRS = ['.sequence', '.git', '.ssh', '.aws', '.gnupg'];

/** True when a project-relative path sits in a folder the file routes never serve: all of .git/.ssh/.aws/.gnupg, and .sequence except .sequence/media/ (judged case-insensitively, as Windows and macOS compare). */
function reservedMediaPath(rel: string): boolean {
  const segs = rel.toLowerCase().split('/');
  const first = segs[0] ?? '';
  if (!RESERVED_DIRS.includes(first)) return false;
  return !(first === '.sequence' && segs[1] === 'media' && segs.length > 2);
}

/**
 * A workspace-relative media path: posix, no absolute form, no drive letter, no `..`, an allow-listed
 * extension, and (on a write) a real file whose real path stays inside a project root.
 */
export function checkMediaPath(v: unknown, what: string, exts: readonly string[], ctx?: ItemCtx): string {
  const raw = str(v, what, 500);
  const rel = raw.replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.includes('\0')) {
    throw new BoardError(`${what} must be a path relative to the project (got ${JSON.stringify(raw)})`);
  }
  if (rel.split('/').some((seg) => seg === '..' || seg === '')) throw new BoardError(`${what} must stay inside the project: no ".." and no empty segments`);
  /* An NTFS alternate data stream (`a.mp4:secret`) is another file under the same name. */
  if (rel.includes(':')) throw new BoardError(`${what} must not contain ":"`);
  if (reservedMediaPath(rel)) throw new BoardError(`${what} is under a reserved folder; clips live in .sequence/media/ or anywhere outside .sequence, .git, .ssh, .aws and .gnupg`);
  const ext = path.extname(rel).toLowerCase();
  if (!exts.includes(ext)) throw new BoardError(`${what} must end in one of ${exts.join(', ')} (got "${ext || 'none'}")`);
  if (ctx?.mustExist) {
    let found = false;
    for (const root of ctx.roots) {
      try {
        const realRoot = fs.realpathSync(root);
        const real = fs.realpathSync(path.resolve(root, rel));
        const inside = path.relative(realRoot, real);
        if (inside.startsWith('..') || path.isAbsolute(inside)) throw new BoardError(`${what} resolves outside the project`);
        if (reservedMediaPath(inside.replace(/\\/g, '/'))) throw new BoardError(`${what} resolves into a reserved folder`);
        const st = fs.statSync(real);
        if (st.isFile() && st.nlink > 1) throw new BoardError(`${what} is a hard link; copy the file instead`);
        if (st.isFile()) found = true;
      } catch (e) {
        if (e instanceof BoardError) throw e;
      }
      if (found) break;
    }
    if (!found) throw new BoardError(`${what}: no file at "${rel}" in the project; render it there first`);
  }
  return rel;
}

const KEYFRAME_KEYS = ['t', 'target', 'x', 'y', 'scale', 'opacity', 'stroke', 'fill', 'text', 'easing'];

function readKeyframe(k: unknown, i: number, duration: number, own: boolean, selfId: string): SceneKeyframe {
  const where = `keyframes[${i}]`;
  if (!k || typeof k !== 'object') throw new BoardError(`${where} must be an object`);
  const o = k as Record<string, unknown>;
  const unknown = Object.keys(o).filter((key) => !KEYFRAME_KEYS.includes(key));
  if (unknown.length > 0) throw new BoardError(`${where}: unknown key${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => JSON.stringify(u)).join(', ')}; a keyframe takes ${KEYFRAME_KEYS.join(', ')}`);
  const t = num(o.t, `${where}.t`);
  if (t < 0 || t > duration) throw new BoardError(`${where}.t must be between 0 and the scene duration (${duration})`);
  const out: SceneKeyframe = { t: Math.round(t), target: str(o.target, `${where}.target`, 300) };
  if (!out.target) throw new BoardError(`${where}.target is required: the id of an item on this board`);
  if (out.target === selfId) throw new BoardError(`${where}.target is the scene itself; a keyframe moves another item on the board`);
  if (o.x !== undefined) out.x = num(o.x, `${where}.x`);
  if (o.y !== undefined) out.y = num(o.y, `${where}.y`);
  if (o.scale !== undefined) {
    const sc = num(o.scale, `${where}.scale`);
    if (sc < 0.01 || sc > 100) throw new BoardError(`${where}.scale must be between 0.01 and 100`);
    out.scale = sc;
  }
  if (o.opacity !== undefined) {
    const op = num(o.opacity, `${where}.opacity`);
    if (op < 0 || op > 1) throw new BoardError(`${where}.opacity must be between 0 and 1`);
    out.opacity = op;
  }
  if (o.stroke !== undefined) out.stroke = colour(o.stroke, `${where}.stroke`, STROKE_COLORS, own);
  if (o.fill !== undefined) out.fill = colour(o.fill, `${where}.fill`, FILL_COLORS, own);
  if (o.text !== undefined) out.text = str(o.text, `${where}.text`, SCENE_CAPS.text);
  if (o.easing !== undefined) out.easing = enumOf(o.easing, SCENE_EASINGS, `${where}.easing`);
  return out;
}

/** One item, checked and normalised. Unknown kinds are refused, not kept. */
export function validateItem(raw: unknown, ctx?: ItemCtx): Check<BoardItem> {
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
    const group = optId(o.group, 'group');
    if (group) base.group = group;
    switch (o.kind) {
      case 'stroke': {
        if (!Array.isArray(o.points) || o.points.length < 2) throw new BoardError('a stroke needs at least 2 points');
        if (o.points.length > BOARD_CAPS.points) throw new BoardError(`a stroke holds at most ${BOARD_CAPS.points} points`);
        const width = o.width === undefined ? 2 : num(o.width, 'width');
        const pen: Pick<BStroke, 'stroke' | 'ownTheme'> = {};
        if (o.ownTheme === true) pen.ownTheme = true;
        if (o.stroke !== undefined) pen.stroke = colour(o.stroke, 'stroke', STROKE_COLORS, o.ownTheme === true);
        return {
          ok: true,
          item: { ...base, kind: 'stroke', points: o.points.map((p, i) => strokePt(p, `points[${i}]`)), width: Math.min(20, Math.max(0.5, width)), ...pen },
        };
      }
      case 'shape': {
        const shape = enumOf(o.shape, ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'path', 'frame'] as const, 'shape');
        let points: BPoint[] | undefined;
        let from: BPoint;
        let to: BPoint;
        if (shape === 'path') {
          if (!Array.isArray(o.points) || o.points.length < 2) throw new BoardError('a path needs at least 2 points');
          if (o.points.length > BOARD_CAPS.points) throw new BoardError(`a path holds at most ${BOARD_CAPS.points} points`);
          points = o.points.map((p, i) => pt(p, `points[${i}]`));
          const xs = points.map((p) => p.x);
          const ys = points.map((p) => p.y);
          /* The box is always derived from the points, whatever the caller sent. */
          from = { x: Math.min(...xs), y: Math.min(...ys) };
          to = { x: Math.max(...xs), y: Math.max(...ys) };
        } else {
          from = pt(o.from, 'from');
          to = pt(o.to, 'to');
        }
        const item: BShape = { ...base, kind: 'shape', shape, from, to, ...readStyle(o), ...(points ? { points } : {}) };
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
        if (o.ownTheme === true) item.ownTheme = true;
        if (o.color !== undefined) item.color = colour(o.color, 'color', STROKE_COLORS, o.ownTheme === true);
        if (o.fontSize !== undefined) item.fontSize = enumOf(o.fontSize, FONT_SIZES, 'fontSize');
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
      case 'svg': {
        let clean: string;
        try {
          clean = sanitizeSvg(o.svg, { idPrefix: `${o.id}~` }).svg;
        } catch (e) {
          if (e instanceof SvgError) throw new BoardError(`svg refused: ${e.message}`);
          throw e;
        }
        const w = num(o.w, 'w');
        const h = num(o.h, 'h');
        if (w < 8 || h < 8 || w > 20000 || h > 20000) throw new BoardError('svg w and h must be between 8 and 20000');
        const item: BSvg = { ...base, kind: 'svg', at: pt(o.at, 'at'), w, h, svg: clean };
        if (o.label !== undefined && o.label !== '') item.label = str(o.label, 'label', BOARD_CAPS.label);
        return { ok: true, item };
      }
      case 'video': {
        const w = num(o.w, 'w');
        const h = num(o.h, 'h');
        if (w < 40 || h < 30 || w > 4000 || h > 4000) throw new BoardError('video w must be 40-4000 and h 30-4000');
        const item: BVideo = { ...base, kind: 'video', at: pt(o.at, 'at'), w, h, src: checkMediaPath(o.src, 'src', MEDIA_EXTS, ctx) };
        if (o.poster !== undefined && o.poster !== '') item.poster = checkMediaPath(o.poster, 'poster', POSTER_EXTS, ctx);
        if (o.label !== undefined && o.label !== '') item.label = str(o.label, 'label', BOARD_CAPS.label);
        return { ok: true, item };
      }
      case 'scene': {
        const w = num(o.w, 'w');
        const h = num(o.h, 'h');
        if (w < 40 || h < 30 || w > 4000 || h > 4000) throw new BoardError('scene w must be 40-4000 and h 30-4000');
        const duration = num(o.duration, 'duration');
        if (duration < SCENE_CAPS.minDuration || duration > SCENE_CAPS.maxDuration) {
          throw new BoardError(`duration must be ${SCENE_CAPS.minDuration}-${SCENE_CAPS.maxDuration} ms`);
        }
        if (!Array.isArray(o.keyframes)) throw new BoardError('keyframes must be an array (it may be empty)');
        if (o.keyframes.length > SCENE_CAPS.keyframes) throw new BoardError(`a scene holds at most ${SCENE_CAPS.keyframes} keyframes`);
        const own = o.ownTheme === true;
        const dur = Math.round(duration);
        const item: BScene = {
          ...base,
          kind: 'scene',
          at: pt(o.at, 'at'),
          w,
          h,
          duration: dur,
          keyframes: o.keyframes.map((k, i) => readKeyframe(k, i, dur, own, String(o.id))),
        };
        if (own) item.ownTheme = true;
        if (o.fps !== undefined) {
          const fps = num(o.fps, 'fps');
          if (fps < 1 || fps > 120) throw new BoardError('fps must be between 1 and 120');
          item.fps = Math.round(fps);
        }
        if (o.easing !== undefined) item.easing = enumOf(o.easing, SCENE_EASINGS, 'easing');
        if (o.title !== undefined && o.title !== '') item.title = str(o.title, 'title', BOARD_CAPS.label);
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
export function applyBoardOps(root: string, id: string, ops: readonly BoardOp[], mediaRoots: readonly string[] = [root]): BoardDoc {
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
      const v = validateItem(op.item, { roots: mediaRoots, mustExist: true });
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
