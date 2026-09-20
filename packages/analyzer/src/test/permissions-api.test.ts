/**
 * P3 — GET/PUT /api/permissions round-trip.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createRepoServer } from '../server/repoServer.js';
import { permissionsFilePath } from '../server/permissionRules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const SHOPFRONT = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/shopfront');

async function startRepoServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('GET /api/permissions returns empty default when file absent; PUT writes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-perms-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  /* Ensure no leftover permissions from the fixture. */
  const file = permissionsFilePath(repo);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  const { base, close } = await startRepoServer(repo);
  try {
    const get1 = await fetch(`${base}/api/permissions`);
    assert.equal(get1.status, 200);
    const body1 = (await get1.json()) as {
      exists: boolean;
      text: string;
      document: { default: string };
    };
    assert.equal(body1.exists, false);
    assert.equal(body1.document.default, 'allow');

    const text = JSON.stringify(
      {
        version: 1,
        default: 'ask',
        denyStreak: 3,
        deny: ['run_command'],
        ask: [],
        allow: ['read_file'],
      },
      null,
      2,
    );
    const put = await fetch(`${base}/api/permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    assert.equal(put.status, 200);
    const written = (await put.json()) as { document: { default: string; deny: string[] } };
    assert.equal(written.document.default, 'ask');
    assert.deepEqual(written.document.deny, ['run_command']);
    assert.ok(fs.existsSync(file));

    const get2 = await fetch(`${base}/api/permissions`);
    const body2 = (await get2.json()) as { exists: boolean; document: { default: string } };
    assert.equal(body2.exists, true);
    assert.equal(body2.document.default, 'ask');
  } finally {
    await close();
  }
});
