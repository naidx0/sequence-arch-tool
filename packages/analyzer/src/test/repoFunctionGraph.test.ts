import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { functionNodeId } from '@sequence/schema';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import { buildFunctionGraph } from '../functions/buildFunctionGraph.js';
import { enrichWithCrossServiceEdges, takeServerAttributionAmbiguity, UNRESOLVED_HANDLER_NOTE } from '../functions/crossServiceEdges.js';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';
import { scanRepo } from '../scan.js';

/**
 * `FunctionNode.file` carries OS-NATIVE separators: the builder produces it with
 * `path.relative` (`functions/repoFunctionGraph.ts:135`) and normalises nothing, so on
 * Windows it reads `src\flaskish\__main__.py`. Comparing it against a forward-slashed
 * literal can only pass on POSIX.
 *
 * That is the builder's contract, not a bug, and it is NOT changed here: every consumer
 * already normalises at its own boundary — see `packages/mcp/src/graphQuery.ts:351`
 * (`n.file.replace(/\/g, '/')`) and the several `relPosix` sites in
 * `server/repoServer.ts`. The tests are a consumer and do the same.
 *
 * Applied to BOTH sides so the assertion stays honest if a literal is ever written with
 * a backslash. Nothing is loosened: the comparison is still an exact path match.
 */
const norm = (p: string): string => p.replace(/\\/g, '/');


const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');

const TS_FIXTURE = `
function helper() {
  return 1;
}

function outer() {
  helper();
}
`;

test('buildRepoFunctionGraph: TS fixture returns nodes and intra-file calls edge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-repo-'));
  const svcDir = path.join(dir, 'api');
  fs.mkdirSync(svcDir, { recursive: true });
  fs.writeFileSync(path.join(svcDir, 'index.ts'), TS_FIXTURE);
  fs.writeFileSync(
    path.join(dir, 'docker-compose.yml'),
    `services:\n  api:\n    build: ./api\n`
  );

  const graph = await buildRepoFunctionGraph(dir);
  assert.ok(graph.nodes.length >= 2, 'expected function nodes');
  assert.ok(graph.edges.length >= 1, 'expected at least one calls edge');

  const names = new Set(graph.nodes.map((n) => n.name));
  assert.ok(names.has('helper'));
  assert.ok(names.has('outer'));

  for (const e of graph.edges) {
    assert.strictEqual(e.kind, 'call');
    assert.ok(graph.nodes.some((n) => n.id === e.srcId));
    assert.ok(graph.nodes.some((n) => n.id === e.dstId));
  }
});

test('buildRepoFunctionGraph: empty for no-source dir, never throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-empty-'));
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'no code here');

  const graph = await buildRepoFunctionGraph(dir);
  assert.deepStrictEqual(graph, { nodes: [], edges: [] });

  const missing = await buildRepoFunctionGraph(path.join(dir, 'nope'));
  assert.deepStrictEqual(missing, { nodes: [], edges: [] });
});

test('buildRepoFunctionGraph: shopfront fixture has grounded nodes', async () => {
  const fixture = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
  const graph = await buildRepoFunctionGraph(fixture, { cluster: true });
  assert.ok(graph.nodes.length > 0, 'shopfront should yield function nodes');
  for (const n of graph.nodes) {
    assert.ok(n.file.length > 0);
    assert.ok(n.startLine > 0);
    assert.ok(n.endLine >= n.startLine);
  }
});

test('buildRepoFunctionGraph: never throws on missing path', async () => {
  const graph = await buildRepoFunctionGraph('/tmp/sequence-fn-missing-repo-does-not-exist-xyz');
  assert.deepStrictEqual(graph, { nodes: [], edges: [] });
});

