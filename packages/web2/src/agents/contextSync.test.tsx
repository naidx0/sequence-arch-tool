import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns, type AgentRun } from './agentRuns';
import { agentActivity, usageChip } from './agentActivity';
import { buildAgentsOverview } from './agentsOverview';
import { chatContext } from './contextMeter';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from '../shell2/StatusBar';

let n = 0;
const mk = (p: Partial<AgentRun> & { sessionId: string; agentRef: string }): AgentRun => ({
  id: `r${++n}`, nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: n * 10, endedAt: n * 10 + 5,
  items: [], approvals: [], error: null, ...p,
});
const tu = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0, thought: 0, total: input + output });

/* What the status bar would show (its exact call site). */
const statusBarUsed = (runs: AgentRun[], sid: string, agents: Record<string, string>) => {
  const a = agentActivity({ runs, dismissed: new Set(), agents } as never, sid);
  return a ? chatContext(runs, sid, a.agentRef).used : 'no-agent';
};
/* The pane is told which agent each chat is on, as the app does (runs state \`agents\`); a chat the map omits follows its newest run. */
const paneChat = (runs: AgentRun[], sid: string, agents: Record<string, string> = {}) => buildAgentsOverview(runs, [], 1e9, { agents, activeSessionId: sid }).chats.find((c) => c.sessionId === sid)!;
const paneHeader = (runs: AgentRun[], active: string, agents: Record<string, string> = {}) => buildAgentsOverview(runs, [], 1e9, { agents, activeSessionId: active }).context;

describe('review: win line 1 (15M processed, context <= window)', () => {
  it('runs summing to 15M processed never show more than the window', () => {
    const runs = Array.from({ length: 30 }, (_, i) =>
      mk({ sessionId: 'c', agentRef: 'codex', turnUsage: tu(500_000, 1_000), usage: i === 29 ? { used: 120_000, size: 272_000, cost: null } : null }));
    const ch = paneChat(runs, 'c');
    expect(ch.processed).toBeGreaterThanOrEqual(15_000_000);
    expect(ch.context).toBe(120_000);
    expect(statusBarUsed(runs, 'c', { c: 'codex' })).toBe(120_000);
    for (const r of ch.runs) expect(r.context === null || r.context <= 272_000).toBe(true);
  });
  it('a turn with only turnUsage (no usage_update) has no context, not a processed figure', () => {
    const runs = [mk({ sessionId: 'c', agentRef: 'codex', turnUsage: tu(15_000_000, 10) })];
    expect(paneChat(runs, 'c').context).toBeNull();
    expect(paneChat(runs, 'c').runs[0]!.context).toBeNull();
    expect(statusBarUsed(runs, 'c', { c: 'codex' })).toBeNull();
  });
  it('used > size clamps to size everywhere (pane, status bar, composer chip)', () => {
    const runs = [mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 15_000_000, size: 200_000, cost: null } })];
    expect(paneChat(runs, 'c').context).toBe(200_000);
    expect(statusBarUsed(runs, 'c', { c: 'claude' })).toBe(200_000);
    const a = agentActivity({ runs, dismissed: new Set(), agents: { c: 'claude' } } as never, 'c')!;
    expect(usageChip(a.usage)).toBe('100% ctx');
  });
  it('size 0 or missing: no clamp possible; shows used, not a sum', () => {
    const r0 = [mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 80_000, size: 0, cost: null } })];
    expect(paneChat(r0, 'c').context).toBe(80_000);
    expect(statusBarUsed(r0, 'c', { c: 'claude' })).toBe(80_000);
    const a = agentActivity({ runs: r0, dismissed: new Set(), agents: { c: 'claude' } } as never, 'c')!;
    expect(usageChip(a.usage)).toBeNull();
    const rm = [mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 80_000 } as never })];
    expect(chatContext(rm, 'c')).toEqual({ used: 80_000, size: null, source: 'agent' });
    const rz = [mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 0, size: 200_000, cost: null } })];
    expect(chatContext(rz, 'c').used).toBeNull();
  });
  it('a running run with no report after a finished run keeps the finished run reading', () => {
    const runs = [
      mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 60_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c', agentRef: 'claude', status: 'running', endedAt: null }),
    ];
    expect(paneChat(runs, 'c').context).toBe(60_000);
    expect(statusBarUsed(runs, 'c', { c: 'claude' })).toBe(60_000);
  });
  it('a finished run with no report after a reported one reads null (not the stale one)', () => {
    const runs = [
      mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 60_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c', agentRef: 'claude' }),
    ];
    expect(paneChat(runs, 'c').context).toBeNull();
    expect(statusBarUsed(runs, 'c', { c: 'claude' })).toBeNull();
  });
});

