import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTLE_BUDGET_MS, resetSignInState } from '../onboarding/signInState';

import '../tokens/graphite.css';
import './settings.css';

import { StoreProvider, createStore } from '../state';
import { AgentsPane } from './AgentsPane';
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

import { agentRows, createAgentsClient, type AgentRow, type AgentsClient } from './agentsClient';

const ROWS: AgentRow[] = [
  { id: 'codex', label: 'Codex', status: 'connected', detail: 'v0.45.0, ChatGPT' },
  { id: 'claude', label: 'Claude Code', status: 'signed-out', signInCommand: 'claude /login' },
  { id: 'gemini', label: 'Gemini CLI', status: 'not-installed', installHint: 'npm i -g @google/gemini-cli' },
];

function client(over: Partial<AgentsClient> = {}): AgentsClient {
  return {
    list: vi.fn(async () => ({ outcome: 'ok' as const, body: ROWS })),
    connect: vi.fn(async (row: AgentRow) => ({ outcome: 'ok' as const, body: { ...row, status: 'connected' as const } })),
    disconnect: vi.fn(async () => ({ outcome: 'ok' as const, body: ROWS })),
    ...over,
  };
}

afterEach(() => resetSignInState());

describe('Settings › Agents', () => {
  it('lists each agent with its state in words and a click for each next step, with no command shown', async () => {
    render(<AgentsPane client={client()} />);
    const rows = await screen.findAllByTestId('settings-agent');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['codex', 'claude', 'gemini']);
    expect(rows.map((r) => r.querySelector('[data-testid="settings-agent-status"]')!.textContent)).toEqual([
      'Connected',
      'Needs sign-in',
      'Not installed',
    ]);
    expect(screen.getByTestId('settings-agent-signin').textContent).toBe('Sign in');
    expect(screen.queryByText(/claude \/login|npm i -g/)).toBeNull();
    expect(document.querySelector('[data-testid="settings-agents"] code')).toBeNull();
    /* Connect only where it can do something; Disconnect only on a connected one. */
    expect(screen.queryByTestId('settings-agent-connect')).toBeNull();
    expect(screen.getAllByTestId('settings-agent-disconnect').map((b) => b.getAttribute('data-agent'))).toEqual(['codex']);
  });

  it('a row still being checked offers a way to look again, and the click reads the list once more', async () => {
    /*
     * THE PROBE IS SLOW. The server answers "checking" while it asks each
     * agent's own status command, and the pane read the list once. A row that
     * said "Looking at this machine…" therefore stayed on that sentence for
     * as long as the reader looked at it, with no Connect (the row is not
     * ready) and no way to look again.
     */
    const rows: AgentRow[] = [{ id: 'claude', label: 'Claude Code', status: 'checking' }];
    const list = vi.fn(async () => ({ outcome: 'ok' as const, body: rows }));
    render(<AgentsPane client={client({ list })} />);
    const row = await screen.findByTestId('settings-agent');
    expect(row.textContent).toContain('Looking at this machine');
    const again = row.querySelector('[data-testid="settings-agent-check-again"]');
    expect(again).not.toBeNull();
    const before = list.mock.calls.length;
    fireEvent.click(again!);
    await waitFor(() => expect(list.mock.calls.length).toBe(before + 1));
  });

  it('a row that is ready offers Connect, and not a second way to check', async () => {
    const rows: AgentRow[] = [{ id: 'claude', label: 'Claude Code', status: 'ready' }];
    render(<AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: rows })) })} />);
    const row = await screen.findByTestId('settings-agent');
    expect(row.querySelector('[data-testid="settings-agent-connect"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="settings-agent-check-again"]')).toBeNull();
  });

  it('signed-out agents offer Sign in without an unusable Connect action', async () => {
    const api = client();
    render(<AgentsPane client={api} />);
    const row = (await screen.findAllByTestId('settings-agent')).find((r) => r.dataset.agent === 'claude')!;
    expect(row.querySelector('[data-testid="settings-agent-signin"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="settings-agent-connect"]')).toBeNull();
    fireEvent.click(row.querySelector('[data-testid="settings-agent-signin"]')!);
    expect(api.connect).not.toHaveBeenCalled();
  });

  it('UX study 2026-10-09: a signed-out row whose bridge is missing says so and offers Install bridge beside Sign in', async () => {
    const rows: AgentRow[] = [{ id: 'claude', label: 'Claude Code', status: 'signed-out', signInCommand: 'claude auth login', needsBridge: true }];
    render(<AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: rows })) })} />);
    const row = await screen.findByTestId('settings-agent');
    expect(row.textContent).toContain('claude-agent-acp');
    expect(row.textContent).not.toMatch(/adapter/i);
    expect(row.querySelector('[data-testid="bridge-install-button"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="settings-agent-signin"]')?.textContent).toBe('Sign in');
    expect(row.textContent).not.toContain('claude auth login');
  });

  it('Sign in opens the in-app terminal; when it ends and the probe reads ready, the agent connects', async () => {
    const onboardingClient = { providers: async () => ({ ok: true as const, body: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready' as const, signInCommand: 'x', installHint: 'y' }] }), repos: async () => ({ ok: true as const, body: { repos: [], truncated: false } }) };
    /* The machine changes when the person signs in: the list now reads Claude as ready (a list that stayed signed-out would loop the settle). */
    let signedIn = false;
    const api = client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: ROWS.map((r) => (signedIn && r.id === 'claude' ? { ...r, status: 'ready' as const } : r)) })) });
    render(<AgentsPane client={api} onboardingClient={onboardingClient} />);
    await screen.findAllByTestId('settings-agent');
    expect(screen.queryByTestId('terminal-claude')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-agent-signin'));
    signedIn = true;
    fireEvent.click(screen.getByTestId('terminal-claude'));
    await waitFor(() => expect(api.connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' })));
  });

  it('Set up in chat on a missing agent drafts the install into the composer and closes Settings; it runs nothing', async () => {
    const app = createStore({});
    app.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'agents' } });
    const api = client();
    render(<StoreProvider store={app}><AgentsPane client={api} /></StoreProvider>);
    await screen.findAllByTestId('settings-agent');
    const chat = screen.getAllByTestId('settings-agent-chat');
    expect(chat.map((b) => b.getAttribute('data-agent'))).toEqual(['gemini']);
    fireEvent.click(chat[0]!);
    const draft = app.getState().composer.draft ?? '';
    expect(draft).toContain('Gemini CLI');
    expect(draft).toContain('npm i -g @google/gemini-cli');
    expect(app.getState().shell.overlay).toBeNull();
    expect(api.connect).not.toHaveBeenCalled();
  });

  it('an agent older than Sequence can drive shows Update in chat with its versions, and Add another agent drafts a prompt', async () => {
    const rows = agentRows([{ id: 'claude', label: 'Claude Code', installed: true, version: '1.0.3', minVersion: '2.0.0', state: 'update', signInCommand: 'c', installHint: 'npm i -g claude' }], []);
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    render(<StoreProvider store={app}><AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: rows })) })} /></StoreProvider>);
    const btn = await screen.findByTestId('settings-agent-chat');
    expect(btn.textContent).toBe('Update in chat');
    /* its own sentence, from the two versions; not the generic "status command" line */
    const sub = btn.closest('li')!.querySelector('.sb-row-sub')!.textContent;
    expect(sub).toBe('Claude Code 1.0.3 is older than Sequence needs (2.0.0). Update it in chat.');
    expect(sub).not.toMatch(/status command/);
    fireEvent.click(btn);
    expect(app.getState().composer.draft).toMatch(/1\.0\.3[\s\S]*2\.0\.0/);
    fireEvent.click(screen.getByTestId('settings-agents-add'));
    expect(app.getState().composer.draft).toContain('add another coding agent');
  });

  it('disconnects and redraws the list from the server answer', async () => {
    const after: AgentRow[] = [{ ...ROWS[0]!, status: 'ready' }, ROWS[1]!, ROWS[2]!];
    const api = client({ disconnect: vi.fn(async () => ({ outcome: 'ok' as const, body: after })) });
    render(<AgentsPane client={api} />);
    await screen.findAllByTestId('settings-agent');
    fireEvent.click(screen.getByTestId('settings-agent-disconnect'));
    expect(api.disconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'codex' }));
    await waitFor(() => expect(screen.queryByTestId('settings-agent-disconnect')).toBeNull());
    expect(screen.getAllByTestId('settings-agent-connect').map((b) => b.getAttribute('data-agent'))).toEqual(['codex']);
  });

  it('connects and redraws the row from the answer', async () => {
    const ready = ROWS.map((row) => row.id === 'claude' ? { ...row, status: 'ready' as const } : row);
    const api = client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: ready })) });
    render(<AgentsPane client={api} />);
    await screen.findAllByTestId('settings-agent');
    fireEvent.click(screen.getByTestId('settings-agent-connect'));
    expect(api.connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }));
    await waitFor(() => expect(screen.getAllByText('Connected')).toHaveLength(2));
  });
});