test('LOCK: extractFacts + buildRepoFunctionGraph share grounded TS spans', async () => {
  await initParser();
  const facts = extractFacts(TS_FIXTURE, 'index.ts', 'ts');
  const repoGraph = await buildRepoFunctionGraph(
    (() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-lock-'));
      const svc = path.join(dir, 'svc');
      fs.mkdirSync(svc, { recursive: true });
      fs.writeFileSync(path.join(svc, 'index.ts'), TS_FIXTURE);
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  svc:\n    build: ./svc\n');
      return dir;
    })()
  );
  const helper = facts.functions.find((f) => f.name === 'helper')!;
  const node = repoGraph.nodes.find((n) => n.name === 'helper');
  assert.ok(node);
  assert.strictEqual(node.startLine, helper.startLine);
});

test('buildFunctionGraph: cross-file call when import resolves to unique callee', () => {
  const graph = buildFunctionGraph([
    {
      file: 'client/util.ts',
      lang: 'ts',
      functions: [{ name: 'run', startLine: 2, endLine: 6 }],
      calls: [{ callee: 'helper', line: 4, args: [], kwargs: {} }],
      imports: [{ raw: './lib', line: 1, resolved: 'client/lib.ts' }],
    },
    {
      file: 'client/lib.ts',
      lang: 'ts',
      functions: [{ name: 'helper', startLine: 1, endLine: 3 }],
      calls: [],
      imports: [],
    },
  ]);

  const runId = functionNodeId('client/util.ts', 'run', 2);
  const helperId = functionNodeId('client/lib.ts', 'helper', 1);
  const edge = graph.edges.find((e) => e.srcId === runId && e.dstId === helperId);
  assert.ok(edge, 'expected cross-file call edge');
  assert.strictEqual(edge.kind, 'call');
});

test('buildFunctionGraph: ambiguous callee across imported files → no cross-file edge', () => {
  const graph = buildFunctionGraph([
    {
      file: 'a.ts',
      lang: 'ts',
      functions: [{ name: 'main', startLine: 1, endLine: 5 }],
      calls: [{ callee: 'dup', line: 3, args: [], kwargs: {} }],
      imports: [
        { raw: './one', line: 1, resolved: 'one.ts' },
        { raw: './two', line: 2, resolved: 'two.ts' },
      ],
    },
    {
      file: 'one.ts',
      lang: 'ts',
      functions: [{ name: 'dup', startLine: 1, endLine: 2 }],
      calls: [],
    },
    {
      file: 'two.ts',
      lang: 'ts',
      functions: [{ name: 'dup', startLine: 1, endLine: 2 }],
      calls: [],
    },
  ]);

  assert.strictEqual(graph.edges.length, 0, 'ambiguous cross-file callee must not emit an edge');
});

test('buildRepoFunctionGraph: Go cross-file import does not emit call edge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-go-'));
  const svcDir = path.join(dir, 'shipping');
  fs.mkdirSync(svcDir, { recursive: true });
  fs.writeFileSync(
    path.join(svcDir, 'main.go'),
    `package main\n\nimport "shipping/db"\n\nfunc main() {\n  db.Connect()\n}\n`
  );
  fs.writeFileSync(
    path.join(svcDir, 'db.go'),
    `package db\n\nfunc Connect() {}\n`
  );
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  shipping:\n    build: ./shipping\n');

  const graph = await buildRepoFunctionGraph(dir);
  assert.strictEqual(graph.edges.length, 0, 'Go import resolution is stubbed — no cross-file edges');
  assert.ok(graph.nodes.length >= 2);
});

