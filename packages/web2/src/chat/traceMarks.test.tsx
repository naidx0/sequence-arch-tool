import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { resetToolDetailForTest } from '../settings/toolDetailPreference';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';
import { ReasoningTraceView } from './ReasoningTraceView';

/* ══════════════════════════════════════════════════════════════════════════
   THE MARKS THAT GO WITH A TRACE
   packages/web2/src/chat/traceMarks.test.tsx

   The reasoning trace drew the same four-point spark at every step and on the
   fold's header: eight identical "logos" down one rail, and the Claude-like
   spark on a Codex run. Now a step is a dot on the rail (the reference's
   marker, the live one lit), and a settled thought wears the mark of the agent
   that thought, through the one brand lookup (shell2/brandIcons).
   ══════════════════════════════════════════════════════════════════════════ */

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
function settled(agentRef: string | null, model: string | null = null): AgentRun {
  let run: AgentRun = { id: 'r', sessionId: null, agentRef, nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null, model };
  run = foldRunEvent(run, upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing it.' } }), 0);
  return foldRunEvent(run, upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } }), 3000);
}

beforeEach(() => {
  localStorage.clear();
  resetToolDetailForTest();
});
afterEach(() => resetKeptOpen());

describe('a trace step', () => {
  it('is a dot on the rail, not a spark; the paragraph still being written is the lit one', () => {
    render(<ReasoningTraceView chunks={['First paragraph here.\n\nSecond, still being writ']} streaming />);
    const steps = screen.getAllByTestId('reasoning-step');
    expect(steps).toHaveLength(2);
    for (const step of steps) expect(step.querySelector('[data-icon="spark"]')).toBeNull();
    const marks = screen.getAllByTestId('reasoning-step-mark');
    expect(marks.map((m) => m.getAttribute('data-state'))).toEqual(['done', 'live']);
  });
});

describe('a settled agent thought', () => {
  const brandOfHeader = (run: AgentRun): string | null => {
    render(<AgentRunView run={run} now={4000} repoRoot={null} onAnswer={() => {}} />);
    const head = screen.getByTestId('agent-thought').querySelector('button')!;
    return head.querySelector('[data-brand]')?.getAttribute('data-brand') ?? null;
  };
  it('wears the mark of the agent that thought', () => {
    expect(brandOfHeader(settled('claude'))).toBe('claude');
  });
  it('a Codex run wears the Codex mark, not the Claude-like spark', () => {
    expect(brandOfHeader(settled('codex'))).toBe('codex');
    expect(screen.getByTestId('agent-thought').querySelector('[data-icon="spark"]')).toBeNull();
  });
  it('an agent with no mark of its own keeps the neutral thinking glyph', () => {
    expect(brandOfHeader(settled('mystery-agent-9000'))).toBeNull();
    expect(screen.getByTestId('agent-thought').querySelector('[data-icon="spark"]')).not.toBeNull();
  });
  it('the mark is not a button of its own: pressing the header still opens the thought', async () => {
    render(<AgentRunView run={settled('claude')} now={4000} repoRoot={null} onAnswer={() => {}} />);
    fireEvent.click(screen.getByTestId('agent-thought').querySelector('button')!);
    expect((await screen.findAllByTestId('reasoning-step')).length).toBe(1);
  });
});
