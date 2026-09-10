import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

/**
 * Jail lock for PUT /api/file (v8 Phase B1) — the board's editable file view save
 * surface. It is a NEW write path, so it must go through the exact same jail +
 * reserved-dir + traversal/symlink protections as the model write path. Mirrors
 * the style of ai-server.test.ts / jail.test.ts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

const TEST_KEY = 'sk-ant-test-FILEWRITE-SECRET-42';

/** A throwaway copy of the plainapp fixture — writes never touch the fixture. */
function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-filewrite-'));
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

function putFile(base: string, p: string, content: string): Promise<Response> {
  return fetch(`${base}/api/file`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  });
}

test('PUT /api/file: a normal in-repo file writes and reads back', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await putFile(base, path.join('frontend', 'index.tsx'), 'export const x = 1;\n');
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; path: string };
    assert.strictEqual(body.ok, true);
    // On disk.
    assert.strictEqual(fs.readFileSync(path.join(repo, 'frontend', 'index.tsx'), 'utf8'), 'export const x = 1;\n');
    // Round-trips through GET /api/file.
    const got = await fetch(`${base}/api/file?path=${encodeURIComponent('frontend/index.tsx')}`);
    assert.strictEqual(got.status, 200);
    assert.strictEqual(await got.text(), 'export const x = 1;\n');

    // A brand-new nested file is created too.
    const res2 = await putFile(base, path.join('frontend', 'sub', 'new.ts'), 'ok\n');
    assert.strictEqual(res2.status, 200);
    assert.ok(fs.existsSync(path.join(repo, 'frontend', 'sub', 'new.ts')));
  } finally {
    await close();
  }
});

test('PUT /api/file: a reserved path (.sequence/ai.json) is refused; ai.json untouched', async () => {
  const repo = plainappRepo();
  // Seed a real .sequence/ai.json with the key.
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  const aiPath = path.join(repo, '.sequence', 'ai.json');
  fs.writeFileSync(aiPath, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: TEST_KEY }));
  const before = fs.readFileSync(aiPath, 'utf8');
  const { base, close } = await startServer(repo);
  try {
    const res = await putFile(base, path.join('.sequence', 'ai.json'), '{"apiKey":"stolen"}');
    assert.strictEqual(res.status, 403, 'a reserved-dir write must be refused');
    const after = fs.readFileSync(aiPath, 'utf8');
    assert.strictEqual(after, before, '.sequence/ai.json must be byte-for-byte unchanged');
    assert.ok(after.includes(TEST_KEY) && !after.includes('stolen'));

    // .git is refused too.
    const gitRes = await putFile(base, path.join('.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
    assert.strictEqual(gitRes.status, 403);
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')));
  } finally {
    await close();
  }
});

test('PUT /api/file: a traversal path (../outside) is refused; nothing escapes', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await putFile(base, path.join('..', 'escape.txt'), 'pwned');
    assert.strictEqual(res.status, 403);
    assert.ok(!fs.existsSync(path.join(repo, '..', 'escape.txt')), 'no parent-dir escape');
    // An absolute path is refused too.
    const absRes = await putFile(base, '/tmp/sequence-filewrite-abs.txt', 'pwned');
    assert.strictEqual(absRes.status, 403);
    assert.ok(!fs.existsSync('/tmp/sequence-filewrite-abs.txt'));
  } finally {
    await close();
  }
});

test('PUT /api/file: a symlink-escape is refused; nothing written outside', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-filewrite-sym-'));
  const repo = path.join(dir, 'repo');
  const outside = path.join(dir, 'outside');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(repo, 'link')); // repo/link -> /outside
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // symlinks not permitted here
    throw e;
  }
  const { base, close } = await startServer(repo);
  try {
    const res = await putFile(base, path.join('link', 'pwned.txt'), 'pwned');
    assert.strictEqual(res.status, 403, 'a new file through an escaping symlink dir must be refused');
    assert.ok(!fs.existsSync(path.join(outside, 'pwned.txt')), 'nothing written outside the repo');
  } finally {
    await close();
  }
});

