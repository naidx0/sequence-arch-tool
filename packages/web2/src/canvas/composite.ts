/* ══════════════════════════════════════════════════════════════════════════
   THE COMPOSITE BOARD — groups as nodes, expanded in place
   packages/web2/src/canvas/composite.ts

   Pure. The board's document lists the groups the scan found (services,
   datastores, topics; or a focused group's modules). `compositeDocument` adds
   the members of every EXPANDED group as nested nodes and re-lifts the scan's
   edges so each one joins at whatever is visible: a file-level call from a
   module inside an expanded service to a collapsed service is drawn from the
   module to the service.

   THE FIRST SCREEN HOLDS ABOUT FIFTY BOXES AND NO MORE. Readers lose track of
   a dense node-link picture above roughly fifty nodes (Yoghourdjian et al.),
   so expansion stops adding members once the board holds `budget` boxes and
   the group says how many it left out.

   IMPORTS ARE NOT EDGES HERE. They are counted (`importEdges`) and drawn only
   when the reader asks, because on a real repository nearly every edge the
   scan finds is an import and drawing them all is noise.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  ArchGraph,
  ArchNode,
  Evidence,
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramNode,
  SeqDiagramNodeDetail,
  SeqDiagramV1,
} from '@sequence/schema';

/** Boxes on the first screen: the ceiling expansion respects. */
export const BOX_BUDGET = 50;

export interface CompositeGroup {
  /** The expanded node; it is drawn as a frame around its members. */
  id: string;
  /** Members drawn inside it, in draw order. */
  memberIds: string[];
  /** Members the scan found inside it, test files not counted. */
  total: number;
  /** Test files inside it, not drawn by default: the frame's "tests (n)" chip. */
  tests: number;
}

/** A test file by its name or path: *.test.*, *.spec.*, test_*.py, or under
 *  a test/tests/__tests__ folder. */
export function isTestFile(node: { kind?: string; label?: string; path?: string }): boolean {
  if (node.kind !== 'file') return false;
  const p = `${node.path ?? ''}/${node.label ?? ''}`.replace(/\\/g, '/');
  return /\.(test|spec)\.[a-z0-9]+$/i.test(p) || /(^|\/)test_[^/]+\.py$/i.test(p) || /(^|\/)(tests?|__tests__)\//i.test(p);
}

export interface CompositeDocument {
  doc: SeqDiagramV1;
  /** Member id -> the expanded node it is drawn inside. */
  parentOf: Record<string, string>;
  groups: CompositeGroup[];
  /** Lifted edge id -> how many scanned edges it merges (§3.2: one line per
   *  source, target and kind, standing for all of them). */
  merged: Record<string, number>;
}

const NODE_KINDS = new Set(['module', 'file', 'package', 'function', 'service', 'datastore', 'topic']);

function seqKind(kind: string): SeqDiagramNode['kind'] {
  return (NODE_KINDS.has(kind) ? kind : 'module') as SeqDiagramNode['kind'];
}

export function familyOf(kind: string): SeqDiagramEdgeFamily {
  if (kind === 'import') return 'import';
  if (kind === 'http' || kind === 'grpc') return kind;
  if (kind.startsWith('queue_')) return 'queue';
  if (kind.startsWith('db_')) return 'db';
  return 'call';
}

function evidenceRefOf(node: ArchNode): string | undefined {
  return node.path ? `scan:${node.path}` : undefined;
}

/** Children of a node in the scan, the ones worth drawing first. A group with
 *  modules shows its modules (loose files stay inside the frame's count); a
 *  group without shows its members. Ordered by how connected they are, then by
 *  name, so the same scan always draws the same members. */
export function membersOf(graph: ArchGraph, id: string, degree: ReadonlyMap<string, number>): ArchNode[] {
  const all = graph.nodes.filter((n) => n.parentId === id);
  const modules = all.filter((n) => n.kind !== 'file');
  const pool = modules.length > 0 && all.some((n) => n.kind === 'module') ? modules : all;
  return [...pool].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      (a.label ?? a.id).localeCompare(b.label ?? b.id),
  );
}

export function degreeOf(graph: ArchGraph): Map<string, number> {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.srcId, (degree.get(e.srcId) ?? 0) + 1);
    degree.set(e.dstId, (degree.get(e.dstId) ?? 0) + 1);
  }
  return degree;
}

