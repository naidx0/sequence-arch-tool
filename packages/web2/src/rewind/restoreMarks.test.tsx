import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CheckpointRecord, RestorePlan } from '@sequence/api-types';

import { RevertedNote, runWroteFiles } from '../chat/RevertedNote';
import type { ReviewClient } from '../review/reviewClient';
import type { SnapshotSession, TurnsClient } from '../review/turnsClient';
import { AgentTurns } from './AgentTurns';
import { RewindPanel } from './RewindPanel';
import { isRevertedAt, markReverted, resetRevertedMarks } from './revertedMarks';
import './rewind.css';

/* The Opus walk of 2026-10-15: "'No agent turns yet' sits above a listed checkpoint row that says '0 files', yet
   Restore changed 1 file. After restore the chat still says 'I changed README.md' with no reverted marker." */

const T0 = 1_760_000_000_000;
beforeEach(() => resetRevertedMarks());
afterEach(cleanup);

const ok = <T,>(body: T) => ({ outcome: 'ok', status: 200, body }) as const;
const plan = (over: Partial<RestorePlan> = {}): RestorePlan => ({ ok: true, sessionId: 'chat-1', seq: 1, requestedScope: 'code', touches: { code: true, conversation: false }, writes: [{ path: 'README.md', bytes: 1, blob: 'b' }], deletes: [], unchanged: [], unrecoverable: [], notes: [], ...over });
const checkpoint = (): CheckpointRecord => ({ seq: 1, at: T0, sessionId: 'chat-1', label: "Before the agent's first write this turn: EDITME", files: [] });
const refuse = async () => ({ outcome: 'unreachable', message: 'not served' }) as const;

function client(): ReviewClient {
  return {
    status: refuse, diff: refuse, revisions: refuse, writeFile: refuse, commit: refuse, functions: refuse,
    checkpoints: async () => ok({ checkpoints: [checkpoint()], tracked: [] as string[] }),
    planRestore: async () => ok({ plan: plan() }),
    restore: async () => ok({ plan: plan(), applied: { ok: true, wrote: ['README.md'], deleted: [], conversationRestored: false } }),
  } as unknown as ReviewClient;
}

const noTurns = (): TurnsClient => ({ sessions: async () => ok({ sessions: [] }), turns: async () => ok({} as SnapshotSession), files: async () => ok({ files: [] }), diff: async () => ok({ diff: '' }), revert: async () => ok({ seq: 1, files: [] }), undo: async () => ok({ restored: [] }), revertHunk: async () => ok({ ok: true, path: '' }) }) as unknown as TurnsClient;

describe('one panel that agrees with itself', () => {
  it('does not say "No agent turns yet" over a checkpoint, and does not call a first-write checkpoint "0 files"', async () => {
    render(<RewindPanel client={client()} turns={noTurns()} now={() => T0 + 1000} />);
    const row = await screen.findByTestId('rewind-row');
    expect(row.textContent).not.toMatch(/\b0 files\b/);
    expect(row.textContent).toMatch(/before the first change/);
    await waitFor(() => expect(screen.queryByText(/No agent turns yet/)).toBeNull());
    expect(screen.queryByTestId('agent-turns-empty')).toBeNull();
  });

  it('with no checkpoints either, the agent turns section still says how a turn comes to be reverted', async () => {
    render(<AgentTurns client={noTurns()} chatId="chat-1" />);
    expect(await screen.findByTestId('agent-turns-empty')).toBeTruthy();
  });
});

describe('a restore leaves its mark on the turns it undid', () => {
  it('restoring a checkpoint marks the chat time from that point to now, and only for the chat the point was in', async () => {
    render(<RewindPanel client={client()} turns={noTurns()} now={() => T0 + 1000} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    await waitFor(() => expect((screen.getByTestId('rewind-restore') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('rewind-restore'));
    await screen.findByTestId('rewind-applied');
    expect(isRevertedAt('chat-1', T0 + 500)).toBe(true);
    expect(isRevertedAt('chat-1', T0 - 500)).toBe(false);
    expect(isRevertedAt('chat-2', T0 + 500)).toBe(false);
  });

  it('the turn says so under it, and only a turn that wrote files', () => {
    const { rerender } = render(<RevertedNote chatId="chat-1" at={T0 + 5} wrote />);
    expect(screen.queryByTestId('turn-reverted')).toBeNull();
    act(() => markReverted('chat-1', T0, T0 + 10));
    expect(screen.getByTestId('turn-reverted').textContent).toMatch(/Reverted/);
    rerender(<RevertedNote chatId="chat-1" at={T0 + 5} wrote={false} />);
    expect(screen.queryByTestId('turn-reverted')).toBeNull();
    rerender(<RevertedNote chatId="chat-1" at={T0 + 50} wrote />);
    expect(screen.queryByTestId('turn-reverted')).toBeNull();
    expect(runWroteFiles({ items: [{ kind: 'tool', id: 't', title: 'Edit', toolKind: 'edit', status: 'done', startedAt: 0, endedAt: 1, changes: [], diffs: [], output: null }] })).toBe(true);
    expect(runWroteFiles({ items: [{ kind: 'tool', id: 't', title: 'Read', toolKind: 'read', status: 'done', startedAt: 0, endedAt: 1, changes: [], diffs: [], output: null }] })).toBe(false);
    /* A call record without the diff and change lists (an old or partial record) is a call that wrote nothing we know of, never an error. */
    expect(runWroteFiles({ items: [{ kind: 'tool', id: 't', title: 'npm test', toolKind: 'execute', status: 'running', startedAt: 0 } as never] })).toBe(false);
  });
});
