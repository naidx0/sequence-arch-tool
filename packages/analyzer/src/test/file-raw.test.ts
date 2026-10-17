import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig, type AuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { userBrowseSubdir } from '../server/store.js';

/**
 * GET /api/file?path=…&raw=1 — AN IMAGE AS ITS OWN BYTES (round 7, B8).
 *
 * Jaden: "opening things and HTMLs, they show just the code". The Files
 * surface previews images, and `/api/file` read every file as UTF-8 text, so a
 * PNG arrived mangled. `raw=1` answers a RASTER IMAGE on an allowlist with its
 * bytes and its image type, and nothing else changes:
 *   - any other file (SVG included) keeps the text/plain answer;
 *   - the jail and the reserved-dir refusal still run first (403);
 *   - the size cap still applies (413);
 *   - the loopback/origin gate and the owner gate are the route's own (403/401).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

/** A real 1x1 PNG (67 bytes), including bytes that are not valid UTF-8. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d6fa6b0000000049454e44ae426082',
  'hex',
);

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function start(repo: string | null, opts: { authConfig?: AuthConfig; browseRoot?: string; recentStoreDir?: string } = {}) {
  const server = await createRepoServer(repo, {
    webDist: undefined,
    browseRoot: opts.browseRoot,
    recentStoreDir: opts.recentStoreDir,
    authConfig: opts.authConfig,
    resolveIdentity: opts.authConfig
      ? (req: http.IncomingMessage) => verifySession(req.headers.cookie, opts.authConfig!.sessionSecret)?.userId
      : undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function project(): string {
  const dir = tempDir('seq-raw-');
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'logo.png'), PNG);
  fs.writeFileSync(path.join(repo, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'secret.png'), PNG);
  /* Over the 1 MB cap, and a PNG by name. */
  fs.writeFileSync(path.join(repo, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(1_000_001)]));
  return repo;
}

test('raw=1 answers a PNG with its exact bytes and its image type', async () => {
  const repo = project();
  const srv = await start(repo);
  try {
    const r = await fetch(`${srv.base}/api/file?path=logo.png&raw=1`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'image/png');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG), 'the bytes on disk, unmangled');
    /* The negative control: without raw=1 the same file is still the text answer (mangled). */
    const text = await fetch(`${srv.base}/api/file?path=logo.png`);
    assert.match(text.headers.get('content-type') ?? '', /^text\/plain/);
    assert.ok(!Buffer.from(await text.arrayBuffer()).equals(PNG));
  } finally {
    await srv.close();
  }
});

test('raw=1 on anything that is not a raster image keeps the text answer (source, and SVG)', async () => {
  const repo = project();
  const srv = await start(repo);
  try {
    const src = fs.readdirSync(repo).find((f) => /\.(ts|js|json|md|ya?ml)$/.test(f))!;
    for (const rel of [src, 'icon.svg']) {
      const r = await fetch(`${srv.base}/api/file?path=${encodeURIComponent(rel)}&raw=1`);
      assert.strictEqual(r.status, 200, rel);
      assert.match(r.headers.get('content-type') ?? '', /^text\/plain/, `${rel} stays text/plain`);
      assert.strictEqual(await r.text(), fs.readFileSync(path.join(repo, rel), 'utf8'));
    }
  } finally {
    await srv.close();
  }
});

test('raw=1 is behind the same refusals: reserved dir 403, the size cap 413', async () => {
  const repo = project();
  const srv = await start(repo);
  try {
    const reserved = await fetch(`${srv.base}/api/file?path=.sequence/secret.png&raw=1`);
    assert.strictEqual(reserved.status, 403);
    const huge = await fetch(`${srv.base}/api/file?path=huge.png&raw=1`);
    assert.strictEqual(huge.status, 413);
    const escape = await fetch(`${srv.base}/api/file?path=${encodeURIComponent('../outside.png')}&raw=1`);
    assert.strictEqual(escape.status, 403);
  } finally {
    await srv.close();
  }
});

test('raw=1 is behind the loopback gate: a forged Host is refused as without it', async () => {
  const repo = project();
  const srv = await start(repo);
  const get = (p: string, host: string) =>
    new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, headers: { Host: host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', () => resolve(0));
      req.end();
    });
  try {
    assert.strictEqual(await get('/api/file?path=logo.png&raw=1', `127.0.0.1:${srv.port}`), 200);
    assert.strictEqual(await get('/api/file?path=logo.png&raw=1', 'evil.example'), 403);
    assert.strictEqual(await get('/api/file?path=logo.png', 'evil.example'), 403);
  } finally {
    await srv.close();
  }
});

test('raw=1 is behind the owner gate: anonymous 401, another user 403, the owner 200', async () => {
  const authConfig = loadAuthConfig({
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    SESSION_SECRET: 'sess-secret-raw',
    PUBLIC_BASE_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv);
  const browseRoot = tempDir('seq-raw-browse-');
  const recentStoreDir = tempDir('seq-raw-recent-');
  const cookie = (id: string) => `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId: id, provider: 'google' }, authConfig.sessionSecret))}`;
  const aJail = userBrowseSubdir(browseRoot, 'google:AAA');
  fs.mkdirSync(aJail, { recursive: true });
  const aProject = path.join(aJail, 'projectA');
  fs.cpSync(TICKETING, aProject, { recursive: true });
  fs.writeFileSync(path.join(aProject, 'logo.png'), PNG);
  const srv = await start(null, { authConfig, browseRoot, recentStoreDir });
  try {
    const attach = await fetch(`${srv.base}/api/attach`, {
      method: 'POST',
      headers: { cookie: cookie('google:AAA'), 'content-type': 'application/json' },
      body: JSON.stringify({ path: aProject }),
    });
    assert.strictEqual(attach.status, 200);
    const url = `${srv.base}/api/file?path=logo.png&raw=1`;
    assert.strictEqual((await fetch(url)).status, 401, 'anonymous');
    assert.strictEqual((await fetch(url, { headers: { cookie: cookie('google:BBB') } })).status, 403, 'another user');
    const owner = await fetch(url, { headers: { cookie: cookie('google:AAA') } });
    assert.strictEqual(owner.status, 200, 'the owner');
    assert.ok(Buffer.from(await owner.arrayBuffer()).equals(PNG));
  } finally {
    await srv.close();
    for (const d of [browseRoot, recentStoreDir]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
