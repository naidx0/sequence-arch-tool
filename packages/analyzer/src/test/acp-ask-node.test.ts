import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import { parseAgentMap } from '../agentMap.js';
import { AGENT_MAP_HEADER, writeAgentSettings } from '../server/askAgentMap.js';

/**
 * "Ask an agent about this" from a board node (S4): POST /api/acp/run-node
 * with `contextNodeId` runs the agent on a prompt that carries that node's map
 * slice, cut by the SERVER from the graph it holds. The conformant mock ACP
 * agent echoes the prompt it received, so the test reads exactly what reached
 * the agent.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');
const SHOPFRONT = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');

async function start(): Promise<{ port: number; cfg: string; close: () => Promise<void> }> {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-node-cfg-')));
  addAgent(userConfigDir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-node-')));
  fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/(^|[\\/])\.sequence([\\/]|$)/.test(path.relative(SHOPFRONT, p)) });
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return {
    port: typeof addr === 'object' && addr ? addr.port : 0,
    cfg: userConfigDir,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function runNode(port: number, body: unknown): Promise<{ status: number; json: { text?: string; error?: string } }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/acp/run-node', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

test("the node's map slice reaches the agent's prompt, focused on that node", async () => {
  const srv = await start();
  try {
    const r = await runNode(srv.port, { agentRef: 'mock', prompt: 'What depends on this, and what breaks if it changes?', contextNodeId: 'svc:payments', permissionMode: 'propose' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const text = r.json.text ?? '';
    assert.match(text, /You are asked about the service payments \(svc:payments, payments\)/);
    assert.match(text, /Question: What depends on this, and what breaks if it changes\?/);
    /* The slice is the map grammar, parseable, with the node's service first. */
    const start = text.indexOf('# map ');
    const end = text.indexOf('\nomitted: ', start);
    assert.ok(start >= 0 && end > start, text);
    const slice = parseAgentMap(text.slice(start, text.indexOf('\n', end + 1) + 1));
    assert.strictEqual(slice.budget, 1000);
    assert.strictEqual(slice.entries[0].label, 'payments');
    assert.ok(slice.entries[0].edges.some((e) => e.at.startsWith('payments/src/db.js:')), 'cites the node’s own evidence');
  } finally {
    await srv.close();
  }
});

test('without contextNodeId the prompt is passed through untouched; an unknown node is refused', async () => {
  const srv = await start();
  try {
    const plain = await runNode(srv.port, { agentRef: 'mock', prompt: 'hello there' });
    assert.strictEqual(plain.status, 200);
    assert.doesNotMatch(plain.json.text ?? '', /# map /);
    assert.match(plain.json.text ?? '', /hello there/);
    const bad = await runNode(srv.port, { agentRef: 'mock', prompt: 'x', contextNodeId: 'svc:nope' });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error ?? '', /svc:nope/);
  } finally {
    await srv.close();
  }
});

/* The map to agents is OFF by default, so the tests above see no whole-map block. With it on, a node ask carries the node slice and not the whole map on top, and a reused chat-less session is told the map once. */
test('with the map sent to agents, a node ask carries the node slice and not the whole map; a reused session is told once', async () => {
  const srv = await start();
  try {
    writeAgentSettings(srv.cfg, { mapToAgents: true });
    const a = await runNode(srv.port, { agentRef: 'mock', prompt: 'what breaks?', contextNodeId: 'svc:payments', sessionKey: 'ask-node::svc:payments::mock' });
    const text = a.json.text ?? '';
    assert.strictEqual(text.split(AGENT_MAP_HEADER).length - 1, 0, 'no whole map on top of the slice');
    assert.strictEqual(text.split('# map ').length - 1, 1, 'the slice, once');
    const counts: number[] = [];
    for (const q of ['q1', 'q2', 'q3']) {
      const r = await runNode(srv.port, { agentRef: 'mock', prompt: q, sessionKey: 'ask-plain::mock' });
      counts.push((r.json.text ?? '').split(AGENT_MAP_HEADER).length - 1);
    }
    assert.deepStrictEqual(counts, [1, 0, 0], 'the same provider session is told the map once');
  } finally {
    await srv.close();
  }
});
