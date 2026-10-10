/* ══════════════════════════════════════════════════════════════════════════
   DRAWINGS: the svg and html blocks an agent shows in the chat, kept as assets
   packages/analyzer/src/drawings/drawingStore.ts          (lane visual, v2)

   Each rendered block is a named file under `.sequence/drawings/c-<chat>/` and one
   row in `.sequence/drawings/index.json`:

     { id: "d3", title, chat, turn, kind: "svg"|"html", created, updated,
       versions: [{ v: 1, file: "3-request-path.svg", created }, ...] }

   - Saving text this chat already holds (as ANY version of ANY drawing) returns
     that drawing and version and writes nothing: a reload, a remount or a lazy
     mount is idempotent. Versions come only from NEW text.
   - Saving with an `id` adds a version (`3-request-path-v2.svg`). The id's newest
     version is the one from the latest turn (`at`), not the last one saved.
   - An update is for a drawing of the SAME chat; another chat's drawing only when
     the turn referenced it (`referenced`).
   - NOTHING in index.json is trusted. Every row is validated on read (id, chat,
     file name against fixed patterns, the file's directory against the chat, its
     number against the id, its extension against the kind); a row that fails is
     dropped. The path of a file is then resolved under .sequence/drawings and
     checked with realpath (a symlinked folder or file is refused).
   - The directory is `c-<chat>`, so a chat called `con` or `nul` is not a Windows
     reserved name. Writes to the index take a lock.
   - The agent's MCP tool (`drawings`) reads the same files.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DrawingKind = 'svg' | 'html';

export interface DrawingVersion {
  v: number;
  file: string;
  created: string;
  /** The turn's start time (ms): the newest version is the one with the greatest `at`. */
  at: number;
  turn: string;
  /** Edit from here cut the turn that drew this version: it is hidden (the file stays) until the edit is undone. */
  cut?: true;
}
export interface Drawing {
  id: string;
  title: string;
  chat: string;
  turn: string;
  kind: DrawingKind;
  created: string;
  updated: string;
  versions: DrawingVersion[];
}
export interface DrawingIndex {
  next: number;
  drawings: Drawing[];
}

/** Largest source one drawing may hold, in BYTES (a non-ASCII source is judged by what it weighs on the wire). */
export const DRAWING_MAX_BYTES = 400_000;
export const DRAWING_ID_RE = /^d[0-9]{1,6}$/;
export const DRAWING_CHAT_RE = /^[a-z0-9-]{1,40}$/;
const FILE_RE = /^c-([a-z0-9-]{1,40})\/([0-9]{1,6})-([a-z0-9-]{1,40}?)(?:-v([0-9]{1,4}))?\.(svg|html)$/;

export class DrawingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const drawingsDir = (root: string): string => path.join(root, '.sequence', 'drawings');

const safe = (s: string, fallback: string): string => {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return t || fallback;
};

/** A row the index may hold: every field re-checked, because the file is committed, cloned and written by agents. */
function validRow(r: unknown): Drawing | null {
  if (!r || typeof r !== 'object') return null;
  const d = r as Partial<Drawing>;
  if (typeof d.id !== 'string' || !DRAWING_ID_RE.test(d.id)) return null;
  if (typeof d.chat !== 'string' || !DRAWING_CHAT_RE.test(d.chat)) return null;
  if (d.kind !== 'svg' && d.kind !== 'html') return null;
  if (!Array.isArray(d.versions) || d.versions.length === 0 || d.versions.length > 500) return null;
  const n = d.id.slice(1);
  const versions: DrawingVersion[] = [];
  for (const v of d.versions as Partial<DrawingVersion>[]) {
    if (!v || typeof v.file !== 'string' || !Number.isInteger(v.v)) return null;
    const m = FILE_RE.exec(v.file);
    /* The folder is this chat's, the number is this id's, the extension is this kind's, the -vK is this version's. */
    if (!m || m[1] !== d.chat || m[2] !== n || m[5] !== d.kind) return null;
    if ((m[4] === undefined ? 1 : Number(m[4])) !== v.v) return null;
    versions.push({ v: v.v as number, file: v.file, created: String(v.created ?? ''), at: Number.isFinite(v.at) ? (v.at as number) : 0, turn: typeof v.turn === 'string' ? safe(v.turn, 'turn') : 'turn', ...(v.cut === true ? { cut: true as const } : {}) });
  }
  return {
    id: d.id,
    title: cleanTitle(d.title),
    chat: d.chat,
    turn: typeof d.turn === 'string' ? safe(d.turn, 'turn') : 'turn',
    kind: d.kind,
    created: String(d.created ?? ''),
    updated: String(d.updated ?? ''),
    versions,
  };
}

