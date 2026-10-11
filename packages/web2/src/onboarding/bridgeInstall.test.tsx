import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import { resetSignInState } from './signInState';

import type { BridgeInstallStatus, OnboardingClient, ProviderStatus } from './onboardingClient';

const term = vi.hoisted(() => ({ calls: [] as (string | undefined)[] }));
beforeEach(() => resetSignInState());

vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (_h: unknown, signIn?: string) => {
      term.calls.push(signIn);
      return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
    }),
  };
});

/*
 * ROUND 7, A4: "It says Claude ready, but that actually doesn't work after."
 * A signed-in Claude Code without claude-agent-acp reads Needs bridge, with
 * the owner's sentence and an Install bridge button. Nothing runs before the
 * click; after it the card shows npm's latest line, then the result, then the
 * re-probe says Ready.
 */

const CLAUDE: ProviderStatus = {
  id: 'claude',
  label: 'Claude Code',
  installed: true,
  version: '2.1.280',
  state: 'adapter',
  plan: 'Claude Max',
  signInCommand: 'claude auth login',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  adapterInstall: 'npm install -g @agentclientprotocol/claude-agent-acp',
};

function client() {
  let ready = false;
  const polls: BridgeInstallStatus[] = [
    { state: 'running', output: ['added 12 packages in 3s'] },
    { state: 'done', exitCode: 0, output: ['added 12 packages in 3s', 'changed 1 package'] },
  ];
  const c: OnboardingClient & { installs: string[] } = {
    installs: [],
    providers: vi.fn(async () => ({ ok: true as const, body: [ready ? { ...CLAUDE, state: 'ready' as const, adapterInstall: undefined } : CLAUDE] })),
    repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    installBridge: vi.fn(async (provider: string) => {
      c.installs.push(provider);
      return { ok: true as const, body: { state: 'running' as const, command: CLAUDE.adapterInstall, output: [] } };
    }),
    bridgeStatus: vi.fn(async () => {
      const next = polls.shift() ?? { state: 'done' as const };
      if (next.state === 'done') ready = true;
      return { ok: true as const, body: next };
    }),
  };
  return c;
}

describe('Claude Code without its bridge', () => {
  it('says Needs bridge in plain words, never Ready, and one button installs it on the click, then re-probes to Ready', async () => {
    const c = client();
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    const card = await screen.findByTestId('first-run-provider');
    expect(card.getAttribute('data-state')).toBe('adapter');
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Needs bridge');
    expect(screen.getByTestId('first-run-route').textContent).not.toMatch(/\bReady\b|adapter/i);
    expect(within(card).getByTestId('first-run-provider-say').textContent).toBe(
      "Sequence talks to Claude Code through a small bridge called claude-agent-acp. It isn't installed yet.",
    );
    expect(c.installs).toEqual([]);
    const button = within(card).getByTestId('first-run-setup-agent');
    expect(button.textContent).toBe('Install bridge');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(c.installs).toEqual(['claude']);
    await waitFor(() => expect(screen.getByTestId('first-run-bridge-progress').textContent).toContain('added 12 packages in 3s'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('first-run-provider').getAttribute('data-state')).toBe('ready'), { timeout: 4000 });
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Ready, Claude Max');
    expect(screen.getByTestId('first-run-start')).toBeTruthy();
    expect(c.installs).toEqual(['claude']);
  });

  it('a failed install says so with npm\'s reason and the same button tries again', async () => {
    const c = client();
    c.bridgeStatus = vi.fn(async () => ({ ok: true as const, body: { state: 'failed' as const, exitCode: 1, error: 'npm exited with code 1', output: ['npm ERR! 404 Not Found'] } }));
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    await act(async () => {
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
    });
    const fail = await screen.findByTestId('first-run-bridge-failed', {}, { timeout: 3000 });
    expect(fail.textContent).toContain('npm exited with code 1');
    expect(screen.getByTestId('first-run-setup-agent').hasAttribute('disabled')).toBe(false);
  });
});

