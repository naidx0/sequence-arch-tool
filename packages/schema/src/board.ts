/**
 * The pure board view-model — the load-bearing logic behind the v8 whiteboard.
 *
 * This module lives in `@sequence/schema` on purpose: it is the ONE place both
 * the analyzer (which produces the {@link PlainNode} tree in `explain/`) and the
 * web renderer need, and schema is (a) already a dependency of the web package
 * and (b) covered by `node --test`. Putting the board math here gives it real
 * unit tests AND lets the thin React renderer import it with zero new deps.
 *
 * Everything here is a PURE, deterministic function of its inputs. Given the same
 * PlainTree + ArchGraph + expansion set, {@link buildBoardModel} returns a
 * byte-identical model every time; {@link evictForBudget} is a deterministic LRU.
 *
 * HONESTY BOUNDARY: the board STRUCTURE and its EDGE OVERLAYS are derived only
 * from the real {@link ArchGraph} (its `edges`) and each PlainNode's real
 * `sourceRefs`. No node or edge is ever invented here — an overlay can only exist
 * between two plain nodes that genuinely own the two endpoints of a real edge.
 */

import type { ArchGraph, EdgeKind } from './index.js';

/** The plain-English node kinds (the AI/structural translation vocabulary). */
export type PlainKind = 'group' | 'area' | 'feature' | 'file' | 'service' | 'data';

/**
 * A plain-English, expandable view node. The root is the whole app; children are
 * readable areas (Frontend / Backend / Data), then features, then files. The
 * honesty property lives in `sourceRefs`: every node except a pure `group` traces
 * back to at least one REAL deterministic source — an ArchGraph node id
 * (`svc:api`, `file:...`) and/or a real repo-relative path.
 */
export interface PlainNode {
  /** Stable, unique-within-tree id. */
  id: string;
  /** Plain-English, human-readable name. */
  title: string;
  /** Optional one-line plain-English description. */
  summary?: string;
  kind: PlainKind;
  children: PlainNode[];
  /** Real sources this plain node maps back to: ArchGraph node ids and/or paths. */
  sourceRefs: string[];
  /** Ids of interaction/import edges connecting this node's subtree to others. */
  edgeRefs?: string[];
}

/** `group` nodes are pure containers — the only kind exempt from the sourceRef rule. */
export function isPureGroup(kind: PlainKind): boolean {
  return kind === 'group';
}

/** Tree = top-down (ELK direction DOWN); flow = left-to-right (ELK direction RIGHT). */
export type BoardDirection = 'tree' | 'flow';

/** A card the board renders. Only currently-VISIBLE plain nodes become BoardNodes. */
export interface BoardNode {
  /** The plain-node id. */
  id: string;
  title: string;
  summary?: string;
  kind: PlainKind;
  /** Depth in the plain tree; root = 0, areas = 1, and so on. */
  depth: number;
  /** True when this node has children that COULD be expanded. */
  hasChildren: boolean;
  /** True when this node is currently expanded (children visible below it). */
  isExpanded: boolean;
  /** The real sources this card maps to (unchanged from the PlainNode). */
  sourceRefs: string[];
  /** The nearest visible ancestor's id (undefined for the root). */
  parentId?: string;
}

/** A derived overlay edge between two VISIBLE board nodes. */
export interface BoardEdge {
  /** Stable, deterministic id. */
  id: string;
  /** Visible board-node id (source side, lifted to the nearest visible ancestor). */
  src: string;
  /** Visible board-node id (destination side, lifted likewise). */
  dst: string;
  kind: EdgeKind;
  /** True when the two endpoints live under different top-level AREAS (e.g. front↔back). */
  crossArea: boolean;
}

export interface BoardModel {
  nodes: BoardNode[];
  edges: BoardEdge[];
  direction: BoardDirection;
}

export interface BuildBoardOptions {
  /** The set of plain-node ids the user has expanded. The root is always open. */
  expanded: Set<string>;
  direction: BoardDirection;
}

