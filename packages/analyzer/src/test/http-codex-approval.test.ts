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
 * CODEX APPROVALS REACH THE PERSON, THROUGH run-node.
 *
 * A registered plain `codex` now runs through `codex app-server`, whose
 * approval requests become ACP permission requests. On a streamed run that
 * opts in with `interactivePermissions: true`, a request the mode would refuse
 * is announced (`acp:permission`, `pending: true`, a `requestId`, a `proposal`
 * in the edit approval card's prop shape) and waits for
 * `POST /api/acp/permission`. The fake codex speaks the installed 0.153.4
 * app-server protocol and wants to create hello.txt in its cwd.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const FAKE_CODEX = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-app-server', 'codex.mjs');
const PROMPT = 'Create a file named hello.txt in the current directory containing the word hello.';

type Json = Record<string, unknown>;

/**
 * Remove a temp dir the run's agent may still be in. The server ends the
 * response before it disposes the agent, and Windows refuses to remove a
 * directory that a live process has as its cwd (EPERM, at once: rmSync's own
 * maxRetries did not retry it on Node 24). So retry until the child is gone.
 */
async function rmEventually(dir: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 100 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY')) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

interface Rig {
  base: string;
  work: string;
  close: () => Promise<void>;
}

async function rig(timeoutMs?: number): Promise<Rig> {
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-codex-store-')));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-codex-work-')));
  addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE_CODEX], cwd: work });
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: store,
    ...(timeoutMs !== undefined ? { acpApprovalTimeoutMs: timeoutMs } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    work,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      await rmEventually(store);
      await rmEventually(work);
    },
  };
}

/** Run one streamed turn; `onEvent` sees every SSE event as it arrives (and may answer). */
async function streamed(base: string, body: Json, onEvent?: (e: Json) => Promise<void> | void): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200);
  const events: Json[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const e = JSON.parse(line.slice(6)) as Json;
        events.push(e);
        await onEvent?.(e);
      }
    }
  }
  return events;
}

