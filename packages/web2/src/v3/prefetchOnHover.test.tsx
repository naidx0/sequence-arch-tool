import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PREFETCH_TTL_MS, prefetchGet, sharedGet } from '../api/sharedGet';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { PREFETCH_HOVER_MS, V3SessionsRail } from './V3SessionsRail';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.useRealTimers());

describe('prefetchGet', () => {
  it('the next read takes the prefetched answer, once; the one after goes to the network', async () => {
    let n = 0;
    const f = vi.fn(async () => json({ n: ++n })) as unknown as typeof fetch;
    prefetchGet('/api/sessions/a', f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await (await sharedGet('/api/sessions/a', undefined, f)).json()).toEqual({ n: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await (await sharedGet('/api/sessions/a', undefined, f)).json()).toEqual({ n: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a second hover while the answer is fresh does not fetch again; a stale one is not served', async () => {
    let n = 0;
    const f = vi.fn(async () => json({ n: ++n })) as unknown as typeof fetch;
    prefetchGet('/x', f, () => 1000);
    prefetchGet('/x', f, () => 1000);
    expect(f).toHaveBeenCalledTimes(1);
    /* sharedGet reads Date.now(); past the TTL the held answer is dropped. */
    const realNow = Date.now;
    Date.now = () => 1000 + PREFETCH_TTL_MS + 1;
    try {
      expect(await (await sharedGet('/x', undefined, f)).json()).toEqual({ n: 2 });
    } finally {
      Date.now = realNow;
    }
  });

  it('a failed prefetch is forgotten, so the real read tries for itself', async () => {
    const calls: number[] = [];
    let i = 0;
    const f = vi.fn(async () => {
      calls.push(++i);
      return i === 1 ? new Response('no', { status: 500 }) : json({ ok: true });
    }) as unknown as typeof fetch;
    prefetchGet('/y', f);
    await Promise.resolve();
    await Promise.resolve();
    expect(await (await sharedGet('/y', undefined, f)).json()).toEqual({ ok: true });
    expect(calls).toEqual([1, 2]);
  });
});

describe('a chat row under the pointer', () => {
  function mount() {
    const reads: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && (init?.method ?? 'GET') === 'GET') {
        return json({
          index: {
            version: 1,
            activeId: 'one',
            sessions: ['one', 'two'].map((id) => ({ id, title: id, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })),
          },
          scope: 'repo',
          repos: [],
        });
      }
      if (url.startsWith('/api/sessions/')) reads.push(url);
      return json({ chat: { version: 1, sessionId: 'two', turns: [] }, meta: {} });
    }) as typeof fetch;
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [], activeId: 'one' } as never);
    render(
      <StoreProvider store={store}>
        <V3SessionsRail client={createSessionsClient(f)} />
      </StoreProvider>,
    );
    return { reads };
  }

  const row = (title: string) => screen.getByText(title).closest('.v3-session') as HTMLElement;

  it('reads the chat ahead after a short rest, not while the pointer sweeps past', async () => {
    const { reads } = mount();
    await waitFor(() => expect(screen.getByText('two')).toBeTruthy());
    vi.useFakeTimers();
    fireEvent.pointerEnter(row('two'));
    act(() => vi.advanceTimersByTime(PREFETCH_HOVER_MS - 10));
    fireEvent.pointerLeave(row('two'));
    act(() => vi.advanceTimersByTime(200));
    expect(reads).toEqual([]);
    fireEvent.pointerEnter(row('two'));
    act(() => vi.advanceTimersByTime(PREFETCH_HOVER_MS + 1));
    expect(reads).toEqual(['/api/sessions/two']);
    /* The open chat is not read ahead: it is already on screen. */
    fireEvent.pointerEnter(row('one'));
    act(() => vi.advanceTimersByTime(PREFETCH_HOVER_MS + 1));
    expect(reads).toEqual(['/api/sessions/two']);
  });
});