/**
 * A "deep expansion" opens a node that itself has EXPANDABLE children — i.e. at
 * least one child that ALSO has children. Expanding it reveals a further
 * sub-board (services→features→files), not just a shelf of leaf files, so these
 * are the expansions the LRU budget guards against. A parent whose children are
 * all leaves (e.g. a feature whose children are files) is a SHALLOW expansion and
 * does not count against the budget.
 */
export function isDeepExpansion(node: PlainNode): boolean {
  return node.children.some((c) => c.children.length > 0);
}

interface NodeInfo {
  node: PlainNode;
  depth: number;
  parentId?: string;
  /** The depth-1 ancestor id (the node itself when depth === 1); undefined at the root. */
  areaId?: string;
  /** Visible = every strict ancestor (up to and including the always-open root) is expanded. */
  visible: boolean;
  /** Resolved ArchGraph node ids owned by this node's whole subtree. */
  subtree: Set<string>;
  /** Pre-order index, for a stable deepest-owner tie-break. */
  order: number;
}

/**
 * Build the board view-model: the currently-VISIBLE plain nodes, plus the edge
 * overlays derived from the real graph, lifted to the nearest visible ancestor on
 * each side, de-duplicated, self-loops dropped, and cross-area edges marked.
 *
 * Visibility: the root is always treated as expanded (so the top-level areas show
 * by default, matching the canvas convention that the repo root IS the board). A
 * node is visible iff every strict ancestor is expanded. Because visibility is
 * monotonic (a visible node's parent is always visible), lifting an edge endpoint
 * up to the first visible node yields a card that is guaranteed to be on the board.
 *
 * Pure and deterministic: nodes are emitted in pre-order, edges sorted by id.
 */
