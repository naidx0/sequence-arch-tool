/**
 * @sequence/export — the pure, browser-safe projection core shared by all three
 * export formats (Mermaid sequence, Mermaid flowchart, dependency matrix).
 *
 * ── Anti-drift design (READ THIS) ────────────────────────────────────────────
 * The service-level projection semantics — "lift every leaf endpoint to its
 * owning service / datastore / topic, drop imports and self-loops, collapse
 * db_read/db_write/db_access into the db_access family" — are the AUTHORITATIVE
 * definition owned by `packages/analyzer/src/score.ts`
 * (`buildLift` / `kindFamily` / `projectToServiceLevel`, LOCKED).
 *
 * The web app cannot import the analyzer: the analyzer is a Node-oriented package
 * (it reaches for `node:fs`, tree-sitter wasm, graphology, …) and would never
 * bundle for the browser. So this package re-implements the SAME projection over
 * nothing but the `@sequence/schema` types — zero Node imports — and both the
 * analyzer CLI and the web app depend on it.
 *
 * Two copies of a definition is exactly the "driftable duplicate" this project
 * forbids. The lock that makes it safe is NOT code — it is a test that lives in
 * the analyzer package: `src/test/export-parity.test.ts` asserts that
 * `serviceLevelEdgeKeys(graph)` here equals `projectToServiceLevel(graph)` there,
 * byte-for-byte, on both the ticketing spec and a live shopfront scan. If either
 * projection ever drifts, that test fails. This module must never be "fixed" in
 * isolation — change score.ts and this together, and let the parity test prove
 * they still agree.
 *
 * Mode-agnostic: every function here reads only `graph.nodes` / `graph.edges`
 * and walks `parentId`. It never looks at `graph.mode`, so a scanned graph and a
 * hand-authored design spec project through the exact same path.
 */
import type { ArchGraph, ArchEdge } from '@sequence/schema';

export type LiftedKind = 'service' | 'datastore' | 'topic';

export interface Lifted {
  /**
   * The container node’s own graph id — the stable key.
   *
   * A saved board document may carry a display label ("Acp service") where the graph
   * carries "acp", so anything joining a board to the graph must join on THIS. Joining
   * on the label silently produced zero matches and left the Imports toggle disabled on
   * every board written by that path.
   */
  id: string;
  /** The service-level label: a service/datastore label, or `topic:<label>`. */
  label: string;
  kind: LiftedKind;
}

/**
 * Mirror of analyzer `buildLift`: walk a leaf node's parentId chain to the first
 * service / datastore / topic ancestor. Topics are labelled `topic:<label>` to
 * match score.ts exactly (this is what keeps the parity lock green).
 */
export function buildLift(graph: ArchGraph): (id: string) => Lifted | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id: string): Lifted | undefined => {
    let cur = byId.get(id);
    while (cur) {
      if (cur.kind === 'service') return { id: cur.id, label: cur.label, kind: 'service' };
      if (cur.kind === 'datastore') return { id: cur.id, label: cur.label, kind: 'datastore' };
      if (cur.kind === 'topic') return { id: cur.id, label: `topic:${cur.label}`, kind: 'topic' };
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return undefined;
  };
}

/** Mirror of analyzer `kindFamily`: all db_* interaction kinds fold to db_access. */
export function kindFamily(kind: string): string {
  if (kind.startsWith('db_')) return 'db_access';
  return kind;
}

/** A single deduplicated service-level edge, enriched for rendering. */
export interface ProjectedEdge {
  src: string;
  dst: string;
  srcKind: LiftedKind;
  dstKind: LiftedKind;
  /** the kindFamily key (http, grpc, queue_publish, queue_consume, db_access). */
  family: string;
  /** distinct human labels of the member edges, sorted (e.g. `GET /tickets/*`). */
  labels: string[];
}

/**
 * A short, human label for one raw edge, keyed off its ORIGINAL kind + detail
 * (not the family), so `GET /tickets` / `publish ticket.created` / `table tickets`
 * read naturally. Members of one projected edge contribute distinct labels.
 */
export function edgeLabel(e: ArchEdge): string {
  const d = e.detail ?? {};
  const s = (v: unknown): string => (v == null ? '' : String(v));
  switch (e.kind) {
    case 'http': {
      const parts = [s(d.method), s(d.pathPattern)].filter(Boolean);
      return parts.length ? parts.join(' ') : 'http';
    }
    case 'grpc': {
      const m = s(d.method) || s(d.service) || s(d.pathPattern);
      return m ? `grpc ${m}` : 'grpc';
    }
    case 'queue_publish':
      return d.topic ? `publish ${s(d.topic)}` : 'publish';
    case 'queue_consume':
      return d.topic ? `consume ${s(d.topic)}` : 'consume';
    case 'db_read':
      return d.table ? `read ${s(d.table)}` : 'read';
    case 'db_write':
      return d.table ? `write ${s(d.table)}` : 'write';
    case 'db_access':
      return d.table ? `table ${s(d.table)}` : 'db';
    default:
      return e.kind;
  }
}

