import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WireResult } from '../boot';
import { ReviewPane } from '../review/ReviewPane';
import { REVIEW } from '../review/anchors';
import { createReviewClient } from '../review/reviewClient';
import type { SnapshotSession, TurnsClient } from '../review/turnsClient';
import { DiffView as BoardDiffView } from '../canvas/views/DiffView';
import { AgentTurns } from './AgentTurns';
import { RewindPanel } from './RewindPanel';
import { revertSentence, turnRows } from './turnsModel';

/* S3 — undo anything the agent did, on screen: the Rewind panel's agent turns
   (Revert to here, Undo revert), the review pane's Last turn from the turn
   snapshot with a Revert hunk button, and the board's Diff against the start
   of the last agent turn. The engine side is analyzer turn-snapshots.test.ts
   and snapshot-routes.test.ts; here the client is a fake that records calls. */

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  'index 1111111..2222222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '@@ -17,3 +17,3 @@',
  ' seventeen',
  '-eighteen',
  '+EIGHTEEN',
  ' nineteen',
  '',
].join('\n');

function fakeTurns(start: SnapshotSession): TurnsClient & { calls: string[]; session: SnapshotSession } {
  const state = { session: structuredClone(start) };
  const calls: string[] = [];
  return {
    calls,
    get session() {
      return state.session;
    },
    sessions: async () => ok({ sessions: [{ sessionId: state.session.sessionId, turns: state.session.turns.length, lastAt: 3, reverted: !!state.session.revert }] }),
    turns: async () => ok(structuredClone(state.session)),
    files: async (_s, seq) => ok({ files: seq === 2 ? [{ path: 'a.ts', status: 'modified' as const }] : [] }),
    diff: async () => ok({ diff: DIFF }),
    revert: async (sid, seq) => {
      calls.push(`revert ${sid} ${seq}`);
      const files = [...new Set(state.session.turns.filter((t) => t.seq >= seq).flatMap((t) => t.files))];
      state.session.revert = { seq, files };
      return ok({ seq, files });
    },
    undo: async (sid) => {
      calls.push(`undo ${sid}`);
      const restored = state.session.revert?.files ?? [];
      delete state.session.revert;
      return ok({ restored });
    },
    revertHunk: async (sid, seq, path, hunk, header) => {
      calls.push(`hunk ${sid} ${seq} ${path} ${hunk} ${header}`);
      return ok({ ok: true, path });
    },
  };
}

const SESSION: SnapshotSession = {
  sessionId: 'claude-1',
  turns: [
    { seq: 1, at: 1_000, files: ['NOTES.md', 'orders/app/main.py'], label: 'add ping' },
    { seq: 2, at: 2_000, files: ['a.ts'] },
  ],
};

describe('agent turn rows', () => {
  it('lists turns newest first, marks reverted ones, and offers Revert to here only where it would change something', () => {
    const rows = turnRows({ ...SESSION, turns: [...SESSION.turns, { seq: 3, at: 3_000, files: [] }] }, 3_000);
    expect(rows.map((r) => [r.seq, r.title, r.files.length, r.canRevert])).toEqual([
      [3, 'Turn 3', 0, false],
      [2, 'Turn 2', 1, true],
      [1, 'Turn 1, add ping', 2, true],
    ]);
    const reverted = turnRows({ ...SESSION, revert: { seq: 2, files: ['a.ts'] } }, 3_000);
    expect(reverted.map((r) => [r.seq, r.reverted, r.canRevert])).toEqual([
      [2, true, false],
      [1, false, true],
    ]);
    expect(revertSentence({ ...SESSION, revert: { seq: 2, files: ['a.ts'] } })).toBe(
      'Reverted to the start of turn 2: 1 file put back. The next prompt drops the reverted turns.',
    );
    expect(revertSentence(SESSION)).toBeNull();
  });
});

