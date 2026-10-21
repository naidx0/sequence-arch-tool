/* ══════════════════════════════════════════════════════════════════════════
   useLiveLoop(runIdOrChatId)  (0.1.8.4)
   packages/web2/src/activity/useLiveLoop.ts

   Watches one run: its blocks light up as the engine commits node:status events. No new server API: it reads
   `GET /api/program/runs/:id` (the record and its whole event log) on a short poll until the run is terminal.
   A chat id (anything that is not a run id) resolves to that chat's workflow, then to the newest run of its program. A chat keeps being
   watched after its run ends: it looks again for a newer run every LIVE_SLOW_POLL_MS, and a chat with no workflow or no run asks at that
   same slow rate (and lists no runs without a workflow). A run id given outright stops at the run's end.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';

import { createActivityClient, isRunId, type ActivityClient } from './activityClient';
import { EMPTY_LIVE, isTerminal, liveFromRun, type LiveLoop } from './liveLoopModel';
import { createWorkflowApi, type WorkflowApi } from './workflowClient';

export type { LiveBlock, LiveBlockState, LiveLoop, LiveStatus } from './liveLoopModel';

export const LIVE_POLL_MS = 1000;
/** How often a chat with nothing running looks for something new. */
export const LIVE_SLOW_POLL_MS = 15_000;

export interface LiveLoopOptions {
  client?: ActivityClient;
  workflows?: WorkflowApi;
  pollMs?: number;
}

export function useLiveLoop(runIdOrChatId: string | null | undefined, opts: LiveLoopOptions = {}): LiveLoop {
  const client = useMemo(() => opts.client ?? createActivityClient(), [opts.client]);
  const workflows = useMemo(() => opts.workflows ?? createWorkflowApi(), [opts.workflows]);
  const pollMs = opts.pollMs ?? LIVE_POLL_MS;
  const [live, setLive] = useState<LiveLoop>(EMPTY_LIVE);

  useEffect(() => {
    setLive(EMPTY_LIVE);
    if (!runIdOrChatId) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const chatMode = !isRunId(runIdOrChatId);
    let runId: string | null = chatMode ? null : runIdOrChatId;
    /* The run last seen ended: a chat looks again for a newer one, slowly. */
    let settled = false;
    const ctl = new AbortController();

    const resolveChat = async (): Promise<string | null> => {
      const wl = await workflows.chatList(runIdOrChatId, ctl.signal);
      if (!wl.ok) return null;
      const ids = new Set(wl.body.workflows.map((w) => w.id));
      if (ids.size === 0) return null;
      const runs = await client.runs(ctl.signal);
      if (runs.outcome !== 'ok') return null;
      const mine = runs.body.runs.filter((r) => ids.has(r.programId));
      return mine.length > 0 ? mine.reduce((a, b) => (b.startedAt > a.startedAt ? b : a)).runId : null;
    };

    const tick = async () => {
      if (stopped) return;
      let delay: number | null = pollMs;
      try {
        if (!runId || settled) {
          const newest = await resolveChat();
          if (stopped) return;
          if (newest && newest !== runId) {
            runId = newest;
            settled = false;
          }
        }
        if (!runId) delay = chatMode ? LIVE_SLOW_POLL_MS : pollMs;
        else if (settled) delay = LIVE_SLOW_POLL_MS;
        else {
          const r = await client.run(runId, ctl.signal);
          if (stopped) return;
          if (r.outcome === 'ok') {
            const next = liveFromRun(r.body.run.program, r.body.events, r.body.run.status);
            setLive(next);
            if (isTerminal(next.status)) {
              settled = true;
              delay = chatMode ? LIVE_SLOW_POLL_MS : null;
            }
          }
        }
      } catch {
        /* a failed poll is retried on the next tick */
      }
      if (!stopped && delay !== null) timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      stopped = true;
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runIdOrChatId, client, workflows, pollMs]);

  return live;
}