/** Map any scan id to the deepest node the board draws, or undefined. */
export function liftTo(
  graph: ArchGraph,
  visible: ReadonlySet<string>,
): (id: string) => string | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const memo = new Map<string, string | undefined>();
  return (id: string) => {
    if (memo.has(id)) return memo.get(id);
    const seen = new Set<string>();
    let cur: string | undefined = id;
    let out: string | undefined;
    while (cur && !seen.has(cur)) {
      if (visible.has(cur)) {
        out = cur;
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    memo.set(id, out);
    return out;
  };
}

/** True when `a` is `b` or contains it, in the drawn nesting. */
function nests(parentOf: Readonly<Record<string, string>>, a: string, b: string): boolean {
  let cur: string | undefined = b;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === a) return true;
    seen.add(cur);
    cur = parentOf[cur];
  }
  return false;
}

/**
 * The board's document with every expanded group's members drawn inside it.
 *
 * `expanded` is applied in order; a member that is itself expanded nests one
 * level further. A group whose id the document does not draw is ignored.
 */
export function compositeDocument(
  base: SeqDiagramV1,
  graph: ArchGraph | null,
  expanded: readonly string[],
  opts: {
    budget?: number;
    nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>;
    /** FLAT: an expanded group is replaced by its members, with no frame. */
    flat?: boolean;
  } = {},
): CompositeDocument {
  if (!graph || expanded.length === 0) return { doc: base, parentOf: {}, groups: [], merged: {} };
  const budget = Math.max(1, opts.budget ?? BOX_BUDGET);
  const degree = degreeOf(graph);
  const nodes: SeqDiagramNode[] = [...base.nodes];
  const drawn = new Set(nodes.map((n) => n.id));
  const parentOf: Record<string, string> = {};
  const groups: CompositeGroup[] = [];

  for (const id of expanded) {
    if (!drawn.has(id) || groups.some((g) => g.id === id)) continue;
    /* TESTS ROLL INTO A CHIP (stream 3b review): an all-expanded package
       spent most of its 50-box budget on *.test.* files. */
    const all = membersOf(graph, id, degree).filter((m) => !drawn.has(m.id));
    const members = all.filter((m) => !isTestFile(m));
    const tests = all.length - members.length;
    if (members.length === 0 && tests === 0) continue;
    /* No room left: the group still opens as a frame, and every member rolls
       into its +N chip. The budget is never exceeded. */
    const room = Math.max(0, budget - nodes.length);
    const kept = members.slice(0, room);
    for (const m of kept) {
      const says = opts.nodeDetail?.[m.id]?.whatItDoes ?? m.meta?.description;
      const ref = evidenceRefOf(m);
      nodes.push({
        id: m.id,
        label: m.label ?? m.id,
        kind: seqKind(m.kind),
        role: 'participant',
        ...(ref ? { evidenceRef: ref } : {}),
        ...(typeof says === 'string' && says.trim() !== '' && m.kind === 'module'
          ? { detail: { whatItDoes: says.trim() } }
          : {}),
      });
      drawn.add(m.id);
      parentOf[m.id] = id;
    }
    groups.push({ id, memberIds: kept.map((m) => m.id), total: members.length, tests });
  }
  if (groups.length === 0) return { doc: base, parentOf: {}, groups: [], merged: {} };

  const open = new Set(groups.map((g) => g.id));
  const added = new Set(Object.keys(parentOf));
  const lift = liftTo(graph, drawn);

  /* Edges the document drew that touch an expanded group are re-derived from
     the scan, so they land on the member that actually holds them. */
  const edges: SeqDiagramEdge[] = base.edges.filter((e) => !open.has(e.from) && !open.has(e.to));
  const have = new Set(edges.map((e) => `${e.from}\u0000${e.to}\u0000${e.family}`));
  const merged: Record<string, number> = {};
  const liftedId = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const from = lift(e.srcId);
    const to = lift(e.dstId);
    if (!from || !to || from === to) continue;
    if (!(added.has(from) || added.has(to) || open.has(from) || open.has(to))) continue;
    if (nests(parentOf, from, to) || nests(parentOf, to, from)) continue;
    const family = familyOf(e.kind);
    const key = `${from}\u0000${to}\u0000${family}`;
    const already = liftedId.get(key);
    if (already) {
      merged[already] = (merged[already] ?? 1) + 1;
      continue;
    }
    if (have.has(key)) continue;
    have.add(key);
    const id = `lift:${from}->${to}:${family}`;
    liftedId.set(key, id);
    merged[id] = 1;
    const ev = e.evidence?.[0];
    edges.push({
      id,
      from,
      to,
      family,
      ...(ev ? { evidenceRef: `scan:${ev.file}:${ev.line}` } : {}),
    });
  }

  /* A merged line says how many it stands for: '3 http'. One edge keeps no
     label, as a scanned edge between two services would. */
  const labelled = edges.map((e) =>
    (merged[e.id] ?? 0) > 1 ? { ...e, label: `${merged[e.id]} ${e.family}` } : e,
  );

  if (opts.flat) {
    return {
      doc: {
        ...base,
        nodes: nodes.filter((n) => !open.has(n.id)),
        edges: labelled.filter((e) => !open.has(e.from) && !open.has(e.to)),
      },
      parentOf: {},
      groups: [],
      merged,
    };
  }

  return {
    doc: {
      ...base,
      nodes,
      edges: labelled,
      groups: [
        ...(base.groups ?? []),
        ...groups.map((g) => ({
          id: `group:${g.id}`,
          label: base.nodes.find((n) => n.id === g.id)?.label ?? nodes.find((n) => n.id === g.id)?.label ?? g.id,
          memberIds: g.memberIds,
        })),
      ],
    },
    parentOf,
    groups,
    merged,
  };
}