/** A title as one plain line: control characters and newlines become spaces, `]` goes, at most 80 characters. */
export function cleanTitle(t: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/[\]\[]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function readIndex(root: string): DrawingIndex {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(drawingsDir(root), 'index.json'), 'utf8')) as Partial<DrawingIndex>;
    if (j && Array.isArray(j.drawings)) {
      const drawings = j.drawings.map(validRow).filter((d): d is Drawing => d !== null);
      const top = drawings.reduce((m, d) => Math.max(m, Number(d.id.slice(1))), 0);
      /* `next` is a hint from a file anyone can edit: honour it only inside the id space, else recompute. */
      const hint = Number.isInteger(j.next) && (j.next as number) > top && (j.next as number) <= 999_999 ? (j.next as number) : top + 1;
      return { next: hint, drawings };
    }
  } catch {
    /* none yet */
  }
  return { next: 1, drawings: [] };
}

/** The newest version: the greatest turn time, then the highest number. */
export const newestVersion = (d: Drawing): DrawingVersion => {
  const live = d.versions.filter((v) => !v.cut);
  const from = live.length ? live : d.versions;
  return [...from].sort((a, b) => a.at - b.at || a.v - b.v)[from.length - 1]!;
};

/** A drawing as the app sees it: versions from cut turns are gone, and a drawing with none left is not there at all. */
function visible(d: Drawing): Drawing | null {
  if (!d.versions.some((v) => v.cut)) return d;
  const versions = d.versions.filter((v) => !v.cut);
  return versions.length ? { ...d, versions } : null;
}

/** Resolve a validated version file under the drawings folder; refuse anything that leaves it or goes through a link. */
function safePath(root: string, file: string): string {
  const base = drawingsDir(root);
  const abs = path.resolve(base, file);
  if (!FILE_RE.test(file) || !abs.startsWith(base + path.sep)) throw new DrawingError('not a drawing file');
  let real: string;
  try {
    real = fs.realpathSync(base);
  } catch {
    real = base;
  }
  /* The folder itself (or the chat folder) may be a link: refuse, so a path can never leave the project. */
  for (const part of [path.join(root, '.sequence'), base, path.dirname(abs)]) {
    try {
      if (fs.lstatSync(part).isSymbolicLink()) throw new DrawingError('a drawings folder is a link');
    } catch (e) {
      if (e instanceof DrawingError) throw e;
    }
  }
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile()) throw new DrawingError('a drawing file is a link');
    if (!fs.realpathSync(abs).startsWith(real + path.sep)) throw new DrawingError('a drawing file leaves the folder');
  } catch (e) {
    if (e instanceof DrawingError) throw e;
  }
  return abs;
}

