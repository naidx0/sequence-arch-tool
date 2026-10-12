import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRun } from '../agents/agentRuns';
import { createAgentRunStore } from '../agents/agentRuns';
import { RecoveryCard } from '../chat/RecoveryCard';
import { agentRows, type AgentsClient } from '../settings/agentsClient';
import { AgentsPane } from '../settings/AgentsPane';
import { ConnectAgents } from '../shell2/ConnectAgents';
import { FirstRun } from './FirstRun';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';
import { isQuiet, noteReady, resetSignInState, settleSignIn, signedAt } from './signInState';

/**
 * SIGN IN ONCE (owner, 2026-10-09): "During onboarding you maybe log in and re-auth like three times,
 * which is really annoying."
 *
 * The reported shape: signed out, the person signs in ONCE in the First Run terminal, the sign-in command
 * exits, and the vendor's `auth status` still reads signed-out for a moment (here: two more probes), a
 * window focus lands in that gap, and only then does it read ready. Four surfaces each read the same
 * probe: First Run, the model menu's Connect row, Settings > Agents and the failed-run RecoveryCard. Every
 * one of them used to ask for a sign-in again in that gap.
 */

const term = vi.hoisted(() => ({ close: null as null | ((info: { code: number; reason: string }) => void) }));
vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onOutput: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void }) => {
      term.close = handlers.onClose ?? null;
      handlers.onOutput(new TextEncoder().encode('claude auth login\n'));
      return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
    }),
  };
});

const CLAUDE: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.280', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm i -g claude' };

/** What the vendor reports: signed out until `staleLeft` more probes have passed after the sign-in command ended. */
function vendor() {
  const v = {
    signedInByUser: false,
    staleLeft: 2,
    refreshes: 0,
    read(): ProviderStatus {
      if (!v.signedInByUser) return CLAUDE;
      if (v.staleLeft > 0) {
        v.staleLeft -= 1;
        return CLAUDE;
      }
      return { ...CLAUDE, state: 'ready', plan: 'Claude Max' };
    },
  };
  return v;
}

const PROMPTS = [
  '[data-testid="first-run-setup-agent"]',
  '[data-testid="first-run-signin"]',
  '[data-testid^="s2-connect-"][data-state="signIn"]',
  '[data-testid="settings-agent-signin"]',
  '[data-testid="agent-recovery-signin"]',
].join(',');
/** Every sign-in prompt on screen, whichever surface drew it. */
const prompts = () => document.querySelectorAll(PROMPTS).length;

const RUN = {
  id: 'r1',
  status: 'failed',
  startedAt: 1,
  agentRef: 'claude',
  error: 'Not logged in',
  turn: 'ended',
  retry: { prompt: 'hi' },
  recovery: { kind: 'signIn', provider: 'claude', cause: 'signedOut' },
} as unknown as AgentRun;

