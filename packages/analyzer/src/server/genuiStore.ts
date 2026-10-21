/* ══════════════════════════════════════════════════════════════════════════
   SAVED SURFACES: the settled card of a turn, kept with the chat
   packages/analyzer/src/server/genuiStore.ts

   What is kept is the FINAL spec of a surface, not the op stream: a reload draws the stored spec once and nothing
   replays. One file per chat, `.sequence/genui/c-<chat>.json`:

     { v: 1, surfaces: [{ turn, surface, saved, title, spec }] }       keyed by (turn, surface)

   - Saving the same (turn, surface) again replaces it: the newest settled spec wins, so a surface the agent
     keeps updating after a first settle ends as its last one.
   - NOTHING is stored that would not draw: the spec must pass the strict `final` validation of @sequence/genui
     and stay inside the limits (200 elements, 8 surfaces a turn). A refused save changes nothing.
   - NOTHING in the file is trusted on read: the shape of every row is re-checked, a row that fails is dropped,
     and the client validates a spec again before it draws a node (invalid nodes become skeletons).
   - Same ground rules as the drawings store (drawings/drawingStore.ts): a chat id is `[a-z0-9-]{1,40}` so the
     file name cannot be a Windows device name or leave the folder, a link in the path is refused, writes are
     atomic (temp file, rename) and serialized with a lock.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { GENUI_LIMITS, validateSpec, type UISpec } from '@sequence/genui';

import { DRAWING_CHAT_RE } from '../drawings/drawingStore.js';

export interface SavedSurface {
  chat: string;
  turn: string;
  surface: string;
  /** When it was saved (ms). */
  saved: number;
  /** The card's title (its root's `title`/`text`, or the surface id), for a list of saved artifacts. */
  title: string;
  spec: UISpec;
}

export class GenuiStoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const GENUI_CHAT_RE = DRAWING_CHAT_RE;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The most one saved spec may weigh, and the most surfaces one chat keeps (the oldest go first). */
export const GENUI_SPEC_MAX_BYTES = 200_000;
export const GENUI_CHAT_MAX_SURFACES = 300;

export const genuiDir = (root: string): string => path.join(root, '.sequence', 'genui');
const fileOf = (root: string, chat: string): string => path.join(genuiDir(root), `c-${chat}.json`);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A spec has the shape the validator needs, or it is not a spec. */
function shapeOk(spec: unknown): spec is UISpec {
  if (!isObj(spec)) return false;
  if (spec.root !== null && typeof spec.root !== 'string') return false;
  if (!isObj(spec.elements) || !isObj(spec.state) || !isObj(spec.actions) || !isObj(spec.meta)) return false;
  for (const el of Object.values(spec.elements)) {
    if (!isObj(el) || typeof el.type !== 'string' || !isObj(el.props)) return false;
    if (el.children !== undefined && (!Array.isArray(el.children) || el.children.some((c) => typeof c !== 'string'))) return false;
  }
  return true;
}

