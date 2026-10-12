import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('a refused turn shows the reason and the way out', () => {
  it('no model configured: a notice with Connect an agent and Add a model', async () => {
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
    const notice = await screen.findByTestId('s2-failure');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.getAttribute('data-fix')).toBe('provider');
    expect(screen.getByTestId('s2-failure-text').textContent).toContain(REFUSAL);
    fireEvent.click(screen.getByTestId('s2-failure-model'));
    expect(store.getState().shell.overlay).toMatchObject({ kind: 'settings', pane: 'provider' });
    fireEvent.click(screen.getByTestId('s2-failure-connect'));
    await waitFor(() => expect(screen.getByTestId('s2-model-menu')).toBeTruthy());
    fireEvent.click(screen.getByTestId('s2-failure-dismiss'));
    expect(screen.queryByTestId('s2-failure')).toBeNull();
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
