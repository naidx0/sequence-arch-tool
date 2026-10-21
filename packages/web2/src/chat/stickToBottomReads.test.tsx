import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStickToBottom } from './stickToBottom';

/*
 * THE FOLLOW OBSERVER COSTS NOTHING PER MUTATION (perf 0.1.8.4, profile cost #3).
 *
 * It watched `attributes` (style) across the whole subtree, so every style write anywhere in the transcript woke it,
 * and it measured the scroller. It now watches children and text only, queues ONE animation frame however many
 * mutations arrive, and does every layout read (scrollHeight, clientHeight, scrollTop) inside that frame.
 */

afterEach(() => vi.unstubAllGlobals());

function rig() {
  const observed: { target: Node; options: MutationObserverInit }[] = [];
  let mutate: () => void = () => {};
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(cb: () => void) {
        mutate = cb;
      }
      observe(target: Node, options: MutationObserverInit) {
        observed.push({ target, options });
      }
      disconnect() {}
    },
  );
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const el = document.createElement('div');
  const reads: string[] = [];
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => (reads.push('scrollHeight'), 2000) });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => (reads.push('clientHeight'), 600) });
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => (reads.push('scrollTop'), top),
    set: (v: number) => {
      top = v;
    },
  });
  document.body.appendChild(el);
  function Probe() {
    useStickToBottom(el);
    return null;
  }
  render(<Probe />);
  return { observed, mutate: () => mutate(), frames, reads, el };
}

describe('the follow observer', () => {
  it('watches children and text, never attributes', () => {
    const { observed, el } = rig();
    expect(observed).toHaveLength(1);
    expect(observed[0]!.target).toBe(el);
    expect(observed[0]!.options.childList).toBe(true);
    expect(observed[0]!.options.subtree).toBe(true);
    expect(observed[0]!.options.characterData).toBe(true);
    expect(observed[0]!.options.attributes).toBeFalsy();
    expect(observed[0]!.options.attributeFilter).toBeUndefined();
    el.remove();
  });

  it('reads layout only inside one batched animation frame, however many mutations arrive', () => {
    const { mutate, frames, reads, el } = rig();
    frames.length = 0;
    reads.length = 0;
    for (let i = 0; i < 200; i++) mutate();
    expect(reads).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    expect(reads.length).toBeGreaterThan(0);
    // The next burst queues a fresh frame, again one.
    frames.length = 0;
    reads.length = 0;
    for (let i = 0; i < 50; i++) mutate();
    expect(reads).toEqual([]);
    expect(frames).toHaveLength(1);
    el.remove();
  });
});
