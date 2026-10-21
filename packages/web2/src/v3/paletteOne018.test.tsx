import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCommandPalette } from '../shell/paletteEvent';
import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
import { V3App } from './V3App';
import { V3CommandPalette } from './V3CommandPalette';

/*
 * 0.1.8 G10 (owner: Ctrl+K "opens differently" from the bottom-left button). The frames mount the palette more than once
 * (Shell2, V3Shell); every mount used to listen, so one chord could open two palettes or toggle one shut. One keydown, one
 * palette; the button and the chord reach the same one.
 */
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

/* React's useId differs per open; nothing else may. */
const shape = () => screen.getByTestId('command-surface').outerHTML.replace(/:r\d+:/g, ':r:');
const surfaces = () => document.querySelectorAll('[data-testid="command-surface"]').length;

describe('one palette for every entry (G10)', () => {
  it('two mounts: one keydown opens exactly one palette, the next shuts it', () => {
    render(
      <StoreProvider store={createStore({})}>
        <V3CommandPalette />
        <V3CommandPalette />
      </StoreProvider>,
    );
    expect(surfaces()).toBe(0);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(surfaces()).toBe(1);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(surfaces()).toBe(0);
  });

  it('two mounts: the button door (openCommandPalette) opens exactly one palette', () => {
    render(
      <StoreProvider store={createStore({})}>
        <V3CommandPalette />
        <V3CommandPalette />
      </StoreProvider>,
    );
    act(() => openCommandPalette());
    expect(surfaces()).toBe(1);
  });

  it('when the leading mount goes, the other one takes the chord over', () => {
    const tree = (first: boolean) => (
      <StoreProvider store={store}>
        {first ? <V3CommandPalette key="a" /> : null}
        <V3CommandPalette key="b" />
      </StoreProvider>
    );
    const store = createStore({});
    const { rerender } = render(tree(true));
    rerender(tree(false));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(surfaces()).toBe(1);
  });

  it('in the shell: the chord and the bottom-left Commands button open the same single palette', () => {
    render(<V3App appStore={createStore({})} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(surfaces()).toBe(1);
    const viaKey = shape();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(surfaces()).toBe(0);
    fireEvent.click(screen.getByTestId('s2-rail-commands'));
    expect(surfaces()).toBe(1);
    expect(shape()).toBe(viaKey);
  });
});
