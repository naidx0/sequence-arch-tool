/**
 * Circular-dependency advisor (the MOAT, vision.md §2 layer 3 — "a design advisor
 * that flags weak or unscalable architecture"). A directed cycle in the depends-on
 * graph is a real, groundable architecture smell: if A depends on B and B (directly
 * or transitively) depends on A, neither can be built, deployed, failed over, or
 * reasoned about independently, and a fault in one can cascade back around.
 *
 * GROUNDED, like the SPOF advisor: it reads ONLY the real edges (`srcId -> dstId`,
 * where `src depends on dst` — the exact `ImpactLink` shape r11 uses). A cycle is
 * reported only when a genuine strongly-connected component exists in that edge
 * set, so it can never invent a dependency that isn't there.
 *
 * PURE + TOTAL: iterative Tarjan (no recursion → no stack overflow on a large
 * graph), no throw on empty / malformed / self-referential input. The `repo` root
 * is excluded (it is the canvas, not a component).
 */
import type { NodeKind } from './index.js';
import type { ImpactLink } from './impact.js';
import type { RiskNode } from './risks.js';

/** One circular dependency: a set of components that mutually depend on each other. */
export interface CyclicDependency {
  /** The component ids in the cycle (deterministic order: by label, then id). */
  nodes: string[];
  /** Display labels, aligned to `nodes`. */
  labels: string[];
  /** Cycle size — number of components involved (>= 1; 1 only for a self-dependency). */
  size: number;
  /** Grounded, human explanation. */
  reason: string;
}

function reasonFor(size: number, kinds: NodeKind[]): string {
  if (size === 1) {
    return 'depends on itself — a self-referential dependency';
  }
  const hasData = kinds.includes('datastore');
  const tail = hasData
    ? 'they cannot be deployed, failed over, or reasoned about independently'
    : 'they cannot be built, deployed, or reasoned about independently';
  return `circular dependency — ${size} components depend on each other, so ${tail}`;
}

/**
 * Find every circular dependency in the depends-on graph. Returns one entry per
 * strongly-connected component of size >= 2, plus any self-loop (`A -> A`) as a
 * size-1 cycle. Empty when the graph is a clean DAG — the honest "no cycles" state.
 *
 * Deterministic: components are ordered by size (desc) then by first label; the
 * ids within each cycle are ordered by label then id.
 */
export function computeCycles(
  links: Iterable<ImpactLink>,
  nodes: Iterable<RiskNode>,
): CyclicDependency[] {
  // Rankable universe: real components only (drop the repo root), deduped by id.
  const meta = new Map<string, RiskNode>();
  for (const n of nodes) {
    if (!n || n.kind === 'repo' || typeof n.id !== 'string') continue;
    if (!meta.has(n.id)) meta.set(n.id, n);
  }
  if (meta.size === 0) return [];

  // Adjacency over KNOWN nodes only; ignore edges touching unknown/repo ids so a
  // stray edge can never fabricate a component. Track self-loops separately.
  const adj = new Map<string, string[]>();
  for (const id of meta.keys()) adj.set(id, []);
  const selfLoops = new Set<string>();
  for (const e of links) {
    if (!e || typeof e.srcId !== 'string' || typeof e.dstId !== 'string') continue;
    if (!meta.has(e.srcId) || !meta.has(e.dstId)) continue;
    if (e.srcId === e.dstId) {
      selfLoops.add(e.srcId);
      continue;
    }
    adj.get(e.srcId)!.push(e.dstId);
  }

  // Iterative Tarjan SCC. index/lowlink per node; an explicit work stack replaces
  // recursion so a deep graph can't overflow.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const sccStack: string[] = [];
  let counter = 0;
  const components: string[][] = [];

  for (const start of meta.keys()) {
    if (index.has(start)) continue;
    // Each frame: the node + the position of the next neighbour to visit.
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    sccStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = adj.get(frame.v)!;
      if (frame.i < neighbours.length) {
        const w = neighbours[frame.i];
        frame.i++;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          sccStack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
      } else {
        // Done with frame.v — if it's a root of an SCC, pop the component.
        if (low.get(frame.v) === index.get(frame.v)) {
          const comp: string[] = [];
          for (;;) {
            const w = sccStack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === frame.v) break;
          }
          if (comp.length >= 2) components.push(comp);
        }
        work.pop();
        // Propagate lowlink to the parent frame (the recursion's post-call step).
        if (work.length > 0) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
        }
      }
    }
  }

  // Self-loops that aren't already inside a larger SCC become size-1 cycles.
  const inScc = new Set<string>();
  for (const c of components) for (const id of c) inScc.add(id);
  for (const id of selfLoops) if (!inScc.has(id)) components.push([id]);

  const byLabel = (id: string): string => meta.get(id)!.label;
  const cycles: CyclicDependency[] = components.map((comp) => {
    const ordered = [...comp].sort((a, b) => byLabel(a).localeCompare(byLabel(b)) || a.localeCompare(b));
    const kinds = ordered.map((id) => meta.get(id)!.kind);
    return {
      nodes: ordered,
      labels: ordered.map(byLabel),
      size: ordered.length,
      reason: reasonFor(ordered.length, kinds),
    };
  });

  cycles.sort(
    (a, b) =>
      b.size - a.size ||
      (a.labels[0] ?? '').localeCompare(b.labels[0] ?? '') ||
      // Final total tiebreak: the id lists are unique per cycle (SCCs are disjoint).
      a.nodes.join('>').localeCompare(b.nodes.join('>')),
  );
  return cycles;
}
