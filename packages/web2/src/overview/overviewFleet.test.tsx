/**
 * The cross-chat glance (0184 finish): how many agents run, how many chats there are, one mark per running agent.
 * Counts come from the page's run store and the session index; an unknown value says unknown, never zero.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { contextPercent } from '../chat/ContextRing';
import { createStore, StoreProvider } from '../state';
import { ChatOverview } from './ChatOverview';
import { fleetSummary } from './overviewFleet';

const run = (id: string, sessionId: string | null, agentRef: string | null, status: AgentRun['status'] = 'running', usage?: { used: number; size: number }) =>
  ({ id, sessionId, agentRef, startedAt: 1, status, usage }) as AgentRun;
const chat = (id: string) => ({ id, title: id, createdAt: '2026-10-01', updatedAt: '2026-10-01', pinned: false });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  agentRuns.patch((s) => ({ ...s, agents: {}, runs: [], caps: {}, chatConfig: {}, agentLabels: {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, runs: [], agentLabels: {} }));
});

function draw(chats: string[], activeId: string | null) {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: chats.map(chat), activeId } as never);
  render(
    <StoreProvider store={store}>
      <ChatOverview onOpenSurface={() => {}} />
    </StoreProvider>,
  );
  return store;
}

describe('fleetSummary (pure)', () => {
  const ids = ['a', 'b', 'c'];
  it('counts only running runs, per agent, in chats that exist', () => {
    const s = fleetSummary(
      [run('1', 'a', 'claude'), run('2', 'b', 'codex'), run('3', 'b', 'codex'), run('4', 'c', 'claude', 'done'), run('5', 'c', 'claude', 'failed'), run('6', 'gone', 'claude')],
      ids,
      {},
    );
    expect(s.running).toBe(3);
    expect(s.runningChats).toBe(2);
    expect(s.chats).toBe(3);
    expect(s.agents.map((a) => [a.ref, a.runs])).toEqual([['claude', 1], ['codex', 2]]);
  });
  it('a run with no agent is an unknown agent, still counted', () => {
    const s = fleetSummary([run('1', 'a', null)], ids, {});
    expect(s.running).toBe(1);
    expect(s.agents[0]).toMatchObject({ ref: null, name: 'Unknown agent' });
  });
  it('an index that has not loaded is unknown, not zero chats, and drops no run', () => {
    const s = fleetSummary([run('1', 'a', 'claude')], null, {});
    expect(s.chats).toBeNull();
    expect(s.running).toBe(1);
  });
  it('registered labels name the agent', () => {
    const s = fleetSummary([run('1', 'a', 'codex')], ids, { codex: 'Codex (work)' });
    expect(s.agents[0]!.name).toBe('Codex (work)');
  });
});

describe('the glance in the overview', () => {
  it('nothing running says so, and the chat count is the index', () => {
    draw(['a', 'b', 'c'], 'a');
    expect(screen.getByTestId('ov-agents').textContent).toContain('None running');
    expect(within(screen.getByTestId('ov-agents')).queryAllByTestId('ov-agent-mark')).toHaveLength(0);
    expect(screen.getByTestId('ov-chats').textContent).toBe('3 chats');
  });

  it('draws one named mark per running agent, with the run count, and the chats running', () => {
    agentRuns.patch((s) => ({ ...s, runs: [run('1', 'a', 'claude'), run('2', 'b', 'codex'), run('3', 'c', 'codex'), run('4', 'a', 'claude', 'done')] }));
    draw(['a', 'b', 'c', 'd'], 'a');
    expect(screen.getByTestId('ov-agents').textContent).toContain('3 running');
    const marks = screen.getAllByTestId('ov-agent-mark');
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(['Claude Code, 1 running', 'Codex, 2 running']);
    expect(marks.every((m) => m.getAttribute('role') === 'img')).toBe(true);
    expect(screen.getByTestId('ov-chats').textContent).toBe('4 chats, 3 running');
  });

  it('follows the store live', () => {
    draw(['a', 'b'], 'a');
    expect(screen.getByTestId('ov-agents').textContent).toContain('None running');
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run('1', 'b', 'claude')] })));
    expect(screen.getByTestId('ov-agents').textContent).toContain('1 running');
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run('1', 'b', 'claude', 'done')] })));
    expect(screen.getByTestId('ov-agents').textContent).toContain('None running');
  });

  it('an index that has not loaded reads Unknown, never 0 chats', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <ChatOverview onOpenSurface={() => {}} />
      </StoreProvider>,
    );
    expect(screen.getByTestId('ov-chats').textContent).toBe('Unknown');
  });

  it('an empty index after it arrives is 0 chats, not Unknown', () => {
    draw([], null);
    expect(screen.getByTestId('ov-chats').textContent).toBe('0 chats');
  });

  it('a run with no agent named gets the unknown mark', () => {
    agentRuns.patch((s) => ({ ...s, runs: [run('1', 'a', null)] }));
    draw(['a'], 'a');
    expect(screen.getByTestId('ov-agent-mark').getAttribute('aria-label')).toBe('Unknown agent, 1 running');
  });

  it("another chat's run never feeds this chat's window", () => {
    agentRuns.patch((s) => ({ ...s, agents: { a: 'claude', b: 'codex' }, runs: [run('1', 'a', 'claude', 'done', { used: 20000, size: 200000 }), run('2', 'b', 'codex', 'running', { used: 90000, size: 100000 })] }));
    draw(['a', 'b'], 'a');
    expect(screen.getByTestId('ov-window').textContent).toBe('20k of 200k');
    expect(screen.getByTestId('ov-agents').textContent).toContain('1 running');
  });
});

describe('the context percent agrees with the status bar helper', () => {
  it('says the same percent contextPercent gives, in the words SimpleML uses', () => {
    agentRuns.patch((s) => ({ ...s, agents: { a: 'claude' }, runs: [run('1', 'a', 'claude', 'done', { used: 34000, size: 100000 })] }));
    draw(['a'], 'a');
    expect(contextPercent(34000, 100000)).toBe('34%');
    expect(screen.getByTestId('ov-used').textContent).toBe(`${contextPercent(34000, 100000)} of context`);
  });
  it('a tiny use never reads 0%', () => {
    agentRuns.patch((s) => ({ ...s, agents: { a: 'claude' }, runs: [run('1', 'a', 'claude', 'done', { used: 300, size: 200000 })] }));
    draw(['a'], 'a');
    expect(screen.getByTestId('ov-used').textContent).toBe('<1% of context');
  });
  it('an unmeasured chat shows no percent row rather than 0%', () => {
    draw(['a'], 'a');
    expect(screen.queryByTestId('ov-used')).toBeNull();
  });
});
