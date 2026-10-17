/* ══════════════════════════════════════════════════════════════════════════
   WHAT DESERVES A NOTIFICATION, FROM THE RUN STORE (S5)
   packages/web2/src/notify/attentionModel.ts

   Pure. Given the agent runs as they were and as they are, which events are
   worth telling a person who is not looking: a turn that ended, and an
   approval or a question from the agent that started waiting. And how many
   wait right now, for the dock badge.

   TRANSITIONS, NOT STATES (notifyPreference.newlyFinished's rule). A run that
   was already over when we first saw it, a restored chat full of yesterday's
   turns, is not news. An approval is news the moment it appears, whether its
   run is new or not, because a run can ask before the first poll sees it.
   ══════════════════════════════════════════════════════════════════════════ */

/** The fields of an AgentRun (agents/agentRuns.ts) this reads. */
export interface RunLike {
  id: string;
  sessionId: string | null;
  agentRef: string | null;
  prompt: string;
  status: 'running' | 'done' | 'failed';
  approvals: readonly { requestId: string; title: string | null; decision: string | null }[];
  /** The agent's questions (codex requestUserInput), absent until one is asked. */
  questions?: readonly { requestId: string; settled: boolean; questions: readonly { question: string }[] }[];
}

export interface AttentionSnapshot {
  /** run id -> status */
  status: ReadonlyMap<string, string>;
  /** `${runId}\u0000${requestId}` for every approval still waiting. */
  waiting: ReadonlySet<string>;
}

export type AttentionEvent =
  | { kind: 'turn-ended'; run: RunLike; status: 'done' | 'failed' }
  | { kind: 'approval'; run: RunLike; requestId: string; title: string | null }
  | { kind: 'question'; run: RunLike; requestId: string; question: string | null };

const waitKey = (runId: string, requestId: string): string => `${runId}\u0000${requestId}`;

export const EMPTY_SNAPSHOT: AttentionSnapshot = { status: new Map(), waiting: new Set() };

export function snapshotOf(runs: readonly RunLike[]): AttentionSnapshot {
  const status = new Map<string, string>();
  const waiting = new Set<string>();
  for (const run of runs) {
    status.set(run.id, run.status);
    for (const a of run.approvals) if (a.decision === null) waiting.add(waitKey(run.id, a.requestId));
    for (const q of run.questions ?? []) if (!q.settled) waiting.add(waitKey(run.id, q.requestId));
  }
  return { status, waiting };
}

export function attentionEvents(prev: AttentionSnapshot, runs: readonly RunLike[]): AttentionEvent[] {
  const out: AttentionEvent[] = [];
  for (const run of runs) {
    for (const a of run.approvals) {
      if (a.decision !== null) continue;
      if (prev.waiting.has(waitKey(run.id, a.requestId))) continue;
      out.push({ kind: 'approval', run, requestId: a.requestId, title: a.title });
    }
    for (const q of run.questions ?? []) {
      if (q.settled || prev.waiting.has(waitKey(run.id, q.requestId))) continue;
      out.push({ kind: 'question', run, requestId: q.requestId, question: q.questions[0]?.question ?? null });
    }
    const before = prev.status.get(run.id);
    if (run.status === 'running' || before === undefined || before === run.status) continue;
    out.push({ kind: 'turn-ended', run, status: run.status });
  }
  return out;
}

export function waitingCount(runs: readonly RunLike[]): number {
  let n = 0;
  for (const run of runs) {
    for (const a of run.approvals) if (a.decision === null) n += 1;
    for (const q of run.questions ?? []) if (!q.settled) n += 1;
  }
  return n;
}

/** The agent's name in the reader's words, from its configured id. */
export function agentName(agentRef: string | null): string {
  const ref = (agentRef ?? '').toLowerCase();
  if (ref.includes('codex')) return 'Codex';
  if (ref.includes('claude')) return 'Claude';
  if (ref.includes('gemini')) return 'Gemini';
  if (ref.includes('opencode')) return 'OpenCode';
  if (!ref) return 'The agent';
  return agentRef!.length > 24 ? `${agentRef!.slice(0, 23)}…` : agentRef!;
}
