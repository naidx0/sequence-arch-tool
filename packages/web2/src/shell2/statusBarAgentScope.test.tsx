import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

/* The context meter is this chat's and the active agent's: not another chat's, not the agent the chat left. */

const run = (id: string, sessionId: string, agentRef: string, used: number): AgentRun => ({
  id, sessionId, agentRef, nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: 1, endedAt: 2,
  items: [], approvals: [], error: null, usage: { used, size: 200_000, cost: null },
});

function mount(activeAgent: string) {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
  store.dispatch({ type: 'composer/context-window', tokens: 32_000 } as never);
  store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }, { id: 'c2', title: 'b', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
  /* The Sequence model's own metered turn in this chat. */
  store.dispatch({ type: 'session/hydrated', turns: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a', usage: { inputTokens: 3_600, outputTokens: 120, estimated: false } }] } as never);
  act(() => agentRuns.patch((s) => ({ ...s, runs: [run('a', 'c1', 'claude', 50_000), run('b', 'c2', 'gpt', 90_000)], agents: { c1: activeAgent } })));
  render(<StoreProvider store={store}><StatusBar /></StoreProvider>);
}

const panel = (): string => {
  fireEvent.focus(screen.getByTestId('composer-context'));
  return screen.getByTestId('composer-context-breakdown').textContent ?? '';
};

describe('the context meter after a switch', () => {
  beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {} })));
  afterEach(cleanup);

  it('shows the active agent in this chat: not the Sequence model, not another chat', () => {
    mount('claude');
    expect(panel()).toMatch(/50k/);
    expect(panel()).not.toMatch(/90k|3\.6k/);
  });

  it('control: with no agent the same instrument does read the Sequence model usage', () => {
    mount('');
    expect(panel()).toMatch(/3\.6k/);
  });

  it('after switching to an agent with no turn here yet, it does not show the old agent, the Sequence model, or another chat', () => {
    mount('gpt');
    const text = panel();
    expect(text).not.toMatch(/50k|90k|3\.6k|120|32k/);
    expect(text).toMatch(/Nothing sent yet/);
    expect(text).not.toMatch(/—/);
  });
});
