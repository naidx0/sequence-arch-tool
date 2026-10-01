import assert from 'node:assert';
import { test } from 'node:test';
import { validateGraph, type ArchGraph } from './index.js';

/**
 * A valid ticketing-shaped design spec exercising all three constrained edge
 * families: http (web -> api service), queue_publish (api -> a topic), and
 * db_access (api -> a datastore). This is the "locking" baseline — legitimate
 * specs must keep producing zero problems.
 */
function ticketingSpec(): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'ticketing',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'ticketing' },
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo', meta: { language: 'ts' } },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', meta: { language: 'ts' } },
      { id: 'topic:orders', kind: 'topic', label: 'orders', parentId: 'repo' },
      { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo', meta: { tech: 'postgres' } },
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
        detail: { method: 'GET', pathPattern: '/tickets' },
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
        detail: { table: 'tickets' },
      },
    ],
    warnings: [],
  };
}

/** Only the new kind-constraint problems (ignore any unrelated problems). */
function kindProblems(g: ArchGraph): string[] {
  return validateGraph(g).filter((p) => p.includes('invalid target') || p.includes('invalid source'));
}

// ---- locking test: a legitimate spec is untouched ------------------------

test('kind-constraint: valid ticketing spec (http->service, queue->topic, db->datastore) has zero problems', () => {
  assert.deepStrictEqual(validateGraph(ticketingSpec()), []);
});

// ---- http / grpc must target a service (or leaf file) --------------------

test('kind-constraint: http edge targeting a datastore is rejected', () => {
  const g = ticketingSpec();
  g.edges[0].dstId = 'ds:postgres'; // http -> datastore is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:web->api') && p.includes('invalid target') && p.includes('datastore')),
    problems.join('; ')
  );
});

test('kind-constraint: grpc edge targeting a topic is rejected', () => {
  const g = ticketingSpec();
  g.edges[0].kind = 'grpc';
  g.edges[0].dstId = 'topic:orders'; // grpc -> topic is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:web->api') && p.includes('invalid target') && p.includes('topic')),
    problems.join('; ')
  );
});

test('kind-constraint: grpc edge targeting a datastore is accepted (channel-address infra-host fallback)', () => {
  // The grpc joiner's channel-address / name-convention fallbacks resolve a
  // channel to a discovered node; an infra host (role != 'app') lands on a
  // datastore node via dsId(...) (join.ts). This must be accepted — the exact
  // case that validateGraph wrongly rejected before the fix.
  const g = ticketingSpec();
  delete g.mode; // scan-shaped
  g.nodes.push({ id: 'ds:cache', kind: 'datastore', label: 'cache', parentId: 'repo' });
  g.edges[0].kind = 'grpc';
  g.edges[0].dstId = 'ds:cache'; // grpc -> datastore, the join.ts infra-host fallback
  g.edges[0].origin = 'deterministic';
  g.edges[0].confidence = 0.8;
  g.edges[0].evidence = [{ file: 'api/client.ts', line: 3, snippet: 'new Client(addr)' }];
  assert.deepStrictEqual(kindProblems(g), []);
});

test('kind-constraint: http edge targeting a leaf file node is accepted (scan-mode leaf handler)', () => {
  const g = ticketingSpec();
  delete g.mode; // scan-shaped
  g.nodes.push({ id: 'file:api/route.ts', kind: 'file', label: 'route.ts', parentId: 'svc:api' });
  g.edges[0].srcId = 'svc:web';
  g.edges[0].dstId = 'file:api/route.ts'; // http -> file leaf, legal
  g.edges[0].origin = 'deterministic';
  g.edges[0].confidence = 0.9;
  g.edges[0].evidence = [{ file: 'web/app.ts', line: 5, snippet: 'fetch()' }];
  assert.deepStrictEqual(kindProblems(g), []);
});

// ---- queue_publish / queue_consume must target a topic (or broker ds) ----

test('kind-constraint: queue_publish targeting a service is rejected', () => {
  const g = ticketingSpec();
  g.edges[1].dstId = 'svc:api'; // queue -> service is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:api->orders') && p.includes('invalid target') && p.includes('service')),
    problems.join('; ')
  );
});

