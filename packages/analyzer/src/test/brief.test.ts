import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { renderBrief } from '../brief.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');
const SPEC = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing.spec.json');
// Snapshots live in the source tree (tsc compiles only .ts into dist/).
const SNAPSHOT = path.resolve(here, '..', '..', 'src', 'test', 'snapshots', 'ticketing-brief.md');

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-brief-'));
}

test('renderBrief: ticketing brief matches the committed snapshot exactly', () => {
  const brief = renderBrief(SPEC);
  /*
   * CRLF ON READ. This repo runs with `core.autocrlf=true`, so git rewrites the
   * committed snapshot to CRLF on checkout while `renderBrief` always emits LF.
   * Comparing the bytes raw asserts the CHECKOUT CONVENTION, not the content —
   * it fails on every Windows clone and passes on every POSIX one, which is the
   * opposite of what a snapshot is for. Normalising the read side keeps the
   * assertion exactly as strict about the text itself.
   */
  const expected = fs.readFileSync(SNAPSHOT, 'utf8').split(String.fromCharCode(13, 10)).join('\n');
  assert.strictEqual(brief, expected);
});

test('renderBrief: deterministic — two renders are byte-identical', () => {
  assert.strictEqual(renderBrief(SPEC), renderBrief(SPEC));
});

test('renderBrief: rejects a scan-mode graph', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  delete g.mode; // absent ⇒ scan
  // Keep it a VALID scan graph so the rejection is about the mode, not validation.
  for (const e of g.edges) {
    e.origin = 'deterministic';
    e.confidence = 0.9;
    e.evidence = [{ file: 'x.ts', line: 1, snippet: 'x' }];
  }
  const p = path.join(tmpdir(), 'scan.json');
  fs.writeFileSync(p, JSON.stringify(g));
  assert.throws(() => renderBrief(p), /requires a design-mode spec/);
});

test('renderBrief: rejects an invalid spec', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  g.edges[0].srcId = 'svc:does-not-exist';
  const p = path.join(tmpdir(), 'bad.json');
  fs.writeFileSync(p, JSON.stringify(g));
  assert.throws(() => renderBrief(p), /invalid spec/);
});

test('renderBrief: rejects an unscaffoldable edge kind (grpc)', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  const http = g.edges.find((e) => e.kind === 'http')!;
  http.kind = 'grpc';
  const p = path.join(tmpdir(), 'grpc.json');
  fs.writeFileSync(p, JSON.stringify(g));
  assert.throws(
    () => renderBrief(p),
    /has kind 'grpc' which scaffold-brief cannot generate wiring for/
  );
});

test('renderBrief: accepts a db_read edge and renders its Database section', () => {
  // db_read/db_write are renderable (the renderer folds all db_* to the
  // db_access family), so scaffold-brief must NOT reject them.
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  const db = g.edges.find((e) => e.kind === 'db_access')!;
  db.kind = 'db_read'; // detail.table stays set
  const p = path.join(tmpdir(), 'db_read.json');
  fs.writeFileSync(p, JSON.stringify(g));
  let brief = '';
  assert.doesNotThrow(() => {
    brief = renderBrief(p);
  });
  // the api service still gets its Database section naming the tickets table
  assert.match(brief, /### Database/);
  assert.match(brief, /- table `tickets` on `postgres` via env `DATABASE_URL`/);
});

test('renderBrief: rejects a label that is not a safe identifier', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  const topic = g.nodes.find((n) => n.kind === 'topic')!;
  topic.label = "it's"; // apostrophe would break every inline string literal
  const p = path.join(tmpdir(), 'badlabel.json');
  fs.writeFileSync(p, JSON.stringify(g));
  assert.throws(() => renderBrief(p), /is not a safe identifier/);
});

test('sequence scaffold-brief: exit 2 on an unscaffoldable edge kind (grpc)', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  const http = g.edges.find((e) => e.kind === 'http')!;
  http.kind = 'grpc';
  const p = path.join(tmpdir(), 'grpc.json');
  fs.writeFileSync(p, JSON.stringify(g));
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'scaffold-brief', p], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /cannot generate wiring for/);
});

