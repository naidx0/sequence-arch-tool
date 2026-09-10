import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScaffoldability, validateGraph, type ArchGraph } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/ -> packages/schema -> packages -> repo root
const TICKETING = path.resolve(here, '..', '..', '..', 'examples', 'ticketing.spec.json');

/**
 * A minimal but fully scaffoldable design spec exercising every constrained
 * family: an http service->service edge, a queue publish to a redis-brokered
 * topic, and a db_access to a postgres datastore. Mutated per test to reject one
 * rule at a time. Kept independently green by the first locking test below.
 */
function scaffoldable(): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'shop',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'shop' },
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo', meta: { language: 'ts' } },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', meta: { language: 'py' } },
      { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo', meta: { tech: 'postgres' } },
      { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo', meta: { tech: 'redis' } },
      { id: 'topic:orders', kind: 'topic', label: 'orders', parentId: 'ds:redis' },
    ],
    edges: [
      {
        id: 'e:web->api',
        srcId: 'svc:web',
        dstId: 'svc:api',
        kind: 'http',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { method: 'GET', pathPattern: '/orders/*' },
      },
      {
        id: 'e:api->orders',
        srcId: 'svc:api',
        dstId: 'topic:orders',
        kind: 'queue_publish',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { topic: 'orders' },
      },
      {
        id: 'e:api->postgres',
        srcId: 'svc:api',
        dstId: 'ds:postgres',
        kind: 'db_access',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { table: 'orders_tbl' },
      },
    ],
    warnings: [],
  };
}

// ---- locking tests: legitimate specs are scaffoldable --------------------

test('checkScaffoldability: the committed ticketing.spec.json is scaffoldable (zero problems)', () => {
  const g = JSON.parse(fs.readFileSync(TICKETING, 'utf8')) as ArchGraph;
  assert.deepStrictEqual(checkScaffoldability(g), []);
});

test('checkScaffoldability: the programmatic baseline is scaffoldable (zero problems)', () => {
  assert.deepStrictEqual(checkScaffoldability(scaffoldable()), []);
});

test('checkScaffoldability: does not mutate the graph (unlike validateGraph warnings)', () => {
  const g = scaffoldable();
  const before = JSON.stringify(g);
  checkScaffoldability(g);
  assert.strictEqual(JSON.stringify(g), before);
});

// ---- each rule rejected on its own ---------------------------------------

test('rule: non-design mode is not scaffoldable', () => {
  const g = scaffoldable();
  delete g.mode; // absent ⇒ scan
  assert.ok(checkScaffoldability(g).some((p) => /requires a design-mode spec/.test(p)));
});

test('rule: an unscaffoldable edge kind (grpc) is rejected', () => {
  const g = scaffoldable();
  g.edges[0].kind = 'grpc';
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:web->api') && p.includes("kind 'grpc'"))
  );
});

test('rule: an unsafe node label is rejected', () => {
  const g = scaffoldable();
  g.nodes[5].label = "it's"; // topic label with an apostrophe
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('topic:orders') && p.includes('not a safe identifier'))
  );
});

test('rule: an unsafe db table name is rejected', () => {
  const g = scaffoldable();
  g.edges[2].detail!.table = 'drop; table'; // space + semicolon
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:api->postgres') && p.includes('not a safe identifier'))
  );
});

test('rule: an http edge missing detail.method is rejected', () => {
  const g = scaffoldable();
  delete g.edges[0].detail!.method;
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:web->api') && /missing detail\.method\/pathPattern/.test(p))
  );
});

test('rule: an http edge missing detail.pathPattern is rejected', () => {
  const g = scaffoldable();
  delete g.edges[0].detail!.pathPattern;
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:web->api') && /missing detail\.method\/pathPattern/.test(p))
  );
});

test('rule: an http edge targeting a non-service node is rejected', () => {
  const g = scaffoldable();
  g.edges[0].dstId = 'ds:postgres'; // http -> datastore
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:web->api') && /must target a service node/.test(p))
  );
});

test('rule: a db edge missing detail.table is rejected', () => {
  const g = scaffoldable();
  delete g.edges[2].detail!.table;
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:api->postgres') && /missing detail\.table/.test(p))
  );
});

test('rule: a service missing meta.language is rejected', () => {
  const g = scaffoldable();
  delete g.nodes[1].meta!.language; // svc:web loses its language
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('svc:web') && /meta\.language/.test(p))
  );
});

test('rule: a service with an unsupported meta.language is rejected', () => {
  const g = scaffoldable();
  g.nodes[1].meta!.language = 'ruby';
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('svc:web') && /meta\.language/.test(p))
  );
});

test('rule: no service nodes at all is not scaffoldable', () => {
  const g = scaffoldable();
  g.nodes = g.nodes.filter((n) => n.kind !== 'service');
  g.edges = []; // drop edges that referenced the removed services
  assert.ok(checkScaffoldability(g).some((p) => /no service nodes/.test(p)));
});

test('rule: a queue edge targeting a topic under a non-redis broker is rejected', () => {
  const g = scaffoldable();
  // Re-parent the topic under the postgres datastore (wrong broker tech).
  g.nodes[5].parentId = 'ds:postgres';
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('ds:postgres') && /supports redis only/.test(p))
  );
});

test('rule: a topic not parented under a datastore is rejected', () => {
  const g = scaffoldable();
  g.nodes[5].parentId = 'repo'; // parent is the repo, not a datastore
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('topic:orders') && /parented under a broker datastore/.test(p))
  );
});

test('rule: a queue edge whose detail.topic mismatches the topic label is rejected', () => {
  const g = scaffoldable();
  g.edges[1].detail!.topic = 'not-orders';
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('e:api->orders') && /must equal the topic node label/.test(p))
  );
});

test('rule: a db edge targeting a non-postgres datastore is rejected', () => {
  const g = scaffoldable();
  g.edges[2].dstId = 'ds:redis'; // db -> redis datastore (wrong tech)
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('ds:redis') && /supports postgres only/.test(p))
  );
});

test('rule: a datastore with an unsupported tech is rejected', () => {
  const g = scaffoldable();
  g.nodes[3].meta!.tech = 'mongodb';
  assert.ok(
    checkScaffoldability(g).some((p) => p.includes('ds:postgres') && /meta\.tech/.test(p))
  );
});

// ---- independence: structurally valid but NOT scaffoldable ---------------

test('independence: a structurally valid spec can still be unscaffoldable (the whole point)', () => {
  // A design-mode service missing meta.language: validateGraph treats this as a
  // WARNING (zero problems), but the scaffolder cannot pick a base image /
  // skeleton, so checkScaffoldability reports it as a problem. This proves the
  // two signals are genuinely independent — the exact case this phase exists to
  // catch at authoring time.
  const g = scaffoldable();
  delete g.nodes[2].meta!.language; // svc:api loses its language

  const structural = validateGraph({ ...g, warnings: [] });
  assert.deepStrictEqual(structural, [], 'must be structurally valid');

  const scaffold = checkScaffoldability(g);
  assert.ok(scaffold.length > 0, 'but must be unscaffoldable');
  assert.ok(scaffold.some((p) => p.includes('svc:api') && /meta\.language/.test(p)));
});

test('independence: a scaffoldable spec is also structurally valid', () => {
  const g = scaffoldable();
  assert.deepStrictEqual(validateGraph({ ...g, warnings: [] }), []);
  assert.deepStrictEqual(checkScaffoldability(g), []);
});
