import {
  buildImpactAdjacency,
  computeCycles,
  computeRisks,
  impactFromAdjacency,
  type ArchGraph,
  type ArchNode,
  type CyclicDependency,
  type EdgeKind,
  type FunctionGraph,
  type NodeKind,
  type SystemRisk,
} from '@sequence/schema';

import type { LineRange } from './diffModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE IMPACT PANEL'S MODEL — item 5.5 / gap B2
   packages/web2/src/review/impactModel.ts

   "Codex reviews the change; nothing reviews the change's CONSEQUENCES on the
   system." CANON lists this among the things that are real and structural, and
   §5.3 B2 records why it is a wiring job rather than research: `computeImpact`
   and `computeRisks` already exist in `packages/schema`, and the FunctionGraph
   — 5,990 nodes and 7,759 call edges on this repository — already exists with
   no agent-facing surface at all.

   SO NOTHING HERE COMPUTES A GRAPH FACT ITSELF. Every number below comes out
   of the schema engines, which are pure, total, and covered by that package's
   own node:test suite. A second implementation of blast radius living in a
   review pane is exactly how the board and the digest came to disagree once
   already, which is why those engines were moved into `schema` to begin with.

   ── THE FOUR CLAIMS THIS PANEL MAY MAKE, AND NO FIFTH ────────────────────

     1. WHICH SCANNED NODES the changed files are inside — `ArchNode.path`.
     2. WHAT BREAKS if one of those nodes fails — `impactedBy`, the r11 blast
        radius, over the real edge list.
     3. WHICH EDGES were grounded on a line inside a changed file. This is an
        `Evidence {file,line}` lookup and it is the one thing a diff viewer
        structurally cannot say: *the proof for this edge is in the code you
        just changed.* Every edge in this product carries file:line by
        construction (invariant 1, "grounded, not guessed"), which is what
        makes the lookup possible at all.
     4. WHICH FUNCTIONS the changed LINE RANGES fall inside, and who calls
        them — `FunctionNode {file,startLine,endLine}` against `changedRanges`.

   ── WHAT IT MUST REFUSE TO SAY ───────────────────────────────────────────

   "Cycles created" and "edges broken" need the graph AFTER the change. There
   is no such graph: `PUT /api/file` clears the persisted graph cache and does
   NOT re-scan (the `PUT /api/file` handler in `server/repoServer.ts`, gap G5), so the only honest post-change
   number would come from a rescan nobody has run. A "created" count would be a
   number nobody measured — CANON law 4, "never invent a number". The panel
   names the cycles the change is INSIDE, and lists the absence as a gap.

   Likewise `computeRisks` is FILTERED to touched nodes and never re-ranked
   here: the severity thresholds and the top-N are that engine's decisions.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ChangedFile {
  path: string;
  /** NEW-file line spans, from `changedRanges`. */
  ranges: LineRange[];
}

export interface TouchedNode {
  nodeId: string;
  label: string;
  kind: NodeKind;
  /** The changed paths that landed inside this node. */
  paths: string[];
  /** One hop: these break FIRST. */
  impactedByDirect: string[];
  /** The full blast radius, `computeImpact(...).impactedBy`. */
  impactedBy: string[];
  /** What this node relies on, one hop. */
  dependsOnDirect: string[];
}

export interface TouchedEdge {
  edgeId: string;
  srcId: string;
  dstId: string;
  kind: EdgeKind;
  /** The evidence entry that sits inside a changed range. */
  file: string;
  line: number;
  snippet: string;
}

export interface TouchedCaller {
  id: string;
  name: string;
  file: string;
  startLine: number;
}

export interface TouchedFunction {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  callers: TouchedCaller[];
}

export interface ReviewImpact {
  nodes: TouchedNode[];
  edges: TouchedEdge[];
  functions: TouchedFunction[];
  cycles: CyclicDependency[];
  risks: SystemRisk[];
  /** Changed paths no scanned node owns. Listed, never dropped. */
  unmapped: string[];
  /** What could not be computed, and why. Never silence. */
  gaps: string[];
}

export interface ImpactInput {
  graph: ArchGraph | null;
  functions: FunctionGraph | null;
  changes: ChangedFile[];
}

const EMPTY: ReviewImpact = {
  nodes: [],
  edges: [],
  functions: [],
  cycles: [],
  risks: [],
  unmapped: [],
  gaps: [],
};

/**
 * The scanned node a repo-relative path belongs to, or null.
 *
 * DEEPEST WINS. `packages/api` and `packages/api/db` both contain
 * `packages/api/db/schema.sql`; answering with the shallower one attributes a
 * datastore change to the service and understates the blast radius of the
 * thing that actually changed.
 *
 * AND THE BOUNDARY IS A SEPARATOR, NOT A PREFIX. A bare `startsWith` lets
 * `packages/web` swallow `packages/web2` — and this monorepo contains both, so
 * that is not a hypothetical: every Wave-5 change in `packages/web2` would be
 * reported as a change to the dead v1 tree.
 */
export function nodeForPath(graph: ArchGraph, path: string): ArchNode | null {
  const target = path.replace(/\\/g, '/');
  let best: ArchNode | null = null;
  for (const node of graph.nodes) {
    const owned = node.path?.replace(/\\/g, '/');
    if (owned === undefined || owned === '') continue;
    if (target !== owned && !target.startsWith(`${owned}/`)) continue;
    if (best === null || owned.length > (best.path ?? '').length) best = node;
  }
  return best;
}