describe('the agents client on the server routes', () => {
  it('Disconnect sends DELETE /api/acp/agents/:id, then reads the list again', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/acp/agents' && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      if (url === '/api/onboarding/providers') return new Response(JSON.stringify({ providers: [] }), { status: 200 });
      return new Response(JSON.stringify({ removed: true, agents: [] }), { status: 200 });
    });
    const out = await createAgentsClient(f as unknown as typeof fetch).disconnect!({ id: 'codex', label: 'Codex', status: 'connected' });
    expect(out.outcome).toBe('ok');
    expect(calls[0]).toBe('DELETE /api/acp/agents/codex');
    expect(calls.slice(1).sort()).toEqual(['GET /api/acp/agents', 'GET /api/onboarding/providers']);
  });

  it('reads the probe and the registered list, and marks the registered ones connected', () => {
    const providers = [
      { id: 'codex', label: 'Codex', installed: true, version: '0.45.0', state: 'ready' as const, signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' },
      { id: 'claude', label: 'Claude Code', installed: true, version: null, state: 'ready' as const, signInCommand: 'claude /login', installHint: '' },
    ];
    const rows = agentRows(providers, [{ id: 'codex', command: 'codex' }, { id: 'aider', label: 'Aider' }]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['codex', 'connected'],
      ['claude', 'ready'],
      ['aider', 'connected'],
    ]);
  });

  it('posts the provider as JSON, and turns a 409 into the state it names', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const answers: Response[] = [
      new Response(JSON.stringify({ error: 'Claude Code is signed out', state: 'signIn', signInCommand: 'claude /login' }), { status: 409 }),
      new Response(JSON.stringify({ error: 'no adapter', state: 'adapter' }), { status: 409 }),
      new Response(JSON.stringify({ error: "unknown provider 'x'", state: 'unknown' }), { status: 404 }),
    ];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const api = createAgentsClient(fetchImpl);
    const row: AgentRow = { id: 'claude', label: 'Claude Code', status: 'ready' };

    const signedOut = await api.connect(row);
    expect(calls[0]!.url).toBe('/api/acp/agents/connect');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(new Headers(calls[0]!.init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ provider: 'claude' });
    expect(signedOut).toEqual({ outcome: 'ok', body: { ...row, status: 'signed-out', signInCommand: 'claude /login' } });

    const adapter = await api.connect(row);
    expect(adapter.outcome === 'ok' && adapter.body.status).toBe('adapter');

    const unknown = await api.connect({ ...row, id: 'x', label: 'X' });
    expect(unknown).toEqual({ outcome: 'failed', message: 'Sequence does not know an agent called X.' });
  });
});

