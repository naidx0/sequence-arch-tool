#!/usr/bin/env node
/* A FAKE ACP AGENT: newline-delimited JSON-RPC 2.0 on stdio, no network, no account, no cost.

   Used by e2e/multi-chat.mjs. Register it as an agent's command:
     node fake-acp-agent.mjs --as <tag>
   `--as claude-code-acp` makes agentKindOf() classify the launch as Claude's ACP bridge;
   any other tag is a plain ACP agent (the "local model" lane).

   A prompt streams its answer one chunk at a time so a page can switch chats while it is
   still talking. The prompt steers the run:
     MARK:<token>     every chunk carries <token>, so a transcript can be checked for leaks
     STEPS:<n>        how many chunks (default 30)
     DELAY:<ms>       the gap between chunks (default 150)
   session/cancel ends the turn at once with stopReason "cancelled". */

import readline from 'node:readline';

const argv = process.argv.slice(2);
const as = argv[argv.indexOf('--as') + 1] ?? 'fake';
const name = as.replace(/-acp$/, '').replace(/-code$/, '');

const write = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const sessions = new Map();
let nextSession = 0;

const notify = (sessionId, update) => write({ method: 'session/update', params: { sessionId, update } });

async function prompt(id, params) {
  const sessionId = params.sessionId;
  const text = (params.prompt ?? []).map((b) => (b && b.type === 'text' ? b.text : '')).join('\n');
  const mark = /MARK:([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? 'nomark';
  const steps = Number(/STEPS:(\d+)/.exec(text)?.[1] ?? 30);
  const delay = Number(/DELAY:(\d+)/.exec(text)?.[1] ?? 150);
  const state = { cancelled: false, wake: null };
  sessions.set(sessionId, state);
  notify(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${name} answering ${mark}.` } });
  for (let i = 1; i <= steps; i += 1) {
    await new Promise((r) => {
      const t = setTimeout(r, delay);
      state.wake = () => {
        clearTimeout(t);
        r();
      };
    });
    if (state.cancelled) break;
    notify(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` ${mark}#${i}` } });
  }
  if (!state.cancelled) notify(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` DONE-${mark}` } });
  write({ id, result: { stopReason: state.cancelled ? 'cancelled' : 'end_turn' } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {} }, authMethods: [] } });
      return;
    case 'session/new': {
      const sessionId = `${name}-session-${++nextSession}-${process.pid}`;
      /* One model, so the page's model menu has a row for this agent. */
      const model = `fake-${name}-model`;
      write({ id, result: { sessionId, configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: [{ value: model, name: `Fake ${name}` }] }] } });
      return;
    }
    case 'session/set_config_option':
      write({ id, result: {} });
      return;
    case 'session/prompt':
      void prompt(id, params);
      return;
    case 'session/cancel': {
      const s = sessions.get(params.sessionId);
      if (s) {
        s.cancelled = true;
        s.wake?.();
      }
      return;
    }
    default:
      if (id !== undefined) write({ id, error: { code: -32601, message: `fake agent: ${method} is not supported` } });
  }
});
process.stdin.on('end', () => process.exit(0));
