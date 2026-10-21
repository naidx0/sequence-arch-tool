/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: A SIGN-IN THAT ENDS WITHOUT SIGNING IN IS NOT STARTED AGAIN
   packages/web2/src/onboarding/signInNoRestart0184.test.tsx

   Found by driving the stub-CLI build: the vendor's sign-in command ended (exit 1), the panel said "Waiting for you to
   finish in the browser" for ever, and the server log showed a new `claude auth login` every ~30 s. After a command
   ends, the shared sign-in state says "Checking sign-in..." for a few seconds; Settings > Agents and the model menu
   drew their sign-in panel only for a signed-out row, so the panel was torn down for the check and drawn again when the
   vendor still read signed out: a new terminal, a new run of the command, a new browser tab with a real CLI.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { agentRows, type AgentsClient } from '../settings/agentsClient';
import { AgentsPane } from '../settings/AgentsPane';
import { ConnectAgents } from '../shell2/ConnectAgents';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';
import { isSettling, resetSignInState } from './signInState';
import { StoreProvider, createStore } from '../state';

const term = vi.hoisted(() => ({ starts: 0, close: null as null | ((info: { code: number; reason: string }) => void) }));
vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onOutput: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void }) => {
      term.starts += 1;
      term.close = handlers.onClose ?? null;
      handlers.onOutput(new TextEncoder().encode('Opening browser to sign in...\nIf it did not open, visit https://claude.example.invalid/authorize\n'));
      return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
    }),
  };
});
vi.spyOn(window, 'open').mockImplementation(() => null);

afterEach(() => {
  resetSignInState();
  term.starts = 0;
  term.close = null;
});

/** The vendor never reads signed in: the command ended, nothing was signed in. */
const CLAUDE: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.280', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm i -g claude' };
const onboarding: OnboardingClient = { providers: async () => ({ ok: true, body: [CLAUDE] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };

const END = { code: 1000, reason: 'shell exited (code 1)' };

describe('the sign-in command ends without signing in', () => {
  it('Settings > Agents: the panel stays through the check and ends on Retry; the command is started once', async () => {
    const api: AgentsClient = { list: async () => ({ outcome: 'ok', body: agentRows([CLAUDE], []) }) };
    render(<AgentsPane client={api} onboardingClient={onboarding} catalog={false} />);
    fireEvent.click(await screen.findByTestId('settings-agent-signin'));
    await screen.findByTestId('settings-agent-terminal');
    await waitFor(() => expect(term.starts).toBe(1));

    await act(async () => term.close!(END));
    await waitFor(() => expect(isSettling('claude')).toBe(true));
    expect(screen.getByTestId('settings-agent-terminal'), 'the panel is still there during the check').toBeTruthy();

    /* The check ends (about 8 s) and the vendor still says signed out: Retry, not a new run. */
    await screen.findByTestId('first-run-signin-retry', {}, { timeout: 15000 });
    expect(screen.getByTestId('first-run-signin-retry-state').textContent).toContain('ended before it finished');
    expect(term.starts, 'no second run of the sign-in command').toBe(1);
  }, 25000);

  it('the model menu: the same', async () => {
    const f = async (url: string): Promise<Response> => new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: url === '/api/acp/agents' ? 200 : 404, headers: { 'content-type': 'application/json' } });
    render(
      <StoreProvider store={createStore({})}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('s2-signin-claude'));
    await screen.findByTestId('s2-connect-terminal-claude');
    await waitFor(() => expect(term.starts).toBe(1));

    await act(async () => term.close!(END));
    await waitFor(() => expect(isSettling('claude')).toBe(true));
    expect(screen.getByTestId('s2-connect-terminal-claude'), 'the panel is still there during the check').toBeTruthy();

    await screen.findByTestId('first-run-signin-retry', {}, { timeout: 15000 });
    expect(term.starts, 'no second run of the sign-in command').toBe(1);
  }, 25000);
});
