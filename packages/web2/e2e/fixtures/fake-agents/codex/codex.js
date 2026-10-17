#!/usr/bin/env node
/* A FAKE `codex app-server`: JSON-RPC lines on stdio, no network, no account, no cost.

   Used by e2e/multi-chat.mjs. Register it as `node <this dir>/codex.js`: the file is named
   codex.js so agentKindOf() treats it as the codex CLI and the server drives it through
   CodexAppServerClient, as it does the real one. Lenient where the replay (acp
   dist/replay/bin/codex.js) is strict: it answers whatever the client asks, so a change to
   the client's request shape does not break a test about chats.

   The prompt steers the turn the same way as fake-acp-agent.mjs: MARK:<token>, STEPS:<n>,
   DELAY:<ms>. turn/interrupt ends the turn as "interrupted". */

import readline from 'node:readline';

if (!process.argv.includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand (this fake only speaks 'app-server')\n");
  process.exit(2);
}

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
let threads = 0;
let turns = 0;
const live = new Map();

async function runTurn(threadId, turnId, text) {
  const mark = /MARK:([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? 'nomark';
  const steps = Number(/STEPS:(\d+)/.exec(text)?.[1] ?? 30);
  const delay = Number(/DELAY:(\d+)/.exec(text)?.[1] ?? 150);
  const state = { interrupted: false, wake: null };
  live.set(turnId, state);
  write({ method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
  const itemId = `msg-${turnId}`;
  const delta = (d) => write({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: d } });
  delta(`codex answering ${mark}.`);
  for (let i = 1; i <= steps; i += 1) {
    await new Promise((r) => {
      const t = setTimeout(r, delay);
      state.wake = () => {
        clearTimeout(t);
        r();
      };
    });
    if (state.interrupted) break;
    delta(` ${mark}#${i}`);
  }
  if (!state.interrupted) delta(` DONE-${mark}`);
  live.delete(turnId);
  write({ method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status: state.interrupted ? 'interrupted' : 'completed', error: null } } });
}

const textOf = (input) =>
  (Array.isArray(input) ? input : []).map((i) => (i && typeof i.text === 'string' ? i.text : '')).join('\n');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params = {} } = msg;
  if (id === undefined) return; /* notifications (initialized) need no answer */
  switch (method) {
    case 'initialize':
      write({ id, result: { userAgent: 'fake_codex/0.0.0', codexHome: process.cwd(), platformFamily: process.platform, platformOs: process.platform } });
      return;
    case 'thread/start':
    case 'thread/resume': {
      const threadId = method === 'thread/resume' && typeof params.threadId === 'string' ? params.threadId : `fake-thread-${++threads}-${process.pid}`;
      write({ id, result: { thread: { id: threadId, turns: [] }, model: 'fake-codex-model', cwd: params.cwd ?? process.cwd() } });
      return;
    }
    case 'turn/start': {
      const turnId = `fake-turn-${++turns}-${process.pid}`;
      write({ id, result: { turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
      void runTurn(params.threadId, turnId, textOf(params.input));
      return;
    }
    case 'turn/interrupt': {
      const s = live.get(params.turnId);
      if (s) {
        s.interrupted = true;
        s.wake?.();
      }
      write({ id, result: {} });
      return;
    }
    case 'model/list':
      write({ id, result: { data: [{ id: 'fake-codex-model', model: 'fake-codex-model', displayName: 'Fake codex', isDefault: true, supportedReasoningEfforts: [] }] } });
      return;
    case 'skills/list':
      write({ id, result: { data: [] } });
      return;
    case 'collaborationMode/list':
      write({ id, result: { data: [] } });
      return;
    default:
      write({ id, error: { code: -32601, message: `fake codex: ${method} is not supported` } });
  }
});
process.stdin.on('end', () => process.exit(0));
