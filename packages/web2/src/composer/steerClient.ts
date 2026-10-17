/* ══════════════════════════════════════════════════════════════════════════
   ENTER MID-TURN: STEER IT, OR QUEUE IT (S5)
   packages/web2/src/composer/steerClient.ts

   `POST /api/acp/steer { sessionKey, text }` asks the server to put the text
   into the turn the agent is running (Codex `turn/steer`, acp/src/steer.ts).
   The server answers `{ steered: true }`, or `{ steered: false, reason }` for
   an agent with no steer (every ACP agent), a turn codex will not steer, or
   a turn that has already ended. Anything but a yes, including a server that
   does not have the route yet (404), QUEUES the text: the person's words are
   never dropped, they wait for the turn to settle.

   `sessionKey` is the key run-node already keeps one live agent session per
   (agents/agentRunner.ts): `chat::<sessionId>::<agentRef>`.
   ══════════════════════════════════════════════════════════════════════════ */

import { promptQueue, type PromptQueue } from './promptQueue';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SteerResult = { kind: 'steered' } | { kind: 'queued'; reason: string };

/** The run-node session key for a chat's agent, as agentRunner.ts builds it. */
export function chatSessionKey(sessionId: string | null, agentRef: string): string {
  return `chat::${sessionId ?? 'none'}::${agentRef}`;
}

export async function requestSteer(sessionKey: string, text: string, f: Fetch): Promise<{ steered: boolean; reason: string }> {
  try {
    const r = await f('/api/acp/steer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey, text }),
    });
    const body = (await r.json().catch(() => ({}))) as { steered?: unknown; reason?: unknown };
    if (r.ok && body.steered === true) return { steered: true, reason: '' };
    return { steered: false, reason: typeof body.reason === 'string' ? body.reason : `http ${r.status}` };
  } catch (e) {
    return { steered: false, reason: (e as Error).message || 'network' };
  }
}

export interface SteerOrQueueInput {
  /** The queue's key for this chat (the chat id). */
  queueKey: string;
  /** The live agent session, or null when no agent turn is running (then it queues). */
  sessionKey: string | null;
  text: string;
  /** Queue at the FRONT: a reason for a denial goes before anything else waiting. */
  front?: boolean;
  fetch?: Fetch;
  queue?: PromptQueue;
}

export async function steerOrQueue(input: SteerOrQueueInput): Promise<SteerResult> {
  const queue = input.queue ?? promptQueue;
  if (input.sessionKey) {
    const answer = await requestSteer(input.sessionKey, input.text, input.fetch ?? ((u, i) => fetch(u, i)));
    if (answer.steered) return { kind: 'steered' };
    queue.add(input.queueKey, input.text, { front: input.front });
    return { kind: 'queued', reason: answer.reason };
  }
  queue.add(input.queueKey, input.text, { front: input.front });
  return { kind: 'queued', reason: 'no agent turn to steer' };
}
