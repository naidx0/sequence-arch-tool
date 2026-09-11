import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScaffoldability, validateGraph, type ArchGraph } from '@sequence/schema';
import { scopeGraph } from '../brief.js';
import { renderDDL, hasDbTables } from '../ddl.js';
import { scanRepo } from '../scan.js';
import { createRepoServer, filterScanToScope } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');
const TEST_KEY = 'sk-ant-test-SUPERSECRET-9f3a2b';

function spec(): ArchGraph {
  return JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
}

/* ============================================================ scopeGraph ==== */

test('scopeGraph: a closed subset round-trips and stays valid + scaffoldable', () => {
  const g = spec();
  // gateway + api + postgres: both http edges (gateway→api) and the db edge survive.
  const { scoped, droppedEdges } = scopeGraph(g, ['svc:gateway', 'svc:api', 'ds:postgres']);
  const ids = new Set(scoped.nodes.map((n) => n.id));
  assert.ok(ids.has('repo'), 'repo root auto-included');
  assert.ok(ids.has('svc:gateway') && ids.has('svc:api') && ids.has('ds:postgres'));
  assert.ok(!ids.has('svc:worker') && !ids.has('ds:redis') && !ids.has('topic:ticket.created'));
  // both gateway→api http edges + the api→postgres db edge are fully inside.
  assert.strictEqual(scoped.edges.length, 3);
  assert.ok(scoped.edges.every((e) => ids.has(e.srcId) && ids.has(e.dstId)));
  // queue edges (api→topic publish, worker→topic consume) cross/leave the boundary.
  // api→topic: exactly one endpoint (api) inside ⇒ dropped+reported.
  assert.ok(droppedEdges.some((e) => e.kind === 'queue_publish'));
  assert.deepStrictEqual(validateGraph({ ...scoped, warnings: [] }), []);
  assert.deepStrictEqual(checkScaffoldability(scoped), []);
});

test('scopeGraph: a boundary edge (one endpoint outside) is dropped and reported', () => {
  const g = spec();
  // select api + topic but NOT worker: worker→ticket.created consume crosses out.
  const { scoped, droppedEdges } = scopeGraph(g, ['svc:api', 'topic:ticket.created']);
  const ids = new Set(scoped.nodes.map((n) => n.id));
  assert.ok(!ids.has('svc:worker'), 'worker not selected, not pulled');
  const consume = droppedEdges.find((e) => e.kind === 'queue_consume');
  assert.ok(consume && consume.srcId === 'svc:worker', 'worker consume reported as boundary edge');
  assert.ok(!scoped.edges.some((e) => e.id === consume!.id), 'boundary edge excluded from scoped graph');
});

test('scopeGraph: selecting a topic pulls in its broker datastore parent', () => {
  const g = spec();
  const { scoped } = scopeGraph(g, ['topic:ticket.created']);
  const ids = new Set(scoped.nodes.map((n) => n.id));
  assert.ok(ids.has('topic:ticket.created'));
  assert.ok(ids.has('ds:redis'), 'broker datastore auto-completed');
  assert.ok(ids.has('repo'));
  // parentId chains are closed ⇒ structurally valid.
  assert.deepStrictEqual(validateGraph({ ...scoped, warnings: [] }), []);
});

test('scopeGraph: a datastore-only selection is valid but NOT scaffoldable (no service)', () => {
  const g = spec();
  const { scoped } = scopeGraph(g, ['ds:postgres']);
  assert.deepStrictEqual(validateGraph({ ...scoped, warnings: [] }), []);
  const problems = checkScaffoldability(scoped);
  assert.ok(problems.some((p) => /no service/.test(p)), `expected a no-service problem, got ${JSON.stringify(problems)}`);
});

/* ============================================================ renderDDL ===== */

test('renderDDL: ticketing spec renders exactly one CREATE TABLE for tickets, deterministically', () => {
  const g = spec();
  const sql = renderDDL(g);
  const creates = sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
  assert.strictEqual(creates.length, 1);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tickets \(/);
  assert.match(sql, /id serial primary key/);
  assert.match(sql, /-- table "tickets" — accessed by: api/);
  // snapshot-stable: byte-identical across renders.
  assert.strictEqual(renderDDL(g), sql);
});

