import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AgentEventHub } from '../server/agentEvents.js';
import { agentHookSettings } from '../server/agentHookSettings.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * Claims-audit 2.6 (F3): "hands the agent only those". A PreToolUse hook answers the FIRST Grep or Glob of a
 * turn with find_files results, behind the setting findFilesFirst (OFF by default). The agent-ab A/B is the
 * lead's; these lock the mechanism: off means nothing changes, on means one answer per turn.
 */

const ID = { session_id: 's1', cwd: '/repo' };
const prompt = (text: string) => ({ ...ID, hook_event_name: 'UserPromptSubmit', prompt: text });
const pre = (tool: string, input: Record<string, unknown> = { pattern: 'checkout' }) => ({ ...ID, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });

function hub(enabled: boolean, calls: string[], run?: (root: string, q: string) => Promise<string>) {
  return new AgentEventHub({
    getGraph: () => null,
    getRoot: () => '/repo',
    findFilesFirst: { enabled: () => enabled, run: run ?? (async (_r, q) => (calls.push(q), 'src/checkout.ts - handles checkout')) },
  });
}

test('off (the default): no search is ever answered, find_files is never called', async () => {
  const calls: string[] = [];
  const h = hub(false, calls);
  await h.findFilesContext(prompt('where is checkout?'));
  assert.equal(await h.findFilesContext(pre('Grep')), null);
  assert.deepEqual(calls, []);
});

test('on: the first Grep of a turn gets find_files context for the prompt; the second search in that turn gets none; a new prompt resets', async () => {
  const calls: string[] = [];
  const h = hub(true, calls);
  await h.findFilesContext(prompt('where is checkout?'));
  const first = await h.findFilesContext(pre('Grep'));
  assert.ok(first);
  assert.equal(first.hookEventName, 'PreToolUse');
  assert.match(String(first.additionalContext), /src\/checkout\.ts/);
  assert.equal('permissionDecision' in first, false, 'it adds context only; the search still runs and no permission is granted');
  assert.equal(await h.findFilesContext(pre('Glob', { pattern: '**/*.ts' })), null);
  assert.deepEqual(calls, ['where is checkout?']);
  await h.findFilesContext(prompt('and the cart?'));
  assert.ok(await h.findFilesContext(pre('Glob', { pattern: '**/*.ts' })));
  assert.deepEqual(calls, ['where is checkout?', 'and the cart?']);
});

test('on: other tools and other events are never answered; a search with no prompt falls back to its pattern', async () => {
  const calls: string[] = [];
  const h = hub(true, calls);
  assert.equal(await h.findFilesContext(pre('Read', { file_path: '/repo/a.ts' })), null);
  assert.equal(await h.findFilesContext({ ...ID, hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: {} }), null);
  assert.deepEqual(calls, []);
  assert.ok(await h.findFilesContext(pre('Grep', { pattern: 'applyDiscount' })));
  assert.deepEqual(calls, ['applyDiscount']);
});

test('a failing or empty find_files answers nothing (the search runs as usual) and does not retry within the turn', async () => {
  const calls: string[] = [];
  const h = hub(true, calls, async () => {
    calls.push('boom');
    throw new Error('index not ready');
  });
  await h.findFilesContext(prompt('q'));
  assert.equal(await h.findFilesContext(pre('Grep')), null);
  assert.equal(await h.findFilesContext(pre('Grep')), null);
  assert.deepEqual(calls, ['boom']);
  const empty = hub(true, [], async () => '   ');
  await empty.findFilesContext(prompt('q'));
  assert.equal(await empty.findFilesContext(pre('Grep')), null);
  /* A "No file matched" answer is not injected, and it does not use up the turn. */
  const n: string[] = [];
  const none = hub(true, n, async (_r, q) => (n.push(q), n.length === 1 ? 'find_files: 0 of 0 files\nNo file matched. Use grep or glob.' : 'gateway/src/routes/orders.ts'));
  await none.findFilesContext(prompt('orders'));
  assert.equal(await none.findFilesContext(pre('Grep')), null);
  assert.match(String((await none.findFilesContext(pre('Grep')))?.additionalContext), /orders\.ts/);
});

test('the generated settings register Grep|Glob only when the setting is on', () => {
  const matchers = (s: ReturnType<typeof agentHookSettings>) => s.hooks.PreToolUse!.map((e) => e.matcher);
  assert.deepEqual(matchers(agentHookSettings('http://127.0.0.1:1')), ['Edit|Write|MultiEdit', 'Read|Bash']);
  const on = agentHookSettings('http://127.0.0.1:1', { findFilesFirst: true });
  assert.deepEqual(matchers(on), ['Edit|Write|MultiEdit', 'Read|Bash', 'Grep|Glob']);
  assert.equal(on.hooks.PreToolUse![2]!.hooks[0]!.async, undefined, 'synchronous: its reply carries the context');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

function post(port: number, body: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/api/agent-event', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('through the real server: the setting gates the real find_files; the reply names a repo file', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-first-repo-')));
  fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/(^|[\\/])\.sequence([\\/]|$)/.test(path.relative(SHOPFRONT, p)) });
  /* find_files ranks git-tracked files: the specimen is a real (temp) repo. */
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore', windowsHide: true });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'specimen');
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-first-store-')));
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await post(port, prompt('the orders route in the gateway'));
    const off = await post(port, pre('Grep'));
    assert.equal(off.hookSpecificOutput, undefined, 'setting off: nothing added');
    const put = await fetch(`http://127.0.0.1:${port}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ findFilesFirst: true }) });
    assert.equal(put.status, 200);
    await post(port, prompt('the orders route in the gateway'));
    /* A cold index answers "No file matched", which is not injected and leaves the turn open: ask again until it is warm. */
    let on = await post(port, pre('Grep'));
    for (let i = 0; i < 40 && !on.hookSpecificOutput; i++) {
      await new Promise((r) => setTimeout(r, 250));
      on = await post(port, pre('Grep'));
    }
    const out = on.hookSpecificOutput as { additionalContext?: string } | undefined;
    assert.ok(out?.additionalContext, JSON.stringify(on));
    assert.match(out.additionalContext, /gateway\//);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
