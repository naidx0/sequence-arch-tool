import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { FirstRun } from './FirstRun';
import { FIRST_AGENT_KEY, connectAgent, loneReady } from './loneAgent';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/* Round 11 UX audit 1: one ready agent connects with the project, so the shell
   opens on a pill that already names it. Two ready agents are a choice. */

const P = (id: string, label: string, state: ProviderStatus['state']): ProviderStatus => ({
  id, label, installed: true, version: '1', state, signInCommand: `${id} login`, installHint: `npm i -g ${id}`,
});

function server(registered: string[] = []) {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === '/api/acp/agents') return json({ agents: registered.map((id) => ({ id })) });
    if (url === '/api/acp/agents/connect') return json({ ok: true });
    return json({}, 404);
  };
  return { f, calls };
}

afterEach(() => window.localStorage.clear());

describe('loneReady', () => {
  it('names the one ready provider, and nothing when none or several are', () => {
    expect(loneReady([P('claude', 'Claude Code', 'ready'), P('codex', 'Codex', 'signIn')])?.id).toBe('claude');
    expect(loneReady([P('claude', 'Claude Code', 'ready'), P('codex', 'Codex', 'ready')])).toBeNull();
    expect(loneReady([P('claude', 'Claude Code', 'signIn')])).toBeNull();
    expect(loneReady(null)).toBeNull();
  });
});

describe('connectAgent', () => {
  it('registers the provider and leaves the note for the shell', async () => {
    const s = server();
    expect(await connectAgent({ id: 'claude' }, s.f)).toBe('claude');
    expect(s.calls).toEqual(['GET /api/acp/agents', 'POST /api/acp/agents/connect']);
    expect(window.localStorage.getItem(FIRST_AGENT_KEY)).toBe('claude');
  });
  it('does not register twice', async () => {
    const s = server(['claude']);
    expect(await connectAgent({ id: 'claude' }, s.f)).toBe('claude');
    expect(s.calls).toEqual(['GET /api/acp/agents']);
  });
});

describe('first run with one ready agent', () => {
  const client = (providers: ProviderStatus[]): OnboardingClient => ({
    providers: async () => ({ ok: true, body: providers }),
    repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
  });

  it('Start chatting connects the ready agent (one click), then the setup opens', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: 200 });
    });
    const done = vi.fn();
    render(<FirstRun client={client([P('claude', 'Claude Code', 'ready'), P('codex', 'Codex', 'signIn')])} onDone={done} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    fireEvent.click(await screen.findByTestId('first-run-start'));
    expect(await screen.findByTestId('first-run-setup')).toBeTruthy();
    expect(calls).toContain('POST /api/acp/agents/connect');
    expect(window.localStorage.getItem(FIRST_AGENT_KEY)).toBe('claude');
    expect(done).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('two ready agents are a choice: both options say Ready and nothing is picked', async () => {
    render(<FirstRun client={client([P('claude', 'Claude Code', 'ready'), P('codex', 'Codex', 'ready')])} onDone={() => {}} />);
    const opts = await screen.findAllByTestId('first-run-option');
    await waitFor(() => expect(opts[0]!.textContent).toContain('Ready'));
    expect(opts[1]!.textContent).toContain('Ready');
    expect(screen.queryByTestId('first-run-start')).toBeNull();
  });
});

it('the agents store is untouched until the shell reads the note', () => {
  expect(agentRuns.get().agents?.['none']).toBeUndefined();
});
