import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { MCP_FILE } from '../server/mcpClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const FAKE_SERVER = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'mcp', 'fakeServer.cjs');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-mcp-endpoint-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function fakeServerConfig(): { command: string; args: string[]; env: Record<string, string> } {
  return { command: process.execPath, args: [FAKE_SERVER], env: {} };
}

function writeConfig(repoRoot: string, servers: Record<string, unknown>): void {
  fs.mkdirSync(path.join(repoRoot, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.sequence', MCP_FILE),
    JSON.stringify({ servers }, null, 2),
  );
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

test('GET /api/mcp/tools: lists configured server tools (owner path, no key)', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp/tools`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { tools: { server: string; name: string }[]; errors: string[] };
    assert.deepEqual(body.errors, []);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].server, 'fake');
    assert.equal(body.tools[0].name, 'echo');
  } finally {
    await close();
  }
});

test('GET /api/mcp/tools: empty allowlist yields no tools (no repo required)', async () => {
  // No repo attached — env-only config; none set here → empty.
  const { base, close } = await startServer(null);
  try {
    const res = await fetch(`${base}/api/mcp/tools`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { tools: unknown[]; errors: string[] };
    assert.deepEqual(body.tools, []);
  } finally {
    await close();
  }
});

test('POST /api/mcp/call: forwards the tool result', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'fake', tool: 'echo', args: { text: 'via-api' } }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { server: string; tool: string; content: { text: string }[] };
    assert.equal(body.server, 'fake');
    assert.equal(body.tool, 'echo');
    assert.equal(body.content[0].text, 'via-api');
  } finally {
    await close();
  }
});

test('POST /api/mcp/call: 400 for an unknown server (refused, never spawned)', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'not-allowlisted', tool: 'echo' }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.ok(typeof body.error === 'string' && body.error.includes('not-allowlisted'));
  } finally {
    await close();
  }
});

test('POST /api/mcp/call: 400 when "server" or "tool" missing', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'echo' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});

test('GET /api/mcp: missing file → empty servers', async () => {
  const repo = tmpRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      document: { servers: Record<string, unknown> };
      text: string;
    };
    assert.equal(body.exists, false);
    assert.deepEqual(body.document.servers, {});
    assert.match(body.text, /"servers"/);
  } finally {
    await close();
  }
});

test('PUT /api/mcp: writes mcp.json and round-trips on GET', async () => {
  const repo = tmpRepo();
  const { base, close } = await startServer(repo);
  const text = JSON.stringify({ servers: { fake: fakeServerConfig() } }, null, 2) + '\n';
  try {
    const put = await fetch(`${base}/api/mcp`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    assert.strictEqual(put.status, 200);
    const get = await fetch(`${base}/api/mcp`);
    assert.strictEqual(get.status, 200);
    const body = (await get.json()) as { exists: boolean; document: { servers: Record<string, unknown> } };
    assert.equal(body.exists, true);
    assert.ok(body.document.servers.fake);
  } finally {
    await close();
  }
});

test('PUT /api/mcp: 400 on invalid JSON text', async () => {
  const repo = tmpRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/mcp`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'not json' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});
