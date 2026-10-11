import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchEdge, ArchGraph, EdgeKind } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { diffGraphs } from '../diff.js';
import {
  detailsMatch,
  methodsMatch,
  pathsMatch,
  tablesMatch,
} from '../detail.js';

// Detail-aware conformance (v5 Phase A): `sequence diff`, for a design-mode base
// spec, now compares HTTP method/path and DB table — not just service-pair + kind.
// These tests reproduce the exact v4 adversarial-review finding (a silently-swapped
// table / method / path passing as "conforms, exit 0") and prove it is now caught,
// while the tolerance rules keep an unspecified/wildcard field from over-tightening.

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');
const SCAFFOLD = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

const NODES = [
  { id: 'repo', kind: 'repo' as const, label: 't' },
  { id: 'svc:a', kind: 'service' as const, label: 'a', parentId: 'repo' },
  { id: 'svc:b', kind: 'service' as const, label: 'b', parentId: 'repo' },
  { id: 'ds:pg', kind: 'datastore' as const, label: 'pg', parentId: 'repo' },
];

let seq = 0;
function designEdge(
  srcId: string,
  dstId: string,
  kind: EdgeKind,
  detail: ArchEdge['detail']
): ArchEdge {
  return { id: `d${++seq}`, srcId, dstId, kind, confidence: 1, origin: 'design', evidence: [], detail };
}
function scanEdge(
  srcId: string,
  dstId: string,
  kind: EdgeKind,
  detail: ArchEdge['detail']
): ArchEdge {
  return {
    id: `s${++seq}`,
    srcId,
    dstId,
    kind,
    confidence: 0.9,
    origin: 'deterministic',
    evidence: [{ file: 'impl.ts', line: 7, snippet: 'x' }],
    detail,
  };
}

function graph(mode: 'scan' | 'design', edges: ArchEdge[]): ArchGraph {
  return {
    version: 1,
    ...(mode === 'design' ? { mode: 'design' as const } : {}),
    scannedAt: '',
    repoRoot: '',
    repoName: 't',
    nodes: JSON.parse(JSON.stringify(NODES)),
    edges,
    warnings: [],
  };
}

function writeSpec(g: ArchGraph): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-detail-'));
  const p = path.join(dir, 'g.json');
  fs.writeFileSync(p, JSON.stringify(g));
  return p;
}

function writePair(base: ArchGraph, head: ArchGraph): { basePath: string; headPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-detail-'));
  const basePath = path.join(dir, 'base.json');
  const headPath = path.join(dir, 'head.json');
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(head));
  return { basePath, headPath };
}

// ---- unit-level matchers ----

test('matchers: tolerant on wildcard/unspecified, strict on concrete conflict', () => {
  // method
  assert.ok(methodsMatch('GET', 'get')); // case-insensitive
  assert.ok(methodsMatch('GET', undefined)); // undefined = wildcard
  assert.ok(!methodsMatch('GET', 'POST'));
  // path shapes: {id} ≡ :id ≡ * (reusing pathToSegments)
  assert.ok(pathsMatch('/tickets/{id}', '/tickets/:id'));
  assert.ok(pathsMatch('/tickets/{id}', '/tickets/*'));
  assert.ok(pathsMatch(undefined, '/tickets/1')); // unspecified = no constraint
  assert.ok(!pathsMatch('/tickets', '/orders'));
  assert.ok(!pathsMatch('/tickets/{id}', '/tickets')); // different length
  // table
  assert.ok(tablesMatch('tickets', 'TICKETS'));
  assert.ok(tablesMatch('tickets', undefined));
  assert.ok(!tablesMatch('tickets', 'widgets'));
  // detailsMatch dispatch
  assert.ok(!detailsMatch('http', { method: 'GET', pathPattern: '/x' }, { method: 'POST', pathPattern: '/x' }));
  assert.ok(!detailsMatch('db_write', { table: 'tickets' }, { table: 'widgets' }));
  assert.ok(detailsMatch('queue_publish', { topic: 'a' }, { topic: 'b' })); // no extra detail to compare
});

// ---- 1. the exact v4 finding, now caught ----

