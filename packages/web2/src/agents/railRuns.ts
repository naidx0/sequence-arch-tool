/* ══════════════════════════════════════════════════════════════════════════
   THE RUN STORE, AS THE SIDEBAR NEEDS IT (speed lane)
   packages/web2/src/agents/railRuns.ts

   The rail reads two things from the run store: which chats have subagents (and
   how they are doing) and which agent each chat uses. It subscribed to the whole
   store, so every streamed chunk of every chat re-drew every row of the rail:
   90 ms of 6 s with three chats streaming (tools/measure/stream-bench.mjs).

   This hook hands the rail the store only when one of those two changes.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

import { agentRuns, type AgentRunsState } from './agentRuns';

function signature(s: AgentRunsState): string {
  let out = '';
  for (const r of s.runs) {
    for (const i of r.items) {
      if (i.kind === 'tool' && i.subagent) out += `${r.id}|${r.sessionId}|${i.id}|${i.status}|${i.endedAt ?? ''}|${typeof i.subagent === 'string' ? i.subagent : JSON.stringify(i.subagent)};`;
    }
  }
  return out;
}

let last: { state: AgentRunsState; sig: string; agents: AgentRunsState['agents'] } | null = null;

/** The same object while no subagent and no chat-to-agent binding has changed. */
function snapshot(): AgentRunsState {
  const s = agentRuns.get();
  if (last && last.state === s) return last.state;
  const sig = signature(s);
  if (last && last.sig === sig && last.agents === s.agents) return last.state;
  last = { state: s, sig, agents: s.agents };
  return s;
}

export function useRailRuns(): AgentRunsState {
  return useSyncExternalStore(agentRuns.subscribe, snapshot, snapshot);
}

export function resetRailRunsForTest(): void {
  last = null;
}

/** Whether an agent run is running in one chat (the radar's "something is working here"): a boolean, so streamed text does not re-render the caller. */
export function useAgentRunningIn(sessionId: string | null): boolean {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => agentRuns.get().runs.some((r) => r.status === 'running' && r.sessionId === sessionId),
    () => false,
  );
}

/** Whether any agent run is running: a boolean, so a chunk of streamed text does not re-render the caller. */
export function useAgentsRunning(): boolean {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => agentRuns.get().runs.some((r) => r.status === 'running'),
    () => false,
  );
}