function edgeKey(src: string, dst: string, family: string): string {
  return `${src} -> ${dst} [${family}]`;
}

/**
 * Project a graph to its deduplicated service-level edges. Dedup key is exactly
 * score.ts's `${src} -> ${dst} [${family}]`; the returned edges are additionally
 * enriched with endpoint kinds and the member labels for rendering. Deterministic
 * order: sorted by that key.
 */
export function projectEdges(graph: ArchGraph): ProjectedEdge[] {
  const lift = buildLift(graph);
  const acc = new Map<string, ProjectedEdge & { _labels: Set<string> }>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src.label === dst.label) continue;
    const family = kindFamily(e.kind);
    const key = edgeKey(src.label, dst.label, family);
    let pe = acc.get(key);
    if (!pe) {
      pe = {
        src: src.label,
        dst: dst.label,
        srcKind: src.kind,
        dstKind: dst.kind,
        family,
        labels: [],
        _labels: new Set<string>(),
      };
      acc.set(key, pe);
    }
    const lbl = edgeLabel(e);
    if (lbl) pe._labels.add(lbl);
  }
  return [...acc.values()]
    .map(({ _labels, ...pe }) => ({ ...pe, labels: [..._labels].sort() }))
    .sort((a, b) =>
      edgeKey(a.src, a.dst, a.family).localeCompare(edgeKey(b.src, b.dst, b.family))
    );
}

/**
 * The exact service-level edge-key set that score.ts's `projectToServiceLevel`
 * produces. This is the surface the analyzer parity test locks against — keep it
 * a thin wrapper over `projectEdges` so the two can never disagree.
 */
export function serviceLevelEdgeKeys(graph: ArchGraph): Set<string> {
  return new Set(projectEdges(graph).map((e) => edgeKey(e.src, e.dst, e.family)));
}

/** Endpoint label -> its lifted kind, over every projected edge. */
export function participantKinds(edges: ProjectedEdge[]): Map<string, LiftedKind> {
  const m = new Map<string, LiftedKind>();
  for (const e of edges) {
    m.set(e.src, e.srcKind);
    m.set(e.dst, e.dstKind);
  }
  return m;
}

/**
 * Deterministic participant ordering, shared by all three projections so they
 * agree on layout. THE RULE:
 *   1. entry-point services first — a `service` participant with no inbound http
 *      edge from another service (i.e. it is not the target of any http-family
 *      edge). These are the front doors of the system. Sorted alphabetically.
 *   2. then every remaining participant (http-reached services, datastores,
 *      topics), sorted alphabetically.
 */
export function orderParticipants(edges: ProjectedEdge[]): string[] {
  return orderParticipantsFrom(participantKinds(edges), edges);
}

/**
 * The same ordering, over a kinds map the caller supplies.
 *
 * It exists because the set of things on a diagram is NOT always the set of
 * things an edge touched. `archGraphToSeqDiagram` places every systems-layer
 * node the scan found, connected or not — a service whose only relationships
 * are imports still exists — and it needs the identical entry-first rule so the
 * three projections keep agreeing about layout.
 *
 * `edges` is still required and still only consulted for inbound-http, which is
 * what makes a service an entry point. A label absent from every edge simply
 * has no inbound http, which is the correct reading: nothing calls it.
 */
export function orderParticipantsFrom(
  kinds: Map<string, LiftedKind>,
  edges: ProjectedEdge[]
): string[] {
  const inboundHttp = new Set<string>();
  for (const e of edges) if (e.family === 'http') inboundHttp.add(e.dst);
  const isEntry = (p: string): boolean =>
    kinds.get(p) === 'service' && !inboundHttp.has(p);
  const all = [...kinds.keys()];
  const entries = all.filter(isEntry).sort();
  const rest = all.filter((p) => !isEntry(p)).sort();
  return [...entries, ...rest];
}

/**
 * Order projected edges to follow the participant flow (source order, then
 * target order, then family) — reads top-to-bottom in a sequence/flow diagram
 * and is fully deterministic.
 */
export function orderEdgesByFlow(
  edges: ProjectedEdge[],
  order: string[]
): ProjectedEdge[] {
  const rank = new Map(order.map((p, i) => [p, i]));
  return [...edges].sort(
    (a, b) =>
      (rank.get(a.src)! - rank.get(b.src)!) ||
      (rank.get(a.dst)! - rank.get(b.dst)!) ||
      a.family.localeCompare(b.family)
  );
}
