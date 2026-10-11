/* ══════════════════════════════════════════════════════════════════════════
   CHAT POLISH (R10): what the chat says, in plain words
   packages/web2/src/chat/chatPolish.test.tsx

   Durations under 100 ms are not shown; a subagent named by its slug reads as
   a title; the fold says "1 search"; the watchdog says the start is slow and
   offers Retry for a stalled tool; the pill says "Sonnet 5", not the id; the
   rail title keeps clear of its overflow button.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import type { AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import type { SubagentRef } from '../agents/subagents';
import { SubagentSubRows } from '../shell2/SubagentRows';
import { AgentRunView, RunFoot, visibleDuration } from './AgentRunThread';
import { displayModelName } from './modelNickname';
import { foldSummary } from './commandLabel';
import { subagentLabel } from './subagentLabel';
import { HUNG_MS, QUIET_MS, RunWatchdog, watchdogLevel } from './RunWatchdog';

const t0 = 1_800_000_000_000;
const running = (over: Partial<AgentRun> = {}): AgentRun =>
  ({ id: 'r', sessionId: 's', agentRef: 'claude', prompt: 'q', status: 'running', startedAt: t0, endedAt: null, items: [], approvals: [], retry: { question: 'q' }, ...over }) as AgentRun;

describe('durations under 100 ms are not shown', () => {
  it('hides 0ms and 1ms, shows 100ms and up', () => {
    expect(visibleDuration(0)).toBeNull();
    expect(visibleDuration(1)).toBeNull();
    expect(visibleDuration(99.4)).toBeNull();
    expect(visibleDuration(100)).toBe('100ms');
    expect(visibleDuration(null)).toBeNull();
  });

  it('a subagent that ran for 40 ms shows no duration', () => {
    const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
    let run: AgentRun = { id: 'q', sessionId: 'c', agentRef: 'claude', prompt: 'p', status: 'running', startedAt: 1_000, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    run = foldRunEvent(run, upd({ sessionUpdate: 'tool_call', toolCallId: 'task', title: 'Task', kind: 'other', status: 'completed', rawInput: { subagent_type: 'Explore', description: 'quick look' } }), 1_000);
    run = foldRunEvent(run, upd({ sessionUpdate: 'tool_call_update', toolCallId: 'task', status: 'completed' }), 1_040);
    render(<AgentRunView run={run} now={5_000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-subagent').textContent).toContain('Explore');
    expect(screen.queryByTestId('agent-subagent-duration')).toBeNull();
    /* No dangling separator where the duration would have been. */
    expect(screen.getByTestId('agent-subagent').querySelector('.agsub-meta')?.textContent?.trim().endsWith(',')).toBe(false);
  });
});

