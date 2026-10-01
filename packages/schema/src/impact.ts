/**
 * Dependency + failure-impact intelligence (the MOAT, vision.md §2 layer 2:
 * "show what depends on what and 'if this fails, these fail'").
 *
 * EDGE DIRECTION — the load-bearing fact this whole feature rests on.
 * The analyzer emits an interaction edge `srcId -> dstId` from the CALLER to the
 * CALLEE: the shopfront ground-truth records `gateway calls orders` as
 * `{ src: gateway, dst: orders }` (packages/analyzer/test/fixtures/shopfront/
 * ground-truth.json), and join.ts sets `srcId: fileId(client.file)` /
 * `dstId: <target service/route/datastore>` for every kind (http/grpc/queue/db).
 * So, precisely:
 *
 *   edge X -> Y  ⇔  "X depends on Y"  (X needs Y to function).
 *
 * Therefore:
 *   - dependsOn(N)   = forward closure: every node reachable from N by walking
 *     edges in the src->dst direction. "What N relies on."
 *   - impactedBy(N)  = reverse closure: every node that can reach N by walking
 *     edges in the src->dst direction — i.e. everything that (transitively)
 *     DEPENDS ON N. "If N fails, THESE break." This is the blast radius.
 *
 * The two are exact mirror images; swapping the adjacency direction swaps the
 * two answers, which is the single most important thing to get right (a locking
 * test in impact.test.ts fails if they are transposed).
 *
 * The core operates on a bare list of directed links so it can be driven by the
 * raw ArchGraph edges (analysis / tests) OR by the aggregated on-screen view
 * edges (the canvas overlay) with identical, tested semantics. It is PURE and
 * TOTAL: cycles terminate, a missing/unknown node yields empty sets, self-loops
 * never place a node in its own result — it never throws.
 */

/** The minimal shape both ArchEdge and the view's AggEdge satisfy. */
export interface ImpactLink {
  srcId: string;
  dstId: string;
}

export interface ImpactResult {
  /** The node the impact was computed for. */
  nodeId: string;
  /** Did the node appear in the graph at all (as an endpoint or a listed id)? */
  exists: boolean;
  /** Direct dependencies: N -> Y for one hop (N relies on these directly). */
  dependsOnDirect: string[];
  /** All dependencies (direct + transitive), sorted, excluding N itself. */
  dependsOn: string[];
  /** Direct dependents: X -> N for one hop (these break FIRST if N fails). */
  impactedByDirect: string[];
  /** Blast radius: all dependents (direct + transitive), sorted, excluding N. */
  impactedBy: string[];
}

const sorted = (s: Iterable<string>) => [...new Set(s)].sort();

/**
 * The de-duplicated, direction-split adjacency a link list induces. Built ONCE
 * by {@link buildImpactAdjacency} and reused by every consumer, so there is a
 * single implementation of "what does this edge list mean" that cannot drift.
 */
export interface ImpactAdjacency {
  /** out[a] = nodes `a` depends on directly (a -> b). */
  out: Map<string, Set<string>>;
  /** inn[b] = nodes that depend on `b` directly (a -> b). */
  inn: Map<string, Set<string>>;
  /** Every id that appears as an endpoint, INCLUDING self-loop-only nodes. */
  endpoints: Set<string>;
}

/**
 * Scan a link list into {@link ImpactAdjacency}. Malformed entries are skipped
 * and self-loops are recorded as endpoints but never as adjacency, so a node can
 * never land in its own closure.
 *
 * PERF: this scan is O(E) and used to be repeated inside every `computeImpact`
 * call, which made a per-node loop (`computeRisks`) O(N·E). Callers that need
 * many nodes' answers should build the adjacency once and drive
 * {@link impactClosure} / {@link impactFromAdjacency} from it.
 */