test('enrichWithCrossServiceEdges: http client+route evidence → fn↔fn edge', () => {
  const functionsByFile = new Map([
    [
      'gateway/routes/orders.ts',
      [{ name: 'getOrder', startLine: 8, endLine: 11 }],
    ],
    [
      'orders/app/routes.py',
      [{ name: 'read_order', startLine: 11, endLine: 16 }],
    ],
  ]);

  const archGraph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'test',
    nodes: [
      { id: 'svc:gateway', kind: 'service', label: 'gateway' },
      { id: 'svc:orders', kind: 'service', label: 'orders' },
      { id: 'file:orders/app/routes.py', kind: 'file', label: 'routes.py', parentId: 'svc:orders' },
    ],
    edges: [
      {
        id: 'e:http:1',
        srcId: 'file:gateway/routes/orders.ts',
        dstId: 'file:orders/app/routes.py',
        kind: 'http',
        confidence: 0.93,
        origin: 'deterministic',
        evidence: [
          { file: 'gateway/routes/orders.ts', line: 9, snippet: 'getJson(...)', note: 'GET /orders/:id' },
          { file: 'orders/app/routes.py', line: 11, snippet: 'GET /orders/{order_id}', note: 'matched route' },
        ],
        detail: { method: 'GET', pathPattern: '/orders/:id', matchedRoute: 'GET /orders/{order_id}' },
      },
    ],
    warnings: [],
  };

  const base = buildFunctionGraph([
    {
      file: 'gateway/routes/orders.ts',
      lang: 'ts',
      functions: functionsByFile.get('gateway/routes/orders.ts')!,
      calls: [],
    },
    {
      file: 'orders/app/routes.py',
      lang: 'py',
      functions: functionsByFile.get('orders/app/routes.py')!,
      calls: [],
    },
  ]);

  const graph = enrichWithCrossServiceEdges(base, archGraph, functionsByFile);
  const http = graph.edges.filter((e) => e.kind === 'http');
  assert.strictEqual(http.length, 1);
  assert.strictEqual(http[0].confidence, 0.93);
  assert.ok(http[0].srcId.includes('getOrder'));
  assert.ok(http[0].dstId.includes('read_order'));
});

test('enrichWithCrossServiceEdges: queue publish → client-fn to topic boundary', () => {
  const functionsByFile = new Map([
    ['orders/app/events.py', [{ name: 'publish_order_created', startLine: 9, endLine: 10 }]],
  ]);

  const archGraph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'test',
    nodes: [{ id: 'topic:order.created', kind: 'topic', label: 'order.created' }],
    edges: [
      {
        id: 'e:queue:1',
        srcId: 'file:orders/app/events.py',
        dstId: 'topic:order.created',
        kind: 'queue_publish',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [{ file: 'orders/app/events.py', line: 10, snippet: 'r.publish(...)' }],
        detail: { topic: 'order.created' },
      },
    ],
    warnings: [],
  };

  const base = buildFunctionGraph([
    {
      file: 'orders/app/events.py',
      lang: 'py',
      functions: functionsByFile.get('orders/app/events.py')!,
      calls: [],
    },
  ]);

  const graph = enrichWithCrossServiceEdges(base, archGraph, functionsByFile);
  const queue = graph.edges.filter((e) => e.kind === 'queue');
  assert.strictEqual(queue.length, 1);
  const topic = graph.nodes.find((n) => n.id === 'topic:order.created');
  assert.ok(topic);
  assert.strictEqual(topic.kind, 'topic');
  assert.ok(queue[0].srcId.includes('publish_order_created'));
  assert.strictEqual(queue[0].dstId, 'topic:order.created');
});

test('enrichWithCrossServiceEdges: db access → client-fn to datastore boundary', () => {
  const functionsByFile = new Map([
    ['orders/app/db.py', [{ name: 'get_order', startLine: 5, endLine: 8 }]],
  ]);

  const archGraph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'test',
    nodes: [{ id: 'ds:orders-db', kind: 'datastore', label: 'orders-db' }],
    edges: [
      {
        id: 'e:db:1',
        srcId: 'file:orders/app/db.py',
        dstId: 'ds:orders-db',
        kind: 'db_read',
        confidence: 0.85,
        origin: 'deterministic',
        evidence: [
          {
            file: 'orders/app/db.py',
            line: 7,
            snippet: 'session.query(Order)',
            note: 'orm access to table "orders"',
          },
        ],
        detail: { table: 'orders', database: 'orders-db' },
      },
    ],
    warnings: [],
  };

  const base = buildFunctionGraph([
    {
      file: 'orders/app/db.py',
      lang: 'py',
      functions: functionsByFile.get('orders/app/db.py')!,
      calls: [],
    },
  ]);

  const graph = enrichWithCrossServiceEdges(base, archGraph, functionsByFile);
  const db = graph.edges.filter((e) => e.kind === 'db');
  assert.strictEqual(db.length, 1);
  const ds = graph.nodes.find((n) => n.id === 'ds:orders-db');
  assert.ok(ds);
  assert.strictEqual(ds.kind, 'datastore');
});

