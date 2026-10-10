import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns, type AgentCaps } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { rememberFirstAgent } from '../onboarding/loneAgent';
import { pickDefaultAgent } from './defaultAgent';

/* UX audit #3: with an agent connected, a new chat or a reload names its model, not "Connect agent". */

const CHAT = 'fresh-chat';
const CAPS: AgentCaps = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: [], defaultEffort: null, isDefault: true }], efforts: [], commands: [], skills: [], slash: [] } as never;

beforeEach(() => {
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} }));
});
afterEach(() => vi.unstubAllGlobals());

function mount(agents: { id: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/acp/capabilities')) return new Response(JSON.stringify(CAPS), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/acp/agents')) return new Response(JSON.stringify({ agents }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Promise<Response>(() => {});
    }),
  );
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: CHAT, title: 'New', pinned: false, updatedAt: '2026-01-01' }], activeId: CHAT } as never);
  render(<V3App appStore={store} />);
}

describe('the pill with an agent connected', () => {
  it('picks the last-used agent, else the only one, else nothing', () => {
    expect(pickDefaultAgent(['codex', 'claude'], 'claude')).toBe('claude');
    expect(pickDefaultAgent(['claude'], undefined)).toBe('claude');
    expect(pickDefaultAgent(['codex', 'claude'], undefined)).toBeNull();
    expect(pickDefaultAgent([], 'claude')).toBeNull();
    // first run's note breaks a tie, but a last-used agent still wins
    expect(pickDefaultAgent(['codex', 'claude'], undefined, 'codex')).toBe('codex');
    expect(pickDefaultAgent(['codex', 'claude'], 'claude', 'codex')).toBe('claude');
    expect(pickDefaultAgent(['claude'], undefined, 'gone')).toBe('claude');
  });

  it('a fresh chat with one connected agent shows its model, not "Connect agent"', async () => {
    mount([{ id: 'claude' }]);
    await waitFor(() => expect(screen.getByTestId('v3-model-trigger').getAttribute('data-action')).toBe('agent'));
    expect(screen.getByTestId('v3-model-trigger').textContent).not.toMatch(/Connect agent/);
    expect(agentRuns.get().agents?.[CHAT]).toBe('claude');
  });

  it('with two registered, the agent first run connected is the fresh chat\'s agent', async () => {
    localStorage.setItem('sequence.onboarding.firstAgent', 'codex');
    mount([{ id: 'claude' }, { id: 'codex' }]);
    await waitFor(() => expect(agentRuns.get().agents?.[CHAT]).toBe('codex'));
  });

  it('with no agent registered it still says Connect agent', async () => {
    mount([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByTestId('v3-model-trigger').textContent).toMatch(/Connect agent/);
  });

  it('round 12: an agent connected while the chat is already on screen (first run no longer reloads) becomes its agent', async () => {
    const live = { agents: [] as { id: string }[] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/acp/capabilities')) return new Response(JSON.stringify(CAPS), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.startsWith('/api/acp/agents')) return new Response(JSON.stringify(live), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Promise<Response>(() => {});
      }),
    );
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: CHAT, title: 'New', pinned: false, updatedAt: '2026-01-01' }], activeId: CHAT } as never);
    render(<V3App appStore={store} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(agentRuns.get().agents?.[CHAT]).toBeUndefined();
    live.agents = [{ id: 'claude' }, { id: 'codex' }];
    await act(async () => {
      rememberFirstAgent('codex');
    });
    await waitFor(() => expect(agentRuns.get().agents?.[CHAT]).toBe('codex'));
  });
});
