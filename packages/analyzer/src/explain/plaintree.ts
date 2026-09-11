/**
 * The PlainTree model — the "translation engine" output.
 *
 * A {@link PlainNode} is a plain-English, expandable view of a repo: the root is
 * the whole app, its children are readable AREAS (Frontend / Backend / Data),
 * then features, then files. The critical honesty property lives in
 * `sourceRefs`: every plain node (except pure `group` nodes) traces back to at
 * least one REAL deterministic source — an ArchGraph node id (e.g. `svc:api`,
 * `file:api/app/main.py`) and/or a real repo-relative file/dir path. The
 * STRUCTURE is always real; only the GROUPING and the LABELS are interpretation.
 *
 * `edgeRefs` carry the ids of interaction/import edges that connect this node's
 * subtree to the rest of the system, for the later view's overlays. They are
 * always recomputed deterministically from `sourceRefs` (never taken from an AI
 * response), so an overlay can never point at an edge that doesn't exist.
 */

import type { ArchGraph } from '@sequence/schema';
// PlainNode / PlainKind and the pure board view-model now live canonically in
// @sequence/schema (v8 Phase B1) so the web renderer can import them with zero
// new deps AND they stay under node:test. Re-exported here unchanged so every
// existing `from './plaintree.js'` importer keeps working.
import { type PlainKind, type PlainNode, isPureGroup } from '@sequence/schema';

export { type PlainKind, type PlainNode, isPureGroup };

export interface PlainTreeResult {
  tree: PlainNode;
  mode: 'ai' | 'structural';
  /** The provider kind, when the AI path produced the tree. */
  provider?: string;
  /**
   * Which generate profile produced this tree (v9 Phase 3b). 'recommended' is
   * the default one-system Frontend/Backend/Data view (byte-identical to before);
   * 'bestfit' groups the SAME real nodes under product-type-appropriate top-level
   * buckets. Absent ⇒ 'recommended' (backward-compatible).
   */
  profile?: 'recommended' | 'bestfit';
  /** The deterministic product type, set only on the 'bestfit' profile. */
  projectType?: string;
}

/**
 * Turn a raw identifier (dir/service/label) into a Title-Cased human phrase:
 * splits camelCase, kebab-case, snake_case and dots into words. `main.py` and
 * other real filenames are left to the file-node path so they read verbatim;
 * this is for services/areas/features.
 */
