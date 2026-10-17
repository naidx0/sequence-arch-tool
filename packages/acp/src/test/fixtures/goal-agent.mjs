// A mock ACP agent that drives the real Sequence MCP `goal` tool (spawned from the mcpServers the session gives it).
// argv: --mode=<tick|many|never|textwrong|slow|slowfirst|forge|write> --log=<file> [--tag=<text>]
// `slowfirst`: the first prompt this PROCESS takes hangs (cancellable) so a test can press Stop on a turn in flight; every later one ticks like `tick`.
// `write`: writes --tag into shared.txt under the session's cwd, then (after a pause that lets a sibling run overlap) ticks its step.
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(here, '..', '..', '..', '..', 'mcp', 'package.json'));
const { Client } = req('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = req('@modelcontextprotocol/sdk/client/stdio.js');

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=');
const mode = arg('mode') || 'tick';
const logFile = arg('log');
const log = (o) => {
  if (logFile) appendFileSync(logFile, JSON.stringify({ pid: process.pid, ...o }) + '\n');
};
log({ ev: 'start', mode });

const sessions = new Map(); // sessionId -> mcpServers
const cwds = new Map(); // sessionId -> cwd the host gave the session
const cancels = new Map();

const envOf = (s) => Object.fromEntries((s.env ?? []).map((e) => [e.name, e.value]));

async function callGoal(sessionId, args) {
  const servers = sessions.get(sessionId) ?? [];
  const seq = servers.find((s) => s.name === 'sequence');
  if (!seq) return { text: 'NO_SEQUENCE_SERVER', isError: true };
  const env = envOf(seq);
  const transport = new StdioClientTransport({ command: seq.command, args: seq.args, env: { ...process.env, ...env }, stderr: 'ignore' });
  const client = new Client({ name: 'goal-mock', version: '0' });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    if (!names.includes('goal')) return { text: `NO_GOAL_TOOL(${names.length})`, isError: true, env };
    const r = await client.callTool({ name: 'goal', arguments: args });
    return { text: r.content?.[0]?.text ?? '', isError: r.isError === true, env };
  } finally {
    await client.close().catch(() => {});
  }
}

