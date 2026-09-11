/**
 * LOCKING TEST for the `attachEdgeRefs` performance round (H12b).
 *
 * The original rule — "an edge belongs to a node when exactly one of its
 * endpoints lives inside that node's subtree" — was implemented as a scan of
 * EVERY graph edge for EVERY plain node: `plainNodes × edges`, both of which
 * grow with the repo. Measured: n8n 19 148 plain nodes × 33 065 edges = 19.6 s
 * of `buildStructuralTree`'s 19.6 s; django 2 998 × 8 988 = 0.65 s.
 *
 * The shipped version computes the same sets from the endpoints' root-paths.
 * This test keeps the ORIGINAL as the oracle and asserts the two agree
 * key-for-key — including which nodes carry no `edgeRefs` property at all — on
 * real scanned repositories and on generated trees built to stress the awkward
 * cases: the same graph node referenced by several plain nodes, sourceRefs
 * given as PATHS rather than ids, refs that resolve to nothing, self-loops,
 * duplicate edges and repeated endpoints.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { attachEdgeRefs, type PlainNode } from '../explain/plaintree.js';
import { buildStructuralTree } from '../explain/explain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const FIXTURES = path.join(ANALYZER_ROOT, 'test', 'fixtures');

/* -------------------------------------------------------------- the oracle -- */

function refToNodeId(ref: string, byId: Set<string>, byPath: Map<string, string>): string | undefined {
  if (byId.has(ref)) return ref;
  return byPath.get(ref);
}

/** The pre-index implementation, verbatim. */
function oracleAttachEdgeRefs(root: PlainNode, graph: ArchGraph): PlainNode {
  const byId = new Set(graph.nodes.map((n) => n.id));
  const byPath = new Map<string, string>();
  for (const n of graph.nodes) if (n.path) byPath.set(n.path, n.id);
  const subtree = (node: PlainNode): Set<string> => {
    const ids = new Set<string>();
    for (const ref of node.sourceRefs) {
      const nid = refToNodeId(ref, byId, byPath);
      if (nid) ids.add(nid);
    }
    for (const c of node.children) {
      for (const id of subtree(c)) ids.add(id);
    }
    const refs: string[] = [];
    for (const e of graph.edges) {
      const inSrc = ids.has(e.srcId);
      const inDst = ids.has(e.dstId);
      if (inSrc !== inDst) refs.push(e.id);
    }
    if (refs.length > 0) node.edgeRefs = refs.sort();
    else delete node.edgeRefs;
    return ids;
  };
  subtree(root);
  return root;
}

