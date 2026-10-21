import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { PROVIDER_STATES, type OnboardingClient, type ProviderStatus } from '../onboarding/onboardingClient';
import { SETTLE_BUDGET_MS, resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { ConnectAgents } from './ConnectAgents';

/* The sign-in terminal opens a socket: a stand-in that ends when clicked, like the command finishing. */
vi.mock('../onboarding/BrowserSignIn', () => ({
  BrowserSignIn: ({ provider, onExit, onSignedIn }: { provider: { id: string }; onExit?: (i: { ended: boolean }) => Promise<{ state: string } | null>; onSignedIn?: (p: unknown) => void }) => (
    <button
      type="button"
      data-testid={`terminal-${provider.id}`}
      onClick={async () => {
        const last = await onExit?.({ ended: true });
        if (last?.state === 'ready') onSignedIn?.(last);
      }}
    >
      terminal
    </button>
  ),
}));

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

/** What the no-command scan reads: every word in the region, and any code element. One function for the real assertion and its positive control. */
function commandLeaks(region: HTMLElement): string[] {
  const out: string[] = [];
  const m = (region.textContent ?? '').match(/npm |\w+-\w+ login|bridge-cmd|terminal, then|from a terminal|run this|sequence agent/i);
  if (m) out.push(`text: ${m[0]}`);
  if (region.querySelector('code')) out.push('a code element');
  return out;
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

  it('Sign in opens the in-app sign-in terminal (no command shown, nothing sent), and Check again connects once the probe reads ready', async () => {
    resetSignInState();
    const { f, calls } = server();
    const store = createAgentRunStore();
    const state = { list: [P('claude', 'Claude Code', 'signIn')] };
    const client: OnboardingClient = { providers: async () => ({ ok: true, body: state.list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };
    const connected = vi.fn();
    try {
      render(<ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={client} onConnected={connected} />);
      fireEvent.click(await screen.findByTestId('s2-signin-claude'));
      /* The sign-in loads when it opens (LazyBrowserSignIn), so the terminal arrives a tick after the click. */
      expect(await screen.findByTestId('terminal-claude')).toBeTruthy();
      expect(screen.getByTestId('s2-connect-help-claude').textContent).not.toContain('claude login');
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      /* Signed in from the terminal: the probe now reads ready. */
      state.list = [P('claude', 'Claude Code', 'ready')];
      await act(async () => fireEvent.click(screen.getByTestId('s2-connect-check-claude')));
      await waitFor(() => expect(connected).toHaveBeenCalledWith('claude'));
      expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', url: '/api/acp/agents/connect', body: { provider: 'claude' } });
      expect(store.get().agents?.s1).toBe('claude');
    } finally {
      resetSignInState();
    }
  });

  it('the sign-in terminal ending checks the sign-in by itself and connects', async () => {
    resetSignInState();
    const { f } = server();
    const state = { list: [P('claude', 'Claude Code', 'signIn')] };
    const client: OnboardingClient = { providers: async () => ({ ok: true, body: state.list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };
    const connected = vi.fn();
    try {
      render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} onConnected={connected} />);
      fireEvent.click(await screen.findByTestId('s2-signin-claude'));
      state.list = [P('claude', 'Claude Code', 'ready')];
      await act(async () => fireEvent.click(screen.getByTestId('terminal-claude')));
      await waitFor(() => expect(connected).toHaveBeenCalledWith('claude'));
    } finally {
      resetSignInState();
    }
  });

  it('a not-installed agent has a Set up in chat button that drafts the install into the composer, and runs nothing', async () => {
    const { f, calls } = server();
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    const closed = vi.fn();
    render(
      <StoreProvider store={app}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('gemini', 'Gemini', 'install')])} onClose={closed} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('s2-chat-gemini'));
    const draft = app.getState().composer.draft ?? '';
    expect(draft).toContain('Gemini');
    expect(draft).toContain('npm install -g gemini');
    expect(closed).toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('an agent too old to drive gets Update in chat, with the versions in the draft', async () => {
    const { f } = server();
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    render(
      <StoreProvider store={app}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([{ ...P('claude', 'Claude Code', 'update'), version: '1.0.3', minVersion: '2.0.0' }])} />
      </StoreProvider>,
    );
    const btn = await screen.findByTestId('s2-chat-claude');
    expect(btn.textContent).toBe('Update in chat');
    fireEvent.click(btn);
    const draft = app.getState().composer.draft ?? '';
    expect(draft).toContain('1.0.3');
    expect(draft).toContain('2.0.0');
  });

  it('nothing connected (no agent, no model): Copy setup prompt and Connect a model replace Set up in chat', async () => {
    const { f } = server();
    const app = createStore({});
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void written.push(t) } });
    const closed = vi.fn();
    try {
      render(
        <StoreProvider store={app}>
          <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('gemini', 'Gemini', 'install')])} onClose={closed} />
        </StoreProvider>,
      );
      await screen.findByTestId('s2-connect-gemini');
      expect(screen.queryByTestId('s2-chat-gemini')).toBeNull();
      await act(async () => fireEvent.click(screen.getByTestId('s2-copy-gemini')));
      expect(screen.getByTestId('s2-copy-gemini').textContent).toBe('Copied');
      expect(written[0]).toContain('npm install -g gemini');
      expect(app.getState().composer.draft ?? '').toBe('');
      fireEvent.click(screen.getByTestId('s2-model-gemini'));
      expect(app.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'models' });
      expect(closed).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('nothing connected and no clipboard: the prompt is shown selected to copy by hand', async () => {
    const { f } = server();
    vi.stubGlobal('navigator', { userAgent: 'test', clipboard: undefined });
    try {
      render(
        <StoreProvider store={createStore({})}>
          <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('gemini', 'Gemini', 'install')])} />
        </StoreProvider>,
      );
      const copy = await screen.findByTestId('s2-copy-gemini');
      await act(async () => fireEvent.click(copy));
      const box = (await screen.findByTestId('s2-copy-gemini-text')) as HTMLTextAreaElement;
      expect(box.value).toContain('npm install -g gemini');
      expect(document.activeElement).toBe(box);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a registered agent can answer: Set up in chat stays', async () => {
    const { f } = server({ registered: ['codex'] });
    render(
      <StoreProvider store={createStore({})}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding([P('codex', 'Codex', 'ready'), P('gemini', 'Gemini', 'install')])} />
      </StoreProvider>,
    );
    expect(await screen.findByTestId('s2-chat-gemini')).toBeTruthy();
    expect(screen.queryByTestId('s2-copy-gemini')).toBeNull();
  });

  it('a missing bridge installs on a click (Install bridge), not from a command', async () => {
    const { f } = server();
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={{ ...onboarding([{ ...P('claude', 'Claude Code', 'adapter'), adapterInstall: 'npm i -g claude-agent-acp' }]), installBridge: async () => ({ ok: true, body: { state: 'running', output: [] } }) }} />);
    fireEvent.click(await screen.findByTestId('s2-bridge-claude'));
    expect(screen.getByTestId('bridge-install-button').textContent).toBe('Install bridge');
    expect(screen.getByTestId('s2-connect-help-claude').textContent).not.toContain('npm');
  });

  it('no state shows a command to run: every row is a button, a terminal or a chat draft (derived over every state)', async () => {
    /* The states come from the provider state union itself (PROVIDER_STATES), not a list typed here. */
    const states = [...PROVIDER_STATES];
    expect(states.length).toBeGreaterThan(0);
    const { f } = server();
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    render(
      <StoreProvider store={app}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding(states.map((st) => ({ ...P(`a-${st}`, `Agent ${st}`, st), adapterInstall: 'npm i -g bridge-cmd' })))} />
      </StoreProvider>,
    );
    const region = await screen.findByTestId('s2-connect');
    expect(region.querySelectorAll('[data-state]').length).toBe(states.length);
    /* open every panel that opens: any row that declares aria-expanded */
    for (const b of Array.from(region.querySelectorAll<HTMLElement>('button[aria-expanded]'))) fireEvent.click(b);
    expect(commandLeaks(region)).toEqual([]);
    /* positive control: the same assertion, over the same live region, flags a command planted inside it */
    const planted = document.createElement('p');
    planted.textContent = 'Run this in a terminal, then check: claude login';
    region.appendChild(planted);
    expect(commandLeaks(region).length).toBeGreaterThan(0);
    planted.remove();
    const code = document.createElement('code');
    code.textContent = 'x';
    region.appendChild(code);
    expect(commandLeaks(region)).toContain('a code element');
    code.remove();
    expect(commandLeaks(region)).toEqual([]);
  });

  it('negative control: the sign-in terminal ending while the agent is still signed out does not connect it', async () => {
    resetSignInState();
    const { f, calls } = server();
    const store = createAgentRunStore();
    const client: OnboardingClient = { providers: async () => ({ ok: true, body: [P('claude', 'Claude Code', 'signIn')] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };
    const connected = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ConnectAgents sessionId="s1" fetchImpl={f} store={store} onboarding={client} onConnected={connected} />);
      fireEvent.click(await screen.findByTestId('s2-signin-claude'));
      await act(async () => fireEvent.click(screen.getByTestId('terminal-claude')));
      /* The check forgives a stale signed-out read for its whole budget; past it, the answer stands. */
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SETTLE_BUDGET_MS + 2000);
      });
      await waitFor(() => expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Still signed out'));
      expect(connected).not.toHaveBeenCalled();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      expect(store.get().agents?.s1).toBeUndefined();
    } finally {
      vi.useRealTimers();
      resetSignInState();
    }
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
    /* The sentence carries the reason when it is short and has no path (0.1.8.4); the server's full text stays behind Details. */
    expect(why.querySelector('.failure-note-say')?.textContent).toBe('Could not connect Codex: Claude Code needs its bridge (claude-agent-acp) on PATH.');
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
