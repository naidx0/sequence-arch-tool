/* ══════════════════════════════════════════════════════════════════════════
   COMPUTED CHARTS — arithmetic, not generation
   packages/export/src/graphStats.ts

   Owner walk 2026-08-22: "Obviously, I don't have an AI added, so I can have
   an AI-generated chart, but if possible, it'd be really good to add a type of
   chart or have a little bit more in-depth of a chart."

   THE "OBVIOUSLY" IS THE REQUIREMENT. Every number here is counted off the
   graph, so all of it works with no network and no key — which is
   non-negotiable 2, and the reason these are worth building at all. A chart
   that needed a provider would be the one part of the product that stops
   working on a plane.

   ── AND THEY ANSWER QUESTIONS GREP CANNOT ────────────────────────────────

   CANON's measured advantage: "Grep cannot rank by importance." These are the
   rankings. Fan-in says what would break; fan-out says what a file is carrying;
   the thin list says where the graph knows least, which is the honest
   counterpart to centrality and the one nobody builds.

   PURE, and every function returns [] rather than throwing on an empty graph —
   a chart surface that crashes on a repository with no edges is worse than one
   that says there are none.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph, ArchNode } from '@sequence/schema';

/** One row of a ranked chart. */
export interface StatRow {
  id: string;
  label: string;
  /** What is being counted. */
  value: number;
  /** The node's kind, so a chart can draw the silhouette beside the row. */
  kind: string;
}

function labelOf(node: ArchNode): string {
  return node.label || node.id;
}

/**
 * Degree ranking.
 *
 * `inbound` counts edges arriving — how much would notice if this changed.
 * `outbound` counts edges leaving — how much this one is carrying.
 *
 * They are DIFFERENT QUESTIONS and a single "degree" number answers neither: a
 * node with 40 in and 0 out is a foundation, one with 0 in and 40 out is an
 * entry point, and their combined degree is identical.
 */
export function degreeRanking(
  graph: ArchGraph,
  direction: 'inbound' | 'outbound',
  limit = 10,
): StatRow[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const counts = new Map<string, number>();

  for (const edge of graph.edges) {
    const id = direction === 'inbound' ? edge.dstId : edge.srcId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, value]) => {
      const node = byId.get(id)!;
      return { id, label: labelOf(node), value, kind: node.kind };
    })
    /* Ties broken by NAME, so two nodes with the same degree do not swap
       places between scans and make a chart look alive when nothing moved. */
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** How many source files and edges each package contributed. */
export interface PackageRow {
  name: string;
  files: number;
  edges: number;
}

/**
 * Composition by package.
 *
 * INCLUDES THE ZEROES. A package that contributed nothing looks exactly like a
 * package with nothing wrong in it, and leaving it off the chart is how the
 * second reading wins silently.
 */
export function packageComposition(graph: ArchGraph): PackageRow[] {
  const rows = new Map<string, PackageRow>();

  const pkgOf = (path: string | undefined): string => {
    if (!path) return '(root)';
    const m = /^packages\/([^/]+)\//.exec(path.replace(/\\/g, '/'));
    return m ? m[1]! : '(root)';
  };

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    const name = pkgOf(node.path);
    const row = rows.get(name) ?? { name, files: 0, edges: 0 };
    row.files += 1;
    rows.set(name, row);
  }

  for (const edge of graph.edges) {
    const src = byId.get(edge.srcId);
    if (!src || src.kind !== 'file') continue;
    const name = pkgOf(src.path);
    const row = rows.get(name) ?? { name, files: 0, edges: 0 };
    row.edges += 1;
    rows.set(name, row);
  }

  return [...rows.values()].sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
}

/**
 * Nodes the scan barely touched.
 *
 * THE HONEST COUNTERPART TO CENTRALITY, and the one nobody builds. A ranking of
 * the most-connected nodes tells a reader where the system is; this tells them
 * where the GRAPH is weakest, which is where its answers are least worth
 * trusting. Those are different facts and only one of them is flattering.
 */
export function thinnest(graph: ArchGraph, limit = 10): StatRow[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  /*
   * DEGREE IS COUNTED ON THE CONTAINER, NOT THE NODE THE EDGE LANDS ON.
   *
   * Measured on the real repository, and it is why this function is not three
   * lines: nearly every edge in a scan joins two FILE nodes, so every service
   * has a direct degree of zero. The first draft duly reported all ten
   * services as the thinnest things in the graph, tied at 0 — a chart that
   * was perfectly correct and said nothing.
   *
   * Lifting to the containing service is the same walk `buildLift` does for
   * the projector, so "which service is this edge in" has one answer across
   * the product rather than two.
   */
  const containerOf = (id: string): string | null => {
    let cur = byId.get(id);
    let hops = 0;
    while (cur && hops++ < 32) {
      if (cur.kind === 'service' || cur.kind === 'datastore' || cur.kind === 'topic') return cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };

  const degree = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === 'service' || node.kind === 'datastore' || node.kind === 'topic') {
      degree.set(node.id, 0);
    }
  }

  for (const edge of graph.edges) {
    const src = containerOf(edge.srcId);
    const dst = containerOf(edge.dstId);
    /* An edge INSIDE one container says nothing about how connected that
       container is to the rest of the system — which is the question. */
    if (src && dst && src === dst) continue;
    if (src) degree.set(src, (degree.get(src) ?? 0) + 1);
    if (dst) degree.set(dst, (degree.get(dst) ?? 0) + 1);
  }

  return [...degree.entries()]
    .map(([id, value]) => {
      const node = byId.get(id)!;
      return { id, label: labelOf(node), value, kind: node.kind };
    })
    .sort((a, b) => a.value - b.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** How far a change reaches, hop by hop. */
export interface ReachRow {
  depth: number;
  /** Cumulative distinct nodes reached at this depth. */
  reached: number;
  /** New at this depth alone. */
  added: number;
}

/**
 * Transitive reach from one node, by hop.
 *
 * This is the blast radius, and it is the strongest thing the graph does that
 * a grep cannot: each further hop costs ONE call here and one lookup per file
 * found there. The closure stops when a hop adds nothing, so the last row is
 * the whole answer rather than an arbitrary cut-off.
 */
export function reachByDepth(graph: ArchGraph, nodeId: string, maxDepth = 6): ReachRow[] {
  const inbound = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = inbound.get(edge.dstId);
    if (list) list.push(edge.srcId);
    else inbound.set(edge.dstId, [edge.srcId]);
  }

  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  const rows: ReachRow[] = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const from of inbound.get(id) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        next.push(from);
      }
    }
    /* A hop that adds nothing ends it. Reporting empty rows to a fixed depth
       would draw a chart with a flat tail that says only "we stopped asking". */
    if (next.length === 0) break;
    rows.push({ depth, reached: seen.size - 1, added: next.length });
    frontier = next;
  }

  return rows;
}

/** Everything a charts surface needs, computed in one pass over the graph. */
export interface GraphStats {
  dependedOn: StatRow[];
  dependsOn: StatRow[];
  packages: PackageRow[];
  thin: StatRow[];
  totals: { nodes: number; edges: number };
}

export function graphStats(graph: ArchGraph, limit = 10): GraphStats {
  return {
    dependedOn: degreeRanking(graph, 'inbound', limit),
    dependsOn: degreeRanking(graph, 'outbound', limit),
    packages: packageComposition(graph),
    thin: thinnest(graph, limit),
    totals: { nodes: graph.nodes.length, edges: graph.edges.length },
  };
}
