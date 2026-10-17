/**
 * WHICH CHATS HAVE A GOAL RUN GOING, for the surfaces that are not the goal bar.
 *
 * A goal run's agent is driven by the server, so no run for it exists in `agentRuns` (the window's own turns), and the
 * status bar read that as "Idle" with "Default model" while the run worked. `useGoalRun` already knows (it polls the run
 * row); it publishes the answer here and the status bar reads it. One tiny store, no polling of its own.
 */
export interface LiveGoalRun {
  /** Turns spent so far. */
  turns: number;
  /** The coding agent working the plan (absent: Sequence's own model). */
  agentRef?: string;
}

type Listener = () => void;

let live: Readonly<Record<string, LiveGoalRun>> = {};
const listeners = new Set<Listener>();

export const goalRunLive = {
  get: (): Readonly<Record<string, LiveGoalRun>> => live,
  subscribe: (l: Listener): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** `null` when the chat has no run going. Unchanged answers do not notify. */
  set: (sessionId: string, run: LiveGoalRun | null): void => {
    const before = live[sessionId];
    if (run === null ? before === undefined : before !== undefined && before.turns === run.turns && before.agentRef === run.agentRef) return;
    const next = { ...live };
    if (run === null) delete next[sessionId];
    else next[sessionId] = run;
    live = next;
    for (const l of [...listeners]) l();
  },
};