test('renderDDL: a spec with no db edges renders comment-only output', () => {
  const g = spec();
  g.edges = g.edges.filter((e) => e.kind !== 'db_access');
  assert.strictEqual(hasDbTables(g), false);
  const sql = renderDDL(g);
  assert.doesNotMatch(sql, /CREATE TABLE/);
  assert.match(sql, /No tables:/);
});

test('renderDDL: two services sharing a table produce one table naming both', () => {
  const g = spec();
  // Add a second service that also accesses the tickets table.
  g.nodes.push({
    id: 'svc:reporter',
    kind: 'service',
    label: 'reporter',
    parentId: 'repo',
    meta: { language: 'ts' },
  });
  g.edges.push({
    id: 'e:reporter->postgres',
    srcId: 'svc:reporter',
    dstId: 'ds:postgres',
    kind: 'db_access',
    confidence: 1,
    origin: 'design',
    evidence: [],
    detail: { table: 'tickets' },
  });
  const sql = renderDDL(g);
  const creates = sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
  assert.strictEqual(creates.length, 1, 'shared table collapses to one CREATE TABLE');
  // accessors are sorted: api, reporter.
  assert.match(sql, /-- table "tickets" — accessed by: api, reporter/);
});

/* ==================================================== server: /api/ddl ====== */

function ticketingRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-scope-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  return repo;
}

