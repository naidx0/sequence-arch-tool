/* The cross-chat glance: how many agents run, in how many chats, and which agents. PURE: the run store's runs and the
 * session index in, counts out. It is the one place the overview looks past the open chat, so it never feeds the
 * selected chat's context (that is contextMeter's, scoped to one chat and its current agent).
 *
 * Only runs that are running count: a finished or failed run is history. A run whose chat is no longer in the index is a
 * leftover of a deleted chat and does not count. An index that has not loaded (null) is unknown, and drops nothing. */

import { agentDisplayName } from '../agents/agentLabels';
import type { AgentRun } from '../agents/agentRuns';

export interface FleetAgent {
  /** The agent id; null when a run never said which agent it was. */
  ref: string | null;
  name: string;
  /** Runs of this agent running now. */
  runs: number;
}

export interface FleetSummary {
  /** Runs running now, across the chats of this workspace. */
  running: number;
  /** Chats with at least one run running. */
  runningChats: number;
  /** Chats in the index; null when the index has not loaded. */
  chats: number | null;
  /** One entry per agent running, in the order they were first seen. */
  agents: FleetAgent[];
}

export function fleetSummary(runs: readonly AgentRun[], chatIds: readonly string[] | null, labels?: Readonly<Record<string, string>>): FleetSummary {
  const known = chatIds ? new Set(chatIds) : null;
  const agents = new Map<string | null, FleetAgent>();
  const chats = new Set<string>();
  let running = 0;
  for (const r of runs) {
    if (r.status !== 'running') continue;
    if (known && r.sessionId !== null && !known.has(r.sessionId)) continue;
    running++;
    if (r.sessionId !== null) chats.add(r.sessionId);
    const ref = r.agentRef || null;
    const at = agents.get(ref);
    if (at) at.runs++;
    else agents.set(ref, { ref, name: ref ? agentDisplayName(ref, labels) : 'Unknown agent', runs: 1 });
  }
  return { running, runningChats: chats.size, chats: chatIds ? chatIds.length : null, agents: [...agents.values()] };
}
