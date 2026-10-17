/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD EDIT LOG, FROM THE BROWSER'S SIDE
   packages/web2/src/whiteboard/boardEditLog.ts

   Events go to THIS app's own server (`POST /api/boards/edit-log`), which appends
   them to `<project>/.sequence/board-edits.jsonl`. Same origin, a file on the
   person's machine, nothing else: this module has no other destination and a
   test pins that.

   Opt-out: while the Settings switch is off (snapPreference.readEditLogEnabled)
   nothing is queued and nothing is sent. Events are small flat facts (which
   item, how far, which shape), never text and never a stroke's points.

   BEST EFFORT. A failed send drops the batch; the log must never slow or break
   drawing. Events batch for a second so a drag is one POST, not sixty.
   ══════════════════════════════════════════════════════════════════════════ */

import { readEditLogEnabled } from './snapPreference';

export type BoardEditKind =
  | 'add'
  | 'move'
  | 'rename'
  | 'merge'
  | 'delete'
  | 'snap-offered'
  | 'snap-accepted'
  | 'snap-undone'
  | 'snap-dismissed'
  | 'snap-auto';

export interface BoardEditEvent {
  t: number;
  board: string;
  kind: BoardEditKind;
  data?: Record<string, number | string | boolean | null>;
}

const FLUSH_MS = 1000;
let queue: BoardEditEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function send(events: BoardEditEvent[]): Promise<void> {
  try {
    await fetch('/api/boards/edit-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
  } catch {
    /* best effort */
  }
}

/** Send what is queued now. Exported for tests and for page hide. */
export function flushBoardEdits(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const batch = queue.slice(0, 100);
  queue = queue.slice(100);
  if (batch.length === 0) return Promise.resolve();
  return send(batch).then(() => (queue.length > 0 ? flushBoardEdits() : undefined));
}

/** Record one edit, unless the person turned the log off. */
export function logBoardEdit(board: string, kind: BoardEditKind, data?: BoardEditEvent['data']): void {
  if (!readEditLogEnabled()) return;
  queue.push({ t: Date.now(), board, kind, ...(data ? { data } : {}) });
  if (queue.length > 500) queue = queue.slice(-500);
  if (!timer) timer = setTimeout(() => void flushBoardEdits(), FLUSH_MS);
}

/** For tests: forget anything queued. */
export function resetBoardEditQueue(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
}
