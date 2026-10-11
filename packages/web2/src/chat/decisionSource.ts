/* ══════════════════════════════════════════════════════════════════════════
   WHICH ANSWER THE DECISION CARD READS
   packages/web2/src/chat/decisionSource.ts

   The card belongs to the LAST thing said in the chat, once it is finished:
   Sequence's last answer, or the last agent run's last message, whichever is
   newer. A person's message after it, a turn still running, or a question the
   agent is holding open (the question card owns those) all mean no card.
   Pure: turns and runs in, one source (or null) out.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun } from '../agents/agentRuns';
import type { AssistantTurn, Turn } from '../state/types';
import { detectDecisions, planFromText, planRowsFromEntries, planRowsFromTodos, type DecisionSet, type PlanRow } from './decisionModel';
import { answerText } from './splitThinking';
import { stripToolProse } from './stripToolProse';

export interface DecisionSource {
  /** The turn or run it came from: the dismissal and the answer are kept against it. */
  id: string;
  set: DecisionSet;
  plan: PlanRow[];
}

function runText(run: AgentRun): string {
  for (let i = run.items.length - 1; i >= 0; i--) {
    const it = run.items[i]!;
    if (it.kind === 'message' && it.text.trim()) return it.text;
    /* Work after the last words means the words were not the ending. */
    if (it.kind === 'tool') return '';
  }
  return '';
}

function runPlan(run: AgentRun): PlanRow[] {
  for (let i = run.items.length - 1; i >= 0; i--) {
    const it = run.items[i]!;
    if (it.kind === 'plan') return planRowsFromEntries(it.entries);
  }
  return [];
}

export function latestDecision(turns: readonly Turn[], runs: readonly AgentRun[], busy: boolean): DecisionSource | null {
  if (busy) return null;
  const turn = turns.length ? turns[turns.length - 1]! : null;
  const run = runs.length ? runs[runs.length - 1]! : null;
  const runAt = run ? (run.endedAt ?? run.startedAt) : 0;
  const turnAt = turn ? turn.at : 0;
  if (run && runAt >= turnAt) {
    if (run.status !== 'done' || (run.questions ?? []).some((q) => !q.settled) || run.approvals.some((a) => a.decision === null)) return null;
    const text = runText(run);
    const set = detectDecisions(text);
    if (!set) return null;
    const plan = runPlan(run);
    return { id: `run:${run.id}`, set, plan: plan.length ? plan : planFromText(text) };
  }
  if (!turn || turn.role === 'user') return null;
  const a = turn as AssistantTurn;
  const { stripped } = stripToolProse(a.text ?? '');
  const text = answerText(stripped) || stripped;
  const set = detectDecisions(text);
  if (!set) return null;
  const todos = planRowsFromTodos(a.todos ?? []);
  return { id: `turn:${a.id}`, set, plan: todos.length ? todos : planFromText(text) };
}
