/**
 * GET /api/export (claim V35: export from the app). The renderers are the ones `sequence export` runs, so
 * for each format the response content equals the command's stdout byte for byte on the same graph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';
import { verifySession } from '../server/session.js';
import { scanRepo } from '../scan.js';
import { API_EXPORT_FORMATS, exportFilename } from '../server/exportFormats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
const CLI = path.resolve(here, '..', 'cli.js');

const tmp = (p: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

async function start(repo: string | null, extra: Record<string, unknown> = {}) {
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: tmp('export-route-store-'), ...extra });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    base,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function shopCopy(): string {
  const dir = tmp('export-route-repo-');
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/(^|[\/])\.sequence([\/]|$)/.test(path.relative(SHOPFRONT, p)) });
  return dir;
}

test('each format equals `sequence export` on the same graph, byte for byte, with the documented shape', async () => {
  const repo = shopCopy();
  const s = await start(repo);
  try {
    const graphFile = path.join(tmp('export-route-graph-'), 'g.json');
    fs.writeFileSync(graphFile, Buffer.from(await (await fetch(`${s.base}/archgraph.json`)).arrayBuffer()));
    const g = JSON.parse(fs.readFileSync(graphFile, 'utf8')) as { repoName: string };
    const expected: Record<string, { mime: string; ext: string }> = {
      'mermaid-flow': { mime: 'text/plain', ext: '.mmd' },
      'matrix-csv': { mime: 'text/csv', ext: '.csv' },
      'arch-md': { mime: 'text/markdown', ext: '.md' },
    };
    assert.deepEqual([...API_EXPORT_FORMATS].sort(), Object.keys(expected).sort());
    for (const [format, want] of Object.entries(expected)) {
      const r = await fetch(`${s.base}/api/export?format=${format}`);
      assert.equal(r.status, 200, format);
      const body = (await r.json()) as { format: string; filename: string; mime: string; content: string };
      assert.deepEqual(Object.keys(body).sort(), ['content', 'filename', 'format', 'mime']);
      assert.equal(body.format, format);
      assert.equal(body.mime, want.mime);
      assert.equal(body.filename, exportFilename(g.repoName, format));
      assert.ok(body.filename.endsWith(`-architecture${want.ext}`), body.filename);
      const cli = spawnSync(process.execPath, [CLI, 'export', graphFile, '--format', format], { encoding: 'buffer', timeout: 60_000 });
      assert.equal(cli.status, 0, format);
      assert.ok(body.content.length > 0, format);
      assert.equal(Buffer.from(body.content, 'utf8').compare(cli.stdout), 0, `${format}: same bytes as the command`);
    }
  } finally {
    await s.close();
  }
});

test('an unknown or missing format is a 400 that lists the allowed ones', async () => {
  const s = await start(shopCopy());
  try {
    for (const q of ['format=nope', 'format=mermaid-seq', '']) {
      const r = await fetch(`${s.base}/api/export?${q}`);
      assert.equal(r.status, 400, q);
      const { error } = (await r.json()) as { error: string };
      assert.ok(error.includes('mermaid-flow, matrix-csv, arch-md'), error);
    }
  } finally {
    await s.close();
  }
});

test('no scan yet is a 409', async () => {
  const s = await start(null);
  try {
    assert.equal((await fetch(`${s.base}/api/export?format=arch-md`)).status, 409);
  } finally {
    await s.close();
  }
});

test('under auth an anonymous request is 401 (the route is in the session-gated set)', async () => {
  const authConfig = loadAuthConfig({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'sess-secret-abc', PUBLIC_BASE_URL: 'https://app.example.com' } as NodeJS.ProcessEnv);
  const s = await start(null, {
    authConfig,
    resolveIdentity: (req: http.IncomingMessage) => verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId,
  });
  try {
    const r = await fetch(`${s.base}/api/export?format=arch-md`);
    assert.equal(r.status, 401);
  } finally {
    await s.close();
  }
});

test('exportFilename keeps the repo name safe and falls back when nothing is left', () => {
  assert.equal(exportFilename('shop front/../x', 'matrix-csv'), 'shop-front-..-x-architecture.csv');
  assert.equal(exportFilename('///', 'arch-md'), 'repo-architecture.md');
});
