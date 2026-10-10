import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GRAPH_VERSION,
  apiNodeId,
  externalNodeId,
  isReadableGraphVersion,
  validateGraph,
  type ArchGraph,
} from './index.js';

/* Ontology v2 (overhaul formats §3.1): additive, so a version 1 graph still
   loads unchanged. */

test('a pinned version 1 graph validates exactly as it did', () => {
  const g = JSON.parse(readFileSync(new URL('../test/fixtures/archgraph.real.json', import.meta.url), 'utf8')) as ArchGraph;
  assert.equal(g.version, 1);
  assert.ok(isReadableGraphVersion(g.version));
  const problems = validateGraph(g);
  assert.ok(!problems.some((p) => /version|apiId/.test(p)), problems.join('\n'));
});

test('writers emit 2; anything else is refused with its value named', () => {
  assert.equal(GRAPH_VERSION, 2);
  const g = { version: 7, scannedAt: '', repoRoot: '', repoName: 'x', nodes: [], edges: [], warnings: [] } as unknown as ArchGraph;
  assert.deepEqual(validateGraph(g), ['unsupported graph version: 7 (expected 1 or 2)']);
});

test('api and external ids, and an apiId must name an api node', () => {
  assert.equal(apiNodeId('svc:orders', 'get', '/orders/*'), 'api:svc:orders:GET /orders/*');
  assert.equal(externalNodeId('API.Stripe.com'), 'ext:api.stripe.com');
  const ev = [{ file: 'a.ts', line: 1, snippet: '' }];
  const g: ArchGraph = {
    version: 2,
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    warnings: [],
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'a' },
      { id: 'svc:b', kind: 'service', label: 'b' },
      { id: 'f', kind: 'file', label: 'f', parentId: 'svc:a' },
      { id: 'api:svc:b:GET /x', kind: 'api', label: 'GET /x', parentId: 'svc:b' },
      { id: 'ext:s3', kind: 'external', label: 's3' },
    ],
    edges: [
      { id: 'e1', srcId: 'f', dstId: 'svc:b', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev, apiId: 'api:svc:b:GET /x' },
      { id: 'e2', srcId: 'f', dstId: 'ext:s3', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev, external: true },
      { id: 'e3', srcId: 'f', dstId: 'svc:b', kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev, apiId: 'svc:a' },
    ],
  };
  assert.deepEqual(validateGraph(g), ['edge e3 apiId svc:a is a service, not an api']);
});
