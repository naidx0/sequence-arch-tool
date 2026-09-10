/**
 * A conformant MOCK ACP *agent* — the test counterparty for `AcpClient`.
 *
 * It speaks the REAL ACP wire protocol over stdin/stdout using the SAME SDK's
 * agent-side helpers (`AgentSideConnection` + `ndJsonStream`), so the client
 * under test exercises genuine JSON-RPC framing, streaming `session/update`
 * notifications, permission round-trips, and `session/cancel` — exactly as a
 * real Claude Code / Codex agent would. No AI, fully deterministic.
 *
 * Prompt-text triggers (so tests can steer the turn):
 *   - contains "REFUSE"     → responds with stopReason 'refusal' (no answer).
 *   - contains "SLOW"       → streams one chunk, then waits; a 2nd ("billed")
 *                             chunk is scheduled far in the future. On cancel it
 *                             clears that timer and returns 'cancelled' WITHOUT
 *                             emitting the 2nd chunk (proves cancel stops spend).
 *   - contains "HANG"       → streams one chunk then NEVER resolves the turn, and
 *                             IGNORES `session/cancel` (models an uncooperative
 *                             agent). The only way out is killing the subprocess —
 *                             proves a disconnect force-kills regardless of the agent.
 *   - contains "CWD"        → streams "cwd=<process.cwd()>" then 'end_turn' (lets a
 *                             test assert the agent's working dir was contained).
 *   - contains "PERMISSION" → sends a WRITE-kind requestPermission, then reports
 *                             the client's decision in the streamed text.
 *   - otherwise             → streams "echo: <text>" in two chunks, 'end_turn'.
 *
 * Every prompt streams its own `sessionId` back inside a chunk (prefixed
 * "sid=<id>") so a test can assert two turns reused the SAME session.
 *
 * Env hooks (optional):
 *   - MOCK_AGENT_PID_FILE  → on startup, write this process's PID to that path so
 *                            a test can poll whether the subprocess was killed.
 *   - MOCK_AGENT_TRAP_SIGTERM → install a no-op SIGTERM handler so the process only
 *                            dies on SIGKILL (proves dispose's SIGTERM→SIGKILL escalation).
 */

import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { writeFileSync } from 'node:fs';

if (process.env.MOCK_AGENT_PID_FILE) {
  try {
    writeFileSync(process.env.MOCK_AGENT_PID_FILE, String(process.pid));
  } catch {
    /* best-effort */
  }
}
if (process.env.MOCK_AGENT_TRAP_SIGTERM) {
  // Swallow SIGTERM: the process survives a graceful kill and only dies on SIGKILL.
  process.on('SIGTERM', () => {});
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
);

let sessionCounter = 0;
/** sessionId -> resolver that cancels the in-flight SLOW turn. */
const pendingCancels = new Map();

function textOf(prompt) {
  return (prompt ?? [])
    .map((b) => (b && b.type === 'text' ? b.text : ''))
    .join('');
}

// eslint-disable-next-line no-new
new AgentSideConnection((conn) => {
  const chunk = (sessionId, text) =>
    conn.sessionUpdate({
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    });

  return {
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} };
    },
    async authenticate() {
      return {};
    },
    async newSession() {
      const sessionId = `mock-session-${++sessionCounter}`;
      return { sessionId };
    },
    async prompt(params) {
      const { sessionId } = params;
      const text = textOf(params.prompt);

      // Always reveal which session handled this turn (session-reuse assertion).
      await chunk(sessionId, `sid=${sessionId};`);

      if (text.includes('REFUSE')) {
        return { stopReason: 'refusal' };
      }

      if (text.includes('CWD')) {
        await chunk(sessionId, `cwd=${process.cwd()}`);
        return { stopReason: 'end_turn' };
      }

      if (text.includes('HANG')) {
        // Stream one chunk, then NEVER resolve and IGNORE cancel: an uncooperative
        // agent that only stops when its process is killed.
        await chunk(sessionId, 'hanging...');
        return await new Promise(() => {});
      }

      if (text.includes('PERMISSION')) {
        const res = await conn.requestPermission({
          sessionId,
          toolCall: { toolCallId: 'tc-1', title: 'write a file', kind: 'edit', status: 'pending' },
          options: [
            { optionId: 'allow-1', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject-1', name: 'Reject', kind: 'reject_once' },
          ],
        });
        const decision =
          res.outcome.outcome === 'selected' ? res.outcome.optionId : res.outcome.outcome;
        await chunk(sessionId, `permission=${decision}`);
        return { stopReason: 'end_turn' };
      }

      if (text.includes('SLOW')) {
        await chunk(sessionId, 'working...');
        return await new Promise((resolve) => {
          // A would-be second, BILLED chunk if the turn is NOT cancelled.
          const timer = setTimeout(async () => {
            pendingCancels.delete(sessionId);
            await chunk(sessionId, 'MORE_BILLED');
            resolve({ stopReason: 'end_turn' });
          }, 10_000);
          pendingCancels.set(sessionId, () => {
            clearTimeout(timer);
            pendingCancels.delete(sessionId);
            resolve({ stopReason: 'cancelled' });
          });
        });
      }

      await chunk(sessionId, 'echo:');
      await chunk(sessionId, ` ${text}`);
      return { stopReason: 'end_turn' };
    },
    async cancel(params) {
      const cancelTurn = pendingCancels.get(params.sessionId);
      if (cancelTurn) cancelTurn();
    },
  };
}, stream);
