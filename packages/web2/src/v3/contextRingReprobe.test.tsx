import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state/store';
import { V3App } from './V3App';

/*
 * THE RING ASKS AGAIN WHEN IT DOES NOT KNOW — owner, 2026-09-22: "the context
 * window is nowhere to be seen … huge problem".
 *
 * Measured that day: the app booted while Ollama was down, the one boot probe
 * failed, and the ring stayed empty for the session although the engine
 * reported 131,072 as soon as the model was up.
 */
function aiConfigCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/ai-config')).length;
}

describe('context ring re-probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a landed turn with no window re-asks, and the ring learns it', async () => {
    /* The boot probe fails — the model server is down — and every later one
       answers, as it did once Ollama was up. */
    let modelUp = false;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/ai-config')) {
        return modelUp
          ? new Response(JSON.stringify({ contextWindow: 131072 }), { status: 200 })
          : new Response('{}', { status: 503 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = createStore();
    render(<V3App appStore={store} />);
    await waitFor(() => expect(aiConfigCalls(fetchMock)).toBeGreaterThan(0));
    expect(store.getState().composer.contextWindow).toBeNull();
    modelUp = true;

    store.dispatch({ type: 'composer/draft', text: 'hi' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'hello' }, at: 2 });

    await waitFor(() => expect(store.getState().composer.contextWindow).toBe(131072));
  });

  it('once known, a landed turn does not ask again', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/api/ai-config')
        ? new Response(JSON.stringify({ contextWindow: 65536 }), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = createStore();
    render(<V3App appStore={store} />);
    await waitFor(() => expect(store.getState().composer.contextWindow).toBe(65536));
    const before = aiConfigCalls(fetchMock);
    store.dispatch({ type: 'composer/draft', text: 'hi' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'hello' }, at: 2 });
    await new Promise((r) => setTimeout(r, 20));
    expect(aiConfigCalls(fetchMock)).toBe(before);
  });
});