export function buildBoardModel(
  root: PlainNode,
  graph: ArchGraph,
  opts: BuildBoardOptions
): BoardModel {
  const { expanded, direction } = opts;

  // ref (a graph node id OR a node path) -> graph node id, for sourceRef resolution.
  const idSet = new Set(graph.nodes.map((n) => n.id));
  const byPath = new Map<string, string>();
  for (const n of graph.nodes) if (n.path) byPath.set(n.path, n.id);
  const resolve = (ref: string): string | undefined =>
    idSet.has(ref) ? ref : byPath.get(ref);

  // The root is always open; every other node opens only when in `expanded`.
  const isOpen = (id: string): boolean => id === root.id || expanded.has(id);

  const infos = new Map<string, NodeInfo>();
  const visibleOrder: string[] = [];
  let counter = 0;

  /**
   * DFS building depth/parent/area/visibility + subtree graph-id sets. Returns
   * the node's subtree set so a parent can fold in its descendants' ids.
   */
  const walk = (
    node: PlainNode,
    depth: number,
    parentId: string | undefined,
    areaId: string | undefined,
    parentVisible: boolean
  ): Set<string> => {
    const myArea = depth === 1 ? node.id : areaId;
    const subtree = new Set<string>();
    for (const ref of node.sourceRefs) {
      const gid = resolve(ref);
      if (gid) subtree.add(gid);
    }
    const info: NodeInfo = {
      node,
      depth,
      parentId,
      areaId: depth >= 1 ? myArea : undefined,
      visible: parentVisible,
      subtree,
      order: counter++,
    };
    infos.set(node.id, info);
    if (parentVisible) visibleOrder.push(node.id);

    // Children are visible iff this node is visible AND expanded.
    const childrenVisible = parentVisible && isOpen(node.id);
    for (const c of node.children) {
      const sub = walk(c, depth + 1, node.id, myArea, childrenVisible);
      for (const gid of sub) subtree.add(gid);
    }
    return subtree;
  };
  walk(root, 0, undefined, undefined, true);

  const nodes: BoardNode[] = visibleOrder.map((id) => {
    const i = infos.get(id)!;
    const hasChildren = i.node.children.length > 0;
    return {
      id,
      title: i.node.title,
      summary: i.node.summary,
      kind: i.node.kind,
      depth: i.depth,
      hasChildren,
      isExpanded: hasChildren && isOpen(id),
      sourceRefs: i.node.sourceRefs,
      parentId: i.parentId,
    };
  });

  // Owner of a real graph node = the DEEPEST plain node whose subtree contains it
  // (tie-break: earliest in pre-order). This maps `svc:api` to the service card,
  // `file:...` to the file card, etc.
  const ownerOf = new Map<string, string>();
  for (const [pid, info] of infos) {
    for (const gid of info.subtree) {
      const cur = ownerOf.get(gid);
      if (cur === undefined) {
        ownerOf.set(gid, pid);
      } else {
        const curInfo = infos.get(cur)!;
        if (info.depth > curInfo.depth || (info.depth === curInfo.depth && info.order < curInfo.order)) {
          ownerOf.set(gid, pid);
        }
      }
    }
  }

  // Lift a plain node up to the nearest visible ancestor-or-self.
  const nearestVisible = (pid: string): string | undefined => {
    let cur: string | undefined = pid;
    while (cur !== undefined) {
      const i = infos.get(cur);
      if (!i) return undefined;
      if (i.visible) return cur;
      cur = i.parentId;
    }
    return undefined;
  };
  const areaOf = (pid: string): string | undefined => infos.get(pid)?.areaId;

  // Derive overlays from the REAL edges only. Each endpoint is mapped to its
  // owning plain node, lifted to the nearest visible card; self-loops (both
  // endpoints inside one collapsed card) are dropped; the rest de-duplicated per
  // (src, dst, kind).
  const seen = new Set<string>();
  const edges: BoardEdge[] = [];
  for (const e of graph.edges) {
    const os = ownerOf.get(e.srcId);
    const od = ownerOf.get(e.dstId);
    if (os === undefined || od === undefined) continue; // an endpoint maps to nothing on the board
    const vs = nearestVisible(os);
    const vd = nearestVisible(od);
    if (vs === undefined || vd === undefined || vs === vd) continue;
    const key = `${vs}\u0000${vd}\u0000${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a1 = areaOf(vs);
    const a2 = areaOf(vd);
    const crossArea = a1 !== undefined && a2 !== undefined && a1 !== a2;
    edges.push({ id: `be:${vs}->${vd}:${e.kind}`, src: vs, dst: vd, kind: e.kind, crossArea });
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { nodes, edges, direction };
}

/** The result of an LRU eviction: the new open list and the ids that were collapsed. */
export interface EvictResult {
  /** The open deep-expansion ids after opening, least-recently-touched first. */
  open: string[];
  /** Ids evicted to stay within budget, in eviction order (oldest first). */
  evicted: string[];
}

/**
 * The overload guard. `openOrder` is the list of currently-open DEEP expansions,
 * ordered least-recently-touched FIRST (most-recent last). Opening `opening`:
 *
 *  1. moves it to most-recent (re-touching an already-open id, so it will NOT be
 *     the one evicted next), then
 *  2. while the count exceeds `budget`, evicts the least-recently-touched id
 *     (the front of the list).
 *
 * Deterministic with a stable FIFO tie-break: given the same inputs it always
 * returns the same `open`/`evicted`. Callers pass only DEEP-expansion ids (see
 * {@link isDeepExpansion}); shallow (leaf-only) expansions never count.
 */
export function evictForBudget(openOrder: string[], opening: string, budget: number): EvictResult {
  const next = openOrder.filter((id) => id !== opening);
  next.push(opening); // opening is now the most-recently-touched
  const cap = Math.max(0, budget);
  const evicted: string[] = [];
  while (next.length > cap) {
    evicted.push(next.shift()!); // evict the least-recently-touched (front)
  }
  return { open: next, evicted };
}
