/**
 * Grounded checker primitive (harness-plan W1 / product-final F4).
 * Agents propose; this pure verifier commits or rejects — never an LLM judge.
 * Lives in schema so the scheduler's `checker` node kind can run it with zero
 * web/LLM dependency.
 */

import type { ArchGraph } from './index.js';
import { validateGraph } from './index.js';

export type CheckerVerdict =
  | { ok: true }
  | { ok: false; violations: string[] };

export interface ProposedGraphMutation {
  /** Arch node ids the agent claims to add or touch. */
  claimedNodeIds: string[];
  /** Optional full graph the agent wants applied. */
  proposedGraph?: ArchGraph;
}

/**
 * Verify a mutation against the real attached graph.
 * - Unknown claimed ids that are not in the real graph → fail
 * - proposedGraph must pass validateGraph
 * - proposedGraph edges to missing endpoints → fail
 */
export function checkGraphMutation(real: ArchGraph, mutation: ProposedGraphMutation): CheckerVerdict {
  const violations: string[] = [];
  const realIds = new Set(real.nodes.map((n) => n.id));

  for (const id of mutation.claimedNodeIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      violations.push('empty claimed node id');
      continue;
    }
    if (!realIds.has(id)) {
      const inProposal = mutation.proposedGraph?.nodes.some((n) => n.id === id);
      if (!inProposal) {
        violations.push(`ungrounded node id: ${id}`);
      }
    }
  }

  if (mutation.proposedGraph) {
    const v = validateGraph(mutation.proposedGraph);
    for (const err of v) violations.push(`validateGraph: ${err}`);
    const propIds = new Set(mutation.proposedGraph.nodes.map((n) => n.id));
    for (const e of mutation.proposedGraph.edges) {
      if (!propIds.has(e.srcId)) violations.push(`edge src missing: ${e.srcId}`);
      if (!propIds.has(e.dstId)) violations.push(`edge dst missing: ${e.dstId}`);
    }
  }

  if (violations.length > 0) return { ok: false, violations: [...new Set(violations)].sort() };
  return { ok: true };
}

/**
 * Verify-loop helper: re-run check up to maxAttempts; return last verdict.
 * The caller feeds violations back to the agent between attempts.
 */
export function verifyLoop(
  real: ArchGraph,
  attempts: readonly ProposedGraphMutation[],
  maxAttempts = 3,
): { verdict: CheckerVerdict; attemptsUsed: number } {
  const capped = attempts.slice(0, Math.max(1, maxAttempts));
  let last: CheckerVerdict = { ok: false, violations: ['no attempts'] };
  let used = 0;
  for (const m of capped) {
    used += 1;
    last = checkGraphMutation(real, m);
    if (last.ok) return { verdict: last, attemptsUsed: used };
  }
  return { verdict: last, attemptsUsed: used };
}

/**
 * Parse claimed node ids from a Program shared-state slot (agent outKey).
 * Accepts string[], JSON string array, single id string, or { claimedNodeIds }.
 */
export function parseClaimedNodeIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  }
  if (typeof value === 'object' && value !== null && 'claimedNodeIds' in value) {
    return parseClaimedNodeIds((value as { claimedNodeIds: unknown }).claimedNodeIds);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return parseClaimedNodeIds(JSON.parse(trimmed) as unknown);
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  return [];
}
