import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * TYPING MUST NOT FORCE A REFLOW (perf 0.1.8.4, profile cost #3).
 *
 * The composer's autosize wrote `style.height = 'auto'` and then read `scrollHeight` on every draft change: a write
 * followed by a layout read in the same task, which makes the browser lay the page out synchronously per key (306 ms
 * self over 62 keys at x4). The spy below records every layout read (scrollHeight, clientHeight) and every
 * style.height write on the field, in order, and fails if a read follows a write inside one keystroke.
 *
 * jsdom has no layout, so the field is given a scrollHeight that grows with the text (one 18 px line per 20 chars
 * plus 22 px of padding) and a clientHeight that is its current height; jsdom has no `field-sizing`, so this
 * exercises the fallback, which is the code that measures.
 */

afterEach(() => vi.unstubAllGlobals());

function setup() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-grow', title: 'Grow', pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's-grow',
  } as never);
  render(<V3App appStore={store} />);
  const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
  field.style.lineHeight = '18px';
  const log: ('read' | 'write')[] = [];
  const contentHeight = (): number => 22 + 18 * Math.max(1, Math.ceil(field.value.length / 20));
  let height = '';
  Object.defineProperty(field.style, 'height', {
    configurable: true,
    get: () => height,
    set: (v: string) => {
      log.push('write');
      height = v;
    },
  });
  const shown = (): number => (height === '' || height === 'auto' ? 58 : parseFloat(height));
  Object.defineProperty(field, 'scrollHeight', {
    configurable: true,
    get: () => {
      log.push('read');
      return Math.max(contentHeight(), shown());
    },
  });
  Object.defineProperty(field, 'clientHeight', {
    configurable: true,
    get: () => {
      log.push('read');
      return shown();
    },
  });
  return { field, log, shown };
}

function readAfterWrite(log: readonly ('read' | 'write')[]): boolean {
  const firstWrite = log.indexOf('write');
  return firstWrite !== -1 && log.indexOf('read', firstWrite) !== -1;
}

describe('typing in the composer', () => {
  it('performs no layout read after a style write within a keystroke, and still grows the field', async () => {
    const { field, log, shown } = setup();
    let reads = 0;
    let writes = 0;
    let violations = 0;
    const text = 'x'.repeat(140);
    // Seven characters per change keeps the jsdom run short; every change is one task with the spy reset before it.
    for (let i = 7; i <= text.length; i += 7) {
      log.length = 0;
      act(() => {
        fireEvent.change(field, { target: { value: text.slice(0, i) } });
      });
      reads += log.filter((e) => e === 'read').length;
      writes += log.filter((e) => e === 'write').length;
      if (readAfterWrite(log)) violations += 1;
    }
    // Positive controls: the spy saw the field being measured and being resized.
    expect(reads).toBeGreaterThan(0);
    expect(writes).toBeGreaterThan(0);
    expect(violations).toBe(0);
    // And it still grows with the text, capped at 8 lines of 18 px.
    expect(shown()).toBe(144);
  });

  it('shrinks again when text is deleted, and returns to its resting height when emptied', async () => {
    const { field, shown } = setup();
    act(() => {
      fireEvent.change(field, { target: { value: 'y'.repeat(100) } });
    });
    expect(shown()).toBe(22 + 18 * 5);
    act(() => {
      fireEvent.change(field, { target: { value: 'y'.repeat(60) } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(shown()).toBe(22 + 18 * 3);
    act(() => {
      fireEvent.change(field, { target: { value: '' } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(shown()).toBe(58);
  });
});
