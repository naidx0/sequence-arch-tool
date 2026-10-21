import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsciiStage, resetBackdropCache, whenIdleOrInput } from './AsciiStage';

/*
 * 0.1.8.4 P3: the backdrop mosaic is 171 ms of the main thread in the first second after boot. It is drawn at the
 * first input or idle moment, not before, and a render with the same inputs copies the finished picture instead.
 * The probe counts getImageData: the mosaic reads its per-cell colours exactly once per draw.
 */

describe('the backdrop draws off the critical path', () => {
  let idle: (() => void)[];
  let raf: (() => void)[];
  let reads: number;

  beforeEach(() => {
    resetBackdropCache();
    idle = [];
    raf = [];
    reads = 0;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
    vi.stubGlobal('cancelIdleCallback', () => {});
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => raf.push(cb));
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 960;
        naturalHeight = 600;
        complete = true;
        decoding = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => { reads += 1; return { data: new Uint8ClampedArray(w * h * 4) }; };
          return () => {};
        },
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); });

  it('makes no draw call before the first idle moment, then draws once', async () => {
    render(<AsciiStage mode="behind-chat" />);
    await flush();
    for (const f of raf.splice(0)) f();
    await flush();
    expect(reads).toBe(0);
    expect(idle.length).toBeGreaterThan(0);
    idle[0]!();
    await flush();
    expect(reads).toBe(1);
  });

  it('the first input starts the draw without waiting for idle (positive control for the gate)', async () => {
    render(<AsciiStage mode="behind-chat" />);
    await flush();
    expect(reads).toBe(0);
    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(reads).toBe(1);
  });

  it('repeated renders with the same inputs do not redraw, and a mode change copies the finished picture', async () => {
    const { rerender } = render(<AsciiStage mode="behind-chat" />);
    await flush();
    idle[0]!();
    await flush();
    expect(reads).toBe(1);
    rerender(<AsciiStage mode="behind-chat" />);
    rerender(<AsciiStage mode="under" />);
    rerender(<AsciiStage mode="behind-chat" />);
    await flush();
    for (const f of idle.splice(1)) f();
    await flush();
    expect(reads).toBe(1);
  });

  it('a remount at the same size and room reuses the finished mosaic', async () => {
    const a = render(<AsciiStage mode="behind-chat" />);
    await flush();
    idle[0]!();
    await flush();
    expect(reads).toBe(1);
    a.unmount();
    render(<AsciiStage mode="behind-chat" />);
    await flush();
    expect(reads).toBe(1);
  });

  it('whenIdleOrInput fires once and a cancel stops it', () => {
    const fn = vi.fn();
    const cancel = whenIdleOrInput(fn);
    cancel();
    idle[0]!();
    window.dispatchEvent(new Event('keydown'));
    expect(fn).not.toHaveBeenCalled();
    const fn2 = vi.fn();
    whenIdleOrInput(fn2);
    idle[1]!();
    window.dispatchEvent(new Event('keydown'));
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
