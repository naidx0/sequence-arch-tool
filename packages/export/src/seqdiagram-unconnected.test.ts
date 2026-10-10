import assert from 'node:assert';
import { test } from 'node:test';

import { archGraphToSeqDiagram } from './seqdiagram.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * A SERVICE THE SCAN FOUND AND THE DIAGRAM DID NOT DRAW.
 *
 * `archGraphToSeqDiagram` built its node list from `orderParticipants(edges)` —
 * the endpoints of PROJECTED edges. `projectEdges` drops every `import` edge,
 * so a service whose only relationships are imports had no projected edge and
 * therefore no node. It was not omitted for a reason the diagram could state;
 * it was never considered.
 *
 * MEASURED ON THIS MONOREPO, 2026-08-22: 628 nodes and 1,243 edges in, of which
 * 1,237 are imports. Out came a diagram of TWO nodes and ONE edge — 9 of the 10
 * services missing, along with the repo node. The whole of Sequence exported as
 * two boxes.
 *
 * `canvasReduce.ts` has the name for this: "A node the analyzer found and the
 * board silently declined to draw is a lie of omission." The board learned that
 * lesson in its detail budget; the export projector had not.
 *
 * THE FIX IS THE SYSTEMS LAYER, AND ONLY THE SYSTEMS LAYER — the owner's ruling
 * is one level, no nesting. Services, datastores and topics are placed whether
 * or not an edge touched them. Files and modules are not, and the second test
 * here is what keeps a later change from quietly promoting 589 files onto a
 * board that is supposed to show a system.
 */

/** A graph whose only edges are imports — the shape a monorepo actually has. */
function importOnlyGraph(): ArchGraph {
  return {
    mode: 'scan',
    repoName: 'mono',
    repoRoot: '/repo',
    scannedAt: '2026-08-22T00:00:00.000Z',
    nodes: [
      { id: 'svc:api', label: 'api', kind: 'service', path: 'packages/api/src/index.ts' },
      { id: 'svc:web', label: 'web', kind: 'service', path: 'packages/web/src/index.ts' },
      { id: 'svc:worker', label: 'worker', kind: 'service', path: 'packages/worker/src/index.ts' },
      { id: 'db:main', label: 'main', kind: 'datastore' },
      { id: 'file:a', label: 'a.ts', kind: 'file', path: 'packages/api/src/a.ts', parentId: 'svc:api' },
      { id: 'file:b', label: 'b.ts', kind: 'file', path: 'packages/web/src/b.ts', parentId: 'svc:web' },
      { id: 'mod:core', label: 'core', kind: 'module', parentId: 'svc:api' },
    ],
    edges: [
      { id: 'i1', srcId: 'file:a', dstId: 'file:b', kind: 'import', confidence: 1, origin: 'deterministic' },
      { id: 'i2', srcId: 'file:b', dstId: 'file:a', kind: 'import', confidence: 1, origin: 'deterministic' },
    ],
  } as unknown as ArchGraph;
}

test('a service whose only edges are imports still reaches the diagram', () => {
  const doc = archGraphToSeqDiagram(importOnlyGraph(), { origin: 'export' });
  const labels = doc.nodes.map((n) => n.label).sort();

  /*
   * Before this fix the projected edge list was empty, so `order` was empty and
   * `doc.nodes` was []. Three services and a datastore the scan found, and a
   * diagram claiming the repository is blank.
   */
  assert.deepStrictEqual(labels, ['api', 'main', 'web', 'worker']);
});

test('files and modules stay off — the ruling is one level, not nesting', () => {
  const doc = archGraphToSeqDiagram(importOnlyGraph(), { origin: 'export' });
  const kinds = new Set(doc.nodes.map((n) => n.kind));
  /* `a.ts`, `b.ts` and `core` are in the graph and must not be on this board.
     Placing "every node we found" would replace one wrong answer with another:
     a systems map with 589 files on it is not a systems map. */
  assert.ok(!kinds.has('file'), 'no file node on the systems layer');
  assert.ok(!kinds.has('module'), 'no module node on the systems layer');
  assert.strictEqual(doc.nodes.length, 4);
});

test('every placed node still carries its real id and evidence, not a synthetic one', () => {
  const doc = archGraphToSeqDiagram(importOnlyGraph(), { origin: 'export' });
  const api = doc.nodes.find((n) => n.label === 'api');
  assert.ok(api, 'api is placed');
  /* `archNodeEvidenceRef` reads `path`, not `file` — the fixture says `path`
     because that is the field the scanner writes and the projector reads. */
  /* The whole point of placing it is that it is GROUNDED. A node added by this
     path that carried a synthesised id would be indistinguishable from one the
     chat invented, which is the distinction the schema uses `evidenceRef` for. */
  assert.strictEqual(api.id, 'svc:api');
  assert.ok(api.evidenceRef, 'a scanned service carries an evidence pointer');
});

test('a connected graph is unchanged — the addition never displaces a real participant', () => {
  const g = importOnlyGraph();
  g.edges = [
    ...g.edges,
    {
      id: 'h1',
      srcId: 'svc:web',
      dstId: 'svc:api',
      kind: 'http',
      confidence: 0.95,
      origin: 'deterministic',
    },
  ] as never;

  const doc = archGraphToSeqDiagram(g, { origin: 'export' });
  assert.strictEqual(doc.edges.length, 1, 'the http edge is drawn');
  /*
   * `orderParticipants` puts entry services — a service with no inbound http —
   * first. `web` calls `api`, so `web` is an entry and `api` is not, and the
   * unconnected `worker` must not have jumped the queue ahead of it.
   */
  assert.strictEqual(doc.nodes[0]?.label, 'web', 'the entry service still leads');
  assert.deepStrictEqual(
    doc.nodes.map((n) => n.label).sort(),
    ['api', 'main', 'web', 'worker'],
    'and everything is still placed exactly once',
  );
});

test('placement is deterministic', () => {
  const a = archGraphToSeqDiagram(importOnlyGraph(), { origin: 'export' });
  const b = archGraphToSeqDiagram(importOnlyGraph(), { origin: 'export' });
  assert.deepStrictEqual(
    a.nodes.map((n) => n.id),
    b.nodes.map((n) => n.id),
    'two runs over one graph place the same nodes in the same order',
  );
});
