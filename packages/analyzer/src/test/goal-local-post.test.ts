import assert from 'node:assert';
import http from 'node:http';
import { test } from 'node:test';
import { postLocalJson } from '../server/localPost.js';

/**
 * A goal run on an agent calls this server's own run-node route. Node's `fetch` refuses the Fetch spec's blocked
 * ports (4190, 6000, 6665-6669, 10080 ...), so an app started on one of them failed every agent goal run.
 */

function listen(handler: http.RequestListener, port: number): Promise<http.Server> {
  const s = http.createServer(handler);
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}
const close = (s: http.Server): Promise<void> => new Promise((r) => { s.close(() => r()); s.closeAllConnections?.(); });

test('fetch refuses a blocked port (the negative control), postLocalJson does not', async () => {
  const s = await listen((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ echo: JSON.parse(b), cookie: req.headers.cookie ?? null }));
    });
  }, 6000);
  try {
    await assert.rejects(fetch('http://127.0.0.1:6000/x'), (e: Error) => /fetch failed|bad port/i.test(e.message + String((e as { cause?: Error }).cause?.message)));
    const out = await postLocalJson(6000, '/x', { cookie: 'a=b' }, { hello: 'world' });
    assert.strictEqual(out.status, 200);
    assert.deepStrictEqual(out.json, { echo: { hello: 'world' }, cookie: 'a=b' });
  } finally {
    await close(s);
  }
});

test('an error body and status come back as they are; an empty body is {}', async () => {
  const s = await listen((_req, res) => {
    res.statusCode = 502;
    res.end();
  }, 0);
  try {
    const port = (s.address() as { port: number }).port;
    const out = await postLocalJson(port, '/x', {}, {});
    assert.strictEqual(out.status, 502);
    assert.deepStrictEqual(out.json, {});
  } finally {
    await close(s);
  }
});

test('an abort rejects as a cancellation, and a closed port names the port', async () => {
  const s = await listen(() => { /* never answers */ }, 0);
  const port = (s.address() as { port: number }).port;
  try {
    const ac = new AbortController();
    const p = postLocalJson(port, '/x', {}, {}, ac.signal);
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(p, /cancelled/);
  } finally {
    await close(s);
  }
  await assert.rejects(postLocalJson(port, '/x', {}, {}), new RegExp(`port ${port}`));
});