test('renderBrief: compose block includes every service and every wire from the spec', () => {
  const brief = renderBrief(SPEC);
  const fence = brief.match(/```yaml\n([\s\S]*?)```/);
  assert.ok(fence, 'brief has a fenced yaml compose block');
  const compose = fence![1];

  const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  // every service + datastore node appears as a compose service key
  for (const n of spec.nodes) {
    if (n.kind !== 'service' && n.kind !== 'datastore') continue;
    assert.match(compose, new RegExp(`^  ${n.label}:$`, 'm'), `compose entry for ${n.label}`);
  }
  // every spec edge is represented by its env wire
  assert.match(compose, /^      API_URL: http:\/\/api:8000$/m); // gateway->api http (both edges)
  assert.match(compose, /^      DATABASE_URL: postgresql:\/\/app:app@postgres:5432\/ticketing$/m); // api->postgres (postgresql:// — SQLAlchemy 2.x rejects the postgres:// alias)
  const redisWires = compose.match(/^      REDIS_URL: redis:\/\/redis:6379$/gm) ?? [];
  assert.strictEqual(redisWires.length, 2, 'api publish wire + worker consume wire');
  // app services build from their label directory; infra is image-only
  for (const label of ['gateway', 'api', 'worker']) {
    assert.ok(compose.includes(`    build: ./${label}`), `build entry for ${label}`);
  }
  assert.match(compose, /^    image: postgres:16$/m);
  assert.match(compose, /^    image: redis:7$/m);
});

