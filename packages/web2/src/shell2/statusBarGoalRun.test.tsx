import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { goalRunLive } from '../agents/goalRunLive';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

/*
 * A GOAL RUN'S AGENT IS DRIVEN BY THE SERVER, so the window has no run of its own for it and the bar read
 * "Idle" beside "Default model" while the run worked (reviewer 2026-10-15). It now reads the run the goal bar polls.
 */

function mount() {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
  store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }, { id: 'c2', title: 'b', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
  render(<StoreProvider store={store}><StatusBar /></StoreProvider>);
}
const state = (): string => screen.getByTestId('s2-status-state').textContent ?? '';

describe('the status bar while a goal run works', () => {
  beforeEach(() => {
    agentRuns.patch((s) => ({ ...s, runs: [], agents: {} }));
    for (const id of ['c1', 'c2']) goalRunLive.set(id, null);
  });
  afterEach(cleanup);

  it('control: with no run it says Idle', () => {
    mount();
    expect(state()).toBe('Idle');
  });

  it('says the run is working, on which turn, and names the agent instead of "Default model"', () => {
    mount();
    act(() => goalRunLive.set('c1', { turns: 1, agentRef: 'claude' }));
    expect(state()).toBe('Working on goal, turn 2');
    expect(screen.getByTestId('s2-status-state').getAttribute('data-state')).toBe('working');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Claude');
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('Claude');
    expect(screen.queryByText('Default model')).toBeNull();
  });

  it('another chat\'s run is not this chat\'s', () => {
    mount();
    act(() => goalRunLive.set('c2', { turns: 4, agentRef: 'codex' }));
    expect(state()).toBe('Idle');
  });

  it('a run on Sequence\'s own model says it is working and keeps the model the chat uses', () => {
    mount();
    act(() => goalRunLive.set('c1', { turns: 0 }));
    expect(state()).toBe('Working on goal, turn 1');
    expect(screen.getByTestId('s2-status-model').textContent).not.toBe('');
  });

  it('the followed turn of the run (a live record with an agent that has not named its model) still names the agent', () => {
    mount();
    act(() =>
      agentRuns.patch((s) => ({
        ...s,
        runs: [{ id: 'saved-t1', sessionId: 'c1', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Goal run: x', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, restored: true }],
        agents: { c1: 'claude' },
      })),
    );
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Default model');
    act(() => goalRunLive.set('c1', { turns: 1, agentRef: 'claude' }));
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Claude');
  });

  it('goes back to Idle when the run ends', () => {
    mount();
    act(() => goalRunLive.set('c1', { turns: 2, agentRef: 'claude' }));
    act(() => goalRunLive.set('c1', null));
    expect(state()).toBe('Idle');
  });
});