const answer = (base: string, requestId: unknown, decision: string): Promise<Response> =>
  fetch(`${base}/api/acp/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, decision }),
  });

const pendingOf = (events: Json[]): Json[] => events.filter((e) => e.type === 'acp:permission' && e.pending === true);
const resultOf = (events: Json[]): Json | undefined => events.find((e) => e.type === 'acp:result');

test('Ask: the codex file change is put to the person, and Deny leaves no file', async () => {
  const r = await rig();
  try {
    const answers: number[] = [];
    const events = await streamed(
      r.base,
      { agentRef: 'codex', prompt: PROMPT, permissionMode: 'propose', interactivePermissions: true },
      async (e) => {
        if (e.type === 'acp:permission' && e.pending === true) answers.push((await answer(r.base, e.requestId, 'deny')).status);
      },
    );
    const asks = pendingOf(events);
    assert.strictEqual(asks.length, 1, 'one approval request reached the stream');
    assert.strictEqual(asks[0].toolKind, 'edit');
    const proposal = asks[0].proposal as { proposalId: string; title: string; files: { path: string; diff: string | null; kind: string | null; decision: string }[] };
    assert.strictEqual(proposal.proposalId, asks[0].requestId);
    assert.match(proposal.files[0].path, /hello\.txt$/);
    assert.strictEqual(proposal.files[0].kind, 'add', "codex's change kind reaches the card, so it knows the diff is a new file's content");
    assert.match(proposal.files[0].diff ?? '', /\+hello/, 'the card gets the diff codex proposed');
    assert.strictEqual(proposal.files[0].decision, 'pending');
    assert.deepStrictEqual(answers, [200]);
    const settled = events.find((e) => e.type === 'acp:permission' && e.pending === false) as Json;
    assert.strictEqual(settled.decision, 'deny');
    assert.strictEqual(settled.answeredBy, 'person');
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false, 'Deny: no file');
    assert.strictEqual(resultOf(events)?.stopReason, 'end_turn');
  } finally {
    await r.close();
  }
});

test('Ask: Allow writes the file', async () => {
  const r = await rig();
  try {
    const events = await streamed(
      r.base,
      { agentRef: 'codex', prompt: PROMPT, permissionMode: 'propose', interactivePermissions: true },
      async (e) => {
        if (e.type === 'acp:permission' && e.pending === true) await answer(r.base, e.requestId, 'allow');
      },
    );
    assert.strictEqual(pendingOf(events).length, 1);
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), true, 'Allow: the file is written');
  } finally {
    await r.close();
  }
});

test('Plan: a read command runs with no card, and the write is declined at once with no card, the chat told why once', async () => {
  const r = await rig();
  try {
    const asked: Json[] = [];
    const events = await streamed(
      r.base,
      { agentRef: 'codex', prompt: `READ the directory, then ${PROMPT}`, permissionMode: 'plan', interactivePermissions: true },
      async (e) => {
        if (e.type === 'acp:permission' && e.pending === true) {
          asked.push(e);
          await answer(r.base, e.requestId, 'allow');
        }
      },
    );
    /* The read ran: its call completed, in the read-only sandbox, unasked. */
    const updates = events.filter((e) => e.type === 'acp:update').map((e) => (e.update as Json).update as Json);
    const read = updates.find((u) => u.sessionUpdate === 'tool_call_update' && u.toolCallId === 'item-read');
    assert.strictEqual(read?.status, 'completed', 'the read command ran');
    /* Owner ruling 2026-10-06: Plan makes no changes. Even a person ready to Allow is never asked. */
    assert.deepStrictEqual(asked, [], 'no card at all: not for the read, not for the write');
    const decided = events.filter((e) => e.type === 'acp:permission');
    assert.deepStrictEqual(
      decided.map((e) => [e.toolKind, e.decision, e.pending, e.answeredBy, e.note]),
      [['edit', 'deny', undefined, 'mode', "Plan mode doesn't make changes. Approve the plan or switch mode to apply it."]],
    );
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false, 'Plan: the write did not happen');
    assert.strictEqual(resultOf(events)?.stopReason, 'end_turn');
  } finally {
    await r.close();
  }
});

test('Plan: a command that asks to leave the sandbox is declined at once, no Allow card, the chat told why', async () => {
  const r = await rig();
  try {
    const asked: Json[] = [];
    const events = await streamed(
      r.base,
      { agentRef: 'codex', prompt: 'ESCALATE the sandbox', permissionMode: 'plan', interactivePermissions: true },
      async (e) => {
        if (e.type === 'acp:permission' && e.pending === true) {
          asked.push(e);
          await answer(r.base, e.requestId, 'allow');
        }
      },
    );
    assert.deepStrictEqual(asked, [], 'no card: a person ready to Allow is never asked');
    const decided = events.filter((e) => e.type === 'acp:permission');
    assert.strictEqual(decided.length, 1);
    assert.deepStrictEqual([decided[0]!.decision, decided[0]!.pending, decided[0]!.answeredBy, decided[0]!.note], ['deny', undefined, 'mode', "Plan mode doesn't make changes. Approve the plan or switch mode to apply it."]);
    assert.strictEqual(fs.existsSync(path.join(r.work, 'ESCALATED.txt')), false, 'the command did not run');
  } finally {
    await r.close();
  }
});

test('Plan without the opt-in: the read runs and the write is refused by the mode, nobody asked', async () => {
  const r = await rig();
  try {
    const events = await streamed(r.base, { agentRef: 'codex', prompt: `READ the directory, then ${PROMPT}`, permissionMode: 'plan' });
    const decided = events.filter((e) => e.type === 'acp:permission');
    assert.deepStrictEqual(decided.map((e) => [e.toolKind, e.decision, e.pending]), [['edit', 'deny', undefined]]);
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false);
  } finally {
    await r.close();
  }
});

test('Full access: codex writes with no request', async () => {
  const r = await rig();
  try {
    /* Full consent belongs to the General workspace the server owns, not the agent's configured cwd. */
    const confirmed = await fetch(`${r.base}/api/acp/full-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    assert.strictEqual(confirmed.status, 200);
    const { projectKey } = (await confirmed.json()) as { projectKey: string };
    const events = await streamed(r.base, { agentRef: 'codex', prompt: PROMPT, permissionMode: 'full', interactivePermissions: true });
    assert.strictEqual(events.filter((e) => e.type === 'acp:permission').length, 0, 'no request at all');
    assert.strictEqual(fs.existsSync(path.join(projectKey, 'hello.txt')), true, 'Full writes in the workspace that was confirmed');
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false, 'not in the configured cwd');
  } finally {
    await r.close();
  }
});

test('Auto-edit: an in-workspace edit needs no request', async () => {
  const r = await rig();
  try {
    const events = await streamed(r.base, { agentRef: 'codex', prompt: PROMPT, permissionMode: 'autoEdit', interactivePermissions: true });
    assert.strictEqual(events.filter((e) => e.type === 'acp:permission').length, 0);
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), true);
  } finally {
    await r.close();
  }
});

test('without the opt-in, Ask decides as before: the request is shown, denied, never pending', async () => {
  const r = await rig();
  try {
    const events = await streamed(r.base, { agentRef: 'codex', prompt: PROMPT, permissionMode: 'propose' });
    const asks = events.filter((e) => e.type === 'acp:permission');
    assert.strictEqual(asks.length, 1);
    assert.strictEqual(asks[0].decision, 'deny');
    assert.strictEqual(asks[0].pending, undefined);
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false);
  } finally {
    await r.close();
  }
});

test('an unanswered approval falls back to the mode decision after the timeout', async () => {
  const r = await rig(150);
  try {
    const events = await streamed(r.base, { agentRef: 'codex', prompt: PROMPT, permissionMode: 'propose', interactivePermissions: true });
    const settled = events.find((e) => e.type === 'acp:permission' && e.pending === false) as Json;
    assert.strictEqual(settled.answeredBy, 'timeout');
    assert.strictEqual(settled.decision, 'deny');
    assert.strictEqual(fs.existsSync(path.join(r.work, 'hello.txt')), false);
  } finally {
    await r.close();
  }
});

test('answering an unknown request is a 404, and a bad decision is a 400', async () => {
  const r = await rig();
  try {
    assert.strictEqual((await answer(r.base, 'nope', 'allow')).status, 404);
    assert.strictEqual((await answer(r.base, 'nope', 'maybe')).status, 400);
  } finally {
    await r.close();
  }
});
