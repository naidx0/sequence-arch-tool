import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import type { OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { resetSignInState } from '../onboarding/signInState';
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
  it('lists every detected agent that is not registered, with its state: ready, needs sign-in, not installed', async () => {
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
    /* Hermes is registered: it is a connected row of the menu above, not here. */
    expect(screen.getAllByRole('menuitem').map((r) => r.getAttribute('data-testid'))).toEqual([
      's2-connect-codex',
      's2-connect-go-codex',
      's2-connect-claude',
      's2-signin-claude',
      's2-connect-gemini',
    ]);
    expect(screen.getByTestId('s2-connect-note-codex').textContent).toBe('Ready, ChatGPT');
    /* Signed out is a state, not an error: it says so, and the command is behind Sign in. */
    expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Needs sign-in');
    expect(screen.getByTestId('s2-connect-note-gemini').textContent).toBe('Not installed');
  });

  it('offers only what each one needs: Connect when ready, Sign in when signed out, neither when it is not installed', async () => {
    const { f } = server();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('codex', 'Codex', 'ready'), P('claude', 'Claude Code', 'signIn'), P('gemini', 'Gemini', 'install')])} />);
    await screen.findByTestId('s2-connect');
    expect(screen.getByTestId('s2-connect-go-codex')).toBeTruthy();
    expect(screen.queryByTestId('s2-signin-codex')).toBeNull();
    expect(screen.getByTestId('s2-signin-claude')).toBeTruthy();
    expect(screen.queryByTestId('s2-connect-go-claude')).toBeNull();
    expect(screen.queryByTestId('s2-connect-go-gemini')).toBeNull();
    expect(screen.queryByTestId('s2-signin-gemini')).toBeNull();
  });

  it('Sign in shows the vendor command to copy (nothing is run or sent), and Check again connects once the probe reads ready', async () => {
    resetSignInState();
    const { f, calls } = server();
    const store = createAgentRunStore();
    const state = { list: [P('claude', 'Claude Code', 'signIn')] };
    const client: OnboardingClient = { providers: async () => ({ ok: true, body: state.list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };
    const copied: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void copied.push(t) } });
    const connected = vi.fn();
    try {
      render(<ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={client} onConnected={connected} />);
      fireEvent.click(await screen.findByTestId('s2-signin-claude'));
      expect(screen.getByTestId('s2-connect-command-claude').textContent).toBe('claude login');
      await act(async () => fireEvent.click(screen.getByTestId('s2-connect-copy-claude')));
      expect(copied).toEqual(['claude login']);
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      /* Signed in from the terminal: the probe now reads ready. */
      state.list = [P('claude', 'Claude Code', 'ready')];
      await act(async () => fireEvent.click(screen.getByTestId('s2-connect-check-claude')));
      await waitFor(() => expect(connected).toHaveBeenCalledWith('claude'));
      expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', url: '/api/acp/agents/connect', body: { provider: 'claude' } });
      expect(store.get().agents?.s1).toBe('claude');
    } finally {
      vi.unstubAllGlobals();
      resetSignInState();
    }
  });

  it('a not-installed agent shows its install command to copy, and nothing else', async () => {
    const { f, calls } = server();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('gemini', 'Gemini', 'install')])} />);
    fireEvent.click(await screen.findByTestId('s2-connect-gemini'));
    expect(screen.getByTestId('s2-connect-command-gemini').textContent).toBe('npm install -g gemini');
    expect(screen.queryByTestId('s2-connect-check-gemini')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
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

  it('tells the menu which agent connected (onConnected), and does not close it: the models are chosen next', async () => {
    const { f } = server();
    const connected = vi.fn();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('codex', 'Codex', 'ready', 'ChatGPT')])} onConnected={connected} />);
    const go = await screen.findByTestId('s2-connect-go-codex');
    await act(async () => fireEvent.click(go));
    await waitFor(() => expect(connected).toHaveBeenCalledTimes(1));
    expect(connected).toHaveBeenCalledWith('codex');
  });
});
