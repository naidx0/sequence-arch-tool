import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isReadableGraphVersion, validateGraph, type ArchGraph } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { apiNodes, linkApis } from '../ontologyV2.js';

/* Ontology v2 (docs/research/overhaul-formats-v2.md §3.1), on the real
   shopfront fixture, scanned from a temp copy so the fixture is never written. */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'shopfront');

let cached: ArchGraph | null = null;
async function shopfront(): Promise<ArchGraph> {
  if (cached) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ontology-v2-'));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  try {
    cached = await scanRepo(dir, { cluster: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}

test('a scan writes graph version 2, and validation reads both versions', async () => {
  const g = await shopfront();
  assert.strictEqual(g.version, 2);
  assert.ok(isReadableGraphVersion(1) && isReadableGraphVersion(2) && !isReadableGraphVersion(3));
  const v1 = { ...g, version: 1 as const };
  assert.ok(!validateGraph(v1).some((p) => p.includes('version')));
  assert.ok(validateGraph({ ...g, version: 3 as unknown as 2 }).some((p) => p.includes('unsupported graph version')));
});

test('every matched http edge on shopfront lands on an api node of the service it calls', async () => {
  const g = await shopfront();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const matched = g.edges.filter((e) => e.kind === 'http' && typeof e.detail?.matchedRoute === 'string');
  assert.ok(matched.length > 0, 'shopfront has matched http edges');
  for (const e of matched) {
    assert.ok(e.apiId, `edge ${e.id} (${e.detail?.matchedRoute}) has no apiId`);
    const api = byId.get(e.apiId!);
    assert.strictEqual(api?.kind, 'api');
    assert.strictEqual(api?.parentId, `svc:${e.detail?.targetService}`);
  }
  assert.ok(!validateGraph(g).some((p) => p.includes('apiId')));
});

test('every unmatched outbound URL becomes exactly one external node, and no scanned service is one', async () => {
  const g = await shopfront();
  const external = g.edges.filter((e) => e.external);
  assert.ok(external.length > 0, 'shopfront calls api.stripe.com');
  const extNodes = g.nodes.filter((n) => n.kind === 'external');
  const hosts = new Set(external.map((e) => e.dstId));
  assert.deepStrictEqual(extNodes.map((n) => n.id).sort(), [...hosts].sort());
  assert.strictEqual(new Set(extNodes.map((n) => n.id)).size, extNodes.length);
  const services = new Set(g.nodes.filter((n) => n.kind === 'service').map((n) => n.id.slice('svc:'.length)));
  for (const n of extNodes) assert.ok(!services.has(n.label), `${n.id} is a scanned service`);
  for (const n of extNodes) assert.strictEqual(n.parentId, undefined);
});

test('api nodes: one per route, under a service the graph has; a route of an unknown service makes none', () => {
  const routes = [
    { service: 'orders', method: 'get', path: '/orders', file: 'o.ts', line: 1 },
    { service: 'orders', method: 'GET', path: '/orders', file: 'o.ts', line: 2 },
    { service: 'ghost', method: 'GET', path: '/x', file: 'g.ts', line: 1 },
  ];
  const apis = apiNodes(routes, new Set(['svc:orders']));
  assert.deepStrictEqual(apis.map((a) => a.id), ['api:svc:orders:GET /orders']);
  const edges = [
    { id: 'e', srcId: 'f', dstId: 'file:o.ts', kind: 'http', confidence: 1, origin: 'deterministic', evidence: [], detail: { targetService: 'orders', matchedRoute: 'GET /orders' } },
  ] as unknown as ArchGraph['edges'];
  linkApis(edges, new Set(apis.map((a) => a.id)));
  assert.strictEqual(edges[0]!.apiId, 'api:svc:orders:GET /orders');
  assert.strictEqual(edges[0]!.dstId, 'file:o.ts');
});
