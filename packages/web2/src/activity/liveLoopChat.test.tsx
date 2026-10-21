/**
 * A chat's live loop keeps up with the chat: a new run after a finished one is picked up, and a chat with
 * nothing to watch asks slowly. Fake timers; the clients are fakes.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow, readyBlock } from '@sequence/schema';

import type { ActivityClient } from './activityClient';
import { LIVE_SLOW_POLL_MS, useLiveLoop } from './useLiveLoop';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const program = compileWorkflow({ id: 'wf', name: 'Loop', blocks: [readyBlock('agent', 'b1')] });
const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

type RunRow = { runId: string; programId: string; startedAt: number };
function world(opts: { workflows: boolean }) {
  const rows: RunRow[] = [];
  const status: Record<string, 'running' | 'completed'> = {};
  const runs = vi.fn(async () => ({ outcome: 'ok', status: 200, body: { runs: rows } }));
  const run = vi.fn(async (id: string) => ({ outcome: 'ok', status: 200, body: { run: { runId: id, program, status: status[id] ?? 'completed' }, events: [] } }));
  const chatList = vi.fn(async () => ({ ok: true, body: { workflows: opts.workflows ? [{ id: 'wf' }] : [], legacy: [] } }));
  return { rows, status, runs, run, chatList, client: { run, runs } as unknown as ActivityClient, workflows: { chatList } as never };
}

describe('useLiveLoop on a chat id', () => {
  it('picks up a new run once the first one has finished', async () => {
    const w = world({ workflows: true });
    w.rows.push({ runId: 'run-a1-aaaa0001', programId: 'wf', startedAt: 1 });
    w.status['run-a1-aaaa0001'] = 'completed';
    renderHook(() => useLiveLoop('chat-1', { client: w.client, workflows: w.workflows, pollMs: 1000 }));
    await flush(10);
    expect(w.run).toHaveBeenCalledWith('run-a1-aaaa0001', expect.anything());
    w.rows.push({ runId: 'run-a1-bbbb0002', programId: 'wf', startedAt: 2 });
    w.status['run-a1-bbbb0002'] = 'running';
    await flush(LIVE_SLOW_POLL_MS + 10);
    expect(w.run).toHaveBeenCalledWith('run-a1-bbbb0002', expect.anything());
    /* and it is watched at the fast rate while it runs */
    const before = w.run.mock.calls.filter((c) => c[0] === 'run-a1-bbbb0002').length;
    await flush(3100);
    expect(w.run.mock.calls.filter((c) => c[0] === 'run-a1-bbbb0002').length).toBeGreaterThanOrEqual(before + 3);
  });

  it('a finished run is not fetched again while it stays the newest', async () => {
    const w = world({ workflows: true });
    w.rows.push({ runId: 'run-a1-aaaa0001', programId: 'wf', startedAt: 1 });
    renderHook(() => useLiveLoop('chat-1', { client: w.client, workflows: w.workflows, pollMs: 1000 }));
    await flush(10);
    const n = w.run.mock.calls.length;
    await flush(LIVE_SLOW_POLL_MS * 2);
    expect(w.run.mock.calls.length).toBe(n);
  });

  it('a chat with no workflow asks slowly, and never lists runs', async () => {
    const w = world({ workflows: false });
    renderHook(() => useLiveLoop('chat-1', { client: w.client, workflows: w.workflows, pollMs: 1000 }));
    await flush(10);
    expect(w.chatList).toHaveBeenCalledTimes(1);
    await flush(10_000);
    expect(w.chatList).toHaveBeenCalledTimes(1);
    await flush(LIVE_SLOW_POLL_MS);
    expect(w.chatList.mock.calls.length).toBeLessThanOrEqual(2);
    expect(w.runs).not.toHaveBeenCalled();
  });

  it('a run id given outright still stops at its end', async () => {
    const w = world({ workflows: true });
    w.status['run-a1-aaaa0001'] = 'completed';
    renderHook(() => useLiveLoop('run-a1-aaaa0001', { client: w.client, workflows: w.workflows, pollMs: 1000 }));
    await flush(10);
    const n = w.run.mock.calls.length;
    await flush(LIVE_SLOW_POLL_MS * 2);
    expect(w.run.mock.calls.length).toBe(n);
  });
});
