import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentsPane } from './AgentsPane';
import { agentRows, createAgentsClient } from './agentsClient';

vi.mock('../onboarding/BrowserSignIn', () => ({ BrowserSignIn: () => <span data-testid="controlled-signin">Controlled sign-in boundary</span> }));
afterEach(cleanup);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const provider = { id: 'codex', label: 'Codex', installed: true, version: '1', state: 'signIn' as const, signInCommand: 'codex login', installHint: '' };
it('registration does not override the probe readiness, while ready and custom registrations still connect', () => {
  expect(agentRows([provider], [{ id: 'codex' }])[0]?.status).toBe('signed-out');
  expect(agentRows([{ ...provider, state: 'ready' }], [{ id: 'codex' }])[0]?.status).toBe('connected');
  expect(agentRows([], [{ id: 'custom' }])[0]?.status).toBe('connected');
});
it('registered but signed out offers one-click Sign in through the real list client, without connecting', async () => {
  const f = vi.fn(async (url: RequestInfo | URL) => json(String(url).includes('providers') ? { providers: [provider] } : { agents: [{ id: 'codex' }] }));
  render(<AgentsPane client={createAgentsClient(f)} catalog={false} loadModels={async () => []} />);
  fireEvent.click(await screen.findByTestId('settings-agent-signin'));
  await screen.findByTestId('controlled-signin');
  expect(screen.getByTestId('settings-agent-status').textContent).toBe('Needs sign-in');
  expect(screen.queryByTestId('settings-agent-connect')).toBeNull();
  expect(f.mock.calls.every(c => c.length === 1)).toBe(true);
});
it('failed probe plus empty registry is a retryable failure, then Retry reads again and clears it', async () => {
  let available = false;
  const f = vi.fn(async (url: RequestInfo | URL) => String(url).includes('providers') ? json({ providers: [provider] }, available ? 200 : 503) : json({ agents: [] }));
  render(<AgentsPane client={createAgentsClient(f)} catalog={false} />);
  expect((await screen.findByTestId('settings-agents-failure')).textContent).toContain('Could not check available agents.');
  expect(screen.queryByTestId('settings-agents-none')).toBeNull();
  available = true;
  fireEvent.click(screen.getByTestId('settings-agents-retry'));
  await screen.findByTestId('settings-agent-signin');
  await waitFor(() => expect(screen.queryByTestId('settings-agents-failure')).toBeNull());
  expect(f.mock.calls.filter(([url]) => String(url).includes('providers'))).toHaveLength(2);
});
