import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import css from './settings.css?raw';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { AgentsPane, agentSub } from './AgentsPane';
import { agentRows, isCommandPath, type AgentRow, type AgentsClient } from './agentsClient';

vi.mock('../terminal/TerminalPane', () => ({ TerminalPane: () => null }));

afterEach(() => resetSignInState());

const CATALOG = { list: async () => ({ ok: true as const, body: { agents: [{ id: 'cursor', name: 'Cursor', description: 'Cursor’s coding agent', source: 'builtin' as const, state: 'ready' as const, installHint: '' }], registryFetchedAt: null } }), job: async () => ({ ok: true as const, body: {} }), installJob: async () => ({ ok: true as const, body: {} }) } as never;

describe('the Agents row sentence never shows a program path', () => {
  it('drops a registered agent’s launch command: cmd.exe, a .cmd shim, any path', () => {
    for (const c of ['C:\WINDOWS\system32\cmd.exe', '/usr/bin/cursor-agent', 'cursor-agent.cmd', 'cmd /d /c x', 'node']) expect(isCommandPath(c)).toBe(true);
    expect(isCommandPath('v1.2.3')).toBe(false);
    const [row] = agentRows([], [{ id: 'cursor', label: 'Cursor', command: 'C:\WINDOWS\system32\cmd.exe' }]);
    expect(row!.detail).toBeUndefined();
  });

  it('says the catalog’s own line for Cursor, then what is true', () => {
    expect(agentSub({ id: 'cursor', label: 'Cursor', status: 'connected' }, 'Cursor’s coding agent')).toBe('Cursor’s coding agent. Chats can hand it work.');
    expect(agentSub({ id: 'cursor', label: 'Cursor', status: 'connected' })).toBe('Chats can hand it work.');
    expect(agentSub({ id: 'x', label: 'Codex', status: 'attention' })).toBe('Couldn’t check whether Codex is signed in. Set it up in chat.');
  });

  it('rendered: a connected Cursor registered with cmd.exe reads the catalog blurb, no path', async () => {
    const api: AgentsClient = { list: async () => ({ outcome: 'ok', body: agentRows([], [{ id: 'cursor', label: 'Cursor', command: 'C:\WINDOWS\system32\cmd.exe' }]) }) };
    render(<AgentsPane client={api} catalog={CATALOG} />);
    const row = await screen.findByTestId('settings-agent');
    await waitFor(() => expect(row.textContent).toContain('Cursor’s coding agent. Chats can hand it work.'));
    expect(row.textContent).not.toMatch(/cmd\.exe|system32/i);
  });
});

describe('Settings › Agents rows', () => {
  const ROWS: AgentRow[] = [
    { id: 'claude', label: 'Claude Code', status: 'attention' },
    { id: 'codex', label: 'Codex', status: 'connected' },
  ];

  it('a needs-attention row offers one action, Set up in chat, not Connect beside it', async () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <AgentsPane client={{ list: async () => ({ outcome: 'ok', body: ROWS }), connect: vi.fn() as never }} catalog={false} />
      </StoreProvider>,
    );
    const rows = await screen.findAllByTestId('settings-agent');
    const claude = rows.find((r) => r.getAttribute('data-agent') === 'claude')!;
    expect(within(claude).getAllByRole('button').map((b) => b.textContent)).toEqual(['Set up in chat']);
    expect(within(claude).queryByTestId('settings-agent-connect')).toBeNull();
  });

  it('shows the registered agents at once, while the probe is still running, and fills in when it answers', async () => {
    let finish: (rows: AgentRow[]) => void = () => undefined;
    const api: AgentsClient = {
      known: async () => ({ outcome: 'ok', body: [{ id: 'codex', label: 'Codex', status: 'connected' }] }),
      list: () => new Promise((resolve) => { finish = (body) => resolve({ outcome: 'ok', body }); }),
    };
    render(<AgentsPane client={api} catalog={false} />);
    const first = await screen.findAllByTestId('settings-agent');
    expect(first.map((r) => r.getAttribute('data-agent'))).toEqual(['codex']);
    expect(screen.queryByTestId('settings-agents-loading')).toBeNull();
    expect(screen.getByTestId('settings-agents-probing')).toBeTruthy();
    finish([{ id: 'claude', label: 'Claude Code', status: 'ready' }, { id: 'codex', label: 'Codex', status: 'connected' }]);
    await waitFor(() => expect(screen.getAllByTestId('settings-agent')).toHaveLength(2));
    expect(screen.queryByTestId('settings-agents-probing')).toBeNull();
  });

  it('both agent lists share one status column and one action column (CSS)', () => {
    const cols = css.match(/grid-template-columns: var\(--control-h-lg\) minmax\(0, 1fr\) var\(--sb-agent-status-col\) var\(--sb-agent-act-col\);/g) ?? [];
    expect(cols.length).toBeGreaterThanOrEqual(2);
    expect(css).not.toMatch(/\.sb-catalog-row \{ grid-template-columns:[^}]*\bauto\b/);
  });
});