test('kind-constraint: queue_consume targeting a file is rejected', () => {
  const g = ticketingSpec();
  g.nodes.push({ id: 'file:x', kind: 'file', label: 'x', parentId: 'svc:api' });
  g.edges[1].kind = 'queue_consume';
  g.edges[1].dstId = 'file:x'; // queue -> file is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:api->orders') && p.includes('invalid target') && p.includes('file')),
    problems.join('; ')
  );
});

test('kind-constraint: queue_publish targeting a broker datastore is accepted (dynamic-topic fallback)', () => {
  const g = ticketingSpec();
  delete g.mode; // scan-shaped
  g.nodes.push({ id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo' });
  g.edges[1].dstId = 'ds:redis'; // queue -> broker(datastore), the join.ts fallback
  g.edges[1].origin = 'deterministic';
  g.edges[1].confidence = 0.7;
  g.edges[1].evidence = [{ file: 'api/pub.ts', line: 2, snippet: 'publish(topic, msg)' }];
  assert.deepStrictEqual(kindProblems(g), []);
});

// ---- db_read / db_write / db_access must target a datastore --------------

test('kind-constraint: db_access targeting a service is rejected', () => {
  const g = ticketingSpec();
  g.edges[2].dstId = 'svc:api'; // db -> service is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:api->postgres') && p.includes('invalid target') && p.includes('service')),
    problems.join('; ')
  );
});

test('kind-constraint: db_read targeting a topic is rejected', () => {
  const g = ticketingSpec();
  g.edges[2].kind = 'db_read';
  g.edges[2].dstId = 'topic:orders'; // db -> topic is nonsensical
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:api->postgres') && p.includes('invalid target') && p.includes('topic')),
    problems.join('; ')
  );
});

test('kind-constraint: db_write targeting a datastore is accepted', () => {
  const g = ticketingSpec();
  g.edges[2].kind = 'db_write'; // db_write -> datastore, legal
  assert.deepStrictEqual(kindProblems(g), []);
});

// ---- source-kind constraint ---------------------------------------------

test('kind-constraint: an interaction edge originating from a datastore is rejected', () => {
  const g = ticketingSpec();
  g.edges[0].srcId = 'ds:postgres'; // datastore never originates an http call
  const problems = kindProblems(g);
  assert.ok(
    problems.some((p) => p.includes('e:web->api') && p.includes('invalid source') && p.includes('datastore')),
    problems.join('; ')
  );
});

// ---- import edges are exempt --------------------------------------------

test('kind-constraint: import edges are exempt (module/file structural wiring)', () => {
  const g = ticketingSpec();
  delete g.mode; // scan-shaped
  g.nodes.push(
    { id: 'file:a', kind: 'file', label: 'a', parentId: 'svc:api' },
    { id: 'file:b', kind: 'file', label: 'b', parentId: 'svc:api' }
  );
  g.edges = [
    {
      id: 'e:a->b',
      srcId: 'file:a',
      dstId: 'file:b',
      kind: 'import',
      confidence: 0.9,
      origin: 'deterministic',
      evidence: [{ file: 'a.ts', line: 1, snippet: "import './b'" }],
    },
  ];
  assert.deepStrictEqual(kindProblems(g), []);
  // and an import "targeting" a datastore is still not flagged by THIS rule
  g.nodes.push({ id: 'ds:x', kind: 'datastore', label: 'x', parentId: 'repo' });
  g.edges[0].dstId = 'ds:x';
  assert.deepStrictEqual(kindProblems(g), []);
});

// ---- TOTALITY: validateGraph never throws on a malformed array element ----
// Vision §3: validateGraph is TOTAL — a null/non-object element inside nodes or
// edges (e.g. a hand-edited {"nodes":[null]} spec loaded via Design → "Load
// spec") must be REPORTED in the returned string[], never dereferenced into a
// TypeError that white-screens the panel.

