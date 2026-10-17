import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../test/support/fakeLayout';
import '../agents/agentRunFold';
import { agentRuns, createAgentRunStore } from '../agents/agentRuns';
import { resetRailRunsForTest, useAgentsRunning, useRailRuns } from '../agents/railRuns';
import { AgentLights } from '../canvas/AgentOverlay';
import { createAgentStore } from '../agents/agentStream';
import { createStore, StoreProvider } from '../state';
import type { Turn } from '../state/types';
import { resetKeptOpen } from './AgentRunThread';
import { ChatTranscript, FALLBACK_TURNS } from './ChatTranscript';
import { formatTime } from '../v3/V3Chat';

/*
 * SPEED LANE: the mechanisms that took streaming and long chats from "the page cannot keep up" to
 * "it keeps up". Numbers (tools/measure/stream-bench.mjs, switch-bench.mjs) are in the lane README;
 * each case here fails on the code before the change.
 */

describe('the time label on every turn', () => {
  it('builds its Intl formatter once, not once per turn', () => {
    const real = Intl.DateTimeFormat;
    let built = 0;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (this: unknown, ...a: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      built += 1;
      return new real(...a);
    } as never);
    const localeSpy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    for (let i = 0; i < 500; i++) formatTime(1_700_000_000_000 + i * 60_000);
    expect(built).toBeLessThanOrEqual(1);
    expect(localeSpy).not.toHaveBeenCalled();
    expect(formatTime(1_700_000_000_000)).toMatch(/\d/);
    spy.mockRestore();
    localeSpy.mockRestore();
  });
});

describe('a bad timestamp', () => {
  it('blanks its own label only, not every label after it', () => {
    expect(formatTime(Number.NaN)).toBe('');
    expect(formatTime(1_700_000_000_000)).toMatch(/\d/);
    expect(formatTime(8.64e15 + 1)).toBe('');
    expect(formatTime(1_700_000_000_000)).toMatch(/\d/);
  });
});

describe('a long chat while its list chunk loads', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = installFakeLayout();
  });
  afterEach(() => {
    restore?.();
    resetKeptOpen();
  });
  it('stands in with the last screenful, not all of it', () => {
    const turns = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, role: i % 2 ? 'assistant' : 'user', text: `row ${i}`, at: i }) as unknown as Turn);
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 'L', pinned: false, updatedAt: 'x' }], activeId: 's1' } as never);
    const view = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={turns} renderTurn={(t) => <p key={t.id} data-turn={t.id}>{(t as unknown as { text: string }).text}</p>} tail={[]} empty={false} runStore={createAgentRunStore({ fetch: async () => new Response('{}') })} />
      </StoreProvider>,
    );
    /* Synchronously after mount the lazy chunk has not landed: this is the stand-in. */
    const drawn = view.container.querySelectorAll('[data-turn]');
    expect(drawn.length).toBe(FALLBACK_TURNS);
    expect(drawn[drawn.length - 1]!.getAttribute('data-turn')).toBe('t499');
    expect(screen.queryByTestId('v3-transcript-virtual')).not.toBeNull();
  });
});

describe('what a streamed chunk is allowed to re-render', () => {
  const running = (id: string, text: string) => ({
    id,
    sessionId: 's',
    agentRef: 'codex',
    nodeId: null,
    nodeLabel: null,
    prompt: 'go',
    status: 'running' as const,
    startedAt: 0,
    endedAt: null,
    items: [{ kind: 'text', id: 'm', text }] as never,
    approvals: [],
    error: null,
  });
  afterEach(() => {
    agentRuns.patch((s) => ({ ...s, runs: [] }));
    resetRailRunsForTest();
  });

  it('the shell asks "is anything running", and a chunk of prose does not re-render it', () => {
    agentRuns.patch((s) => ({ ...s, runs: [running('r1', 'a')] }));
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useAgentsRunning();
    });
    const before = renders;
    for (let i = 0; i < 20; i++) act(() => agentRuns.patch((s) => ({ ...s, runs: [running('r1', 'a'.repeat(i + 2))] })));
    expect(renders - before).toBe(0);
    act(() => agentRuns.patch((s) => ({ ...s, runs: [{ ...running('r1', 'done'), status: 'done' as const }] })));
    expect(renders - before).toBe(1);
  });

  it('the sidebar gets the same run state until a subagent or an agent binding changes', () => {
    agentRuns.patch((s) => ({ ...s, runs: [running('r1', 'a')] }));
    resetRailRunsForTest();
    const seen: unknown[] = [];
    renderHook(() => {
      const v = useRailRuns();
      seen.push(v);
      return v;
    });
    const before = seen.length;
    for (let i = 0; i < 20; i++) act(() => agentRuns.patch((s) => ({ ...s, runs: [running('r1', 'a'.repeat(i + 2))] })));
    expect(seen.length - before).toBe(0);
    const sub = { ...running('r1', 'a'), items: [{ kind: 'tool', id: 't1', name: 'task', status: 'running', subagent: 'explorer', startedAt: 1, endedAt: null }] as never };
    act(() => agentRuns.patch((s) => ({ ...s, runs: [sub] })));
    expect(seen.length - before).toBe(1);
  });

  it('the board overlay repaints once per frame however many chunks arrived', async () => {
    vi.useFakeTimers();
    try {
      const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
      const root = document.createElement('div');
      root.innerHTML = '<div data-testid="board-node" data-node-id="svc:a"></div>';
      document.body.appendChild(root);
      const spy = vi.spyOn(root, 'querySelectorAll');
      render(<AgentLights store={createAgentStore()} root={() => root} runs={runs} sessionId="s" delayMs={0} />);
      /* Wait for the overlay's own lazy import to land (it paints once when it does), however
         loaded the machine is, before counting. */
      await act(async () => {
        await import('../chat/agentComposer.js');
        for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50);
      });
      spy.mockClear();
      for (let i = 0; i < 30; i++) runs.patch((s) => ({ ...s, runs: [running('r1', 'x'.repeat(i + 1))] }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      /* One paint reads the cards (and the edges): a handful of queries, not thirty paints' worth. */
      expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
      root.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
