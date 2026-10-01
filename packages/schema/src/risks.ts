/**
 * System-risk advisor (the MOAT, vision.md §2 layer 3: "a design advisor that
 * flags weak or unscalable architecture"). Builds DIRECTLY on the r11
 * failure-impact analysis: it surfaces the architecture's single points of
 * failure by ranking every node by its BLAST RADIUS — the exact `impactedBy`
 * set computed by {@link computeImpact} (an edge `src -> dst` means "src depends
 * on dst", so `impactedBy(N)` is everything that breaks if N fails).
 *
 * This module adds NO new SEMANTICS: every reported blast radius is exactly
 * `computeImpact(links, id).impactedBy.length`. It does, however, compute them
 * all in ONE shared pass instead of one DFS per node — see
 * {@link blastRadiusCounts} for why (the naive loop is quadratic and measurably
 * unusable on real repos). Every reported risk is therefore still GROUNDED, and
 * risks.test.ts locks the shared pass against a naive `computeImpact`-per-node
 * reference on cyclic, disconnected, self-looping and real-repo graphs.
 *
 * SEVERITY is an honest fraction of the system: `fraction = blastRadius / total`
 * where `total` is the number of rankable nodes (every non-`repo` node in the
 * analysis universe — the same denominator the copy cites as "N of TOTAL nodes
 * break"). The thresholds:
 *   - critical : fraction >= 0.5  (failing this one node breaks at least half of
 *                the whole system)
 *   - high     : fraction >= 0.3
 *   - moderate : fraction >= 0.15
 * A node is reported ONLY when it clears the moderate floor AND breaks at least
 * {@link MIN_BLAST} other nodes — a node with a single dependent is not a
 * "single point of failure", and a leaf (blast radius 0) is never a risk. So a
 * flat/leaf-only graph yields an EMPTY list (the honest "no SPOF" state), and an
 * empty or single-node graph yields nothing without throwing. PURE + TOTAL.
 */
import type { NodeKind } from './index.js';
import {
  buildImpactAdjacency,
  impactClosure,
  type ImpactAdjacency,
  type ImpactLink,
} from './impact.js';

/** The minimal node shape the advisor ranks over (id + kind + display label). */
export interface RiskNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export type RiskSeverity = 'critical' | 'high' | 'moderate';

export interface SystemRisk {
  /** The node this risk is about — click-to-select feeds this straight to the r11 overlay. */
  nodeId: string;
  label: string;
  kind: NodeKind;
  /** Blast radius: `computeImpact(links, nodeId).impactedBy.length` — the grounding count. */
  blastRadius: number;
  /** The ACTUAL dependent ids that break if this node fails (the r11 blast radius). */
  impactedBy: string[];
  /** Direct dependents only (one hop) — the fan-in, for the "hub" framing. */
  directDependents: number;
  /** Denominator: the number of rankable (non-repo) nodes in the analysis universe. */
  total: number;
  /** `blastRadius / total`, the fraction of the whole system that breaks. */
  fraction: number;
  severity: RiskSeverity;
  /** Grounded, human explanation, e.g. "single point of failure — 6 of 9 nodes break if it fails". */
  reason: string;
}

/** A node with a single dependent is a dependency, not a "single point of failure". */
export const MIN_BLAST = 2;

/** Severity fraction thresholds (documented in the module header). */
export const SEVERITY_THRESHOLDS: { critical: number; high: number; moderate: number } = {
  critical: 0.5,
  high: 0.3,
  moderate: 0.15,
};

/** Default cap on how many risks the summary surfaces — don't spew on a big graph. */
export const DEFAULT_TOP_N = 6;

/**
 * The number of RANKABLE nodes — every real component, the `repo` root dropped,
 * deduped by id. This is EXACTLY the denominator {@link computeRisks} uses for
 * severity fractions and the "N of TOTAL nodes break" copy (a test locks
 * `rankableNodeCount(nodes) === computeRisks(links, nodes)[0].total`). The UI
 * feeds the same count to the RisksPanel's "N nodes analyzed" line so the panel's
 * total can never disagree with the per-risk reason strings.
 */
export function rankableNodeCount(nodes: Iterable<Pick<RiskNode, 'id' | 'kind'>>): number {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!n || n.kind === 'repo' || typeof n.id !== 'string') continue;
    ids.add(n.id);
  }
  return ids.size;
}

function severityOf(fraction: number): RiskSeverity | undefined {
  if (fraction >= SEVERITY_THRESHOLDS.critical) return 'critical';
  if (fraction >= SEVERITY_THRESHOLDS.high) return 'high';
  if (fraction >= SEVERITY_THRESHOLDS.moderate) return 'moderate';
  return undefined;
}

/**
 * Compose the grounded one-line reason. A datastore is called out as the classic
 * shared-store SPOF; a service/other with a large fan-in blast reads as a hub.
 * The count/total are the real numbers, so this can never overstate the risk.
 */
