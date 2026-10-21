import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';
import { signSession, SESSION_COOKIE } from '../server/session.js';
import { userBrowseSubdir } from '../server/store.js';

/*
 * APP-14: a folder that does not exist is "no such folder" (404), never "outside
 * your home folder" (403 + allow-folder). 403 is for a REAL, existing path
 * outside every folder the person may open.
 */

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function start(authEnv?: NodeJS.ProcessEnv) {
  const top = tmp('seq-app14-');
  const home = path.join(top, 'home');
  const outside = path.join(top, 'elsewhere', 'project');
  const userDir = path.join(top, 'user');
  fs.mkdirSync(path.join(home, 'inside'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(userDir);
  const authConfig = authEnv ? loadAuthConfig(authEnv) : undefined;
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: home,
    userConfigDir: userDir,
    recentStoreDir: userDir,
    authConfig,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    home,
    outside,
    top,
    authConfig,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

function post(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('APP-14: attach of a missing path inside home answers 404 no-such-folder with the path, and no allow action', async () => {
  const s = await start();
  try {
    const missing = path.join(s.home, 'does-not-exist-xyz');
    const res = await post(s.base, { path: missing });
    assert.strictEqual(res.status, 404);
    const body = (await res.json()) as { code?: string; path?: string; action?: string };
    assert.strictEqual(body.code, 'no-such-folder');
    assert.strictEqual(body.path, missing);
    assert.strictEqual(body.action, undefined, 'no Allow action for a folder that is not there');
  } finally {
    await s.close();
  }
});

test('APP-14: attach of a missing path OUTSIDE home is also 404 no-such-folder (local app)', async () => {
  const s = await start();
  try {
    const missing = path.join(s.outside, 'nope');
    const res = await post(s.base, { path: missing });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(((await res.json()) as { code?: string }).code, 'no-such-folder');
  } finally {
    await s.close();
  }
});

test('APP-14: a REAL path outside home is still 403 with the allow-folder action (negative control)', async () => {
  const s = await start();
  try {
    const res = await post(s.base, { path: s.outside });
    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { action?: string; code?: string };
    assert.strictEqual(body.action, 'allow-folder');
    assert.strictEqual(body.code, undefined);
  } finally {
    await s.close();
  }
});

test('APP-14: browse of a missing path answers 404 no-such-folder; a real outside path stays 403', async () => {
  const s = await start();
  try {
    const missing = await fetch(`${s.base}/api/browse?path=${encodeURIComponent(path.join(s.home, 'ghost'))}`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(((await missing.json()) as { code?: string }).code, 'no-such-folder');
    const outside = await fetch(`${s.base}/api/browse?path=${encodeURIComponent(s.outside)}`);
    assert.strictEqual(outside.status, 403);
  } finally {
    await s.close();
  }
});

test('APP-14: hosted mode answers 404 only for a missing path inside the caller\'s root; elsewhere stays 403 (no probing)', async () => {
  const s = await start({
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    SESSION_SECRET: 'sess-secret-abc',
    PUBLIC_BASE_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv);
  try {
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId: 'google:A', provider: 'google' }, s.authConfig!.sessionSecret))}`;
    const mine = userBrowseSubdir(s.home, 'google:A');
    const inside = await post(s.base, { path: path.join(mine, 'missing') }, { cookie });
    assert.strictEqual(inside.status, 404);
    assert.strictEqual(((await inside.json()) as { code?: string }).code, 'no-such-folder');
    /* Another tree: existing or not, the answer is the same 403, so existence is not probeable. */
    const otherMissing = await post(s.base, { path: path.join(s.top, 'elsewhere', 'missing') }, { cookie });
    const otherReal = await post(s.base, { path: s.outside }, { cookie });
    assert.strictEqual(otherMissing.status, 403);
    assert.strictEqual(otherReal.status, 403);
    assert.deepStrictEqual((await otherMissing.json() as { action?: string }).action, 'allow-folder');
  } finally {
    await s.close();
  }
});
