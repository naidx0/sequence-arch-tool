import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sharedGet } from '../api/sharedGet';
import { ConnectedChatColumn, StoreProvider } from './connect';
import { createStore } from './store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/*
 * THE ACTIVE TRANSCRIPT IS FETCHED ONCE AT BOOT.
 *
 * Measured on a seeded 500-turn chat: `/api/chat-memory` and `/api/sessions/<id>` were both fetched and parsed,
 * 337 KB each, for the same stored chat (the thread read carries it as `chat`). The restore now reads the thread
 * through `sharedGet`, so it shares the request the canvas doc channel makes for the same URL.
 */
const STORED = {
  version: 1,
  sessionId: 's1',
  turns: [
    { role: 'user', text: 'what does scan.ts do', at: '2026-08-22T10:00:00.000Z' },
    { role: 'assistant', text: 'It walks the repository.', at: '2026-08-22T10:00:04.000Z' },
  ],
};
const THREAD = { id: 's1', title: 's1', createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z' };

function stub(sessionBody: unknown = { chat: STORED, boardSeqd: '' }) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? 'GET') === 'GET') urls.push(u);
      /* The thread read is big on a long chat: it is in flight for a while, which is when the readers meet. */
      if (u === '/api/sessions/s1') await new Promise((r) => setTimeout(r, 30));
      let body: unknown = null;
      if (u === '/api/sessions') body = { index: { sessions: [THREAD], activeId: 's1' } };
      else if (u === '/api/sessions/s1') body = sessionBody;
      else if (u.startsWith('/api/chat-memory')) body = STORED;
      return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body, clone() { return this; } } as unknown as Response;
    }),
  );
  return urls;
}

function mount() {
  const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
  render(
    <StoreProvider store={store}>
      <ConnectedChatColumn />
    </StoreProvider>,
  );
  return store;
}

describe('boot reads the active transcript once', () => {
  it('restores the turns from the thread read and never asks /api/chat-memory', async () => {
    const urls = stub();
    const store = mount();
    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
    expect(urls.filter((u) => u.startsWith('/api/chat-memory'))).toEqual([]);
    expect(urls.filter((u) => u === '/api/sessions/s1')).toHaveLength(1);
  });

  it('shares the thread read with the canvas doc channel: two readers, one request', async () => {
    const urls = stub();
    const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
    /* The canvas doc channel reads this URL the moment the thread is known. */
    let doc: Promise<Response> | null = null;
    store.subscribe(() => {
      if (doc === null && store.getState().session.activeId === 's1') doc = sharedGet('/api/sessions/s1');
    });
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );
    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
    expect(doc).not.toBeNull();
    expect(urls.filter((u) => u === '/api/sessions/s1')).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('/api/chat-memory'))).toHaveLength(0);
  });

  it('falls back to /api/chat-memory when the thread read has no chat', async () => {
    const urls = stub({ boardSeqd: '' });
    const store = mount();
    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
    expect(urls.filter((u) => u.startsWith('/api/chat-memory'))).toHaveLength(1);
  });
});
