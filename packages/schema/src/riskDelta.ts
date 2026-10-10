/**
 * Risk DELTA — "what would change if this landed", not "what is risky".
 *
 * G-D (change-vs-scaffolding review). `computeRisks` (risks.ts) answers "which
 * nodes are single points of failure in THIS graph". A reviewer looking at a
 * pending architecture proposal needs a different question answered: does
 * accepting it make the system MORE or LESS fragile? That is exactly the
 * difference between two `computeRisks` runs — one over the real scanned graph,
 * one over the merged draft — so this module adds NO new risk semantics at all.
 * It only diffs two already-grounded outputs.
 *
 * THE RULE, stated so it cannot drift:
 *   - key by `nodeId`; compare `severity` on the ordered ladder
 *     moderate < high < critical, with "absent from the list" as the zeroth rung
 *     (a node no longer reported is not a SPOF any more);
 *   - severity went UP (including absent → reported) ⇒ `raised`;
 *   - severity went DOWN (including reported → absent) ⇒ `lowered`;
 *   - severity identical ⇒ NOTHING. Two set-equal inputs therefore produce
 *     `{ raised: [], lowered: [] }` — an empty delta is the honest answer and
 *     must never be dressed up as a change.
 *
 * Blast-radius numbers deliberately do NOT enter the comparison: a one-node
 * wobble in a count is not something a human should be told "increased risk"
 * about. Severity is the shipped, thresholded judgement; the delta rides on it.
 *
 * PURE + TOTAL: no DOM, no store. Deterministic ordering (severity, then id).
 */

import type { RiskSeverity, SystemRisk } from './risks.js';

/** Ladder position, with 0 reserved for "not reported as a risk at all". */
const SEVERITY_RANK: Record<RiskSeverity, number> = {
  moderate: 1,
  high: 2,
  critical: 3,
};

export interface RiskDeltaEntry {
  /** The real node id both sides key on — never a synthesised id. */
  nodeId: string;
  label: string;
  /** Severity before the change; `undefined` ⇒ it was not a reported risk. */
  from?: RiskSeverity;
  /** Severity after the change; `undefined` ⇒ it is no longer a reported risk. */
  to?: RiskSeverity;
}

export interface RiskDelta {
  raised: RiskDeltaEntry[];
  lowered: RiskDeltaEntry[];
}

function rankOf(severity: RiskSeverity | undefined): number {
  return severity ? SEVERITY_RANK[severity] : 0;
}

/** The severity the entry should be sorted by — the louder of its two ends. */
function loudness(entry: RiskDeltaEntry): number {
  return Math.max(rankOf(entry.from), rankOf(entry.to));
}

function sortEntries(entries: RiskDeltaEntry[]): RiskDeltaEntry[] {
  return entries.sort(
    (a, b) => loudness(b) - loudness(a) || a.nodeId.localeCompare(b.nodeId)
  );
}

/**
 * Diff two {@link computeRisks} outputs. `before` is the risk list of the graph
 * as it stands; `after` is the risk list of the same graph with a pending change
 * merged in. Order of the inputs does not matter to correctness — the diff is
 * keyed, not positional — and duplicate node ids collapse to the first entry
 * (`computeRisks` never emits duplicates, but this stays total if it ever did).
 */
export function diffRisks(
  before: readonly SystemRisk[],
  after: readonly SystemRisk[]
): RiskDelta {
  const beforeById = new Map<string, SystemRisk>();
  for (const r of before) if (!beforeById.has(r.nodeId)) beforeById.set(r.nodeId, r);
  const afterById = new Map<string, SystemRisk>();
  for (const r of after) if (!afterById.has(r.nodeId)) afterById.set(r.nodeId, r);

  const raised: RiskDeltaEntry[] = [];
  const lowered: RiskDeltaEntry[] = [];

  const ids = new Set<string>([...beforeById.keys(), ...afterById.keys()]);
  for (const nodeId of ids) {
    const b = beforeById.get(nodeId);
    const a = afterById.get(nodeId);
    const delta = rankOf(a?.severity) - rankOf(b?.severity);
    if (delta === 0) continue; // set-equal on this node ⇒ nothing to say
    const entry: RiskDeltaEntry = {
      nodeId,
      // Prefer the label from the side that still reports it; both come from the
      // same real graph node, so either is grounded.
      label: (a ?? b)!.label,
      from: b?.severity,
      to: a?.severity,
    };
    if (delta > 0) raised.push(entry);
    else lowered.push(entry);
  }

  return { raised: sortEntries(raised), lowered: sortEntries(lowered) };
}

/** Whether a delta says anything at all — the "render nothing" gate for callers. */
export function riskDeltaIsEmpty(delta: RiskDelta): boolean {
  return delta.raised.length === 0 && delta.lowered.length === 0;
}
