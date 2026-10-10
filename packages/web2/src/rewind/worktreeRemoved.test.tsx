/* The coordinator's ruling on S7 removal: the worktree's Rewind history goes
   with it. After removal the chat keeps its transcript, Revert is off with the
   reason "Worktree removed", and every remove-confirm says the history goes. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WireResult } from '../boot';
import type { TurnsClient } from '../review/turnsClient';
import { REWIND_GOES, WORKTREE_REMOVED, removalDialog, removeConfirm } from '../worktree/worktreeModel';
import { AgentTurns } from './AgentTurns';

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });
/* The main checkout's snapshot list: the removed worktree's history is gone, so the chat is not in it. */
const turns = {
  sessions: async () => ok({ sessions: [] }),
} as unknown as TurnsClient;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const WT = { id: 'aaaaaaaa', path: '/data/wt/aaaaaaaa', branch: 'sequence/add-ping-3c4d', baseCommit: 'a'.repeat(40), baseBranch: 'main', createdAt: 'x' };

describe('Rewind for a chat whose worktree was removed', () => {
  it('shows Revert switched off with the reason "Worktree removed"', async () => {
    const f = async () => json({ worktree: { ...WT, removedAt: '2026-10-06T02:00:00.000Z' } });
    render(<AgentTurns client={turns} chatId="chat-1" fetchImpl={f} />);
    const button = await screen.findByTestId('agent-turn-revert-removed');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-turns-revert-reason').textContent).toBe(WORKTREE_REMOVED);
    expect(WORKTREE_REMOVED).toBe('Worktree removed');
    expect(screen.queryByTestId('agent-turns-empty')).toBeNull();
  });

  it('mounted from the Rewind panel with no chat given, it asks the engine which chat is active', async () => {
    const asked: string[] = [];
    const f = async (url: string) => {
      asked.push(url);
      if (url === '/api/sessions') return json({ index: { activeId: 'chat-9' } });
      return json({ worktree: { ...WT, removedAt: 'x' } });
    };
    render(<AgentTurns client={turns} fetchImpl={f} />);
    await screen.findByTestId('agent-turns-revert-reason');
    expect(asked).toEqual(['/api/sessions', '/api/sessions/chat-9/worktree']);
  });

  it('control: a live worktree (or none) leaves Rewind as it was', async () => {
    for (const worktree of [WT, null]) {
      const f = async () => json({ worktree });
      const view = render(<AgentTurns client={turns} chatId="chat-1" fetchImpl={f} />);
      await screen.findByTestId('agent-turns-empty');
      expect(screen.queryByTestId('agent-turns-worktree-removed')).toBeNull();
      view.unmount();
    }
  });
});

describe('every remove-confirm says the Rewind history goes', () => {
  it('the unmerged dialog and the plain confirm both carry the line', () => {
    expect(REWIND_GOES).toBe('This also removes its Rewind history.');
    expect(removalDialog('sequence/x-1a2b', [{ sha: '1'.repeat(40), subject: 'a' }]).body.endsWith(REWIND_GOES)).toBe(true);
    expect(removeConfirm('sequence/x-1a2b').body.endsWith(REWIND_GOES)).toBe(true);
  });
});
