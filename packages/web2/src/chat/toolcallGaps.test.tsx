import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { AgentRunView, resetKeptOpen, runGroups } from './AgentRunThread';

afterEach(() => resetKeptOpen());

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
const think = (text: string): [RunNodeEvent, number] => [upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } }), 0];
const say = (text: string): [RunNodeEvent, number] => [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }), 0];
const tool = (id: string, kind: string, title: string, status: string): [RunNodeEvent, number] => [
  upd({ sessionUpdate: 'tool_call', toolCallId: id, title, kind, status, rawInput: {} }),
  1000,
];

/* The reported shape: thinking, tool, tool, empty text, thinking, tool, text. */
function reported(): AgentRun {
  let run: AgentRun = { id: 'run-1', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Look.', status: 'done', startedAt: 0, endedAt: 9000, items: [], approvals: [], error: null } as AgentRun;
  const events: [RunNodeEvent, number][] = [
    think('Plan the read.'),
    tool('t1', 'read', 'Read a.ts', 'completed'),
    tool('t2', 'read', 'Read b.ts', 'completed'),
    say('\n\n'),
    think('Now run the tests.'),
    tool('t3', 'execute', 'Run npm test', 'completed'),
    say('All green.'),
  ];
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}

describe('the gaps between tool calls and thinking', () => {
  it('draws no empty block between the rows of a turn', () => {
    render(<AgentRunView run={reported()} now={9000} repoRoot={null} onAnswer={() => {}} />);
    const article = screen.getByTestId('agent-run');
    const blank = (el: Element): boolean => (el.textContent ?? '').trim() === '' && !el.querySelector('svg, button, img');
    const empties = [...article.querySelectorAll('.prose, p, section, ol, ul')].filter(blank);
    expect(empties.map((e) => e.className)).toEqual([]);
    expect(article.querySelectorAll('.prose').length).toBe(1);
  });

  it('keeps the thoughts and tool rows in one group container', () => {
    render(<AgentRunView run={reported()} now={9000} repoRoot={null} onAnswer={() => {}} />);
    const trails = screen.getAllByTestId('agent-trail');
    expect(trails).toHaveLength(1);
    expect(trails[0]!.querySelectorAll('[data-testid="agent-thought"]')).toHaveLength(2);
    expect(trails[0]!.querySelectorAll('[data-testid="agent-tool-fold"], .s2-agcard').length).toBeGreaterThanOrEqual(2);
    expect(trails[0]!.querySelector('.prose')).toBeNull();
  });

  it('a blank message does not split a run of settled calls', () => {
    const groups = runGroups(reported()).map((g) => g.group.map((i) => i.kind));
    expect(groups.some((g) => g.every((k) => k === 'message') && g.length > 0)).toBe(true); // the real answer only
    expect(groups.flat().filter((k) => k === 'message')).toHaveLength(1);
  });
});
