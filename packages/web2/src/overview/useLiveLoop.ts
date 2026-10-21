/* ══════════════════════════════════════════════════════════════════════════
   THE LIVE LOOP, AS THE OVERVIEW DRAWS IT
   packages/web2/src/overview/useLiveLoop.ts

   The overview's Progress section has a slot for the workflow loop that is
   running now: its steps, the one it is on, and the pass it is in. The data is
   activity/useLiveLoop.ts (a poll of the chat's newest run); this file only
   adapts its shape to the overview's, and keeps the slot empty when there is
   nothing to show: no blocks, or a run that finished cleanly. A run that
   failed, stopped or was interrupted stays, with its failed step marked.
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';

import type { LiveLoop as ActivityLoop } from '../activity/liveLoopModel';
import { useLiveLoop as useActivityLoop } from '../activity/useLiveLoop';

export interface LiveLoopStep {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'failed';
}

export interface LiveLoop {
  name: string;
  steps: LiveLoopStep[];
  /** Completed passes of the loop, when it has looped back. */
  round: number;
}

/** The overview polls slower than the Activity view: it is a glance, not the watch. */
const OVERVIEW_POLL_MS = 3000;

export function adaptLiveLoop(live: ActivityLoop): LiveLoop | null {
  if (live.blocks.length === 0 || live.status === 'completed') return null;
  return {
    name: live.maxIterations !== null ? 'Workflow loop' : 'Workflow',
    steps: live.blocks.map((b) => ({
      id: b.id,
      label: b.title,
      state: b.state === 'running' ? 'active' : b.state,
    })),
    round: Math.max(0, live.iteration - 1),
  };
}

export function useLiveLoop(chatId: string | null): LiveLoop | null {
  const live = useActivityLoop(chatId, { pollMs: OVERVIEW_POLL_MS });
  return useMemo(() => adaptLiveLoop(live), [live]);
}
