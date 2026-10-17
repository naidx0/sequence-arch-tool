import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

/* The v3 rail searches what was said in chats too (claims U48), the same route as the s2 panel. */

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const idx = { version: 1, activeId: 'a', sessions: [{ id: 'a', title: 'Rate limiting', createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z' }, { id: 'b', title: 'Orders health', createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z' }] };

function mount(calls: string[], truncated = false, store = createStore({})) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') return json({ index: idx, scope: 'workspace', repos: [] });
    if (url.startsWith('/api/sessions/search')) {
      calls.push(url);
      return json({ hits: [{ chatId: 'b', title: 'Orders health', snippet: '...the quokka ledger...', at: '2026-09-21T10:00:00.000Z' }], truncated });
    }
    return json({});
  }) as typeof fetch;
  render(
    <StoreProvider store={store}>
      <V3SessionsRail client={createSessionsClient(fetchImpl)} onOpenProject={() => undefined} />
    </StoreProvider>,
  );
}

function repoStore() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
  const load = (root: string) => {
    const graph = { repoName: root, scannedAt: '2026-10-01T00:00:00.000Z', nodes: [], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
    store.dispatch({ type: 'repo/loaded', draft: { root, repoName: root, graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt as string }, at: 1 });
  };
  load('/work/a');
  return { store, load };
}

describe('v3 rail message search', () => {
  it('three letters show an In messages group with the snippet', async () => {
    const calls: string[] = [];
    mount(calls);
    const box = await screen.findByTestId('v3-rail-search');
    fireEvent.change(box, { target: { value: 'quokka' } });
    await waitFor(() => expect(screen.getByTestId('v3-rail-messages')).toBeTruthy());
    expect(screen.getByTestId('v3-rail-hit-snippet').textContent).toContain('quokka ledger');
    expect(calls).toEqual(['/api/sessions/search?q=quokka']);
  });

  it('says so when the server stopped early', async () => {
    mount([], true);
    fireEvent.change(await screen.findByTestId('v3-rail-search'), { target: { value: 'quokka' } });
    await waitFor(() => expect(screen.getByTestId('v3-rail-hits-truncated')).toBeTruthy());
  });

  it('hits are dropped at once when the workspace changes', async () => {
    const { store, load } = repoStore();
    mount([], false, store);
    fireEvent.change(await screen.findByTestId('v3-rail-search'), { target: { value: 'quokka' } });
    await waitFor(() => expect(screen.getByTestId('v3-rail-messages')).toBeTruthy());
    act(() => load('/work/b'));
    expect(screen.queryByTestId('v3-rail-messages')).toBeNull();
  });

  it('two letters ask nothing', async () => {
    const calls: string[] = [];
    mount(calls);
    fireEvent.change(await screen.findByTestId('v3-rail-search'), { target: { value: 'qu' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('v3-rail-messages')).toBeNull();
  });
});
