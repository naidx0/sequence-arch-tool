import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GoalRunState } from '@sequence/api-types';

import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { useGoalRun } from './useGoalRun';

/**
 * THE GOAL-RUN HOOK READS ONCE AT BOOT.
 *
 * Measured 2026-10-05: the hook read `goal-run` and the session at mount with
 * no `repoPath` (the client did not know the root yet), then again with
 * `?repoPath=` in the render where boot settled. Same server root, same answer.
 */

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };
const ok = <T,>(body: T): Promise<WireResult<T>> => Promise.resolve({ outcome: 'ok', body });

function countingClient() {
  const reads: Array<{ id: string; repoPath: string | undefined }> = [];
  const client = {
    readGoalRun: (id: string, _signal?: AbortSignal, repoPath?: string) => {
      reads.push({ id, repoPath });
      return ok(IDLE);
    },
    readSession: () => ok({ chat: { version: 1, sessionId: 's1', turns: [] }, meta: {}, plan: [] }),
  } as unknown as SessionsClient;
  return { client, reads };
}

function Probe(props: { client: SessionsClient; sessionId: string; repoPath?: string; booted: boolean }) {
  useGoalRun({ ...props, mode: 'plan' });
  return null;
}

describe('useGoalRun at boot', () => {
  it('does not read again in the render where boot settles and brings the root', async () => {
    const { client, reads } = countingClient();
    const view = render(<Probe client={client} sessionId="s1" booted={false} />);
    await waitFor(() => expect(reads.length).toBe(1));
    view.rerender(<Probe client={client} sessionId="s1" repoPath="/repo" booted />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toEqual([{ id: 's1', repoPath: undefined }]);
  });

  it('reads again when the root changes after boot', async () => {
    const { client, reads } = countingClient();
    const view = render(<Probe client={client} sessionId="s1" booted={false} />);
    view.rerender(<Probe client={client} sessionId="s1" repoPath="/repo" booted />);
    view.rerender(<Probe client={client} sessionId="s1" repoPath="/other" booted />);
    await waitFor(() => expect(reads.at(-1)).toEqual({ id: 's1', repoPath: '/other' }));
    expect(reads.filter((r) => r.repoPath === '/other')).toHaveLength(1);
  });

  it('reads again when the thread changes at the same render boot settles', async () => {
    const { client, reads } = countingClient();
    const view = render(<Probe client={client} sessionId="s1" booted={false} />);
    view.rerender(<Probe client={client} sessionId="s2" repoPath="/repo" booted />);
    await waitFor(() => expect(reads.length).toBe(2));
    expect(reads[1]).toEqual({ id: 's2', repoPath: '/repo' });
  });

  it('already booted: a root change reads again as before', async () => {
    const { client, reads } = countingClient();
    const view = render(<Probe client={client} sessionId="s1" booted />);
    view.rerender(<Probe client={client} sessionId="s1" repoPath="/repo" booted />);
    await waitFor(() => expect(reads.length).toBe(2));
  });
});
