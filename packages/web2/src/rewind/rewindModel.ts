/* ══════════════════════════════════════════════════════════════════════════
   READING A REWIND BEFORE YOU DO IT
   packages/web2/src/rewind/rewindModel.ts

   The engine's checkpoint routes are built around ONE RULE, stated in
   `api-types/sessions.ts`: "There is no route that acts without stating
   first." `/api/checkpoint/plan` computes exactly what a restore would touch
   and touches nothing; `/api/checkpoint/restore` returns the same plan
   alongside what it then did.

   A panel that hid the plan behind a Restore button would throw that away and
   turn the safest undo in the product into the scariest one. So the plan is
   the surface, and this module is the part that turns it into sentences —
   pure, so every judgement below is a test rather than a thing to click.

   ── THE JUDGEMENTS THAT LIVE HERE ────────────────────────────────────────

   · NEWEST FIRST. The server answers oldest first because that is the order a
     log is written in. A person looking for "undo what just happened" should
     not have to scroll to the bottom to find it.
   · UNRECOVERABLE IS A REFUSAL, NOT A WARNING. A checkpoint whose blob was
     swept cannot be restored, and the engine refuses outright rather than
     restoring the rest — "a partially restored tree is worse than none". The
     button has to be off, and it has to say which file made it off.
   · "NOTHING TO DO" IS A REAL ANSWER. A plan can be ok and empty: the tree
     already matches. That is not an error and must not read as one, but the
     button still has nothing to do, so it says so.
   ══════════════════════════════════════════════════════════════════════════ */

import type { CheckpointRecord, RestorePlan } from '@sequence/api-types';

export interface RewindRow {
  seq: number;
  /** The label the checkpoint was taken with, or null. Never invented. */
  label: string | null;
  /** "just now", "4 min ago" — see {@link whenText}. */
  when: string;
  /** How many files this checkpoint holds a state for. */
  files: number;
  /**
   * Whether a conversation was captured. ABSENT and empty are different: a
   * session with no turns yet really did capture an empty conversation, and
   * `undefined` means there was no session on disk to read.
   */
  conversation: 'captured' | 'empty' | 'not captured';
}

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * NO SECONDS PAST A MINUTE and no "0 min ago": a clock that ticks in a list
 * you are reading is noise, and the only thing this has to answer is "is this
 * the one I just made".
 */
export function whenText(at: number, now: number): string {
  const ms = now - at;
  if (ms < 0) return 'just now'; // A clock that went backwards is not information.
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The list a person reads, newest first. */
export function rewindRows(checkpoints: readonly CheckpointRecord[], now: number): RewindRow[] {
  return checkpoints
    .map((c) => ({
      seq: c.seq,
      label: typeof c.label === 'string' && c.label.trim() !== '' ? c.label : null,
      when: whenText(c.at, now),
      files: c.files.length,
      conversation: (c.conversation === undefined
        ? 'not captured'
        : c.conversation.length === 0
          ? 'empty'
          : 'captured') as RewindRow['conversation'],
    }))
    .sort((a, b) => b.seq - a.seq);
}

export interface PlanReading {
  /** One line, the thing a person reads first. */
  headline: string;
  /** The detail, already in reading order. Never empty when `headline` is. */
  lines: string[];
  /** False ⇒ the Restore button is off. */
  canRestore: boolean;
  /** Why it is off. Present only when `canRestore` is false. */
  refusal: string | null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Turn a plan into what the panel shows.
 *
 * THE SERVER'S OWN `notes` ARE PASSED THROUGH VERBATIM. They carry the cases
 * this function must not second-guess — a checkpoint that captured no
 * conversation being asked to restore one, a scope narrowed from `both` to
 * `code` — and rewriting them here would be a second, drifting answer.
 */
export function planReading(plan: RestorePlan | null): PlanReading {
  if (!plan) {
    return { headline: 'Nothing checked yet.', lines: [], canRestore: false, refusal: 'no plan' };
  }

  if (plan.unrecoverable.length > 0) {
    /* The engine refuses outright. Naming the files is the only way a person
       can tell whether they care — and the sweep that removed them is a real
       thing that happens at 100 checkpoints, not a bug to hunt. */
    return {
      headline: 'This one cannot be restored.',
      lines: [
        `${count(plan.unrecoverable.length, 'file was', 'files were')} captured here, but the saved copy is gone:`,
        ...plan.unrecoverable,
        'Older checkpoints are swept once a session passes 100 of them.',
      ],
      canRestore: false,
      refusal: 'the saved copy of at least one file is gone',
    };
  }

  if (!plan.ok) {
    return {
      headline: 'This one cannot be restored.',
      lines: plan.error ? [plan.error, ...plan.notes] : [...plan.notes],
      canRestore: false,
      refusal: plan.error ?? 'the engine refused',
    };
  }

  const lines: string[] = [];
  if (plan.writes.length > 0) lines.push(`Put back ${count(plan.writes.length, 'file', 'files')}.`);
  if (plan.deletes.length > 0) {
    lines.push(`Delete ${count(plan.deletes.length, 'file', 'files')} created since.`);
  }
  if (plan.unchanged.length > 0) {
    /* THE VERB AGREES TOO. `count` pluralises the noun; a hard-coded "match"
       beside it produces "1 file already match", which is the kind of seam
       that makes a careful surface read as machine output. */
    const n = plan.unchanged.length;
    lines.push(`${count(n, 'file', 'files')} already ${n === 1 ? 'matches' : 'match'} and will not be touched.`);
  }
  if (typeof plan.conversationTurns === 'number') {
    lines.push(`Set the conversation back to ${count(plan.conversationTurns, 'turn', 'turns')}.`);
  }
  lines.push(...plan.notes);

  const moves = plan.writes.length + plan.deletes.length;
  if (moves === 0 && typeof plan.conversationTurns !== 'number') {
    /* Not an error. The tree already matches — say so plainly and leave the
       button off, because pressing it would do nothing and look broken. */
    return {
      headline: 'Nothing to put back — this already matches.',
      lines,
      canRestore: false,
      refusal: 'nothing would change',
    };
  }

  return {
    headline: `This will change ${count(moves, 'file', 'files')}.`,
    lines,
    canRestore: true,
    refusal: null,
  };
}
