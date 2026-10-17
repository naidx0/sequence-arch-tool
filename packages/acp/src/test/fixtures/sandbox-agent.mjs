// A mock ACP agent for the sandbox contract: logs its argv and every session/new it is given
// (cwd, how many MCP servers) to $SANDBOX_AGENT_LOG, one JSON line each. No AI.
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { appendFileSync } from 'node:fs';

const log = (o) => appendFileSync(process.env.SANDBOX_AGENT_LOG, JSON.stringify(o) + '\n');
log({ ev: 'start', argv: process.argv.slice(2) });
let n = 0;
new AgentSideConnection(() => ({
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
  },
  async newSession(params) {
    log({ ev: 'newSession', cwd: params.cwd, mcpServers: (params.mcpServers ?? []).length });
    return { sessionId: `s${++n}` };
  },
  async authenticate() {},
  async prompt() {
    return { stopReason: 'end_turn' };
  },
  async cancel() {},
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
