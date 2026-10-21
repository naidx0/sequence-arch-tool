import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedChatColumn, StoreProvider } from './connect';
import { createStore } from './store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/*
 * THE BOOT ASKS FOR THE TRANSCRIPT ONCE, THROUGH THE THREAD (perf 0.1.8.4 final).
 * A cold boot reads the chat list twice: once for whatever the server holds when the page loads and again when the
 * startup repository attaches. The transcript read used to wait only for the FIRST of the two, found no open chat in
 * it, and fell back to `/api/chat-memory` while the second read was about to name the chat: one request more than the
 * 34 the ratchet allows, and a transcript read that the thread read then repeated.
 */
describe('the transcript read at boot', () => {
  it('waits for the newest chat-list read, so a list that names no chat does not send it to /api/chat-memory', async () => {
    const entry = { id: 'repo-chat', title: 'New chat', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' };
    const urls: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((r) => (releaseFirst = r));
    let lists = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        urls.push(url);
        let body: unknown = null;
        if (url === '/api/sessions') {
          lists += 1;
          if (lists === 1) {
            await firstHeld;
            body = { index: { version: 1, activeId: 'repo-chat', sessions: [entry] } };
          } else body = { index: { version: 1, activeId: 'repo-chat', sessions: [entry] } };
        } else if (url.startsWith('/api/sessions/repo-chat')) body = { chat: { version: 1, sessionId: 'repo-chat', turns: [] } };
        else if (url.startsWith('/api/chat-memory')) body = { version: 1, sessionId: 'repo-chat', turns: [] };
        else if (url.startsWith('/api/canvas-doc')) body = { version: 1, sessionId: 'repo-chat', blocks: [] };
        else if (url.startsWith('/api/ai-config')) body = { model: '', origin: 'unconfigured' };
        return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body } as unknown as Response;
      }),
    );
    const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );
    /* The startup repository attaches while the first list read is still on the wire. */
    const graph = { nodes: [], edges: [], scannedAt: '2026-10-15T00:00:00.000Z', nodeDetail: {} } as never;
    act(() => {
      store.dispatch({ type: 'repo/loaded', draft: { root: '/tmp/repo', repoName: 'repo', graph, summary: { services: 0 } as never, scannedAt: '2026-10-15T00:00:00.000Z' } as never, at: 1 });
    });
    /* The re-read joins the one in flight; the first caller is cancelled and is told there is no chat yet. */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
      releaseFirst();
    });
    await waitFor(() => expect(store.getState().session.activeId).toBe('repo-chat'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(urls.filter((u) => u.startsWith('/api/chat-memory'))).toEqual([]);
  });
});
