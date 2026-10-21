import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRunStore } from '../agents/agentRuns';
import { ConnectAgents } from './ConnectAgents';
vi.mock('../onboarding/BrowserSignIn', () => ({ BrowserSignIn: () => <span data-testid="controlled-signin">Controlled sign-in boundary</span> }));
afterEach(cleanup);
it('registered signed-out providers retain a setup row in the picker', async () => {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ agents: [{ id: 'codex' }], models: [], efforts: [] }), { status: 200 }));
  const onRows = vi.fn();
  render(<ConnectAgents sessionId="chat" inSection onRows={onRows} fetchImpl={f} store={createAgentRunStore()} onboarding={{ providers: async () => ({ ok: true, body: [{ id: 'codex', label: 'Codex', installed: true, version: '1', state: 'signIn', signInCommand: 'codex login', installHint: '' }] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) }} />);
  fireEvent.click(await screen.findByTestId('s2-signin-codex'));
  await screen.findByTestId('controlled-signin');
  expect(screen.queryByTestId('s2-connect-go-codex')).toBeNull();
  expect(onRows).toHaveBeenLastCalledWith(1);
  expect(f.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