function writeAtomic(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  /* 'wx' fails on anything already there (a planted symlink included) rather than following it; the random suffix
     keeps the name unguessable. */
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

/** A lock around read-modify-write of the index: a directory is the lock (mkdir is atomic), a stale one (10 s) is broken. */
function withLock<T>(root: string, fn: () => T): T {
  const lock = path.join(drawingsDir(root), 'index.lock');
  fs.mkdirSync(drawingsDir(root), { recursive: true });
  const until = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        /* released meanwhile */
      }
      if (Date.now() > until) throw new DrawingError('the drawings index is busy', 503);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

const writeIndex = (root: string, index: DrawingIndex): void => writeAtomic(path.join(drawingsDir(root), 'index.json'), JSON.stringify(index, null, 2));

/* A slug never ends in -v<digits>, so a file's trailing -vK is always its version. */
const fileFor = (chat: string, kind: DrawingKind, n: string, slug: string, v: number): string => `c-${chat}/${n}-${slug.replace(/-v[0-9]+$/, '') || kind}${v > 1 ? `-v${v}` : ''}.${kind}`;

/** A title the person can read: the svg <title>, an html <title>/<h1>, else the first words. */
export function guessTitle(kind: DrawingKind, source: string): string {
  const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(source) ?? (kind === 'html' ? /<h[1-3][^>]*>([^<]{1,80})<\/h[1-3]>/i.exec(source) : null);
  const t = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return t || (kind === 'svg' ? 'Drawing' : 'Page');
}

export interface SaveInput {
  chat: string;
  turn?: string;
  /** The turn's start time (ms); orders versions. */
  at?: number;
  kind: DrawingKind;
  source: string;
  title?: string;
  /** Update this drawing: a new version, not a new drawing. */
  id?: string;
  /** The turn's message named `@drawing:<id>`: allows updating a drawing of another chat. */
  referenced?: boolean;
}

export function listDrawings(root: string, filter: { chat?: string } = {}): Drawing[] {
  const all = readIndex(root).drawings.map(visible).filter((d): d is Drawing => d !== null);
  return filter.chat ? all.filter((d) => d.chat === safe(filter.chat!, 'chat')) : all;
}

export function findDrawing(root: string, id: string): Drawing | null {
  const d = readIndex(root).drawings.find((x) => x.id === id);
  return d ? visible(d) : null;
}

const read = (root: string, v: DrawingVersion): string | null => {
  try {
    return fs.readFileSync(safePath(root, v.file), 'utf8');
  } catch {
    return null;
  }
};

/** The source of one version (the newest by default), or null. */
export function readDrawing(root: string, id: string, version?: number): { drawing: Drawing; version: DrawingVersion; source: string } | null {
  if (!DRAWING_ID_RE.test(id)) return null;
  const drawing = findDrawing(root, id);
  if (!drawing) return null;
  const ver = version === undefined ? newestVersion(drawing) : drawing.versions.find((x) => x.v === version);
  if (!ver) return null;
  const source = read(root, ver);
  return source === null ? null : { drawing, version: ver, source };
}

/** The spec a kit drawing carries inside itself (<!--visual {json}-->), or null. */
const embeddedSpec = (source: string): string | null => /^<svg [^>]*>\s*<!--visual (\{[^]*?\})-->/.exec(source.slice(0, 200_000))?.[1] ?? null;

/** A version holding this text, or (for a kit drawing) the same spec: replaying a chat after the kit's output changed must not mint a copy of every visual. */
const holds = (root: string, d: Drawing, source: string): DrawingVersion | null => {
  const spec = embeddedSpec(source);
  return d.versions.find((v) => {
    if (v.cut) return false;
    const have = read(root, v);
    return have === source || (spec !== null && (have === null ? null : embeddedSpec(have)) === spec);
  }) ?? null;
};

/** Save a drawing: new, a version of `id`, or the existing one when this chat already holds that text. */
export function saveDrawing(root: string, input: SaveInput): { drawing: Drawing; created: boolean; version: number } {
  if (input.kind !== 'svg' && input.kind !== 'html') throw new DrawingError('kind must be svg or html');
  if (typeof input.source !== 'string' || input.source.trim() === '') throw new DrawingError('source is empty');
  if (Buffer.byteLength(input.source, 'utf8') > DRAWING_MAX_BYTES) throw new DrawingError(`source is over ${DRAWING_MAX_BYTES} bytes`, 413);
  const chat = safe(String(input.chat ?? ''), 'chat');
  const turn = safe(String(input.turn ?? ''), 'turn');
  const at = Number.isFinite(input.at) ? (input.at as number) : Date.now();
  return withLock(root, () => {
    const index = readIndex(root);
    const now = new Date().toISOString();

    if (input.id !== undefined) {
      if (!DRAWING_ID_RE.test(input.id)) throw new DrawingError('not a drawing id');
      const d = index.drawings.find((x) => x.id === input.id && visible(x) !== null);
      if (!d) throw new DrawingError(`no drawing "${input.id}"`, 404);
      if (d.kind !== input.kind) throw new DrawingError(`"${d.id}" is ${d.kind}; an update must stay ${d.kind}`);
      if (d.chat !== chat && input.referenced !== true) throw new DrawingError(`"${d.id}" belongs to another chat; reference it in your message to change it`, 403);
      const have = holds(root, d, input.source);
      if (have) return { drawing: visible(d)!, created: false, version: have.v };
      const v = Math.max(...d.versions.map((x) => x.v)) + 1;
      const n = d.id.slice(1);
      const file = fileFor(d.chat, d.kind, n, safe(d.title, d.kind), v);
      writeAtomic(safePath(root, file), input.source);
      d.versions.push({ v, file, created: now, at, turn });
      d.updated = now;
      writeIndex(root, index);
      return { drawing: visible(d)!, created: false, version: v };
    }

    for (const d of index.drawings) {
      if (d.chat !== chat || d.kind !== input.kind) continue;
      const have = holds(root, d, input.source);
      if (have) return { drawing: visible(d)!, created: false, version: have.v };
    }
    const n = String(index.next);
    const title = cleanTitle(input.title) || cleanTitle(guessTitle(input.kind, input.source));
    const d: Drawing = { id: `d${n}`, title, chat, turn, kind: input.kind, created: now, updated: now, versions: [] };
    const file = fileFor(chat, input.kind, n, safe(title, input.kind), 1);
    writeAtomic(safePath(root, file), input.source);
    d.versions.push({ v: 1, file, created: now, at, turn });
    index.drawings.push(d);
    index.next += 1;
    writeIndex(root, index);
    return { drawing: d, created: true, version: 1 };
  });
}

/** The file name a drawing shows on its card: `3-request-path.svg` (newest version's). */
export const drawingFileName = (d: Drawing): string => newestVersion(d).file.split('/')[1]!;

/** The file name of ONE version (a card for v1 keeps showing v1's file after v2 is saved). */
export const versionFileName = (d: Drawing, v: number): string => (d.versions.find((x) => x.v === v) ?? newestVersion(d)).file.split('/')[1]!;

/**
 * Edit from here: hide every version of this chat's drawings that a cut turn made (those saved at or after `sinceMs`,
 * the start of the first turn cut). The files stay, as the rewind lane keeps what it cuts; Undo brings them back.
 * Returns how many versions were hidden.
 */
export function cutDrawingsSince(root: string, chat: string, sinceMs: number): number {
  return markCut(root, chat, sinceMs, true);
}

/** Undo of an edit: the versions that cut hid come back. */
export function uncutDrawingsSince(root: string, chat: string, sinceMs: number): number {
  return markCut(root, chat, sinceMs, false);
}

/** The page and the server stamp a turn's start a moment apart. */
const SKEW_MS = 1000;

function markCut(root: string, chatId: string, sinceMs: number, cut: boolean): number {
  if (!Number.isFinite(sinceMs) || !fs.existsSync(path.join(drawingsDir(root), 'index.json'))) return 0;
  const chat = safe(chatId, 'chat');
  return withLock(root, () => {
    const index = readIndex(root);
    let n = 0;
    for (const d of index.drawings) {
      if (d.chat !== chat) continue;
      for (const v of d.versions) {
        /* Made by a cut turn: the turn it was shown in (`at`) began at or after the cut, and it was saved after that.
           (An imported chat's drawings are saved when first viewed, so the saving time alone would take them all.) */
        const t = Date.parse(v.created);
        if (!Number.isFinite(t) || t < sinceMs - SKEW_MS || v.at < sinceMs - SKEW_MS || (v.cut === true) === cut) continue;
        if (cut) v.cut = true;
        else delete v.cut;
        n += 1;
      }
    }
    if (n > 0) writeIndex(root, index);
    return n;
  });
}
