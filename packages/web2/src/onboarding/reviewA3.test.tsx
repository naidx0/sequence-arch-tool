import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserSignIn } from './BrowserSignIn';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/* Reviewer cases for wave A (A3: BrowserSignIn timers, cancel, and races). */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── BrowserSignIn ─────────────────────────────────────────────────────── */

const claude: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'signIn', signInCommand: 'claude auth login', installHint: 'x' } as ProviderStatus;

function fakeConnect(closeCode = 1005) {
  const log = { closes: 0, handlers: null as null | { onClose?: (i: { code: number; reason: string }) => void } };
  const connect = (async (handlers: { onOutput: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void }) => {
    log.handlers = handlers;
    setTimeout(() => handlers.onOutput(new TextEncoder().encode('Visit https://claude.ai/oauth?x=1 to sign in\n')), 0);
    return {
      sendInput() {},
      resize() {},
      close() {
        log.closes++;
        /* A real WebSocket fires close after the client closes it. */
        setTimeout(() => handlers.onClose?.({ code: closeCode, reason: '' }), 0);
      },
      readyState: 1,
    };
  }) as never;
  return { connect, log };
}

function probeClient(state: () => ProviderStatus['state']) {
  const calls = { n: 0 };
  const client = {
    providers: vi.fn(async () => {
      calls.n++;
      return { ok: true, body: [{ ...claude, state: state() }] };
    }),
  } as unknown as OnboardingClient;
  return { client, calls };
}

describe('R4 BrowserSignIn timers and cancel', () => {
  it('unmount while waiting stops the probe poll', async () => {
    const { connect } = fakeConnect();
    const { client, calls } = probeClient(() => 'signIn');
    const opened: string[] = [];
    const v = render(<BrowserSignIn provider={claude} client={client} onSignedIn={() => {}} connect={connect} openExternal={(u) => opened.push(u)} />);
    await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal').getAttribute('data-phase')).toBe('waiting'));
    expect(opened).toHaveLength(1);
    v.unmount();
    const before = calls.n;
    await new Promise((r) => setTimeout(r, 4500));
    expect(calls.n).toBe(before);
  }, 10000);

  it('Cancel stays on "Sign-in cancelled." with Retry (the socket close it causes does not rewrite it)', async () => {
    const { connect } = fakeConnect(1005);
    const { client } = probeClient(() => 'signIn');
    const onExit = vi.fn(async () => null);
    render(<BrowserSignIn provider={claude} client={client} onSignedIn={() => {}} connect={connect} openExternal={() => {}} onExit={onExit} />);
    await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal').getAttribute('data-phase')).toBe('waiting'));
    fireEvent.click(screen.getByTestId('first-run-signin-cancel'));
    await new Promise((r) => setTimeout(r, 50));
    expect(onExit, 'cancel ran the command-ended path').not.toHaveBeenCalled();
    expect(screen.getByTestId('first-run-signin-retry-state').textContent).toContain('Sign-in cancelled.');
  });

  it('a slow probe is not asked again while the previous ask is still out', async () => {
    const { connect } = fakeConnect();
    let n = 0;
    const client = { providers: vi.fn(() => { n++; return new Promise(() => {}); }) } as unknown as OnboardingClient;
    render(<BrowserSignIn provider={claude} client={client} onSignedIn={() => {}} connect={connect} openExternal={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal').getAttribute('data-phase')).toBe('waiting'));
    await new Promise((r) => setTimeout(r, 6500));
    expect(n, 'probe requests piled up').toBeLessThanOrEqual(1);
  }, 10000);

  it('signed in once: onSignedIn fires exactly once even if poll and focus race', async () => {
    const { connect } = fakeConnect();
    const { client } = probeClient(() => 'ready');
    const onSignedIn = vi.fn();
    render(<BrowserSignIn provider={claude} client={client} onSignedIn={onSignedIn} connect={connect} openExternal={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal').getAttribute('data-phase')).toBe('waiting'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    await new Promise((r) => setTimeout(r, 2500));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  }, 10000);

  it('a probe answer that lands after Cancel or unmount never signs in (no connect nobody asked for)', async () => {
    for (const how of ['cancel', 'unmount'] as const) {
      const { connect } = fakeConnect();
      let answer: (v: unknown) => void = () => {};
      const client = { providers: vi.fn(() => new Promise((r) => { answer = r; })) } as unknown as OnboardingClient;
      const onSignedIn = vi.fn();
      const v = render(<BrowserSignIn provider={claude} client={client} onSignedIn={onSignedIn} connect={connect} openExternal={() => {}} />);
      await waitFor(() => expect(screen.getByTestId('first-run-signin-terminal').getAttribute('data-phase')).toBe('waiting'));
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(client.providers).toHaveBeenCalled());
      if (how === 'cancel') fireEvent.click(screen.getByTestId('first-run-signin-cancel'));
      else v.unmount();
      await act(async () => {
        answer({ ok: true, body: [{ ...claude, state: 'ready' }] });
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(onSignedIn, how).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