describe('a subagent with a slug type reads as a title', () => {
  it('general-purpose becomes "General purpose"; a description becomes the title', () => {
    expect(subagentLabel('general-purpose', '')).toEqual({ title: 'General purpose', detail: '' });
    expect(subagentLabel('general-purpose', 'audit the build')).toEqual({ title: 'audit the build', detail: '' });
    expect(subagentLabel('Explore', 'find the auth code')).toEqual({ title: 'Explore', detail: 'find the auth code' });
  });

  it('the rail sub-row and the chat card both show the readable title', () => {
    const ref: SubagentRef = { runId: 'r', toolId: 't', name: 'general-purpose', description: '', status: 'done', startedAt: 1, endedAt: 2 } as SubagentRef;
    render(<SubagentSubRows refs={[ref]} onPick={() => {}} />);
    expect(screen.getByTestId('rail-subagent').textContent).toBe('General purpose');
  });

  it('the chat card names it "General purpose"', () => {
    const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
    let run: AgentRun = { id: 'q', sessionId: 'c', agentRef: 'claude', prompt: 'p', status: 'running', startedAt: 1_000, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    run = foldRunEvent(run, upd({ sessionUpdate: 'tool_call', toolCallId: 'task', title: 'Task', kind: 'other', status: 'completed', rawInput: { subagent_type: 'general-purpose' } }), 1_000);
    render(<AgentRunView run={run} now={5_000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-subagent-name').textContent).toBe('General purpose');
  });
});

describe('the fold counts searches', () => {
  it('"1 search" and "3 searches", never "searched 1 time"', () => {
    expect(foldSummary([{ toolKind: 'search' }])).toBe('1 search');
    expect(foldSummary([{ toolKind: 'search' }, { toolKind: 'search' }, { toolKind: 'search' }])).toBe('3 searches');
    expect(foldSummary([{ toolKind: 'search' }, { toolKind: 'read' }])).toBe('1 search, read 1 file');
  });
});

describe('the model pill says the nickname', () => {
  it.each([
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-opus-4-1-20250805', 'Opus 4.1'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['gpt-5', 'GPT-5'],
  ])('%s -> %s', (id, want) => {
    expect(displayModelName(id)).toBe(want);
  });
});

describe('the watchdog', () => {
  it('a stalled tool is hung and offers Retry; a live tool keeps "Running <tool> for 2m"', () => {
    const tool = running({ waiting: { reason: 'tool', quietMs: 120_000, toolKind: 'execute' } as never });
    expect(watchdogLevel({ ...tool, stalled: null } as AgentRun, t0 + 120_000)?.level).toBe('tool');
    expect(watchdogLevel({ ...tool, stalled: { since: t0, reason: 'Tool running without new events for 120s' } } as AgentRun, t0 + 120_000)?.level).toBe('hung');

    const onRetry = vi.fn();
    const onStop = vi.fn();
    const stalled = { ...tool, stalled: { since: t0, reason: 'stalled' }, items: [{ kind: 'note', id: 'n', text: 'x' }] } as unknown as AgentRun;
    render(<RunWatchdog run={stalled} now={t0 + 120_000} onStop={onStop} onRetry={onRetry} />);
    expect(screen.getByTestId('agent-run-watchdog').getAttribute('data-level')).toBe('hung');
    expect(screen.getByTestId('agent-run-watchdog-retry')).toBeTruthy();
  });

  it('a live tool shows the running line with no Retry', () => {
    const live = { ...running({ waiting: { reason: 'tool', quietMs: 120_000, toolKind: 'execute' } as never }), items: [{ kind: 'note', id: 'n', text: 'x' }] } as unknown as AgentRun;
    render(<RunWatchdog run={live} now={t0 + 120_000} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByTestId('agent-run-watchdog').getAttribute('data-level')).toBe('tool');
    expect(screen.queryByTestId('agent-run-watchdog-retry')).toBeNull();
  });

  it('while the run is still starting, the note says so and sits under the start line', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(t0 + QUIET_MS);
      const { container } = render(<RunFoot run={running()} onStop={() => {}} onRetry={() => {}} />);
      expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('Claude is still starting, 45s');
      const start = screen.getByTestId('agent-run-starting');
      const note = screen.getByTestId('agent-run-watchdog');
      expect(start.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(container).getAllByTestId('agent-run-watchdog')).toHaveLength(1);
      expect(note.querySelector('.agnote-mark')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('once the agent has spoken, a quiet turn is "No response from Claude"', () => {
    const spoke = running({ items: [{ kind: 'note', id: 'n', text: 'x' }] } as never);
    expect(watchdogLevel(spoke, t0 + QUIET_MS)?.level).toBe('quiet');
    render(<RunWatchdog run={spoke} now={t0 + QUIET_MS} onStop={() => {}} />);
    expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('No response from Claude for 45s');
    expect(HUNG_MS).toBeGreaterThan(QUIET_MS);
  });
});

describe('the rail title keeps clear of its overflow button', () => {
  it('the rail row reserves the button width on the right', () => {
    const css = readFileSync(join(__dirname, '../shell2/railSubagents.css'), 'utf8');
    expect(css).toMatch(/\.s2-it > \.s2-it-hit\.s2-rail-hit\s*\{[^}]*padding-right:\s*calc\(var\(--target-min\)/);
  });
});