export function humanize(raw: string): string {
  const words = raw
    .replace(/[._/\\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (words === '') return raw;
  return words
    .split(' ')
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * The set of source ids/paths the AI is ALLOWED to reference: every ArchGraph
 * node id, plus every node `path`, plus (when a folder walk is supplied) real
 * directory paths. A returned `sourceRef` outside this set is invented and gets
 * stripped by the honesty guard in explain.ts.
 */
export function validSourceRefs(graph: ArchGraph, extraPaths: string[] = []): Set<string> {
  const s = new Set<string>();
  for (const n of graph.nodes) {
    s.add(n.id);
    if (n.path) s.add(n.path);
  }
  for (const p of extraPaths) s.add(p);
  return s;
}

/**
 * Resolve a sourceRef (a graph node id OR a node path) to a graph node id, when
 * one exists. Used to translate `sourceRefs` into the node ids that edges are
 * keyed on. Directory paths (which correspond to no single node) resolve to
 * undefined and simply contribute no edges.
 */
function refToNodeId(ref: string, byId: Set<string>, byPath: Map<string, string>): string | undefined {
  if (byId.has(ref)) return ref;
  return byPath.get(ref);
}

/**
 * Recompute `edgeRefs` for every node in the tree, DETERMINISTICALLY, from the
 * graph edges and each node's subtree `sourceRefs`. An edge belongs to a node
 * when exactly one of its endpoints lives inside that node's subtree — i.e. it
 * CROSSES the node's boundary and is therefore an overlay the view would draw
 * between this node and something else. This is intentionally recomputed rather
 * than trusted from any AI response: overlays must trace to real edges only.
 *
 * Mutates the tree in place and returns it.
 *
 * PERFORMANCE (H12b). The obvious reading of that rule — build each node's
 * subtree id-set, then scan every graph edge against it — is `plainNodes ×
 * edges`, and BOTH grow with the repo: on the real n8n clone that is 19 148 ×
 * 33 065 ≈ 6.3×10^8 membership pairs, a measured 19.6 s (django: 2 998 × 8 988,
 * 0.65 s), i.e. 30× the time for 6.2× the files. It is now computed from the
 * other side, using the one structural fact the rule rests on: "inside the
 * subtree" is UPWARD-CLOSED, so the plain nodes containing a given graph node
 * are exactly the root-paths of the plain nodes that reference it directly.
 * Each edge then only has to look at its two endpoints' root-paths and take the
 * symmetric difference. Same rule, same sets, same sorted output — locked
 * against the definition above by `edge-refs-perf.test.ts`.
 */
export function attachEdgeRefs(root: PlainNode, graph: ArchGraph): PlainNode {
  const byId = new Set(graph.nodes.map((n) => n.id));
  const byPath = new Map<string, string>();
  for (const n of graph.nodes) if (n.path) byPath.set(n.path, n.id);

  // 1. Flatten the tree: every plain node gets an index and its parent's index.
  //    `delete edgeRefs` up front so a node that ends with no crossing edge is
  //    left exactly as the per-node version left it.
  const flat: PlainNode[] = [];
  const parentOf: number[] = [];
  const push = (node: PlainNode, parent: number): void => {
    const i = flat.length;
    flat.push(node);
    parentOf.push(parent);
    delete node.edgeRefs;
    for (const c of node.children) push(c, i);
  };
  push(root, -1);

  // 2. Which plain nodes reference each graph node DIRECTLY.
  const referrers = new Map<string, number[]>();
  for (let i = 0; i < flat.length; i += 1) {
    for (const ref of flat[i].sourceRefs) {
      const nid = refToNodeId(ref, byId, byPath);
      if (!nid) continue;
      const list = referrers.get(nid);
      if (list) list.push(i);
      else referrers.set(nid, [i]);
    }
  }

  // 3. Containing plain nodes of a graph node = the union of the root-paths of
  //    its direct referrers (memoised: an endpoint is usually shared by many
  //    edges). This is precisely `{ X : nodeId ∈ subtreeIds(X) }`.
  const stamp = new Int32Array(flat.length).fill(-1);
  let mark = 0;
  const containersCache = new Map<string, number[]>();
  const containersOf = (nodeId: string): number[] => {
    const hit = containersCache.get(nodeId);
    if (hit) return hit;
    const out: number[] = [];
    const seeds = referrers.get(nodeId);
    if (seeds) {
      const m = mark;
      mark += 1;
      for (const seed of seeds) {
        for (let i = seed; i >= 0 && stamp[i] !== m; i = parentOf[i]) {
          stamp[i] = m;
          out.push(i);
        }
      }
    }
    containersCache.set(nodeId, out);
    return out;
  };

  // 4. An edge crosses exactly the plain nodes that contain ONE endpoint but
  //    not the other — the symmetric difference of the two container sets.
  const refs: string[][] = flat.map(() => []);
  const inSrc = new Int32Array(flat.length).fill(-1);
  let edgeMark = 0;
  for (const e of graph.edges) {
    const src = containersOf(e.srcId);
    const dst = containersOf(e.dstId);
    const m = edgeMark;
    edgeMark += 1;
    for (const i of src) inSrc[i] = m;
    for (const i of dst) {
      if (inSrc[i] === m) inSrc[i] = -2; // in both — the edge stays inside
      else refs[i].push(e.id);
    }
    for (const i of src) {
      if (inSrc[i] === m) refs[i].push(e.id);
    }
  }

  for (let i = 0; i < flat.length; i += 1) {
    if (refs[i].length > 0) flat[i].edgeRefs = refs[i].sort();
  }
  return root;
}

const KIND_GLYPH: Record<PlainKind, string> = {
  group: '#',
  area: '▸',
  service: '•',
  feature: '·',
  data: '▪',
  file: '-',
};

interface OutlineOpts {
  /** Emit ANSI dim for summaries. Defaults to false (plain text). */
  color?: boolean;
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Render a PlainTree as an indented plain-English outline — the artifact the
 * CLI prints so a human can read the translation without the view existing yet.
 * Each line is `<indent><glyph> <title>` with the one-line summary dimmed after
 * an em dash.
 */
export function renderOutline(root: PlainNode, opts: OutlineOpts = {}): string {
  const lines: string[] = [];
  const walk = (node: PlainNode, depth: number): void => {
    const indent = '  '.repeat(depth);
    const glyph = KIND_GLYPH[node.kind] ?? '-';
    let line = `${indent}${glyph} ${node.title}`;
    if (node.summary && node.summary.trim() !== '') {
      const dash = ` — ${node.summary.trim()}`;
      line += opts.color ? `${DIM}${dash}${RESET}` : dash;
    }
    lines.push(line);
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}
