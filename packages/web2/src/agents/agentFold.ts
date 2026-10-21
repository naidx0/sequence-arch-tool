/* ══════════════════════════════════════════════════════════════════════════
   A LONG TURN, FOLDED: RUNS OF FINISHED STEPS OF ONE KIND
   packages/web2/src/agents/agentFold.ts

   A turn of forty steps drew forty rows. A run of finished steps of one kind
   ("Read" thirty times) is one row that says what it did, counted from the
   steps behind it (agentTrace.traceSummary), and opens onto them. What a
   reader must see is never folded away: a failed step, the step in flight, a
   step that has stalled (`held`) and the focused step.

   NO JUMP WHILE IT STREAMS. While the turn runs, the run at its end keeps its
   newest KEEP_LIVE finished steps as rows, so a step finishing grows the fold
   by one and takes one row off the rows under it: the row count does not
   change and nothing below moves.

   Pure: the same steps give the same rows.
   ══════════════════════════════════════════════════════════════════════════ */

import { traceSummary } from './agentTrace.js';
import type { AgentNode } from './agentTypes.js';

/** The shortest run that is worth a fold row. */
export const FOLD_MIN = 4;
/** While the turn runs, how many of the newest finished steps at its end stay as rows. */
export const KEEP_LIVE = 2;

export type StepRow = { kind: 'node'; node: AgentNode } | { kind: 'fold'; id: string; nodes: AgentNode[]; text: string; spanMs: number };

export interface FoldOptions {
  /** The turn is still running. */
  running: boolean;
  /** The step the reader focused; it stays a row. */
  focusId: string | null;
  /** A step that must stay a row (a stalled one). */
  held: (n: AgentNode) => boolean;
}

export function foldSteps(kids: readonly AgentNode[], o: FoldOptions): StepRow[] {
  const eligible = (n: AgentNode): boolean => n.kind === 'tool_call' && n.status === 'completed' && !n.error && n.id !== o.focusId && !o.held(n) && n.stepKind !== null && n.stepKind !== 'think';
  const out: StepRow[] = [];
  const asRows = (ns: readonly AgentNode[]): void => {
    for (const n of ns) out.push({ kind: 'node', node: n });
  };
  let i = 0;
  while (i < kids.length) {
    if (!eligible(kids[i]!)) {
      asRows([kids[i]!]);
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < kids.length && eligible(kids[j + 1]!) && kids[j + 1]!.stepKind === kids[i]!.stepKind) j += 1;
    const run = kids.slice(i, j + 1);
    /* Trailing: nothing but steps still in flight comes after it. */
    const trailing = o.running && kids.slice(j + 1).every((n) => n.status === 'running' || n.status === 'pending');
    const folded = trailing ? run.slice(0, Math.max(0, run.length - KEEP_LIVE)) : run;
    if (folded.length >= FOLD_MIN) {
      const text = traceSummary(folded) ?? `${folded.length} steps`;
      const last = folded[folded.length - 1]!;
      out.push({ kind: 'fold', id: `fold:${folded[0]!.id}`, nodes: folded, text: text.charAt(0).toUpperCase() + text.slice(1), spanMs: Math.max(0, (last.endedAt ?? last.startedAt) - folded[0]!.startedAt) });
      asRows(run.slice(folded.length));
    } else asRows(run);
    i = j + 1;
  }
  return out;
}
