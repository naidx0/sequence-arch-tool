import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from './index';
import { StoreProvider, useAppSelector, useAppState, useAppStateLive } from './connect';
import { createSelectorSnapshot, shallowEqual } from './selectors';

function mount(ui: () => unknown) {
  const store = createStore({});
  const Probe = () => {
    ui();
    return null;
  };
  render(
    <StoreProvider store={store}>
      <Probe />
    </StoreProvider>,
  );
  return store;
}

describe('createSelectorSnapshot', () => {
  it('runs the selector once per state and keeps an equal result by identity', () => {
    const store = createStore({});
    const select = vi.fn((s: ReturnType<typeof store.getState>) => ({ id: s.session.activeId }));
    const snap = createSelectorSnapshot(store.getState, select, shallowEqual);
    const a = snap();
    expect(snap()).toBe(a);
    expect(select).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'composer/draft', text: 'x' });
    expect(snap()).toBe(a);
    expect(select).toHaveBeenCalledTimes(2);
    store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 't', pinned: false, updatedAt: '2026-01-01' }], activeId: 's1' } as never);
    expect(snap()).not.toBe(a);
    expect(snap().id).toBe('s1');
  });

  it('a selector that builds a fresh object each call does not loop (no isEqual: one snapshot per state)', () => {
    const store = createStore({});
    const snap = createSelectorSnapshot(store.getState, (s) => ({ n: s.session.turns.length }));
    expect(snap()).toBe(snap());
  });
});

describe('useAppSelector', () => {
  it('an inline selector returning a fresh object does not loop and renders once', () => {
    let renders = 0;
    mount(() => {
      renders += 1;
      return useAppSelector((s) => ({ active: s.session.activeId }), shallowEqual);
    });
    expect(renders).toBe(1);
  });

  it('wakes the reader only when the selected value changes', () => {
    let renders = 0;
    let seen: unknown;
    const store = mount(() => {
      renders += 1;
      seen = useAppSelector((s) => s.session.activeId);
    });
    expect(renders).toBe(1);
    act(() => store.dispatch({ type: 'composer/draft', text: 'hello' }));
    expect(renders).toBe(1);
    act(() => store.dispatch({ type: 'session/index', sessions: [{ id: 's9', title: 't', pinned: false, updatedAt: '2026-01-01' }], activeId: 's9' } as never));
    expect(renders).toBe(2);
    expect(seen).toBe('s9');
  });
});

describe('useAppState holds the draft out; useAppStateLive does not', () => {
  it('does not re-render on a draft change, does on anything else, and never shows the draft', () => {
    let renders = 0;
    let state: ReturnType<typeof useAppState> | undefined;
    const store = mount(() => {
      renders += 1;
      state = useAppState();
    });
    expect(renders).toBe(1);
    for (const text of ['a', 'ab', 'abc']) act(() => store.dispatch({ type: 'composer/draft', text }));
    expect(renders).toBe(1);
    expect(state?.composer.draft).toBe('');
    act(() => store.dispatch({ type: 'composer/model', model: { ...store.getState().composer.model, model: 'm-2' } } as never));
    expect(renders).toBe(2);
  });
});

describe('useAppStateLive', () => {
  it('re-renders on every draft change and shows the draft', () => {
    let renders = 0;
    let draft = '';
    const store = mount(() => {
      renders += 1;
      draft = useAppStateLive().composer.draft;
    });
    for (const text of ['a', 'ab', 'abc']) act(() => store.dispatch({ type: 'composer/draft', text }));
    expect(renders).toBe(4);
    expect(draft).toBe('abc');
  });
});