/** Whether a 1-based line falls inside any of the change's spans. */
function inRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((r) => line >= r.start && line <= r.end);
}

/** Whether two spans overlap at all. */
function overlaps(a: LineRange, ranges: LineRange[]): boolean {
  return ranges.some((r) => a.start <= r.end && r.start <= a.end);
}

export function computeReviewImpact(input: ImpactInput): ReviewImpact {
  const { graph, functions, changes } = input;
  const gaps: string[] = [];

  if (graph === null) {
    /* ZEROS ARE A CLAIM. "0 nodes affected" says nothing breaks; the truth is
       that nothing was measured, and those are different sentences. */
    return {
      ...EMPTY,
      gaps: ['no graph is attached, so nothing about this change was measured against the system'],
    };
  }

  const byPath = new Map<string, string[]>();
  const unmapped: string[] = [];
  const changedByPath = new Map<string, LineRange[]>();

  for (const change of changes) {
    const normalized = change.path.replace(/\\/g, '/');
    changedByPath.set(normalized, change.ranges);
    const node = nodeForPath(graph, normalized);
    if (node === null) {
      unmapped.push(normalized);
      continue;
    }
    const list = byPath.get(node.id);
    if (list) list.push(normalized);
    else byPath.set(node.id, [normalized]);
  }

  /* ONE ADJACENCY, BUILT ONCE. `computeImpact` would rebuild it per node, and
     `buildImpactAdjacency` exists precisely so "what does this edge list mean"
     has a single implementation that cannot drift. */
  const adjacency = buildImpactAdjacency(graph.edges);

  const nodes: TouchedNode[] = [];
  for (const [nodeId, paths] of byPath) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node === undefined) continue;
    const result = impactFromAdjacency(adjacency, nodeId);
    nodes.push({
      nodeId,
      label: node.label,
      kind: node.kind,
      paths,
      impactedByDirect: result.impactedByDirect,
      impactedBy: result.impactedBy,
      dependsOnDirect: result.dependsOnDirect,
    });
  }
  nodes.sort((a, b) => b.impactedBy.length - a.impactedBy.length || a.nodeId.localeCompare(b.nodeId));

  /* ── claim 3: the edges whose PROOF is in the changed lines ───────────── */
  const edges: TouchedEdge[] = [];
  for (const edge of graph.edges) {
    for (const evidence of edge.evidence ?? []) {
      const ranges = changedByPath.get(evidence.file?.replace(/\\/g, '/') ?? '');
      if (ranges === undefined) continue;
      if (!inRanges(evidence.line, ranges)) continue;
      edges.push({
        edgeId: edge.id,
        srcId: edge.srcId,
        dstId: edge.dstId,
        kind: edge.kind,
        file: evidence.file,
        line: evidence.line,
        snippet: evidence.snippet ?? '',
      });
      break;
    }
  }

  /* ── claim 4: the functions the changed lines are inside ──────────────── */
  const touchedFunctions: TouchedFunction[] = [];
  if (functions === null) {
    gaps.push(
      'function-level callers need GET /api/functions, which has not been loaded for this repository',
    );
  } else {
    const callersOf = new Map<string, string[]>();
    for (const edge of functions.edges) {
      if (edge.kind !== 'call') continue;
      const list = callersOf.get(edge.dstId);
      if (list) list.push(edge.srcId);
      else callersOf.set(edge.dstId, [edge.srcId]);
    }
    const fnById = new Map(functions.nodes.map((n) => [n.id, n]));

    for (const fn of functions.nodes) {
      const ranges = changedByPath.get(fn.file?.replace(/\\/g, '/') ?? '');
      if (ranges === undefined) continue;
      /* THE TEST IS AGAINST startLine..endLine, NOT AGAINST THE FILE. A panel
         that listed every function in a changed file would report thousands of
         them on this repository and say nothing at all. */
      if (!overlaps({ start: fn.startLine, end: fn.endLine }, ranges)) continue;
      touchedFunctions.push({
        id: fn.id,
        name: fn.name,
        file: fn.file,
        startLine: fn.startLine,
        endLine: fn.endLine,
        callers: (callersOf.get(fn.id) ?? [])
          .map((id) => fnById.get(id))
          .filter((n): n is NonNullable<typeof n> => n !== undefined)
          .map((n) => ({ id: n.id, name: n.name, file: n.file, startLine: n.startLine })),
      });
    }
    touchedFunctions.sort((a, b) => b.callers.length - a.callers.length || a.name.localeCompare(b.name));
  }

  /* ── the risk and cycle reads, FILTERED and never re-ranked ───────────── */
  const riskNodes = graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label }));
  const touchedIds = new Set(nodes.map((n) => n.nodeId));

  const risks = computeRisks(graph.edges, riskNodes).filter((r) => touchedIds.has(r.nodeId));
  const cycles = computeCycles(graph.edges, riskNodes).filter((c) =>
    c.nodes.some((id) => touchedIds.has(id)),
  );

  /* THE GAP THAT MUST ALWAYS BE SAID, because its absence is what an "impact"
     panel is normally assumed to include. */
  gaps.push(
    'cycles created or closed by this change cannot be reported: PUT /api/file clears the graph cache without re-scanning, so there is no post-change graph to compare against',
  );

  return { nodes, edges, functions: touchedFunctions, cycles, risks, unmapped, gaps };
}
