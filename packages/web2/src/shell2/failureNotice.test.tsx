import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';

import { createStore, StoreProvider } from '../state';
import { V3Chat } from '../v3/V3Chat';

/* A REFUSED TURN IS NEVER SILENT (UX audit, item 1). The first message with no
   model configured came back 400 "AI provider not configured" and the chat drew
   nothing. Driven through the real send path (composer, connect, askClient)
   against a server that refuses. */

const REFUSAL = 'AI provider not configured — connect your AI key in Settings to chat';

function serverThatRefuses(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/ask/stream')) return new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
}

async function send(text: string) {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
  });
}

beforeAll(preloadChatLazies, 120_000);
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('a refused turn shows the reason and the way out', () => {
  it('no model configured: one "Connect a model to run this" card that opens the connect flow in place (P0-4)', async () => {
    serverThatRefuses({ error: REFUSAL, fix: 'provider' });
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    await send('hello');
    const card = await screen.findByTestId('connect-to-run');
    expect(card.textContent).toContain('Connect a model to run this');
    /* Not the dead-end banner: no server sentence, no trip to Settings. */
    expect(screen.queryByTestId('s2-failure')).toBeNull();
    expect(card.textContent).not.toContain(REFUSAL);
    fireEvent.click(screen.getByTestId('connect-to-run-open'));
    expect(await screen.findByTestId('connect-in-place')).toBeTruthy();
    expect(store.getState().shell.overlay).toBeNull();
    fireEvent.click(screen.getByTestId('s2-failure-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('connect-to-run')).toBeNull());
  });

  it('any other refusal says the server sentence and offers Retry, never nothing', async () => {
    serverThatRefuses({ error: 'no repo attached — open a repository from the home screen first' });
    render(
      <StoreProvider store={createStore({})}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    await send('hello');
    expect((await screen.findByTestId('s2-failure-text')).textContent).toBe('no repo attached — open a repository from the home screen first');
    expect(screen.queryByTestId('s2-failure-connect')).toBeNull();
    expect(screen.getByTestId('s2-failure-retry')).toBeTruthy();
  });
});
