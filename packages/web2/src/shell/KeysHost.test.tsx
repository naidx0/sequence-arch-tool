import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider, type Store } from '../state';
import { cycleChat } from './chatCycle';
import { KeysHost, keyTargetOf, loadKeysHelp } from './KeysHost';
import { SHORTCUTS } from './shortcuts';

/*
 * S5 KEYS, mounted. The sessions wire is a stubbed fetch; the store is real.
 * Each case presses a key on window (or on a field) and reads what the page
 * did: a POST for a new chat, the active chat for Ctrl+Tab, the help for
 * Ctrl+/. Nothing sleeps: waitFor polls the DOM the lazy help renders into.
 */

const entry = (id: string, updatedAt: string, pinned = false) => ({ id, title: id, createdAt: updatedAt, updatedAt, pinned });

let posts: string[] = [];

/* The help is a lazy chunk. Await its own load promise, so the test waits on
   that and on React, never on the clock (it flaked under full-suite load). */
beforeAll(async () => {
  await loadKeysHelp();
});

beforeEach(() => {
  posts = [];
  vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') posts.push(url);
      if (url === '/api/sessions' && method === 'POST') {
        return new Response(
          JSON.stringify({
            index: { version: 1, activeId: 'minted', sessions: [entry('minted', '2026-10-06T10:00:00Z')] },
            session: { id: 'minted', chat: { version: 1, sessionId: 'minted', turns: [] }, meta: {} },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [entry('a', '2026-10-06T09:00:00Z'), entry('b', '2026-10-06T08:00:00Z'), entry('c', '2026-10-06T07:00:00Z')],
    activeId: 'a',
  });
  render(
    <StoreProvider store={store}>
      <KeysHost />
      <input data-testid="other-field" />
      <textarea data-testid="composer-field" />
    </StoreProvider>,
  );
  return store;
}

describe('chatCycle: rail order, wrapping', () => {
  it('pinned first, then newest; wraps both ways; nothing when alone', () => {
    const list = [entry('old', '2026-01-01'), entry('new', '2026-02-01'), entry('pin', '2025-01-01', true)];
    expect(cycleChat(list, 'pin', 1)).toBe('new');
    expect(cycleChat(list, 'old', 1)).toBe('pin');
    expect(cycleChat(list, 'pin', -1)).toBe('old');
    expect(cycleChat([entry('x', '1')], 'x', 1)).toBeNull();
  });
});

describe('keyTargetOf', () => {
  it('the composer, another field, or neither', () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'composer-field');
    expect(keyTargetOf(ta)).toBe('composer');
    expect(keyTargetOf(document.createElement('input'))).toBe('text');
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(keyTargetOf(box)).toBe('other');
    expect(keyTargetOf(document.body)).toBe('other');
  });
});

describe('KeysHost', () => {
  it('from the first frame: the very first Ctrl+Tab takes effect once and its default is cancelled on the original event', async () => {
    const store = mount();
    /* fireEvent returns false when a handler called preventDefault. */
    expect(fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(store.getState().session.activeId).toBe('b'));
    expect(fireEvent.keyDown(window, { key: 'n', ctrlKey: true })).toBe(false);
    /* A key that is not ours keeps its default (Ctrl+B is ours now: the sidebar, Decision 49). */
    expect(fireEvent.keyDown(window, { key: 'j', ctrlKey: true })).toBe(true);
  });

  it('Ctrl+N starts a new chat (the same POST the rail\'s New chat sends)', async () => {
    mount();
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    await waitFor(() => expect(posts).toContain('/api/sessions'));
  });

  it('Ctrl+Tab opens the next chat in rail order, Ctrl+Shift+Tab the previous', async () => {
    const store = mount();
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(store.getState().session.activeId).toBe('b'));
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(store.getState().session.activeId).toBe('a'));
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(store.getState().session.activeId).toBe('c'));
  });

  it('Ctrl+/ opens the keys help listing EVERY shortcut in the table, and Escape closes it', async () => {
    mount();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    /* The chunk is loaded; one flush settles React.lazy's resolved promise. */
    await act(async () => {
      await loadKeysHelp();
    });
    const help = screen.getByTestId('keys-help');
    expect(help.getAttribute('role')).toBe('dialog');
    const listed = [...help.querySelectorAll('[data-shortcut]')].map((r) => r.getAttribute('data-shortcut'));
    expect(listed.sort()).toEqual(SHORTCUTS.map((s) => s.id).sort());
    expect(help.textContent).toContain('Ctrl+N');
    expect(help.textContent).toContain('Shift+Tab');
    /* Escape closes synchronously (a state set inside fireEvent's act). */
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('keys-help')).toBeNull();
  });

  it('no key fires while another text field has focus; from the composer the page keys still do', async () => {
    const store = mount();
    fireEvent.keyDown(screen.getByTestId('other-field'), { key: 'Tab', ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId('other-field'), { key: '/', ctrlKey: true });
    expect(store.getState().session.activeId).toBe('a');
    expect(screen.queryByTestId('keys-help')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('composer-field'), { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(store.getState().session.activeId).toBe('b'));
  });
});