test('enrichWithCrossServiceEdges: unresolved client evidence → no edge', () => {
  const archGraph: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'test',
    nodes: [{ id: 'svc:orders', kind: 'service', label: 'orders' }],
    edges: [
      {
        id: 'e:http:orphan',
        srcId: 'file:gateway/routes/orders.ts',
        dstId: 'svc:orders',
        kind: 'http',
        confidence: 0.8,
        origin: 'deterministic',
        evidence: [{ file: 'gateway/routes/orders.ts', line: 99, snippet: 'fetch(...)' }],
      },
    ],
    warnings: [],
  };

  const graph = enrichWithCrossServiceEdges({ nodes: [], edges: [] }, archGraph, new Map());
  assert.strictEqual(graph.edges.length, 0);
});

test('buildRepoFunctionGraph: shopfront yields cross-service http edges with archGraph', async () => {
  const fixture = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
  const arch = await scanRepo(fixture, { cluster: true });
  const graph = await buildRepoFunctionGraph(fixture, { cluster: true }, arch);
  const httpEdges = graph.edges.filter((e) => e.kind === 'http');
  assert.ok(httpEdges.length > 0, 'shopfront should attribute at least one http function edge');
  assert.ok(httpEdges.some((e) => typeof e.confidence === 'number'));
});