function seedRepo(files: { path: string; content: string }[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-scope-seed-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  for (const f of files) {
    const abs = path.join(repo, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<void> {
  await fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

test('/api/ddl returns the tickets DDL from the posted spec; no writes', async () => {
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    const treeBefore = await (await fetch(`${base}/api/tree`)).text();
    const res = await fetch(`${base}/api/ddl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: spec() }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { sql: string };
    assert.match(body.sql, /CREATE TABLE IF NOT EXISTS tickets/);
    // no writes performed
    const treeAfter = await (await fetch(`${base}/api/tree`)).text();
    assert.strictEqual(treeAfter, treeBefore, 'ddl endpoint must not write anything');
    assert.ok(!fs.existsSync(path.join(repo, 'db', 'schema.sql')), 'no schema.sql from a ddl preview');
  } finally {
    await close();
  }
});

test('/api/ddl with a scope that excludes db edges returns comment-only SQL', async () => {
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/ddl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // gateway alone: no db edge inside the scope.
      body: JSON.stringify({ spec: spec(), scope: ['svc:gateway'] }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { sql: string };
    assert.doesNotMatch(body.sql, /CREATE TABLE/);
    assert.match(body.sql, /No tables:/);
  } finally {
    await close();
  }
});

/* ================================================ server: scoped generate === */

// The scoped scaffold: gateway + api only (worker excluded), with a compose that
// declares just those two app services + the two infra stores. Scans to exactly
// the scoped spec ⇒ zero drift.
const SCOPED_COMPOSE = `services:
  gateway:
    build: ./gateway
    ports:
      - "3000:3000"
    environment:
      API_URL: http://api:8000
    depends_on:
      - api

  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql://app:app@postgres:5432/ticketing
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ticketing
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app

  redis:
    image: redis:7
`;

function scopedScaffoldFiles(): { path: string; content: string }[] {
  const read = (rel: string) => fs.readFileSync(path.join(TICKETING, rel), 'utf8');
  return [
    { path: 'docker-compose.yml', content: SCOPED_COMPOSE },
    { path: 'gateway/Dockerfile', content: read('gateway/Dockerfile') },
    { path: 'gateway/package.json', content: read('gateway/package.json') },
    { path: 'gateway/index.ts', content: read('gateway/index.ts') },
    { path: 'api/Dockerfile', content: read('api/Dockerfile') },
    { path: 'api/requirements.txt', content: read('api/requirements.txt') },
    { path: 'api/app/main.py', content: read('api/app/main.py') },
  ];
}

test('/api/generate with a scope excluding worker: brief has no worker, zero scoped drift, schema.sql written', async () => {
  const files = scopedScaffoldFiles();
  const mock = await startMockProvider(() => ({ text: JSON.stringify({ files, notes: 'scoped' }) }));
  // Start from just the scoped compose so the scan only ever sees the scope.
  const repo = seedRepo([{ path: 'docker-compose.yml', content: SCOPED_COMPOSE }]);
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specOverride: spec(),
        scope: ['svc:gateway', 'svc:api', 'ds:postgres', 'ds:redis', 'topic:ticket.created'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      written: string[];
      diff: { added: string[]; removed: string[]; mismatched: string[]; markdown: string };
      droppedEdges?: string[];
    };

    // the brief sent to the provider has no worker SERVICE section (the word
    // "worker" appears only in the static packaging-law boilerplate, never as a
    // scoped service heading or build directory).
    const sent = JSON.stringify(mock.requests[0].body);
    assert.ok(sent.includes('Service `api`'), 'scoped brief includes the api service');
    assert.ok(!sent.includes('Service `worker`'), 'scoped brief has no worker service section');
    assert.ok(!sent.includes('./worker'), 'scoped brief builds no worker directory');

    // the boundary edge (worker→ticket.created consume) is reported.
    assert.ok(
      body.droppedEdges?.some((d) => d.includes('worker') && d.includes('queue_consume')),
      `expected worker consume in droppedEdges, got ${JSON.stringify(body.droppedEdges)}`
    );

    // files landed; db/schema.sql is among them and holds the DDL.
    assert.ok(body.written.includes(path.join('gateway', 'index.ts')));
    assert.ok(body.written.includes(path.join('api', 'app', 'main.py')));
    const schemaRel = path.join('db', 'schema.sql');
    assert.ok(body.written.includes(schemaRel), 'db/schema.sql listed among written files');
    assert.match(fs.readFileSync(path.join(repo, schemaRel), 'utf8'), /CREATE TABLE IF NOT EXISTS tickets/);

    // conformance measures the SCOPE: zero drift against the scoped spec.
    assert.deepStrictEqual(body.diff.added, []);
    assert.deepStrictEqual(body.diff.removed, []);
    assert.deepStrictEqual(body.diff.mismatched, []);
    assert.match(body.diff.markdown, /conforms to spec/);

    assert.strictEqual(mock.requests.length, 1);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/generate with a datastore-only scope 422s before any provider call', async () => {
  let called = 0;
  const mock = await startMockProvider(() => {
    called++;
    return { text: JSON.stringify({ files: [] }) };
  });
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec(), scope: ['ds:postgres'] }),
    });
    assert.strictEqual(res.status, 422);
    const body = (await res.json()) as { problems: string[] };
    assert.ok(body.problems.some((p) => /no service/.test(p)));
    assert.strictEqual(called, 0, 'the provider must not be called for an unscaffoldable scope');
    assert.strictEqual(mock.requests.length, 0);
  } finally {
    await close();
    await mock.close();
  }
});

/* ===================================== scoped diff filters out-of-scope drift == */

test('filterScanToScope: keeps only in-scope service/datastore/topic nodes + their edges', async () => {
  const repo = ticketingRepo();
  const scanned = await scanRepo(repo);
  // The full scan of the ticketing scaffold includes the worker service.
  assert.ok(
    scanned.nodes.some((n) => n.kind === 'service' && n.label === 'worker'),
    'precondition: full scan includes worker'
  );
  const scopedSpec = scopeGraph(spec(), [
    'svc:gateway',
    'svc:api',
    'ds:postgres',
    'ds:redis',
    'topic:ticket.created',
  ]).scoped;
  const filtered = filterScanToScope(scanned, scopedSpec);
  const svcLabels = new Set(filtered.nodes.filter((n) => n.kind === 'service').map((n) => n.label));
  assert.ok(svcLabels.has('gateway') && svcLabels.has('api'), 'in-scope services kept');
  assert.ok(!svcLabels.has('worker'), 'out-of-scope worker dropped');
  // No surviving edge may reference a dropped node.
  const keptIds = new Set(filtered.nodes.map((n) => n.id));
  assert.ok(
    filtered.edges.every((e) => keptIds.has(e.srcId) && keptIds.has(e.dstId)),
    'every kept edge has both endpoints kept'
  );
});

test('scoped generate over a FULL repo: worker is filtered, NOT reported as "Not in spec"', async () => {
  // Pre-seed the FULL ticketing scaffold (worker included) — the exact condition
  // round-1 review flagged: rescanning the whole repo and diffing the tiny scoped
  // spec against it made the out-of-scope worker show up as spurious drift.
  const repo = ticketingRepo();
  const api = {
    path: path.join('api', 'app', 'main.py'),
    content: fs.readFileSync(path.join(TICKETING, 'api', 'app', 'main.py'), 'utf8'),
  };
  const mock = await startMockProvider(() => ({ text: JSON.stringify({ files: [api], notes: 'scoped' }) }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specOverride: spec(),
        scope: ['svc:gateway', 'svc:api', 'ds:postgres', 'ds:redis', 'topic:ticket.created'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      diff: { added: string[]; removed: string[]; mismatched: string[] };
      diffScope?: string;
    };
    assert.strictEqual(body.diffScope, 'scoped', 'response declares the scoped diff baseline');
    assert.ok(
      !body.diff.added.some((e) => e.includes('worker')),
      `worker must not be reported "Not in spec": ${JSON.stringify(body.diff.added)}`
    );
    assert.deepStrictEqual(body.diff.added, [], 'zero spurious added entries for the scoped diff');
  } finally {
    await close();
    await mock.close();
  }
});

test('scoped diff still CATCHES a genuine in-scope violation (wrong DB table → mismatched)', async () => {
  const repo = ticketingRepo();
  const original = fs.readFileSync(path.join(TICKETING, 'api', 'app', 'main.py'), 'utf8');
  // Rewrite the api to hit the WRONG table (tickets → orders). This is an
  // in-scope drift: filtering the scan must NOT hide it. (The topic
  // "ticket.created" is left intact — the regex only matches the plural table.)
  const wrong = { path: path.join('api', 'app', 'main.py'), content: original.replace(/tickets/g, 'orders') };
  const mock = await startMockProvider(() => ({ text: JSON.stringify({ files: [wrong] }) }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // main.py already exists with DIFFERENT content, so this generate really is
      // a replacement — r179 requires that to be confirmed rather than silent.
      // The confirmation is what makes the drift the test is about observable.
      body: JSON.stringify({
        specOverride: spec(),
        scope: ['svc:gateway', 'svc:api', 'ds:postgres', 'ds:redis', 'topic:ticket.created'],
        overwrite: true,
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      diff: { added: string[]; removed: string[]; mismatched: string[] };
      diffScope?: string;
    };
    assert.strictEqual(body.diffScope, 'scoped');
    // The out-of-scope worker is still filtered (the fix didn't mask real drift)…
    assert.ok(!body.diff.added.some((e) => e.includes('worker')), 'worker still filtered');
    // …but the in-scope api→postgres table drift IS caught.
    assert.ok(body.diff.mismatched.length > 0, `expected a mismatch, got ${JSON.stringify(body.diff)}`);
    assert.ok(
      body.diff.mismatched.some((k) => k.includes('api') && k.includes('postgres')),
      `expected api→postgres mismatch, got ${JSON.stringify(body.diff.mismatched)}`
    );
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================== scan lock: db/schema.sql must not shift scan == */

test('scanning the ticketing scaffold WITH a db/schema.sql present yields the identical graph', async () => {
  const repo = ticketingRepo();
  const before = await scanRepo(repo);
  // Drop the generated DDL into db/schema.sql and rescan.
  fs.mkdirSync(path.join(repo, 'db'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'db', 'schema.sql'), renderDDL(spec()));
  const after = await scanRepo(repo);
  // The scanner must ignore the .sql file entirely: same nodes, same edges.
  assert.deepStrictEqual(
    after.nodes.map((n) => n.id).sort(),
    before.nodes.map((n) => n.id).sort()
  );
  assert.deepStrictEqual(
    after.edges.map((e) => `${e.srcId}->${e.dstId}:${e.kind}`).sort(),
    before.edges.map((e) => `${e.srcId}->${e.dstId}:${e.kind}`).sort()
  );
});
