import test from 'node:test';
import assert from 'node:assert';
import type { ArchGraph, ArchEdge, ArchNode, EdgeKind } from '@sequence/schema';
import { serviceLevelRisksInput, liftToTopLevel } from '../explain/serviceGraph.js';

/**
 * Service-level projection lock. The risk engines rank over top-level components;
 * this pins that file-level interaction edges lift to service→service edges, that
 * a file→file edge inside ONE service collapses to a self-edge and is dropped,
 * that `import` edges are ignored, and that the projection is total (empty→empty).
 */

function node(id: string, kind: ArchNode['kind'], label: string, parentId?: string): ArchNode {
  return { id, kind, label, ...(parentId ? { parentId } : {}) };
}

function edge(srcId: string, dstId: string, kind: EdgeKind = 'http'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'f', line: 1, snippet: 's' }],
  };
}

function graphOf(nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return { version: 1, scannedAt: '', repoRoot: '', repoName: 'x', nodes, edges, warnings: [] };
}

// Two services (each with a file) + one shared datastore. gateway's file calls
// orders' file (lifts to gateway→orders); orders' file writes the datastore
// (lifts to orders→ds). A gateway file→file edge (self, dropped) and an import
// edge (ignored) are also present.
const NODES: ArchNode[] = [
  node('repo', 'repo', 'shop'),
  node('svc:gateway', 'service', 'gateway', 'repo'),
  node('f:gw/index', 'file', 'index.ts', 'svc:gateway'),
  node('f:gw/util', 'file', 'util.ts', 'svc:gateway'),
  node('svc:orders', 'service', 'orders', 'repo'),
  node('f:ord/main', 'file', 'main.py', 'svc:orders'),
  node('ds:postgres', 'datastore', 'postgres', 'repo'),
];

test('serviceLevelRisksInput — lifts file-level edges to service/datastore edges', () => {
  const g = graphOf(NODES, [
    edge('f:gw/index', 'f:ord/main'), // gateway → orders
    edge('f:ord/main', 'ds:postgres', 'db_access'), // orders → postgres
    edge('f:gw/index', 'f:gw/util', 'import'), // ignored (import)
    edge('f:gw/index', 'f:gw/util'), // gateway → gateway self-edge (dropped)
  ]);
  const { edges, nodes } = serviceLevelRisksInput(g);

  // nodes = the distinct top-level service/datastore/topic nodes (repo excluded).
  assert.deepStrictEqual(
    nodes.map((n) => n.id).sort(),
    ['ds:postgres', 'svc:gateway', 'svc:orders'],
  );

  // edges = only the two cross-component lifts; the self-edge and import dropped.
  const asStrings = edges.map((e) => `${e.srcId}>${e.dstId}`).sort();
  assert.deepStrictEqual(asStrings, ['svc:gateway>svc:orders', 'svc:orders>ds:postgres'].sort());
});

test('serviceLevelRisksInput — a file→file edge within one service is dropped (src===dst)', () => {
  const g = graphOf(NODES, [edge('f:gw/index', 'f:gw/util')]);
  const { edges } = serviceLevelRisksInput(g);
  assert.deepStrictEqual(edges, []);
});

test('serviceLevelRisksInput — import edges are ignored', () => {
  const g = graphOf(NODES, [edge('f:gw/index', 'f:ord/main', 'import')]);
  const { edges } = serviceLevelRisksInput(g);
  assert.deepStrictEqual(edges, []);
});

test('serviceLevelRisksInput — dedupes parallel lifted edges by srcId>dstId', () => {
  const g = graphOf(NODES, [
    edge('f:gw/index', 'f:ord/main', 'http'),
    edge('f:gw/util', 'f:ord/main', 'grpc'), // both lift to svc:gateway → svc:orders
  ]);
  const { edges } = serviceLevelRisksInput(g);
  assert.strictEqual(edges.length, 1);
  assert.deepStrictEqual(edges[0], { srcId: 'svc:gateway', dstId: 'svc:orders' });
});

test('serviceLevelRisksInput — empty graph → { edges: [], nodes: [] }, never throws', () => {
  const g = graphOf([], []);
  assert.deepStrictEqual(serviceLevelRisksInput(g), { edges: [], nodes: [] });
  // total on malformed input too
  assert.deepStrictEqual(
    serviceLevelRisksInput(undefined as unknown as ArchGraph),
    { edges: [], nodes: [] },
  );
});

test('liftToTopLevel — walks parentId to the nearest service/datastore/topic node', () => {
  const g = graphOf(NODES, []);
  const lift = liftToTopLevel(g);
  assert.strictEqual(lift('f:gw/index')?.id, 'svc:gateway');
  assert.strictEqual(lift('f:ord/main')?.id, 'svc:orders');
  assert.strictEqual(lift('ds:postgres')?.id, 'ds:postgres'); // itself is top-level
  assert.strictEqual(lift('repo'), undefined); // repo has no top-level ancestor
  assert.strictEqual(lift('nope'), undefined); // unknown id
});

test('liftToTopLevel — a malformed containment cycle terminates (never hangs)', () => {
  // A.parentId=B, B.parentId=A: neither is a service/datastore/topic, so no top
  // ancestor exists. Without a visited-guard this spins forever; it must return.
  const cyclic = graphOf(
    [node('a', 'file', 'a', 'b'), node('b', 'file', 'b', 'a'), node('self', 'module', 'self', 'self')],
    [],
  );
  const lift = liftToTopLevel(cyclic);
  assert.strictEqual(lift('a'), undefined);
  assert.strictEqual(lift('self'), undefined); // self-parent
  // And the whole projection is still total on a cyclic graph (edge touches the cycle).
  const g2 = graphOf(
    [node('a', 'file', 'a', 'b'), node('b', 'file', 'b', 'a'), node('svc:x', 'service', 'x', 'repo')],
    [{ id: 'a->svc:x', srcId: 'a', dstId: 'svc:x', kind: 'http', confidence: 1, origin: 'deterministic', evidence: [] }],
  );
  assert.deepStrictEqual(serviceLevelRisksInput(g2).edges, []); // 'a' lifts to nothing → dropped, no hang
});
