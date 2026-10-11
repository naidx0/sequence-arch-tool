/**
 * OPENING A SERVICE — what is inside it.
 *
 * The owner's ruling was SYSTEMS LAYER ONLY, no nesting — "but a service must
 * still be openable". Those are not in tension: opening REPLACES the view
 * rather than nesting inside it. One level is on screen at a time, and the
 * level changes.
 *
 * IT IS NOT `archGraphToBreakoutSeqDiagram`, which despite its
 * `breakout-interior` kind places the focus service and its service-level
 * NEIGHBOURS. Measured on shopfront: the gateway has six file children and the
 * breakout returned none of them. That view answers "what does this talk to";
 * this one answers "what is in it", and they are different questions.
 *
 * WHAT COUNTS AS INSIDE is `parentId`, which is the scan's own containment and
 * not a path prefix. Re-deriving membership from directory names would disagree
 * with the graph the moment a service's build context is narrowed — and
 * `discovery/compose.ts` already carries a warning about exactly that case.
 *
 * THREE ZOOMS, ONE LEVEL ON SCREEN AT A TIME. Owner, 2026-09-22, walking ML
 * Harness: "Click on the ML service — there's 55 nodes in here ... turn these
 * micro file services into macro services." The system is the first zoom. A
 * service the scan clustered into modules opens to THOSE MODULES, each saying
 * what it does; a module opens to its files. Measured on ml-harness: 6 modules
 * and 49 files the clustering left outside any of them, all 55 placed side by
 * side, so the six cards that say what the service is made of were drowned in
 * the 49 that do not. The loose files are COUNTED at the module level, never
 * placed — and never gathered into a made-up "loose files" card, which would
 * be a node the scan did not produce.
 */

import type {
  ArchGraph,
  ArchNode,
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramNode,
  SeqDiagramNodeDetail,
  SeqDiagramV1,
} from '@sequence/schema';

import { deriveImportEdges, type DerivedEdge } from './derivedEdges.js';
import { archNodeEvidenceRef, formatScanEvidenceRef } from './evidenceRef.js';

const GENERATOR = 'sequence/serviceInterior';

/** A module level with more pairs than this is a hairball, not a flow. */
const MAX_MODULE_EDGES = 12;

/**
 * File imports, counted between the cards a service's modules level places.
 *
 * The counting is `deriveImportEdges` with a lift to the placed cards — one
 * rule, not a second copy of it. On top, what a FLOW needs (2026-09-22):
 *   · the minority direction of a mutual pair goes at 3:1, so the layered
 *     layout is not handed a cycle to break at random (Ui→Panes 14 against
 *     Panes→Ui 3 on ml-harness); a near-tie keeps both, because neither side
 *     is the direction the code runs,
 *   · under 3 imports is not drawn (the derived floor),
 *   · the heaviest 12 pairs, then back in key order so a re-scan that moves
 *     one import does not reshuffle the board.
 */
function moduleImports(
  graph: ArchGraph,
  lift: (id: string) => { id: string; label: string } | undefined,
): DerivedEdge[] {
  const all = deriveImportEdges(graph, { minImports: 1, lift });
  const weight = new Map(all.map((d) => [`${d.srcId} -> ${d.dstId}`, d.imports]));
  return all
    .filter((d) => {
      const back = weight.get(`${d.dstId} -> ${d.srcId}`) ?? 0;
      return !(back > 0 && back >= 3 * d.imports);
    })
    .filter((d) => d.imports >= 3)
    .sort(
      (a, b) =>
        b.imports - a.imports ||
        `${a.srcId} -> ${a.dstId}`.localeCompare(`${b.srcId} -> ${b.dstId}`),
    )
    .slice(0, MAX_MODULE_EDGES)
    .sort((a, b) => `${a.srcId} -> ${a.dstId}`.localeCompare(`${b.srcId} -> ${b.dstId}`));
}

function toSeqKind(kind: string): SeqDiagramNode['kind'] {
  if (kind === 'module' || kind === 'file' || kind === 'package' || kind === 'function') {
    return kind;
  }
  return 'module';
}

