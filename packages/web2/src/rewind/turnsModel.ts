/* ══════════════════════════════════════════════════════════════════════════
   AGENT TURNS, READ BEFORE THEY ARE REVERTED (S3)
   packages/web2/src/rewind/turnsModel.ts

   Pure. The engine snapshots the tree when each agent turn starts and records
   what the turn wrote (/api/snapshots). This turns that into the rows a person
   reads: newest first, what each turn wrote, which are reverted, and the
   sentence for the active revert.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SnapshotSession } from '../review/turnsClient';
import { whenText } from './rewindModel';

export interface TurnRow {
  seq: number;
  title: string;
  when: string;
  files: string[];
  /** Undone by the active revert (it starts at or before this turn). */
  reverted: boolean;
  /** Revert to here is offered: the turn wrote something and is not reverted. */
  canRevert: boolean;
  /**
   * What the undo point could not keep, in the person's words, or null:
   * "No undo point for this turn" (nothing was saved; Revert is off), or
   * "Undo point skipped 2 files" (a partial point; those files stay as they are).
   */
  undoNote: string | null;
  /** The files a partial point skipped. */
  skipped: string[];
}

/** What the engine says when no undo point could be written (analyzer snapshot.ts NO_UNDO_POINT). */
export const NO_UNDO_POINT = 'No undo point for this turn';

export function turnRows(session: SnapshotSession | null, now: number): TurnRow[] {
  if (!session) return [];
  const from = session.revert?.seq ?? Number.POSITIVE_INFINITY;
  return [...session.turns]
    .sort((a, b) => b.seq - a.seq)
    .map((t) => {
      const reverted = t.seq >= from;
      /* A turn that wrote nothing still has a start; reverting to it undoes
         the turns after it, so it is offered when any later turn wrote. */
      const writesFromHere = session.turns.some((x) => x.seq >= t.seq && x.files.length > 0);
      return {
        seq: t.seq,
        title: t.label && t.label.trim() !== '' ? `Turn ${t.seq}, ${t.label}` : `Turn ${t.seq}`,
        when: whenText(t.at, now),
        files: [...t.files].sort(),
        reverted,
        canRevert: !reverted && writesFromHere && !t.noUndo,
        undoNote: t.noUndo ? NO_UNDO_POINT : t.skipped?.length ? `Undo point skipped ${t.skipped.length} ${t.skipped.length === 1 ? 'file' : 'files'}` : null,
        skipped: [...(t.skipped ?? [])].sort(),
      };
    });
}

/** The banner for an active revert, or null. */
export function revertSentence(session: SnapshotSession | null): string | null {
  const r = session?.revert;
  if (!r) return null;
  const n = r.files.length;
  return `Reverted to the start of turn ${r.seq}: ${n} ${n === 1 ? 'file' : 'files'} put back. The next prompt drops the reverted turns.`;
}