function reasonFor(kind: NodeKind, blastRadius: number, total: number): string {
  const noun =
    kind === 'datastore'
      ? 'shared datastore — single point of failure'
      : 'single point of failure';
  const nodes = blastRadius === 1 ? 'node' : 'nodes';
  return `${noun}: ${blastRadius} of ${total} ${nodes} break if it fails`;
}

/**
 * BLAST RADIUS FOR EVERY NODE AT ONCE — the one traversal this module does.
 *
 * `impactedBy(n)` is the set of nodes that can REACH `n`. Asking that question
 * per node (the shipped shape: `computeImpact` once per node) is O(N·(N+E)) —
 * measured at 1.9s for 1,141 nodes and 6.6 MINUTES at 11.5k, which real repos hit.
 * Reachability is not decomposable node-by-node, so instead of N independent
 * DFSs this does ONE pass over the whole graph:
 *
 *   1. Condense the strongly-connected components (iterative Tarjan, O(N+E)).
 *      Every member of an SCC reaches every other member, so within a component
 *      the answer is identical for all members — one computation, not |S|.
 *   2. Walk the condensation in TOPOLOGICAL order (Tarjan finishes components in
 *      reverse topological order, so descending component index is topological)
 *      and propagate a bitset of "which components reach me":
 *          R(v) = ⋃ over cond-edges u→v of ( R(u) ∪ {u} )
 *      Each cond-edge costs one word-wise OR, so the pass is O(E·C/32).
 *   3. blastRadius(n in component S) = (|S| − 1) + Σ |D| for D ∈ R(S).
 *      The `−1` is `n` itself, which its own closure excludes — exactly the
 *      `cur === start` guard in {@link impactClosure}.
 *
 * A component's bitset is released as soon as its last successor has consumed
 * it, so peak memory tracks the DAG frontier rather than C².
 *
 * The result is EXACTLY `computeImpact(links, id).impactedBy.length` for every
 * id (risks.test.ts pins this against a naive reference over cyclic,
 * disconnected, self-looping, duplicate-edge and real-repo graphs).
 */
function blastRadiusCounts(adj: ImpactAdjacency): Map<string, number> {
  const counts = new Map<string, number>();
  const ids = [...adj.endpoints];
  const n = ids.length;
  if (n === 0) return counts;

  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(ids[i]!, i);
  const EMPTY = new Int32Array(0);
  const succ: Int32Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = adj.out.get(ids[i]!);
    if (!s || s.size === 0) {
      succ[i] = EMPTY;
      continue;
    }
    const a = new Int32Array(s.size);
    let k = 0;
    for (const t of s) a[k++] = index.get(t)!;
    succ[i] = a;
  }

  // --- 1. Iterative Tarjan SCC (recursion would blow the stack on real repos).
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const compSize: number[] = [];
  const sccStack: number[] = [];
  const frameNode: number[] = [];
  const frameEdge: number[] = [];
  let counter = 0;
  let nComp = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    disc[root] = low[root] = counter++;
    sccStack.push(root);
    onStack[root] = 1;
    frameNode.push(root);
    frameEdge.push(0);
    while (frameNode.length) {
      const v = frameNode[frameNode.length - 1]!;
      const nbrs = succ[v]!;
      const ei = frameEdge[frameEdge.length - 1]!;
      if (ei < nbrs.length) {
        frameEdge[frameEdge.length - 1] = ei + 1;
        const w = nbrs[ei]!;
        if (disc[w] === -1) {
          disc[w] = low[w] = counter++;
          sccStack.push(w);
          onStack[w] = 1;
          frameNode.push(w);
          frameEdge.push(0);
        } else if (onStack[w] && disc[w]! < low[v]!) {
          low[v] = disc[w]!;
        }
      } else {
        frameNode.pop();
        frameEdge.pop();
        if (low[v] === disc[v]) {
          let size = 0;
          let w: number;
          do {
            w = sccStack.pop()!;
            onStack[w] = 0;
            comp[w] = nComp;
            size++;
          } while (w !== v);
          compSize.push(size);
          nComp++;
        }
        if (frameNode.length) {
          const p = frameNode[frameNode.length - 1]!;
          if (low[v]! < low[p]!) low[p] = low[v]!;
        }
      }
    }
  }

  // --- 2. Condensation DAG. Tarjan numbering ⇒ for every cond-edge c→d, c > d.
  const condSucc: Set<number>[] = new Array(nComp);
  for (let c = 0; c < nComp; c++) condSucc[c] = new Set();
  for (let v = 0; v < n; v++) {
    const cv = comp[v]!;
    for (const w of succ[v]!) {
      const cw = comp[w]!;
      if (cv !== cw) condSucc[cv]!.add(cw);
    }
  }
  const condPred: number[][] = new Array(nComp);
  for (let c = 0; c < nComp; c++) condPred[c] = [];
  const pending = new Int32Array(nComp); // unconsumed successors ⇒ when 0, free
  for (let c = 0; c < nComp; c++) {
    pending[c] = condSucc[c]!.size;
    for (const d of condSucc[c]!) condPred[d]!.push(c);
  }

  // Components bigger than one node are rare; tracking them separately lets the
  // per-component weight be a popcount plus a tiny correction, instead of an
  // O(C) walk over every set bit.
  const nonTrivial: number[] = [];
  for (let c = 0; c < nComp; c++) if (compSize[c]! > 1) nonTrivial.push(c);

  // --- 3. Topological propagation (descending component index).
  const words = (nComp + 31) >>> 5;
  const bits: (Uint32Array | null)[] = new Array(nComp).fill(null);
  const weight = new Array<number>(nComp).fill(0);
  for (let v = nComp - 1; v >= 0; v--) {
    const reach = new Uint32Array(words);
    for (const u of condPred[v]!) {
      const ru = bits[u]!;
      for (let i = 0; i < words; i++) reach[i]! |= ru[i]!;
      reach[u >>> 5]! |= 1 << (u & 31);
      if (--pending[u]! === 0) bits[u] = null; // last consumer ⇒ release
    }
    let w = 0;
    for (let i = 0; i < words; i++) {
      // Hamming weight of a 32-bit word.
      let x = reach[i]!;
      x = x - ((x >>> 1) & 0x55555555);
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      w += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    for (const c of nonTrivial) {
      if (reach[c >>> 5]! & (1 << (c & 31))) w += compSize[c]! - 1;
    }
    weight[v] = w;
    bits[v] = pending[v] === 0 ? null : reach;
  }

  for (let i = 0; i < n; i++) {
    const c = comp[i]!;
    counts.set(ids[i]!, compSize[c]! - 1 + weight[c]!);
  }
  return counts;
}

