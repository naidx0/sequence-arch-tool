import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';
import { resetSignInState } from './signInState';

vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return { ...real, connectTerminal: vi.fn(async () => ({ sendInput() {}, resize() {}, close() {}, readyState: 1 })) };
});

/*
 * CLAUDE WITHOUT AN INSTALL STEP. The bridge ships inside the app, so the server reports a signed-in
 * Claude as Ready with `bridge: 'bundled'` and a signed-out one as plain Sign in. Neither card has an
 * Install bridge button; the 'adapter' card (no bundle, no global bridge) still does.
 */

/* The sign-in-once grace (signInState) is module state: a signed-in read in one case would make the next case's
   signed-out read "Checking sign-in...". Each case starts from a page that has seen no sign-in. */
beforeEach(() => resetSignInState());

const BASE: ProviderStatus = {
  id: 'claude',
  label: 'Claude Code',
  installed: true,
  version: '2.1.280',
  state: 'ready',
  plan: 'Claude Max',
  bridge: 'bundled',
  signInCommand: 'claude auth login',
  installHint: 'npm install -g @anthropic-ai/claude-code',
};

function client(p: ProviderStatus): OnboardingClient {
  return {
    providers: vi.fn(async () => ({ ok: true as const, body: [p] })),
    repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    installBridge: vi.fn(),
    bridgeStatus: vi.fn(),
  } as unknown as OnboardingClient;
}

async function openClaude(p: ProviderStatus) {
  render(<FirstRun client={client(p)} onDone={() => {}} />);
  fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
  return screen.findByTestId('first-run-provider');
}

describe('Claude Code with the bridge bundled', () => {
  it('signed in: Ready, Start chatting, and no Install bridge button anywhere', async () => {
    const card = await openClaude(BASE);
    expect(card.getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId('first-run-provider-pill').textContent).toMatch(/^Ready/);
    expect(within(card).getByTestId('first-run-start')).toBeTruthy();
    expect(screen.queryByTestId('first-run-setup-agent')).toBeNull();
    expect(card.textContent).not.toMatch(/bridge|adapter|npm/i);
  });

  it('signed out: the one step is Sign in, never "Install bridge and sign in"', async () => {
    const card = await openClaude({ ...BASE, state: 'signIn', plan: undefined });
    expect(card.getAttribute('data-state')).toBe('signIn');
    const button = within(card).getByTestId('first-run-setup-agent');
    expect(button.textContent).toBe('Sign in');
    expect(card.textContent).not.toMatch(/bridge|adapter|npm/i);
  });

  it('control: without a bundle or a global bridge the Install bridge step is still offered', async () => {
    const card = await openClaude({ ...BASE, state: 'adapter', bridge: undefined, adapterInstall: 'npm install -g @agentclientprotocol/claude-agent-acp', bridgeMissing: true });
    expect(within(card).getByTestId('first-run-setup-agent').textContent).toBe('Install bridge');
  });
});

describe('Claude Code whose bridge is fetched on first use', () => {
  it('shows "Setting up Claude… 12 MB" with no button, counts up by itself, and offers Start chatting the moment it is done', async () => {
    const polls: ProviderStatus[] = [
      { ...BASE, state: 'preparing', bridge: undefined, setupBytes: 12_400_000 },
      { ...BASE, state: 'preparing', bridge: undefined, setupBytes: 27_000_000 },
      { ...BASE, bridge: 'downloaded' },
    ];
    let i = 0;
    const c = {
      providers: vi.fn(async () => ({ ok: true as const, body: [polls[Math.min(i++, polls.length - 1)]!] })),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
      installBridge: vi.fn(),
      bridgeStatus: vi.fn(),
    } as unknown as OnboardingClient;
    render(<FirstRun client={c} onDone={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
    const card = await screen.findByTestId('first-run-provider');
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Setting up Claude… 12 MB');
    expect(within(card).queryByTestId('first-run-start')).toBeNull();
    expect(within(card).queryByTestId('first-run-setup-agent')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Setting up Claude… 27 MB'), { timeout: 4000 });
    await waitFor(() => expect(within(screen.getByTestId('first-run-provider')).getByTestId('first-run-start')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByTestId('first-run-provider-pill').textContent).toMatch(/^Ready/);
  });

  it('a Claude Code older than the minimum reads "Update Claude Code" and cannot start', async () => {
    const card = await openClaude({ ...BASE, state: 'update', version: '2.0.5', minVersion: '2.1.0' });
    expect(screen.getByTestId('first-run-provider-pill').textContent).toBe('Update Claude Code');
    expect(within(card).getByTestId('first-run-provider-say').textContent).toMatch(/2\.0\.5 is older than Sequence can drive \(2\.1\.0 or newer\)/);
    expect(within(card).queryByTestId('first-run-start')).toBeNull();
  });
});

describe('a failed first-use download', () => {
  it('says why in plain words and offers the npm install, and stays that way', async () => {
    const card = await openClaude({ ...BASE, state: 'adapter', bridge: undefined, bridgeMissing: true, adapterInstall: 'npm install -g @agentclientprotocol/claude-agent-acp', setupError: 'a proxy or firewall is intercepting the connection (its certificate is not trusted)' });
    expect(within(card).getByTestId('first-run-provider-say').textContent).toBe(
      "Couldn't download the Claude bridge: a proxy or firewall is intercepting the connection (its certificate is not trusted). Install it with npm instead (the button does it).",
    );
    expect(within(card).getByTestId('first-run-setup-agent').textContent).toBe('Install bridge');
  });
  it('signed out: the same reason, with the one combined button', async () => {
    const card = await openClaude({ ...BASE, state: 'signIn', plan: undefined, bridge: undefined, bridgeMissing: true, adapterInstall: 'npm install -g x', setupError: 'the connection to the npm registry failed or timed out (a proxy may be needed)' });
    expect(within(card).getByTestId('first-run-provider-say').textContent).toMatch(/signed out\. Couldn't download the Claude bridge: the connection to the npm registry failed/);
  });
});
