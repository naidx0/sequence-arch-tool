import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { TRANSCRIPT_BAR_MS, USER_SCROLL_MS } from './Shell2';
import css from './shell2.css?raw';

/* 0.1.6 B4 item 3: the chat transcript's scrollbar is an overlay. The thumb itself is a browser matter
   (e2e/b4-chat-scrollbar.mjs); this locks the cue the shell writes and the rules that read it. */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('data-platform', 'win');
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the transcript scrollbar cue', () => {
  const scroll = (t: Element) =>
    act(() => {
      t.dispatchEvent(new Event('scroll'));
    });
  const mount = () => {
    render(<V3App appStore={freshStore()} />);
    const t = document.querySelector<HTMLElement>('.v3-transcript')!;
    expect(t).not.toBeNull();
    return t;
  };

  it('a scroll nobody asked for (an answer streaming in sticks to the bottom) never marks the transcript', () => {
    vi.useFakeTimers();
    const t = mount();
    scroll(t);
    scroll(t);
    expect(t.hasAttribute('data-scrolling')).toBe(false);
  });

  it('a wheel over the transcript arms the cue; it clears once the scrolling stops', () => {
    vi.useFakeTimers();
    const t = mount();
    act(() => {
      t.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    scroll(t);
    expect(t.hasAttribute('data-scrolling')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(TRANSCRIPT_BAR_MS - 50);
      t.dispatchEvent(new Event('wheel', { bubbles: true }));
      scroll(t);
      vi.advanceTimersByTime(TRANSCRIPT_BAR_MS - 50);
    });
    expect(t.hasAttribute('data-scrolling')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(t.hasAttribute('data-scrolling')).toBe(false);
  });

  it('the arming runs out: a stream that scrolls after the reader let go stays hidden', () => {
    vi.useFakeTimers();
    const t = mount();
    act(() => {
      t.dispatchEvent(new Event('wheel', { bubbles: true }));
      vi.advanceTimersByTime(USER_SCROLL_MS + 50);
    });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + USER_SCROLL_MS + 50);
    scroll(t);
    expect(t.hasAttribute('data-scrolling')).toBe(false);
  });

  it('a scroll key, a press on the transcript (its thumb) and a touch arm it too; a key typed in the composer does not', () => {
    vi.useFakeTimers();
    const t = mount();
    let clock = 0;
    const marked = (fire: () => void) => {
      clock += 10_000_000;
      t.removeAttribute('data-scrolling');
      vi.spyOn(performance, 'now').mockReturnValue(clock);
      act(fire);
      vi.spyOn(performance, 'now').mockReturnValue(clock + 100);
      scroll(t);
      return t.hasAttribute('data-scrolling');
    };
    expect(marked(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })))).toBe(true);
    expect(marked(() => t.dispatchEvent(new Event('pointerdown', { bubbles: true })))).toBe(true);
    act(() => {
      t.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(marked(() => t.dispatchEvent(new Event('touchstart', { bubbles: true })))).toBe(true);
    act(() => {
      t.dispatchEvent(new Event('touchend', { bubbles: true }));
    });
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    expect(marked(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))).toBe(false);
  });

  it('only a transcript scroller is marked, not any scroller in the app', () => {
    mount();
    const other = document.createElement('div');
    document.body.appendChild(other);
    act(() => {
      other.dispatchEvent(new Event('wheel', { bubbles: true }));
      other.dispatchEvent(new Event('scroll'));
    });
    expect(other.hasAttribute('data-scrolling')).toBe(false);
  });

  it('does not rewrite the attribute on every event while it is already showing', () => {
    vi.useFakeTimers();
    const t = mount();
    act(() => {
      t.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    scroll(t);
    const spy = vi.spyOn(t, 'setAttribute');
    for (let i = 0; i < 20; i += 1) scroll(t);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the rules that read it', () => {
  it('hide the thumb at rest, show it while scrolling or hovered, and keep the gutter out of the messages', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/\.v3-transcript:not\(\.is-virtual\)::-webkit-scrollbar-thumb, \.s2 \.v3-transcript-wrap \.v3-vlist::-webkit-scrollbar-thumb \{ background: transparent; \}/);
    expect(flat).toMatch(/\.v3-transcript\[data-scrolling\]::-webkit-scrollbar-thumb/);
    expect(flat).toMatch(/\.v3-transcript-wrap:hover \.v3-transcript:not\(\.is-virtual\)::-webkit-scrollbar-thumb/);
    expect(flat).toMatch(/scrollbar-gutter: stable;/);
    /* Chat only: the same subtraction, in selectors as specific as the reading-column rule they sit beside. */
    expect(flat).toMatch(/\.s2-row\[data-stage='none'\] > \.s2-chat \.v3-transcript-wrap \.v3-transcript:not\(\.is-virtual\) \{ padding-right: calc\(max\(var\(--sp-24\), calc\(\(100% - var\(--chat-read-w\)\) \/ 2\)\) - var\(--scrollbar-size\)\);/);
    expect(flat).toMatch(/\.s2-row\[data-stage='none'\] > \.s2-chat \.v3-transcript-wrap \.v3-vrow \{ padding-left:/);
    /* Never the standard properties: Chromium would drop the webkit bar for the native one. */
    expect(flat.indexOf('.v3-vlist { scrollbar-gutter: stable')).toBeGreaterThan(0);
    const block = flat.slice(flat.indexOf('.s2 .v3-transcript-wrap .v3-transcript:not(.is-virtual), .s2 .v3-transcript-wrap .v3-vlist { scrollbar-gutter'));
    expect(block).not.toMatch(/scrollbar-width|scrollbar-color/);
  });
});
