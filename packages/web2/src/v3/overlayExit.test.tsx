import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
import { V3OverlayHost } from './V3OverlayHost';

/* Decision 52: an overlay leaves as it arrives. Closing keeps it on the page as data-state='closing' for its exit,
   then unmounts; where nothing animates it goes at once. A touch drag on the sheet's grabber closes it through
   that same exit. */

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
beforeAll(() => vi.stubGlobal('PointerEvent', FakePointerEvent));
afterEach(() => {
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
});

function mount() {
  const store = createStore({});
  store.dispatch({ type: 'shell/overlay', overlay: { kind: 'sessions' } } as never);
  render(
    <StoreProvider store={store}>
      <V3OverlayHost />
    </StoreProvider>,
  );
  return store;
}
const animates = () => {
  (Element.prototype as { getAnimations?: unknown }).getAnimations = () => [];
};
const scrim = () => document.querySelector<HTMLElement>('.v3-overlay-scrim');

describe('V3OverlayHost exit', () => {
  it('closing keeps the overlay as data-state=closing, inert and hidden, until its exit ends', async () => {
    animates();
    const store = mount();
    expect(scrim()).not.toBeNull();
    expect(scrim()!.hasAttribute('data-state')).toBe(false);
    act(() => store.dispatch({ type: 'shell/overlay', overlay: null } as never));
    expect(scrim()).not.toBeNull();
    expect(scrim()!.getAttribute('data-state')).toBe('closing');
    expect(scrim()!.getAttribute('aria-hidden')).toBe('true');
    expect(scrim()!.hasAttribute('inert')).toBe(true);
    fireEvent.animationEnd(scrim()!);
    await waitFor(() => expect(scrim()).toBeNull());
  });

  it('Escape closes through the same exit', async () => {
    animates();
    mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(scrim()!.getAttribute('data-state')).toBe('closing');
    fireEvent.animationEnd(scrim()!);
    await waitFor(() => expect(scrim()).toBeNull());
  });

  it('where nothing animates (a test DOM, reduced motion) it unmounts at once, as before', () => {
    const store = mount();
    act(() => store.dispatch({ type: 'shell/overlay', overlay: null } as never));
    expect(scrim()).toBeNull();
  });

  it('opening again during the exit brings it back without the closing state', () => {
    animates();
    const store = mount();
    act(() => store.dispatch({ type: 'shell/overlay', overlay: null } as never));
    act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'sessions' } } as never));
    expect(scrim()!.hasAttribute('data-state')).toBe(false);
    expect(scrim()!.hasAttribute('inert')).toBe(false);
  });
});

describe('V3OverlayHost swipe to close', () => {
  const touch = (target: Element, type: string, y: number) =>
    fireEvent(target, new FakePointerEvent(type, { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: 60, clientY: y }));

  it('a touch drag down the grabber past the distance closes the overlay through its exit, marked swiped', () => {
    animates();
    const store = mount();
    const grab = screen.getByTestId('v3-overlay-grab');
    const panel = screen.getByTestId('v3-overlay-sessions');
    touch(grab, 'pointerdown', 100);
    touch(grab, 'pointermove', 140);
    expect(panel.style.transform).toBe('translateY(40px)');
    touch(grab, 'pointermove', 260);
    touch(grab, 'pointerup', 260);
    expect(store.getState().shell.overlay).toBeNull();
    expect(scrim()!.getAttribute('data-state')).toBe('closing');
    expect(panel.getAttribute('data-swiped')).toBe('y');
  });

  it('a short drag springs back and the overlay stays', () => {
    animates();
    const store = mount();
    const grab = screen.getByTestId('v3-overlay-grab');
    const panel = screen.getByTestId('v3-overlay-sessions');
    touch(grab, 'pointerdown', 100);
    touch(grab, 'pointermove', 112);
    touch(grab, 'pointerup', 112);
    expect(store.getState().shell.overlay).not.toBeNull();
    expect(panel.style.transform).toBe('');
    expect(scrim()!.hasAttribute('data-state')).toBe(false);
  });
});
