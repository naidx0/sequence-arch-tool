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
 *   - contains "REPLY<<x>>" → streams exactly x, then 'end_turn' (a scripted final report);
 *                             with HOLD, x is the held answer.
 *   - otherwise             → streams "echo: <text>" in two chunks, 'end_turn'.
 *
 * Every prompt streams its own `sessionId` back inside a chunk (prefixed
 * "sid=<id>") so a test can assert two turns reused the SAME session.
 *
 * Env hooks (optional):
 *   - MOCK_AGENT_PID_FILE  → on startup, write this process's PID to that path so
 *                            a test can poll whether the subprocess was killed.
 *   - MOCK_AGENT_PERMISSION_NO_KIND → the PERMISSION request carries no toolCall kind.
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
/** sessionId -> { meta, setModes } — what the client sent, for "ACCESS" prompts. */
const sessionState = new Map();

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
      // Resume hooks (opt-in by env): MOCK_AGENT_LOAD=1 advertises session/load,
      // which replays two history chunks before it answers; MOCK_AGENT_RESUME=1
      // advertises session/resume, which replays nothing.
      const agentCapabilities = {};
      if (process.env.MOCK_AGENT_LOAD) agentCapabilities.loadSession = true;
      if (process.env.MOCK_AGENT_RESUME) agentCapabilities.sessionCapabilities = { resume: {} };
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities };
    },
    async loadSession(params) {
      sessionState.set(params.sessionId, { meta: null, setModes: [] });
      await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'history: an old question' } } });
      await chunk(params.sessionId, 'history: an old answer');
      return {};
    },
    async resumeSession(params) {
      sessionState.set(params.sessionId, { meta: null, setModes: [] });
      return {};
    },
    async authenticate() {
      return {};
    },
    async newSession(params) {
      // Access-mode hooks (all opt-in by env, so every older test is unchanged):
      //   MOCK_AGENT_REFUSE_BYPASS=<reason> → a session asking for
      //     bypassPermissions through `_meta.claudeCode.options` fails with that
      //     reason, as Claude Code does as root without IS_SANDBOX or under a
      //     managed disableBypassPermissionsMode policy.
      //   MOCK_AGENT_MODES=a,b,c → advertise these session modes (first is current).
      const options = params?._meta?.claudeCode?.options;
      if (process.env.MOCK_AGENT_REFUSE_BYPASS && options?.permissionMode === 'bypassPermissions') {
        throw new Error(process.env.MOCK_AGENT_REFUSE_BYPASS);
      }
      const sessionId = `mock-session-${++sessionCounter}`;
      sessionState.set(sessionId, { meta: params?._meta ?? null, setModes: [] });
      const ids = (process.env.MOCK_AGENT_MODES ?? '').split(',').filter(Boolean);
      if (ids.length === 0) return { sessionId };
      return {
        sessionId,
        modes: {
          currentModeId: ids[0],
          availableModes: ids.map((id) => ({ id, name: id })),
        },
      };
    },
    async setSessionMode(params) {
      sessionState.get(params.sessionId)?.setModes.push(params.modeId);
      return {};
    },
    async prompt(params) {
      const { sessionId } = params;
      const text = textOf(params.prompt);

      // Always reveal which session handled this turn (session-reuse assertion).
      await chunk(sessionId, `sid=${sessionId};`);

      if (text.includes('REFUSE')) {
        return { stopReason: 'refusal' };
      }

      if (text.includes('ACCESS')) {
        // Report what reached the agent: the session _meta, every set_mode, and argv.
        const st = sessionState.get(sessionId) ?? { meta: null, setModes: [] };
        await chunk(
          sessionId,
          `access=${JSON.stringify({ meta: st.meta, setModes: st.setModes, argv: process.argv.slice(2) })}`
        );
        return { stopReason: 'end_turn' };
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

      const scriptedReply = /REPLY<<([\s\S]*?)>>/.exec(text);
      if (text.includes('HOLD')) {
        // Round 9: the claude-agent-acp shape Jaden hit. The answer is complete
        // (text, then the turn's cost), but session/prompt stays open while
        // "background helpers" run. It ends on cancel, or never.
        await chunk(sessionId, scriptedReply ? scriptedReply[1] : 'The answer is 42.');
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'usage_update', used: 1200, size: 200000, cost: { amount: 0.01, currency: 'USD' } } });
        return await new Promise((resolve) => {
          pendingCancels.set(sessionId, () => {
            pendingCancels.delete(sessionId);
            resolve({ stopReason: 'cancelled' });
          });
        });
      }

      if (text.includes('PERMISSION')) {
        const res = await conn.requestPermission({
          sessionId,
          // MOCK_AGENT_PERMISSION_NO_KIND=1 sends it with no kind, as codex-acp's sandbox escalations do.
          toolCall: process.env.MOCK_AGENT_PERMISSION_NO_KIND
            ? { toolCallId: 'tc-1', title: 'File System Write Access', status: 'pending' }
            : { toolCallId: 'tc-1', title: 'write a file', kind: 'edit', status: 'pending' },
          options: [
            { optionId: 'allow-1', name: 'Allow', kind: 'allow_once' },
            // MOCK_AGENT_ALWAYS=1 also offers an always option, as Claude's adapter does.
            ...(process.env.MOCK_AGENT_ALWAYS ? [{ optionId: 'always-1', name: 'Always allow', kind: 'allow_always' }] : []),
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

      const scripted = /REPLY<<([\s\S]*?)>>/.exec(text);
      if (scripted) {
        await chunk(sessionId, scripted[1]);
        return { stopReason: 'end_turn' };
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