test('PUT /api/file: allows .sequence/diagrams/*.seqd for export auto-write; other .sequence paths refused', async () => {
  const repo = plainappRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  const aiPath = path.join(repo, '.sequence', 'ai.json');
  fs.writeFileSync(aiPath, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: TEST_KEY }));
  const before = fs.readFileSync(aiPath, 'utf8');
  const { base, close } = await startServer(repo);
  try {
    const seqd = '.sequence/diagrams/foo.seqd';
    const body = '{"version":1,"title":"foo","participants":[],"messages":[]}\n';
    const ok = await putFile(base, seqd, body);
    assert.strictEqual(ok.status, 200, 'diagram export path must be writable');
    assert.strictEqual(fs.readFileSync(path.join(repo, seqd), 'utf8'), body);

    const secrets = await putFile(base, '.sequence/secrets.json', '{"token":"x"}');
    assert.strictEqual(secrets.status, 403, 'arbitrary .sequence/ writes must stay refused');
    assert.ok(!fs.existsSync(path.join(repo, '.sequence', 'secrets.json')));

    const madr = '.sequence/decisions/api-service.md';
    const r1 = await putFile(base, madr, '# api\n\n## Context\n');
    assert.strictEqual(r1.status, 200, 'decision records must still be writable');

    const plan = '.sequence/plans/checkout-flow.md';
    const planBody = '# Checkout flow\n\n## Steps\n1. Cart\n';
    const planPut = await putFile(base, plan, planBody);
    assert.strictEqual(planPut.status, 200, 'plan markdown must be writable under .sequence/plans/');
    assert.strictEqual(fs.readFileSync(path.join(repo, plan), 'utf8'), planBody);

    const reserved = await putFile(base, '.sequence/ai.json', '{"apiKey":"stolen"}');
    assert.strictEqual(reserved.status, 403);
    assert.strictEqual(fs.readFileSync(aiPath, 'utf8'), before);
  } finally {
    await close();
  }
});

test('PUT /api/file: multi-write decision pack (MADR + notes) — jail still holds', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const madr = '.sequence/decisions/api-service.md';
    const notes = '.sequence/decisions/api-service-notes.md';
    const r1 = await putFile(base, madr, '# api\n\n## Context\n');
    const r2 = await putFile(base, notes, '# Notes — api\n');
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'decisions', 'api-service.md')));
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'decisions', 'api-service-notes.md')));

    // Jail: traversal in the same batch shape is still refused.
    const evil = await putFile(base, '../outside-pwned.md', 'nope');
    assert.strictEqual(evil.status, 403);
    assert.ok(!fs.existsSync(path.join(path.dirname(repo), 'outside-pwned.md')));

    // Reserved .sequence/ai.json refused even when mixed with a legal path.
    fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
    const aiPath = path.join(repo, '.sequence', 'ai.json');
    fs.writeFileSync(aiPath, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: TEST_KEY }));
    const before = fs.readFileSync(aiPath, 'utf8');
    const reserved = await putFile(base, '.sequence/ai.json', '{"apiKey":"stolen"}');
    assert.strictEqual(reserved.status, 403);
    assert.strictEqual(fs.readFileSync(aiPath, 'utf8'), before);
  } finally {
    await close();
  }
});

test('PUT /api/file: 409 when no repo is attached; 415 on wrong content-type', async () => {
  const { base, close } = await startServer(null);
  try {
    const res = await putFile(base, 'a.txt', 'x');
    assert.strictEqual(res.status, 409, 'no repo attached ⇒ 409');
  } finally {
    await close();
  }

  const repo = plainappRepo();
  const s = await startServer(repo);
  try {
    const badCt = await fetch(`${s.base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ path: 'a.txt', content: 'x' }),
    });
    assert.strictEqual(badCt.status, 415);
    // Missing content ⇒ 400.
    const noContent = await fetch(`${s.base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'a.txt' }),
    });
    assert.strictEqual(noContent.status, 400);
  } finally {
    await s.close();
  }
});
