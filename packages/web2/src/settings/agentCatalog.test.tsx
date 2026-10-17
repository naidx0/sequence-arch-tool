import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './settings.css';

import { createAgentRunStore } from '../agents/agentRuns';
import { AgentCatalogSection } from './AgentCatalogSection';
import type { CatalogClient, CatalogRow } from './agentCatalogClient';

const ROWS: CatalogRow[] = [
  { id: 'hermes', name: 'Hermes Agent', source: 'builtin', state: 'ready', shown: 'hermes acp', installHint: 'Install Hermes Agent' },
  { id: 'gemini', name: 'Gemini CLI', description: "Google's official CLI for Gemini", source: 'builtin', state: 'npx', shown: 'npx -y @google/gemini-cli@0.64.0 --acp', installHint: 'npm install -g @google/gemini-cli' },
  { id: 'opencode', name: 'OpenCode', source: 'builtin', state: 'install', website: 'https://opencode.ai', installHint: 'Install OpenCode from https://opencode.ai' },
];

function client(over: Partial<CatalogClient> = {}): CatalogClient {
  return {
    list: vi.fn(async () => ({ ok: true as const, body: { agents: ROWS, registryFetchedAt: null } })),
    refresh: vi.fn(async () => ({ ok: true as const, body: { agents: ROWS, registryFetchedAt: 1 } })),
    connect: vi.fn(async () => ({ ok: true as const, body: { via: 'local' } })),
    methods: vi.fn(async () => ({ ok: true as const, body: { methods: [{ id: 'oauth-personal', name: 'Log in with Google', type: 'agent' }, { id: 'setup', name: 'Run in terminal', type: 'terminal' }] } })),
    signIn: vi.fn(async (id: string, methodId: string) => ({ ok: true as const, body: { job: { id, methodId, state: 'running' as const } } })),
    job: vi.fn(async () => ({ ok: true as const, body: { job: { id: 'gemini', methodId: 'oauth-personal', state: 'done' as const } } })),
    install: vi.fn(async (id: string) => ({ ok: true as const, body: { job: { id, version: '1.19.1', state: 'downloading' as const, receivedBytes: 0, totalBytes: 40e6 } } })),
    installJob: vi.fn(async (id: string) => ({ ok: true as const, body: { job: { id, version: '1.19.1', state: 'done' as const, receivedBytes: 40e6, totalBytes: 40e6 } } })),
    ...over,
  };
}

