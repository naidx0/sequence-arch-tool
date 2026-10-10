/* ══════════════════════════════════════════════════════════════════════════
   STEERING A RUNNING CODEX TURN (S5)
   packages/acp/src/steer.ts

   `turn/steer` adds the person's words to the turn codex is running, instead
   of waiting for it to end. From the binary's own bindings
   (`codex app-server generate-ts`, codex-cli 0.153.4):

     TurnSteerParams   { threadId, input: UserInput[], expectedTurnId,
                         clientUserMessageId? }
     TurnSteerResponse { turnId }
     errors            a JSON-RPC error; CodexErrorInfo has
                       activeTurnNotSteerable { turnKind: 'review' | 'compact' },
                       and `expectedTurnId` must match the active turn

   ACP has no steer. An agent without one, a turn that has ended, or a turn
   codex will not steer all answer `steered: false`, and the caller queues the
   text for after the turn instead (the web composer's queue). Nothing is lost.

   This module is the call and its classification, with the transport
   injected, so it works over CodexAppServerClient's private `request` (the
   one-line method the S5 report lists for codexAppServer.ts) and is tested
   against the replay harness.
   ══════════════════════════════════════════════════════════════════════════ */

/** How a JSON-RPC request is sent: CodexAppServerClient's `request`. */
export type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** The turn running now, as CodexAppServerClient holds it. */
export interface ActiveTurn {
  threadId: string;
  /** Known once `turn/start` answered. */
  turnId?: string;
}

export type SteerOutcome =
  | { steered: true; turnId: string }
  | { steered: false; reason: 'no-active-turn' | 'not-steerable' | 'turn-changed' | 'unsupported' | 'rejected'; message?: string };

export function steerParams(turn: { threadId: string; turnId: string }, text: string, clientUserMessageId?: string): Record<string, unknown> {
  return {
    threadId: turn.threadId,
    input: [{ type: 'text', text, text_elements: [] }],
    expectedTurnId: turn.turnId,
    ...(clientUserMessageId ? { clientUserMessageId } : {}),
  };
}

/** Classify a refused steer from the error codex sent (its message carries the reason). */
export function steerRefusal(err: unknown): SteerOutcome & { steered: false } {
  const message = err instanceof Error ? err.message : String(err);
  if (/not\s*steerable|activeTurnNotSteerable/i.test(message)) return { steered: false, reason: 'not-steerable', message };
  if (/expected.?turn|no active turn|turn.*(mismatch|not active|does not match)/i.test(message)) return { steered: false, reason: 'turn-changed', message };
  if (/-32601|method not found|unknown (method|variant)/i.test(message)) return { steered: false, reason: 'unsupported', message };
  return { steered: false, reason: 'rejected', message };
}

/**
 * Send `text` into the running turn. Never throws: every way it can fail is
 * an outcome the caller turns into "queued for after this turn".
 */
export async function codexSteer(rpc: Rpc, turn: ActiveTurn | null | undefined, text: string, clientUserMessageId?: string): Promise<SteerOutcome> {
  if (!turn || !turn.turnId) return { steered: false, reason: 'no-active-turn' };
  if (text.trim() === '') return { steered: false, reason: 'rejected', message: 'nothing to send' };
  try {
    const res = (await rpc('turn/steer', steerParams({ threadId: turn.threadId, turnId: turn.turnId }, text, clientUserMessageId))) as { turnId?: unknown } | null;
    return { steered: true, turnId: typeof res?.turnId === 'string' ? res.turnId : turn.turnId };
  } catch (e) {
    return steerRefusal(e);
  }
}

/** A client that can be steered (CodexAppServerClient, once it has `steer`). */
export interface Steerable {
  steer(text: string): Promise<SteerOutcome>;
}

export function canSteer(client: unknown): client is Steerable {
  return typeof (client as Partial<Steerable> | null)?.steer === 'function';
}
