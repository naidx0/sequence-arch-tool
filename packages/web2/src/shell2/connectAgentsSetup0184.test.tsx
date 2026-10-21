import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import type { BridgeInstallStatus, OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { resetSignInState } from '../onboarding/signInState';
import { ConnectAgents } from './ConnectAgents';

/* 0.1.8.4: a missing claude or codex installs on one click in the Connect menu, then the same row asks for sign-in; an
   old one offers Update. The installer client is a fake: nothing real ever runs. */

vi.mock('../onboarding/BrowserSignIn', () => ({ BrowserSignIn: () => <span data-testid="terminal" /> }));

const P = (id: string, state: ProviderStatus['state'], extra: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  label: id === 'codex' ? 'Codex' : 'Claude Code',
  installed: state !== 'install',
  version: '0.100.0',
  state,
  signInCommand: `${id} login`,
  installHint: `npm install -g ${id}`,
  ...extra,
});

function fixture(list: () => ProviderStatus[], cliState: BridgeInstallStatus = { state: 'done', exitCode: 0, output: ['ok'] }) {
  const installs: string[] = [];
  const client: OnboardingClient = {
    providers: async () => ({ ok: true, body: list() }),
    repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
    installCli: vi.fn(async (p: string) => {
      installs.push(p);
      return { ok: true as const, body: { state: 'running', output: ['fetching'] } as BridgeInstallStatus };
    }),
    cliStatus: vi.fn(async () => ({ ok: true as const, body: cliState })),
  };
  const f = async (url: string): Promise<Response> => new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: 200, headers: { 'content-type': 'application/json' } });
  return { client, installs, f };
}

describe('Connect menu: install, update, one guided sequence', () => {
  it('a missing Codex has an Install button; nothing runs until it is clicked, then it installs and the row asks for sign-in', async () => {
    resetSignInState();
    let state: ProviderStatus[] = [P('codex', 'install')];
    const { client, installs, f } = fixture(() => state);
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} />);
    const install = await screen.findByTestId('s2-install-codex');
    expect(installs).toEqual([]);
    state = [P('codex', 'signIn')];
    fireEvent.click(install);
    await waitFor(() => expect(installs).toEqual(['codex']));
    expect(screen.getByTestId('s2-steps-codex').textContent).toBe('Install → Sign in → Connect');
    /* Installed: the same row now says Needs sign-in and offers Sign in; the sign-in terminal is not started for them. */
    expect(await screen.findByTestId('s2-signin-codex', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByTestId('terminal')).toBeNull();
    expect(screen.queryByTestId('s2-install-codex')).toBeNull();
  });

  it('a failed install says why and shows the exact command to copy; the row stays installable', async () => {
    const { client, f } = fixture(() => [P('claude', 'install')], { state: 'failed', error: 'could not reach claude.ai', output: [] });
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} />);
    fireEvent.click(await screen.findByTestId('s2-install-claude'));
    const failed = await screen.findByTestId('cli-failed-claude', undefined, { timeout: 4000 });
    expect(failed.textContent).toContain('could not reach claude.ai');
    expect(screen.getByTestId('cli-command-claude').textContent).toBe('npm install -g claude');
  });

  it('an agent the installer does not know (Gemini) gets no Install button (negative control)', async () => {
    const { client, f } = fixture(() => [{ ...P('gemini', 'install'), label: 'Gemini' }]);
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} />);
    await screen.findByTestId('s2-connect-gemini');
    expect(screen.queryByTestId('s2-install-gemini')).toBeNull();
  });

  it('a ready but old Codex keeps Connect and adds a calm Update, which runs only on its click', async () => {
    const old = P('codex', 'ready', { updateAvailable: { recommended: '0.153.4', command: 'npm install -g @openai/codex@latest' } });
    const { client, installs, f } = fixture(() => [old]);
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} />);
    expect((await screen.findByTestId('s2-update-note-codex')).textContent).toContain('0.153.4');
    expect(screen.getByTestId('s2-connect-go-codex')).toBeTruthy();
    expect(installs).toEqual([]);
    fireEvent.click(screen.getByTestId('cli-update-button-codex'));
    await waitFor(() => expect(installs).toEqual(['codex']));
  });

  it('a current Codex shows no update line (negative control)', async () => {
    const { client, f } = fixture(() => [P('codex', 'ready')]);
    render(<ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={client} />);
    await screen.findByTestId('s2-connect-go-codex');
    expect(screen.queryByTestId('s2-update-codex')).toBeNull();
  });
});
