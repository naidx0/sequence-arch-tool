#!/usr/bin/env node
/* A fake `codex` that speaks the app-server JSON-RPC of the installed
 * codex-cli 0.153.4, read from `codex app-server generate-ts`, and does one
 * deterministic thing: the agent "wants to create hello.txt" in the thread's cwd.
 *
 * Wire facts it holds the client to (each one from the generated bindings):
 *   - newline-delimited JSON-RPC, requests carry `id` + `method` + `params`;
 *   - `initialize` { clientInfo, capabilities } then the `initialized` notification;
 *   - `thread/start` { cwd, approvalPolicy, sandbox } -> { thread: { id } };
 *   - `turn/start` { threadId, input: [{ type: 'text', text, text_elements }],
 *     approvalPolicy?, sandboxPolicy? } -> { turn: { id, status } };
 *   - `item/started` / `item/completed` carry a fileChange item with
 *     `changes: [{ path, kind, diff }]`;
 *   - the approval is a SERVER request, `item/fileChange/requestApproval`
 *     { threadId, turnId, itemId, startedAtMs }, answered with
 *     { decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' };
 *   - `turn/completed` { threadId, turn: { id, status, error } } ends the turn;
 *   - `turn/interrupt` { threadId, turnId } ends it as `interrupted`.
 * Anything else is a JSON-RPC -32601, the way an unknown method is refused.
 *
 * Policy, as the real agent applies it to a write inside the workspace:
 *   danger-full-access / workspace-write -> writes, asks nobody;
 *   read-only + on-request/untrusted     -> asks, writes only on accept;
 *   read-only + never                    -> cannot write, asks nobody.
 * And to a read-only command first, when the prompt says READ (as measured
 * live on 2026-10-06, lab/codex-live-gate.md: Plan under `untrusted` asked
 * before `Get-ChildItem`; Ask under on-request + read-only ran it unasked):
 *   untrusted                            -> asks before the read;
 *   on-request / never                   -> runs it in the sandbox, asks nobody.
 *
 * FAKE_CODEX_NO_APP_SERVER=1 models a codex without the subcommand: `app-server`
 * exits 2 the way clap refuses an unknown subcommand, and `exec` takes the
 * fallback (`-c approval_policy=<p> --sandbox <s>`, prompt positional).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const noAppServer = process.env.FAKE_CODEX_NO_APP_SERVER === '1';

if (argv.includes('exec')) {
  let sandbox = 'read-only';
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--sandbox') sandbox = argv[i + 1];
  if (sandbox !== 'read-only') fs.writeFileSync(path.join(process.cwd(), 'hello.txt'), 'hello\n');
  process.stdout.write(sandbox === 'read-only' ? 'I cannot write here.\n' : 'Created hello.txt.\n');
  process.exit(0);
}
if (!argv.includes('app-server') || noAppServer) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\n");
  process.exit(2);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const threads = new Map(); // threadId -> { cwd, approvalPolicy, sandbox }
const pending = new Map(); // our request id -> resolve
let nextServerId = 1000;
let initialized = false;
let current = null; // { threadId, turnId, finish }

function ask(method, params) {
  const id = nextServerId++;
  send({ id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

function sandboxOf(policy, fallback) {
  if (!policy) return fallback;
  return { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }[policy.type] ?? fallback;
}

async function runTurn(threadId, turnId, t) {
  const done = (status) => {
    if (!current || current.turnId !== turnId) return;
    current = null;
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status, error: null } } });
  };
  current = { threadId, turnId, finish: done };
  send({ method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
  const file = path.join(t.cwd, 'hello.txt');
  const item = { type: 'fileChange', id: 'item-1', changes: [{ path: file, kind: { type: 'add' }, diff: '+hello\n' }], status: 'inProgress' };
  const msg = (text) => {
    send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-1', delta: text } });
    send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'msg-1', text }, completedAtMs: Date.now() } });
  };

  if (t.prompt.includes('HANG')) return; // only turn/interrupt ends it

  /* ESCALATE: a command that wants out of the sandbox, asked about whatever the policy; writes ESCALATED.txt when allowed. */
  if (t.prompt.includes('ESCALATE')) {
    const cmd = { type: 'commandExecution', id: 'item-esc', command: 'touch ESCALATED.txt', cwd: t.cwd, status: 'inProgress', aggregatedOutput: null, exitCode: null };
    send({ method: 'item/started', params: { threadId, turnId, item: cmd, startedAtMs: Date.now() } });
    const answer = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: cmd.id, startedAtMs: Date.now(), command: cmd.command, cwd: t.cwd, reason: 'needs to leave the sandbox' });
    if (!current || current.turnId !== turnId) return;
    const ran = answer?.decision === 'accept' || answer?.decision === 'acceptForSession';
    if (ran) fs.writeFileSync(path.join(t.cwd, 'ESCALATED.txt'), '');
    send({ method: 'item/completed', params: { threadId, turnId, item: { ...cmd, status: ran ? 'completed' : 'declined', exitCode: ran ? 0 : null }, completedAtMs: Date.now() } });
    return done('completed');
  }

  if (t.prompt.includes('READ')) {
    const read = { type: 'commandExecution', id: 'item-read', command: 'Get-ChildItem -Name', cwd: t.cwd, status: 'inProgress', aggregatedOutput: null, exitCode: null };
    send({ method: 'item/started', params: { threadId, turnId, item: read, startedAtMs: Date.now() } });
    let ran = true;
    if (t.approvalPolicy === 'untrusted') {
      const answer = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: read.id, startedAtMs: Date.now(), command: read.command, cwd: t.cwd, reason: null });
      if (!current || current.turnId !== turnId) return;
      ran = answer?.decision === 'accept' || answer?.decision === 'acceptForSession';
    }
    const listing = ran ? fs.readdirSync(t.cwd).join(' ') : null;
    send({ method: 'item/completed', params: { threadId, turnId, item: { ...read, status: ran ? 'completed' : 'declined', aggregatedOutput: listing, exitCode: ran ? 0 : null }, completedAtMs: Date.now() } });
  }

  const canWrite = t.sandbox !== 'read-only';
  const mayAsk = t.approvalPolicy !== 'never';
  if (!canWrite && !mayAsk) {
    msg('I cannot create files here because the workspace is read-only.');
    return done('completed');
  }
  send({ method: 'item/started', params: { threadId, turnId, item, startedAtMs: Date.now() } });
  let write = canWrite;
  if (!canWrite) {
    const answer = await ask('item/fileChange/requestApproval', { threadId, turnId, itemId: item.id, startedAtMs: Date.now(), reason: null, grantRoot: null });
    if (!current || current.turnId !== turnId) return;
    write = answer?.decision === 'accept' || answer?.decision === 'acceptForSession';
  }
  if (write) fs.writeFileSync(file, 'hello\n');
  send({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: write ? 'completed' : 'declined' }, completedAtMs: Date.now() } });
  msg(write ? 'Created hello.txt.' : 'The edit was declined, so hello.txt was not created.');
  done('completed');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.id !== undefined && m.method === undefined) {
    const r = pending.get(m.id);
    pending.delete(m.id);
    r?.(m.result);
    return;
  }
  if (m.method === 'initialized' && m.id === undefined) {
    initialized = true;
    return;
  }
  const reply = (result) => send({ id: m.id, result });
  const fail = (code, message) => send({ id: m.id, error: { code, message } });
  const p = m.params ?? {};
  switch (m.method) {
    case 'initialize':
      if (!p.clientInfo?.name) return fail(-32602, 'clientInfo is required');
      return reply({ userAgent: 'fake-codex/0.153.4', codexHome: '/fake', platformFamily: 'windows', platformOs: 'windows' });
    case 'thread/start': {
      if (!initialized) return fail(-32002, 'not initialized');
      const id = `thread-${threads.size + 1}`;
      threads.set(id, { cwd: p.cwd ?? process.cwd(), approvalPolicy: p.approvalPolicy ?? 'on-request', sandbox: p.sandbox ?? 'read-only' });
      return reply({ thread: { id, turns: [] }, model: 'fake', modelProvider: 'fake', cwd: p.cwd, approvalPolicy: p.approvalPolicy, sandbox: { type: 'readOnly' } });
    }
    case 'turn/start': {
      const th = threads.get(p.threadId);
      if (!th) return fail(-32602, `unknown thread ${p.threadId}`);
      const text = Array.isArray(p.input) ? p.input.filter((i) => i.type === 'text').map((i) => i.text).join('\n') : '';
      if (!text) return fail(-32602, 'input must carry a text item');
      if (p.approvalPolicy) th.approvalPolicy = p.approvalPolicy;
      th.sandbox = sandboxOf(p.sandboxPolicy, th.sandbox);
      const turnId = `turn-${Date.now()}`;
      reply({ turn: { id: turnId, items: [], status: 'inProgress', error: null } });
      void runTurn(p.threadId, turnId, { ...th, prompt: text });
      return;
    }
    case 'turn/interrupt':
      reply({});
      if (current && current.turnId === p.turnId) current.finish('interrupted');
      return;
    default:
      return fail(-32601, `method not found: ${m.method}`);
  }
});
