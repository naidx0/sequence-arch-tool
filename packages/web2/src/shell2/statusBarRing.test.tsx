import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvedModel } from '../agents/activeModel';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

afterEach(() => act(() => resolvedModel.set(null)));

function mount(windowTokens: number | null) {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
  store.dispatch({ type: 'composer/context-window', tokens: windowTokens });
  return render(
    <StoreProvider store={store}>
      <StatusBar />
    </StoreProvider>,
  );
}

describe('R11: the status bar is state, model icon + nickname, context ring, workspace', () => {
  it('names the model with its icon and no provider word', () => {
    mount(1_000_000);
    const bar = screen.getByTestId('s2-status');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Sonnet 5.5');
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider')).toBe('claude');
    /* The brand file carries its own <title>; the words a person reads are everything else. */
    const words = bar.cloneNode(true) as HTMLElement;
    words.querySelectorAll('svg').forEach((n) => n.remove());
    expect(words.textContent).not.toMatch(/Claude/);
    const order = ['s2-status-state', 's2-status-model', 'composer-context', 's2-status-workspace'].map((id) => bar.querySelector(`[data-testid="${id}"]`)!);
    order.forEach((el) => expect(el).not.toBeNull());
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the ring is focusable and focus opens the breakdown with input, output and cache', () => {
    mount(1_000_000);
    const ring = screen.getByTestId('composer-context');
    expect(ring.tagName).toBe('BUTTON');
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
    fireEvent.focus(ring);
    const panel = screen.getByTestId('composer-context-breakdown');
    expect(panel.textContent).toMatch(/Window holds 1M tokens/);
    expect(panel.textContent).toMatch(/Nothing sent yet/);
    expect(panel.textContent).not.toMatch(/—/);
  });

  it('with no known window the ring is a placeholder that still shows dashes on focus', () => {
    mount(null);
    const ring = screen.getByRole('button', { name: /Context window/ });
    fireEvent.focus(ring);
    const panel = screen.getByTestId('composer-context-breakdown');
    expect(panel.textContent).toMatch(/Nothing sent yet/);
    expect(panel.textContent).not.toMatch(/—/);
  });
});

describe('the branch fit observes the bar once, not once per render', () => {
  it('one ResizeObserver across re-renders, and its callback runs the fit', () => {
    const made: { cb: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    class RO {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(cb: () => void) {
        made.push({ cb, disconnect: this.disconnect });
      }
    }
    vi.stubGlobal('ResizeObserver', RO);
    try {
      const store = createStore({});
      const tree = (
        <StoreProvider store={store}>
          <StatusBar />
        </StoreProvider>
      );
      const { rerender, unmount } = render(tree);
      for (let i = 0; i < 5; i += 1) {
        act(() => {
          store.dispatch({ type: 'composer/draft', text: 'x'.repeat(i + 1) });
        });
        rerender(tree);
      }
      expect(made).toHaveLength(1);
      expect(made[0]!.disconnect).not.toHaveBeenCalled();
      unmount();
      expect(made[0]!.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the first soft-edge mark is the observer, not a forced layout in the first commit', () => {
  /* markCut reads scrollWidth on each name; a read in a layout effect forces a layout in the middle of boot. A
     ResizeObserver reports once when it starts watching, before paint, so the mount defers to it. */
  function mountCounting(withObserver: boolean) {
    const reads = vi.spyOn(Element.prototype, 'scrollWidth', 'get');
    const made: (() => void)[] = [];
    if (withObserver) {
      class RO {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(cb: () => void) {
          made.push(cb);
        }
      }
      vi.stubGlobal('ResizeObserver', RO);
    } else {
      vi.stubGlobal('ResizeObserver', undefined);
    }
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <StatusBar />
      </StoreProvider>,
    );
    return { reads, made };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mounting with an observer reads no widths until the observer reports', () => {
    const { reads, made } = mountCounting(true);
    expect(reads).not.toHaveBeenCalled();
    made[0]!();
    expect(reads).toHaveBeenCalled();
  });

  it('without an observer (jsdom, an old host) the mount still marks, as before', () => {
    const { reads } = mountCounting(false);
    expect(reads).toHaveBeenCalled();
  });
});
