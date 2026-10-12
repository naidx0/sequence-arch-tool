/* ══════════════════════════════════════════════════════════════════════════
   A RUN THAT IS OVER LOOKS OVER, AND STOPS TALKING TO THE SERVER.
   packages/web2/src/canvas/workflowRunLifecycle.test.ts

   TWO DEFECTS, ONE END OF ONE RUN.

   1. THE CONNECTOR NEVER STOPPED PULSING. `applyBoardRunEvent` set a status on
      `run:finished` and left `activeEdgeId` pointing at the last hop.
      `ConnectedBoard` tags that edge `runActive` with no status check, and
      board.css turns the tag into `animation: board-run-edge 0.9s linear
      infinite`. So the last connector of the last run repainted every 0.9s for
      as long as the tab stayed open, on a board that was idle.

   2. THE SOCKET NEVER CLOSED. The server ends the response on `run:finished`;
      an EventSource treats that as a dropped connection and reconnects by spec,
      and the server — finding no live run — ends the new one at once. No
      `retry:` field is written, so the browser default applies: one request
      every ~3 seconds, per run ever watched, forever. `grep -rn
      endBoardRunWatch packages/` found the definition and NO caller, and all
      three `beginBoardRunWatch` call sites discarded the unsubscribe it
      returns.

   WHY A FAKE EventSource RATHER THAN A REAL ONE: the defect is about WHO CLOSES
   and WHEN, which is a fact about this module and not about the transport. jsdom
   has no EventSource at all, and a real one would make the test a statement
   about a browser's reconnect timer.
   ══════════════════════════════════════════════════════════════════════════ */

import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramRunEvent } from '@sequence/api-types';

import { subscribeProgramRunEvents } from './workflowRunEvents.js';
import {
  applyBoardRunEvent,
  clearBoardRunOverlay,
  getBoardRunOverlay,
  initBoardRunOverlay,
} from './workflowRunOverlay.js';

class FakeEventSource {
  static live: FakeEventSource[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  private readonly handlers: Array<(ev: MessageEvent<string>) => void> = [];

  constructor(readonly url: string) {
    FakeEventSource.live.push(this);
  }

  addEventListener(_type: string, fn: (ev: MessageEvent<string>) => void): void {
    this.handlers.push(fn);
  }

  removeEventListener(_type: string, fn: (ev: MessageEvent<string>) => void): void {
    const at = this.handlers.indexOf(fn);
    if (at >= 0) this.handlers.splice(at, 1);
  }

  close(): void {
    this.closed = true;
  }

  /** What the server sends. Delivered only while the source is open, which is
   *  what a closed EventSource actually does. */
  send(event: ProgramRunEvent): void {
    if (this.closed) return;
    for (const fn of [...this.handlers]) fn({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

const realEventSource = globalThis.EventSource;

afterEach(() => {
  globalThis.EventSource = realEventSource;
  FakeEventSource.live = [];
  clearBoardRunOverlay();
});

function watching(runId = 'run-1'): { source: FakeEventSource; stop: () => void } {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  initBoardRunOverlay({ runId, programId: 'p', nodeIds: ['wf:a', 'wf:b'] });
  const stop = subscribeProgramRunEvents(runId);
  return { source: FakeEventSource.live[FakeEventSource.live.length - 1]!, stop };
}

const runningOn = (nodeId: string, seq: number): ProgramRunEvent =>
  ({ type: 'node:status', nodeId, status: 'running', seq }) as unknown as ProgramRunEvent;

describe('the run overlay is cleared by the end of the run', () => {
  it('drops the active connector when the run finishes', () => {
    initBoardRunOverlay({ runId: 'r', programId: 'p', nodeIds: ['wf:a', 'wf:b'] });
    applyBoardRunEvent(runningOn('wf:a', 1));
    applyBoardRunEvent(runningOn('wf:b', 2));
    expect(getBoardRunOverlay()!.activeEdgeId).toBe('wf:a->wf:b');

    applyBoardRunEvent({ type: 'run:finished', status: 'completed', seq: 3 } as unknown as ProgramRunEvent);
    expect(getBoardRunOverlay()!.status).toBe('completed');
    expect(getBoardRunOverlay()!.activeEdgeId).toBeNull();
  });

  it('drops it when the run is cancelled too, and stops the clock', () => {
    initBoardRunOverlay({ runId: 'r', programId: 'p', nodeIds: ['wf:a', 'wf:b'] });
    applyBoardRunEvent(runningOn('wf:a', 1));
    applyBoardRunEvent(runningOn('wf:b', 2));

    applyBoardRunEvent({ type: 'run:cancelled', seq: 3 } as unknown as ProgramRunEvent);
    expect(getBoardRunOverlay()!.status).toBe('stopped');
    expect(getBoardRunOverlay()!.activeEdgeId).toBeNull();
    expect(getBoardRunOverlay()!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('does not carry the last run’s node across into the next run’s first edge', () => {
    /* `lastRunningNodeId` is module state. Left set across the end of a run, the
       first node of the NEXT run inherits an edge from the previous one — a
       connector nothing ever traversed, animated as though something had. */
    initBoardRunOverlay({ runId: 'r1', programId: 'p', nodeIds: ['wf:a', 'wf:b'] });
    applyBoardRunEvent(runningOn('wf:a', 1));
    applyBoardRunEvent({ type: 'run:finished', status: 'completed', seq: 2 } as unknown as ProgramRunEvent);

    initBoardRunOverlay({ runId: 'r2', programId: 'p', nodeIds: ['wf:a', 'wf:b'] });
    applyBoardRunEvent(runningOn('wf:b', 1));
    expect(getBoardRunOverlay()!.activeEdgeId).toBeNull();
  });
});

describe('the stream is closed by the run, not by the tab', () => {
  it('closes the EventSource once a terminal event arrives', () => {
    const { source } = watching();
    source.send(runningOn('wf:a', 1));
    expect(source.closed).toBe(false);

    source.send({ type: 'run:finished', status: 'completed', seq: 2 } as unknown as ProgramRunEvent);
    expect(source.closed).toBe(true);
  });

  it('applies the terminal event BEFORE closing, so the end of the run is not lost', () => {
    const { source } = watching();
    source.send(runningOn('wf:a', 1));
    source.send(runningOn('wf:b', 2));
    source.send({ type: 'run:finished', status: 'error', seq: 3 } as unknown as ProgramRunEvent);
    expect(getBoardRunOverlay()!.status).toBe('failed');
    expect(source.closed).toBe(true);
  });

  it('leaves the stream open when the transport merely errors mid-run', () => {
    /* A genuine drop SHOULD reconnect — the board must not blank a run because
       a socket blinked. The two cases are told apart by the terminal EVENT, not
       by the transport. */
    const { source } = watching();
    source.onerror?.();
    expect(source.closed).toBe(false);
  });

  it('the unsubscribe closes it, and is safe to call twice', () => {
    const { source, stop } = watching();
    stop();
    expect(source.closed).toBe(true);
    expect(() => stop()).not.toThrow();
  });
});
