import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedChatColumn, StoreProvider } from './connect';
import { createStore } from './store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const body = handler(String(url));
      return {
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body,
      } as unknown as Response;
    }),
  );
  return calls;
}

describe('active session id on boot', () => {
  it('hydrates activeId from GET /api/sessions', async () => {
    const calls = stubFetch((url) =>
      url === '/api/sessions'
        ? {
            index: {
              version: 1,
              activeId: 'session-b',
              sessions: [
                { id: 'session-a', title: 'First', mode: 'code', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' },
                { id: 'session-b', title: 'Second', mode: 'code', createdAt: '2026-08-22T01:00:00.000Z', updatedAt: '2026-08-22T01:00:00.000Z' },
              ],
            },
          }
        : url.startsWith('/api/chat-memory')
          ? { version: 1, sessionId: 'session-b', turns: [] }
          : url.startsWith('/api/canvas-doc')
            ? { version: 1, sessionId: 'session-b', blocks: [] }
            : url.startsWith('/api/ai-config')
              ? { model: '', origin: 'unconfigured' }
              : null,
    );
    const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(store.getState().session.activeId).toBe('session-b'));
    expect(calls.some((url) => url === '/api/sessions')).toBe(true);
    expect(store.getState().session.sessions.map((s) => s.id)).toEqual(['session-a', 'session-b']);
  });
});
