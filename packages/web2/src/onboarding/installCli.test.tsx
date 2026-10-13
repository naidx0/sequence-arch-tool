import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import { createOnboardingClient } from './onboardingClient';
import { resetSignInState } from './signInState';

import type { BridgeInstallStatus, OnboardingClient, ProviderStatus } from './onboardingClient';

beforeEach(() => resetSignInState());
afterEach(cleanup);

vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return { ...real, connectTerminal: vi.fn(async () => ({ sendInput() {}, resize() {}, close() {}, readyState: 1 })) };
});

/*
 * Claims-audit 4.2 (U07/U08/U14): the Install button runs the vendor's native
 * installer on the server; the card shows its latest line, re-probes when it
 * is done, and shows the failure verbatim (with the copy-hint) only on failure.
 */

const MISSING: ProviderStatus = {
  id: 'claude',
  label: 'Claude Code',
  installed: false,
  version: null,
  state: 'install',
  signInCommand: 'claude auth login',
  installHint: 'npm install -g @anthropic-ai/claude-code',
};

function client(polls: BridgeInstallStatus[]) {
  let installed = false;
  const c: OnboardingClient & { installs: string[] } = {
    installs: [],
    providers: vi.fn(async () => ({ ok: true as const, body: [installed ? { ...MISSING, installed: true, version: '2.1.280', state: 'signIn' as const } : MISSING] })),
    repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    installCli: vi.fn(async (p: string) => {
      c.installs.push(p);
      return { ok: true as const, body: { state: 'running' as const, output: [] } };
    }),
    cliStatus: vi.fn(async () => {
      const next = polls.shift() ?? { state: 'done' as const };
      if (next.state === 'done') installed = true;
      return { ok: true as const, body: next };
    }),
  };
  return c;
}

async function openClaude() {
  fireEvent.click((await screen.findAllByTestId('first-run-option'))[0]!);
  return screen.findByTestId('first-run-install');
}

describe('Install button installs the agent CLI', () => {
  it('posts install-cli on the click only, shows the installer line, then re-probes to Sign in', async () => {
    const c = client([{ state: 'running', output: ['Downloading Claude Code'] }, { state: 'done', exitCode: 0, output: ['Installed'] }]);
    const onAsk = vi.fn();
    render(<FirstRun client={c} onDone={() => {}} onAskAgent={onAsk} />);
    const btn = await openClaude();
    expect(btn.textContent).toBe('Install Claude Code');
    expect(c.installs).toEqual([]);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(c.installs).toEqual(['claude']);
    await waitFor(() => expect(screen.getByTestId('first-run-cli-progress').textContent).toContain('Downloading Claude Code'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('first-run-provider').getAttribute('data-state')).toBe('signIn'), { timeout: 4000 });
    expect(screen.queryByTestId('first-run-cli-failed')).toBeNull();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('a failure shows the installer text verbatim with the copy-hint fallback, and Try again', async () => {
    const c = client([{ state: 'failed', exitCode: 6, error: 'curl: (6) Could not resolve host: claude.ai', output: [] }]);
    render(<FirstRun client={c} onDone={() => {}} onAskAgent={() => {}} />);
    const btn = await openClaude();
    await act(async () => {
      fireEvent.click(btn);
    });
    const fail = await screen.findByTestId('first-run-cli-failed', {}, { timeout: 3000 });
    expect(fail.textContent).toContain('curl: (6) Could not resolve host: claude.ai');
    expect(fail.textContent).toContain('npm install -g @anthropic-ai/claude-code');
    expect(screen.getByTestId('first-run-install').textContent).toBe('Try again');
  });

  it('the real client posts kind:"cli" and polls with kind=cli', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ state: 'running' }), { status: 202, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const real = createOnboardingClient(f);
    await real.installCli!('codex');
    await real.cliStatus!('codex');
    expect(calls[0].url).toBe('/api/onboarding/install-adapter');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ provider: 'codex', kind: 'cli' });
    expect(calls[1].url).toBe('/api/onboarding/install-adapter?provider=codex&kind=cli');
  });
});
