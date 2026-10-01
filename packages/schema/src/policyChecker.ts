/**
 * The policy half of the harness verdict (G-E) — pure, deterministic, key-free.
 *
 * `checkGraphMutation` (graphChecker.ts) asks "is this structurally legal". This
 * asks the question the ORG wrote down: "does this change break a rule *we*
 * committed to this repo". Same primitive, same posture — agents propose, code
 * decides, no model judges a model.
 *
 * WHAT IT IS GIVEN, and why each argument exists:
 *   - `real`      — the scanned graph. Defines what already EXISTS, which is how
 *                   `flag-network-hop` tells a brand-new endpoint from an old one.
 *   - `proposed`  — the graph the proposal would produce (`real` + the merge the
 *                   Accept path actually writes). Reachability is computed over
 *                   THIS, so a chain the proposal itself introduces
 *                   (`new → gateway → pricing`) is judged, not missed.
 *   - `addedEdges`— only the edges the change ADDS. Policies judge the CHANGE.
 *                   An existing sync call into the pricing path is the status
 *                   quo; blocking every proposal because of it would make the
 *                   rule un-satisfiable and the product unusable.
 *   - `policies`  — whatever `.sequence/policies/*.json` contained. Empty ⇒
 *                   `{ ok: true, blocks: [], warns: [] }`, always.
 *
 * DIRECTION. `X -> Y` means "X depends on Y" (impact.ts §EDGE DIRECTION, which
 * is transposition-locked). So "a call INTO the pricing path" is an edge whose
 * DST is, or transitively reaches, the target — and the reachability is exactly
 * `dependsOn(dst)`, the forward closure. This module consumes
 * `buildImpactAdjacency` / `impactClosure` as built and never re-derives an
 * adjacency of its own, so it cannot drift from the blast-radius engine.
 *
 * SEVERITY is fixed per rule kind in this slice, and stated here rather than
 * configured: `no-sync-into` BLOCKS (it is a hard architectural constraint —
 * that is the whole point of writing it down), `no-db-write-into` BLOCKS (a new
 * write into a protected datastore is a hard constraint), `flag-network-hop` WARNS (adding
 * a service is legitimate; the reviewer just has to see it). A per-rule severity
 * knob is a real thing to want, but shipping it before anyone has asked would be
 * a configuration surface with no user.
 */

import type { ArchGraph, EdgeKind } from './index.js';
import { buildImpactAdjacency, impactClosure } from './impact.js';
import type { Policy, PolicyRule } from './policy.js';

/**
 * Edge kinds that are a BLOCKING call out — the analyzer's own sync/async split
 * (`EdgeKind` in index.ts). `queue_publish` / `queue_consume` are asynchronous by
 * construction and are the shape a latency-first org wants a change to use
 * instead; `db_read` / `db_write` / `db_access` are datastore access, not a
 * service-to-service call, and `import` is compile-time.
 */
export const SYNC_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['http', 'grpc']);

/** The minimal edge shape a policy judges: endpoints plus the analyzer's kind. */
export interface PolicyEdge {
  srcId: string;
  dstId: string;
  kind: EdgeKind;
}

/** One citation: WHICH rule fired, on WHICH edge, and why — in plain English. */
export interface PolicyHit {
  ruleKind: PolicyRule['kind'];
  /** The policy file's `name`, when it had one — so the user knows who spoke. */
  policyName?: string;
  /** The rule's own `reason`, verbatim. Never paraphrased, never invented. */
  ruleReason?: string;
  /** The proposed edge that fired the rule. */
  edge: PolicyEdge;
  /** One sentence a reviewer can act on. Names the rule and the real ids. */
  explanation: string;
}

export interface PolicyVerdict {
  /** `false` ⇔ `blocks` is non-empty. Warnings never make a verdict not-ok. */
  ok: boolean;
  /** Hits that must stop Accept. */
  blocks: PolicyHit[];
  /** Hits that are shown and never block. */
  warns: PolicyHit[];
}

/** The empty answer, freshly allocated so a caller can never mutate a shared one. */
export function emptyPolicyVerdict(): PolicyVerdict {
  return { ok: true, blocks: [], warns: [] };
}

/**
 * Resolve a `no-sync-into` target to real node ids — exact id first, then
 * case-insensitive label. Returns an EMPTY set when nothing matches, which the
 * caller treats as "cannot judge", not as "clean".
 */
export function resolvePolicyTarget(real: ArchGraph, target: string): Set<string> {
  const wanted = target.trim();
  const out = new Set<string>();
  if (wanted === '') return out;
  for (const n of real.nodes) {
    if (n.id === wanted) out.add(n.id);
  }
  if (out.size > 0) return out;
  const lower = wanted.toLowerCase();
  for (const n of real.nodes) {
    if (typeof n.label === 'string' && n.label.trim().toLowerCase() === lower) out.add(n.id);
  }
  return out;
}

function edgeWords(edge: PolicyEdge): string {
  return `${edge.srcId} → ${edge.dstId} (${edge.kind})`;
}

