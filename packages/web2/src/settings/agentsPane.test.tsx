import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './settings.css';

import { AgentsPane } from './AgentsPane';
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

describe('Settings › Agents', () => {
  it('lists each agent with its state in words, and copyable sign-in and install commands', async () => {
    render(<AgentsPane client={client()} />);
    const rows = await screen.findAllByTestId('settings-agent');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['codex', 'claude', 'gemini']);
    expect(rows.map((r) => r.querySelector('[data-testid="settings-agent-status"]')!.textContent)).toEqual([
      'Connected',
      'Needs sign-in',
      'Not installed',
    ]);
    expect(screen.getByTestId('settings-agent-signin').textContent).toContain('claude /login');
    expect(screen.getByTestId('settings-agent-install').textContent).toContain('npm i -g @google/gemini-cli');
    /* Connect only where it can do something; Disconnect only on a connected one. */
    expect(screen.getAllByTestId('settings-agent-connect').map((b) => b.getAttribute('data-agent'))).toEqual(['claude']);
    expect(screen.getAllByTestId('settings-agent-disconnect').map((b) => b.getAttribute('data-agent'))).toEqual(['codex']);
  });

  it('UX study 2026-10-09: a signed-out row whose bridge is missing says so and offers Install bridge beside the sign-in command', async () => {
    const rows: AgentRow[] = [{ id: 'claude', label: 'Claude Code', status: 'signed-out', signInCommand: 'claude auth login', needsBridge: true }];
    render(<AgentsPane client={client({ list: vi.fn(async () => ({ outcome: 'ok' as const, body: rows })) })} />);
    const row = await screen.findByTestId('settings-agent');
    expect(row.textContent).toContain('claude-agent-acp');
    expect(row.textContent).not.toMatch(/adapter/i);
    expect(row.querySelector('[data-testid="bridge-install-button"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="settings-agent-signin"]')?.textContent).toContain('claude auth login');
  });

  it('disconnects and redraws the list from the server answer', async () => {
    const after: AgentRow[] = [{ ...ROWS[0]!, status: 'ready' }, ROWS[1]!, ROWS[2]!];
    const api = client({ disconnect: vi.fn(async () => ({ outcome: 'ok' as const, body: after })) });
    render(<AgentsPane client={api} />);
    await screen.findAllByTestId('settings-agent');
    fireEvent.click(screen.getByTestId('settings-agent-disconnect'));
    expect(api.disconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'codex' }));
    await waitFor(() => expect(screen.queryByTestId('settings-agent-disconnect')).toBeNull());
    expect(screen.getAllByTestId('settings-agent-connect').map((b) => b.getAttribute('data-agent'))).toEqual(['codex', 'claude']);
  });

  it('connects and redraws the row from the answer', async () => {
    const api = client();
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
