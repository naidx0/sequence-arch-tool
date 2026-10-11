import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMcpConfig,
  listMcpTools,
  callMcpTool,
  parseMcpConfigDocument,
  serializeMcpConfig,
  loadMcpConfigFromFile,
  writeMcpConfigDocument,
  UnknownMcpServerError,
  McpTransportError,
  MCP_FILE,
  MCP_ENV,
} from '../server/mcpClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const FAKE_SERVER = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'mcp', 'fakeServer.cjs');

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-mcp-'));
}

/** A config that spawns the fake stdio server via `node <fakeServer.js>`. */
function fakeServerConfig(extraEnv: Record<string, string> = {}): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { command: process.execPath, args: [FAKE_SERVER], env: extraEnv };
}

function writeConfig(repoRoot: string, servers: Record<string, unknown>): void {
  fs.mkdirSync(path.join(repoRoot, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.sequence', MCP_FILE),
    JSON.stringify({ servers }, null, 2),
  );
}

test('loadMcpConfig: empty allowlist when nothing configured (no throw)', () => {
  const repo = tmpRepo();
  const cfg = loadMcpConfig(repo);
  assert.deepEqual(cfg.servers, {});
});

test('loadMcpConfig: reads .sequence/mcp.json servers', () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig({ FAKE_MCP_DESC: 'desc-from-file' }) });
  const cfg = loadMcpConfig(repo);
  assert.equal(Object.keys(cfg.servers).length, 1);
  assert.equal(cfg.servers.fake.command, process.execPath);
});

test('loadMcpConfig: env supplements, file overrides per server name', () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig({ FAKE_MCP_DESC: 'from-file' }) });
  const prev = process.env[MCP_ENV];
  process.env[MCP_ENV] = JSON.stringify({
    servers: { envOnly: fakeServerConfig(), fake: { command: 'should-be-overwritten' } },
  });
  try {
    const cfg = loadMcpConfig(repo);
    assert.ok(cfg.servers.envOnly, 'env-only server present');
    assert.equal(cfg.servers.fake.command, process.execPath, 'file wins over env for shared name');
  } finally {
    if (prev === undefined) delete process.env[MCP_ENV];
    else process.env[MCP_ENV] = prev;
  }
});

test('listMcpTools: lists tools from a configured server (handshake + tools/list)', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig({ FAKE_MCP_DESC: 'Echo the text back' }) });
  const result = await listMcpTools(repo);
  assert.deepEqual(result.errors, []);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].server, 'fake');
  assert.equal(result.tools[0].name, 'echo');
  assert.equal(result.tools[0].description, 'Echo the text back');
});

test('callMcpTool: forwards the tool result verbatim', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const result = await callMcpTool(repo, 'fake', 'echo', { text: 'hello-sequence' });
  assert.equal(result.server, 'fake');
  assert.equal(result.tool, 'echo');
  assert.deepEqual(result.content, [{ type: 'text', text: 'hello-sequence' }]);
  assert.notEqual(result.isError, true);
});

test('callMcpTool: forwards isError when the server flags it', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  const result = await callMcpTool(repo, 'fake', 'boom', {});
  assert.equal(result.isError, true);
});

test('callMcpTool: refuses an unknown server (never spawned)', async () => {
  const repo = tmpRepo();
  writeConfig(repo, { fake: fakeServerConfig() });
  await assert.rejects(
    () => callMcpTool(repo, 'not-allowlisted', 'echo', {}),
    (e: Error) => e instanceof UnknownMcpServerError,
  );
});

test('listMcpTools: a misconfigured server is reported in errors, others still list', async () => {
  const repo = tmpRepo();
  writeConfig(repo, {
    broken: { command: 'this-command-does-not-exist-xyz', args: [] },
    fake: fakeServerConfig(),
  });
  const result = await listMcpTools(repo);
  assert.ok(result.errors.length >= 1, 'broken server reported');
  assert.ok(result.errors.some((e) => e.startsWith('broken:')), 'broken named in errors');
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].server, 'fake');
});

test('parseMcpConfigDocument: accepts valid servers', () => {
  const raw = JSON.stringify({ servers: { fake: fakeServerConfig() } });
  const { config, warnings } = parseMcpConfigDocument(raw, 'mcp.json');
  assert.deepEqual(warnings, []);
  assert.equal(Object.keys(config.servers).length, 1);
});

test('parseMcpConfigDocument: invalid JSON is fatal warning', () => {
  const { warnings } = parseMcpConfigDocument('not json', 'mcp.json');
  assert.ok(warnings.some((w) => /not valid JSON/i.test(w)));
});

test('writeMcpConfigDocument round-trips via loadMcpConfigFromFile', () => {
  const repo = tmpRepo();
  writeMcpConfigDocument(repo, { servers: { fake: fakeServerConfig() } });
  const loaded = loadMcpConfigFromFile(repo);
  assert.equal(loaded.exists, true);
  assert.equal(Object.keys(loaded.config.servers).length, 1);
  assert.equal(serializeMcpConfig(loaded.config).trim(), serializeMcpConfig({ servers: { fake: fakeServerConfig() } }).trim());
});
