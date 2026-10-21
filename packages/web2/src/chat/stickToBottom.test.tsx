import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStickToBottom } from './stickToBottom';
import { HOLD_EVENT } from './transcriptNav';

/* The scroller shrinks (the window or pane resized) with no scroll and no new
   content: a chat that was following the end goes on showing it. Found in the
   1024 px shot, where the last reply sat 132 px under the fold. */

afterEach(() => vi.unstubAllGlobals());

describe('stick to the end across a resize', () => {
  it('a following scroller is put back at the end when it changes size; one the reader left is not', async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe() {
          observers.push(() => this.cb());
        }
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 1;
    });
    const el = document.createElement('div');
    let top = 0;
    let client = 600;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 2000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => client });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = Math.min(v, 2000 - client)) });
    document.body.appendChild(el);
    function Probe() {
      useStickToBottom(el);
      return null;
    }
    render(<Probe />);
    expect(top).toBe(1400);
    /* Shrinks: 1400 is now 132 px short of the end. The browser may fire a
       scroll for it first; nobody moved up, so the chat still follows. */
    client = 468;
    el.dispatchEvent(new Event('scroll'));
    await act(async () => observers.forEach((f) => f()));
    expect(top).toBe(2000 - 468);
    /* The reader scrolls up; a resize does not move them. */
    top = 900;
    el.dispatchEvent(new Event('scroll'));
    client = 600;
    await act(async () => observers.forEach((f) => f()));
    expect(top).toBe(900);
    el.remove();
  });
});

describe('"Jump to latest" is away from the end, not merely not following', () => {
  it('a held card in a transcript that ends in view shows no jump; scrolled up past 40 px shows it', () => {
    const el = document.createElement('div');
    let top = 0;
    let height = 500;
    const client = 600;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => client });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, height - client))) });
    document.body.appendChild(el);
    let seen: { following: boolean; away: boolean } = { following: true, away: false };
    function Probe() {
      const s = useStickToBottom(el);
      seen = { following: s.following, away: s.away };
      return null;
    }
    render(<Probe />);
    /* The reader opens a card: following stops, but the short chat is at its end. */
    act(() => {
      el.dispatchEvent(new Event(HOLD_EVENT));
    });
    expect(seen).toEqual({ following: false, away: false });
    /* A long chat, the reader 300 px up from the end: now there is somewhere to jump. */
    height = 2000;
    top = 1100;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    expect(seen).toEqual({ following: false, away: true });
    el.remove();
  });
});