describe('Settings › Agents: setup actions', () => {
  const pillOf = (testid: string) => screen.getByTestId(testid).className;

  it('the chat actions use the Settings action pill, not the quiet dismissal pill', async () => {
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    render(<StoreProvider store={app}><AgentsPane client={client()} /></StoreProvider>);
    await screen.findAllByTestId('settings-agent');
    for (const id of ['settings-agent-chat', 'settings-agents-add']) {
      expect(pillOf(id).split(' ')).toContain('sb-pill');
      expect(pillOf(id)).not.toContain('sb-pill-quiet');
    }
  });

  it('Set up in chat puts the caret in the composer after closing Settings', async () => {
    const field = document.createElement('textarea');
    field.setAttribute('data-testid', 'composer-field');
    document.body.appendChild(field);
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    try {
      render(<StoreProvider store={app}><AgentsPane client={client()} /></StoreProvider>);
      await screen.findAllByTestId('settings-agent');
      fireEvent.click(screen.getByTestId('settings-agent-chat'));
      await waitFor(() => expect(document.activeElement).toBe(field));
    } finally {
      field.remove();
    }
  });

  it('no agent connected and no model: Copy setup prompt and Connect a model replace every Set up in chat', async () => {
    const rows: AgentRow[] = [ROWS[2]!];
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    const app = createStore({});
    render(<StoreProvider store={app}><AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: rows })) })} /></StoreProvider>);
    await screen.findAllByTestId('settings-agent');
    expect(screen.queryByTestId('settings-agent-chat')).toBeNull();
    expect(screen.queryByTestId('settings-agents-add')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-agent-chat-copy'));
    await waitFor(() => expect(screen.getByTestId('settings-agent-chat-copy').textContent).toBe('Copied'));
    expect(written[0]).toContain('npm i -g @google/gemini-cli');
    expect(app.getState().composer.draft ?? '').toBe('');
    fireEvent.click(screen.getByTestId('settings-agent-chat-model'));
    expect(app.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'models' });
    expect(screen.getByTestId('settings-agents-add-copy')).toBeTruthy();
    expect(screen.getByTestId('settings-agents-add-model')).toBeTruthy();
  });

  it('negative control: the sign-in terminal ending while the agent is still signed out does not connect it', async () => {
    const stillOut = { providers: async () => ({ ok: true as const, body: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'signIn' as const, signInCommand: 'x', installHint: 'y' }] }), repos: async () => ({ ok: true as const, body: { repos: [], truncated: false } }) };
    const api = client();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<AgentsPane client={api} onboardingClient={stillOut} />);
      await screen.findAllByTestId('settings-agent');
      fireEvent.click(screen.getByTestId('settings-agent-signin'));
      fireEvent.click(screen.getByTestId('terminal-claude'));
      await vi.advanceTimersByTimeAsync(SETTLE_BUDGET_MS + 2000);
      expect(api.connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('two connected agents bake in a main and a backup, apart from the status bar', async () => {
    localStorage.clear();
    const pair: AgentRow[] = [
      { id: 'claude', label: 'Claude Code', status: 'connected' },
      { id: 'codex', label: 'Codex', status: 'connected', detail: 'ChatGPT' },
    ];
    render(<AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: pair })) })} />);
    expect(await screen.findByTestId('settings-failover')).toBeTruthy();
    expect(screen.getByTestId('settings-failover').textContent).toContain('every 5 hours');
    fireEvent.click(screen.getByTestId('settings-failover-backup'));
    fireEvent.click(screen.getByTestId('settings-failover-backup-menu').querySelector('[data-value="codex"]')!);
    expect(JSON.parse(String(localStorage.getItem('sequence.agentFailover.v1'))).format).toEqual({ primary: 'claude', backup: 'codex' });
  });

  it('one connected agent has no failover format: there is no backup to name', async () => {
    localStorage.clear();
    render(<AgentsPane client={client()} />);
    await screen.findAllByTestId('settings-agent');
    expect(screen.queryByTestId('settings-failover')).toBeNull();
  });
});
