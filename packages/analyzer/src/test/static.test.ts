import assert from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveStatic } from '../server/static.js';

test('serveStatic: serves index.html bytes unmodified', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-static-'));
  const html = '<!doctype html><html><head><title>home</title></head><body><div id="root"></div></body></html>';
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    serveStatic(dist, pathname, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, html);
    assert.ok(!body.includes('__SEQUENCE_LEGACY_SHELL__'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('the app HTML (and only it) carries frame-src self, so a sandboxed page cannot navigate its frame away', async () => {
  const { APP_FRAME_POLICY } = await import('../server/static.js');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-static-csp-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(dist, 'a.js'), 'x');
  const server = http.createServer((req, res) => serveStatic(dist, new URL(req.url ?? '/', 'http://localhost').pathname, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    assert.strictEqual(APP_FRAME_POLICY, "frame-src 'self'");
    assert.strictEqual((await fetch(`${base}/`)).headers.get('content-security-policy'), APP_FRAME_POLICY);
    assert.strictEqual((await fetch(`${base}/some/spa/route`)).headers.get('content-security-policy'), APP_FRAME_POLICY, 'the SPA fallback is html too');
    assert.strictEqual((await fetch(`${base}/a.js`)).headers.get('content-security-policy'), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('a workspace switch reload does not fetch the app again: hashed assets are immutable, the html and the fallback are revalidated', async () => {
  /* 0.1.5 review: opening a chat in another workspace reloads the page, and nothing the server sent could be cached,
     so every switch downloaded and compiled the whole app again (1 MB of script, 0.6 MB of css). Vite names every
     file under assets/ by its content hash, so a changed file is a new URL. */
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-static-cache-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'index-DfI2GoPB.js'), 'x');
  fs.writeFileSync(path.join(dist, 'assets', 'index-nYTZEteI.css'), 'x');
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
  const server = http.createServer((req, res) => serveStatic(dist, new URL(req.url ?? '/', 'http://localhost').pathname, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const cache = async (p: string) => (await fetch(`${base}${p}`)).headers.get('cache-control');
  try {
    assert.strictEqual(await cache('/assets/index-DfI2GoPB.js'), 'public, max-age=31536000, immutable');
    assert.strictEqual(await cache('/assets/index-nYTZEteI.css'), 'public, max-age=31536000, immutable');
    /* The page itself is asked again every time, so a new build is picked up at once. */
    assert.strictEqual(await cache('/'), 'no-cache');
    assert.strictEqual(await cache('/some/spa/route'), 'no-cache');
    /* A missing asset falls back to the html, which must never be cached under the asset's name. */
    assert.strictEqual(await cache('/assets/gone-0000.js'), 'no-cache');
    /* A file outside assets/ has no hash in its name: revalidated, not pinned. */
    assert.strictEqual(await cache('/favicon.svg'), 'no-cache');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
