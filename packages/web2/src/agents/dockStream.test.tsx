import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadChatLazies } from '../../test/preloadChat';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { AGENT_STREAM_URL } from './agentStream';

/*
 * ROUND 7, A7 follow-up: in the real shell the Agents dock stayed empty while
 * hook events were posted (r7-agents-7 shots). Reproduced in the built app:
 * the panel's useSyncExternalStore subscribe was a new function every render,
 * so every emit closed the page's EventSource and opened another (hundreds of
 * GET /api/agent-events in 3 s), and a source closed before its replay landed
 * lost the events.
 *
 * Through the real Shell2 mount (V3App, Agents open): one EventSource for the
 * page however often it opens and emits, and a hook event posted on it shows
 * in the dock.
 */

class FakeSource {
  static made: FakeSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  close() {
    this.closed = true;
  }
}

const T = Date.now() - 5000;
const ev = (n: number, e: Record<string, unknown>) => ({ id: `e${n}`, at: T + n * 100, source: 'claude-hook', sessionId: 'dock-s', paths: [], status: 'done', ...e });

/* Shell2 draws the dock through React.lazy(() => import('../agents/AgentsDock')): load it (and what it pulls in) up front. */
beforeAll(async () => {
  await Promise.all([preloadChatLazies(), import('./AgentsDock'), import('./AgentsPanel'), import('./startWithHooks')]);
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('v3.agentsOpen', '1');
  FakeSource.made = [];
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('the Agents dock in the real shell', () => {
  it('keeps one stream open and shows a posted hook event', async () => {
    render(
      <V3App
        appStore={createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() })}
      />,
    );
    const dock = await screen.findByTestId('agents-dock');
    await waitFor(() => expect(FakeSource.made.filter((s) => s.url === AGENT_STREAM_URL && !s.closed)).toHaveLength(1));
    const live = () => FakeSource.made.filter((s) => s.url === AGENT_STREAM_URL && !s.closed);

    /* The stream opens and the replay arrives: each emit used to cost a reconnect. */
    await act(async () => {
      live()[0]!.onopen?.({});
    });
    await act(async () => {
      live()[0]!.onmessage?.({ data: JSON.stringify(ev(1, { kind: 'session_start', status: 'running', title: 'Session' })) });
      live()[0]!.onmessage?.({ data: JSON.stringify(ev(2, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 't1', status: 'running', title: 'Read services/orders/app.py' })) });
    });
    await waitFor(() => expect(within(dock).getByTestId('agents-roster')).toBeTruthy());
    expect(within(dock).getByTestId('agents-tree').textContent).toMatch(/Read/);
    expect(FakeSource.made.filter((s) => s.url === AGENT_STREAM_URL)).toHaveLength(1);
    expect(live()).toHaveLength(1);
  });
});
