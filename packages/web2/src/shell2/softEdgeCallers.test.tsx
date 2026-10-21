import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { SOFT_EDGE_SELECTOR } from './softEdge';
import shellSrc from './Shell2.tsx?raw';
import menuSrc from './ModelMenu.tsx?raw';
import statusSrc from './StatusBar.tsx?raw';

/* 0.1.8.4 perf: a chat switch resizes the top bar, the status bar and the model label together. Each used to measure
   and mark its names on its own (read, write, read, write: a layout per caller). They now queue, and one animation
   frame reads every name before it writes any. The probe logs soft-edge reads and data-cut writes in order. */

const MODEL_LABEL = '[data-testid="v3-model-label"]';
const isName = (el: Element) => el.matches(`${SOFT_EDGE_SELECTOR}, ${MODEL_LABEL}`);

describe('soft-edge callers share one frame', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a resize of the bars marks nothing synchronously; one frame reads every name, then writes', () => {
    const observers: ((entries: unknown[]) => void)[] = [];
    class RO {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: (entries: unknown[]) => void) {
        observers.push(cb);
      }
    }
    vi.stubGlobal('ResizeObserver', RO);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    const log: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (isName(this)) log.push('read');
      return 220;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 100);
    const set = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, k: string, v: string) {
      if (k === 'data-cut') log.push('write');
      return set.call(this, k, v);
    });

    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'a', title: 'A', pinned: false, updatedAt: '2026-01-01' }], activeId: 'a' } as never);
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('v3-model-label')).toBeTruthy();

    /* The switch: every observer reports and the window resizes; queued frames from boot are drained first. */
    act(() => {
      for (let i = 0; i < 5 && frames.length; i++) frames.splice(0).forEach((f) => f(0));
    });
    log.length = 0;
    act(() => {
      observers.forEach((cb) => cb([]));
      window.dispatchEvent(new Event('resize'));
    });
    expect(log).toEqual([]); /* nothing measured or written before the frame */

    act(() => {
      const pending = frames.splice(0);
      pending.forEach((f) => f(0));
    });
    const reads = log.filter((x) => x === 'read').length;
    const writes = log.filter((x) => x === 'write').length;
    expect(reads).toBeGreaterThan(0);
    expect(writes).toBeGreaterThan(0);
    expect(log.lastIndexOf('read')).toBeLessThan(log.indexOf('write'));
  });

  it('the three callers go through queueMarkCut; only the first paint of the status bar stays synchronous', () => {
    expect(shellSrc).toMatch(/queueMarkCut\(topb\)/);
    expect(shellSrc).not.toMatch(/[^e]markCut\(topb\)/);
    expect(menuSrc).toMatch(/queueMarkCut\(el\.parentElement \?\? el,/);
    expect(statusSrc).toMatch(/new ResizeObserver\(\(\) => \{\s*fitBranch\(bar\);\s*queueMarkCut\(bar\);/);
    expect(statusSrc).toMatch(/[^e]markCut\(bar\);\s*\}, \[branch/);
  });
});
