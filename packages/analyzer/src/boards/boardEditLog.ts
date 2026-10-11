/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD EDIT LOG — what a person did on a board, kept on their own disk
   packages/analyzer/src/boards/boardEditLog.ts

     <root>/.sequence/board-edits.jsonl     one JSON event per line, append-only

   WHY IT EXISTS. Nothing recorded an edit: the store keeps the current
   document and a revision counter, and layout memory keeps final positions.
   Two things a small model could learn from are lost the moment they happen:
   whether a person kept a tidy-up or took it back (so the shape recognizer can
   be retrained on one person's hand), and the order of moves, renames and
   merges (so a next-edit suggestion could ever be scoped, candidate (c) of
   the board-models study).

   LOCAL, AND NEVER SENT ANYWHERE. This file is written by the app server on
   the person's machine, under their project's `.sequence` folder, and read by
   nothing that talks to a network. There is no upload, no sync and no
   telemetry path here, and a test (board-edit-log.test.ts) greps the module
   for a network import so that stays true.

   OPT-OUT. The web app does not send events while its switch is off
   (Settings > Whiteboard). `SEQUENCE_BOARD_EDIT_LOG=0` in the server's
   environment, or an empty file `.sequence/board-edits.off`, makes the server
   record nothing either. Deleting the log is deleting that file.

   WHAT AN EVENT HOLDS. A time, a board id, a kind, and small numbers or ids
   (which item, how far it moved, what shape a stroke became). Never the text
   somebody typed, never a stroke's points: a rename records that it happened
   and the length of the new name, not the name.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

export const BOARD_EDIT_KINDS = [
  'add',
  'move',
  'rename',
  'merge',
  'delete',
  'snap-offered',
  'snap-accepted',
  'snap-undone',
  'snap-dismissed',
  'snap-auto',
] as const;
export type BoardEditKind = (typeof BOARD_EDIT_KINDS)[number];

export interface BoardEditEvent {
  /** Milliseconds since the epoch, on the person's clock. */
  t: number;
  /** Board id, or "architecture". */
  board: string;
  kind: BoardEditKind;
  /** Small, flat, non-textual facts about the edit. */
  data?: Record<string, number | string | boolean | null>;
}

export const BOARD_EDIT_CAPS = {
  /** Events per request. */
  batch: 100,
  /** Bytes of one event after JSON. */
  event: 1024,
  /** When the log passes this many bytes it is moved to board-edits.1.jsonl (replacing the last one). */
  fileBytes: 5 * 1024 * 1024,
} as const;

export function boardEditLogPath(root: string): string {
  return path.join(root, '.sequence', 'board-edits.jsonl');
}

/** True unless the person (or the environment) turned the log off. */
export function boardEditLogEnabled(root: string): boolean {
  if (process.env.SEQUENCE_BOARD_EDIT_LOG === '0') return false;
  return !fs.existsSync(path.join(root, '.sequence', 'board-edits.off'));
}

export class EditLogError extends Error {
  status = 400;
}

function clean(raw: unknown): BoardEditEvent {
  if (!raw || typeof raw !== 'object') throw new EditLogError('event must be an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.t !== 'number' || !Number.isFinite(o.t)) throw new EditLogError('event.t must be a number');
  if (typeof o.board !== 'string' || o.board.length === 0 || o.board.length > 64) throw new EditLogError('event.board must be a board id');
  if (!BOARD_EDIT_KINDS.includes(o.kind as BoardEditKind)) throw new EditLogError(`event.kind must be one of ${BOARD_EDIT_KINDS.join(', ')}`);
  const event: BoardEditEvent = { t: Math.round(o.t), board: o.board, kind: o.kind as BoardEditKind };
  if (o.data !== undefined) {
    if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) throw new EditLogError('event.data must be an object');
    const data: Record<string, number | string | boolean | null> = {};
    for (const [k, v] of Object.entries(o.data as Record<string, unknown>)) {
      if (k.length > 40) throw new EditLogError('event.data keys are short');
      if (v === null || typeof v === 'boolean') data[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) data[k] = Math.round(v * 1000) / 1000;
      else if (typeof v === 'string') data[k] = v.slice(0, 80);
      else throw new EditLogError('event.data values are numbers, short strings, booleans or null');
    }
    event.data = data;
  }
  if (JSON.stringify(event).length > BOARD_EDIT_CAPS.event) throw new EditLogError('event is too large');
  return event;
}

/** Append events. Returns how many were written (0 when logging is off). */
export function appendBoardEdits(root: string, raw: unknown): number {
  if (!Array.isArray(raw)) throw new EditLogError('events must be a list');
  if (raw.length > BOARD_EDIT_CAPS.batch) throw new EditLogError(`at most ${BOARD_EDIT_CAPS.batch} events per request`);
  const events = raw.map(clean);
  if (events.length === 0 || !boardEditLogEnabled(root)) return 0;
  const file = boardEditLogPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > BOARD_EDIT_CAPS.fileBytes) {
      fs.renameSync(file, path.join(path.dirname(file), 'board-edits.1.jsonl'));
    }
  } catch {
    /* no log yet */
  }
  fs.appendFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return events.length;
}

/** The recorded events, oldest first (the rotated file is not read). */
export function readBoardEdits(root: string, limit = 5000): BoardEditEvent[] {
  try {
    const lines = fs.readFileSync(boardEditLogPath(root), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).flatMap((l) => {
      try {
        return [JSON.parse(l) as BoardEditEvent];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
