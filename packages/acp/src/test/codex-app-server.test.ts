import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { AcpClient, CodexAppServerClient, createAgentClient } from '../index.js';
import type { AgentMode, PermissionDecision } from '../index.js';

/**
 * CODEX THROUGH `codex app-server`: ASK ASKS.
 *
 * Under `codex exec` every mode runs with approval "never", so Ask could not
 * write and could not ask either. The fake below speaks the installed
 * codex-cli 0.153.4 app-server protocol (methods and fields from its own
 * `generate-ts` bindings) and applies codex's policy to one edit: create
 * hello.txt in the thread's cwd. These tests hold the client to: the request
 * reaches `onPermission` as an ACP `edit`, Deny leaves no file, Allow writes
 * it, and the modes that do not need to ask do not.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, '..', '..', 'src', 'test', 'fixtures', 'fake-codex-app-server', 'codex.mjs');
const PROMPT = 'Create a file named hello.txt in the current directory containing the word hello.';

async function run(
  mode: AgentMode,
  answer?: PermissionDecision,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ asked: RequestPermissionRequest[]; wrote: boolean; stopReason: string; text: string; via: string | undefined }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-codex-'));
  const asked: RequestPermissionRequest[] = [];
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [FAKE],
    cwd: dir,
    env,
    accessMode: mode,
    ...(answer
      ? {
          onPermission: (r: RequestPermissionRequest) => {
            asked.push(r);
            return answer;
          },
        }
      : {}),
  });
  try {
    await client.start();
    await client.newSession(dir);
    const { stopReason, text } = await client.prompt(PROMPT);
    return { asked, wrote: fs.existsSync(path.join(dir, 'hello.txt')), stopReason, text, via: client.via };
  } finally {
    await client.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Ask raises a real approval request for the file change, as an ACP edit', async () => {
  const r = await run('propose', 'deny');
  assert.strictEqual(r.via, 'app-server');
  assert.strictEqual(r.asked.length, 1, 'exactly one approval request');
  const req = r.asked[0];
  assert.strictEqual(req.toolCall.kind, 'edit');
  assert.match(req.toolCall.title ?? '', /hello\.txt/);
  assert.match(req.toolCall.locations?.[0]?.path ?? '', /hello\.txt$/);
  assert.deepStrictEqual(
    req.options.map((o) => o.kind),
    /* Always is codex's session accept (acceptForSession). */
    ['allow_once', 'allow_always', 'reject_once'],
  );
});

test('Ask + Deny leaves no file', async () => {
  const r = await run('propose', 'deny');
  assert.strictEqual(r.wrote, false);
  assert.strictEqual(r.stopReason, 'end_turn');
  assert.match(r.text, /declined/);
});

test('Ask + Allow writes the file', async () => {
  const r = await run('propose', 'allow');
  assert.strictEqual(r.asked.length, 1);
  assert.strictEqual(r.wrote, true);
});

test('Ask with no caller policy falls back to allowsTool: the edit is denied', async () => {
  const r = await run('propose');
  assert.strictEqual(r.wrote, false);
});

test('Auto-edit writes an in-workspace file without asking', async () => {
  const r = await run('autoEdit', 'deny');
  assert.strictEqual(r.asked.length, 0, 'workspace-write needs no approval for an in-workspace edit');
  assert.strictEqual(r.wrote, true);
});

test('Full access writes with no request', async () => {
  const r = await run('full', 'deny');
  assert.strictEqual(r.asked.length, 0);
  assert.strictEqual(r.wrote, true);
});

test('a codex without app-server falls back to codex exec, which cannot ask', async () => {
  const env = { ...process.env, FAKE_CODEX_NO_APP_SERVER: '1' };
  const ask = await run('propose', 'allow', env);
  assert.strictEqual(ask.via, 'exec');
  assert.strictEqual(ask.asked.length, 0, 'exec never asks');
  assert.strictEqual(ask.wrote, false, 'read-only sandbox: no write');
  const auto = await run('autoEdit', 'allow', env);
  assert.strictEqual(auto.via, 'exec');
  assert.strictEqual(auto.wrote, true);
});

test('abort interrupts the turn and reports cancelled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-codex-'));
  const client = new CodexAppServerClient({ command: process.execPath, args: [FAKE], cwd: dir, accessMode: 'propose' });
  try {
    await client.start();
    await client.newSession(dir);
    const ac = new AbortController();
    const turn = client.prompt('HANG', { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await turn;
    assert.strictEqual(r.stopReason, 'cancelled');
  } finally {
    await client.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createAgentClient sends a plain codex to app-server and everything else to ACP', () => {
  assert.ok(createAgentClient({ command: 'codex' }) instanceof CodexAppServerClient);
  assert.ok(
    createAgentClient({ command: 'node', args: ['C:/npm/node_modules/@openai/codex/bin/codex.js'] }) instanceof CodexAppServerClient,
  );
  assert.ok(createAgentClient({ command: 'codex-acp' }) instanceof AcpClient);
  assert.ok(createAgentClient({ command: 'claude-agent-acp' }) instanceof AcpClient);
  assert.ok(createAgentClient({ command: process.execPath, args: [FAKE], agentKind: 'codex-cli' }) instanceof CodexAppServerClient);
});