function toFamily(kind: string): SeqDiagramEdgeFamily {
  if (kind === 'import') return 'import';
  if (kind === 'http' || kind === 'grpc') return kind;
  if (kind.startsWith('queue_')) return 'queue';
  if (kind.startsWith('db_')) return 'db';
  return 'call';
}

export interface ServiceInteriorOptions {
  graphId?: string;
  /** Most nodes to place. A service with 900 files is a file tree, not a map. */
  limit?: number;
  /** The server's per-node detail (`GetArchGraphResponse.nodeDetail`). Its
      `whatItDoes` is preferred over `meta.description` when it has one. */
  nodeDetail?: Readonly<Record<string, SeqDiagramNodeDetail>>;
}

export interface ServiceInterior {
  doc: SeqDiagramV1;
  /** `modules` when the opened node has module children and only those (and
      anything else that is not a file) are placed; `members` otherwise. */
  level: 'modules' | 'members';
  /** Candidates to place, before any cap. At the module level, the modules. */
  total: number;
  /** How many were left out, so the surface can say so rather than imply none. */
  omitted: number;
  /** Files directly inside the opened node and outside every module. Counted,
      never placed. Always 0 at the `members` level. */
  looseFiles: number;
}

/** What a module DOES, in the scan's words: the server's `whatItDoes` first,
    then `meta.description`. `undefined` when neither says anything. */
function whatItDoes(
  n: ArchNode,
  nodeDetail: ServiceInteriorOptions['nodeDetail'],
): string | undefined {
  const fromServer = nodeDetail?.[n.id]?.whatItDoes?.trim();
  if (fromServer) return moduleRole(fromServer);
  const described = n.meta?.description;
  return typeof described === 'string' && described.trim() !== '' ? moduleRole(described.trim()) : undefined;
}

/**
 * THE SCAN'S INVENTORY LINE, TURNED ROUND SO THE ROLE COMES FIRST.
 *
 * `describeCluster` writes "17 ts files in web, defining abort, run, ready.
 * Grouped by directory." — the count first, because that sentence was
 * written for the module's expanded detail. The card's one glance line drops
 * any sentence that starts with a file count as inventory (`isGlanceNoise`),
 * so on the ML Harness scan every module card showed NO description although
 * the document carried one (builder's report, 2026-09-22). The owner asked
 * for "what each module does"; the nearest thing the scan knows is what the
 * module DEFINES, and it is in that sentence already. Same words, role first,
 * count in brackets; the rationale sentence stays with the expanded detail. A
 * line that names nothing defined is returned as it was, and the glance
 * filter is right to drop it.
 */
