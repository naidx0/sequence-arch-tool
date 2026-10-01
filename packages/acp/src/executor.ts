/**
 * `createAcpExecutor` — the ACP-backed {@link NodeExecutor} for a Program
 * `agent` node whose `runtime` is `'acp'`. It plugs into the SAME injected work
 * seam the scheduler already races (abort + timeout) for `agent`/`command`
 * nodes, so control flow stays pure and deterministic; only the agent turn is
 * non-deterministic, and it is driven honestly.
 *
 * HONESTY (carried from v13/v14, sharpened for real subprocess cost):
 *  - `{ ok: true, value: { stopReason, text } }` ONLY when the agent completes a
 *    real turn with `stopReason: 'end_turn'`. Every other stop reason
 *    (`refusal`, `cancelled`, `max_tokens`, `max_turn_requests`) is a non-answer
 *    or an interruption and surfaces as `{ ok: false, error }` — never a
 *    fabricated `done`.
 *  - `ctx.signal` (the run's Stop) is threaded into `client.prompt`, which fires
 *    a real ACP `session/cancel`. The scheduler additionally abandons the await
 *    and records the node `error` (stopped), and — because Stop halts the run —
 *    no downstream node executes.
 *
 * ANTI-PRIMING (acpx's insight): sequential acp nodes in ONE run SHARE a single
 * ACP session per `agentRef`, revealing intent step-by-step instead of one
 * mega-prompt. A per-run session manager (this closure's `clients` map) keys the
 * shared client/session by `agentRef`; a node may opt out with
 * `acp.shareSession === false`, which opens a fresh session for that node.
 *
 * PARALLEL acp NODES sharing an `agentRef` (Finding 2): client creation is
 * race-free (the manager stores a `Promise<entry>` so concurrent callers await
 * the SAME creation — exactly ONE client + ONE session per agentRef per run), and
 * each node's session-open decision + prompt turn run inside a per-client
 * critical section (`entry.turnLock`). Net HONEST behavior: parallel acp nodes on
 * one agentRef share ONE session and their turns SERIALIZE — one agent runs one
 * turn at a time (an ACP session cannot run two turns at once). A turn still
 * queued (not yet started) when Stop fires rejects honestly — never a fabricated
 * done. (AcpClient additionally serializes prompts internally as defense in depth.)
 */

import type { NodeExecutor } from '@sequence/schema';
import type { AcpAgentClient } from './client.js';

/**
 * The set of ACP stop reasons that count as a genuine, honest turn completion.
 * Deliberately just `end_turn`: a truncation (`max_tokens`), a request-cap
 * (`max_turn_requests`), a `refusal`, or a `cancelled` are all non-answers.
 */
const COMPLETED_STOP_REASONS: ReadonlySet<string> = new Set(['end_turn']);

export interface AcpExecutorDeps {
  /**
   * Obtain the ACP client for an `agentRef`. Called AT MOST ONCE per `agentRef`
   * per run (the executor caches it), so the returned client is the shared,
   * session-reused counterparty for every acp node bound to that ref. The caller
   * decides how a ref maps to a launch config (a registry in a later wave).
   */
  getClient: (agentRef: string) => AcpAgentClient | Promise<AcpAgentClient>;
}

interface RunClientEntry {
  client: AcpAgentClient;
  /** Whether a session has been opened on this client yet. */
  sessionOpened: boolean;
  /**
   * Per-client critical section. Each node chains its (session-open + prompt)
   * work after the prior turn on this client, so concurrent parallel nodes on
   * one agentRef open exactly ONE shared session and their turns never interleave.
   */
  turnLock: Promise<unknown>;
}

const DEFAULT_AGENT_REF = 'default';

/**
 * Build a fresh ACP executor for ONE program run. The returned executor closes
 * over a per-run session manager, so calling `createAcpExecutor` again yields an
 * independent set of sessions — no session bleed across runs.
 */
export function createAcpExecutor(deps: AcpExecutorDeps): NodeExecutor {
  // Per-run session manager: agentRef -> a PROMISE of its shared client + session
  // state. Storing the promise (not the resolved entry) makes creation race-free:
  // concurrent parallel nodes all await the SAME in-flight creation, so exactly
  // one client is spawned and one session opened per agentRef per run.
  const entries = new Map<string, Promise<RunClientEntry>>();

  const ensureEntry = (agentRef: string): Promise<RunClientEntry> => {
    let p = entries.get(agentRef);
    if (!p) {
      p = (async (): Promise<RunClientEntry> => {
        const client = await deps.getClient(agentRef);
        await client.start();
        return { client, sessionOpened: false, turnLock: Promise.resolve() };
      })();
      // Set SYNCHRONOUSLY (before any await) so a second concurrent caller sees it.
      entries.set(agentRef, p);
    }
    return p;
  };

  return async (node, _state, ctx) => {
    const a = node.agent;
    if (!a || typeof a.prompt !== 'string' || a.prompt.trim() === '') {
      return { ok: false, error: 'ACP agent node has no prompt to run.' };
    }
    // If Stop already fired, do not spawn/prompt anything.
    if (ctx.signal?.aborted) {
      return { ok: false, error: 'Stopped before the ACP turn started.' };
    }

    const agentRef = a.acp?.agentRef ?? DEFAULT_AGENT_REF;
    const shareSession = a.acp?.shareSession !== false; // default: share (anti-priming)
    const prompt = a.prompt.trim();

    const entry = await ensureEntry(agentRef);

    // Acquire the per-client turn lock: chain after any in-flight turn on this
    // client. Reading `prior` and installing our own lock is synchronous here (no
    // await between), so concurrent nodes queue deterministically. The session
    // open decision AND the prompt run inside this section, so a shared session is
    // opened exactly once and turns never overlap.
    const prior = entry.turnLock;
    let release!: () => void;
    entry.turnLock = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prior.catch(() => undefined);
      // A turn that was still QUEUED when Stop fired: reject honestly, no fabricated done.
      if (ctx.signal?.aborted) {
        return { ok: false, error: 'Stopped before the ACP turn started.' };
      }

      // Open a session on first use of this ref, OR whenever the node opts out of
      // session sharing (a fresh session breaks priming for this node).
      if (!entry.sessionOpened || !shareSession) {
        await entry.client.newSession();
        entry.sessionOpened = true;
      }

      const { stopReason, text } = await entry.client.prompt(prompt, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      if (COMPLETED_STOP_REASONS.has(stopReason)) {
        return { ok: true, value: { stopReason, text } };
      }
      // Not a real completion — refusal / cancelled / truncated. Never fabricate done.
      return {
        ok: false,
        error: `ACP turn did not complete with an answer (stopReason: ${stopReason}).`,
      };
    } finally {
      release();
    }
  };
}
