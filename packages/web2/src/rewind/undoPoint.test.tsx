/* An undo point the engine could only save in part, or not at all, says so in
   Rewind instead of failing silently: "Undo point skipped 1 file" with the
   file, or "No undo point for this turn" with Revert off. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WireResult } from '../boot';
import type { SnapshotSession, TurnsClient } from '../review/turnsClient';
import { AgentTurns } from './AgentTurns';
import { NO_UNDO_POINT, turnRows } from './turnsModel';

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });
const SESSION: SnapshotSession = {
  sessionId: 'session-x',
  turns: [
    { seq: 1, at: 1_000, files: ['a.txt'], skipped: ['locked.txt'] },
    { seq: 2, at: 2_000, files: ['b.txt'], noUndo: `${NO_UNDO_POINT}: git write-tree failed (exit 128)` },
  ],
};
const client = {
  sessions: async () => ok({ sessions: [{ sessionId: 'session-x', turns: 2, lastAt: 2_000, reverted: false }] }),
  turns: async () => ok(SESSION),
} as unknown as TurnsClient;

describe('undo points in Rewind', () => {
  it('a partial point names what it skipped and can still be reverted to; no point turns Revert off', () => {
    const [two, one] = turnRows(SESSION, 3_000);
    expect([one!.undoNote, one!.skipped, one!.canRevert]).toEqual(['Undo point skipped 1 file', ['locked.txt'], true]);
    expect([two!.undoNote, two!.canRevert]).toEqual([NO_UNDO_POINT, false]);
  });

  it('shows both notes on the turn rows', async () => {
    render(<AgentTurns client={client} chatId={null} />);
    const notes = await screen.findAllByTestId('agent-turn-undo-note');
    expect(notes.map((n) => n.textContent)).toEqual([
      'No undo point for this turn.',
      'Undo point skipped 1 file: locked.txt. It stays as it is on revert.',
    ]);
    /* Turn 2 offers no Revert; turn 1 does. */
    const rows = screen.getAllByTestId('agent-turn');
    expect(rows.map((r) => r.querySelector('[data-testid="agent-turn-revert"]') !== null)).toEqual([false, true]);
  });
});
