#!/usr/bin/env node
/* Fake `codex app-server` for e2e/agent-turn-journey.mjs: JSON-RPC lines on stdio, no network, no account, no cost.
   It is named codex.js so agentKindOf() classifies it as the codex CLI, as with fake-agents/codex/codex.js.
   It really writes the file a turn says it writes (into the thread's cwd), so the page's Files tree can be asked
   whether it shows a file an agent made. Prompt keywords:
   WRITE    -> fileChange agent-wrote.txt; asks approval when sandbox is read-only, writes on accept
   QUESTION -> item/tool/requestUserInput, then streams the answer it got
   SLOW     -> streams 40 chunks at 250ms; honours turn/interrupt and turn/steer
   else     -> short echo */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
if (!process.argv.includes('app-server')) {
  process.stderr.write('error: unrecognized subcommand\n');
  process.exit(2);
}
/* A log only when asked for: a default beside this file would write into the repository. */
const LOG = process.env.FAKE_CODEX_LOG || null;
const log = (o) => { if (!LOG) return; try { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), pid: process.pid, ...o }) + '\n'); } catch {} };
const write = (msg) => { process.stdout.write(JSON.stringify(msg) + '\n'); };
const threads = new Map(); let nT = 0, nTurn = 0, nextServerId = 5000;
const live = new Map(); const pending = new Map();
const ask = (method, params) => { const id = nextServerId++; write({ id, method, params }); return new Promise((r) => pending.set(id, r)); };
async function runTurn(threadId, turnId, text) {
  const th = threads.get(threadId) ?? { cwd: process.cwd(), sandbox: 'read-only', approvalPolicy: 'on-request' };
  const st = { interrupted: false, wake: null, steers: [] }; live.set(turnId, st);
  log({ ev: 'turn', threadId, turnId, text: text.slice(-300), sandbox: th.sandbox, approval: th.approvalPolicy, cwd: th.cwd });
  write({ method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
  const itemId = `msg-${turnId}`;
  const delta = (d) => write({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: d } });
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); st.wake = () => { clearTimeout(t); r(); }; });
  const finish = (status) => { live.delete(turnId); write({ method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status, error: null } } }); log({ ev: 'done', turnId, status }); };
  if (/WRITE/.test(text)) {
    const file = path.join(th.cwd, 'agent-wrote.txt');
    const item = { type: 'fileChange', id: `fc-${turnId}`, changes: [{ path: file, kind: { type: 'add' }, diff: '+written by fake codex\n' }], status: 'inProgress' };
    delta('I will create agent-wrote.txt. ');
    write({ method: 'item/started', params: { threadId, turnId, item, startedAtMs: Date.now() } });
    let ok = th.sandbox !== 'read-only';
    if (!ok && th.approvalPolicy !== 'never') {
      const a = await ask('item/fileChange/requestApproval', { threadId, turnId, itemId: item.id, startedAtMs: Date.now(), reason: 'create agent-wrote.txt', grantRoot: null });
      log({ ev: 'approval', a });
      ok = a?.decision === 'accept' || a?.decision === 'acceptForSession';
    }
    if (st.interrupted) return finish('interrupted');
    if (ok) fs.writeFileSync(file, 'written by fake codex\n');
    write({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: ok ? 'completed' : 'declined' }, completedAtMs: Date.now() } });
    delta(ok ? 'Created agent-wrote.txt.' : 'The edit was declined; nothing written.');
    return finish('completed');
  }
  if (/CMD/.test(text)) {
    const cmd = { type: 'commandExecution', id: `cmd-${turnId}`, command: 'npm install left-pad', cwd: th.cwd, status: 'inProgress', aggregatedOutput: null, exitCode: null };
    delta('I need to run a command. ');
    write({ method: 'item/started', params: { threadId, turnId, item: cmd, startedAtMs: Date.now() } });
    const a = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: cmd.id, startedAtMs: Date.now(), command: cmd.command, cwd: th.cwd, reason: 'needs network' });
    log({ ev: 'cmd-approval', a });
    if (st.interrupted) return finish('interrupted');
    const ran = a?.decision === 'accept' || a?.decision === 'acceptForSession';
    if (ran) fs.writeFileSync(path.join(th.cwd, 'cmd-ran.txt'), 'ran\n');
    write({ method: 'item/completed', params: { threadId, turnId, item: { ...cmd, status: ran ? 'completed' : 'declined', exitCode: ran ? 0 : null, aggregatedOutput: ran ? 'added 1 package' : null }, completedAtMs: Date.now() } });
    delta(ran ? 'Command ran.' : 'Command was declined.');
    return finish('completed');
  }
  if (/QUESTION/.test(text)) {
    delta('Before I start I need one answer. ');
    const a = await ask('item/tool/requestUserInput', {
      threadId, turnId, itemId: `q-${turnId}`, isBlocking: true, autoResolutionMs: null,
      questions: [{ id: 'scope', header: 'Endpoint scope', question: 'What should the health endpoint represent?', isOther: true, isSecret: false, options: [{ label: 'Liveness only', description: 'process is up' }, { label: 'Readiness', description: 'dependencies reachable' }] }],
    });
    log({ ev: 'answer', a });
    if (st.interrupted) return finish('interrupted');
    delta(`You answered: ${JSON.stringify(a?.answers ?? {})}. Proceeding.`);
    return finish('completed');
  }
  if (/SLOW/.test(text)) {
    delta('slow work starting.');
    for (let i = 1; i <= 40; i++) {
      await sleep(250);
      if (st.interrupted) break;
      while (st.steers.length) delta(` [steered: ${st.steers.shift()}]`);
      delta(` step${i}`);
    }
    if (!st.interrupted) delta(' SLOW-DONE');
    return finish(st.interrupted ? 'interrupted' : 'completed');
  }
  delta(`fake codex echo: ${text.slice(-80)}`);
  finish('completed');
}
const textOf = (input) => (Array.isArray(input) ? input : []).map((i) => (i && typeof i.text === 'string' ? i.text : '')).join('\n');
const sandboxOf = (p, f) => (!p ? f : ({ readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }[p.type] ?? f));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = msg;
  if (id !== undefined && method === undefined) { const r = pending.get(id); pending.delete(id); r?.(msg.result); return; }
  if (id === undefined) return;
  log({ ev: 'rpc', method, params: method === 'turn/start' ? { approvalPolicy: params.approvalPolicy, sandboxPolicy: params.sandboxPolicy, cwd: params.cwd } : undefined });
  switch (method) {
    case 'initialize': write({ id, result: { userAgent: 'fake_codex/0.0.0', codexHome: process.cwd(), platformFamily: process.platform, platformOs: process.platform } }); return;
    case 'thread/start': case 'thread/resume': {
      const threadId = method === 'thread/resume' && typeof params.threadId === 'string' ? params.threadId : `fake-thread-${++nT}-${process.pid}`;
      threads.set(threadId, { cwd: params.cwd ?? process.cwd(), approvalPolicy: params.approvalPolicy ?? 'on-request', sandbox: params.sandbox ?? 'read-only' });
      write({ id, result: { thread: { id: threadId, turns: [] }, model: 'fake-codex-model', cwd: params.cwd ?? process.cwd() } }); return;
    }
    case 'turn/start': {
      const th = threads.get(params.threadId) ?? { cwd: process.cwd() }; threads.set(params.threadId, th);
      if (params.approvalPolicy) th.approvalPolicy = params.approvalPolicy;
      th.sandbox = sandboxOf(params.sandboxPolicy, th.sandbox ?? 'read-only');
      if (params.cwd) th.cwd = params.cwd;
      const turnId = `fake-turn-${++nTurn}-${process.pid}`;
      write({ id, result: { turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
      void runTurn(params.threadId, turnId, textOf(params.input)); return;
    }
    case 'turn/steer': {
      const s = live.get(params.expectedTurnId);
      if (!s) { write({ id, error: { code: -32600, message: 'no active turn' } }); return; }
      s.steers.push(textOf(params.input)); log({ ev: 'steer', text: textOf(params.input) });
      write({ id, result: { turnId: params.expectedTurnId } }); return;
    }
    case 'turn/interrupt': {
      const s = live.get(params.turnId);
      if (s) { s.interrupted = true; s.wake?.(); for (const [k, r] of pending) { pending.delete(k); r({ decision: 'cancel', answers: {} }); } }
      write({ id, result: {} }); return;
    }
    case 'model/list': write({ id, result: { data: [{ id: 'fake-codex-model', model: 'fake-codex-model', displayName: 'Fake codex', isDefault: true, supportedReasoningEfforts: [] }] } }); return;
    case 'skills/list': case 'collaborationMode/list': write({ id, result: { data: [] } }); return;
    default: write({ id, error: { code: -32601, message: `fake codex: ${method} is not supported` } });
  }
});
process.stdin.on('end', () => process.exit(0));
