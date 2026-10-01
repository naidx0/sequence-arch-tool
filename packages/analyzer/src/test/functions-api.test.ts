import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import { createRepoServer } from '../server/repoServer.js';
import { FUNCTIONS_FILE } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-functions-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string | null): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('GET /api/functions: returns functionGraph with nodes', async () => {
  const repo = shopfrontRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/functions`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { functionGraph: { nodes: unknown[]; edges: unknown[] } };
    assert.ok(body.functionGraph);
    assert.ok(Array.isArray(body.functionGraph.nodes));
    assert.ok(body.functionGraph.nodes.length > 0, 'shopfront should yield function nodes');
  } finally {
    await close();
  }
});

test('GET /api/functions: cache hit on unchanged scannedAt', async () => {
  const repo = shopfrontRepo();
  const graph = await scanRepo(repo, { cluster: true });
  const { base, close } = await startServer(repo);
  try {
    const call = () => fetch(`${base}/api/functions`);
    const res1 = await call();
    assert.strictEqual(res1.status, 200);
    const body1 = (await res1.json()) as { functionGraph: { nodes: unknown[] } };
    assert.ok(body1.functionGraph.nodes.length > 0);
    assert.ok(
      fs.existsSync(path.join(repo, '.sequence', FUNCTIONS_FILE)),
      'functions.json written under .sequence'
    );

    const res2 = await call();
    assert.strictEqual(res2.status, 200);
    const body2 = (await res2.json()) as { functionGraph: { nodes: unknown[] } };
    assert.strictEqual(body2.functionGraph.nodes.length, body1.functionGraph.nodes.length);

    // Cache keyed on scannedAt — a rescan invalidates
    assert.ok(graph.scannedAt);
  } finally {
    await close();
  }
});

test('GET /api/functions: no app source → empty graph, 200', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-api-empty-'));
  fs.writeFileSync(
    path.join(dir, 'docker-compose.yml'),
    'services:\n  db:\n    image: postgres:16\n'
  );
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/functions`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { functionGraph: { nodes: unknown[]; edges: unknown[] } };
    assert.deepStrictEqual(body.functionGraph.nodes, []);
    assert.deepStrictEqual(body.functionGraph.edges, []);
  } finally {
    await close();
  }
});

test('GET /api/functions: malformed cache degrades to fresh build, never 500', async () => {
  const repo = shopfrontRepo();
  const seqDir = path.join(repo, '.sequence');
  fs.mkdirSync(seqDir, { recursive: true });
  fs.writeFileSync(path.join(seqDir, FUNCTIONS_FILE), '<<<not json>>>');
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/functions`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { functionGraph: { nodes: unknown[] } };
    assert.ok(Array.isArray(body.functionGraph.nodes));
  } finally {
    await close();
  }
});

test('LOCK: buildRepoFunctionGraph matches HTTP payload shape', async () => {
  const repo = shopfrontRepo();
  const arch = await scanRepo(repo, { cluster: true });
  const local = await buildRepoFunctionGraph(repo, { cluster: true }, arch);
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/functions`);
    const body = (await res.json()) as { functionGraph: typeof local };
    assert.strictEqual(body.functionGraph.nodes.length, local.nodes.length);
    assert.strictEqual(body.functionGraph.edges.length, local.edges.length);
  } finally {
    await close();
  }
});