describe('the Rewind panel\'s agent turns', () => {
  it('reverts to a turn, shows the revert, and undoes it', async () => {
    const turns = fakeTurns(SESSION);
    const changed: string[][] = [];
    render(<AgentTurns client={turns} now={() => 3_000} onChanged={(p) => changed.push(p)} />);
    const rows = await screen.findAllByTestId('agent-turn');
    expect(rows.map((r) => r.getAttribute('data-seq'))).toEqual(['2', '1']);

    fireEvent.click(within(rows[1]!).getByTestId('agent-turn-revert'));
    await screen.findByTestId('agent-turns-reverted');
    expect(turns.calls).toEqual(['revert claude-1 1']);
    expect(changed).toEqual([['NOTES.md', 'orders/app/main.py', 'a.ts']]);
    expect(screen.getAllByTestId('agent-turn').every((r) => r.getAttribute('data-reverted') === 'true')).toBe(true);
    expect(screen.queryAllByTestId('agent-turn-revert')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('agent-turns-undo'));
    await waitFor(() => expect(screen.queryByTestId('agent-turns-reverted')).toBeNull());
    expect(turns.calls).toEqual(['revert claude-1 1', 'undo claude-1']);
    expect(screen.getByTestId('agent-turns-note').textContent).toBe('Undid the revert: 3 files back.');
  });

  it('in the Rewind panel, a revert keeps the panel open (no reload) so Undo revert can be pressed', async () => {
    const turns = fakeTurns(SESSION);
    const onRestored = vi.fn();
    const agent: string[][] = [];
    const checkpoints = vi.fn(async () => new Response(JSON.stringify({ checkpoints: [], tracked: [] }), { status: 200 })) as unknown as typeof fetch;
    render(
      <RewindPanel client={createReviewClient(checkpoints)} turns={turns} onRestored={onRestored} onAgentChanged={(p) => agent.push(p)} now={() => 3_000} />,
    );
    const rows = await screen.findAllByTestId('agent-turn');
    fireEvent.click(within(rows[0]!).getByTestId('agent-turn-revert'));
    await screen.findByTestId('agent-turns-undo');
    expect(onRestored).not.toHaveBeenCalled();
    expect(agent).toEqual([['a.ts']]);
  });

  it('says so when no agent turn has been recorded', async () => {
    const empty: TurnsClient = { ...fakeTurns(SESSION), sessions: async () => ok({ sessions: [] }) };
    render(<AgentTurns client={empty} />);
    expect((await screen.findByTestId('agent-turns-empty')).textContent).toMatch(/No agent turns yet/);
  });
});

describe('Last turn from the turn snapshot, with a Revert hunk button', () => {
  const noFetch = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;

  it('lists what the last agent turn changed on disk and reverts one hunk by its header', async () => {
    const turns = fakeTurns(SESSION);
    render(
      <ReviewPane client={createReviewClient(noFetch)} proposal={null} graph={null} functions={null} scope="last-turn" onSteer={() => {}} turns={turns} />,
    );
    const source = await screen.findByTestId(REVIEW.lastTurnSource);
    await waitFor(() => expect(source.getAttribute('data-source')).toBe('snapshot'));
    expect(source.textContent).toBe('Showing agent turn 2, as it is on disk.');
    const buttons = await screen.findAllByTestId(REVIEW.hunkRevert);
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(turns.calls).toEqual(['hunk claude-1 2 a.ts 1 @@ -17,3 +17,3 @@']));
  });

  it('shows no hunk button over a proposal: nothing of it is on disk yet', async () => {
    const turns = fakeTurns(SESSION);
    render(
      <ReviewPane
        client={createReviewClient(vi.fn(async () => new Response(JSON.stringify({ path: 'a.ts', diff: DIFF }), { status: 200 })) as unknown as typeof fetch)}
        proposal={{ id: 'p1', title: 'Proposal', rationale: null, files: [{ path: 'a.ts', content: 'x' }] } as never}
        graph={null}
        functions={null}
        scope="last-turn"
        onSteer={() => {}}
        turns={turns}
      />,
    );
    expect((await screen.findByTestId(REVIEW.lastTurnSource)).getAttribute('data-source')).toBe('proposal');
    await screen.findAllByTestId(REVIEW.hunk);
    expect(screen.queryAllByTestId(REVIEW.hunkRevert)).toHaveLength(0);
  });
});

describe('the board\'s Diff against the start of the last agent turn', () => {
  it('compares against the turn snapshot when asked', async () => {
    const turns = fakeTurns(SESSION);
    const graph = { nodes: [{ id: 'svc:a', kind: 'service', label: 'a', path: '.' }, { id: 'f:a', kind: 'file', label: 'a.ts', path: 'a.ts', parentId: 'svc:a' }], edges: [] } as never;
    const branchFetch = vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 }));
    render(<BoardDiffView boxes={[{ id: 'svc:a', label: 'a' }]} lines={[]} graph={graph} fetchImpl={branchFetch} turns={turns} />);
    await screen.findByTestId('diff-summary');
    fireEvent.click(screen.getByTestId('diff-against-turn'));
    await waitFor(() => expect(screen.getByTestId('diff-summary').textContent).toBe('1 box changes against the start of agent turn 2, 0 connections touched.'));
    expect(screen.queryByTestId('diff-base')).toBeNull();
  });
});
