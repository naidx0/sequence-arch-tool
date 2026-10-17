import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

/*
 * GET /archgraph.json used to JSON.stringify the whole graph (4+ MB, ~60 ms on the owner's repo)
 * for EVERY request. The serialized body is now reused while the graph, its nodeDetail and the
 * validator are unchanged. These tests pin both halves: the second read does not serialize the
 * graph again, and a rescan / a scoped read is never answered from the cached bytes.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.resolve(here, '..', '..', 'test', 'fixtures', 'plainapp');

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-agbody-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
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
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

/** Count JSON.stringify calls whose subject is a whole graph answer (it has `edges` and `nodeDetail`). */
function spyGraphSerializations(): { count: () => number; restore: () => void } {
  const real = JSON.stringify;
  let n = 0;
  JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
    if (value !== null && typeof value === 'object' && 'edges' in value && 'nodeDetail' in value) n++;
    return (real as (v: unknown, ...r: unknown[]) => string)(value, ...rest);
  }) as typeof JSON.stringify;
  return { count: () => n, restore: () => (JSON.stringify = real) };
}

test('archgraph: a repeat read is the same bytes and does not serialize the graph again', async () => {
  const s = await startServer();
  const spy = spyGraphSerializations();
  try {
    const a = await (await fetch(`${s.base}/archgraph.json`)).text();
    const afterFirst = spy.count();
    assert.ok(afterFirst >= 1, 'the first read serializes the graph');
    const b = await (await fetch(`${s.base}/archgraph.json`)).text();
    const c = await (await fetch(`${s.base}/archgraph.json`)).text();
    assert.equal(b, a);
    assert.equal(c, a);
    assert.equal(spy.count(), afterFirst, 'the second and third reads reused the serialized body');
    assert.ok(JSON.parse(a).nodes.length > 0);
  } finally {
    spy.restore();
    await s.close();
  }
});

test('archgraph: a rescan that changes the graph is never answered from the cached body', async () => {
  const s = await startServer();
  try {
    const before = JSON.parse(await (await fetch(`${s.base}/archgraph.json`)).text()) as { nodes: Array<{ id: string }>; scannedAt: string };
    await fetch(`${s.base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'backend/app/extra.py', content: 'Y = 2\n' }),
    });
    await (await fetch(`${s.base}/api/scan`, { method: 'POST' })).text();
    const after = JSON.parse(await (await fetch(`${s.base}/archgraph.json`)).text()) as { nodes: Array<{ id: string }>; scannedAt: string };
    assert.notEqual(after.scannedAt, before.scannedAt);
    assert.ok(after.nodes.some((n) => n.id.includes('extra.py')), 'the new file is in the graph that came back');
  } finally {
    await s.close();
  }
});

test('archgraph: a scoped read is not served the unscoped cached body', async () => {
  const s = await startServer();
  try {
    const full = JSON.parse(await (await fetch(`${s.base}/archgraph.json`)).text()) as { nodes: unknown[] };
    await (await fetch(`${s.base}/archgraph.json`)).text();
    const scoped = JSON.parse(await (await fetch(`${s.base}/archgraph.json?scope=svc:backend`)).text()) as { nodes: unknown[] };
    assert.ok(scoped.nodes.length < full.nodes.length);
    const again = JSON.parse(await (await fetch(`${s.base}/archgraph.json`)).text()) as { nodes: unknown[] };
    assert.equal(again.nodes.length, full.nodes.length, 'and the unscoped read after it is still the full graph');
  } finally {
    await s.close();
  }
});
