import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import { AgentRunView, resetKeptOpen } from '../chat/AgentRunThread';
import { Takeover } from './Takeover';

/* The Opus walk of 2026-10-15: a permission prompt showed two sets of controls at once, the card's
   Deny / Always for / Allow once and the docked No / Always / Yes. Decision 49 makes the composer takeover the one
   place to answer while it shows; the card keeps the question and its outcome, not a second set of answers. */

afterEach(() => resetKeptOpen());

const run = {
  id: 'run-1',
  sessionId: 's1',
  agentRef: 'codex',
  nodeId: null,
  nodeLabel: null,
  prompt: 'install it',
  startedAt: 0,
  endedAt: null,
  error: null,
  access: 'ask',
  status: 'running',
  items: [{ kind: 'approval', id: 'q1', at: 1, settledAt: null }],
  approvals: [
    {
      requestId: 'q1',
      title: 'Run npm test',
      toolKind: 'execute',
      toolCallId: null,
      decision: null,
      answeredBy: null,
      sending: null,
      always: 'npm test',
      proposal: { proposalId: 'p1', title: 'Run npm test', rationale: null, files: [] },
    },
  ],
} as unknown as AgentRun;

describe('one set of permission controls', () => {
  it('while the takeover asks, the card shows the question with no answer buttons of its own', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, runs: [run] }));
    render(
      <>
        <AgentRunView run={run} now={5} repoRoot={null} onAnswer={() => {}} />
        <Takeover store={store} sessionId="s1" repoRoot={null} draftKept={false} />
      </>,
    );
    /* The docked set: No / Always / Yes. */
    expect(screen.getByTestId('s2-takeover-yes')).toBeTruthy();
    expect(screen.getByTestId('s2-takeover-no')).toBeTruthy();
    /* The card's set: Deny / Always for / Allow once. Not drawn. */
    for (const id of ['agent-allow', 'agent-deny', 'agent-always', 'agent-approval-allow', 'agent-approval-deny', 'agent-approval-always']) expect(screen.queryByTestId(id)).toBeNull();
    /* The question itself is still on the card. */
    expect(screen.getByTestId('agent-run').textContent).toContain('Run npm test');
    /* Deny with a reason is reachable from the takeover. */
    expect(screen.getByTestId('s2-takeover-deny-reason')).toBeTruthy();
  });

  it('with no takeover (another chat is open, or it has gone), the card answers for itself again', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, runs: [run] }));
    const view = render(
      <>
        <AgentRunView run={run} now={5} repoRoot={null} onAnswer={() => {}} />
        <Takeover store={store} sessionId="s1" repoRoot={null} draftKept={false} />
      </>,
    );
    expect(screen.queryByTestId('agent-allow')).toBeNull();
    act(() => view.rerender(<AgentRunView run={run} now={5} repoRoot={null} onAnswer={() => {}} />));
    expect(screen.getAllByTestId('agent-allow').length).toBeGreaterThan(0);
  });
});
