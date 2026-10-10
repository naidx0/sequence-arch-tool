import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { revealSubagent, splitSubagent, subagentsOf } from '../agents/subagents';
import { SubagentSubRows } from '../shell2/SubagentRows';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';

afterEach(() => resetKeptOpen());

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });

function runOf(): AgentRun {
  let run: AgentRun = { id: 'r1', sessionId: 'chat-1', agentRef: 'claude', prompt: 'Find the auth code', status: 'running', startedAt: 1_000, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
  const events: [RunNodeEvent, number][] = [
    [upd({ sessionUpdate: 'tool_call', toolCallId: 'task-1', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'Explore', description: 'find the auth code' } }), 1_100],
    [upd({ sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read src/auth.ts', kind: 'read', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task-1' } } }), 1_500],
    [upd({ sessionUpdate: 'tool_call', toolCallId: 'grep-1', title: 'grep login', kind: 'search', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task-1' } } }), 1_800],
    [upd({ sessionUpdate: 'tool_call_update', toolCallId: 'task-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Auth lives in src/auth.ts.' } }] }), 4_100],
  ];
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}

describe('nested subagents', () => {
  it('Task outer -> Task inner (parent outer) -> Read (parent inner) shows the Read in the inner thread', () => {
    let run: AgentRun = { id: 'r2', sessionId: 'chat-1', agentRef: 'claude', prompt: 'p', status: 'running', startedAt: 1_000, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    const evs: [RunNodeEvent, number][] = [
      [upd({ sessionUpdate: 'tool_call', toolCallId: 'outer', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'general-purpose', description: 'outer job' } }), 1_100],
      [upd({ sessionUpdate: 'tool_call', toolCallId: 'inner', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'Explore', description: 'inner job' }, _meta: { claudeCode: { parentToolUseId: 'outer' } } }), 1_200],
      [upd({ sessionUpdate: 'tool_call', toolCallId: 'deep', title: 'Read deep/file.ts', kind: 'read', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'inner' } } }), 1_300],
    ];
    for (const [e, at] of evs) run = foldRunEvent(run, e, at);
    render(<AgentRunView run={run} now={5_000} repoRoot={null} onAnswer={() => {}} />);
    const cards = screen.getAllByTestId('agent-subagent');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getAllByTestId('agent-subagent')).toHaveLength(1); /* the inner card is inside the outer one */
    expect(screen.getAllByTestId('agent-card-tool')).toHaveLength(1);
    expect(screen.getByTestId('agent-card-tool').textContent).toContain('deep/file.ts');
  });
});

describe('subagent subthread', () => {
  it('the fold keeps the parent of a subagent step; the model lists the subagent', () => {
    const run = runOf();
    expect(run.items.filter((i) => i.kind === 'tool' && i.parentId === 'task-1')).toHaveLength(2);
    expect(splitSubagent('Explore: find the auth code')).toEqual({ name: 'Explore', description: 'find the auth code' });
    expect(subagentsOf([run], 'chat-1')).toMatchObject([{ name: 'Explore', description: 'find the auth code', status: 'done', toolId: 'task-1' }]);
    expect(subagentsOf([run], 'other')).toEqual([]);
  });

  it('draws one nested card with its own steps, collapsed until opened, not as top-level rows', () => {
    const run = runOf();
    render(<AgentRunView run={run} now={5_000} repoRoot={null} onAnswer={() => {}} />);
    const card = screen.getByTestId('agent-subagent');
    expect(within(card).getByTestId('agent-subagent-name').textContent).toBe('Explore');
    expect(within(card).getByTestId('agent-subagent-desc').textContent).toBe('find the auth code');
    expect(within(card).getByTestId('agent-subagent-status').textContent).toBe('done');
    expect(within(card).getByTestId('agent-subagent-duration').textContent).toBeTruthy();
    /* Done: folded. Its steps are not in the thread until opened. */
    expect(screen.queryByTestId('agent-subagent-body')).toBeNull();
    expect(screen.queryAllByTestId('agent-card-tool')).toHaveLength(0);
    fireEvent.click(within(card).getByTestId('agent-subagent-toggle'));
    expect(within(screen.getByTestId('agent-subagent-body')).getAllByTestId('agent-card-tool')).toHaveLength(2);
    expect(screen.getByTestId('agent-subagent-result').textContent).toContain('Auth lives in src/auth.ts.');
  });

  it('a running subagent is open; the rail asks the chat to open and show a finished one', () => {
    const run = runOf();
    render(<AgentRunView run={run} now={5_000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.queryByTestId('agent-subagent-body')).toBeNull();
    act(() => {
      revealSubagent({ runId: 'r1', toolId: 'task-1' });
    });
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(screen.getByTestId('agent-subagent').getAttribute('data-open')).toBe('true');
        resolve();
      }, 120),
    );
  });

  it('rail sub-rows: name, state dot, click picks', () => {
    const picked: string[] = [];
    render(<SubagentSubRows refs={subagentsOf([runOf()], 'chat-1')} onPick={(r) => picked.push(r.toolId)} />);
    const row = screen.getByTestId('rail-subagent');
    expect(row.getAttribute('data-state')).toBe('done');
    expect(row.textContent).toContain('Explore');
    fireEvent.click(row);
    expect(picked).toEqual(['task-1']);
  });
});
