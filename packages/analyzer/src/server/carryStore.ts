/* ══════════════════════════════════════════════════════════════════════════
   WHERE A TURN'S CARRY LIVES BETWEEN TURNS
   packages/analyzer/src/server/carryStore.ts

   ── THE BUG THIS FIXES ───────────────────────────────────────────────────

   `askPipeline` computes `carryOut` on every turn and hands it back. Its own
   comment says "it is the CALLER's job to persist it and pass it back" — and
   until this module, **no caller in the product did**. Both `/api/ask` routes
   built their input without `carry`, and `carryOut` was stripped from the
   payload as an internal field and dropped on the floor. Only the bench
   (`tools/bench/teach-eval.mjs`) ever threaded it.

   So every turn a person has ever taken ran with `input.carry === undefined`,
   and every bench number about the carry describes a mechanism the product does
   not run. That is recorded in `docs/research/carry-redesign-registration.md`.

   ── WHAT IT IS KEYED ON, AND THE TRAP THAT IS NOT ────────────────────────

   THE RESOLVED THREAD ID. Not `sessionId`.

   `sessionId` on the ask route is the AUTHENTICATED USER — `repoServer.ts` has
   a comment recording someone already being caught by that name. Keying a carry
   on it would hand one conversation's material to a DIFFERENT conversation of
   the same person: the file names they looked at, the list they were shown, the
   concepts they were taught. That is a privacy fault rather than a quality one,
   it is invisible in any single-conversation test, and `separateThreads` below
   exists so it cannot be introduced silently.

   A turn with NO resolvable thread gets NO carry. There is deliberately no
   shared bucket for "unknown thread": a default bucket is the same leak wearing
   a different name, and an unthreaded turn behaving exactly as it does today is
   the honest fallback.

   ── WHY IT IS BOUNDED, AND WHAT THE BOUND COSTS ──────────────────────────

   A server that runs for a week must not accumulate one carry per conversation
   forever. `MAX_THREADS` is the bound and it is enforced by eviction of the
   least recently used thread, which for this data is the right victim: a carry
   is only useful to the NEXT turn of the same conversation, so the conversation
   nobody has spoken to in longest is the one whose carry is worth least.

   An evicted thread does not error and does not warn the user. It behaves as
   the product behaves today — no carry, the turn answers from the prompt it
   already had. Degrading to current behaviour is the only safe direction for a
   cache that sits in front of a prompt.
   ══════════════════════════════════════════════════════════════════════════ */
import type { TurnCarry } from './turnCarry.js';

/**
 * How many conversations keep a carry at once.
 *
 * Sized for a local-first single-user app where more than a few dozen live
 * conversations is already unusual, and where the cost of being wrong is one
 * turn behaving as it does today. It is a constant rather than a setting
 * because a knob here would be a knob nobody could tune with evidence.
 */
export const MAX_THREADS = 32;

interface Entry {
  carry: TurnCarry;
  /** How many turns this thread has completed — the pipeline's `turnIndex`. */
  turns: number;
}

const store = new Map<string, Entry>();

/**
 * Is the plumbing on?
 *
 * Default OFF, so the control arm of the registered wiring measurement is the
 * product exactly as it ships today. Read through a function rather than
 * captured into a constant: ESM caches modules, and a constant would make the
 * flag untestable in-process.
 *
 * Registered in `docs/research/carry-wiring-registration.md`.
 */
export const carryWiringEnabled = (): boolean => process.env.SEQUENCE_ASK_CARRY_WIRE === '1';

/**
 * What this thread carried out of its last turn, or nothing.
 *
 * Returns `undefined` — never an empty carry — when the flag is off, the thread
 * is unknown, or the thread has been evicted. The pipeline already treats
 * `undefined` as "fresh conversation" and renders no block for it, so every one
 * of those cases lands on today's behaviour rather than on a header promising
 * continuity with nothing under it.
 */
export function readCarry(threadId: string | undefined): { carry: TurnCarry; turnIndex: number } | undefined {
  if (!carryWiringEnabled()) return undefined;
  if (threadId === undefined || threadId === '') return undefined;
  const entry = store.get(threadId);
  if (entry === undefined) return undefined;
  /* Touch for LRU: reading is use, and a conversation being read from is the
     one least deserving of eviction. */
  store.delete(threadId);
  store.set(threadId, entry);
  return { carry: entry.carry, turnIndex: entry.turns };
}

/**
 * Store what this turn found, for the next turn of the SAME conversation.
 *
 * A turn that produced nothing still advances `turns`, because turn numbers are
 * what the rendered block uses to say how old an item is, and a carry whose
 * turn numbers stall would describe the conversation wrongly.
 */
export function writeCarry(threadId: string | undefined, carry: TurnCarry | undefined): void {
  if (!carryWiringEnabled()) return;
  if (threadId === undefined || threadId === '') return;
  if (carry === undefined) return;
  const prior = store.get(threadId);
  store.delete(threadId);
  store.set(threadId, { carry, turns: (prior?.turns ?? 0) + 1 });
  while (store.size > MAX_THREADS) {
    /* Map preserves insertion order and every touch re-inserts, so the first
       key is the least recently used. */
    const oldest = store.keys().next();
    if (oldest.done === true) break;
    store.delete(oldest.value);
  }
}

/** Test seam. Not called by the product; a store that cannot be emptied cannot be tested. */
export function resetCarryStore(): void {
  store.clear();
}

/** Test seam: how many threads are held, for the bound's own case. */
export function carryStoreSize(): number {
  return store.size;
}
