/**
 * A DRY mock ACP agent for tools/bench/agent-context-bench.mjs --agent-arm --dry.
 *
 * It proves the bench's plumbing (client, sessions, usage, scoring) with no model and no spend. Its usage
 * numbers are SYNTHETIC (a made-up function of how many files are under its cwd) and must never be quoted
 * as a measurement. It answers "Which file defines the function `<name>`?" by a plain text search of cwd.
 */
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const textOf = (prompt) => (prompt ?? []).map((b) => (b && b.type === 'text' ? b.text : '')).join('');

new AgentSideConnection((conn) => ({
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} };
  },
  async authenticate() {
    return {};
  },
  async newSession() {
    return { sessionId: `dry-${++n}` };
  },
  async prompt(params) {
    const text = textOf(params.prompt);
    const files = walk(process.cwd());
    const fn = /`([A-Za-z0-9_]+)`/.exec(text)?.[1];
    let hit = '(not found)';
    if (fn) {
      for (const f of files) {
        if (readFileSync(f, 'utf8').includes(`function ${fn}(`)) {
          hit = path.relative(process.cwd(), f).split(path.sep).join('/');
          break;
        }
      }
    }
    await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: hit } } });
    const input = 1200 + 3 * Math.ceil(Math.sqrt(files.length)) + Math.ceil(text.length / 4);
    return { stopReason: 'end_turn', usage: { inputTokens: input, outputTokens: 40, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: input + 40 } };
  },
  async cancel() {},
}), stream);