beforeEach(() => {
  resetSignInState();
  term.close = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('one sign-in, one prompt', () => {
  it('after the person signs in, no surface asks again while the vendor settles, on a focus, or at all', async () => {
    const v = vendor();
    const client: OnboardingClient = {
      providers: vi.fn(async (refresh?: boolean) => {
        if (refresh) v.refreshes += 1;
        return { ok: true as const, body: [v.read()] };
      }),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    };
    const agents: AgentsClient = {
      list: vi.fn(async () => ({ outcome: 'ok' as const, body: agentRows([{ ...v.read() }], []) })),
      connect: vi.fn(async (row) => ({ outcome: 'ok' as const, body: { ...row, status: 'connected' as const } })),
    };
    const fetchImpl = (async (url: string) =>
      new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as (i: string, init?: RequestInit) => Promise<Response>;

    render(<RecoveryCard run={RUN} onRetry={() => {}} />);
    render(<AgentsPane client={agents} onboardingClient={client} />);
    render(<ConnectAgents sessionId="s1" fetchImpl={fetchImpl} onboarding={client} store={createAgentRunStore()} />);
    render(<FirstRun client={client} onDone={() => {}} />);

    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    await screen.findByTestId('first-run-setup-agent');
    await screen.findByTestId('settings-agent-signin');
    await screen.findByTestId('s2-connect');
    /* Signed out for real: each of the four surfaces says so (this is the ONE sign-in the person is told about). */
    expect(prompts()).toBe(4);

    fireEvent.click(screen.getByTestId('first-run-setup-agent'));
    await waitFor(() => expect(term.close).not.toBeNull());
    /* The person signs in, in the terminal, and the command ends. */
    v.signedInByUser = true;
    act(() => term.close?.({ code: 1000, reason: 'shell exited (code 0)' }));

    /* The vendor still reads signed-out for two probes. Nothing may ask for a sign-in, and the card says it is checking. */
    await waitFor(() => expect(screen.getByTestId('first-run-provider-say').textContent).toMatch(/checking sign-in/i));
    expect(prompts()).toBe(0);

    /* A window focus in the gap (past the re-probe floor) does not bring a prompt back. */
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60_000;
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
    } finally {
      Date.now = realNow;
    }
    expect(prompts()).toBe(0);

    /* The vendor settles on ready: Start chatting, and still no prompt anywhere. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    await screen.findByTestId('first-run-start');
    expect(prompts()).toBe(0);
    expect(v.refreshes).toBeLessThanOrEqual(8);
  });

  it('when the vendor really reports signed-out after the grace, the prompt comes back', async () => {
    const client: OnboardingClient = {
      providers: vi.fn(async () => ({ ok: true as const, body: [CLAUDE] })),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    };
    render(<FirstRun client={client} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
    await waitFor(() => expect(term.close).not.toBeNull());
    act(() => term.close?.({ code: 1000, reason: 'shell exited (code 0)' }));
    await waitFor(() => expect(screen.getByTestId('first-run-provider-say').textContent).toMatch(/checking sign-in/i));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    await waitFor(() => expect(screen.getByTestId('first-run-provider-say').textContent).not.toMatch(/checking sign-in/i));
    expect(screen.getByTestId('first-run-provider').getAttribute('data-state')).toBe('signIn');
  });
});

const READY: ProviderStatus = { ...CLAUDE, state: 'ready', plan: 'Claude Max' };
const empty: OnboardingClient['repos'] = async () => ({ ok: true as const, body: { repos: [], truncated: false } });

describe('a real signed-out state still prompts', () => {
  it('a token that expired: Settings > Agents reading connected/ready does not hide the failed run Sign in', async () => {
    const client: OnboardingClient = { providers: async () => ({ ok: true as const, body: [READY] }), repos: empty };
    const agents: AgentsClient = {
      list: async () => ({ outcome: 'ok' as const, body: agentRows([READY], [{ id: 'claude' }]) }),
      connect: async (row) => ({ outcome: 'ok' as const, body: { ...row, status: 'connected' as const } }),
    };
    /* The run failed 'Not logged in' after the machine was last seen ready. */
    noteReady('claude');
    render(<RecoveryCard run={{ ...RUN, startedAt: Date.now() + 5 } as AgentRun} onRetry={() => {}} />);
    render(<AgentsPane client={agents} onboardingClient={client} />);
    await screen.findByTestId('settings-agent');
    expect(signedAt('claude')).toBe(0);
    expect(screen.getByTestId('agent-recovery-signin')).toBeTruthy();
    expect(screen.getByTestId('agent-recovery-why').textContent).not.toMatch(/signed in./i);
  });

  it('a settle that follows a real sign-in terminal does record it (positive control)', async () => {
    const client = { providers: async () => ({ ok: true as const, body: [READY] }) };
    await settleSignIn('claude', client, undefined, { afterSignIn: true });
    expect(signedAt('claude')).toBeGreaterThan(0);
  });

  it('a connect refused as signed-out inside the grace says Checking sign-in on the row, then the sign-in note when the vendor still says so', async () => {
    let reads = 0;
    const client: OnboardingClient = {
      providers: vi.fn(async () => {
        reads += 1;
        return { ok: true as const, body: [reads <= 2 ? READY : CLAUDE] };
      }),
      repos: empty,
    };
    /* Just signed in: the grace is on. */
    await settleSignIn('claude', client, undefined, { afterSignIn: true });
    expect(isQuiet('claude')).toBe(true);
    const fetchImpl = (async (url: string) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      if (url === '/api/acp/agents/connect') return new Response(JSON.stringify({ error: 'signed out', state: 'signIn', signInCommand: 'claude auth login' }), { status: 409 });
      return new Response('{}', { status: 404 });
    }) as unknown as (i: string, init?: RequestInit) => Promise<Response>;
    render(<ConnectAgents sessionId="s1" fetchImpl={fetchImpl} onboarding={client} store={createAgentRunStore()} />);
    const row = await screen.findByTestId('s2-connect-claude');
    expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Ready, Claude Max');
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Checking sign-in...'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    await waitFor(() => expect(screen.getByTestId('s2-connect-note-claude').textContent).toBe('Needs sign-in'));
    expect(screen.getByTestId('s2-connect-help-claude')).toBeTruthy();
  });

  it('opening the model menu starts no grace', async () => {
    const client: OnboardingClient = { providers: async () => ({ ok: true as const, body: [READY] }), repos: empty };
    const fetchImpl = (async (url: string) => new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: 200 })) as unknown as (i: string, init?: RequestInit) => Promise<Response>;
    render(<ConnectAgents sessionId="s1" fetchImpl={fetchImpl} onboarding={client} store={createAgentRunStore()} />);
    await screen.findByTestId('s2-connect-claude');
    expect(isQuiet('claude')).toBe(false);
  });

  it('a settle in flight when the state is reset writes nothing back', async () => {
    let release!: (v: { ok: true; body: ProviderStatus[] }) => void;
    const client = { providers: () => new Promise<{ ok: true; body: ProviderStatus[] }>((r) => (release = r)) };
    const p = settleSignIn('claude', client, undefined, { afterSignIn: true });
    resetSignInState();
    release({ ok: true, body: [READY] });
    await p;
    expect(isQuiet('claude')).toBe(false);
    expect(signedAt('claude')).toBe(0);
  });
});
