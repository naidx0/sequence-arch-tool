#!/usr/bin/env node
/* Reviewer stub: records prompts; a prompt carrying TOOLS:<json> emits those tool_call updates first. */
import fs from 'node:fs';
import readline from 'node:readline';
const log = process.argv[2];
const rec = (o) => fs.appendFileSync(log, JSON.stringify(o) + '\n');
const write = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
let n = 0;
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {} }, authMethods: [] } });
  if (method === 'session/new') { const sid = `stub-${process.pid}-${++n}`; rec({ kind: 'new', sid }); return write({ id, result: { sessionId: sid } }); }
  if (method === 'session/prompt') {
    const text = (params.prompt ?? []).map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
    rec({ kind: 'prompt', sid: params.sessionId, text });
    const m = /TOOLS:(\S+)$/.exec(text);
    if (m) {
      const calls = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      let k = 0;
      for (const c of calls) write({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: `t${++k}`, status: 'completed', ...c } } });
    }
    write({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } });
    return write({ id, result: { stopReason: 'end_turn' } });
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) write({ id, result: {} });
});
process.stdin.on('end', () => process.exit(0));
