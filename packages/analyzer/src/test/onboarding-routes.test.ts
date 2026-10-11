import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';

/**
 * Lock for the /api/onboarding/* routes: local-only (same gate as /api/acp/*),
 * and /repos walks the server's browse root, never anything outside it. The
 * browse root is a fixture this test builds; the providers route is only
 * exercised on its refusal paths, so no real CLI on the machine is spawned.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeRepo(root: string, rel: string): string {
  const dir = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

async function start(browseRoot: string, store: string, hosted = false): Promise<{ port: number; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot,
    recentStoreDir: store,
    userConfigDir: store,
    ...(hosted
      ? {
          authConfig: loadAuthConfig({
            GOOGLE_CLIENT_ID: 'g-id',
            GOOGLE_CLIENT_SECRET: 'g-secret',
            SESSION_SECRET: 'sess-secret-abc',
            PUBLIC_BASE_URL: 'https://app.example.com',
          } as NodeJS.ProcessEnv),
        }
      : {}),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function get(port: number, p: string, host?: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p, headers: { host: host ?? `127.0.0.1:${port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = text;
        try {
          json = JSON.parse(text);
        } catch {
          /* keep text */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/onboarding/repos (local) lists the browse root repos, recent first', async () => {
  const outside = tempDir('seq-onb-outside-');
  makeRepo(outside, 'not-mine');
  const root = tempDir('seq-onb-home-');
  makeRepo(root, 'alpha');
  const beta = makeRepo(root, 'work/beta');
  const store = tempDir('seq-onb-store-');
  fs.writeFileSync(path.join(store, 'recent.json'), JSON.stringify([beta, path.join(outside, 'not-mine')]));
  const srv = await start(root, store);
  try {
    const r = await get(srv.port, '/api/onboarding/repos');
    assert.strictEqual(r.status, 200);
    const body = r.json as { repos: { path: string; name: string; recent: boolean; lastActive: number | null }[]; truncated: boolean; ms: number };
    assert.deepStrictEqual(body.repos.map((x) => [x.name, x.recent]), [
      ['beta', true],
      ['alpha', false],
    ]);
    assert.strictEqual(body.truncated, false);
    assert.strictEqual(typeof body.ms, 'number');
    assert.ok(!JSON.stringify(body).includes('not-mine'), 'a recent entry outside the browse root is jailed out');
  } finally {
    await srv.close();
  }
});

test('NEGATIVE: a non-local caller gets 403 on both onboarding routes', async () => {
  const root = tempDir('seq-onb-home-');
  makeRepo(root, 'alpha');
  const srv = await start(root, tempDir('seq-onb-store-'));
  try {
    for (const p of ['/api/onboarding/repos', '/api/onboarding/providers']) {
      const r = await get(srv.port, p, 'evil.example');
      assert.strictEqual(r.status, 403, p);
      assert.ok(!JSON.stringify(r.json).includes('alpha'));
    }
  } finally {
    await srv.close();
  }
});

test('NEGATIVE: hosted (auth-on) mode refuses both onboarding routes', async () => {
  const root = tempDir('seq-onb-home-');
  const srv = await start(root, tempDir('seq-onb-store-'), true);
  try {
    for (const p of ['/api/onboarding/repos', '/api/onboarding/providers']) {
      const r = await get(srv.port, p);
      assert.ok(r.status === 401 || r.status === 403, `${p} -> ${r.status}`);
    }
  } finally {
    await srv.close();
  }
});
