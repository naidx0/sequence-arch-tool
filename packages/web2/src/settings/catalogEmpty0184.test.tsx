/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: AN EMPTY AGENT LIST DOES NOT TAKE THE AGENTS PANE DOWN
   packages/web2/src/settings/catalogEmpty0184.test.tsx

   Found by the e2e audit: with no agent left to offer (every agent in the list connected, or a catalog that sent
   none), More agents read `shown[0].state` of nothing and threw, and Settings drew "This panel hit a problem" in
   place of the whole Agents pane, Claude and Codex rows included.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { AgentCatalogSection } from './AgentCatalogSection';
import type { CatalogClient, CatalogRow } from './agentCatalogClient';

const client = (agents: CatalogRow[]): CatalogClient => ({
  list: vi.fn(async () => ({ ok: true as const, body: { agents, registryFetchedAt: null } })),
  refresh: vi.fn(async () => ({ ok: true as const, body: { agents, registryFetchedAt: 1 } })),
}) as unknown as CatalogClient;
const okFetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;

describe('More agents with nothing to offer', () => {
  it('an empty list draws the section with one calm line, not a crash', async () => {
    render(<AgentCatalogSection client={client([])} fetchImpl={okFetch} store={createAgentRunStore()} />);
    expect((await screen.findByTestId('agent-catalog-none')).textContent).toBe('Every agent Sequence knows about is connected above.');
    expect(screen.getByTestId('agent-catalog-refresh')).toBeTruthy();
  });

  it('every agent connected is the same: nothing to list, nothing thrown', async () => {
    const connected: CatalogRow = { id: 'gemini', name: 'Gemini CLI', source: 'builtin', state: 'connected', installHint: 'x' };
    render(<AgentCatalogSection client={client([connected])} fetchImpl={okFetch} store={createAgentRunStore()} />);
    await waitFor(() => expect(screen.getByTestId('agent-catalog-none')).toBeTruthy());
    expect(screen.queryByTestId('agent-catalog-row')).toBeNull();
  });
});