// U32 LOCK — shared-backend: api + worker both `build: ./backend`. Without the
// first-wins `ingested` guard in repoFunctionGraph.ts, every shared file would
// be parsed twice and emit duplicate function-node ids (edge ids dedupe; node
// ids do not). The arch-graph side of this is locked in shared-build-context.test.ts.
test('U32 LOCK: shared build context ingests each file once in the function graph', async () => {
  const fixture = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shared-backend');
  const graph = await buildRepoFunctionGraph(fixture);
  const ids = graph.nodes.map((n) => n.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate function node ids: ${[...new Set(dupes)].join(', ')}`);
  assert.ok(
    graph.nodes.some((n) => norm(n.file) === norm('backend/app/main.py')),
    'shared-backend main.py must appear in the function graph'
  );
  const mainNodes = graph.nodes.filter((n) => norm(n.file) === norm('backend/app/main.py'));
  assert.ok(mainNodes.length >= 1, 'main.py must contribute at least one function node');
  const mainIds = mainNodes.map((n) => n.id);
  assert.deepStrictEqual(mainIds, [...new Set(mainIds)], 'no duplicate nodes for the same function in main.py');
});

// ---------------------------------------------------------------------------
// fn-comm precision follow-up (HANDOFF §8.3): handler-aware server attribution.
// Before this, the server side of an http edge was always the enclosing
// function at the ROUTE REGISTRATION call, even when the route table
// (RouteFact.handlerName, threaded through ArchEdge.detail by join.ts) names
// a handler defined somewhere else — the function that actually serves the
// request. See functions/crossServiceEdges.ts's resolveHandlerFn.
// ---------------------------------------------------------------------------

function httpArchGraph(handlerName: string | undefined): ArchGraph {
  return {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'test',
    nodes: [{ id: 'svc:orders', kind: 'service', label: 'orders' }],
    edges: [
      {
        id: 'e:http:1',
        srcId: 'file:gateway/routes/orders.ts',
        dstId: 'file:orders/app/routes.js',
        kind: 'http',
        confidence: 0.93,
        origin: 'deterministic',
        evidence: [
          { file: 'gateway/routes/orders.ts', line: 4, snippet: 'getJson(...)' },
          // the registration call — inside registerRoutes(), NOT inside the
          // handler it wires up (that's the exact shape being fixed).
          { file: 'orders/app/routes.js', line: 3, snippet: 'GET /orders', note: 'matched route' },
        ],
        detail: { method: 'GET', pathPattern: '/orders', matchedRoute: 'GET /orders', handlerName },
      },
    ],
    warnings: [],
  };
}

test('enrichWithCrossServiceEdges: handler defined in file A, registered in file B → attributed to A', () => {
  const functionsByFile = new Map([
    ['gateway/routes/orders.ts', [{ name: 'fetchOrders', startLine: 2, endLine: 6 }]],
    // the registration site: registerRoutes() wires up the route, but does
    // not itself serve anything.
    ['orders/app/routes.js', [{ name: 'registerRoutes', startLine: 1, endLine: 5 }]],
    // the real handler, defined in a different file entirely.
    ['orders/app/ordersController.js', [{ name: 'listOrders', startLine: 10, endLine: 14 }]],
  ]);

  const base = buildFunctionGraph([
    { file: 'gateway/routes/orders.ts', lang: 'ts', functions: functionsByFile.get('gateway/routes/orders.ts')!, calls: [] },
    { file: 'orders/app/routes.js', lang: 'js', functions: functionsByFile.get('orders/app/routes.js')!, calls: [] },
    { file: 'orders/app/ordersController.js', lang: 'js', functions: functionsByFile.get('orders/app/ordersController.js')!, calls: [] },
  ]);

  const graph = enrichWithCrossServiceEdges(base, httpArchGraph('listOrders'), functionsByFile);
  const http = graph.edges.filter((e) => e.kind === 'http');
  assert.strictEqual(http.length, 1);
  const [edge] = http;

  const handlerId = functionNodeId('orders/app/ordersController.js', 'listOrders', 10);
  const registrationSiteId = functionNodeId('orders/app/routes.js', 'registerRoutes', 1);
  assert.strictEqual(edge.dstId, handlerId, 'must attribute to the handler that actually serves the request');
  assert.notStrictEqual(edge.dstId, registrationSiteId, 'must not attribute to the registration site when the handler resolves');
  assert.strictEqual(edge.label, 'matched route', 'a resolved handler is not marked as an unresolved ambiguity');
  assert.strictEqual(takeServerAttributionAmbiguity(), undefined, 'a clean resolution raises no ambiguity');

  // evidence survives: the destination node's file/line are the handler's
  // real definition site, not the registration call's.
  const dstNode = graph.nodes.find((n) => n.id === handlerId)!;
  assert.strictEqual(dstNode.file, 'orders/app/ordersController.js');
  assert.strictEqual(dstNode.startLine, 10);
});

test('enrichWithCrossServiceEdges: unresolved or ambiguous handler → attributes to the registration site AND surfaces the ambiguity', () => {
  const functionsByFile = new Map([
    ['gateway/routes/orders.ts', [{ name: 'fetchOrders', startLine: 2, endLine: 6 }]],
    ['orders/app/routes.js', [{ name: 'registerRoutes', startLine: 1, endLine: 5 }]],
    // 'listOrders' defined in TWO other files — genuinely ambiguous, must not
    // be guessed at.
    ['orders/app/ordersControllerV1.js', [{ name: 'listOrders', startLine: 3, endLine: 5 }]],
    ['orders/app/ordersControllerV2.js', [{ name: 'listOrders', startLine: 8, endLine: 10 }]],
  ]);

  const base = buildFunctionGraph([
    { file: 'gateway/routes/orders.ts', lang: 'ts', functions: functionsByFile.get('gateway/routes/orders.ts')!, calls: [] },
    { file: 'orders/app/routes.js', lang: 'js', functions: functionsByFile.get('orders/app/routes.js')!, calls: [] },
  ]);

  const registrationSiteId = functionNodeId('orders/app/routes.js', 'registerRoutes', 1);

  // Case 1: the handler name matches no known function anywhere.
  {
    const graph = enrichWithCrossServiceEdges(base, httpArchGraph('missingHandler'), functionsByFile);
    const [edge] = graph.edges.filter((e) => e.kind === 'http');
    assert.strictEqual(edge.dstId, registrationSiteId, 'unresolvable handler degrades to the registration site');
    assert.ok(edge.label?.includes(UNRESOLVED_HANDLER_NOTE), `edge must be marked unresolved, got: ${edge.label}`);
    const ambiguity = takeServerAttributionAmbiguity();
    assert.ok(ambiguity, 'ambiguity must be surfaced, not silent');
    assert.ok(
      ambiguity!.some((w) => w.includes('missingHandler') && w.includes('registered at')),
      `warning must name the handler and where it was registered, got: ${JSON.stringify(ambiguity)}`
    );
    // read-and-clear: a second read must not still see the same ambiguity.
    assert.strictEqual(takeServerAttributionAmbiguity(), undefined);
  }

  // Case 2: the handler name matches more than one function.
  {
    const graph = enrichWithCrossServiceEdges(base, httpArchGraph('listOrders'), functionsByFile);
    const [edge] = graph.edges.filter((e) => e.kind === 'http');
    assert.strictEqual(edge.dstId, registrationSiteId, 'ambiguous handler also degrades to the registration site');
    assert.ok(edge.label?.includes(UNRESOLVED_HANDLER_NOTE));
    const ambiguity = takeServerAttributionAmbiguity();
    assert.ok(
      ambiguity?.some((w) => w.includes('listOrders') && w.includes('more than one function')),
      `warning must say the handler was ambiguous, got: ${JSON.stringify(ambiguity)}`
    );
  }

  // evidence survives even on the coarse path: the registration site's node
  // still points at its real file/line.
  const graph = enrichWithCrossServiceEdges(base, httpArchGraph('missingHandler'), functionsByFile);
  const dstNode = graph.nodes.find((n) => n.id === registrationSiteId)!;
  assert.strictEqual(dstNode.file, 'orders/app/routes.js');
  assert.strictEqual(dstNode.startLine, 1);
});

test('enrichWithCrossServiceEdges: no handlerName on the route → old registration-site attribution, unchanged', () => {
  // Annotation/decorator-style routes (Java, Flask/FastAPI) and inline
  // anonymous handlers never populate RouteFact.handlerName — this must keep
  // behaving exactly as before, with no ambiguity noise.
  const functionsByFile = new Map([
    ['gateway/routes/orders.ts', [{ name: 'fetchOrders', startLine: 2, endLine: 6 }]],
    ['orders/app/routes.js', [{ name: 'registerRoutes', startLine: 1, endLine: 5 }]],
  ]);
  const base = buildFunctionGraph([
    { file: 'gateway/routes/orders.ts', lang: 'ts', functions: functionsByFile.get('gateway/routes/orders.ts')!, calls: [] },
    { file: 'orders/app/routes.js', lang: 'js', functions: functionsByFile.get('orders/app/routes.js')!, calls: [] },
  ]);

  const graph = enrichWithCrossServiceEdges(base, httpArchGraph(undefined), functionsByFile);
  const [edge] = graph.edges.filter((e) => e.kind === 'http');
  assert.strictEqual(edge.dstId, functionNodeId('orders/app/routes.js', 'registerRoutes', 1));
  assert.strictEqual(edge.label, 'matched route', 'no handler name to resolve — no unresolved-handler marker either');
  assert.strictEqual(takeServerAttributionAmbiguity(), undefined);
});
