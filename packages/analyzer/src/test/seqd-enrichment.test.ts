import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archGraphToSeqDiagram } from '@sequence/export';
import { validateSeqDiagram, type ArchGraph, type SeqDiagramNodeDetail } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { createRepoServer } from '../server/repoServer.js';
import { seqdNodeDetailFromStructuralTree, seqdTopologyDetailFromGraph } from '../explain/seqdEnrichment.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

test('seqdNodeDetailFromStructuralTree: shopfront services get English from structural explain', async () => {
  const graph = await scanRepo(SHOPFRONT);
  const detail = seqdNodeDetailFromStructuralTree(graph);
  const doc = archGraphToSeqDiagram(graph, { origin: 'scan', nodeDetail: detail });

  const validation = validateSeqDiagram(doc);
  assert.deepEqual(validation, { ok: true, errors: [] }, validation.errors.join('; '));

  const withEnglish = doc.nodes.filter(
    (n) => n.kind === 'service' && (n.detail?.whatItIs || n.detail?.whatItDoes),
  );
  assert.ok(
    withEnglish.length >= 3,
    `expected English on several services from structural tree (got ${withEnglish.length})`,
  );

  for (const n of doc.nodes) {
    assert.ok(graph.nodes.some((g) => g.id === n.id), `diagram node ${n.id} must exist on graph`);
    assert.match(n.id, /^(svc:|ds:|topic:)/, `scan-shaped id required — got ${n.id}`);
  }

  const edgesWithEvidence = doc.edges.filter((e) => e.evidenceRef?.startsWith('scan:'));
  assert.ok(
    edgesWithEvidence.length >= 5,
    `expected grounded edge evidence refs (got ${edgesWithEvidence.length})`,
  );
});

test('seqdTopologyDetailFromGraph: derives parts and talksTo from arch children and projected edges', async () => {
  const graph = await scanRepo(SHOPFRONT);
  const detail = seqdTopologyDetailFromGraph(graph);

  const gateway = detail['svc:gateway'];
  assert.ok(gateway?.talksTo && gateway.talksTo.length >= 2, 'gateway should list grounded neighbours');

  for (const id of Object.keys(detail)) {
    assert.ok(graph.nodes.some((g) => g.id === id), `detail key ${id} is not a real arch node id`);
    const d = detail[id]!;
    if (d.parts) {
      for (const part of d.parts) {
        assert.ok(part.trim().length > 0, 'parts entries must be non-empty');
      }
    }
    if (d.talksTo) {
      for (const t of d.talksTo) {
        assert.ok(t.trim().length > 0, 'talksTo entries must be non-empty');
      }
    }
  }
});

test('seqdNodeDetailFromStructuralTree: never keys detail by invented ids', async () => {
  const graph = await scanRepo(SHOPFRONT);
  const detail = seqdNodeDetailFromStructuralTree(graph);
  const graphIds = new Set(graph.nodes.map((n) => n.id));
  for (const id of Object.keys(detail)) {
    assert.ok(graphIds.has(id), `detail key ${id} is not a real arch node id`);
  }
});

test('GET /archgraph.json includes server-computed nodeDetail for attach seqd', async () => {
  const server = await createRepoServer(SHOPFRONT, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/archgraph.json`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as ArchGraph & {
      nodeDetail?: Record<string, SeqDiagramNodeDetail>;
    };
    assert.ok(body.nodeDetail, 'archgraph.json must include nodeDetail map');
    const graphIds = new Set(body.nodes.map((n) => n.id));
    for (const id of Object.keys(body.nodeDetail!)) {
      assert.ok(graphIds.has(id), `nodeDetail key ${id} is not a real arch node id`);
    }
    const withEnglish = Object.values(body.nodeDetail!).filter((d) => d.whatItIs || d.whatItDoes);
    assert.ok(withEnglish.length >= 3, `expected English detail slots (got ${withEnglish.length})`);
    const doc = archGraphToSeqDiagram(body as ArchGraph, {
      origin: 'scan',
      nodeDetail: body.nodeDetail,
    });
    const servicesWithDetail = doc.nodes.filter(
      (n) => n.kind === 'service' && (n.detail?.whatItIs || n.detail?.whatItDoes),
    );
    assert.ok(servicesWithDetail.length >= 3, 'seqd from payload must carry MADR detail on services');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
