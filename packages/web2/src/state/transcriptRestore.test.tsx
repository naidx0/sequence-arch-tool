import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedChatColumn, StoreProvider } from './connect';
import { createStore } from './store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * THE TRANSCRIPT COMES BACK AFTER A RELOAD.
 *
 * Rank 12 was marked done with twenty tests and was not reachable. Every piece
 * existed — `/api/chat-memory` served the stored transcript, `readChat` and
 * `writeChat` sat on the sessions client, `fromChatMemory` parsed it, and the
 * store had a `session/hydrated` arm — and NOTHING DISPATCHED IT. The twenty
 * tests covered the pieces either side of the call nobody made.
 *
 * So these assert the CALL: what goes on the wire, and what lands in the store
 * as a result. Mounted the way the app mounts it, with no props.
 */

const STORED = {
  version: 1,
  sessionId: 's1',
  turns: [
    { role: 'user', text: 'what does scan.ts do', at: '2026-08-22T10:00:00.000Z' },
    { role: 'assistant', text: 'It walks the repository.', at: '2026-08-22T10:00:04.000Z' },
  ],
};

/**
 * A store with a repository attached.
 *
 * Hydrate also runs with no repo — workspace sessions live under ~/.sequence.
 */
function attachedStore() {
  /* A PROJECTOR IS REQUIRED. `loadRepo` refuses to attach without one - "there
     is nothing grounded to draw" - and silently stays unattached, which would
     make every assertion below pass for the wrong reason. */
  const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });
  const graph = { nodes: [], edges: [], repoName: 'repo' };
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/repo',
      repoName: 'repo',
      graph,
      summary: { services: 0, files: 0, edges: 0 },
      scannedAt: new Date().toISOString(),
    },
    at: Date.now(),
  } as never);
  return store;
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const body = handler(String(url), init);
      return {
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body,
      } as unknown as Response;
    }),
  );
  return calls;
}

describe('coming back to a thread', () => {
  it('restores the stored transcript even with no repository attached', async () => {
    stubFetch((url) => (url.startsWith('/api/chat-memory') ? STORED : null));
    const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never });

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
  });

  it('RESTORES the stored transcript into the store', async () => {
    stubFetch((url) => (url.startsWith('/api/chat-memory') ? STORED : null));
    const store = attachedStore();

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
    expect(store.getState().session.turns.map((t) => t.text)).toEqual([
      'what does scan.ts do',
      'It walks the repository.',
    ]);
    /* And it is on screen, not merely in the store. */
    expect(screen.queryByTestId('chat-empty')).toBeNull();
  });

  it('does NOT hydrate over a conversation already on screen', async () => {
    /* Hydrating a live thread would duplicate the turns the reader is looking
       at. The restore is for the reload case, which is exactly the case where
       there is nothing on screen yet. */
    const calls = stubFetch((url) => (url.startsWith('/api/chat-memory') ? STORED : null));
    const store = attachedStore();
    store.dispatch({ type: 'composer/draft', text: 'live question' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'live answer' }, at: 2 });

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.url.startsWith('/api/chat-memory') && c.method === 'GET')).toBe(false);
    expect(store.getState().session.turns.some((t) => t.text === 'live answer')).toBe(true);
  });

  it('an empty stored transcript is not an error and leaves the thread empty', async () => {
    stubFetch((url) =>
      url.startsWith('/api/chat-memory') ? { version: 1, sessionId: 's1', turns: [] } : null,
    );
    const store = attachedStore();

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('chat-empty')).toBeTruthy());
    expect(store.getState().session.turns).toEqual([]);
  });
});

describe('leaving a thread', () => {
  it('WRITES the transcript back once a turn settles', async () => {
    const calls = stubFetch((url) =>
      url.startsWith('/api/chat-memory') ? { version: 1, sessionId: 's1', turns: [] } : null,
    );
    const store = attachedStore();

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    store.dispatch({ type: 'composer/draft', text: 'what does scan.ts do' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'It walks it.' }, at: 2 });
    store.dispatch({ type: 'turn/stopped', at: 3 });

    await waitFor(() => {
      const put = calls.find((c) => c.url.startsWith('/api/chat-memory') && c.method === 'PUT');
      expect(put).toBeTruthy();
      const body = put!.body as { version: number; turns: { text: string }[] };
      expect(body.version).toBe(2);
      expect(body.turns.map((t) => t.text)).toContain('what does scan.ts do');
      expect(body.turns.map((t) => t.text)).toContain('It walks it.');
    });
  });

  it('does not write a thread that is not worth persisting', async () => {
    /* `worthPersisting` exists for exactly this and had no caller: a thread
       with nothing but an unanswered question must not overwrite whatever is
       already on disk. */
    const calls = stubFetch((url) =>
      url.startsWith('/api/chat-memory') ? { version: 1, sessionId: 's1', turns: [] } : null,
    );
    const store = attachedStore();

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.url.startsWith('/api/chat-memory') && c.method === 'PUT')).toBe(false);
  });
});

describe('a repo switch re-opens the hydration doors', () => {
  it('after repo A → repo B, the old transcript is gone and chat-memory is fetched AGAIN', async () => {
    /*
     * Measured 2026-08-29: the hydrate latch was one-shot per mount, so after
     * attaching a different repository the client never asked the engine for
     * the NEW repo's stored transcript — and kept showing the old one, which
     * the reducer now clears. Both halves are asserted here: the store empties,
     * and a second /api/chat-memory call goes on the wire (the server keys it
     * by the attached root, so the second call is repo B's transcript).
     */
    const calls = stubFetch((url) => (url.startsWith('/api/chat-memory') ? STORED : null));
    const store = attachedStore();
    /* Hydration READS are the thing being latched; the transcript's own
       write-back also posts to /api/chat-memory and must not be counted. */
    const reads = () =>
      calls.filter((c) => c.url.startsWith('/api/chat-memory') && c.method === 'GET').length;

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));
    expect(reads()).toBe(1);

    /* Attach a DIFFERENT repository. */
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: '/other',
        repoName: 'other',
        graph: { nodes: [], edges: [], repoName: 'other' },
        summary: { services: 0, files: 0, edges: 0 },
        scannedAt: new Date().toISOString(),
      },
      at: Date.now(),
    } as never);

    /* The reducer half: nothing of repo A's conversation survives. */
    expect(store.getState().session.turns.length).toBe(0);

    /* The latch half: the client asks the engine again — this fetch is served
       from repo B's session store server-side. */
    await waitFor(() => {
      expect(reads()).toBe(2);
    });
  });

  it('a rescan of the SAME repo does not refetch or wipe anything', async () => {
    const calls = stubFetch((url) => (url.startsWith('/api/chat-memory') ? STORED : null));
    const store = attachedStore();
    const reads = () =>
      calls.filter((c) => c.url.startsWith('/api/chat-memory') && c.method === 'GET').length;

    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );
    await waitFor(() => expect(store.getState().session.turns.length).toBe(2));

    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: '/repo',
        repoName: 'repo',
        graph: { nodes: [], edges: [], repoName: 'repo' },
        summary: { services: 0, files: 0, edges: 0 },
        scannedAt: new Date().toISOString(),
      },
      at: Date.now(),
    } as never);

    expect(store.getState().session.turns.length).toBe(2);
    /* One hydrate READ, not two — same root, same conversation, no second ask. */
    expect(reads()).toBe(1);
  });
});
