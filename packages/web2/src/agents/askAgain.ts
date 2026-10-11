/* The ask ledger's follow-up (t3gap/asks). Its own module so the boot store carries none of it. */
import type { AgentRun, AgentRunStore } from './agentRuns';
import type { Fetch } from './runNodeStream';

/**
 * THE ASK LEDGER'S FOLLOW-UP: once per run, in the same scope it came from
 * (a board node's run goes back to that node's agent session, not the chat's).
 */
export function askAgainFrom(store: AgentRunStore, run: AgentRun, question: string, f?: Fetch): Promise<AgentRun> | null {
  const now = store.get().runs.find((r) => r.id === run.id) ?? run;
  if (now.askedAgain) return null;
  store.patch((s) => ({ ...s, runs: s.runs.map((r) => (r.id === run.id ? { ...r, askedAgain: true } : r)) }));
  return store.start(
    {
      ...(run.agentRef ? { agentRef: run.agentRef } : {}),
      sessionId: run.sessionId,
      question,
      intent: run.intent ?? 'build',
      ...(run.access ? { access: run.access } : {}),
      ...(run.nodeId ? { nodeId: run.nodeId, nodeLabel: run.nodeLabel } : {}),
    },
    f,
  );
}