function withReason(sentence: string, reason?: string): string {
  return reason && reason.trim() !== '' ? `${sentence} — ${reason.trim()}` : sentence;
}

/**
 * Judge `addedEdges` against every rule in `policies`.
 *
 * PURE and TOTAL: no policies (or no rules) ⇒ the empty verdict; a malformed
 * rule that slipped past `validatePolicy` is skipped rather than thrown on; a
 * cycle in the graph terminates (`impactClosure` carries a visited set).
 * Deterministic: hits come out in policy → rule → edge order, de-duplicated on
 * (rule kind, policy name, edge), so two policies naming the same target still
 * each get to speak but one policy never double-reports one edge.
 */
export function checkPolicy(
  real: ArchGraph,
  proposed: ArchGraph,
  addedEdges: readonly PolicyEdge[],
  policies: readonly Policy[],
): PolicyVerdict {
  if (!policies || policies.length === 0 || addedEdges.length === 0) return emptyPolicyVerdict();

  const blocks: PolicyHit[] = [];
  const warns: PolicyHit[] = [];
  const seen = new Set<string>();
  const push = (bucket: PolicyHit[], hit: PolicyHit) => {
    const key = `${hit.ruleKind} | ${hit.policyName ?? ''} | ${hit.edge.srcId} | ${hit.edge.dstId}`;
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(hit);
  };

  const realIds = new Set(real.nodes.map((n) => n.id));
  // ONE adjacency for the whole call, built from the proposed graph exactly as
  // `buildImpactAdjacency` builds it — never a second, hand-rolled traversal.
  const adjacency = buildImpactAdjacency(proposed.edges);
  const reachCache = new Map<string, Set<string>>();
  const reachableFrom = (id: string): Set<string> => {
    let hit = reachCache.get(id);
    if (!hit) {
      hit = impactClosure(adjacency.out, id);
      reachCache.set(id, hit);
    }
    return hit;
  };

  for (const policy of policies) {
    if (!policy || !Array.isArray(policy.rules)) continue;
    const policyName = typeof policy.name === 'string' && policy.name !== '' ? policy.name : undefined;

    for (const rule of policy.rules) {
      if (!rule || typeof rule !== 'object') continue;

      if (rule.kind === 'no-sync-into') {
        const targets = resolvePolicyTarget(real, rule.target ?? '');
        if (targets.size === 0) continue; // target not in this repo — no verdict to give
        for (const edge of addedEdges) {
          if (!SYNC_EDGE_KINDS.has(edge.kind)) continue;
          const direct = targets.has(edge.dstId);
          const reached = direct ? undefined : [...reachableFrom(edge.dstId)].find((id) => targets.has(id));
          if (!direct && reached === undefined) continue;
          const targetId = direct ? edge.dstId : reached!;
          const path = direct
            ? `lands directly on ${targetId}`
            : `reaches ${targetId} through ${edge.dstId}`;
          push(blocks, {
            ruleKind: 'no-sync-into',
            policyName,
            ruleReason: rule.reason,
            edge,
            explanation: withReason(
              `Policy rule no-sync-into "${rule.target}": the proposed ${edge.kind} call ${edgeWords(edge)} ${path}`,
              rule.reason,
            ),
          });
        }
        continue;
      }

      if (rule.kind === 'no-db-write-into') {
        const targets = resolvePolicyTarget(real, rule.target ?? '');
        if (targets.size === 0) continue;
        for (const edge of addedEdges) {
          if (edge.kind !== 'db_write') continue;
          if (!targets.has(edge.dstId)) continue;
          push(blocks, {
            ruleKind: 'no-db-write-into',
            policyName,
            ruleReason: rule.reason,
            edge,
            explanation: withReason(
              `Policy rule no-db-write-into "${rule.target}": the proposed db_write ${edgeWords(edge)} lands on ${edge.dstId}`,
              rule.reason,
            ),
          });
        }
        continue;
      }

      if (rule.kind === 'flag-network-hop') {
        for (const edge of addedEdges) {
          const newSrc = !realIds.has(edge.srcId);
          const newDst = !realIds.has(edge.dstId);
          if (!newSrc && !newDst) continue;
          const which = newSrc && newDst
            ? `${edge.srcId} and ${edge.dstId} are both new`
            : `${newSrc ? edge.srcId : edge.dstId} is new`;
          push(warns, {
            ruleKind: 'flag-network-hop',
            policyName,
            ruleReason: rule.reason,
            edge,
            explanation: withReason(
              `Policy rule flag-network-hop: ${edgeWords(edge)} adds a network hop to a component that is not in the scanned system yet (${which})`,
              rule.reason,
            ),
          });
        }
      }
    }
  }

  return { ok: blocks.length === 0, blocks, warns };
}

/** True when nothing fired at all — the "byte-identical to before" fast read. */
export function policyVerdictIsEmpty(v: PolicyVerdict | null | undefined): boolean {
  return !v || (v.blocks.length === 0 && v.warns.length === 0);
}