describe('Claude Code signed out and without its bridge (round 13): one flow', () => {
  const SIGNED_OUT: ProviderStatus = { ...CLAUDE, state: 'signIn', bridgeMissing: true, plan: undefined };

  it('checks both up front, offers ONE button, installs the bridge, then opens the sign-in', async () => {
    term.calls.length = 0;
    let bridgeIn = false;
    let signedIn = false;
    const c: OnboardingClient & { installs: string[]; probes: boolean[] } = {
      installs: [],
      probes: [],
      providers: vi.fn(async (refresh?: boolean) => {
        c.probes.push(refresh === true);
        const state = signedIn ? (bridgeIn ? 'ready' : 'adapter') : 'signIn';
        return { ok: true as const, body: [{ ...SIGNED_OUT, state: state as ProviderStatus['state'], bridgeMissing: !bridgeIn, plan: signedIn ? 'Claude Max' : undefined }] };
      }),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
      installBridge: vi.fn(async (p: string) => {
        c.installs.push(p);
        return { ok: true as const, body: { state: 'running' as const, output: [] } };
      }),
      bridgeStatus: vi.fn(async () => {
        bridgeIn = true;
        return { ok: true as const, body: { state: 'done' as const, exitCode: 0, output: ['changed 1 package'] } };
      }),
    };
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Needs sign-in and bridge');
    const one = screen.getByTestId('first-run-setup-agent');
    expect(one.getAttribute('data-needs')).toBe('bridge+signin');
    expect(one.textContent).toBe('Install bridge and sign in');
    expect(screen.queryByTestId('first-run-signin')).toBeNull();
    expect(screen.queryByTestId('first-run-start')).toBeNull();
    await act(async () => {
      fireEvent.click(one);
    });
    /* The bridge goes in, the machine is looked at again, and the sign-in opens by itself. */
    await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal')).toBeTruthy(), { timeout: 4000 });
    expect(c.installs).toEqual(['claude']);
    expect(c.probes.at(-1)).toBe(true);
    expect(screen.getByTestId('first-run-signin-command').textContent).toBe('claude auth login');
    /* UX study 2026-10-09: the sign-in terminal really connects, with the vendor's sign-in. */
    await waitFor(() => expect(term.calls).toEqual(['claude']));
    /* Sign-in finishes in another window: the focus re-probe turns the card Ready and Start chatting appears. */
    signedIn = true;
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60_000;
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
    } finally {
      Date.now = realNow;
    }
    await waitFor(() => expect(screen.getByTestId('first-run-start')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Ready, Claude Max');
  });

  it('with the bridge already there it is just Sign in', async () => {
    const c: OnboardingClient = {
      providers: async () => ({ ok: true, body: [{ ...SIGNED_OUT, bridgeMissing: false }] }),
      repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
    };
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    expect(screen.getByTestId('first-run-setup-agent').textContent).toBe('Sign in');
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Needs sign-in');
  });

  it('a failed combined install brings the plain Sign in back (no npm on the machine must not lock the person out)', async () => {
    term.calls.length = 0;
    const c: OnboardingClient = {
      providers: vi.fn(async () => ({ ok: true as const, body: [SIGNED_OUT] })),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
      installBridge: vi.fn(async () => ({ ok: false as const, message: 'npm was not found. Install Node.js, then try again.' })),
    };
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    expect(screen.queryByTestId('first-run-signin')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('first-run-setup-agent'));
    });
    expect((await screen.findByTestId('first-run-bridge-failed')).textContent).toContain('npm was not found');
    fireEvent.click(await screen.findByTestId('first-run-signin'));
    await waitFor(() => expect(screen.getByTestId('first-run-signin-command').textContent).toBe('claude auth login'));
    await waitFor(() => expect(term.calls).toEqual(['claude']));
  });
});

describe('Codex with its usage limit spent (round 7)', () => {
  it('reads "Usage limit, resets <when>" in amber, never Ready', async () => {
    const RESETS_AT = 1791837379 * 1000;
    const codex: ProviderStatus = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'limited', plan: 'ChatGPT', limitResetsAt: RESETS_AT, signInCommand: 'codex login', installHint: 'npm install -g @openai/codex' };
    const c: OnboardingClient = {
      providers: vi.fn(async () => ({ ok: true as const, body: [codex] })),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    };
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[1]!);
    const card = await screen.findByTestId('first-run-provider');
    const pill = screen.getByTestId('first-run-provider-pill');
    const when = new Date(RESETS_AT).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    expect(pill.textContent).toBe(`Usage limit, resets ${when}`);
    expect(pill.getAttribute('data-tone')).toBe('limit');
    expect(screen.getByTestId('first-run-route').textContent).not.toMatch(/\bReady\b/);
    expect(within(card).getByTestId('first-run-provider-say').textContent).toContain(`until ${when}`);
  });
});