const titleOf = (spec: UISpec, fallback: string): string => {
  const root = spec.root ? spec.elements[spec.root] : undefined;
  const t = root?.props.title ?? root?.props.text ?? spec.meta.title;
  // eslint-disable-next-line no-control-regex
  const clean = (typeof t === 'string' ? t : '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || fallback;
};

function rowOk(chat: string, r: unknown): SavedSurface | null {
  if (!isObj(r) || typeof r.turn !== 'string' || !KEY_RE.test(r.turn) || typeof r.surface !== 'string' || !KEY_RE.test(r.surface)) return null;
  if (!shapeOk(r.spec) || Object.keys(r.spec.elements).length > GENUI_LIMITS.elementsPerSurface) return null;
  return { chat, turn: r.turn, surface: r.surface, saved: Number.isFinite(r.saved) ? (r.saved as number) : 0, title: titleOf(r.spec, r.surface), spec: r.spec };
}

/** Refuse a path that goes through a link, so the store can never write outside the project. */
function assertNoLinks(root: string, file: string): void {
  for (const part of [path.join(root, '.sequence'), genuiDir(root), file]) {
    try {
      if (fs.lstatSync(part).isSymbolicLink()) throw new GenuiStoreError('a genui folder is a link', 400);
    } catch (e) {
      if (e instanceof GenuiStoreError) throw e;
    }
  }
}

function readRows(root: string, chat: string): SavedSurface[] {
  const file = fileOf(root, chat);
  try {
    assertNoLinks(root, file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { surfaces?: unknown };
    if (!Array.isArray(j.surfaces)) return [];
    return j.surfaces.map((r) => rowOk(chat, r)).filter((r): r is SavedSurface => r !== null);
  } catch (e) {
    if (e instanceof GenuiStoreError) throw e;
    return [];
  }
}

function writeAtomic(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

const LOCK_WAIT_MS = 300;
const LOCK_STALE_MS = 3000;

function withLock<T>(root: string, chat: string, fn: () => T): T {
  /* A link anywhere in the path is refused BEFORE a folder is created through it. */
  assertNoLinks(root, fileOf(root, chat));
  const lock = path.join(genuiDir(root), `c-${chat}.lock`);
  fs.mkdirSync(genuiDir(root), { recursive: true });
  /* The guarded section is one small file read and write (milliseconds). A short wait, because the wait below blocks the loop. */
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        /* released meanwhile */
      }
      if (Date.now() > until) throw new GenuiStoreError('the saved surfaces are busy', 503);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** The saved surfaces of a chat, oldest first. An unknown chat, or a chat id that cannot be one, has none. */
export function listSurfaces(root: string, chat: string): SavedSurface[] {
  if (!GENUI_CHAT_RE.test(chat)) return [];
  return readRows(root, chat).sort((a, b) => a.saved - b.saved);
}

export interface SaveInput {
  chat: string;
  turn: string;
  surface: string;
  spec: unknown;
  at?: number;
}

/** Keep the final spec of (turn, surface). `created` is false when it replaced an earlier settle. */
export function saveSurface(root: string, input: SaveInput): { created: boolean; saved: SavedSurface } {
  if (!GENUI_CHAT_RE.test(input.chat)) throw new GenuiStoreError('chat must be 1 to 40 characters of a-z, 0-9 and -');
  if (!KEY_RE.test(input.turn) || !KEY_RE.test(input.surface)) throw new GenuiStoreError('turn and surface must be short plain ids');
  if (!shapeOk(input.spec)) throw new GenuiStoreError('spec is not a surface spec');
  const spec = input.spec;
  if (Object.keys(spec.elements).length > GENUI_LIMITS.elementsPerSurface) throw new GenuiStoreError(`a surface holds at most ${GENUI_LIMITS.elementsPerSurface} elements`, 422);
  if (Buffer.byteLength(JSON.stringify(spec)) > GENUI_SPEC_MAX_BYTES) throw new GenuiStoreError(`a surface is at most ${GENUI_SPEC_MAX_BYTES} bytes`, 413);
  if (!spec.root) throw new GenuiStoreError('an empty surface is not kept', 422);
  const v = validateSpec(spec, 'final');
  if (!v.ok) throw new GenuiStoreError(`only a valid, settled surface is kept: ${v.issues.find((i) => i.severity === 'error')?.message ?? 'invalid'}`, 422);
  return withLock(root, input.chat, () => {
    const rows = readRows(root, input.chat);
    const at = Number.isFinite(input.at) ? (input.at as number) : Date.now();
    const saved: SavedSurface = { chat: input.chat, turn: input.turn, surface: input.surface, saved: at, title: titleOf(spec, input.surface), spec };
    const i = rows.findIndex((r) => r.turn === input.turn && r.surface === input.surface);
    if (i >= 0) rows[i] = saved;
    else {
      /* A turn opens at most so many cards; the server holds the same line the session does. */
      if (rows.filter((r) => r.turn === input.turn).length >= GENUI_LIMITS.surfacesPerTurn) throw new GenuiStoreError(`a turn keeps at most ${GENUI_LIMITS.surfacesPerTurn} surfaces`, 422);
      rows.push(saved);
    }
    const kept = rows.sort((a, b) => a.saved - b.saved).slice(-GENUI_CHAT_MAX_SURFACES);
    const file = fileOf(root, input.chat);
    assertNoLinks(root, file);
    writeAtomic(file, JSON.stringify({ v: 1, surfaces: kept.map(({ chat: _c, ...r }) => r) }));
    return { created: i < 0, saved };
  });
}
