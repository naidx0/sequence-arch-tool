import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';

/**
 * WAVE 1 ITEM 1.10 — ACP SEAMS.
 *
 * Gap G9: `new AcpClient(launch)` at both call sites passes launch config ONLY —
 * no `onUpdate`, no `onPermission`. `AcpClientConfig` declares both
 * (`packages/acp/src/client.ts`), and the client already RECEIVES streamed
 * `session/update` notifications, so today the HTTP bridge:
 *
 *   1. throws every streamed update away and answers with one final blob, and
 *   2. falls through to `defaultPermissionPolicy`, which allows only
 *      read/fetch/search/think — so a local Claude Code driven through Sequence
 *      is READ-ONLY AND SILENT ABOUT IT. The agent asks, the server denies, and
 *      no one is ever shown the question.
 *
 * The mock ACP agent (`packages/acp/src/test/fixtures/mock-agent.mjs`) speaks the
 * real wire: it streams `agent_message_chunk` updates, and a prompt containing
 * "PERMISSION" sends a genuine `requestPermission` for an `edit`-kind tool call
 * and reports the decision back in its text — so both halves are observable end
 * to end with no AI and no network.
 *
 * WHAT IS PINNED
 *  - the streamed run surfaces at least one REAL session/update (asserted on the
 *    notification's own shape, not on a count of rows);
 *  - the denial is no longer silent: a permission request appears on the stream
 *    with the decision that was taken;
 *  - the DEFAULT stays deny — the opt-in is what changes it, never the presence
 *    of the new seam. Both directions are asserted, because a permission gate
 *    that only ever says yes is not a gate.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

function tempStoreDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-acp-seams-')));
}

interface Started {
  base: string;
  close: () => Promise<void>;
}

async function startServer(userConfigDir: string): Promise<Started> {
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    },
  };
}

type Json = Record<string, unknown>;

function sseEvents(text: string): Json[] {
  const out: Json[] = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!clean.startsWith('data: ')) continue;
      out.push(JSON.parse(clean.slice(6)) as Json);
    }
  }
  return out;
}

async function runStreamed(base: string, body: Json): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200, 'a streamed ACP run starts');
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  return sseEvents(await res.text());
}

test('a streamed ACP run surfaces at least one real session/update', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(dir);
  try {
    const events = await runStreamed(s.base, { agentRef: 'mock', prompt: 'ping' });
    const updates = events.filter((e) => e.type === 'acp:update');
    assert.ok(updates.length >= 1, `the run must surface session/update; got ${updates.length}`);

    // It is the agent's OWN notification, not a summary we invented: the ACP
    // envelope carries a sessionId and a discriminated `update`.
    const first = updates[0] as { update?: { sessionId?: string; update?: { sessionUpdate?: string } } };
    assert.strictEqual(typeof first.update?.sessionId, 'string', 'the notification keeps its sessionId');
    assert.strictEqual(
      typeof first.update?.update?.sessionUpdate,
      'string',
      'the notification keeps its sessionUpdate discriminator',
    );

    // The turn still ends with the same honest {stopReason, text} the JSON route returns.
    const result = events.find((e) => e.type === 'acp:result') as
      | { stopReason?: string; text?: string }
      | undefined;
    assert.ok(result, 'the stream still ends in a result');
    assert.strictEqual(result!.stopReason, 'end_turn');
    assert.match(result!.text ?? '', /echo:/);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a permission request reaches the stream instead of being denied in silence', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(dir);
  try {
    const events = await runStreamed(s.base, { agentRef: 'mock', prompt: 'PERMISSION please' });
    const asks = events.filter((e) => e.type === 'acp:permission');
    assert.ok(asks.length >= 1, 'the write request the agent made must be visible to the caller');
    const ask = asks[0] as { toolKind?: string; decision?: string; title?: string };
    assert.strictEqual(ask.toolKind, 'edit', 'the event names what was being asked for');
    assert.strictEqual(ask.decision, 'deny', 'and what was decided');

    // Unchanged default: a mutating tool is still refused.
    const result = events.find((e) => e.type === 'acp:result') as { text?: string } | undefined;
    assert.match(result!.text ?? '', /permission=reject-1/, 'the default policy still denies an edit');
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit acceptEdits mode lets a mutating tool through; the default does not', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(dir);
  try {
    const allowed = await runStreamed(s.base, {
      agentRef: 'mock',
      prompt: 'PERMISSION please',
      permissionMode: 'acceptEdits',
    });
    const allowedResult = allowed.find((e) => e.type === 'acp:result') as { text?: string } | undefined;
    assert.match(
      allowedResult!.text ?? '',
      /permission=allow-1/,
      'the opt-in must actually allow the edit, or the seam is decorative',
    );
    const ask = allowed.find((e) => e.type === 'acp:permission') as { decision?: string } | undefined;
    assert.strictEqual(ask?.decision, 'allow', 'and the stream reports the decision that was taken');

    // The same server, the same agent, without the opt-in: still denied.
    const denied = await runStreamed(s.base, { agentRef: 'mock', prompt: 'PERMISSION please' });
    const deniedResult = denied.find((e) => e.type === 'acp:result') as { text?: string } | undefined;
    assert.match(deniedResult!.text ?? '', /permission=reject-1/, 'the gate is opt-in, not opt-out');
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown permissionMode is refused rather than quietly treated as the permissive one', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(dir);
  try {
    const res = await fetch(`${s.base}/api/acp/run-node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentRef: 'mock', prompt: 'ping', permissionMode: 'yolo' }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /permissionMode/);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the non-streaming ACP run is unchanged: one JSON {stopReason, text}', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(dir);
  try {
    const res = await fetch(`${s.base}/api/acp/run-node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentRef: 'mock', prompt: 'ping' }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = (await res.json()) as { stopReason: string; text: string };
    assert.strictEqual(body.stopReason, 'end_turn');
    assert.match(body.text, /echo:/);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
