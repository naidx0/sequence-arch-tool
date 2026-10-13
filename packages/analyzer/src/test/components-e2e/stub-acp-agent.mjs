#!/usr/bin/env node
/* An ACP stub that records session/new params and every prompt text to a log. */
import fs from 'node:fs';
import readline from 'node:readline';
const log = process.argv[2];
const rec = (o) => fs.appendFileSync(log, JSON.stringify(o) + '\n');
const write = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
let n = 0;
rec({ kind: 'spawn', env: { SEQUENCE_COMPONENTS_ROOT: process.env.SEQUENCE_COMPONENTS_ROOT ?? null } });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {} }, authMethods: [] } });
  if (method === 'session/new') { rec({ kind: 'new', params }); return write({ id, result: { sessionId: `stub-${++n}` } }); }
  if (method === 'session/prompt') {
    const text = (params.prompt ?? []).map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
    rec({ kind: 'prompt', text });
    const delay = Number(/HOLD:(\d+)/.exec(text)?.[1] ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    write({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } });
    return write({ id, result: { stopReason: 'end_turn' } });
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) write({ id, result: {} });
});
process.stdin.on('end', () => process.exit(0));