test('totality: a null node element does not throw and is reported', () => {
  const g = { nodes: [null], edges: [] } as unknown as ArchGraph;
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes('node[0]') && p.includes('not an object')),
    problems!.join('; ')
  );
});

test('totality: a non-object node element does not throw and is reported', () => {
  const g = ticketingSpec();
  (g.nodes as unknown[]).push(42); // a bare number is not a node
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes('not an object')),
    problems!.join('; ')
  );
});

test('totality: a null edge element does not throw and is reported', () => {
  const g = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: [{ id: 'a', kind: 'service', label: 'a' }],
    edges: [null],
    warnings: [],
  } as unknown as ArchGraph;
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes('edge[0]') && p.includes('not an object')),
    problems!.join('; ')
  );
});

// ---- TOTALITY: validateGraph never throws on a null/non-object ROOT -------
// Vision §5 totality invariant: validateGraph must be TOTAL against the ROOT
// too, symmetric with validateDomain's `m?.entities` guard. A hand-edited spec
// loaded via Design → "Load spec" can deserialize to any JSON value (null, a
// number, a string); a bad root must return a normal errors string[] reflecting
// the bad root, never throw on `g.mode` / `Array.isArray(g.nodes)`.

test('totality: a null root does not throw and reports the bad root', () => {
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(null as unknown as ArchGraph);
  });
  assert.ok(Array.isArray(problems));
  assert.deepStrictEqual(problems, ['graph is not an object']);
});

test('totality: an undefined root does not throw and reports the bad root', () => {
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(undefined as unknown as ArchGraph);
  });
  assert.ok(Array.isArray(problems));
  assert.deepStrictEqual(problems, ['graph is not an object']);
});

test('totality: a numeric root does not throw and reports the bad root', () => {
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(42 as unknown as ArchGraph);
  });
  assert.ok(Array.isArray(problems));
  assert.deepStrictEqual(problems, ['graph is not an object']);
});

test('totality: a string root does not throw and reports the bad root', () => {
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph('x' as unknown as ArchGraph);
  });
  assert.ok(Array.isArray(problems));
  assert.deepStrictEqual(problems, ['graph is not an object']);
});

// An ARRAY element passes the naive `typeof x === 'object'` guard, so before the
// fix it slipped through as a node/edge with `id: undefined` instead of being
// flagged. It must be reported with the SAME "not an object" wording as a null
// element, and it must not throw.

test('totality: an array node element ([]) does not throw and is reported as not an object', () => {
  const g = ticketingSpec();
  (g.nodes as unknown[]).push([]); // an array is not a node object
  const idx = g.nodes.length - 1;
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes(`node[${idx}]`) && p.includes('not an object')),
    problems!.join('; ')
  );
});

test('totality: an array edge element ([]) does not throw and is reported as not an object', () => {
  const g = ticketingSpec();
  (g.edges as unknown[]).push([]); // an array is not an edge object
  const idx = g.edges.length - 1;
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes(`edge[${idx}]`) && p.includes('not an object')),
    problems!.join('; ')
  );
});

// Regression: the array-element guard must not disturb a legitimate spec.
test('totality: a valid spec still validates ok after the array-element guard', () => {
  assert.deepStrictEqual(validateGraph(ticketingSpec()), []);
});

test('totality: a malformed edge element (missing evidence) does not throw and is reported', () => {
  // An object edge that lacks the `evidence` array must not throw at
  // `e.evidence.length`; it is treated as having no evidence.
  const g = ticketingSpec();
  delete g.mode; // scan-shaped: evidence is required
  (g.edges as unknown[]).push({
    id: 'e:bad',
    srcId: 'svc:web',
    dstId: 'svc:api',
    kind: 'http',
    confidence: 0.5,
    origin: 'deterministic',
    // evidence intentionally omitted (malformed)
  });
  let problems: string[] | undefined;
  assert.doesNotThrow(() => {
    problems = validateGraph(g);
  });
  assert.ok(Array.isArray(problems));
  assert.ok(
    problems!.some((p) => p.includes('e:bad') && p.includes('no evidence')),
    problems!.join('; ')
  );
});
