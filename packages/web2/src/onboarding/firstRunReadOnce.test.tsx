import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import { resetSignInState } from './signInState';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/**
 * The welcome screen shows More agents and Ready in one click, and both need the agent catalog; Ready in one
 * click also needs /api/ai-config. Each is read once on mount and passed down, not fetched by each.
 */

const signedOut: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: false, version: null, state: 'install', signInCommand: 'claude auth login', installHint: 'x' },
  { id: 'codex', label: 'Codex', installed: false, version: null, state: 'install', signInCommand: 'codex login', installHint: 'x' },
];

afterEach(() => {
  vi.unstubAllGlobals();
  resetSignInState();
  window.sessionStorage.clear();
});

describe('first run › reads once', () => {
  it('the agent catalog and /api/ai-config are each fetched exactly once on mount', async () => {
    const gets: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if ((init?.method ?? 'GET') === 'GET') gets.push(u);
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
        if (u === '/api/acp/catalog') return json({ registryFetchedAt: null, agents: [{ id: 'hermes', name: 'Hermes Agent', source: 'builtin', state: 'ready', shown: 'hermes acp', installHint: '' }] });
        if (u === '/api/ai-config') return json({ configured: false });
        if (u === '/api/providers/catalog') return json({ providers: [], detected: [] });
        return json({});
      }),
    );
    const client = {
      providers: vi.fn(async () => ({ ok: true as const, body: signedOut })),
      repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    } as unknown as OnboardingClient;
    render(<FirstRun client={client} onDone={() => {}} />);
    await screen.findAllByTestId('agent-catalog-row');
    await waitFor(() => expect(gets.filter((u) => u === '/api/providers/catalog')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(gets.filter((u) => u === '/api/acp/catalog')).toHaveLength(1);
    expect(gets.filter((u) => u === '/api/ai-config')).toHaveLength(1);
  });
});
