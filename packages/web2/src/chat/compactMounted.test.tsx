import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentRun } from '../agents/agentRuns';
import { AgentRunView } from './AgentRunThread';
import { transcriptRows } from './VirtualTranscript';

/* A compaction is one calm line where it happened, not a prompt bubble and an answer: live, restored, and in the long list. */

const compactRun = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-c',
  sessionId: 'chat-a',
  agentRef: 'claude',
  prompt: 'Compact the conversation',
  operation: 'compact',
  status: 'running',
  startedAt: 0,
  endedAt: null,
  items: [],
  approvals: [],
  error: null,
  ...over,
});

const draw = (run: AgentRun) => render(<AgentRunView run={run} now={5} repoRoot={null} onAnswer={() => {}} />);

describe('a compaction run shows the notice', () => {
  it('live: one line, no prompt bubble', () => {
    const { container } = draw(compactRun());
    expect(screen.getByTestId('compact-notice-text').textContent).toBe('Compacting the conversation');
    expect(container.querySelector('.s2-run-prompt')).toBeNull();
    expect(container.textContent).not.toContain('Compact the conversation');
  });

  it('restored after a reload: the same line, with the count', () => {
    const { container } = draw(compactRun({ status: 'done', endedAt: 9, restored: true, summarizedTurns: 12, items: [{ kind: 'message', id: 'm0', text: 'The API moved to v2.' }] }));
    expect(screen.getByTestId('compact-notice-text').textContent).toBe('Conversation compacted: 12 earlier turns summarized');
    expect(screen.getByTestId('compact-notice-toggle')).toBeTruthy();
    expect(container.querySelector('.s2-run-prompt')).toBeNull();
    expect(container.textContent).not.toContain('The API moved to v2.');
  });

  it('an ordinary run still draws its prompt', () => {
    const { container } = draw(compactRun({ operation: 'prompt', prompt: 'Explain orders.' }));
    expect(container.querySelector('.s2-run-prompt')?.textContent).toBe('Explain orders.');
    expect(screen.queryByTestId('compact-notice')).toBeNull();
  });

  it('the long list gets one row for it, not a head, groups and a foot', () => {
    const rows = transcriptRows([], [compactRun({ status: 'done', summarizedTurns: 3, items: [{ kind: 'message', id: 'm0', text: 'Summary.' }] })], null, []);
    expect(rows.filter((r) => r.kind.startsWith('run-')).map((r) => r.kind)).toEqual(['run-head']);
  });
});
