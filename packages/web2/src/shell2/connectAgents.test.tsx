import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import type { OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { ConnectAgents } from './ConnectAgents';

/* The composer half of CONNECT AGENT (UX audit): the model menu lists what first
   run detected and is not registered; one click on a ready one registers it on
   the server's own route and makes it this chat's agent. */

const P = (id: string, label: string, state: ProviderStatus['state'], plan?: string): ProviderStatus => ({
  id,
  label,
  installed: state !== 'install',
  version: '1',
  state,
  signInCommand: `${id} login`,
  installHint: `npm install -g ${id}`,
  ...(plan ? { plan } : {}),
});

function onboarding(list: ProviderStatus[]): OnboardingClient {
  return { providers: async () => ({ ok: true, body: list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };
}

function server(opts: { registered?: string[]; connect?: (provider: string) => { status: number; body: unknown } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const registered = [...(opts.registered ?? [])];
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/acp/agents') return json(200, { agents: registered.map((id) => ({ id, command: id })) });
    if (url === '/api/acp/agents/connect') {
      const a = opts.connect?.(body.provider) ?? { status: 200, body: { agent: { id: body.provider } } };
      if (a.status === 200) registered.push(body.provider);
      return json(a.status, a.body);
    }
    if (url.startsWith('/api/acp/capabilities')) return json(200, { models: [{ id: 'gpt-5.6-terra', name: 'gpt-5.6-terra', efforts: [] }], efforts: [] });
    return json(404, {});
  };
  return { f, calls };
}

describe('Connect an agent, in the model menu', () => {
  it('lists the detected agents that are not registered, with their state; installed-only, not the missing ones', async () => {
    const { f } = server({ registered: ['hermes'] });
    render(
      <ConnectAgents
        sessionId="s1"
        fetchImpl={f}
        store={createAgentRunStore()}
        onboarding={onboarding([P('codex', 'Codex', 'ready', 'ChatGPT'), P('claude', 'Claude Code', 'signIn'), P('gemini', 'Gemini', 'install'), P('hermes', 'Hermes', 'ready')])}
      />,
    );
    await screen.findByTestId('s2-connect');
    expect(screen.getAllByRole('menuitem').map((r) => r.getAttribute('data-testid'))).toEqual(['s2-connect-codex', 's2-connect-claude']);
    expect(screen.getByTestId('s2-connect-note-codex').textContent).toBe('Ready, ChatGPT');
    /* Signed out is a hint, not an error. */
    expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Sign in: claude login');
    expect(screen.getByTestId('s2-connect-claude').getAttribute('aria-disabled')).toBe('true');
  });

  it('one click registers a ready agent on the server, loads its models, and makes it this chat agent', async () => {
    const { f, calls } = server();
    const store = createAgentRunStore();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={onboarding([P('codex', 'Codex', 'ready', 'ChatGPT')])} />);
    const row = await screen.findByTestId('s2-connect-codex');
    await act(async () => fireEvent.click(row));
    await waitFor(() => expect(store.get().agents?.s1).toBe('codex'));
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', url: '/api/acp/agents/connect', body: { provider: 'codex' } });
    await waitFor(() => expect(store.get().caps?.codex?.models.map((m) => m.id)).toEqual(['gpt-5.6-terra']));
    /* Registered now: its row leaves this section (its models are in the menu above). */
    await waitFor(() => expect(screen.queryByTestId('s2-connect')).toBeNull());
  });

  it('a signed-out agent sends nothing; a refusal from the server is one FailureNote under the row', async () => {
    const { f, calls } = server({ connect: () => ({ status: 409, body: { error: 'Claude Code needs its bridge (claude-agent-acp) on PATH', state: 'adapter' } }) });
    const store = createAgentRunStore();
    render(
      <ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={onboarding([P('claude', 'Claude Code', 'signIn'), P('codex', 'Codex', 'ready')])} />,
    );
    fireEvent.click(await screen.findByTestId('s2-connect-claude'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await act(async () => fireEvent.click(screen.getByTestId('s2-connect-codex')));
    expect(screen.getByTestId('s2-connect-note-codex').textContent).toBe('Ready');
    const why = screen.getByTestId('s2-connect-details-codex');
    expect(why.querySelector('.failure-note-say')?.textContent).toBe('Could not connect Codex.');
    expect(why.querySelector('details code')?.textContent).toContain('Claude Code needs its bridge (claude-agent-acp) on PATH');
    expect(why.querySelector('.failure-note-retry')).not.toBeNull();
    expect(store.get().agents?.s1).toBeUndefined();
  });

  it('asks a registered agent for its models, so its rows show without a run first', async () => {
    const { f, calls } = server({ registered: ['codex'] });
    const store = createAgentRunStore();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={onboarding([P('codex', 'Codex', 'ready')])} />);
    await waitFor(() => expect(store.get().caps?.codex).toBeTruthy());
    expect(calls.some((c) => c.url === '/api/acp/capabilities?agentRef=codex')).toBe(true);
    expect(screen.queryByTestId('s2-connect')).toBeNull();
  });
});

describe('round 7, A1: the menu asks once, not in a loop', () => {
  it('with the default fetch, one open asks for the agents, the providers and each agent\'s models once', async () => {
    const counts = new Map<string, number>();
    const { vi } = await import('vitest');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input).split('?')[0]!;
        counts.set(url, (counts.get(url) ?? 0) + 1);
        const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
        if (url === '/api/acp/agents') return json(200, { agents: [{ id: 'codex', command: 'codex' }] });
        if (url === '/api/onboarding/providers') return json(200, { providers: [P('codex', 'Codex', 'ready'), P('claude', 'Claude Code', 'ready')] });
        /* The agent cannot start: before the fix every render asked again, each ask a new codex process. */
        if (url === '/api/acp/capabilities') return json(502, { error: 'codex exited (code 1)' });
        return json(404, {});
      }),
    );
    try {
      render(<ConnectAgents sessionId="s1" store={createAgentRunStore()} />);
      await screen.findByTestId('s2-connect');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      expect(counts.get('/api/acp/agents')).toBe(1);
      expect(counts.get('/api/onboarding/providers')).toBe(1);
      expect(counts.get('/api/acp/capabilities')).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes the menu (onConnected) and focuses the composer after a connect', async () => {
    const { f } = server();
    const field = document.createElement('textarea');
    field.setAttribute('data-testid', 'composer-field');
    document.body.appendChild(field);
    const closed = vi.fn();
    const esc = vi.fn();
    render(
      <div role="menu" onKeyDown={(e) => e.key === 'Escape' && esc()}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('codex', 'Codex', 'ready', 'ChatGPT')])} onConnected={closed} />
      </div>,
    );
    const row = await screen.findByTestId('s2-connect-codex');
    await act(async () => fireEvent.click(row));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(field));
    /* no synthesized key: the menu closes through its own prop */
    expect(esc).not.toHaveBeenCalled();
    field.remove();
  });
});
