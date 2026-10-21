import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { agentSpecimen, sseGolden } from './support/agentServer.js';

/**
 * ROUND 7, A2: "ACP agent failed. ACP connection closed... Retry doesn't
 * work... It fails loud." An ACP agent that dies while starting now reaches
 * the stream with its exit code and its own last stderr lines, classified
 * retry; the next turn on the same chat (Retry) starts a fresh process and
 * answers. The agent is real: first a node process that prints a reason and
 * exits 3, then the conformant mock ACP agent.
 *
 * Both streams are kept for web2 under fixtures/replay/sse-r7/.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');
const DIES = `process.stderr.write('Error: Cannot find module @anthropic-ai/claude-agent-sdk\\n'); process.exit(3)`;

type Json = Record<string, unknown>;

async function stream(base: string, body: Json): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as Json);
}

test('an agent that exits while starting says why in the stream, and Retry starts it cleanly', async () => {
  const s = agentSpecimen({ id: 'claude', command: process.execPath });
  let spawned = 0;
  const spawn = ((cmd: string, args: readonly string[], opts: childProcess.SpawnOptions) => {
    spawned++;
    return spawned === 1 ? childProcess.spawn(process.execPath, ['-e', DIES], opts) : childProcess.spawn(process.execPath, [MOCK_AGENT], opts);
  }) as unknown as typeof childProcess.spawn;
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: s.store, acpTurn: { spawn, killGraceMs: 200 } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const body = { agentRef: 'claude', prompt: 'hello', permissionMode: 'propose', sessionKey: `chat::${s.chatId}::claude`, chatId: s.chatId };
  try {
    const first = await stream(base, body);
    const err = first.find((e) => e.type === 'acp:error');
    assert.ok(err, `no acp:error in ${JSON.stringify(first)}`);
    assert.match(String(err.error), /exited \(code 3\)/);
    assert.match(String(err.error), /Cannot find module @anthropic-ai\/claude-agent-sdk/);
    assert.doesNotMatch(String(err.error), /connection closed/i);
    assert.deepEqual(err.recovery, { kind: 'retry', cause: 'bridgeExit' });
    sseGolden('sse-r7', 'agent-exits-on-start', first, s.work);

    const second = await stream(base, body);
    assert.equal(spawned, 2, 'Retry started one new process');
    const result = second.find((e) => e.type === 'acp:result');
    assert.ok(result, `no acp:result in ${JSON.stringify(second)}`);
    assert.match(String(result.text), /echo: hello/);
    sseGolden('sse-r7', 'agent-retry-answers', second, s.work);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
