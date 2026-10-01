import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { PLUGIN_MANIFEST_FILE } from '../server/pluginManifest.js';
import { SEQUENCE_DIR } from '../server/store.js';
import type { GetPluginsResponse } from '@sequence/api-types';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-plugins-endpoint-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
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

test('GET /api/plugins: missing file → empty ok list, askWired true', async () => {
  const repo = tmpRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/plugins`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as GetPluginsResponse;
    assert.equal(body.ok, true);
    assert.deepEqual(body.plugins, []);
    assert.equal(body.askWired, true);
    assert.equal(body.path, null);
  } finally {
    await close();
  }
});

test('GET /api/plugins: lists readonly plugins from plugins.json', async () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, SEQUENCE_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(repo, SEQUENCE_DIR, PLUGIN_MANIFEST_FILE),
    JSON.stringify({
      version: 0,
      plugins: [
        {
          id: 'docs-search',
          title: 'Docs search',
          mode: 'readonly',
          tools: [{ name: 'search_docs', description: 'Find a page' }],
        },
      ],
    }),
  );
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/plugins`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as GetPluginsResponse;
    assert.equal(body.ok, true);
    assert.equal(body.askWired, true);
    assert.equal(body.plugins.length, 1);
    assert.equal(body.plugins[0]!.id, 'docs-search');
    assert.equal(body.plugins[0]!.tools[0]!.name, 'search_docs');
  } finally {
    await close();
  }
});

test('GET /api/plugins: invalid manifest → ok false with error (no invented tools)', async () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, SEQUENCE_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(repo, SEQUENCE_DIR, PLUGIN_MANIFEST_FILE),
    JSON.stringify({ version: 0, plugins: [{ id: 'x', mode: 'write', tools: [] }] }),
  );
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/plugins`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as GetPluginsResponse;
    assert.equal(body.ok, false);
    assert.deepEqual(body.plugins, []);
    assert.match(body.error ?? '', /readonly/);
    assert.equal(body.askWired, true);
  } finally {
    await close();
  }
});

test('GET /api/plugins: 4xx when no repo attached', async () => {
  const { base, close } = await startServer(null);
  try {
    const res = await fetch(`${base}/api/plugins`);
    assert.ok(res.status >= 400);
  } finally {
    await close();
  }
});
