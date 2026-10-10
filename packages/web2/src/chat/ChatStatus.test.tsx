import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';
import { STEP_MS } from '../shell2/ActivityLoader';
import { AsciiSpinner, SPINNER_FRAMES, SPINNER_STILL, ChatStatus, statusText, type ChatStatusKind } from './ChatStatus';
import { splitToolTitle } from './commandLabel';
import { livePhrase } from './RunLiveStatus';

afterEach(() => {
  resetKeptOpen();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('statusText', () => {
  it('says the label, then the seconds', () => {
    expect(statusText({ kind: 'thinking', seconds: 12 })).toBe('Thinking, 12s');
    expect(statusText({ kind: 'tool', seconds: 65, label: 'Running Bash: pnpm test' })).toBe('Running Bash: pnpm test, 1m 05s');
    expect(statusText({ kind: 'queued' })).toBe('Queued');
  });
});

describe('ChatStatus', () => {
  const ACTIVE: ChatStatusKind[] = ['thinking', 'tool', 'waiting', 'queued'];
  it.each(ACTIVE)('%s: a spinner, and the glimmer on its text', (kind) => {
    render(<ChatStatus status={{ kind, seconds: 3 }} />);
    expect(screen.getByTestId('s2-ascii-spinner')).toBeTruthy();
    expect(screen.getByTestId('chat-status-text').getAttribute('data-glimmer')).toBe('true');
    expect(screen.getByTestId('chat-status').getAttribute('data-kind')).toBe(kind);
  });
  it.each(['stalled', 'error'] as const)('%s: a still mark, no spinner, no glimmer, a warning tone', (kind) => {
    render(<ChatStatus status={{ kind, seconds: 45 }} />);
    expect(screen.queryByTestId('s2-ascii-spinner')).toBeNull();
    expect(screen.getByTestId('chat-status-text').getAttribute('data-glimmer')).toBeNull();
    expect(screen.getByTestId('chat-status').getAttribute('data-tone')).toBe('warn');
  });
  it('every kind draws the one radar spinner (shell2/AsciiSpinner)', () => {
    const { unmount } = render(<ChatStatus status={{ kind: 'tool' }} />);
    expect(screen.getByTestId('s2-ascii-spinner').textContent).toBe(SPINNER_FRAMES[0]);
    unmount();
    render(<ChatStatus status={{ kind: 'thinking' }} />);
    expect(screen.getByTestId('s2-ascii-spinner').textContent).toBe(SPINNER_FRAMES[0]);
  });
});

describe('AsciiSpinner', () => {
  beforeEach(() => vi.useFakeTimers());
  it('steps through its frames and wraps', () => {
    render(<AsciiSpinner />);
    const el = screen.getByTestId('s2-ascii-spinner');
    expect(el.textContent).toBe(SPINNER_FRAMES[0]);
    act(() => void vi.advanceTimersByTime(STEP_MS));
    expect(el.textContent).toBe(SPINNER_FRAMES[1]);
    act(() => void vi.advanceTimersByTime(STEP_MS * (SPINNER_FRAMES.length - 1)));
    expect(el.textContent).toBe(SPINNER_FRAMES[0]);
  });
  it('holds one frame under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<AsciiSpinner />);
    act(() => void vi.advanceTimersByTime(900));
    const el = screen.getByTestId('s2-ascii-spinner');
    expect(el.textContent).toBe(SPINNER_STILL);
    expect(el.getAttribute('data-still')).toBe('true');
  });
});

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
function runOf(events: [RunNodeEvent, number][], over: Partial<AgentRun> = {}): AgentRun {
  let run: AgentRun = { id: 'r', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null, ...over };
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}

describe('the run reads its live status into a kind', () => {
  const live = (phase: string, extra: Record<string, unknown> = {}) => runOf([], { live: { phase, at: 0, forMs: 0, openTools: 0, ...extra } as AgentRun['live'] });
  it('maps each server phase to a state', () => {
    expect(livePhrase(live('thinking'), 0)?.kind).toBe('thinking');
    expect(livePhrase(live('tool', { tool: { kind: 'execute', title: 'pnpm test' } }), 0)).toMatchObject({ kind: 'tool', text: 'Running: pnpm test, 0s' });
    expect(livePhrase(live('waiting'), 0)?.kind).toBe('waiting');
    expect(livePhrase(live('queued'), 0)?.kind).toBe('queued');
    expect(livePhrase(live('quiet'), 0)?.kind).toBe('stalled');
  });
  it('a stalled run draws the still mark with the warning tone', () => {
    render(<AgentRunView run={live('quiet', { forMs: 45_000 })} now={0} repoRoot={null} onAnswer={() => {}} />);
    const el = screen.getByTestId('agent-run-live');
    expect(el.getAttribute('data-kind')).toBe('stalled');
    expect(el.getAttribute('data-tone')).toBe('warn');
    expect(screen.queryByTestId('s2-ascii-spinner')).toBeNull();
  });
  it('a working run draws the spinner and the glimmer', () => {
    render(<AgentRunView run={live('thinking', { forMs: 12_000 })} now={0} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-run-live').getAttribute('data-kind')).toBe('thinking');
    expect(screen.getByTestId('s2-ascii-spinner')).toBeTruthy();
    expect(screen.getByTestId('chat-status-text').getAttribute('data-glimmer')).toBe('true');
  });
});

describe('a tool call is a compact row: icon, verb, target, duration', () => {
  it('splits the verb off the target', () => {
    expect(splitToolTitle('Read src/a.ts', 'read')).toEqual({ verb: 'Read', target: 'src/a.ts' });
    expect(splitToolTitle('pnpm test', 'execute')).toEqual({ verb: 'Run', target: 'pnpm test' });
    expect(splitToolTitle('Run "C:\\Windows\\powershell.exe" -Command "npm test"', 'execute')).toEqual({ verb: 'Run', target: 'npm test' });
    expect(splitToolTitle('Something odd', null)).toEqual({ verb: null, target: 'Something odd' });
  });
  it('shows the kind icon, verb, target and duration; a running call shows the spinner', () => {
    const done = runOf([
      [upd({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Edit src/a.ts', kind: 'edit', status: 'in_progress', rawInput: {} }), 0],
      [upd({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' }), 2000],
    ]);
    const { unmount } = render(<AgentRunView run={done} now={3000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-card-verb').textContent).toBe('Edit ');
    expect(screen.getByTestId('agent-card-title').textContent).toBe('src/a.ts');
    expect(screen.getByTestId('agent-card-duration').textContent).toBe('2.0s');
    expect(screen.queryByTestId('agent-card-loader')).toBeNull();
    expect(screen.getByTestId('agent-card-dot').querySelector('svg')).not.toBeNull();
    unmount();
    const running = runOf([[upd({ sessionUpdate: 'tool_call', toolCallId: 'b', title: 'Read src/b.ts', kind: 'read', status: 'in_progress', rawInput: {} }), 0]]);
    render(<AgentRunView run={running} now={1000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-card-loader').querySelector('[data-testid="s2-ascii-spinner"]')).not.toBeNull();
  });
  it('thinking is a calm line: "Thinking" with a spinner live, "Thought for Ns" settled, text on demand', () => {
    const settled = runOf([
      [upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing it.' } }), 0],
      [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } }), 3200],
    ]);
    render(<AgentRunView run={settled} now={4000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-thought-label').textContent).toBe('Thought for 3.2 s');
    expect(screen.queryByTestId('agent-thought-text')).toBeNull();
  });
});
