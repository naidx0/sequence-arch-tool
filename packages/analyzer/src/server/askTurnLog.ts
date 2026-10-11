/* ══════════════════════════════════════════════════════════════════════════
   A TURN THAT OUTLIVES ITS CONNECTION
   packages/analyzer/src/server/askTurnLog.ts

   Close the tab, sleep the laptop or lose wifi mid-answer and the turn was
   gone — along with everything it had already read and everything it had
   already cost.

   ── THE COST WAS ALREADY BEING PAID ──────────────────────────────────────

   It would be reasonable to assume the tradeoff here is "keep working after a
   disconnect and burn provider spend on an abandoned tab". It is not, and the
   code says so: `requestAbort(res)` builds an AbortController from the socket
   close, hands the signal to the provider layer, and `ProviderStreamOptions`
   declares only `onDelta` — there is no `signal` in `provider.ts` at all.

   So the provider call ALREADY runs to completion after the socket dies. The
   old behaviour was the worst of both: the answer was paid for and thrown
   away. Writing it down is not a new cost, it is stopping the waste.

   ── THE PATTERN IS THE ONE ALREADY PROVEN HERE ───────────────────────────

   `programRunStore` solved this for program runs: an id-numbered append-only
   log, committed BEFORE the event is written to any socket, and a `?since=`
   replay. Its own header calls out the ask stream as the counterexample —
   `data:` with no `id:` line — and names that as exactly why a blip loses the
   turn. This is that pattern, for asks.

   COMMIT BEFORE YIELD is the whole discipline. The append happens first and
   the socket write second, so an event a client saw is always an event on
   disk. The other order produces the one unrecoverable case: a client that
   received event 7, reconnects asking for 8, and is told the turn only ever
   reached 6.

   ── BOUNDED, LIKE EVERY OTHER STORE HERE ─────────────────────────────────

   One log per turn, swept to the newest {@link ASK_TURN_KEEP}. A machine that
   never closes the app must not accumulate every answer it has ever streamed.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const SEQUENCE_DIR = '.sequence';
const ASK_TURNS_DIR = 'ask-turns';
const EVENTS_FILE = 'events.ndjson';

/** How many turns' logs are kept. Older ones are swept on the next open. */
export const ASK_TURN_KEEP = 50;

/** One recorded event: whatever was streamed, plus the cursor a client replays from. */
export interface AskTurnEvent {
  seq: number;
  at: number;
  event: Record<string, unknown>;
}

export interface AskTurnLog {
  /** Append and return the committed event. Call BEFORE writing to the socket. */
  append(event: Record<string, unknown>): AskTurnEvent;
  lastSeq(): number;
}

/**
 * The run id is a DIRECTORY NAME, so this is the jail.
 *
 * Matches the shape `newRunId` produces. Anything else is refused rather than
 * sanitised — stripping a traversal turns a hostile id into a plausible one
 * and the caller can no longer tell it was ever hostile.
 */
export function isAskTurnId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function turnsRoot(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, ASK_TURNS_DIR);
}

function turnDir(repoRoot: string, runId: string): string {
  if (!isAskTurnId(runId)) throw new Error(`not a usable turn id: ${String(runId)}`);
  return path.join(turnsRoot(repoRoot), runId);
}

/**
 * Open (or reopen) the log for one turn.
 *
 * Reopening continues the sequence rather than restarting it — a turn resumed
 * after a restart must not hand out seq 1 twice, or a replaying client would
 * silently skip everything between.
 */
export function openAskTurnLog(repoRoot: string, runId: string, now: () => number = Date.now): AskTurnLog {
  const dir = turnDir(repoRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  sweep(repoRoot);
  const file = path.join(dir, EVENTS_FILE);
  let seq = readAskTurnEvents(repoRoot, runId).reduce((max, e) => Math.max(max, e.seq), 0);
  return {
    append(event: Record<string, unknown>): AskTurnEvent {
      seq += 1;
      const record: AskTurnEvent = { seq, at: now(), event };
      /* Synchronous on purpose. The point of this file is that the event is on
         disk before the socket sees it; an async write would put the socket
         first on exactly the crash this exists for. */
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      return record;
    },
    lastSeq: () => seq,
  };
}

/**
 * Every committed event for a turn, oldest first.
 *
 * AN UNPARSEABLE LINE IS SKIPPED, not surfaced as a half-event: a replayed row
 * is a claim that this is what the turn emitted, and half a line is not.
 * A torn final line is the ordinary consequence of a crash mid-append, which
 * is precisely the case this store exists to survive.
 */
export function readAskTurnEvents(repoRoot: string, runId: string, since = 0): AskTurnEvent[] {
  if (!isAskTurnId(runId)) return [];
  let text: string;
  try {
    text = fs.readFileSync(path.join(turnDir(repoRoot, runId), EVENTS_FILE), 'utf8');
  } catch {
    return [];
  }
  const out: AskTurnEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isAskTurnEvent(parsed)) continue;
    if (parsed.seq > since) out.push(parsed);
  }
  return out;
}

function isAskTurnEvent(v: unknown): v is AskTurnEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<AskTurnEvent>;
  return typeof e.seq === 'number' && typeof e.at === 'number' && typeof e.event === 'object' && e.event !== null;
}

/** Whether a turn has any recorded events at all. */
export function askTurnExists(repoRoot: string, runId: string): boolean {
  if (!isAskTurnId(runId)) return false;
  try {
    return fs.existsSync(path.join(turnDir(repoRoot, runId), EVENTS_FILE));
  } catch {
    return false;
  }
}

/** Keep the newest {@link ASK_TURN_KEEP} turn logs; delete the rest. */
function sweep(repoRoot: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(turnsRoot(repoRoot));
  } catch {
    return;
  }
  if (names.length <= ASK_TURN_KEEP) return;
  const dated = names
    .map((name) => {
      try {
        return { name, at: fs.statSync(path.join(turnsRoot(repoRoot), name)).mtimeMs };
      } catch {
        return { name, at: 0 };
      }
    })
    .sort((a, b) => b.at - a.at);
  for (const old of dated.slice(ASK_TURN_KEEP)) {
    try {
      fs.rmSync(path.join(turnsRoot(repoRoot), old.name), { recursive: true, force: true });
    } catch {
      /* Already gone, or in use. Sweeping is best effort and must never
         interfere with the turn currently being written. */
    }
  }
}