test('renderBrief: per-service tasks carry routes, clients, topics and tables', () => {
  const brief = renderBrief(SPEC);
  // routes on api from gateway's inbound edges, method + pathPattern
  assert.match(brief, /- `GET \/tickets\/\*` \(called by `gateway`\)/);
  assert.match(brief, /@app\.get\("\/tickets\/\{p1\}"\)/);
  assert.match(brief, /- `POST \/tickets` \(called by `gateway`\)/);
  // clients on gateway with the env-var law name
  assert.match(brief, /- `GET \/tickets\/\*` against `api` via env `API_URL`/);
  assert.match(brief, /fetch\(`\$\{process\.env\.API_URL\}\/tickets\/\$\{p1\}`\)/);
  assert.match(brief, /method: 'POST',/);
  // queue tasks with the exact topic literal
  assert.match(brief, /- publish to `ticket.created` on broker `redis` via env `REDIS_URL`/);
  assert.match(brief, /r\.publish\("ticket\.created", json\.dumps\(payload\)\)/);
  assert.match(brief, /- subscribe to `ticket.created` on broker `redis` via env `REDIS_URL`/);
  assert.match(brief, /subscriber\.subscribe\('ticket\.created', \(message\) => \{/);
  // db task naming the table
  assert.match(brief, /- table `tickets` on `postgres` via env `DATABASE_URL`/);
  assert.match(brief, /INSERT INTO tickets/);
});

// ---- packaging & ports law (v5 Phase C) ----

test('renderBrief: packaging section is derived per language (ts→npm/tsx/node:20, py→pip/uvicorn/python:3.12)', () => {
  const brief = renderBrief(SPEC);

  // gateway: ts / express — npm, tsx index.ts, node:20-slim
  const gateway = serviceSection(brief, 'gateway');
  assert.match(gateway, /### Packaging/);
  assert.match(gateway, /Package manager: \*\*npm\*\*/);
  assert.match(gateway, /Start command: `npm start` \(runs `tsx index.ts`\)/);
  assert.match(gateway, /Runtime: `node:20-slim`/);
  assert.doesNotMatch(gateway, /uvicorn/, 'a ts service must not get a uvicorn start command');

  // api: py / fastapi (http) — pip, uvicorn app.main:app on port 8000, python:3.12-slim
  const api = serviceSection(brief, 'api');
  assert.match(api, /### Packaging/);
  assert.match(api, /Package manager: \*\*pip\*\*/);
  assert.match(api, /Dependency manifest: `requirements.txt`/);
  assert.match(api, /Start command: `uvicorn app\.main:app --host 0\.0\.0\.0 --port 8000`/);
  assert.match(api, /Runtime: `python:3\.12-slim`/);

  // worker: ts, no http edge — still npm + tsx index.ts (npm start), not uvicorn/python
  const worker = serviceSection(brief, 'worker');
  assert.match(worker, /### Packaging/);
  assert.match(worker, /Start command: `npm start` \(runs `tsx index.ts`\)/);
  assert.match(worker, /Runtime: `node:20-slim`/);
});

test('renderBrief: a py service with no http edge gets the `python main.py` start command', () => {
  // A pure-python worker (no http edge, no framework) must not get a uvicorn
  // command — it is a plain long-running process.
  const spec = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo', meta: { tech: 'redis' } },
      { id: 'topic:t', kind: 'topic', label: 'evt', parentId: 'ds:redis' },
      { id: 'svc:pyw', kind: 'service', label: 'pyw', parentId: 'repo', meta: { language: 'py' } },
    ],
    [
      {
        id: 'e1',
        srcId: 'svc:pyw',
        dstId: 'topic:t',
        kind: 'queue_consume',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { topic: 'evt' },
      },
    ]
  );
  const pyw = serviceSection(renderSpec(spec), 'pyw');
  assert.match(pyw, /Package manager: \*\*pip\*\*/);
  assert.match(pyw, /Start command: `python main.py`/);
  assert.doesNotMatch(pyw, /uvicorn/, 'a py worker with no http edge must not get uvicorn');
});

test('renderBrief: ports law maps only entry-point http services to the host', () => {
  const brief = renderBrief(SPEC);
  const fence = brief.match(/```yaml\n([\s\S]*?)```/);
  const compose = fence![1];
  // gateway is an entry point (http server, zero inbound http) → host mapping
  assert.match(compose, /^  gateway:\n    build: \.\/gateway\n    ports:\n      - "3000:3000"$/m);
  // exactly one ports: block in the whole compose (only gateway)
  assert.strictEqual((compose.match(/^    ports:$/gm) ?? []).length, 1, 'only the entry point is host-exposed');
  // api is reached internally (inbound http from gateway) → no ports block
  const apiBlock = compose.slice(compose.indexOf('  api:'), compose.indexOf('  worker:'));
  assert.doesNotMatch(apiBlock, /ports:/, 'internally-reached api gets no host mapping');
});

test('renderBrief: the database wire uses the postgresql:// scheme (SQLAlchemy 2.x rejects postgres://)', () => {
  const brief = renderBrief(SPEC);
  assert.match(brief, /DATABASE_URL: postgresql:\/\/app:app@postgres:5432\/ticketing/);
  assert.doesNotMatch(brief, /postgres:\/\/app/, 'must not emit the legacy postgres:// alias');
});

// ---- derived framework (v5 Phase B1) ----

/** Minimal valid design-mode spec builder. */
function designSpec(nodes: any[], edges: any[]): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes,
    edges,
    warnings: [],
  } as ArchGraph;
}

function httpEdge(id: string, srcId: string, dstId: string, method: string, pathPattern: string) {
  return {
    id,
    srcId,
    dstId,
    kind: 'http',
    confidence: 1,
    origin: 'design',
    evidence: [],
    detail: { method, pathPattern },
  };
}

/** Render `spec` and return only the `## Service <label> ...` block for `label`. */
function serviceSection(brief: string, label: string): string {
  const lines = brief.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## Service \`${label}\``));
  assert.ok(start >= 0, `brief has a section for service ${label}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function renderSpec(spec: ArchGraph): string {
  const p = path.join(tmpdir(), 'spec.json');
  fs.writeFileSync(p, JSON.stringify(spec));
  return renderBrief(p);
}

test('renderBrief: inbound http + unset meta.framework derives the framework (no contradictory skeleton)', () => {
  // The exact contradiction bug: a ts service that IS called over http but has
  // no meta.framework. Pre-fix, its skeleton read "a plain long-running node
  // process (no HTTP server needed)" while the Routes-to-expose section right
  // below demanded an express `app.get(...)` handler — a self-contradicting
  // brief. Post-fix, framework is derived from the inbound edge (ts ⇒ express).
  const spec = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      {
        id: 'svc:caller',
        kind: 'service',
        label: 'caller',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'express' },
      },
      // web: called over http, but NO meta.framework authored.
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo', meta: { language: 'ts' } },
    ],
    [httpEdge('e1', 'svc:caller', 'svc:web', 'GET', '/items/*')]
  );
  const web = serviceSection(renderSpec(spec), 'web');
  // must NOT claim no server is needed, AND must render express routes.
  assert.doesNotMatch(web, /no HTTP server needed/, 'derived-framework callee must not say "no HTTP server needed"');
  assert.match(web, /^## Service `web` \(ts \/ express\)$/m);
  assert.match(web, /Minimal skeleton: an express app/);
  assert.match(web, /### Routes to expose/);
  assert.match(web, /app\.get\('\/items\/:p1', handler\);/);
});

test('renderBrief: py inbound http + unset framework derives fastapi (not express routes)', () => {
  // The python half of the same bug: pre-fix an unset framework fell through to
  // the express branch of the routes loop, emitting a ts `app.get(...)` handler
  // for a PYTHON service, under a "plain python process (no HTTP server)"
  // skeleton. Post-fix: derived fastapi ⇒ fastapi skeleton + `@app.get` route.
  const spec = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      {
        id: 'svc:caller',
        kind: 'service',
        label: 'caller',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'express' },
      },
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo', meta: { language: 'py' } },
    ],
    [httpEdge('e1', 'svc:caller', 'svc:web', 'GET', '/items/*')]
  );
  const web = serviceSection(renderSpec(spec), 'web');
  assert.doesNotMatch(web, /no HTTP server needed/);
  assert.match(web, /^## Service `web` \(py \/ fastapi\)$/m);
  assert.match(web, /Minimal skeleton: `app = FastAPI/);
  assert.match(web, /@app\.get\("\/items\/\{p1\}"\)/);
  assert.doesNotMatch(web, /app\.get\('/, 'must not emit an express route for a python service');
});

test('renderBrief: pure consumer/producer ignores a stray meta.framework and stays a plain process', () => {
  // The converse bug: a worker with no http edges but a stale meta.framework
  // carried over from editing must NOT scaffold a phantom express server.
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  const worker = g.nodes.find((n) => n.id === 'svc:worker')!;
  worker.meta = { ...worker.meta, framework: 'express' }; // stray value
  const brief = renderSpec(g);
  const section = serviceSection(brief, 'worker');
  assert.match(section, /^## Service `worker` \(ts\)$/m, 'header must not gain a framework');
  assert.match(section, /Minimal skeleton: a plain long-running node process \(no HTTP server needed\)/);
  assert.doesNotMatch(section, /### Routes to expose/);
  assert.doesNotMatch(section, /express app/);
});

test('renderBrief: outbound-only http service (gateway shape) still derives its framework', () => {
  // Locking test: a service that only CALLS over http (no inbound edges) — the
  // api-gateway shape — must still get an HTTP framework skeleton (express for
  // ts), because it serves external traffic the spec does not model as nodes.
  // This is why the derivation keys on http participation, not inbound alone.
  const spec = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:gw', kind: 'service', label: 'gw', parentId: 'repo', meta: { language: 'ts' } },
      {
        id: 'svc:api',
        kind: 'service',
        label: 'api',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'express' },
      },
    ],
    [httpEdge('e1', 'svc:gw', 'svc:api', 'GET', '/items/*')]
  );
  const gw = serviceSection(renderSpec(spec), 'gw');
  assert.match(gw, /^## Service `gw` \(ts \/ express\)$/m);
  assert.match(gw, /Minimal skeleton: an express app/);
  assert.doesNotMatch(gw, /no HTTP server needed/);
  assert.doesNotMatch(gw, /### Routes to expose/, 'outbound-only service exposes no routes');
  assert.match(gw, /### HTTP clients to write/);
});

test('renderBrief: meta.framework contradicting the language-derived value fails loudly', () => {
  // A py service on an http edge tagged `express` is a genuine spec error:
  // fail() rather than silently override, so the mistake surfaces.
  const spec = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      {
        id: 'svc:caller',
        kind: 'service',
        label: 'caller',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'express' },
      },
      {
        id: 'svc:web',
        kind: 'service',
        label: 'web',
        parentId: 'repo',
        meta: { language: 'py', framework: 'express' }, // contradicts py ⇒ fastapi
      },
    ],
    [httpEdge('e1', 'svc:caller', 'svc:web', 'GET', '/items/*')]
  );
  assert.throws(() => renderSpec(spec), /meta\.framework "express" contradicts the framework derived from language "py"/);

  // ...and a ts service tagged `fastapi` fails symmetrically.
  const spec2 = designSpec(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      {
        id: 'svc:caller',
        kind: 'service',
        label: 'caller',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'express' },
      },
      {
        id: 'svc:web',
        kind: 'service',
        label: 'web',
        parentId: 'repo',
        meta: { language: 'ts', framework: 'fastapi' },
      },
    ],
    [httpEdge('e1', 'svc:caller', 'svc:web', 'GET', '/items/*')]
  );
  assert.throws(() => renderSpec(spec2), /meta\.framework "fastapi" contradicts the framework derived from language "ts"/);
});

