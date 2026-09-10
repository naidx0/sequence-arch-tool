import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { createRepoServer } from '../server/repoServer.js';
import { parseAnnotations, buildAnnotations } from '../explain/explain.js';
import { startMockProvider } from './mock-provider.js';
import { ANNOTATIONS_FILE } from '../server/store.js';

/**
 * Locking tests for POST /api/annotate (W1 understand layer): grounded per-node
 * bullets, honest no-key degrade, malformed-output degrade, and scannedAt cache.
 * Uses the shopfront fixture + injected mock provider (real HTTP hop).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
const TEST_KEY = 'sk-ant-test-ANNOTATE-SECRET-88';

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-annotate-'));
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

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

/* ============================================================ unit locks ===== */

test('parseAnnotations: drops hallucinated ids, keeps real ids only', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const validIds = new Set(graph.nodes.map((n) => n.id));
  const realId = 'svc:gateway';
  assert.ok(validIds.has(realId), 'fixture has svc:gateway');
  const raw = JSON.stringify({
    annotations: {
      [realId]: ['Routes traffic to backend services.'],
      'svc:ghost': ['This service does not exist.'],
    },
  });
  const out = parseAnnotations(raw, validIds, 'regular');
  assert.ok(out[realId], 'real id kept');
  assert.strictEqual(out['svc:ghost'], undefined, 'hallucinated id dropped');
});

test('parseAnnotations: caps bullet count (regular ≤2, advanced ≤4)', () => {
  const validIds = new Set(['svc:a']);
  const many = ['one', 'two', 'three', 'four', 'five'];
  const reg = parseAnnotations(JSON.stringify({ annotations: { 'svc:a': many } }), validIds, 'regular');
  assert.strictEqual(reg['svc:a'].length, 2);
  const adv = parseAnnotations(JSON.stringify({ annotations: { 'svc:a': many } }), validIds, 'advanced');
  assert.strictEqual(adv['svc:a'].length, 4);
});

test('parseAnnotations: trims bullets to ≤120 chars', () => {
  const validIds = new Set(['svc:a']);
  const long = 'x'.repeat(200);
  const out = parseAnnotations(JSON.stringify({ annotations: { 'svc:a': [long] } }), validIds, 'regular');
  assert.strictEqual(out['svc:a'][0].length, 120);
});

test('parseAnnotations: malformed garbage → empty map, no throw', () => {
  const out = parseAnnotations('not json at all {{{', new Set(['svc:a']), 'regular');
  assert.deepStrictEqual(out, {});
});

test('buildAnnotations: provider throw → empty map, mode none', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const result = await buildAnnotations(graph, {
    provider: { provider: 'anthropic', model: 'x', apiKey: 'k' },
    callProvider: async () => {
      throw new Error('boom');
    },
  });
  assert.strictEqual(result.mode, 'none');
  assert.deepStrictEqual(result.annotations, {});
});

/* ============================================================ endpoint ====== */

test('/api/annotate: no provider → 200 with empty annotations, mode none', async () => {
  const repo = shopfrontRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/annotate`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { annotations: Record<string, string[]>; mode: string };
    assert.deepStrictEqual(body.annotations, {});
    assert.strictEqual(body.mode, 'none');
  } finally {
    await close();
  }
});

test('/api/annotate: id-validation drops svc:ghost over HTTP', async () => {
  const repo = shopfrontRepo();
  const graph = await scanRepo(repo, { cluster: true });
  const realId = graph.nodes.find((n) => n.id === 'svc:gateway')!.id;
  const mock = await startMockProvider(() => ({
    text: JSON.stringify({
      annotations: {
        [realId]: ['Public entry point for the shop.'],
        'svc:ghost': ['Phantom service invented by the model.'],
      },
    }),
  }));
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/annotate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detailLevel: 'regular' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { annotations: Record<string, string[]>; mode: string };
    assert.strictEqual(body.mode, 'ai');
    assert.ok(body.annotations[realId], 'real id present');
    assert.strictEqual(body.annotations['svc:ghost'], undefined, 'hallucinated id dropped');
    assert.strictEqual(mock.requests.length, 1);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/annotate: malformed provider output → empty annotations, no throw', async () => {
  const repo = shopfrontRepo();
  const mock = await startMockProvider(() => ({ text: '<<<not json>>>' }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/annotate`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { annotations: Record<string, string[]>; mode: string };
    assert.deepStrictEqual(body.annotations, {});
    assert.strictEqual(body.mode, 'ai');
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/annotate: cache hit on unchanged scannedAt — provider called once', async () => {
  const repo = shopfrontRepo();
  const graph = await scanRepo(repo, { cluster: true });
  const realId = graph.nodes.find((n) => n.id === 'svc:orders')!.id;
  const mock = await startMockProvider(() => ({
    text: JSON.stringify({
      annotations: { [realId]: ['Handles customer orders.'] },
    }),
  }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const call = () =>
      fetch(`${base}/api/annotate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ detailLevel: 'regular' }),
      });
    const res1 = await call();
    assert.strictEqual(res1.status, 200);
    const body1 = (await res1.json()) as { annotations: Record<string, string[]> };
    assert.ok(body1.annotations[realId]);
    assert.ok(
      fs.existsSync(path.join(repo, '.sequence', ANNOTATIONS_FILE)),
      'annotations.json written under .sequence'
    );
    const res2 = await call();
    assert.strictEqual(res2.status, 200);
    const body2 = (await res2.json()) as { annotations: Record<string, string[]> };
    assert.deepStrictEqual(body2.annotations, body1.annotations);
    assert.strictEqual(mock.requests.length, 1, 'second call must not re-invoke the provider');
  } finally {
    await close();
    await mock.close();
  }
});