export function moduleRole(text: string): string {
  const m = /^(\d+ (?:[\w+#-]+ )?files?)(?: in (\S+?))?, defining (.+?)\.(?:\s|$)/.exec(text);
  if (!m) return text;
  const where = m[2] ? `${m[1]} in ${m[2]}` : m[1];
  return `Defines ${m[3]} (${where})`;
}

/**
 * The interior of one service.
 *
 * Returns an EMPTY document with `total: 0` for a service with no children —
 * which is a real answer. A single-file service is a normal thing, and a view
 * that errored on it would refuse the simplest repository there is.
 */
export function serviceInterior(
  graph: ArchGraph,
  serviceId: string,
  opts: ServiceInteriorOptions = {},
): ServiceInterior {
  const limit = Math.max(1, Math.min(opts.limit ?? 60, 300));
  const focus = graph.nodes.find((n) => n.id === serviceId);

  const all = graph.nodes.filter((n) => n.parentId === serviceId);
  /* MODULES FIRST WHEN THERE ARE ANY. A service with no module children keeps
     the file view exactly as it was. */
  const level: ServiceInterior['level'] = all.some((n) => n.kind === 'module')
    ? 'modules'
    : 'members';
  const children = level === 'modules' ? all.filter((n) => n.kind !== 'file') : all;
  const looseFiles = all.length - children.length;
  const total = children.length;

  /*
   * RANKED BY CONNECTEDNESS, not by name. When a service has more children than
   * fit, the ones worth showing are the ones other things use — an alphabetical
   * cut would keep `a.ts` and drop the module every other file imports.
   */
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.srcId, (degree.get(e.srcId) ?? 0) + 1);
    degree.set(e.dstId, (degree.get(e.dstId) ?? 0) + 1);
  }
  const kept = [...children]
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        (a.label ?? a.id).localeCompare(b.label ?? b.id),
    )
    .slice(0, limit);
  const keptIds = new Set(kept.map((n) => n.id));

  const nodes: SeqDiagramNode[] = kept.map((n: ArchNode) => {
    const evidenceRef = archNodeEvidenceRef(n);
    /* Only a module carries its sentence here: that is the level whose cards
       exist to say what each part is. A file's line is its own business. */
    const says = n.kind === 'module' ? whatItDoes(n, opts.nodeDetail) : undefined;
    return {
      id: n.id,
      label: n.label ?? n.id,
      kind: toSeqKind(n.kind),
      role: 'participant',
      ...(evidenceRef ? { evidenceRef } : {}),
      ...(says ? { detail: { whatItDoes: says } } : {}),
    };
  });

  /*
   * THE MODULES LEVEL READS ITS EDGES THROUGH A LIFT. Owner, 2026-09-22: "when
   * I click on that service I want a macro diagram of how everything comes
   * together". Every edge the scan records ends on a FILE, so matching ends
   * against the placed modules kept none, and ELK, handed six cards and no
   * edges, rectpacked them. Each end is walked up `parentId` to the nearest
   * PLACED card — the walk flowFocus.ts uses to put a hop on the board, with
   * the same guard against a malformed cycle. The files level is unchanged:
   * its cards ARE the files, and lifting there would fold a function's edges
   * into its file.
   */
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const place = (id: string): { id: string; label: string } | undefined => {
    if (keptIds.has(id)) return { id, label: byId.get(id)?.label ?? id };
    if (level !== 'modules') return undefined;
    const seenUp = new Set<string>([id]);
    let cursor = byId.get(id)?.parentId;
    while (cursor) {
      if (keptIds.has(cursor)) return { id: cursor, label: byId.get(cursor)?.label ?? cursor };
      if (seenUp.has(cursor)) return undefined;
      seenUp.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
    return undefined;
  };

  /* Only edges with BOTH ends inside. An edge leaving the service is a fact
     about the systems layer, and drawing half of it here would put a line into
     empty space. At the modules level imports are counted below instead. */
  const seen = new Set<string>();
  const edges: SeqDiagramEdge[] = [];
  for (const e of graph.edges) {
    if (level === 'modules' && e.kind === 'import') continue;
    const from = place(e.srcId)?.id;
    const to = place(e.dstId)?.id;
    if (!from || !to || from === to) continue;
    const family = toFamily(e.kind);
    const key = `${from}\u0000${to}\u0000${family}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `int:${edges.length}`, from, to, family });
  }
  if (level === 'modules') {
    for (const d of moduleImports(graph, place)) {
      edges.push({
        id: `int:${edges.length}`,
        from: d.srcId,
        to: d.dstId,
        family: 'import',
        label: d.label,
        ...(d.evidence[0] ? { evidenceRef: formatScanEvidenceRef(d.evidence[0]) } : {}),
      });
    }
  }

  return {
    doc: {
      version: 1,
      kind: 'breakout-interior',
      title: focus ? `Inside ${focus.label ?? serviceId}` : serviceId,
      grounded: {
        graphId: opts.graphId ?? graph.repoName ?? 'arch',
        repoPath: graph.repoRoot || undefined,
        scopeNodeIds: nodes.map((n) => n.id),
        origin: 'scan',
      },
      theme: 'structural',
      nodes,
      edges,
      layout: { engine: 'layered-flow', direction: 'LR' },
      meta: { createdAt: new Date().toISOString(), generator: GENERATOR },
    },
    level,
    total,
    omitted: Math.max(0, total - kept.length),
    looseFiles,
  };
}
