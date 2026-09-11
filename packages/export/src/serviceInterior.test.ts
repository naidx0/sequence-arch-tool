import assert from 'node:assert';
import { test } from 'node:test';

import { serviceInterior } from './serviceInterior.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * OPENING A SERVICE.
 *
 * The owner's ruling was SYSTEMS LAYER ONLY, no nesting — "but a service must
 * still be openable". Those are not in tension: opening REPLACES the view
 * rather than nesting inside it, so one level is on screen at a time and the
 * level changes.
 *
 * It is deliberately NOT `archGraphToBreakoutSeqDiagram`. Measured on
 * shopfront, that function places the focus service and its service-level
 * NEIGHBOURS and returned none of the gateway's six file children, despite its
 * `breakout-interior` kind. It answers "what does this talk to"; this answers
 * "what is in it".
 */

function graph(): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'shop',
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service' },
      { id: 'svc:orders', label: 'orders', kind: 'service' },
      { id: 'file:gw/app.ts', label: 'app.ts', kind: 'file', path: 'gw/app.ts', parentId: 'svc:gateway' },
      { id: 'file:gw/routes.ts', label: 'routes.ts', kind: 'file', path: 'gw/routes.ts', parentId: 'svc:gateway' },
      { id: 'file:gw/util.ts', label: 'util.ts', kind: 'file', path: 'gw/util.ts', parentId: 'svc:gateway' },
      { id: 'file:or/place.ts', label: 'place.ts', kind: 'file', path: 'or/place.ts', parentId: 'svc:orders' },
    ],
    edges: [
      { id: 'i1', srcId: 'file:gw/app.ts', dstId: 'file:gw/routes.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
      { id: 'i2', srcId: 'file:gw/routes.ts', dstId: 'file:gw/util.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
      /* Leaves the service — a fact about the systems layer. */
      { id: 'h1', srcId: 'file:gw/routes.ts', dstId: 'file:or/place.ts', kind: 'http', confidence: 1, origin: 'deterministic' },
    ],
    warnings: [],
  } as unknown as ArchGraph;
}

test('opening a service shows what is INSIDE it', () => {
  const { doc, total } = serviceInterior(graph(), 'svc:gateway');
  assert.strictEqual(total, 3);
  assert.deepStrictEqual(
    doc.nodes.map((n) => n.label).sort(),
    ['app.ts', 'routes.ts', 'util.ts'],
  );
  /* And nothing from a sibling service: `place.ts` belongs to orders. */
  assert.ok(!doc.nodes.some((n) => n.label === 'place.ts'));
});

test('membership is `parentId`, the scan’s own containment — not a path prefix', () => {
  const g = graph();
  /* A file whose PATH looks like it belongs to the gateway but whose parent
     says otherwise. Re-deriving membership from directory names would disagree
     with the graph the moment a build context is narrowed, which
     `discovery/compose.ts` already warns about. */
  g.nodes.push({
    id: 'file:gw/imposter.ts',
    label: 'imposter.ts',
    kind: 'file',
    path: 'gw/imposter.ts',
    parentId: 'svc:orders',
  } as never);
  const { doc } = serviceInterior(g, 'svc:gateway');
  assert.ok(!doc.nodes.some((n) => n.label === 'imposter.ts'));
});

test('only edges with BOTH ends inside are drawn', () => {
  const { doc } = serviceInterior(graph(), 'svc:gateway');
  /*
   * The http edge leaves the service. Drawing half of it would put a line into
   * empty space, and the reader would be looking for a card that is one level
   * up.
   */
  assert.strictEqual(doc.edges.length, 2);
  for (const e of doc.edges) {
    assert.ok(doc.nodes.some((n) => n.id === e.from));
    assert.ok(doc.nodes.some((n) => n.id === e.to));
  }
});

test('a service with nothing inside is an EMPTY answer, not an error', () => {
  const { doc, total } = serviceInterior(graph(), 'svc:orders');
  assert.strictEqual(total, 1);
  assert.strictEqual(doc.nodes.length, 1);

  const { doc: none, total: zero } = serviceInterior(graph(), 'svc:nope');
  /* A view that errored on a single-file service would refuse the simplest
     repository there is. */
  assert.deepStrictEqual(none.nodes, []);
  assert.strictEqual(zero, 0);
});

test('when it does not all fit, the CONNECTED ones are kept and the rest are counted', () => {
  const g = graph();
  for (let i = 0; i < 40; i += 1) {
    g.nodes.push({
      id: `file:gw/lonely${i}.ts`,
      label: `lonely${i}.ts`,
      kind: 'file',
      path: `gw/lonely${i}.ts`,
      parentId: 'svc:gateway',
    } as never);
  }
  const { doc, total, omitted } = serviceInterior(g, 'svc:gateway', { limit: 3 });

  assert.strictEqual(total, 43);
  assert.strictEqual(doc.nodes.length, 3);
  /*
   * RANKED BY CONNECTEDNESS. An alphabetical cut would keep `lonely0.ts` and
   * drop `routes.ts`, which every other file goes through — the one card the
   * reader opened the service to find.
   */
  assert.ok(doc.nodes.some((n) => n.label === 'routes.ts'));
  /* And what was left out is COUNTED, so the surface can say so rather than
     imply the service has three files. */
  assert.strictEqual(omitted, 40);
});

test('placed nodes keep their evidence, so an interior card is still grounded', () => {
  const { doc } = serviceInterior(graph(), 'svc:gateway');
  for (const n of doc.nodes) {
    assert.ok(n.evidenceRef, `${n.label} lost its evidence`);
  }
});

test('the title says which service was opened', () => {
  assert.strictEqual(serviceInterior(graph(), 'svc:gateway').doc.title, 'Inside gateway');
});

test('is deterministic', () => {
  const a = serviceInterior(graph(), 'svc:gateway');
  const b = serviceInterior(graph(), 'svc:gateway');
  assert.deepStrictEqual(
    a.doc.nodes.map((n) => n.id),
    b.doc.nodes.map((n) => n.id),
  );
});
