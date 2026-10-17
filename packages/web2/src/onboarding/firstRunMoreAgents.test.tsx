import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import { resetSignInState } from './signInState';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/**
 * FIRST RUN › MORE AGENTS. Welcome offered four routes (Claude Code, Codex, a
 * local model, an API key). A person whose agent is Gemini, Copilot, Cursor or
 * Hermes had no way in. The ACP catalog now sits under the four: open by itself
 * when neither Claude Code nor Codex is ready, one click to connect, and a
 * connect leaves for setup exactly as a ready Codex does.
 */

const signedOut: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: false, version: null, state: 'install', signInCommand: 'claude auth login', installHint: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', label: 'Codex', installed: false, version: null, state: 'install', signInCommand: 'codex login', installHint: 'npm install -g @openai/codex' },
];
const codexReady: ProviderStatus[] = [signedOut[0]!, { ...signedOut[1]!, installed: true, state: 'ready', plan: 'ChatGPT' }];

const CATALOG = {
  registryFetchedAt: null,
  agents: [
    { id: 'hermes', name: 'Hermes Agent', source: 'builtin', state: 'ready', shown: 'hermes acp', installHint: '' },
    { id: 'gemini', name: 'Gemini CLI', source: 'builtin', state: 'npx', shown: 'npx -y @google/gemini-cli@0.64.0 --acp', installHint: '' },
    { id: 'opencode', name: 'OpenCode', source: 'builtin', state: 'install', installHint: 'Install OpenCode' },
  ],
};

function client(providers: ProviderStatus[]): OnboardingClient {
  return {
    providers: vi.fn(async () => ({ ok: true as const, body: providers })),
    repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
  } as unknown as OnboardingClient;
}

function stubFetch(catalog: unknown = CATALOG): string[] {
  const posted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u === '/api/acp/catalog') return new Response(JSON.stringify(catalog), { status: 200 });
      if (u === '/api/acp/catalog/connect') {
        posted.push(String(init?.body));
        return new Response(JSON.stringify({ agent: { id: 'gemini' }, via: 'npx' }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSignInState();
  window.sessionStorage.clear();
});

describe('first run › more agents', () => {
  it('nothing ready above: the catalog is open, shows only what can start now, and one click connects and moves on', async () => {
    const posted = stubFetch();
    const onConnected = vi.fn();
    render(<FirstRun client={client(signedOut)} onDone={() => {}} onConnected={onConnected} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['hermes', 'gemini']);
    /* The vendor's real mark on the welcome rows too (Gemini from the registry set, Hermes from the lobehub package). */
    expect(rows[1]!.querySelector('.fr-more-ic')?.getAttribute('data-mark')).toBe('logo');
    expect(rows[0]!.querySelector('.fr-more-ic')?.getAttribute('data-mark')).toBe('logo');
    expect((await screen.findByTestId('first-run-more')).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(rows[1]!).getByTestId('agent-catalog-connect'));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(posted).toEqual([JSON.stringify({ id: 'gemini' })]);
    await waitFor(() => expect(screen.getByTestId('first-run').getAttribute('data-step')).toBe('setup'));
  });

  it('nothing in the catalog can start here: no More agents toggle that opens to nothing', async () => {
    stubFetch({ registryFetchedAt: null, agents: [CATALOG.agents[2]] });
    render(<FirstRun client={client(codexReady)} onDone={() => {}} />);
    await screen.findByTestId('first-run-use-ready');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('first-run-more')).toBeNull();
  });

  it('Codex ready above: the catalog stays folded until asked for', async () => {
    stubFetch();
    render(<FirstRun client={client(codexReady)} onDone={() => {}} />);
    await screen.findByTestId('first-run-use-ready');
    const toggle = await screen.findByTestId('first-run-more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('agent-catalog-row')).toBeNull();
    fireEvent.click(toggle);
    /* Hermes is under "Found on this machine" (with Codex), so the list holds only what Found does not: no agent twice. */
    expect((await screen.findAllByTestId('agent-catalog-row')).map((r) => r.getAttribute('data-agent'))).toEqual(['gemini']);
    expect(screen.getAllByTestId('ready-found').map((r) => r.getAttribute('data-key'))).toEqual(['agent:codex', 'catalog:hermes']);
  });
});
