/**
 * THE GOALBAR'S VIEW OF THE SESSION'S GOAL, PLAN AND RUN.
 *
 * ── WHY IT POLLS, AND WHY THAT IS NOT A SHORTCUT ────────────────────────────
 *
 * A goal run is a PERSISTED ROW, not a stream of events: the whole of it is
 * `{ running, turns, cap, lastStopReason, lastStopSentence }`, any window may
 * read it, and it changes once per turn — which is once per provider call, i.e.
 * seconds at best. One small GET every 1.5s says everything a stream would, and
 * recovers from a dropped connection by simply asking again. `programRunner`
 * streams because a program run emits an ordered log a reconnecting client must
 * replay exactly; that is a different problem and it has a different answer.
 *
 * ── THE PLAN COMES BACK WITH EVERY POLL ─────────────────────────────────────
 *
 * Not only the run state. The plan is what the run is CHANGING — a step ticks,
 * a step parks — and a bar that polled the run while showing a plan from page
 * load would count down turns beside a checklist that never moved. They are
 * fetched together so they can never be from different moments.
 *
 * ── A FAILED POLL DOES NOT BLANK THE BAR ────────────────────────────────────
 *
 * The last good state is kept and the error is shown beside it. Replacing a
 * plan with an empty one because one request timed out would read as "the run
 * threw your plan away", which is both alarming and false.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { goalRunButton, type GoalRunButton, type GoalRunMode } from './goalRunVerdict';

/**
 * How often to ask while a run is working.
 *
 * Fast enough that a ticked step appears while the person is still looking at
 * the bar, slow enough that a twenty-four-turn run is under a thousand requests
 * to a server on localhost. NOTHING IS POLLED WHILE THE RUN IS IDLE — an idle
 * row cannot change except through this window's own Start, so a background
 * poll would be a request per 1.5s, for ever, to be told nothing.
 */
export const GOAL_RUN_POLL_MS = 1500;

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };

