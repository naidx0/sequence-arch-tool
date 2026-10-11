import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * THE COMPOSER IS NEVER REMOUNTED by a tab switch or a chat switch: the same
 * field element stays in the document, so focus, caret and an IME
 * composition survive, and nothing re-runs its mount work. Checked by element
 * identity across every switch.
 */

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => vi.unstubAllGlobals());

const field = () => screen.getByTestId('composer-field');
const tab = (label: string) => screen.getAllByRole('button', { name: label }).find((b) => b.hasAttribute('data-tab-id'))!;

describe('the composer stays mounted', () => {
  it('across tab switches and chat switches', () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'a', title: 'A', pinned: false, updatedAt: '2026-01-01' }, { id: 'b', title: 'B', pinned: false, updatedAt: '2026-01-02' }], activeId: 'a' } as never);
    render(<V3App appStore={store} />);
    const first = field();
    /* Decision 49: the chat is a column, not a pill; the surfaces switch beside it. */
    for (const label of ['Files', 'Architecture', 'Whiteboard', 'Files', 'Architecture']) {
      const t = tab(label);
      expect(t, label).toBeTruthy();
      act(() => fireEvent.click(t));
      expect(field()).toBe(first);
    }
    act(() => {
      store.dispatch({ type: 'session/index', sessions: store.getState().session.sessions, activeId: 'b' } as never);
    });
    expect(field()).toBe(first);
    act(() => {
      store.dispatch({ type: 'session/browse', activeId: 'a', turns: [] } as never);
    });
    expect(field()).toBe(first);
  });
});
