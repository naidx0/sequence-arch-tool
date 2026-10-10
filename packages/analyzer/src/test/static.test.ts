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