test('db table swap (tickets vs widgets) is caught as a mismatch', () => {
  const base = graph('design', [designEdge('svc:a', 'ds:pg', 'db_access', { table: 'tickets' })]);
  const head = graph('scan', [scanEdge('svc:a', 'ds:pg', 'db_access', { table: 'widgets' })]);
  const { basePath, headPath } = writePair(base, head);
  const { added, removed, mismatched, markdown } = diffGraphs(basePath, headPath);

  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, ['a -> pg [db_access]']);
  assert.match(markdown, /### Wrong wiring details/);
  assert.match(markdown, /spec expects table `tickets`/);
  assert.match(markdown, /`widgets`/);
  assert.match(markdown, /## sequence conformance report/);
  // exit-equivalent is non-zero
  assert.ok(added.length + removed.length + mismatched.length > 0);
});

test('http method/path swap (GET /tickets/* vs POST /tickets) is caught as a mismatch', () => {
  const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets/*' })]);
  const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'POST', pathPattern: '/tickets' })]);
  const { basePath, headPath } = writePair(base, head);
  const { added, removed, mismatched, markdown } = diffGraphs(basePath, headPath);

  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, ['a -> b [http]']);
  assert.match(markdown, /### Wrong wiring details/);
  assert.match(markdown, /spec expects `GET \/tickets\/\*`/);
  assert.match(markdown, /implementation has `POST \/tickets`/);
});

// ---- 2. wildcard/unspecified tolerance ----

test('an unspecified spec path imposes no constraint (no mismatch)', () => {
  const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: 'GET' })]); // no pathPattern
  const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/anything/deep/here' })]);
  const { basePath, headPath } = writePair(base, head);
  const { mismatched } = diffGraphs(basePath, headPath);
  assert.deepStrictEqual(mismatched, []);
});

test('a wildcard spec method imposes no constraint (no mismatch)', () => {
  const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: '*', pathPattern: '/tickets' })]);
  const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'DELETE', pathPattern: '/tickets' })]);
  const { basePath, headPath } = writePair(base, head);
  const { mismatched } = diffGraphs(basePath, headPath);
  assert.deepStrictEqual(mismatched, []);
});

// ---- 3. path-shape tolerance ({id} vs :id vs *) ----

test('path-shape tolerance: {id} matches :id and * (pathToSegments reuse)', () => {
  for (const headPattern of ['/tickets/:id', '/tickets/*', '/tickets/{ticketId}']) {
    const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets/{id}' })]);
    const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: headPattern })]);
    const { basePath, headPath } = writePair(base, head);
    const { mismatched } = diffGraphs(basePath, headPath);
    assert.deepStrictEqual(mismatched, [], `expected no mismatch for head path ${headPattern}`);
  }
});

// ---- multi-leaf: one good, one bad ----

test('a spec pair with two http edges flags only the one with no matching call', () => {
  const base = graph('design', [
    designEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets/*' }),
    designEdge('svc:a', 'svc:b', 'http', { method: 'POST', pathPattern: '/tickets' }),
  ]);
  // implementation only ships the GET; the POST is missing at detail level
  const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets/9' })]);
  const { basePath, headPath } = writePair(base, head);
  const { added, removed, mismatched, markdown } = diffGraphs(basePath, headPath);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []); // coarse pair still present on both sides
  assert.deepStrictEqual(mismatched, ['a -> b [http]']);
  assert.match(markdown, /spec expects `POST \/tickets`/);
});

// ---- db: a tableless connection edge must not rescue a wrong pinned table ----

test('real-scan shape: table-bearing (widgets) + tableless connection edge is still caught', () => {
  // This mirrors what `scan` actually emits for a DB-using service: db_read +
  // db_write carrying the table, PLUS a connection-level db_access with no table.
  // The v4 finding was that the tableless edge silently rescued a wrong table.
  const base = graph('design', [designEdge('svc:a', 'ds:pg', 'db_access', { table: 'tickets' })]);
  const head = graph('scan', [
    scanEdge('svc:a', 'ds:pg', 'db_read', { table: 'widgets', database: 'pg' }),
    scanEdge('svc:a', 'ds:pg', 'db_write', { table: 'widgets', database: 'pg' }),
    scanEdge('svc:a', 'ds:pg', 'db_access', { database: 'pg' }), // tableless connection edge
  ]);
  const { added, removed, mismatched, markdown } = diffGraphs(writeSpec(base), writeSpec(head));
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, ['a -> pg [db_access]']);
  assert.match(markdown, /spec expects table `tickets`/);
  assert.match(markdown, /`widgets`/);
  assert.doesNotMatch(markdown, /`\*`/); // tableless edge is not summarized as a wildcard table
});

test('genuine-unknown: a connection-only pair (no table-bearing edge) tolerates the spec table', () => {
  // Shared-library / manifest-only DB access: the scanner detects a connection
  // but cannot attribute a table. This must NOT fire a spurious mismatch.
  const base = graph('design', [designEdge('svc:a', 'ds:pg', 'db_access', { table: 'tickets' })]);
  const head = graph('scan', [scanEdge('svc:a', 'ds:pg', 'db_access', { database: 'pg' })]);
  const { mismatched } = diffGraphs(writeSpec(base), writeSpec(head));
  assert.deepStrictEqual(mismatched, []);
});

// ---- http: a path-less bare-URL edge must not rescue a wrong pinned path ----

test('real-scan shape: path-bearing (wrong path) + path-less bare-URL edge is still caught', () => {
  // The HTTP twin of the tableless-db loophole. The scanner emits `pathPattern: ''`
  // for a bare-host call like `fetch(process.env.API_URL)` (join.ts's empty
  // pathSkeleton). Here the impl really calls `/orders` (wrong) AND has a bare-URL
  // edge with empty path. Before the fix, `pathsMatch('/tickets', '')` returned
  // true, so the empty-path edge silently rescued the wrong wiring; now the
  // path-bearing edge is authoritative and the mismatch is caught.
  const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets' })]);
  const head = graph('scan', [
    scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/orders' }), // real, WRONG path
    scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '' }), // bare-host call, no path
  ]);
  const { added, removed, mismatched, markdown } = diffGraphs(writeSpec(base), writeSpec(head));
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, ['a -> b [http]']);
  assert.match(markdown, /### Wrong wiring details/);
  assert.match(markdown, /spec expects `GET \/tickets`/);
});

test('genuine-unknown: a bare-URL-only pair (no path-bearing edge) tolerates the spec path', () => {
  // Only a bare-host call was detected (empty pathSkeleton), no path-bearing edge
  // for this pair. The path is genuinely undetectable — mirror the connection-only
  // db_access case: this must NOT fire a spurious mismatch.
  const base = graph('design', [designEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '/tickets' })]);
  const head = graph('scan', [scanEdge('svc:a', 'svc:b', 'http', { method: 'GET', pathPattern: '' })]);
  const { mismatched } = diffGraphs(writeSpec(base), writeSpec(head));
  assert.deepStrictEqual(mismatched, []);
});

// ---- 4. scan-mode identity: no detail section, mismatched always empty ----

test('scan-mode diff never produces detail mismatches (byte-identity guard)', () => {
  // Same detail-differing edges, but base is scan mode → detail check must not run.
  const base = graph('scan', [scanEdge('svc:a', 'ds:pg', 'db_access', { table: 'tickets' })]);
  const head = graph('scan', [scanEdge('svc:a', 'ds:pg', 'db_access', { table: 'widgets' })]);
  const { basePath, headPath } = writePair(base, head);
  const { added, removed, mismatched, markdown } = diffGraphs(basePath, headPath);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, []);
  assert.strictEqual(markdown, '## sequence drift report\nNo interaction-edge drift.\n');
});

// ---- 5. the real loop, under the stricter check ----

test('loop: ticketing scaffold conforms to spec under the detail-aware check (added/removed/mismatched all empty)', async () => {
  const scanned = await scanRepo(SCAFFOLD);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-detail-loop-'));
  const scannedPath = path.join(dir, 'scanned.json');
  fs.writeFileSync(scannedPath, JSON.stringify(scanned));

  const { added, removed, mismatched } = diffGraphs(SPEC, scannedPath);
  assert.deepStrictEqual(removed, [], 'no spec edge missing from the scaffold');
  assert.deepStrictEqual(added, [], 'no undeclared edge in the scaffold');
  assert.deepStrictEqual(mismatched, [], 'no detail-level (method/path/table) mismatch');
});
