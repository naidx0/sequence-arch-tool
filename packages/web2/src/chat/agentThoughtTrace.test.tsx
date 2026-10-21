import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { resetToolDetailForTest, writeToolDetail } from '../settings/toolDetailPreference';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';

/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT'S THOUGHT, IN FOCUSED MODE, IS THE REASONING TRACE
   packages/web2/src/chat/agentThoughtTrace.test.tsx

   The built-in model's thought opened onto structured steps (the AI-Traces
   port) while an AGENT's thought (Claude Code, Codex) opened onto one wall of
   markdown, "## Heading" and all. Focused mode draws both the same way;
   Detailed keeps the agent's raw words.
   ══════════════════════════════════════════════════════════════════════════ */

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
const thought = (text: string): RunNodeEvent => upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } });
const say = (text: string): RunNodeEvent => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
function runOf(events: [RunNodeEvent, number][]): AgentRun {
  let run: AgentRun = { id: 'r', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null };
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}
const WORDS = 'Check the key first. It is keyed on the address.\n\n## Trust boundary\nLook at whether x-forwarded-for is trusted.';

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
});
afterEach(() => resetKeptOpen());

const open = () => fireEvent.click(screen.getByTestId('agent-thought').querySelector('button')!);

describe('an agent thought, opened', () => {
  it('focused: one step per paragraph, the model\'s own heading as the title, no raw markdown', async () => {
    const run = runOf([[thought(WORDS), 0], [say('Done.'), 3000]]);
    render(<AgentRunView run={run} now={4000} repoRoot={null} onAnswer={() => {}} />);
    open();
    const steps = await screen.findAllByTestId('reasoning-step');
    expect(steps).toHaveLength(2);
    expect(steps[1]!.textContent).toContain('Trust boundary');
    expect(screen.getByTestId('agent-thought').textContent).not.toContain('## ');
  });

  it('detailed: the agent\'s words as it wrote them', () => {
    writeToolDetail('detailed');
    const run = runOf([[thought(WORDS), 0], [say('Done.'), 3000]]);
    render(<AgentRunView run={run} now={4000} repoRoot={null} onAnswer={() => {}} />);
    open();
    expect(screen.queryAllByTestId('reasoning-step')).toHaveLength(0);
    expect(screen.getByTestId('agent-thought-text').textContent).toContain('## Trust boundary');
  });

  it('streaming: the paragraph still being written is marked open, a settled thought has none', async () => {
    const live = runOf([[thought(WORDS), 0]]);
    const { unmount } = render(<AgentRunView run={live} now={1000} repoRoot={null} onAnswer={() => {}} />);
    open();
    const steps = await screen.findAllByTestId('reasoning-step');
    expect(steps[steps.length - 1]!.getAttribute('data-open')).toBe('true');
    unmount();
    resetKeptOpen();
    render(<AgentRunView run={runOf([[thought(WORDS), 0], [say('Done.'), 3000]])} now={4000} repoRoot={null} onAnswer={() => {}} />);
    open();
    const settled = await screen.findAllByTestId('reasoning-step');
    expect(settled.some((s) => s.getAttribute('data-open') === 'true')).toBe(false);
  });

  it('no words (codex reasoning carries none): the time alone, nothing to open', () => {
    const run = runOf([[thought(''), 0], [say('Done.'), 3000]]);
    render(<AgentRunView run={run} now={4000} repoRoot={null} onAnswer={() => {}} />);
    const button = screen.getByTestId('agent-thought').querySelector('button')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.queryAllByTestId('reasoning-step')).toHaveLength(0);
  });
});