const firstOpen = (text) => {
  const m = /^- \[ \] (.+)$/m.exec(text);
  return m ? m[1] : null;
};
const openLines = (text) => [...text.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1]);

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
let slowFirstDone = false;
new AgentSideConnection((conn) => {
  const say = (sessionId, text) => conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
  return {
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } } };
    },
    async newSession(params) {
      const sessionId = `rev-${process.pid}-${++n}`;
      sessions.set(sessionId, params.mcpServers ?? []);
      cwds.set(sessionId, params.cwd);
      log({ ev: 'newSession', sessionId, cwd: params.cwd, goalEnv: (params.mcpServers ?? []).map((s) => { const e = envOf(s); return { chat: e.SEQUENCE_GOAL_CHAT ?? null, key: e.SEQUENCE_GOAL_KEY ?? null }; }) });
      return { sessionId };
    },
    async resumeSession(params) {
      sessions.set(params.sessionId, params.mcpServers ?? []);
      cwds.set(params.sessionId, params.cwd);
      log({ ev: 'resumeSession', sessionId: params.sessionId, goalEnv: (params.mcpServers ?? []).map((s) => envOf(s).SEQUENCE_GOAL_CHAT ?? null) });
      return {};
    },
    async authenticate() {
      return {};
    },
    async prompt(params) {
      const { sessionId } = params;
      const text = params.prompt.map((p) => (p.type === 'text' ? p.text : '')).join('');
      const audit = text.includes('completion audit');
      log({ ev: 'prompt', sessionId, audit, first: firstOpen(text) });
      if (audit) {
        await say(sessionId, 'checked.\nVERDICT: PASS — mock');
        return { stopReason: 'end_turn' };
      }
      if (mode === 'slowfirst' && !slowFirstDone) {
        slowFirstDone = true;
        log({ ev: 'slow-start', sessionId });
        const cancelled = await new Promise((resolve) => {
          const t = setTimeout(() => resolve(false), 20000);
          cancels.set(sessionId, () => {
            clearTimeout(t);
            log({ ev: 'slow-cancelled', sessionId });
            resolve(true);
          });
        });
        cancels.delete(sessionId);
        if (cancelled) return { stopReason: 'cancelled' };
      }
      if (mode === 'never') {
        await say(sessionId, 'I looked around and did some work.');
        return { stopReason: 'end_turn' };
      }
      if (mode === 'textwrong') {
        const open = openLines(text);
        const target = open[1] ?? open[0];
        await say(sessionId, `Progress:\n- [x] ${target}`);
        return { stopReason: 'end_turn' };
      }
      if (mode === 'forge') {
        const r1 = await callGoal(sessionId, { op: 'write_plan', steps: ['../../../evil step', 'C:/Windows/x'], chat: '../other', root: 'C:/' });
        log({ ev: 'forge', r1 });
        await say(sessionId, `forge: ${r1.text}`);
        return { stopReason: 'end_turn' };
      }
      if (mode === 'write') {
        const cwd = cwds.get(sessionId);
        const tag = arg('tag') || 'write';
        const file = path.join(cwd, 'shared.txt');
        writeFileSync(file, tag + '\n');
        log({ ev: 'write', sessionId, cwd, tag });
        await new Promise((r) => setTimeout(r, 1500));
        const step = firstOpen(text);
        const r = step ? await callGoal(sessionId, { op: 'mark_step_done', step }) : { text: 'no step' };
        log({ ev: 'write-tick', r });
        await say(sessionId, `wrote: ${r.text}`);
        return { stopReason: 'end_turn' };
      }
      if (mode === 'narrate') {
        /* Creates src/onlyinwt.ts in ITS cwd only, writes no plan and ticks nothing: a harness plan built from the goal names the file only if it looks in this cwd. */
        const cwd = cwds.get(sessionId);
        mkdirSync(path.join(cwd, 'src'), { recursive: true });
        writeFileSync(path.join(cwd, 'src', 'onlyinwt.ts'), 'export const where = "WORKTREE";\n');
        log({ ev: 'narrate', sessionId, text });
        await say(sessionId, 'I will edit src/onlyinwt.ts next.');
        return { stopReason: 'end_turn' };
      }
      if (mode === 'slow') {
        log({ ev: 'slow-start', sessionId });
        return await new Promise((resolve) => {
          const t = setTimeout(async () => {
            cancels.delete(sessionId);
            log({ ev: 'slow-finished', sessionId });
            const step = firstOpen(text);
            const r = step ? await callGoal(sessionId, { op: 'mark_step_done', step }) : { text: 'no step' };
            log({ ev: 'slow-tick', r });
            await say(sessionId, `finished: ${r.text}`);
            resolve({ stopReason: 'end_turn' });
          }, 6000);
          cancels.set(sessionId, () => {
            clearTimeout(t);
            log({ ev: 'slow-cancelled', sessionId });
            resolve({ stopReason: 'cancelled' });
          });
        });
      }
      if (mode === 'many') {
        /* Every open step of the plan, ticked over one MCP connection: many writes in a row. */
        const servers = sessions.get(sessionId) ?? [];
        const seq = servers.find((x) => x.name === 'sequence');
        const transport = new StdioClientTransport({ command: seq.command, args: seq.args, env: { ...process.env, ...envOf(seq) }, stderr: 'ignore' });
        const client = new Client({ name: 'goal-mock', version: '0' });
        await client.connect(transport);
        let ok = 0;
        let bad = 0;
        try {
          for (const line of openLines(text)) {
            const r = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: line } });
            if (r.isError) bad += 1;
            else ok += 1;
          }
        } finally {
          await client.close().catch(() => {});
        }
        log({ ev: 'many', ok, bad });
        await say(sessionId, `ticked ${ok}, refused ${bad}`);
        return { stopReason: 'end_turn' };
      }
      // tick
      const step = firstOpen(text);
      if (!step) {
        const r = await callGoal(sessionId, { op: 'write_plan', steps: ['alpha step one', 'beta step two', 'gamma step three'] });
        log({ ev: 'write_plan', r });
        await say(sessionId, `planned: ${r.text}`);
        return { stopReason: 'end_turn' };
      }
      const r = await callGoal(sessionId, { op: 'mark_step_done', step });
      log({ ev: 'tick', step, r });
      await say(sessionId, `ticked: ${r.text}`);
      return { stopReason: 'end_turn' };
    },
    async cancel(params) {
      const c = cancels.get(params.sessionId);
      if (c) c();
    },
  };
}, stream);
