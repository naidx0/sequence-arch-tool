import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns, type AgentCaps } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { rememberFirstAgent } from '../onboarding/loneAgent';
import { forgetAgentsRead, keepBuiltInChoice, pickDefaultAgent } from './defaultAgent';

/* UX audit #3: with an agent connected, a new chat or a reload names its model, not "Connect agent". */

const CHAT = 'fresh-chat';
const CAPS: AgentCaps = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: [], defaultEffort: null, isDefault: true }], efforts: [], commands: [], skills: [], slash: [] } as never;

beforeEach(() => {
  forgetAgentsRead();
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} }));
});
afterEach(() => vi.unstubAllGlobals());

const asked: string[] = [];
function mount(agents: { id: string; label?: string }[]) {
  asked.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url.split('?')[0]!);
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

  it('a chat the reader put on a built-in model is not flipped to the agent while the model list is still loading (a reload)', async () => {
    /* The reader chose a model for this chat: its agent is saved EMPTY. The model list has not answered, so the pill still says Connect agent. */
    agentRuns.patch((s) => ({ ...s, agents: { [CHAT]: '' }, runs: [{ id: 'old', turnId: null, sessionId: CHAT, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, lastEventAt: 2, stalled: null, waiting: null } as never] }));
    mount([{ id: 'claude' }]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(agentRuns.get().agents?.[CHAT]).toBe('');
  });

  it('a message sent to a built-in model saves the choice, once, and never overwrites an agent', () => {
    keepBuiltInChoice(CHAT);
    expect(agentRuns.get().agents?.[CHAT]).toBe('');
    agentRuns.patch((s) => ({ ...s, agents: { [CHAT]: 'claude' } }));
    keepBuiltInChoice(CHAT);
    expect(agentRuns.get().agents?.[CHAT]).toBe('claude');
  });

  it('agent labels arrive with the boot read of the agents, for a chat that already has its agent: the pill is right from first paint, with one read', async () => {
    agentRuns.patch((s) => ({ ...s, agents: { [CHAT]: 'claude' } }));
    mount([{ id: 'claude', label: 'Claude Code (work)' }]);
    await waitFor(() => expect(agentRuns.get().agentLabels?.claude).toBe('Claude Code (work)'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(asked.filter((u) => u === '/api/acp/agents'), 'the boot read is shared, not repeated').toHaveLength(1);
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
