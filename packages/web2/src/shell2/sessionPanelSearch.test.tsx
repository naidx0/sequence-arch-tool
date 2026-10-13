import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/* Searching chats searches what was said in them, not only their titles (claims U48). */

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number): SessionIndexEntry => ({ id, title, createdAt: at(h), updatedAt: at(h) }) as SessionIndexEntry;
const INDEX = [chat('a1', 'Rate limiting', 9), chat('b2', 'Orders health', 11)];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function wired(searchCalls: string[], truncated = false) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') return json({ index: { version: 1, activeId: 'a1', sessions: INDEX }, scope: 'workspace', repos: [] });
    if (url.startsWith('/api/sessions/search')) {
      searchCalls.push(url);
      return json({ hits: [{ chatId: 'b2', title: 'Orders health', snippet: '…the quokka ledger reconciled…', at: at(11) }], truncated });
    }
    if (url === '/api/recent') return json({ recent: [] });
    return json({});
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

beforeEach(() => localStorage.clear());

function repoStore() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
  const load = (root: string) => {
    const graph = { repoName: root, scannedAt: '2026-10-01T00:00:00.000Z', nodes: [], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
    store.dispatch({ type: 'repo/loaded', draft: { root, repoName: root, graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt as string }, at: 1 });
  };
  load('/work/a');
  return { store, load };
}

describe('searching chats finds words inside them', () => {
  async function mount(calls: string[], truncated = false, store = createStore({})) {
    render(
      <StoreProvider store={store}>
        <SessionPanel client={wired(calls, truncated)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('s2-search-toggle'));
    return screen.getByTestId('s2-search');
  }

  it('a three-letter query shows an In messages group with the snippet, after a pause', async () => {
    const calls: string[] = [];
    const box = await mount(calls);
    fireEvent.change(box, { target: { value: 'quokka' } });
    expect(screen.queryByTestId('s2-group-messages')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('s2-group-messages')).toBeTruthy());
    expect(screen.getByTestId('s2-hit-snippet').textContent).toContain('quokka ledger');
    expect(calls).toEqual(['/api/sessions/search?q=quokka']);
  });

  it('says so when the server stopped early, and when the group is about this project only', async () => {
    const box = await mount([], true);
    fireEvent.change(box, { target: { value: 'quokka' } });
    await waitFor(() => expect(screen.getByTestId('s2-hits-truncated')).toBeTruthy());
    expect(screen.getByTestId('s2-group-messages').getAttribute('aria-label')).toBe('In messages (this project)');
  });

  it('hits are dropped at once when the workspace changes', async () => {
    const { store, load } = repoStore();
    const box = await mount([], false, store);
    fireEvent.change(box, { target: { value: 'quokka' } });
    await waitFor(() => expect(screen.getByTestId('s2-group-messages')).toBeTruthy());
    act(() => load('/work/b'));
    expect(screen.queryByTestId('s2-group-messages')).toBeNull();
  });

  it('a two-letter query asks nothing and shows no group', async () => {
    const calls: string[] = [];
    const box = await mount(calls);
    fireEvent.change(box, { target: { value: 'qu' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('s2-group-messages')).toBeNull();
  });
});