/**
 * Rank the single-points-of-failure in a graph. `links` is the same directed
 * `src -> dst` (= depends-on) edge list r11's {@link computeImpact} consumes —
 * pass the raw `ArchGraph.edges` (analysis/tests) or the aggregated on-screen
 * `view.edges` (the UI, so a clicked risk selects a rendered node and lights up
 * the exact same blast radius). `nodes` is the analysis universe; the `repo`
 * root is excluded from both ranking and the denominator (it is the canvas, not
 * a component).
 *
 * Returns risks sorted by blast radius (desc), tie-broken by fraction then id,
 * capped to `topN`. Empty when no node clears the SPOF floor — the honest
 * "no single points of failure" state.
 */
export function computeRisks(
  links: Iterable<ImpactLink>,
  nodes: Iterable<RiskNode>,
  opts?: { topN?: number }
): SystemRisk[] {
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  // Rankable universe: every real component (drop the repo root). Dedupe by id.
  const ranked = new Map<string, RiskNode>();
  for (const n of nodes) {
    if (!n || n.kind === 'repo' || typeof n.id !== 'string') continue;
    if (!ranked.has(n.id)) ranked.set(n.id, n);
  }
  const total = ranked.size;
  if (total === 0) return [];

  // Scan the links ONCE into adjacency, then get every node's blast radius from a
  // single shared pass (see blastRadiusCounts) rather than one DFS per node.
  const adj = buildImpactAdjacency(links);
  const counts = blastRadiusCounts(adj);

  // Rank on the counts alone — every sort key (blastRadius, then fraction, then
  // id) is derived from them, so the full `impactedBy` id list only has to be
  // materialized for the handful of risks that actually survive the `topN` cut.
  const ranking: { node: RiskNode; blastRadius: number; fraction: number; severity: RiskSeverity }[] =
    [];
  for (const node of ranked.values()) {
    const blastRadius = counts.get(node.id) ?? 0;
    if (blastRadius < MIN_BLAST) continue; // a leaf / single-dependent is not a SPOF
    const fraction = blastRadius / total;
    const severity = severityOf(fraction);
    if (!severity) continue; // below the moderate floor — not a system risk
    ranking.push({ node, blastRadius, fraction, severity });
  }

  ranking.sort(
    (a, b) =>
      b.blastRadius - a.blastRadius ||
      b.fraction - a.fraction ||
      a.node.id.localeCompare(b.node.id)
  );

  return ranking.slice(0, topN).map(({ node, blastRadius, fraction, severity }) => ({
    nodeId: node.id,
    label: node.label,
    kind: node.kind,
    blastRadius,
    impactedBy: [...impactClosure(adj.inn, node.id)].sort(),
    directDependents: adj.inn.get(node.id)?.size ?? 0,
    total,
    fraction,
    severity,
    reason: reasonFor(node.kind, blastRadius, total),
  }));
}

/**
 * The click-a-risk → selection mapping, extracted as a pure (and locked) helper:
 * selecting a risk simply selects its node, which drives the EXACT r11
 * selection → `computeImpact` → blast-radius highlight path (no overlay is
 * duplicated). Returns the node id to hand to the store's `selectNode`.
 */
export function riskFocusTarget(risk: Pick<SystemRisk, 'nodeId'>): string {
  return risk.nodeId;
}
