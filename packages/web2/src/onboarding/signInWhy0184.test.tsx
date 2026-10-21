/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: A SIGN-IN THAT FAILS SAYS WHY, CALMLY AND SPECIFICALLY
   packages/web2/src/onboarding/signInWhy0184.test.tsx

   "The sign-in ended before it finished." was the whole message for every way a sign-in command can end. The server
   already says how it ended (`shell exited (code 1)`, `shell failed to start: ...`) and the command's last line is
   on the page: the sentence now carries both, and never a link as if it were the reason.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OnboardingClient, ProviderStatus } from './onboardingClient';
import { BrowserSignIn, endedWhy } from './BrowserSignIn';

describe('endedWhy', () => {
  it('a command that exits with an error says the exit code and its own last line', () => {
    expect(endedWhy('Starting\nError: Login failed: access_denied\n', 'shell exited (code 1)', true)).toBe('The sign-in ended before it finished (exit code 1). It said: "Error: Login failed: access_denied".');
  });

  it('a last line that is a link is not offered as the reason; a clean exit has no code', () => {
    expect(endedWhy('Open https://example.invalid/auth to continue\n', 'shell exited (code 1)', true)).toBe('The sign-in ended before it finished (exit code 1).');
    expect(endedWhy('', 'shell exited (code 0)', true)).toBe('The sign-in ended before it finished.');
  });

  it('a command that could not start says why, in the server\'s words', () => {
    expect(endedWhy('', 'shell failed to start: spawn claude ENOENT', false)).toBe('The sign-in could not start: spawn claude ENOENT.');
  });

  it('a socket that dropped is "stopped", with no invented cause', () => {
    expect(endedWhy('', '', false)).toBe('The sign-in stopped.');
  });

  it('a very long last line is left out, not pasted into the panel', () => {
    expect(endedWhy(`${'x'.repeat(400)}\n`, 'shell exited (code 2)', true)).toBe('The sign-in ended before it finished (exit code 2).');
  });
});

describe('BrowserSignIn when the command ends', () => {
  const P: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'signIn', signInCommand: 'claude auth login', installHint: '' };
  const client: OnboardingClient = { providers: async () => ({ ok: true, body: [P] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) };

  it('the Retry state shows the reason the server and the command gave', async () => {
    let close: (i: { code: number; reason: string }) => void = () => undefined;
    const connect = vi.fn(async (handlers: { onOutput: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void }) => {
      close = handlers.onClose!;
      handlers.onOutput(new TextEncoder().encode('Error: not allowed for this account\n'));
      return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
    });
    render(<BrowserSignIn provider={P} client={client} connect={connect as never} onSignedIn={() => undefined} onExit={async () => P} />);
    await screen.findByTestId('first-run-signin-waiting');
    await act(async () => close({ code: 1000, reason: 'shell exited (code 1)' }));
    const state = await screen.findByTestId('first-run-signin-retry-state');
    expect(state.textContent).toContain('The sign-in ended before it finished (exit code 1). It said: "Error: not allowed for this account".');
  });
});
