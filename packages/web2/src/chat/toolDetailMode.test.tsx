import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { StepList } from '../shell2/StepList';
import { ToolDetailToggle } from '../shell2/StatusBar';
import { readToolDetail, resetToolDetailForTest, TOOL_DETAIL_KEY, writeToolDetail } from '../settings/toolDetailPreference';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
});
afterEach(() => resetKeptOpen());

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
const think = (text: string): [RunNodeEvent, number] => [upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } }), 0];
const tool = (id: string, kind: string, title: string, status: string, at = 1000): [RunNodeEvent, number] => [
  upd({ sessionUpdate: 'tool_call', toolCallId: id, title, kind, status, rawInput: {} }),
  at,
];
const say = (text: string): [RunNodeEvent, number] => [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }), 0];

function runOf(events: [RunNodeEvent, number][], over: Partial<AgentRun> = {}): AgentRun {
  let run = { id: 'run-1', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Go.', status: 'done', startedAt: 0, endedAt: 9000, items: [], approvals: [], error: null, ...over } as AgentRun;
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}
const view = (run: AgentRun) => <AgentRunView run={run} now={9000} repoRoot={null} onAnswer={() => {}} />;

const DONE = [
  think('Look around.'),
  tool('t1', 'read', 'Read a.ts', 'completed'),
  tool('t2', 'read', 'Read b.ts', 'completed'),
  tool('t3', 'execute', 'Run npm test', 'completed'),
  say('All green.'),
];

describe('the preference', () => {
  it('defaults to Focused, persists, and a corrupt value is Focused', () => {
    expect(readToolDetail()).toBe('focused');
    writeToolDetail('detailed');
    expect(localStorage.getItem(TOOL_DETAIL_KEY)).toBe('detailed');
    expect(readToolDetail()).toBe('detailed');
    localStorage.setItem(TOOL_DETAIL_KEY, 'garbage');
    resetToolDetailForTest();
    expect(readToolDetail()).toBe('focused');
  });
});

describe('a fold stays live while any call in it runs', () => {
  it('3 parallel calls, the middle one running: the row names it and shows the spinner, not a check', () => {
    const run = runOf(
      [tool('t1', 'read', 'Read a.ts', 'completed'), tool('t2', 'read', 'Read b.ts', 'in_progress'), tool('t3', 'read', 'Read c.ts', 'completed')],
      { status: 'running', endedAt: null },
    );
    render(view(run));
    const fold = screen.getByTestId('agent-tool-fold');
    expect(fold.getAttribute('data-live')).toBe('true');
    expect(within(fold).getByTestId('agent-tool-fold-summary').textContent).toBe('Read b.ts');
    expect(fold.querySelector('.s2-ok')).toBeNull();
  });
});

describe('Focused and Detailed in an agent run', () => {
  it('Focused: one summary row with a chevron, the thought on one line, the answer shown', () => {
    render(view(runOf(DONE)));
    const fold = screen.getByTestId('agent-tool-fold');
    expect(within(fold).getByTestId('agent-tool-fold-summary').textContent).toBe('Read 2 files, ran 1 command');
    expect(within(fold).getByTestId('agent-tool-fold-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('agent-thought-label').textContent).toMatch(/^Thought for /);
    expect(screen.getByText('All green.')).toBeTruthy();
  });

  it('Detailed: every call is its own card and nothing folds', () => {
    writeToolDetail('detailed');
    render(view(runOf(DONE)));
    expect(screen.queryByTestId('agent-tool-fold')).toBeNull();
    expect(document.querySelectorAll('.s2-agcard').length).toBe(3);
    expect(screen.getByText('All green.')).toBeTruthy();
  });

  it('a failed call stays its own visible row even in Focused', () => {
    render(
      view(
        runOf([
          tool('t1', 'read', 'Read a.ts', 'completed'),
          tool('t2', 'read', 'Read b.ts', 'completed'),
          tool('t3', 'execute', 'Run npm test', 'failed'),
          tool('t4', 'read', 'Read c.ts', 'completed'),
          tool('t5', 'read', 'Read d.ts', 'completed'),
        ]),
      ),
    );
    expect(screen.getAllByTestId('agent-tool-fold')).toHaveLength(2);
    const failed = [...document.querySelectorAll('.s2-agcard')].filter((c) => c.getAttribute('data-status') === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.closest('[data-testid="agent-tool-fold"]')).toBeNull();
  });

  it('while streaming, the fold row shows the live step instead of stacking cards', () => {
    const run = runOf([tool('t1', 'read', 'Read a.ts', 'completed'), tool('t2', 'execute', 'Run npm test', 'in_progress', 2000)], { status: 'running', endedAt: null });
    render(view(run));
    const fold = screen.getByTestId('agent-tool-fold');
    expect(fold.getAttribute('data-live')).toBe('true');
    expect(within(fold).getByTestId('agent-tool-fold-summary').textContent).toMatch(/npm test/);
    expect(document.querySelectorAll('.s2-agcard').length).toBe(0);
  });

  it('the toggle flips the transcript', () => {
    render(
      <>
        <ToolDetailToggle />
        {view(runOf(DONE))}
      </>,
    );
    expect(screen.getByTestId('agent-tool-fold')).toBeTruthy();
    fireEvent.click(screen.getByTestId('s2-tool-detail-detailed'));
    expect(screen.queryByTestId('agent-tool-fold')).toBeNull();
    expect(screen.getByTestId('s2-tool-detail-detailed').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('s2-tool-detail-focused'));
    expect(screen.getByTestId('agent-tool-fold')).toBeTruthy();
    expect(localStorage.getItem(TOOL_DETAIL_KEY)).toBe('focused');
  });

  it('the toggle labels are Focused and Detailed, with no middle dot', () => {
    render(<ToolDetailToggle />);
    expect(screen.getByTestId('s2-tool-detail').textContent).toBe('FocusedDetailed');
  });
});

describe('Focused and Detailed in a Sequence turn (StepList)', () => {
  const tools = [
    { id: 'a', name: 'read_file', text: 'ok' },
    { id: 'b', name: 'read_file', text: 'ok' },
    { id: 'c', name: 'run_command', text: 'refused: run_command: not allowed' },
    { id: 'd', name: 'search_files', text: 'ok' },
    { id: 'e', name: 'search_files', text: 'ok' },
  ];
  it('Focused folds runs and keeps the refused call as its own row', () => {
    render(<StepList tools={tools} />);
    expect(screen.getAllByTestId('s2-step-fold')).toHaveLength(2);
    const rows = screen.getAllByTestId('s2-step');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-state')).toBe('refused');
    expect(screen.getAllByTestId('s2-step-fold-summary')[0]!.textContent).toBe('Read 2 files');
  });
  it('Detailed shows every step', () => {
    writeToolDetail('detailed');
    render(<StepList tools={tools} />);
    expect(screen.queryByTestId('s2-step-fold')).toBeNull();
    expect(screen.getAllByTestId('s2-step')).toHaveLength(5);
  });
  it('a running run names the live step', () => {
    render(<StepList tools={tools.slice(0, 2)} running />);
    expect(screen.getByTestId('s2-step-fold-summary').textContent).not.toMatch(/Read 2 files/);
  });
});
