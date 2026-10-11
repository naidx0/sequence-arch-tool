import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { takeStaticComposer } from './staticHandoff';

/* The prerendered shell's composer, as index.html carries it. */
function plantStaticShell(text: string, caret: number, opts: { pendingSend?: boolean; focus?: boolean } = {}) {
  const shell = document.createElement('div');
  shell.id = 'static-shell';
  if (opts.pendingSend) shell.setAttribute('data-pending-send', '1');
  const field = document.createElement('textarea');
  field.setAttribute('data-testid', 'composer-field');
  shell.appendChild(field);
  document.body.appendChild(shell);
  field.value = text;
  if (opts.focus !== false) field.focus();
  field.setSelectionRange(caret, caret);
  return shell;
}

afterEach(() => {
  document.getElementById('static-shell')?.remove();
  vi.unstubAllGlobals();
});

describe('takeStaticComposer', () => {
  it('reads text, caret, focus and a pending send, and removes the shell', () => {
    plantStaticShell('hello there', 5, { pendingSend: true });
    expect(takeStaticComposer()).toEqual({ text: 'hello there', selectionStart: 5, selectionEnd: 5, focused: true, pendingSend: true });
    expect(document.getElementById('static-shell')).toBeNull();
    expect(takeStaticComposer()).toBeNull();
  });
});

describe('the handoff into React', () => {
  it('the typed text, caret and focus land in React\'s field before paint, and later keys follow', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    plantStaticShell('what calls orders', 10);
    const store = createStore({});
    render(<V3App appStore={store} />);
    const field = screen.getAllByTestId('composer-field').find((el) => !el.closest('#static-shell')) as HTMLTextAreaElement;
    expect(document.getElementById('static-shell')).toBeNull();
    expect(store.getState().composer.draft).toBe('what calls orders');
    expect(field.value).toBe('what calls orders');
    expect([field.selectionStart, field.selectionEnd]).toEqual([10, 10]);
    expect(document.activeElement).toBe(field);
    /* The session index arriving at boot keeps the words (activeId was null). */
    act(() => {
      store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 'One', pinned: false, updatedAt: '2026-01-01' }], activeId: 's1' } as never);
    });
    expect(store.getState().composer.draft).toBe('what calls orders');
  });

  it('a Send pressed in the static composer is carried out once React is up', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    plantStaticShell('explain the gateway', 19, { pendingSend: true });
    const store = createStore({});
    render(<V3App appStore={store} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(JSON.stringify(store.getState().session)).toMatch(/explain the gateway/);
    expect(store.getState().composer.draft).toBe('');
  });

  it('a switch between two real chats still restores only the target\'s own words', () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [], activeId: 'a' } as never);
    store.dispatch({ type: 'composer/draft', text: 'for a' });
    store.dispatch({ type: 'session/index', sessions: [], activeId: 'b' } as never);
    expect(store.getState().composer.draft).toBe('');
    store.dispatch({ type: 'session/index', sessions: [], activeId: 'a' } as never);
    expect(store.getState().composer.draft).toBe('for a');
  });
});
