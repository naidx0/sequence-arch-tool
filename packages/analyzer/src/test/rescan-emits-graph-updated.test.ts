import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';

/* 019-rescan-ui: a completed POST /api/scan tells every open page (the git events stream) to re-read the graph. */

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function post(port: number, urlPath: string, accept?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2, ...(accept ? { accept } : {}) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    r.on('error', reject);
    r.end('{}');
  });
}

async function withServer(run: (port: number, events: Array<{ event: string; data: Record<string, unknown> }>) => Promise<void>): Promise<void> {
  const root = tmp('seq-rescan-evt-');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  const store = tmp('seq-store-');
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store, recentStoreDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  let attached = false;
  const poll = setInterval(() => {
    http.get({ host: '127.0.0.1', port, path: '/archgraph.json' }, (res) => {
      if (res.statusCode === 200) attached = true;
      res.resume();
    }).on('error', () => undefined);
  }, 50);
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const sse = http.get({ host: '127.0.0.1', port, path: '/api/git/events', headers: { accept: 'text/event-stream' } });
  let buf = '';
  await new Promise<void>((resolve, reject) => {
    sse.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
        }
      });
      resolve();
    });
    sse.on('error', reject);
  });
  try {
    await waitFor(() => attached, 'the startup attach');
    await run(port, events);
  } finally {
    clearInterval(poll);
    sse.destroy();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
}

async function waitFor(cond: () => boolean, what: string, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('POST /api/scan (JSON) emits graph:updated to an events subscriber', async () => {
  await withServer(async (port, events) => {
    assert.equal(await post(port, '/api/scan'), 200);
    await waitFor(() => events.some((e) => e.event === 'graph:updated'), 'graph:updated after the JSON scan');
    assert.equal(events.find((e) => e.event === 'graph:updated')!.data.reason, 'rescan');
  });
});

test('POST /api/scan (event stream) emits graph:updated to an events subscriber', async () => {
  await withServer(async (port, events) => {
    assert.equal(await post(port, '/api/scan', 'text/event-stream'), 200);
    await waitFor(() => events.some((e) => e.event === 'graph:updated'), 'graph:updated after the streamed scan');
  });
});
