import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { PROGRAM_RUN_LOG_HEADER } from '@sequence/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-program-api-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
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

test('/api/program/strategy: 404 when program.md absent', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/program/strategy`);
    assert.strictEqual(res.status, 404);
  } finally {
    await close();
  }
});

test('/api/program/strategy: returns markdown when present', async () => {
  const repo = plainappRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'program.md'), '# Loop\nNever ask the human to continue.\n', 'utf8');
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/program/strategy`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { content: string };
    assert.match(body.content, /Never ask the human/);
  } finally {
    await close();
  }
});

test('/api/program/strategy: includes editAllowlist when declared', async () => {
  const repo = plainappRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'program.md'),
    '# Loop\n\n## Agent may edit\n\nsrc/**\n',
    'utf8',
  );
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/program/strategy`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { editAllowlist?: string[] };
    assert.deepStrictEqual(body.editAllowlist, ['src/**']);
  } finally {
    await close();
  }
});

test('PUT /api/file: rejects path outside program.md edit allowlist', async () => {
  const repo = plainappRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'program.md'),
    '## Agent may edit\n\nallowed/**\n',
    'utf8',
  );
  fs.mkdirSync(path.join(repo, 'allowed'), { recursive: true });
  const { base, close } = await startServer(repo);
  try {
    const okRes = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'allowed/ok.ts', content: 'ok' }),
    });
    assert.strictEqual(okRes.status, 200);

    const badRes = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'blocked/nope.ts', content: 'nope' }),
    });
    assert.strictEqual(badRes.status, 403);
    const badBody = (await badRes.json()) as { error?: string };
    assert.match(badBody.error ?? '', /Agent may edit allowlist/i);
  } finally {
    await close();
  }
});

test('/api/program/run-log: appends TSV row', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/program/run-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'r1',
        programId: 'dogfood-loop',
        metric: 'checker:yes',
        status: 'keep',
        description: 'completed',
      }),
    });
    assert.strictEqual(res.status, 200);
    const p = path.join(repo, '.sequence', 'runs', 'results.tsv');
    const body = fs.readFileSync(p, 'utf8');
    assert.ok(body.startsWith(PROGRAM_RUN_LOG_HEADER));
    assert.match(body, /r1\tdogfood-loop\tchecker:yes\tkeep/);

    const getRes = await fetch(`${base}/api/program/run-log`);
    assert.strictEqual(getRes.status, 200);
    const getBody = (await getRes.json()) as { rows?: { runId: string }[] };
    assert.ok(Array.isArray(getBody.rows));
    assert.strictEqual(getBody.rows?.[0]?.runId, 'r1');
  } finally {
    await close();
  }
});