describe('review: win line 2 (status bar and Agents pane agree for one chat)', () => {
  it('Claude then Codex finished, both reported: agree on Codex', () => {
    const runs = [
      mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c', agentRef: 'codex', usage: { used: 90_000, size: 272_000, cost: null } }),
    ];
    expect(paneChat(runs, 'c', { c: 'codex' }).context).toBe(90_000);
    expect(statusBarUsed(runs, 'c', { c: 'codex' })).toBe(90_000);
  });
  it('Claude finished, chat switched to Codex which is running with no report yet', () => {
    const runs = [
      mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c', agentRef: 'codex', status: 'running', endedAt: null }),
    ];
    expect(statusBarUsed(runs, 'c', { c: 'codex' })).toBe(paneChat(runs, 'c', { c: 'codex' }).context);
    expect(paneChat(runs, 'c', { c: 'codex' }).context).toBeNull();
  });
  it('Claude finished, chat switched to Codex, no Codex turn yet', () => {
    const runs = [mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } })];
    expect(statusBarUsed(runs, 'c', { c: 'codex' })).toBe(paneChat(runs, 'c', { c: 'codex' }).context);
    expect(paneChat(runs, 'c', { c: 'codex' }).context).toBeNull();
  });
  it('Claude, Codex, then back to Claude (no new turn): agree', () => {
    const runs = [
      mk({ sessionId: 'c', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c', agentRef: 'codex', usage: { used: 90_000, size: 272_000, cost: null } }),
    ];
    expect(statusBarUsed(runs, 'c', { c: 'claude' })).toBe(paneChat(runs, 'c', { c: 'claude' }).context);
    expect(paneChat(runs, 'c', { c: 'claude' }).context).toBe(50_000);
  });
});

describe('review: win line 3 (never another chat)', () => {
  it('pane header for the newest chat with no report does not show another chat context', () => {
    const runs = [
      mk({ sessionId: 'a', agentRef: 'claude', usage: { used: 150_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'b', agentRef: 'codex', turnUsage: tu(1000, 10) }),
    ];
    /* chat b is newest (ended last); it has no context. Header shows... */
    expect(paneHeader(runs, 'b', { a: 'claude', b: 'codex' })).toBeNull();
    expect(paneHeader(runs, 'a', { a: 'claude', b: 'codex' })).toBe(150_000);
  });
  it('status bar for chat b does not show chat a', () => {
    const runs = [
      mk({ sessionId: 'a', agentRef: 'claude', usage: { used: 150_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'b', agentRef: 'claude' }),
    ];
    expect(statusBarUsed(runs, 'b', { a: 'claude', b: 'claude' })).toBeNull();
  });
});

/* Rendered status bar after an agent switch, against the pane's number for the same chat. */
describe('review: rendered status bar vs pane after Claude -> Codex', () => {
  beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {} })));
  afterEach(cleanup);
  it('shows the same number', () => {
    const runs = [
      mk({ sessionId: 'c1', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } }),
      mk({ sessionId: 'c1', agentRef: 'codex', status: 'running', endedAt: null }),
    ];
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
    act(() => agentRuns.patch((s) => ({ ...s, runs, agents: { c1: 'codex' } })));
    render(<StoreProvider store={store}><StatusBar /></StoreProvider>);
    fireEvent.focus(screen.getByTestId('composer-context'));
    const text = screen.getByTestId('composer-context-breakdown').textContent ?? '';
    const pane = paneChat(runs, 'c1', { c1: 'codex' }).context;
    /* Scope: the chat's CURRENT agent. Codex has not reported, so the bar and the pane are both unknown (not Claude's 50k). */
    expect(pane).toBeNull();
    expect(text).not.toMatch(/50k/);
    expect(text).toMatch(/Nothing sent yet/);
  });
});
