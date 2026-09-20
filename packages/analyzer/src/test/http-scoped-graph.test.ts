import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

/**
 * WAVE 1 ITEM 1.8 — SCOPED GRAPH READ + ETag/304.
 *
 * Gap G7: `/archgraph.json` is all-or-nothing — no `?scope=`, no `?depth=`, even
 * though `scopeGraph` already exists in `brief.ts` and is re-exported from the
 * package index; it is used only internally by `/api/generate` and `/api/ddl`.
 * Gap G8: no HTTP caching anywhere, despite `ArchGraph.scannedAt` being a natural
 * ETag, so every board mount re-downloads and re-parses the whole graph.
 *
 * WHAT THE ASSERTIONS PIN
 *
 *  - A scoped read is a STRICT SUBGRAPH that still contains what was asked for:
 *    fewer nodes than the full graph, every requested id present, and every edge
 *    endpoint inside the returned node set. The last one is the invariant that
 *    matters — a subgraph with a dangling edge is a lie about the topology, and
 *    that is exactly the class of defect W1.9 just fixed elsewhere.
 *  - `depth` widens the scope MONOTONICALLY (a deeper read is a superset), so a
 *    client can raise depth without fearing it loses a node.
 *  - The ETag DISTINGUISHES the responses it labels. A caching key derived from
 *    `scannedAt` alone would hand the full graph a 304 for a scoped request; the
 *    test asserts the two tags differ, which is the property that makes 304 safe.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
/** The one fixture in the tree whose scan produces real `warnings` (measured: 3). */
const MONOREPO = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'monorepo-apps');

function copyFixture(src: string, tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `seq-scope-${tag}-`));
  const repo = path.join(dir, 'repo');
  fs.cpSync(src, repo, { recursive: true });
  return repo;
}

function plainappRepo(): string {
  return copyFixture(PLAINAPP, 'plain');
}

interface Started {
  base: string;
  close: () => Promise<void>;
}

async function startServer(fixture: string = PLAINAPP): Promise<Started> {
  const repo = copyFixture(fixture, 'srv');
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    },
  };
}

interface GraphBody {
  nodes: Array<{ id: string }>;
  edges: Array<{ id: string; srcId: string; dstId: string }>;
  scannedAt: string;
  warnings: string[];
  scope?: { requested: string[]; depth: number; omittedEdges: number };
}

async function get(base: string, query: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/archgraph.json${query}`, { headers });
  const text = await res.text();
  return {
    status: res.status,
    etag: res.headers.get('etag'),
    cacheControl: res.headers.get('cache-control'),
    body: text === '' ? undefined : (JSON.parse(text) as GraphBody),
  };
}

test('a scoped read returns a strict subgraph that still contains the requested ids', async () => {
  const s = await startServer();
  try {
    const full = await get(s.base, '');
    assert.strictEqual(full.status, 200);
    const fullNodes = full.body!.nodes.length;
    assert.ok(fullNodes > 2, 'the fixture has something to narrow');

    const scoped = await get(s.base, '?scope=svc:backend');
    assert.strictEqual(scoped.status, 200);
    const ids = scoped.body!.nodes.map((n) => n.id);
    assert.ok(ids.includes('svc:backend'), 'the scoped read includes the id it was scoped to');
    assert.ok(
      scoped.body!.nodes.length < fullNodes,
      `a scoped read must be smaller than the whole graph (${scoped.body!.nodes.length} vs ${fullNodes})`,
    );

    // No dangling edges: every edge in the answer has BOTH endpoints in it.
    const present = new Set(ids);
    for (const e of scoped.body!.edges) {
      assert.ok(present.has(e.srcId), `edge ${e.id} src ${e.srcId} is inside the scope`);
      assert.ok(present.has(e.dstId), `edge ${e.id} dst ${e.dstId} is inside the scope`);
    }
    // Edges cut by the scope are COUNTED, never dropped silently — and the count
    // is checked against the full graph rather than merely type-checked, because
    // `omittedEdges: 0` is exactly what a broken counter also reports.
    const expectedOmitted = full.body!.edges.filter(
      (e) => present.has(e.srcId) !== present.has(e.dstId),
    ).length;
    assert.strictEqual(
      scoped.body!.scope?.omittedEdges,
      expectedOmitted,
      'every edge with exactly one endpoint inside the scope is reported as omitted',
    );
    assert.ok(expectedOmitted > 0, 'this scope really does cut edges, so the count is doing work');
  } finally {
    await s.close();
  }
});

test('scoping to a container returns what is INSIDE it, not an empty box', async () => {
  // Measured on the real monorepo before this was fixed: `?scope=svc:analyzer`
  // returned 2 nodes and 0 edges at every depth 0..2. `scopeGraph` pulls in a
  // node's ANCESTORS (topic → broker → repo) and nothing below it, and in this
  // graph the edges live between FILE nodes — so scoping to a service produced a
  // service with nothing in it and no edges, at any depth. A scope that answers
  // "the analyzer package" with an empty box is worse than no scope at all,
  // because the client renders it and believes it.
  const s = await startServer();
  try {
    const scoped = await get(s.base, '?scope=svc:backend');
    assert.strictEqual(scoped.status, 200);
    const ids = scoped.body!.nodes.map((n) => n.id);
    assert.ok(ids.includes('svc:backend'), 'the container itself is present');
    const children = ids.filter((id) => id.startsWith('file:backend'));
    assert.ok(
      children.length > 0,
      `scoping to a service must include the files it contains; got ${JSON.stringify(ids)}`,
    );
    // And it is still a strict narrowing: the OTHER service's files stay out.
    assert.ok(
      !ids.some((id) => id.startsWith('file:frontend')),
      'a scope is still a scope — the sibling service is not dragged in',
    );
  } finally {
    await s.close();
  }
});

test('a scoped read keeps the scan warnings — narrowing the view never launders them away', async () => {
  // `scopeGraph` returns `{ ...graph, warnings: [] }` because it is used to build
  // SPECS, where a scan warning does not belong. Served as an HTTP graph read that
  // erasure is a lie in the direction that hurts: the same repo looks clean the
  // moment a client narrows the view, and warnings like "this looks like a
  // deployment-only repo" are exactly what a narrowed view most needs to carry.
  const s = await startServer(MONOREPO);
  try {
    const full = await get(s.base, '');
    assert.ok(full.body!.warnings.length > 0, 'the fixture really does warn');

    const scoped = await get(s.base, '?scope=svc:api&depth=1');
    assert.strictEqual(scoped.status, 200);
    assert.deepStrictEqual(
      scoped.body!.warnings,
      full.body!.warnings,
      'a scoped read reports the same qualifications the full read does',
    );
  } finally {
    await s.close();
  }
});

test('depth widens the scope monotonically', async () => {
  const s = await startServer();
  try {
    const d0 = await get(s.base, '?scope=ds:postgres&depth=0');
    const d1 = await get(s.base, '?scope=ds:postgres&depth=1');
    const full = await get(s.base, '');
    assert.strictEqual(d0.status, 200);
    assert.strictEqual(d1.status, 200);

    const at0 = new Set(d0.body!.nodes.map((n) => n.id));
    const at1 = new Set(d1.body!.nodes.map((n) => n.id));
    for (const id of at0) assert.ok(at1.has(id), `depth 1 keeps everything depth 0 had (${id})`);
    assert.ok(at1.size > at0.size, 'depth 1 reaches a neighbour depth 0 could not');
    assert.ok(at1.size <= full.body!.nodes.length, 'a scoped read never exceeds the whole graph');
    assert.strictEqual(d1.body!.scope?.depth, 1, 'the answer reports the depth it was computed at');
  } finally {
    await s.close();
  }
});

test('an unknown scope id is refused rather than silently answered with the whole graph', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/archgraph.json?scope=svc:does-not-exist`);
    assert.strictEqual(res.status, 404, 'a scope that matches nothing is an honest miss');
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /svc:does-not-exist/, 'the refusal names the id that missed');
  } finally {
    await s.close();
  }
});