// ---- CLI ----

test('sequence scaffold-brief: stdout by default, exit 0', () => {
  const out = execFileSync('node', [CLI, 'scaffold-brief', SPEC], { encoding: 'utf8' });
  assert.match(out, /^# Scaffolding brief: ticketing\n/);
  assert.match(out, /## Verify before you finish \(mandatory\)/);
});

test('sequence scaffold-brief: --out writes the file', () => {
  const dir = tmpdir();
  const outPath = path.join(dir, 'brief.md');
  execFileSync('node', [CLI, 'scaffold-brief', SPEC, '--out', outPath], { encoding: 'utf8' });
  const written = fs.readFileSync(outPath, 'utf8');
  assert.strictEqual(written, renderBrief(SPEC));
});

test('sequence scaffold-brief: exit 2 on a non-design spec', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  delete g.mode;
  for (const e of g.edges) {
    e.origin = 'deterministic';
    e.confidence = 0.9;
    e.evidence = [{ file: 'x.ts', line: 1, snippet: 'x' }];
  }
  const p = path.join(tmpdir(), 'scan.json');
  fs.writeFileSync(p, JSON.stringify(g));
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'scaffold-brief', p], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /requires a design-mode spec/);
});

test('sequence scaffold-brief: exit 2 on an invalid spec', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  g.edges[0].confidence = 0.5; // illegal in design mode
  const p = path.join(tmpdir(), 'bad.json');
  fs.writeFileSync(p, JSON.stringify(g));
  let code = 0;
  try {
    execFileSync('node', [CLI, 'scaffold-brief', p], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});
