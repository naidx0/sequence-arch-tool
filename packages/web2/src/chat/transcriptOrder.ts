/* ══════════════════════════════════════════════════════════════════════════
   WHAT HAPPENED WHEN: Sequence's turns and agent runs in one order
   packages/web2/src/chat/transcriptOrder.ts

   A local-model reply is a Turn; a Claude/Codex answer is an AgentRun. They are
   two lists, so they were drawn as "all turns, then all runs", and a local reply
   sent after an agent run rendered above it (0.1.7 bug E2).

   A run goes in before the first user turn sent after it started (`turn.at` >
   `run.startedAt`). Only user turns place runs: an assistant turn's `at` is its
   commit time, and a reply never moves above the question it answers.

   LEGACY. A turn with no usable `at` (absent, 0, not finite: a chat saved before
   turns were stamped) never places a run, so a chat without stamps keeps the
   order it always had: every turn, then every run. Runs keep their own order.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun } from '../agents/agentRuns';
import type { Turn } from '../state/types';

export type OrderedItem = { kind: 'turn'; turn: Turn } | { kind: 'run'; run: AgentRun };

const stamped = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function orderTurnsAndRuns(turns: readonly Turn[], runs: readonly AgentRun[]): OrderedItem[] {
  const out: OrderedItem[] = [];
  let next = 0;
  for (const turn of turns) {
    if (turn.role === 'user' && stamped(turn.at)) {
      while (next < runs.length && stamped(runs[next]!.startedAt) && runs[next]!.startedAt < turn.at) out.push({ kind: 'run', run: runs[next++]! });
    }
    out.push({ kind: 'turn', turn });
  }
  while (next < runs.length) out.push({ kind: 'run', run: runs[next++]! });
  return out;
}

/** How many leading items precede `tail` (the plan card, live thinking): through the last turn; the runs after it follow the tail, as they always did. */
export function itemsBeforeTail(items: readonly OrderedItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === 'turn') return i + 1;
  return 0;
}