const okFetch = (async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as typeof fetch;

describe('Settings › More agents (the ACP catalog)', () => {
  it('says in words how each agent would start here, and offers what each state allows', async () => {
    render(<AgentCatalogSection client={client()} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['hermes', 'gemini', 'opencode']);
    expect(rows.map((r) => within(r).getByTestId('agent-catalog-status').textContent)).toEqual(['Installed', 'No install needed', 'Not installed']);
    /* The row carries the agent's own line; how "No install needed" starts is said once, in the section's hint. */
    expect(within(rows[1]!).getByText("Google's official CLI for Gemini")).toBeTruthy();
    /* The rows sit in groups: ready now, one download away, not here yet. */
    expect(screen.getAllByTestId('agent-catalog-group').map((g) => g.getAttribute('data-group'))).toEqual(['On this machine', 'No install needed', 'Can be installed']);
    /* Not installed: no Connect, a link to get it, and how. */
    expect(within(rows[2]!).queryByTestId('agent-catalog-connect')).toBeNull();
    expect(within(rows[2]!).getByTestId('agent-catalog-get').getAttribute('href')).toBe('https://opencode.ai');
  });

  it('a different program with an agent name on PATH reads Not an agent, in words, not Installed', async () => {
    const mismatch: CatalogRow = { id: 'goose', name: 'goose', source: 'builtin', state: 'mismatch', mismatch: 'A different program named goose is on PATH; it did not answer as an agent', installHint: 'x' };
    render(<AgentCatalogSection client={client({ list: vi.fn(async () => ({ ok: true as const, body: { agents: [mismatch], registryFetchedAt: null } })) })} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const row = await screen.findByTestId('agent-catalog-row');
    expect(within(row).getByTestId('agent-catalog-status').textContent).toBe('Not an agent');
    expect(within(row).getByText(/A different program named goose is on PATH/)).toBeTruthy();
    expect(within(row).queryByTestId('agent-catalog-signin')).toBeNull();
  });

  it('Connect names only the id, then the row leaves this list (Coding agents above lists it, with Disconnect) and the picker is told', async () => {
    const c = client();
    const onConnected = vi.fn();
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} onConnected={onConnected} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-connect'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('gemini'));
    expect(c.connect).toHaveBeenCalledWith('gemini');
    await waitFor(() => expect(screen.getAllByTestId('agent-catalog-row').map((r) => r.getAttribute('data-agent'))).toEqual(['hermes', 'opencode']));
  });

  it('one filled Connect per section: the first agent that can connect', async () => {
    render(<AgentCatalogSection client={client()} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const buttons = await screen.findAllByTestId('agent-catalog-connect');
    expect(buttons.map((b) => b.className.includes('sb-pill-solid'))).toEqual([true, false]);
  });

  it('Connect moves on at once: it never waits for the agent to list its models (Hermes takes ~45 s to start)', async () => {
    const never = (() => new Promise<Response>(() => {})) as typeof fetch;
    const onConnected = vi.fn();
    render(<AgentCatalogSection client={client()} fetchImpl={never} store={createAgentRunStore()} onConnected={onConnected} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[0]!).getByTestId('agent-catalog-connect'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('hermes'));
  });

  it('a refused Connect says why on the row', async () => {
    render(<AgentCatalogSection client={client({ connect: vi.fn(async () => ({ ok: false as const, message: 'Gemini CLI is not on this machine' })) })} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-connect'));
    expect((await screen.findByTestId('agent-catalog-row-failure')).textContent).toMatch(/not on this machine/);
  });

  it('Sign in asks the agent how it signs in, runs the chosen method, and says when it is done', async () => {
    const c = client();
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    /* One action per row (owner-seat review): Sign in is in the row's more menu, not a second pill beside Connect. */
    expect(within(rows[1]!).queryByTestId('agent-catalog-signin')).toBeNull();
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    const method = await screen.findByTestId('agent-catalog-method');
    expect(method.textContent).toBe('Log in with Google');
    fireEvent.click(method);
    expect(await screen.findByTestId('agent-catalog-signin-done')).toBeTruthy();
    expect(c.signIn).toHaveBeenCalledWith('gemini', 'oauth-personal');
    expect(c.methods).toHaveBeenCalledTimes(1);
  });

  it('only methods Sequence can run are buttons; a terminal one is named, not offered', async () => {
    render(<AgentCatalogSection client={client()} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    await screen.findByTestId('agent-catalog-method');
    expect(screen.getAllByTestId('agent-catalog-method').map((b) => b.getAttribute('data-method'))).toEqual(['oauth-personal']);
    expect(screen.getByTestId('agent-catalog-methods-other').textContent).toMatch(/Run in terminal/);
  });

  it('an agent with no sign-in step is not called signed in', async () => {
    render(<AgentCatalogSection client={client({ methods: vi.fn(async () => ({ ok: true as const, body: { methods: [] } })) })} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    expect((await screen.findByTestId('agent-catalog-signin-none')).textContent).toMatch(/no sign-in step here/);
    expect(screen.queryByTestId('agent-catalog-signin-done')).toBeNull();
  });

  it('the poll ends when the server no longer knows the sign-in (it restarted), and says so', async () => {
    const job = vi.fn(async () => ({ ok: true as const, body: {} }));
    render(<AgentCatalogSection client={client({ job })} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    fireEvent.click(await screen.findByTestId('agent-catalog-method'));
    expect((await screen.findByTestId('agent-catalog-signin-failed')).textContent).toMatch(/restarted/);
    const calls = job.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(job.mock.calls.length).toBe(calls);
  });

  it('closing the row stops its poll', async () => {
    const job = vi.fn(async () => ({ ok: true as const, body: { job: { id: 'gemini', methodId: 'oauth-personal', state: 'running' as const } } }));
    render(<AgentCatalogSection client={client({ job })} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    fireEvent.click(await screen.findByTestId('agent-catalog-method'));
    await waitFor(() => expect(job.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(within(screen.getAllByTestId('agent-catalog-row')[1]!).getByTestId('agent-catalog-signin'));
    const calls = job.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(job.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    expect(screen.queryByTestId('agent-catalog-signin-running')).toBeNull();
  });

  it('a failed sign-in is said, with the agent\'s own reason', async () => {
    const c = client({ job: vi.fn(async () => ({ ok: true as const, body: { job: { id: 'gemini', methodId: 'oauth-personal', state: 'failed' as const, error: 'the browser was closed' } } })) });
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-more'));
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-signin'));
    fireEvent.click(await screen.findByTestId('agent-catalog-method'));
    expect((await screen.findByTestId('agent-catalog-signin-failed')).textContent).toMatch(/browser was closed/);
  });

  it('first run (compact) lists only what can start now, with no refresh', async () => {
    render(<AgentCatalogSection compact client={client()} fetchImpl={okFetch} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['hermes', 'gemini']);
    expect(screen.queryByTestId('agent-catalog-refresh')).toBeNull();
  });

  it('no catalog route (older server, hosted mode): nothing is offered and nothing alarms', async () => {
    const c = client({ list: vi.fn(async () => ({ ok: false as const, message: 'ACP agents are local-only' })) });
    const { container } = render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} />);
    await waitFor(() => expect(c.list).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('a server that answers with no list (every path the same) offers nothing and breaks nothing', async () => {
    const c = client({ list: vi.fn(async () => ({ ok: true as const, body: { models: [] } as never })) });
    const { container } = render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} />);
    await waitFor(() => expect(c.list).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('an agent that ships as an archive gets Install, which runs, then the list is read again', async () => {
    const installable: CatalogRow[] = [{ ...ROWS[2]!, installable: true }];
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, body: { agents: installable, registryFetchedAt: null } })
      .mockResolvedValue({ ok: true as const, body: { agents: [{ ...ROWS[2]!, state: 'ready', installedBySequence: true }], registryFetchedAt: null } });
    const c = client({ list });
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    fireEvent.click(await screen.findByTestId('agent-catalog-install'));
    await waitFor(() => expect(screen.getByTestId('agent-catalog-status').textContent).toBe('Installed'));
    expect(c.install).toHaveBeenCalledWith('opencode');
    expect(screen.queryByTestId('agent-catalog-get')).toBeNull();
  });

  it('a failed install says why on the row and offers Install again', async () => {
    const c = client({
      list: vi.fn(async () => ({ ok: true as const, body: { agents: [{ ...ROWS[2]!, installable: true }], registryFetchedAt: null } })),
      installJob: vi.fn(async (id: string) => ({ ok: true as const, body: { job: { id, version: '1', state: 'failed' as const, receivedBytes: 1, totalBytes: 2, error: "the download does not match the registry's checksum" } } })),
    });
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    fireEvent.click(await screen.findByTestId('agent-catalog-install'));
    expect((await screen.findByTestId('agent-catalog-row-failure')).textContent).toMatch(/^Install failed: .*checksum/);
    expect((screen.getByTestId('agent-catalog-install') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Run in a sandbox connects the Docker copy; a stopped Docker says so on the row', async () => {
    const withSandbox = ROWS.map((r) => (r.id === 'gemini' ? { ...r, sandbox: true } : r));
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, message: 'Docker is installed but not running. Start Docker Desktop, then try again.' })
      .mockResolvedValueOnce({ ok: true as const, body: { via: 'docker', agent: { id: 'gemini-sandbox' } } });
    const onConnected = vi.fn();
    render(<AgentCatalogSection client={client({ list: vi.fn(async () => ({ ok: true as const, body: { agents: withSandbox, registryFetchedAt: null } })), connect })} fetchImpl={okFetch} store={createAgentRunStore()} onConnected={onConnected} />);
    /* The sandbox is under the row's more button, not a button of its own on every row. */
    expect(screen.queryByTestId('agent-catalog-sandbox')).toBeNull();
    /* Every connectable row has a more button now (Sign in lives there too); open Gemini's. */
    await screen.findAllByTestId('agent-catalog-more');
    fireEvent.click(document.querySelector('[data-testid="agent-catalog-more"][data-agent="gemini"]')!);
    fireEvent.click(await screen.findByTestId('agent-catalog-sandbox'));
    expect((await screen.findByTestId('agent-catalog-row-failure')).textContent).toMatch(/Start Docker Desktop/);
    fireEvent.click(screen.getByTestId('agent-catalog-sandbox'));
    expect(await screen.findByTestId('agent-catalog-sandbox-on')).toBeTruthy();
    expect(connect).toHaveBeenLastCalledWith('gemini', 'docker');
    expect(onConnected).toHaveBeenCalledWith('gemini-sandbox');
  });

  it('an install under way when the page loads is followed, not offered again', async () => {
    const row: CatalogRow = { ...ROWS[2]!, installable: true, install: { id: 'opencode', version: '1.19.1', state: 'downloading', receivedBytes: 10e6, totalBytes: 40e6 } };
    const installJob = vi.fn(async (id: string) => ({ ok: true as const, body: { job: { id, version: '1.19.1', state: 'downloading' as const, receivedBytes: 20e6, totalBytes: 40e6 } } }));
    const c = client({ list: vi.fn(async () => ({ ok: true as const, body: { agents: [row], registryFetchedAt: null } })), installJob });
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} pollMs={5} />);
    expect((await screen.findByTestId('agent-catalog-installing')).textContent).toMatch(/Downloading \d+ of 40 MB/);
    expect((screen.getByTestId('agent-catalog-install') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(installJob).toHaveBeenCalled());
    expect(c.install).not.toHaveBeenCalled();
  });

  it('Refresh offline keeps the list and says so', async () => {
    const c = client({ refresh: vi.fn(async () => ({ ok: false as const, message: 'offline', body: { agents: ROWS, registryFetchedAt: null } })) });
    render(<AgentCatalogSection client={c} fetchImpl={okFetch} store={createAgentRunStore()} />);
    fireEvent.click(await screen.findByTestId('agent-catalog-refresh'));
    expect((await screen.findByTestId('agent-catalog-refresh-note')).textContent).toMatch(/Could not check for new agents/);
    expect(screen.getAllByTestId('agent-catalog-row')).toHaveLength(3);
  });
});