test('/archgraph.json sends an ETag, and a repeat request with If-None-Match gets 304', async () => {
  const s = await startServer();
  try {
    const first = await get(s.base, '');
    assert.strictEqual(first.status, 200);
    assert.ok(first.etag, '/archgraph.json must send an ETag — scannedAt is a natural one');
    // An ETag with NO Cache-Control is the dangerous half of caching: RFC 9111
    // lets a browser pick its own heuristic freshness lifetime and serve the body
    // again WITHOUT revalidating, so a graph could go stale in a tab with the
    // validator never consulted. `no-cache` means "store it, but always ask" —
    // which is the only cache posture that makes an ETag on a live graph safe.
    assert.match(
      first.cacheControl ?? '',
      /no-cache/,
      'a validator without a revalidation directive lets a browser serve a stale graph',
    );

    const second = await get(s.base, '', { 'if-none-match': first.etag! });
    assert.strictEqual(second.status, 304, 'an unchanged graph is not re-sent');
    assert.strictEqual(second.etag, first.etag, 'the 304 repeats the tag it validated');
    assert.strictEqual(second.body, undefined, 'a 304 carries no body');
  } finally {
    await s.close();
  }
});

test('the ETag distinguishes a scoped read from the full graph', async () => {
  const s = await startServer();
  try {
    const full = await get(s.base, '');
    const scoped = await get(s.base, '?scope=svc:backend');
    assert.ok(full.etag && scoped.etag);
    assert.notStrictEqual(
      scoped.etag,
      full.etag,
      'two different bodies must not share a validator, or a 304 serves the wrong graph',
    );

    // And the proof that it matters: the full graph's tag must NOT validate the scoped read.
    const cross = await get(s.base, '?scope=svc:backend', { 'if-none-match': full.etag! });
    assert.strictEqual(cross.status, 200, 'a mismatched validator gets the real body, not a 304');
    assert.ok(cross.body!.nodes.length < full.body!.nodes.length);
  } finally {
    await s.close();
  }
});

test('the ETag changes when the graph is rescanned', async () => {
  const s = await startServer();
  try {
    const before = await get(s.base, '');
    // A write moves the disk under the graph; the rescan produces a new scannedAt.
    await fetch(`${s.base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'backend/app/extra.py', content: 'Y = 2\n' }),
    });
    const rescan = await fetch(`${s.base}/api/scan`, { method: 'POST' });
    await rescan.text();
    const after = await get(s.base, '');
    assert.notStrictEqual(
      after.etag,
      before.etag,
      'a validator that survives a rescan would cache a graph that no longer describes the repo',
    );
    const revalidate = await get(s.base, '', { 'if-none-match': before.etag! });
    assert.strictEqual(revalidate.status, 200, 'a stale validator must not win a 304');
  } finally {
    await s.close();
  }
});