export function buildImpactAdjacency(links: Iterable<ImpactLink>): ImpactAdjacency {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const endpoints = new Set<string>();
  for (const e of links) {
    if (!e) continue;
    const { srcId: s, dstId: d } = e;
    if (typeof s !== 'string' || typeof d !== 'string') continue;
    endpoints.add(s);
    endpoints.add(d);
    if (s === d) continue; // self-loop: never contributes a node to its own sets
    (out.get(s) ?? out.set(s, new Set()).get(s)!).add(d);
    (inn.get(d) ?? inn.set(d, new Set()).get(d)!).add(s);
  }
  return { out, inn, endpoints };
}

/**
 * Transitive closure from `start` along `adj`, excluding `start` itself.
 * Cycle-safe (visited set terminates); a missing `start` yields the empty set.
 */
export function impactClosure(adj: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === start || seen.has(cur)) continue; // visited-set terminates cycles
    seen.add(cur);
    for (const nxt of adj.get(cur) ?? []) {
      if (nxt !== start && !seen.has(nxt)) stack.push(nxt);
    }
  }
  return seen;
}

/**
 * The core of {@link computeImpact}, over an already-built adjacency. Exposed so
 * multi-node callers pay the O(E) scan once instead of once per node — the
 * result is byte-identical to `computeImpact(links, nodeId)`.
 */
export function impactFromAdjacency(adj: ImpactAdjacency, nodeId: string): ImpactResult {
  return {
    nodeId,
    exists: adj.endpoints.has(nodeId),
    dependsOnDirect: sorted(adj.out.get(nodeId) ?? []),
    dependsOn: sorted(impactClosure(adj.out, nodeId)),
    impactedByDirect: sorted(adj.inn.get(nodeId) ?? []),
    impactedBy: sorted(impactClosure(adj.inn, nodeId)),
  };
}

/**
 * Compute the dependency + failure-impact sets for `nodeId` over `links`.
 *
 * `links` is any iterable of directed `src -> dst` (= depends-on) edges; pass
 * `graph.edges` (optionally pre-filtered) or the aggregated view edges. The
 * result ids are exactly the endpoint ids that appear in `links`.
 */
export function computeImpact(links: Iterable<ImpactLink>, nodeId: string): ImpactResult {
  return impactFromAdjacency(buildImpactAdjacency(links), nodeId);
}

/**
 * Per-rendered-node highlight roles for the arch-graph overlay.
 *  - `selected`   : the node the impact is anchored on (emphasized).
 *  - `impacted`   : in the blast radius — breaks if the selected node fails
 *    (danger tint). This is the headline the feature exists to surface.
 *  - `dependency` : something the selected node relies on (secondary tint).
 * Every OTHER rendered node is dimmed, reusing the canvas's existing `dimmed`
 * treatment so the highlighted set stands out exactly like the Learn spotlight.
 */
export type ImpactRole = 'selected' | 'impacted' | 'dependency';

export interface ImpactHighlight {
  /** rendered node id -> its role (absent ⇒ dimmed). */
  roles: Map<string, ImpactRole>;
  /** rendered node ids to dim (everything with no role). */
  dimmed: Set<string>;
}

/**
 * Map an {@link ImpactResult} onto the currently-rendered node ids. Precedence
 * when a node is both a dependency and a dependent (only possible through a
 * cycle): selected > impacted > dependency — the blast radius wins, since that
 * is the alarming, must-not-be-missed relationship.
 */
export function impactHighlight(
  result: ImpactResult,
  renderedIds: Iterable<string>
): ImpactHighlight {
  const impacted = new Set(result.impactedBy);
  const depends = new Set(result.dependsOn);
  const roles = new Map<string, ImpactRole>();
  const dimmed = new Set<string>();
  for (const id of renderedIds) {
    if (id === result.nodeId) roles.set(id, 'selected');
    else if (impacted.has(id)) roles.set(id, 'impacted');
    else if (depends.has(id)) roles.set(id, 'dependency');
    else dimmed.add(id);
  }
  return { roles, dimmed };
}
