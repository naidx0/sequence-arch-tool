/**
 * THE RUN WATCH IS CLOSED — the half of the EventSource leak that had no lock.
 *
 * `beginBoardRunWatch` has always returned an unsubscribe and every call site
 * dropped it, so "Open on board" on N runs opened N EventSources that outlived
 * the component and reconnected every few seconds forever. The fix holds the
 * unsubscribe in a ref and calls it (a) before opening a second watch and (b) on
 * unmount. workflowRunLifecycle.test.ts covers the overlay and the event plumbing
 * but never renders this hook, so neither of those two gestures was locked.
 *
 * Both tests below fail on the pre-fix hook: it never called the unsubscribe.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SeqDiagramV1 } from '@sequence/schema';

const stops: Array<() => void> = [];
const stopCalls: number[] = [];

vi.mock('./workflowRunEvents.js', () => ({
  beginBoardRunWatch: vi.fn(() => {
    const index = stops.length;
    const stop = vi.fn(() => stopCalls.push(index));
    stops.push(stop);
    return stop;
  }),
}));

vi.mock('./workflowLaunchClient.js', () => ({
  postWorkflowRun: vi.fn(async () => ({ ok: true, runId: 'run-test-1' })),
}));

vi.mock('../app/hostCommands.js', () => ({ requestHostCommand: vi.fn() }));

import { useWorkflowLaunch } from './useWorkflowLaunch.js';

/* The schema package's own compile fixture — it must actually compile, or launch
   returns early and never opens a watch at all. */
const DOC: SeqDiagramV1 = {
  version: 1,
  kind: 'agent-workflow',
  title: 'Owner build loop',
  grounded: { graphId: 'shopfront', origin: 'design' },
  nodes: [
    { id: 'agent:orchestrator', label: 'Orchestrator', kind: 'agent', agent: { prompt: 'Coordinate.' } },
    { id: 'agent:planner', label: 'Planner', kind: 'agent', agent: { prompt: 'Plan the build.' } },
    { id: 'agent:builder', label: 'Builder', kind: 'agent', agent: { prompt: 'Propose ids.', runtime: 'acp' } },
    { id: 'agent:verifier', label: 'Verifier', kind: 'agent', agent: { prompt: 'Verify.' } },
  ],
  edges: [
    { id: 'e1', from: 'agent:orchestrator', to: 'agent:planner', family: 'control' },
    { id: 'e2', from: 'agent:planner', to: 'agent:builder', family: 'control' },
    { id: 'e3', from: 'agent:builder', to: 'agent:verifier', family: 'control' },
    { id: 'e4', from: 'agent:verifier', to: 'agent:builder', family: 'control' },
  ],
} as unknown as SeqDiagramV1;

beforeEach(() => {
  stops.length = 0;
  stopCalls.length = 0;
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWorkflowLaunch closes the run watch', () => {
  it('calls the unsubscribe on unmount', async () => {
    const { result, unmount } = renderHook(() => useWorkflowLaunch({ doc: DOC }));

    await act(async () => {
      await result.current.launch();
    });
    await waitFor(() => expect(stops.length).toBe(1));
    expect(stopCalls).toEqual([]);

    unmount();
    expect(stopCalls).toEqual([0]);
  });

  it('closes the previous watch before opening a second one', async () => {
    const { result, unmount } = renderHook(() => useWorkflowLaunch({ doc: DOC }));

    await act(async () => {
      await result.current.launch();
    });
    await waitFor(() => expect(stops.length).toBe(1));

    await act(async () => {
      await result.current.launch();
    });
    await waitFor(() => expect(stops.length).toBe(2));

    // The FIRST socket must be closed by the second launch — otherwise two
    // EventSources are open and only the newer one is reachable.
    expect(stopCalls).toEqual([0]);

    unmount();
    expect(stopCalls).toEqual([0, 1]);
  });
});
