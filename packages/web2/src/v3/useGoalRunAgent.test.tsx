import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GoalRunState } from '@sequence/api-types';

import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { useGoalRun, type GoalRunView } from './useGoalRun';

/**
 * A GOAL RUN ON THE CHAT'S AGENT: starting one from a chat that talks to Claude or Codex sends
 * `agentRef`, so the server needs no AI key; a chat on Sequence's own model sends none.
 */

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };
const ok = <T,>(body: T): Promise<WireResult<T>> => Promise.resolve({ outcome: 'ok', body });

function fake() {
  const started: unknown[] = [];
  const client = {
    readGoalRun: () => ok(IDLE),
    readSession: () => ok({ chat: { version: 1, sessionId: 's1', turns: [] }, meta: {}, goal: 'g', plan: [{ id: 's1', text: 'Edit a.ts', status: 'open' }] }),
    startGoalRun: (_id: string, body: unknown) => {
      started.push(body);
      return ok({ ok: true, state: { ...IDLE, running: true } });
    },
  } as unknown as SessionsClient;
  return { client, started };
}

function Probe(props: { client: SessionsClient; agentRef?: string; now?: { current: string | undefined }; out: { view?: GoalRunView } }) {
  props.out.view = useGoalRun({ client: props.client, sessionId: 's1', mode: 'build', ...(props.agentRef ? { agentRef: props.agentRef } : {}), ...(props.now ? { getAgentRef: () => props.now!.current } : {}) });
  return null;
}

describe('useGoalRun start', () => {
  it('sends the chat agent as agentRef', async () => {
    const { client, started } = fake();
    const out: { view?: GoalRunView } = {};
    render(<Probe client={client} agentRef="claude" out={out} />);
    await waitFor(() => expect(out.view).toBeDefined());
    await out.view!.start('build');
    expect(started).toEqual([{ permission: 'build', agentRef: 'claude' }]);
  });

  it('reads the agent when Start is pressed, not when the page last rendered', async () => {
    const { client, started } = fake();
    const out: { view?: GoalRunView } = {};
    const now: { current: string | undefined } = { current: undefined };
    render(<Probe client={client} now={now} out={out} />);
    await waitFor(() => expect(out.view).toBeDefined());
    now.current = 'codex';
    await out.view!.start('build');
    expect(started).toEqual([{ permission: 'build', agentRef: 'codex' }]);
  });

  it('sends no agentRef for a chat on the built-in model', async () => {
    const { client, started } = fake();
    const out: { view?: GoalRunView } = {};
    render(<Probe client={client} out={out} />);
    await waitFor(() => expect(out.view).toBeDefined());
    await out.view!.start('build');
    expect(started).toEqual([{ permission: 'build' }]);
  });
});