/** Boxes an expansion list would draw with no budget — what the budget rule
 *  weighs before it collapses anything. */
export function boxesWithoutBudget(
  base: SeqDiagramV1,
  graph: ArchGraph | null,
  expanded: readonly string[],
): number {
  return compositeDocument(base, graph, expanded, { budget: Number.POSITIVE_INFINITY }).doc.nodes.length;
}

export interface LiftedImport {
  id: string;
  source: string;
  target: string;
  imports: number;
  label: string;
}

/** Imports between drawn nodes, counted after lifting each end to what is
 *  visible. Pairs under `minImports` are dropped; a member's imports of its own
 *  group (or the reverse) are not an edge. */
export function importEdges(
  graph: ArchGraph | null,
  visibleIds: readonly string[],
  parentOf: Readonly<Record<string, string>> = {},
  minImports = 3,
): LiftedImport[] {
  if (!graph) return [];
  const lift = liftTo(graph, new Set(visibleIds));
  const count = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind !== 'import') continue;
    const from = lift(e.srcId);
    const to = lift(e.dstId);
    if (!from || !to || from === to) continue;
    if (nests(parentOf, from, to) || nests(parentOf, to, from)) continue;
    const key = `${from}\u0000${to}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()]
    .filter(([, n]) => n >= minImports)
    .map(([key, n]) => {
      const [source, target] = key.split('\u0000') as [string, string];
      return {
        id: `derived:${source}->${target}`,
        source,
        target,
        imports: n,
        label: `${n} import${n === 1 ? '' : 's'}`,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The scan's evidence for a drawn edge: every file:line whose edge lifts onto
 *  this pair. Imports count only for an import edge. Capped, sorted by file
 *  then line, so the same scan always cites the same lines. */
export function evidenceFor(
  graph: ArchGraph | null,
  visibleIds: readonly string[],
  source: string,
  target: string,
  importsOnly: boolean | 'any',
  cap = 20,
): { evidence: Evidence[]; total: number; lines: number } {
  if (!graph) return { evidence: [], total: 0, lines: 0 };
  const lift = liftTo(graph, new Set(visibleIds));
  const out: Evidence[] = [];
  let total = 0;
  for (const e of graph.edges) {
    if (importsOnly !== 'any' && (e.kind === 'import') !== importsOnly) continue;
    if (lift(e.srcId) !== source || lift(e.dstId) !== target) continue;
    total += 1;
    for (const ev of e.evidence ?? []) out.push(ev);
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { evidence: out.slice(0, cap), total, lines: out.length };
}
