/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD'S AFTER-BOOT PARTS START AT FIRST LAYOUT, NOT ON A TIMER.
   The perf instrument ends its boot window when the board's first layout is
   applied. A fixed 1.2 s timer could fire inside that window on a slow
   machine and count the click-only chunks as boot. This renders the REAL
   ConnectedBoard with ELK held: past 1.2 s nothing may preload; releasing the
   layout starts the preload once.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

const held = vi.hoisted(() => ({ release: [] as Array<() => void>, preloads: 0 }));

vi.mock('./layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout.js')>();
  return {
    ...actual,
    layoutOffThread: (...args: Parameters<typeof actual.layoutOffThread>) =>
      new Promise<Awaited<ReturnType<typeof actual.layoutOffThread>>>((resolve, reject) => {
        held.release.push(() => void actual.layoutOffThread(...args).then(resolve, reject));
      }),
  };
});

vi.mock('./preloadable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./preloadable.js')>();
  return {
    ...actual,
    preloadBoardExtras: () => {
      held.preloads += 1;
      return Promise.resolve();
    },
  };
});

import { CanvasProvider } from './canvasChannel.js';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel.js';
import { seqdFromGraph } from './seqdFromGraph.js';
import { installResizeObserver } from './testResizeObserver.js';
import { summarizeGraph } from '../boot';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

const graph = {
  repoName: 'extras',
  scannedAt: '2026-10-06T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'src/gateway.ts', line: 12 },
    { id: 'svc:web', label: 'web', kind: 'service', file: 'src/web.ts', line: 4 },
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

describe('board extras preload', () => {
  it('waits for the first layout, however long it takes, then starts once', async () => {
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    store.dispatch({
      type: 'repo/loaded',
      draft: { root: '/tmp/extras', repoName: 'extras', graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt },
      at: 0,
    });
    const drawn = render(
      <StoreProvider store={store}>
        <CanvasProvider>
          <DocProvider>
            <ConnectedBoard />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );
    await waitFor(() => expect(held.release.length).toBeGreaterThan(0));
    expect(drawn.container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('laying-out');

    /* Past the old 1.2 s timer, still laying out: nothing preloaded. */
    await new Promise((r) => setTimeout(r, 1400));
    expect(held.preloads).toBe(0);

    /* The layout lands: the preload starts, once. */
    for (const go of held.release.splice(0)) go();
    await waitFor(() => expect(drawn.container.querySelector('[data-layout]')?.getAttribute('data-layout')).not.toBe('laying-out'));
    await waitFor(() => expect(held.preloads).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(held.preloads).toBe(1);
    drawn.unmount();
  }, 10000);
});
