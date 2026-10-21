import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRunStore } from '../agents/agentRuns';
import type { OnboardingClient } from '../onboarding/onboardingClient';
import { ConnectAgents } from './ConnectAgents';

afterEach(cleanup);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const provider = { id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready' as const, signInCommand: '', installHint: '' };

it('a failed provider read stays visible inside the picker, and Retry recovers without connecting', async () => {
  const providers = vi.fn<OnboardingClient['providers']>()
    .mockResolvedValueOnce({ ok: false, message: 'Probe unavailable' })
    .mockResolvedValue({ ok: true, body: [provider] });
  const fetchImpl = vi.fn(async () => json({ agents: [] }));
  const onRows = vi.fn();
  render(<ConnectAgents sessionId="chat" inSection onRows={onRows} fetchImpl={fetchImpl} store={createAgentRunStore()} onboarding={{ providers, repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) }} />);
  const failure = await screen.findByTestId('s2-connect-read-failure');
  expect(failure.textContent).toContain('Could not check available agents.');
  await waitFor(() => expect(onRows).toHaveBeenLastCalledWith(1));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByTestId('s2-connect-go-codex');
  expect(screen.queryByTestId('s2-connect-read-failure')).toBeNull();
  expect(providers).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls.every(c => c.length === 1)).toBe(true);
});

it('an unreadable registry does not offer to reconnect an agent whose registration is unknown', async () => {
  const onRows = vi.fn();
  render(<ConnectAgents sessionId="chat" inSection onRows={onRows} fetchImpl={async () => json({ error: 'Registry unavailable' }, 503)} store={createAgentRunStore()} onboarding={{ providers: async () => ({ ok: true, body: [provider] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) }} />);
  expect((await screen.findByTestId('s2-connect-read-failure')).textContent).toContain('Could not read connected agents.');
  expect(screen.queryByTestId('s2-connect-go-codex')).toBeNull();
  await waitFor(() => expect(onRows).toHaveBeenLastCalledWith(1));
});
