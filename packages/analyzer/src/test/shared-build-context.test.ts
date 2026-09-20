import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGraph } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { projectToServiceLevel } from '../score.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shared-backend');

// Regression for the real crash: a docker-compose with two services that both
// `build: ./backend` (a FastAPI `api` + an arq/celery `worker` sharing one
// image/codebase) plus a `db`. The scanner walked the shared source dir once
// per service and emitted a `file:` node per walk, so shared files collided and
// `validateGraph` rejected the whole scan with "duplicate node id: file:...".
test('shared build context: scans clean, emits a graph with no duplicate node ids', async () => {
  // Must not throw — the whole scan used to fail validation here.
  const graph = await scanRepo(FIXTURE);

  // The emitted graph ALWAYS passes validateGraph (schema is authoritative).
  assert.deepStrictEqual(validateGraph(graph), [], 'emitted graph must pass validateGraph');

  // No duplicate node ids anywhere in the graph.
  const ids = graph.nodes.map((n) => n.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate node ids: ${[...new Set(dupes)].join(', ')}`);
});

test('shared build context: shared file is exactly ONE file node, imports resolve to it', async () => {
  const graph = await scanRepo(FIXTURE);

  // Each shared source file appears as EXACTLY ONE `file:` node (emitted once,
  // parented under the first service to claim the dir — not once per service).
  for (const rel of [
    'backend/app/main.py',
    'backend/app/db.py',
    'backend/app/__init__.py',
    'backend/alembic/env.py',
    'backend/alembic/versions/0001_baseline.py',
  ]) {
    const matches = graph.nodes.filter((n) => n.id === `file:${rel}`);
    assert.strictEqual(matches.length, 1, `expected exactly one node for ${rel}, got ${matches.length}`);
  }

  // Parenting decision: the shared file tree is parented under the FIRST service
  // that claims the build context (compose order → `api`), directly or via a
  // module. main.py must lift to `api`, never `worker`.
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const liftToService = (id: string): string | undefined => {
    let cur = nodeById.get(id);
    while (cur) {
      if (cur.kind === 'service') return cur.label;
      cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
    }
    return undefined;
  };
  assert.strictEqual(liftToService('file:backend/app/main.py'), 'api');

  // Any import edge to a deduped file node must resolve to the surviving node id
  // (no dangling srcId/dstId). main.py imports app.db → there is exactly one such
  // import edge, and both endpoints exist as nodes.
  const importEdges = graph.edges.filter((e) => e.kind === 'import');
  const mainToDb = importEdges.filter(
    (e) => e.srcId === 'file:backend/app/main.py' && e.dstId === 'file:backend/app/db.py'
  );
  assert.strictEqual(mainToDb.length, 1, 'expected exactly one main.py -> db.py import edge (not one per service)');
  for (const e of graph.edges) {
    assert.ok(nodeById.has(e.srcId), `edge ${e.id} has dangling srcId ${e.srcId}`);
    assert.ok(nodeById.has(e.dstId), `edge ${e.id} has dangling dstId ${e.dstId}`);
  }
});

test('shared build context: two distinct services, service-level edges correct', async () => {
  const graph = await scanRepo(FIXTURE);

  // Two sharing services are still two DISTINCT services (distinct svc: ids).
  const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.label).sort();
  assert.deepStrictEqual(services, ['api', 'worker']);
  assert.ok(graph.nodes.some((n) => n.id === 'svc:api'));
  assert.ok(graph.nodes.some((n) => n.id === 'svc:worker'));

  // Both services independently wire to the shared datastore (the `db` service).
  const predicted = projectToServiceLevel(graph);
  assert.ok(predicted.has('api -> db [db_access]'), `missing api -> db; got: ${[...predicted].join('\n')}`);
  assert.ok(
    predicted.has('worker -> db [db_access]'),
    `missing worker -> db; got: ${[...predicted].join('\n')}`
  );
});