export interface GoalRunView {
  run: GoalRunState;
  plan: PlanStep[];
  goal: string | null;
  /** The button, already decided — see `goalRunVerdict.goalRunButton`. */
  button: GoalRunButton;
  /** A start or stop is in flight. Distinct from `run.running`. */
  busy: boolean;
  /** The last thing that went wrong on the wire, or null. */
  error: string | null;
  /**
   * Start the run. `mode` overrides the hook's own `input.mode` FOR THIS CALL
   * ONLY, and exists for exactly one caller: `/goal <text>`, which switches the
   * composer to Build and starts in the same gesture. `input.mode` is captured
   * when the hook renders, so at the moment the slash command runs it still
   * says Plan — the switch it just dispatched has not been rendered yet — and
   * the run would be started under a permission the reader has already left.
   * The override says the mode the ENABLING ACT set, not a guess.
   */
  start: (mode?: GoalRunMode) => Promise<void>;
  stop: () => Promise<void>;
  /** Replace the plan — the Unpark control's write. */
  savePlan: (plan: readonly PlanStep[]) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useGoalRun(input: {
  sessionId: string | null;
  repoPath?: string | undefined;
  /** The composer's mode, which decides whether a run may start at all. */
  mode: GoalRunMode;
  jobMode?: 'work' | 'code';
  /** Injected in tests; the real client otherwise. */
  client?: SessionsClient;
  pollMs?: number;
}): GoalRunView {
  const fallback = useRef<SessionsClient | null>(null);
  if (input.client === undefined && fallback.current === null) {
    fallback.current = createSessionsClient();
  }
  const client = input.client ?? fallback.current!;
  const { sessionId, repoPath } = input;
  const pollMs = input.pollMs ?? GOAL_RUN_POLL_MS;

  const [run, setRun] = useState<GoalRunState>(IDLE);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [goal, setGoal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * THE LATEST SESSION ID THIS HOOK IS SERVING.
   *
   * Every async answer is checked against it before it lands. Switching threads
   * mid-poll is ordinary — the rail is one click away — and an in-flight
   * response that arrives after the switch would paint the OLD thread's plan
   * onto the new one's bar, which is a lie that looks like data.
   */
  const servingRef = useRef<string | null>(sessionId);
  servingRef.current = sessionId;

  const refresh = useCallback(async () => {
    const id = sessionId;
    if (!id) {
      setRun(IDLE);
      setPlan([]);
      setGoal(null);
      return;
    }
    const [runRes, sessionRes] = await Promise.all([
      client.readGoalRun(id, undefined, repoPath),
      client.readSession(id, undefined, repoPath),
    ]);
    if (servingRef.current !== id) return;
    if (runRes.outcome === 'ok') setRun(runRes.body);
    if (sessionRes.outcome === 'ok') {
      setPlan(sessionRes.body.plan ?? []);
      setGoal(sessionRes.body.goal ?? null);
    }
    /* KEEP THE LAST GOOD STATE. A failed poll reports itself and changes
       nothing else — see the header. */
    const failed = runRes.outcome === 'error' ? runRes : sessionRes.outcome === 'error' ? sessionRes : null;
    setError(failed ? failed.message : null);
  }, [client, repoPath, sessionId]);

  /* Read once when the thread changes, so the bar is never a stale thread's. */
  useEffect(() => {
    setRun(IDLE);
    setPlan([]);
    setGoal(null);
    setError(null);
    void refresh();
  }, [refresh]);

  /* And keep asking, but ONLY while something can change. */
  useEffect(() => {
    if (!run.running || !sessionId) return undefined;
    const timer = setInterval(() => {
      void refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh, run.running, sessionId]);

  const start = useCallback(async (modeOverride?: GoalRunMode) => {
    const id = sessionId;
    if (!id) return;
    const effectiveMode = modeOverride ?? input.mode;
    setBusy(true);
    setError(null);
    const res = await client.startGoalRun(
      id,
      {
        /* The mode the person is actually in. The server refuses anything but
           Build with a reason; sending our guess instead of their setting would
           be this surface asserting a consent nobody gave. */
        permission: effectiveMode === 'build' ? 'build' : 'plan',
        ...(input.jobMode === undefined ? {} : { jobMode: input.jobMode }),
      },
      repoPath,
    );
    if (servingRef.current !== id) return;
    if (res.outcome === 'ok') setRun(res.body.state);
    else setError(res.message);
    setBusy(false);
    /*
     * ONE READ IMMEDIATELY AFTER, so the first turn's tick does not wait a full
     * poll interval to appear. The button has just been pressed and the person
     * is looking straight at it; 1.5s of nothing happening is the moment they
     * decide it did not work.
     */
    await refresh();
  }, [client, input.jobMode, input.mode, refresh, repoPath, sessionId]);

  const stop = useCallback(async () => {
    const id = sessionId;
    if (!id) return;
    setBusy(true);
    const res = await client.stopGoalRun(id, repoPath);
    if (servingRef.current !== id) return;
    if (res.outcome === 'ok') setRun(res.body.state);
    else setError(res.message);
    setBusy(false);
  }, [client, repoPath, sessionId]);

  const savePlan = useCallback(
    async (next: readonly PlanStep[]) => {
      const id = sessionId;
      if (!id) return;
      /* Optimistic, and safe to be: the write is a full REPLACE of a small
         array the person just edited by hand, so there is no merge to lose. A
         refusal puts the server's answer back on the next refresh. */
      setPlan([...next]);
      const res = await client.update(id, { plan: [...next] }, repoPath);
      if (servingRef.current !== id) return;
      if (res.outcome === 'error') {
        setError(res.message);
        await refresh();
      }
    },
    [client, refresh, repoPath, sessionId],
  );

  const button = useMemo(
    () => goalRunButton({ mode: input.mode, plan, run }),
    [input.mode, plan, run],
  );

  return { run, plan, goal, button, busy, error, start, stop, savePlan, refresh };
}
