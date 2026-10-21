/**
 * POLICY AGAINST A COMMIT, NOT AGAINST A DRAWING.
 *
 * `checkPolicy` takes `addedEdges` — the mutation someone is authoring on the
 * canvas — so the rules could judge a proposal and could not judge a pull
 * request. Three things were missing between those two, and they are one
 * feature:
 *
 *   1. THE DIFF. Added edges are what two scans differ by, not something a
 *      human hands over.
 *   2. THE BASELINE. A rule is unadoptable in a repository that already breaks
 *      it: without a ratchet, the first run of any real rule on any real
 *      codebase is a wall of failures, and what gets deleted is the rule.
 *   3. THE EXIT CODE. A verdict nothing can act on is a verdict nobody reads.
 *
 * WHAT THIS DOES NOT DO is invent policy semantics. Every hit still comes from
 * `checkPolicy`; this decides WHICH edges to hand it and WHAT to do with the
 * answer. A second implementation of "does this rule fire" is exactly the drift
 * that makes two surfaces disagree about the same repository.
 */

import type { ArchGraph, EdgeKind } from './index.js';
import {
  checkPolicy,
  emptyPolicyVerdict,
  type PolicyEdge,
  type PolicyHit,
  type PolicyVerdict,
} from './policyChecker.js';
import type { Policy } from './policy.js';

/**
 * The exit codes, and they are three rather than two on purpose.
 *
 * CI must be able to tell "the rules said no" from "the checker fell over". A
 * tool that returns 1 for both teaches a team to treat its own crashes as
 * policy failures, and then to treat policy failures as crashes.
 */
export const POLICY_EXIT = {
  ok: 0,
  violation: 1,
  error: 2,
} as const;

/** A violation a repository has accepted, so the ratchet can hold without blocking. */
export interface PolicyBaseline {
  version: 1;
  /** Keys from {@link baselineKey}. */
  accepted: string[];
}

export interface ScanPolicyVerdict extends PolicyVerdict {
  /**
   * Hits that WOULD have blocked and were accepted by the baseline.
   *
   * Reported, never erased. A ratchet that hid what it accepted would leave a
   * repository unable to see its own debt, and a ratchet's whole value is that
   * the debt is visible and cannot grow.
   */
  baselined: PolicyHit[];
  /**
   * Baseline entries that fired nothing this run.
   *
   * The other half of a ratchet: it has to be able to TIGHTEN. An accepted
   * violation that has since been fixed should come out of the file, and
   * nothing will take it out if nothing says it is dead.
   */
  staleBaseline: string[];
}

/**
 * The identity of a violation, stable across scans.
 *
 * Deliberately not the edge id: `nextEdgeId` counts up from zero on every scan,
 * so an id moves whenever a file earlier in the walk gains or loses an edge. A
 * baseline keyed on ids would go stale on the next commit and stop suppressing
 * the thing it was written for.
 */
export function baselineKey(ruleKind: string, srcId: string, dstId: string): string {
  return `${ruleKind}|${srcId}|${dstId}`;
}

const edgeKey = (e: { srcId: string; dstId: string; kind: string }): string =>
  `${e.srcId}\u0000${e.dstId}\u0000${e.kind}`;

/**
 * What `after` has that `before` did not.
 *
 * Compared by (src, dst, kind) rather than by id, for the reason `baselineKey`
 * gives. Kind is part of the identity because `a -> b` over http and `a -> b`
 * over a queue are different couplings, and a rule may forbid one and permit
 * the other.
 */
export function addedEdgesBetween(before: ArchGraph, after: ArchGraph): PolicyEdge[] {
  const had = new Set((before.edges ?? []).map(edgeKey));
  const seen = new Set<string>();
  const added: PolicyEdge[] = [];
  for (const e of after.edges ?? []) {
    const key = edgeKey(e);
    if (had.has(key) || seen.has(key)) continue;
    seen.add(key);
    added.push({ srcId: e.srcId, dstId: e.dstId, kind: e.kind as EdgeKind });
  }
  /* Sorted, so two runs over one pair of scans produce the same report and a
     diff between two CI logs means something changed in the code. */
  added.sort(
    (a, b) =>
      a.srcId.localeCompare(b.srcId) ||
      a.dstId.localeCompare(b.dstId) ||
      String(a.kind).localeCompare(String(b.kind)),
  );
  return added;
}

/**
 * Run the policies against what a commit ADDED.
 *
 * A violation present in both scans is the repository's status quo and does not
 * block — failing a PR for it would fail every PR until someone fixed a thing
 * they did not touch, which is how a check gets turned off.
 */
export function checkPolicyBetweenScans(
  before: ArchGraph,
  after: ArchGraph,
  policies: readonly Policy[],
  baseline?: PolicyBaseline,
): ScanPolicyVerdict {
  const accepted = new Set(baseline?.accepted ?? []);
  const added = addedEdgesBetween(before, after);

  if (!policies || policies.length === 0 || added.length === 0) {
    return {
      ...emptyPolicyVerdict(),
      baselined: [],
      /* Every entry is stale when nothing ran — but only when there was a
         baseline to be stale. */
      staleBaseline: [...accepted].sort(),
    };
  }

  const verdict = checkPolicy(before, after, added, policies);

  const blocks: PolicyHit[] = [];
  const baselined: PolicyHit[] = [];
  const fired = new Set<string>();
  for (const hit of verdict.blocks) {
    const key = baselineKey(hit.ruleKind, hit.edge.srcId, hit.edge.dstId);
    fired.add(key);
    if (accepted.has(key)) baselined.push(hit);
    else blocks.push(hit);
  }
  for (const hit of verdict.warns) {
    fired.add(baselineKey(hit.ruleKind, hit.edge.srcId, hit.edge.dstId));
  }

  return {
    ok: blocks.length === 0,
    blocks,
    warns: verdict.warns,
    baselined,
    staleBaseline: [...accepted].filter((k) => !fired.has(k)).sort(),
  };
}

/**
 * The number CI reads.
 *
 * Warnings never change it. A warning that failed a build is a block wearing
 * the wrong name, and the first thing a team does about one is stop writing
 * warnings.
 */
export function policyExitCode(verdict: Pick<PolicyVerdict, 'ok'>): number {
  return verdict.ok ? POLICY_EXIT.ok : POLICY_EXIT.violation;
}
