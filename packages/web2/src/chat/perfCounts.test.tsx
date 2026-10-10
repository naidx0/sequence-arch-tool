import fs from 'node:fs';
import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from '../v3/V3App';

/*
 * THE TWO RENDER COUNTS THE PERF RATCHET HOLDS (tools/measure/perf-ratchet.json).
 *
 * Counted with React's own Profiler around the whole app, so a commit anywhere
 * counts. Both numbers are deterministic: no timers, no network (fetch never
 * answers), a fresh store.
 *
 *   commitsPerKeystroke   one character typed into the composer field
 *   commitsPerStreamChunk one coalesced `delta` frame of a streaming answer
 *
 * With PERF_COUNTS_OUT set, the counts are written there for the collector
 * (tools/measure/perf-counts.mjs). Each count is also locked at <= 1 here:
 * the ratchet file is a second line, and it can be red for other reasons (boot
 * bytes), which makes a count regression easy to wave through (r12 went 1 -> 3).
 */

afterEach(() => vi.unstubAllGlobals());

function mount() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-perf', title: 'Perf', pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's-perf',
  } as never);
  let commits = 0;
  render(
    <Profiler id="app" onRender={() => (commits += 1)}>
      <V3App appStore={store} />
    </Profiler>,
  );
  return { store, commits: () => commits };
}

function write(key: string, value: number): void {
  const out = process.env.PERF_COUNTS_OUT;
  if (!out) return;
  let prev: Record<string, number> = {};
  try {
    prev = JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, number>;
  } catch {
    /* first writer */
  }
  fs.writeFileSync(out, JSON.stringify({ ...prev, [key]: value }, null, 2));
}

describe('render counts the ratchet holds', () => {
  it('commits per composer keystroke', async () => {
    const app = mount();
    await act(async () => {});
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    const text = 'what calls orders';
    const before = app.commits();
    for (let i = 1; i <= text.length; i++) {
      act(() => {
        fireEvent.change(field, { target: { value: text.slice(0, i) } });
      });
    }
    const per = (app.commits() - before) / text.length;
    expect(field.value).toBe(text);
    expect(per).toBeGreaterThanOrEqual(1);
    /* Round 13: a setState in a layout effect on every render (status bar alignment, surface-bar fade) once made this 3. */
    expect(per).toBeLessThanOrEqual(1);
    write('commitsPerKeystroke', Math.round(per * 100) / 100);
  });

  it('commits per streamed chunk', async () => {
    const app = mount();
    await act(async () => {});
    act(() => {
      app.store.dispatch({ type: 'composer/draft', text: 'explain the gateway' });
      app.store.dispatch({ type: 'turn/send', at: 1 });
    });
    const before = app.commits();
    const chunks = 40;
    for (let i = 0; i < chunks; i++) {
      act(() => {
        app.store.dispatch({ type: 'turn/event', event: { type: 'delta', text: `Part ${i} of the answer — the gateway calls orders. ` }, at: 2 + i });
      });
    }
    const per = (app.commits() - before) / chunks;
    expect(per).toBeGreaterThanOrEqual(1);
    expect(per).toBeLessThanOrEqual(1);
    write('commitsPerStreamChunk', Math.round(per * 100) / 100);
  });
});
