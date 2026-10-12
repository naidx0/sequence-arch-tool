import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo, NoManifestsError } from '../scan.js';
import { projectToServiceLevel } from '../score.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

test('shopfront fixture: all ground-truth edges found, no false positives', async () => {
  const graph = await scanRepo(FIXTURE);
  const predicted = projectToServiceLevel(graph);

  const expected = [
    'gateway -> orders [http]',
    'gateway -> payments [http]',
    'orders -> payments [http]',
    'orders -> inventory [grpc]',
    'orders -> topic:order.created [queue_publish]',
    'notifications -> topic:order.created [queue_consume]',
    'orders -> postgres [db_access]',
    'payments -> postgres [db_access]',
    'gateway -> shipping [http]',
    'shipping -> postgres [db_access]',
    'shipping -> topic:order.created [queue_consume]',
    'edge -> gateway [http]',
    'gateway -> invoices [http]',
    'invoices -> payments [http]',
    'invoices -> postgres [db_access]',
  ];
  for (const e of expected) {
    assert.ok(predicted.has(e), `missing expected edge: ${e}\ngot: ${[...predicted].join('\n')}`);
  }
  assert.strictEqual(predicted.size, expected.length, `unexpected extra edges: ${[...predicted].filter((e) => !expected.includes(e)).join(', ')}`);

  // traps
  assert.ok(!predicted.has('gateway -> redis [db_access]'), 'depends_on must not create edges');
  for (const e of graph.edges) {
    assert.ok(e.evidence.length > 0, `edge ${e.id} missing evidence`);
  }

  // structural sanity
  const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.label).sort();
  assert.deepStrictEqual(services, [
    'edge',
    'gateway',
    'inventory',
    'invoices',
    'notifications',
    'orders',
    'payments',
    'shipping',
  ]);
  const topics = graph.nodes.filter((n) => n.kind === 'topic');
  assert.strictEqual(topics.length, 1);
  assert.strictEqual(topics[0].label, 'order.created');
  // topic parented under the redis broker node
  assert.strictEqual(topics[0].parentId, 'ds:redis');
  // topic now has two consumers: notifications (Python) and shipping (Go)
  const consumeEdges = graph.edges.filter(
    (e) => e.kind === 'queue_consume' && e.dstId === topics[0].id
  );
  assert.strictEqual(consumeEdges.length, 2);
});

test('scan of a directory without compose fails with a NoManifestsError', async () => {
  await assert.rejects(
    () => scanRepo(path.resolve(here, '..')),
    (e: unknown) => {
      // Distinct, catchable error (not a generic Error) carrying the stable
      // 'no-manifests' discriminator and a calm, friendly message — this is what
      // the attach path turns into a 422 informational note (BUG 2).
      assert.ok(e instanceof NoManifestsError, `expected NoManifestsError, got ${e}`);
      assert.strictEqual(e.code, 'no-manifests');
      assert.match(e.message, /nothing to scan yet/);
      assert.match(e.message, /docker-compose, Kubernetes, or Helm/);
      return true;
    }
  );
});
