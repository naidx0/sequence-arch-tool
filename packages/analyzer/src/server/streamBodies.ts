/* ══════════════════════════════════════════════════════════════════════════
   S6 — BOUNDED PAYLOADS: A CARD CARRIES ITS FIRST 8 KB, THE REST ON EXPAND
   packages/analyzer/src/server/streamBodies.ts

   A tool's output, a diff or a file body can be megabytes, and it rode the
   stream whole into a card that is usually collapsed. Now any such string
   over STREAM_BODY_CAP_BYTES is cut to its first 8 KB (on a character
   boundary) and the event says so in a `capped` list beside the fields it
   already had:

     capped: [{ at: ['update','update','rawOutput','aggregatedOutput'],
                id: '<32 hex>', bytes: 812345, shownBytes: 8190 }]

   The field stays a string in the same place, so a client that knows nothing
   of this still renders (the start of) it. The whole body is written to disk
   under the repo's .sequence/, beside the chat it belongs to, and
   GET /api/stream-body?id=<id>&chat=<chat> serves it, so expanding a card
   works after a restart and on a resumed thread too.

   What is NOT capped: text deltas (they are small and they are the reply),
   approval requests (a person must see the whole of what they approve), an
   `edit:proposal` (its content is what gets written), and the turn's result.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { SEQUENCE_DIR } from './store.js';

export const STREAM_BODY_CAP_BYTES = 8 * 1024;
export const STREAM_BODIES_DIR = 'stream-bodies';

export interface CappedBody {
  /** Where the field is in the event, as keys and array indexes. */
  at: (string | number)[];
  id: string;
  /** The whole body's UTF-8 length. */
  bytes: number;
  /** The UTF-8 length of what the event carries. */
  shownBytes: number;
}

type Json = Record<string, unknown>;

const BODY_ID = /^[0-9a-f]{32}$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isStreamBodyId(id: unknown): id is string {
  return typeof id === 'string' && BODY_ID.test(id);
}

/**
 * Where a turn's bodies go: beside its chat (`.sequence/sessions/<chat>/
 * stream-bodies`) with a repo and a chat, the repo's `.sequence/stream-bodies`
 * with a repo only, and the user store with neither.
 */
export function streamBodyDir(where: { repoRoot: string | null; chatId: string | null; userConfigDir: string }): string {
  if (where.repoRoot && where.chatId && CHAT_ID.test(where.chatId)) {
    return path.join(where.repoRoot, SEQUENCE_DIR, 'sessions', where.chatId, STREAM_BODIES_DIR);
  }
  if (where.repoRoot) return path.join(where.repoRoot, SEQUENCE_DIR, STREAM_BODIES_DIR);
  return path.join(where.userConfigDir, STREAM_BODIES_DIR);
}

/** The directories a GET looks in, most specific first. */
export function streamBodyDirs(where: { repoRoot: string | null; chatId: string | null; userConfigDir: string }): string[] {
  const dirs = [streamBodyDir(where)];
  if (where.repoRoot) dirs.push(path.join(where.repoRoot, SEQUENCE_DIR, STREAM_BODIES_DIR));
  dirs.push(path.join(where.userConfigDir, STREAM_BODIES_DIR));
  return [...new Set(dirs)];
}

/** The first `cap` bytes of `s` as UTF-8, never splitting a character. */
export function utf8Prefix(s: string, cap: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= cap) return s;
  let end = cap;
  /* Back up over continuation bytes (10xxxxxx) to a character start. */
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/** Persist one body by its content id. False when it could not be written. */
function persist(dir: string, id: string, body: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.txt`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(body, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Cap every string over the limit inside `value` (walked in place on a copy),
 * recording each in `capped` with `at` relative to `base`.
 */
function capWithin(value: unknown, at: (string | number)[], dir: string, capped: CappedBody[], cap: number): unknown {
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes <= cap) return value;
    const id = crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
    /* A body that cannot be kept for later is sent whole: a cut with no way
       to the rest would lose it. */
    if (!persist(dir, id, value)) return value;
    const shown = utf8Prefix(value, cap);
    capped.push({ at, id, bytes, shownBytes: Buffer.byteLength(shown, 'utf8') });
    return shown;
  }
  if (Array.isArray(value)) return value.map((v, i) => capWithin(v, [...at, i], dir, capped, cap));
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) out[k] = capWithin(v, [...at, k], dir, capped, cap);
    return out;
  }
  return value;
}

const ACP_BODY_KINDS = new Set(['tool_call', 'tool_call_update']);

/**
 * run-node: a tool call or tool call update with a string over the cap (its
 * output, a diff's old or new text, a file body) is cut, and the event lists
 * what was cut. Everything else is returned as the same object.
 */
export function capAcpEvent(event: Json, dir: string, cap = STREAM_BODY_CAP_BYTES): Json {
  if (event.type !== 'acp:update') return event;
  const n = event.update as Json | undefined;
  const u = n?.update as Json | undefined;
  if (!u || !ACP_BODY_KINDS.has(String(u.sessionUpdate))) return event;
  if (Buffer.byteLength(JSON.stringify(u), 'utf8') <= cap) return event;
  const capped: CappedBody[] = [];
  const next = capWithin(u, ['update', 'update'], dir, capped, cap) as Json;
  if (capped.length === 0) return event;
  return { ...event, update: { ...n, update: next }, capped };
}

/** The ask stream: a `command:log`'s output. */
export function capAskEvent<E extends { type: string }>(event: E, dir: string, cap = STREAM_BODY_CAP_BYTES): E {
  if (event.type !== 'command:log') return event;
  const output = (event as unknown as { output?: unknown }).output;
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') <= cap) return event;
  const capped: CappedBody[] = [];
  const shown = capWithin(output, ['output'], dir, capped, cap);
  if (capped.length === 0) return event;
  return { ...event, output: shown, capped };
}

/** The whole body by id, from the first directory that has it; null when none does. */
export function readStreamBody(dirs: readonly string[], id: string): Buffer | null {
  if (!isStreamBodyId(id)) return null;
  for (const dir of dirs) {
    try {
      return fs.readFileSync(path.join(dir, `${id}.txt`));
    } catch {
      /* not here */
    }
  }
  return null;
}
