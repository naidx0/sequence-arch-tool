import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { AgentsPane } from './AgentsPane';
import type { AgentRow, AgentsClient } from './agentsClient';

/*
 * 0.1.5 G1: "I disconnected it. I reconnected it. Still nothing I could do."
 * Settings' Disconnect and Connect now change what the picker offers at once:
 * Disconnect drops the agent (a chat on it goes back to a model) and forgets a
 * failed model read; Connect asks for its models afresh, past the server's
 * cache. And an unreadable model list says why, with one Retry.
 */

const connected: AgentRow = { id: 'codex', label: 'Codex', status: 'connected' };
const ready: AgentRow = { id: 'codex', label: 'Codex', status: 'ready' };

afterEach(() => vi.unstubAllGlobals());

describe('Settings disconnect and reconnect reach the picker', () => {
  it('disconnect forgets Codex in the picker state; connect asks for its models with refresh', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ agentRef: 'codex', models: [{ id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: [] }] }), { status: 200 });
      }),
    );
    agentRuns.patch((s) => ({ ...s, agents: { chat: 'codex' }, registered: ['codex'], caps: {}, capsError: { codex: 'codex app-server exited (code=1)' } }));
    const client: AgentsClient = {
      list: vi.fn(async () => ({ outcome: 'ok' as const, body: [connected] })),
      connect: vi.fn(async () => ({ outcome: 'ok' as const, body: connected })),
      disconnect: vi.fn(async () => ({ outcome: 'ok' as const, body: [ready] })),
    };
    render(<AgentsPane client={client} loadModels={async () => []} />);
    fireEvent.click(await screen.findByTestId('settings-agent-disconnect'));
    await waitFor(() => expect(agentRuns.get().registered).toEqual([]));
    expect(agentRuns.get().agents?.chat).toBe('');
    expect(agentRuns.get().capsError?.codex).toBeUndefined();

    fireEvent.click(await screen.findByTestId('settings-agent-connect'));
    await waitFor(() => expect(agentRuns.get().caps?.codex?.models).toHaveLength(1));
    expect(agentRuns.get().registered).toEqual(['codex']);
    expect(calls.filter((c) => c.startsWith('/api/acp/capabilities'))).toEqual(['/api/acp/capabilities?agentRef=codex&refresh=1']);
  });

  it('an unreadable model list says why and offers one Retry that asks afresh', async () => {
    const load = vi.fn(async (_ref: string, refresh?: boolean) => {
      if (!refresh) throw new Error('the agent could not say what it offers: codex app-server exited (code=1)');
      return ['GPT-6-Astra'];
    });
    const client: AgentsClient = { list: vi.fn(async () => ({ outcome: 'ok' as const, body: [connected] })), connect: vi.fn(), disconnect: vi.fn() };
    render(<AgentsPane client={client} loadModels={load} />);
    const none = await screen.findByTestId('settings-agent-models-none');
    expect(none.textContent).toMatch(/could not be read/);
    expect(none.textContent).toContain('codex app-server exited');
    expect(none.textContent).toMatch(/default model/);
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-agent-models-retry'));
    });
    expect(load).toHaveBeenLastCalledWith('codex', true);
    expect((await screen.findAllByTestId('settings-agent-model')).map((n) => n.textContent)).toEqual(['GPT-6-Astra']);
  });
});