/** Every node's edgeRefs, keyed by plain id — `undefined` where the property is absent. */
function edgeRefMap(root: PlainNode): Map<string, string[] | undefined> {
  const out = new Map<string, string[] | undefined>();
  const walk = (n: PlainNode): void => {
    out.set(n.id, 'edgeRefs' in n ? n.edgeRefs : undefined);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

function clone(node: PlainNode): PlainNode {
  return JSON.parse(JSON.stringify(node)) as PlainNode;
}

function assertMatchesOracle(tree: PlainNode, graph: ArchGraph, what: string): void {
  const fast = edgeRefMap(attachEdgeRefs(clone(tree), graph));
  const slow = edgeRefMap(oracleAttachEdgeRefs(clone(tree), graph));
  assert.deepStrictEqual(fast, slow, `${what}: edgeRefs must be identical to the per-node definition`);
}

/* ------------------------------------------------------- real repositories -- */

for (const fixture of ['shopfront', 'monorepo-apps', 'shared-backend', 'mixed-lang', 'k8s-nested-helm']) {
  test(`attachEdgeRefs matches the per-node oracle on ${fixture}`, async () => {
    const graph = await scanRepo(path.join(FIXTURES, fixture), { cluster: true });
    for (const profile of ['recommended', 'bestfit'] as const) {
      for (const detail of ['regular', 'advanced'] as const) {
        assertMatchesOracle(buildStructuralTree(graph, profile, detail), graph, `${fixture} ${profile}/${detail}`);
      }
    }
  });
}

/* -------------------------------------------------------------- generated --- */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Generated {
  graph: ArchGraph;
  tree: PlainNode;
}

function generate(seed: number): Generated {
  const r = rng(seed);
  const nodes: ArchNode[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  const nGraph = 3 + Math.floor(r() * 25);
  for (let i = 0; i < nGraph; i += 1) {
    nodes.push({ id: `n${i}`, kind: 'file', label: `n${i}.ts`, path: `src/n${i}.ts`, parentId: 'repo' });
  }
  const edges: ArchEdge[] = [];
  const nEdges = Math.floor(r() * 40);
  for (let e = 0; e < nEdges; e += 1) {
    const a = Math.floor(r() * nGraph);
    // Deliberately allow self-loops and repeated endpoint pairs.
    const b = r() < 0.1 ? a : Math.floor(r() * nGraph);
    edges.push({ id: `e${e}`, srcId: `n${a}`, dstId: `n${b}`, kind: 'http', evidence: [], confidence: 1, origin: 'design' });
  }
  const graph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'generated',
    nodes,
    edges,
    warnings: [],
  };

  // A plain tree over those nodes: random depth, some graph nodes referenced by
  // several plain nodes, refs given as ids OR paths, plus refs to nothing.
  let counter = 0;
  const makeNode = (depth: number): PlainNode => {
    const id = `p${counter}`;
    counter += 1;
    const sourceRefs: string[] = [];
    const nRefs = Math.floor(r() * 3);
    for (let i = 0; i < nRefs; i += 1) {
      const roll = r();
      const g = Math.floor(r() * nGraph);
      if (roll < 0.1) sourceRefs.push('not-a-real-ref');
      else if (roll < 0.5) sourceRefs.push(`src/n${g}.ts`);
      else sourceRefs.push(`n${g}`);
    }
    const children: PlainNode[] = [];
    const nKids = depth >= 4 ? 0 : Math.floor(r() * 4);
    for (let i = 0; i < nKids; i += 1) children.push(makeNode(depth + 1));
    return { id, title: id, summary: '', kind: 'group', children, sourceRefs };
  };
  return { graph, tree: makeNode(0) };
}

test('attachEdgeRefs matches the per-node oracle on generated trees', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { graph, tree } = generate(seed);
    assertMatchesOracle(tree, graph, `seed ${seed}`);
  }
});

/* ------------------------------------------------------------ the quadratic - */

/**
 * FAILS ON BASE — MEASURED, not assumed: the pre-fix implementation takes
 * 16.6 s on this graph (3.0 s on a quarter of it), because 12 000 plain
 * nodes × 40 000 edges is 4.8×10^8 membership pairs — roughly n8n's real shape
 * (19 148 × 33 065, 19.6 s). The shipped version does it in 0.12 s, linear in
 * edges plus tree depth, so the 5 s bound is ~40× what it needs and can only
 * trip if the per-node edge scan comes back.
 */
test('attachEdgeRefs stays linear: 12 000 plain nodes over 40 000 edges', () => {
  const nodes: ArchNode[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  const N = 12_000;
  for (let i = 0; i < N; i += 1) {
    nodes.push({ id: `n${i}`, kind: 'file', label: `n${i}.ts`, path: `src/n${i}.ts`, parentId: 'repo' });
  }
  const edges: ArchEdge[] = [];
  for (let e = 0; e < 40_000; e += 1) {
    edges.push({ id: `e${e}`, srcId: `n${e % N}`, dstId: `n${(e * 7 + 3) % N}`, kind: 'http', evidence: [], confidence: 1, origin: 'design' });
  }
  const graph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'big',
    nodes,
    edges,
    warnings: [],
  };
  const children: PlainNode[] = [];
  for (let i = 0; i < N; i += 1) {
    children.push({ id: `p:n${i}`, title: `n${i}`, summary: '', kind: 'file', children: [], sourceRefs: [`n${i}`] });
  }
  const tree: PlainNode = { id: 'p:repo', title: 'repo', summary: '', kind: 'group', children, sourceRefs: ['repo'] };

  const started = Date.now();
  attachEdgeRefs(tree, graph);
  const elapsed = Date.now() - started;
  assert.ok(tree.children.some((c) => (c.edgeRefs ?? []).length > 0), 'crossing edges must still be attached');
  assert.ok(elapsed < 5_000, `attachEdgeRefs took ${elapsed}ms — the per-node edge scan is back`);
});
