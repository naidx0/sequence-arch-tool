import fs from 'node:fs';
import path from 'node:path';
import { Profiler } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../agents/agentRunFold';
import { createAgentRunStore, type AgentRun, type AgentRunStore } from '../agents/agentRuns';
import { urgentRunEvent } from '../agents/agentRunner';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { createFrameQueue, type FrameClock } from '../state/frameQueue';
import { AgentRunsList, resetKeptOpen, useAgentRuns } from './AgentRunThread';

/*
 * S6, MEASURED END TO END: React commits per second while a recorded codex
 * turn streams into the chat, before and after.
 *
 *   before  the pre-S6 server's frames (no text merging), each applied as it
 *           arrives: one store update, one commit, per frame;
 *   after   the S6 server's frames (text merged within 50 ms), applied once
 *           per animation frame (state/frameQueue.ts).
 *
 * The frames and the replay time each was read at come from
 * tools/measure/s6-stream-frames.mjs (the real server on the replay clock;
 * not run live). Animation frames are every 1000/60 ms of that same clock.
 */

const FIXTURES = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 's6');
type Frame = { at: number; event: RunNodeEvent };
const framesOf = (scenario: string): { before: Frame[]; after: Frame[] } => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${scenario}.frames.json`), 'utf8'));

const FRAME_MS = 1000 / 60;

function freshRun(): AgentRun {
  return { id: 'run-s6', sessionId: 's6', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null };
}

function Thread({ store }: { store: AgentRunStore }) {
  const s = useAgentRuns(store);
  return <AgentRunsList runs={s.runs} repoRoot={null} onAnswer={() => {}} />;
}

/** Replay time now, so each commit is stamped with when it happened. */
let replayNow = 0;

function mount() {
  const store = createAgentRunStore({ clock: () => 0 });
  store.patch((s) => ({ ...s, runs: [freshRun()] }));
  const at: number[] = [];
  const view = render(
    <Profiler id="chat" onRender={() => at.push(replayNow)}>
      <Thread store={store} />
    </Profiler>,
  );
  return { store, commits: () => at.length, at, view };
}

interface Played {
  commits: number;
  /** The most commits in any one second of the turn. */
  peak: number;
}

function peakPerSecond(at: number[]): number {
  let peak = 0;
  for (let i = 0, j = 0; i < at.length; i++) {
    while (at[i]! - at[j]! >= 1000) j++;
    peak = Math.max(peak, i - j + 1);
  }
  return peak;
}

/** Each frame applied as it arrives (the pre-S6 client). */
function playEach(frames: Frame[]): Played {
  const m = mount();
  const before = m.commits();
  for (const f of frames) {
    replayNow = f.at;
    act(() => m.store.apply('run-s6', f.event));
  }
  const at = m.at.slice(before);
  m.view.unmount();
  return { commits: at.length, peak: peakPerSecond(at) };
}

/** Frames through the frame queue, with animation frames on the replay clock. */
function playFramed(frames: Frame[]): Played {
  const m = mount();
  let pending: (() => void) | null = null;
  const clock: FrameClock = {
    frame: (fn) => {
      pending = fn;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    timer: (fn) => {
      pending = fn;
      return 2;
    },
    cancelTimer: () => {
      pending = null;
    },
    hidden: () => false,
    onVisibility: () => () => {},
  };
  const q = createFrameQueue<RunNodeEvent>((events) => m.store.batch(() => events.forEach((e) => m.store.apply('run-s6', e))), clock);
  const before = m.commits();
  let nextFrame = FRAME_MS;
  for (const f of frames) {
    while (nextFrame <= f.at) {
      const fn = pending as (() => void) | null;
      pending = null;
      replayNow = nextFrame;
      if (fn) act(() => fn());
      nextFrame += FRAME_MS;
    }
    replayNow = f.at;
    act(() => q.push(f.event, urgentRunEvent(f.event)));
  }
  act(() => q.flush());
  const at = m.at.slice(before);
  m.view.unmount();
  return { commits: at.length, peak: peakPerSecond(at) };
}

afterEach(() => resetKeptOpen());

describe('S6: commits per second while a recorded turn streams', () => {
  for (const scenario of ['todo-plan', 'edit-with-plan']) {
    it(`${scenario}: the merged frames, applied once per animation frame, commit far less often than the pre-S6 stream`, () => {
      const { before, after } = framesOf(scenario);
      const spanS = before[before.length - 1]!.at / 1000;
      const c0 = playEach(before);
      const cServer = playEach(after);
      const c1 = playFramed(after);
      const rate = (p: Played) => (p.commits / spanS).toFixed(2);
      console.log(
        `  S6 ${scenario} (span ${spanS.toFixed(1)} s): commits ${c0.commits} -> ${cServer.commits} (server merge only) -> ${c1.commits} (merge + per-frame apply); ` +
          `mean ${rate(c0)} -> ${rate(cServer)} -> ${rate(c1)} commits/s (${(c0.commits / c1.commits).toFixed(2)}x); ` +
          `peak second ${c0.peak} -> ${cServer.peak} -> ${c1.peak} commits (${(c0.peak / c1.peak).toFixed(2)}x)`,
      );
      expect(cServer.commits).toBeLessThan(c0.commits);
      expect(c1.commits).toBeLessThanOrEqual(cServer.commits);
      expect(c1.peak).toBeLessThan(c0.peak);
      /* Never more than one commit per stream frame. */
      expect(c1.commits).toBeLessThanOrEqual(after.length);
    });
  }
});
