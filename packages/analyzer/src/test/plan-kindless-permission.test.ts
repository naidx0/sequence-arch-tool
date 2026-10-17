import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { rmTree } from './rmTree.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/**
 * PLAN REFUSES A PERMISSION REQUEST WITH NO KIND.
 *
 * codex-acp sends its sandbox escalations ("File System Write Access",
 * "Network Access") and MCP elicitations with no toolCall kind. Plan used to
 * let those through to an interactive Allow card, and approving it let the
 * write happen. Driven through the real server against the mock ACP agent
 * (a node script, never a real claude or codex), with its PERMISSION request
 * sent kind-less.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

type Ev = Record<string, unknown>;

test('Plan: a kind-less PERMISSION request is refused by the mode, with no pending card', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-plan-kindless-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  /* The same mock agent, its PERMISSION request sent with no kind. */
  const wrapper = path.join(dir, 'mock-agent-kindless.mjs');
  fs.writeFileSync(wrapper, `process.env.MOCK_AGENT_PERMISSION_NO_KIND = '1';\nawait import(${JSON.stringify(pathToFileURL(MOCK_AGENT).href)});\n`);
  addAgent(store, { id: 'mock', command: process.execPath, args: [wrapper] });

  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: store,
    acpTurn: { answerQuietMs: 150, stopGraceMs: 150, statusEveryMs: 60, killGraceMs: 0 },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ agentRef: 'mock', prompt: 'PERMISSION', permissionMode: 'plan', interactivePermissions: true, chatId }),
      signal: AbortSignal.timeout(20_000),
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    const events: Ev[] = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as Ev);
    const perms = events.filter((e) => e.type === 'acp:permission');
    assert.ok(perms.length >= 1, `a permission event was emitted; saw ${events.map((e) => e.type).join(', ')}`);
    assert.ok(!perms.some((e) => e.pending === true), 'no pending Allow card was offered');
    assert.deepStrictEqual(
      perms.map((e) => [e.toolKind, e.decision, e.answeredBy]),
      [[undefined, 'deny', 'mode']],
    );
    const said = events
      .filter((e) => e.type === 'acp:update')
      .map((e) => JSON.stringify(e))
      .join('\n');
    assert.ok(!/permission=allow/.test(said), 'the agent was never told allow');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    /* The scan's background index runs git in the repo and an agent runs in it: wait for both to end before removing it (Windows refuses a busy folder). */
    await serverSettled(server);
    rmTree(dir);
  }
});
