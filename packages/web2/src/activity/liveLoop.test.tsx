import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow, readyBlock, type WorkflowBlock } from '@sequence/schema';
import type { ProgramRunEvent } from '@sequence/api-types';

import type { ActivityClient } from './activityClient';
import { LiveLoopView } from './LiveLoopView';
import { liveFromRun } from './liveLoopModel';
import { getLiveRun, launchAndWatch, setLiveRun } from './liveRun';
import { useLiveLoop } from './useLiveLoop';
import { takeAgentsViewRequest } from '../agents/agentsSection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLiveRun(null);
});

const blocks: WorkflowBlock[] = [
  readyBlock('agent', 'b1'),
  { ...readyBlock('loop', 'b2'), span: 2, maxIterations: 3 },
  readyBlock('test', 'b3'),
  readyBlock('checker', 'b4'),
  readyBlock('finish', 'b5'),
];
const program = compileWorkflow({ id: 'wf', name: 'Loop', blocks });

let seq = 0;
const ev = (nodeId: string, status: 'queued' | 'running' | 'done' | 'error'): ProgramRunEvent => ({ seq: ++seq, at: seq, type: 'node:status', nodeId, status });

const states = (events: ProgramRunEvent[], status: Parameters<typeof liveFromRun>[2] = 'running') => liveFromRun(program, events, status);

describe('status events become block states', () => {
  it('nothing reported: every block is pending and the first is next', () => {
    const l = states([]);
    expect(l.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'end']);
    expect(l.blocks.every((b) => b.state === 'pending')).toBe(true);
    expect(l.activeIndex).toBe(0);
    expect(l.iteration).toBe(0);
  });

  it('running, done and error map to running, done and failed; the running block is active', () => {
    const l = states([ev('b1', 'running'), ev('b1', 'done'), ev('b2', 'running'), ev('b3', 'running'), ev('b3', 'done'), ev('b4', 'running'), ev('b4', 'error')]);
    const by = Object.fromEntries(l.blocks.map((b) => [b.id, b.state]));
    expect(by).toMatchObject({ b1: 'done', b2: 'running', b3: 'done', b4: 'failed', end: 'pending' });
    expect(l.activeIndex).toBe(1);
  });

  it('the loop iteration counts passes over its first body block, capped by maxIterations', () => {
    const first = [ev('b1', 'done'), ev('b2', 'running'), ev('b3', 'running'), ev('b3', 'done'), ev('b4', 'running'), ev('b4', 'done')];
    expect(states(first).iteration).toBe(1);
    const second = [...first, ev('b3', 'running'), ev('b3', 'done'), ev('b4', 'running')];
    const l = states(second);
    expect(l.iteration).toBe(2);
    expect(l.maxIterations).toBe(3);
    expect(l.blocks.find((b) => b.id === 'b3')!.state).toBe('done');
  });

  it('a finished run has no active block', () => {
    expect(states([ev('b1', 'done')], 'completed').activeIndex).toBe(-1);
  });
});

function fakeClient(frames: { status: 'running' | 'completed'; events: ProgramRunEvent[] }[]): { client: ActivityClient; run: ReturnType<typeof vi.fn> } {
  let i = 0;
  const run = vi.fn(async () => {
    const f = frames[Math.min(i++, frames.length - 1)]!;
    return { outcome: 'ok', status: 200, body: { run: { runId: 'run-a1-0123abcd', program, status: f.status }, events: f.events } };
  });
  return { client: { run, runs: vi.fn(async () => ({ outcome: 'ok', status: 200, body: { runs: [] } })) } as unknown as ActivityClient, run };
}

describe('useLiveLoop', () => {
  it('polls the run, lights blocks as events arrive, and stops once the run is terminal', async () => {
    const { client, run } = fakeClient([
      { status: 'running', events: [ev('b1', 'running')] },
      { status: 'running', events: [ev('b1', 'done'), ev('b2', 'running'), ev('b3', 'running')] },
      { status: 'completed', events: [ev('b1', 'done'), ev('b3', 'done'), ev('b4', 'done')] },
    ]);
    const { result } = renderHook(() => useLiveLoop('run-a1-0123abcd', { client, pollMs: 1000 }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(result.current.blocks[0]!.state).toBe('running');
    expect(result.current.status).toBe('running');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(result.current.blocks[0]!.state).toBe('done');
    expect(result.current.iteration).toBe(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(result.current.status).toBe('completed');
    const calls = run.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(run.mock.calls.length).toBe(calls);
  });

  it('a chat id resolves to the newest run of that chat workflow', async () => {
    const run = vi.fn(async () => ({ outcome: 'ok', status: 200, body: { run: { runId: 'run-b2-89abcdef', program, status: 'completed' }, events: [ev('b1', 'done')] } }));
    const client = {
      run,
      runs: vi.fn(async () => ({ outcome: 'ok', status: 200, body: { runs: [
        { runId: 'run-a1-0123abcd', programId: 'wf', startedAt: 1 },
        { runId: 'run-b2-89abcdef', programId: 'wf', startedAt: 9 },
        { runId: 'run-c3-00000000', programId: 'other', startedAt: 99 },
      ] } })),
    } as unknown as ActivityClient;
    const workflows = { chatList: vi.fn(async () => ({ ok: true, body: { workflows: [{ id: 'wf' }], legacy: [] } })) } as never;
    const { result } = renderHook(() => useLiveLoop('chat-1', { client, workflows, pollMs: 1000 }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(run).toHaveBeenCalledWith('run-b2-89abcdef', expect.anything());
    expect(result.current.status).toBe('completed');
  });
});

describe('Launch', () => {
  it('starts the run first, then opens the live view on the Agents surface', async () => {
    takeAgentsViewRequest();
    const order: string[] = [];
    const client = { start: vi.fn(async () => (order.push('start'), { outcome: 'ok', status: 202, body: { runId: 'run-a1-0123abcd', status: 'running', startedAt: 1 } })) } as unknown as ActivityClient;
    const r = await launchAndWatch(client, program);
    expect(r).toEqual({ ok: true, runId: 'run-a1-0123abcd' });
    expect(client.start).toHaveBeenCalledWith(program);
    expect(getLiveRun()).toBe('run-a1-0123abcd');
    expect(takeAgentsViewRequest()).toBe('workflows');
  });

  it('a refused start opens no live view', async () => {
    takeAgentsViewRequest();
    const client = { start: vi.fn(async () => ({ outcome: 'error', status: 400, body: { error: 'ACP is not available' } })) } as unknown as ActivityClient;
    const r = await launchAndWatch(client, program);
    expect(r.ok).toBe(false);
    expect(getLiveRun()).toBeNull();
    expect(takeAgentsViewRequest()).toBeNull();
  });
});

describe('LiveLoopView', () => {
  it('draws the blocks with their states and the pass count', async () => {
    const { client } = fakeClient([{ status: 'running', events: [ev('b1', 'done'), ev('b2', 'running'), ev('b3', 'running')] }]);
    render(<LiveLoopView runId="run-a1-0123abcd" opts={{ client, pollMs: 1000 }} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(screen.getAllByTestId('live-block').map((e) => e.getAttribute('data-state'))).toEqual(['done', 'running', 'running', 'pending', 'pending']);
    expect(screen.getByTestId('live-loop-iteration').textContent).toBe('Pass 1 of 3');
  });

  it('draws nothing when no run is being watched', () => {
    const { container } = render(<LiveLoopView />);
    expect(container.textContent).toBe('');
  });
});
