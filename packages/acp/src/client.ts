/**
 * `AcpClient` — a thin, honest ACP *client* we control, built directly on the
 * Apache-2.0 `@agentclientprotocol/sdk` (v1.2.1). It drives a LOCAL coding-agent
 * subprocess (the user's own Claude Code / Codex / Gemini) over the ACP wire
 * protocol on stdio, exactly the way an editor drives a language server.
 *
 * HONESTY DISCIPLINE (the whole point of v16):
 *  - A prompt turn resolves `{ stopReason, text }` ONLY when the agent actually
 *    returns a `session/prompt` response with a real ACP `stopReason`. We never
 *    fabricate a completion — the caller decides which stop reasons count as a
 *    real "done" (see `executor.ts`; only `end_turn` does).
 *  - Abort is real: an `AbortSignal` fires an ACP `session/cancel` notification
 *    for the in-flight turn, and `dispose()` escalates SIGTERM→SIGKILL so the
 *    subprocess truly dies — no orphaned agent, no double-billed turn.
 *  - The permission policy defaults CONSERVATIVE: read-only tool calls are
 *    allowed, everything that can mutate the repo is denied unless the caller
 *    opts in via `onPermission`.
 *
 * TESTABILITY: `spawn` is injectable (the gitClone pattern). The real default
 * spawns the configured agent binary; tests spawn a conformant mock ACP agent
 * (`test/fixtures/mock-agent.mjs`) for a genuine subprocess round-trip, and an
 * injected fake `spawn` exercises the kill lifecycle with no real process.
 *
 * The SDK surface used (verified against the installed `.d.ts`):
 *   - `ndJsonStream(output, input)` wraps stdio as an ACP `Stream`.
 *   - `class ClientSideConnection implements Agent` — constructed with
 *     `(toClient: (agent) => Client, stream)`; exposes `initialize`,
 *     `newSession`, `prompt`, and the `cancel` notification.
 *   - the `Client` handler we register carries `sessionUpdate` (streaming) and
 *     `requestPermission` (the gate).
 */

import childProcess from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
  type ToolKind,
} from '@agentclientprotocol/sdk';

/** The agent binary launch configuration. */
export interface AcpAgentLaunch {
  /** The agent binary/command to spawn (e.g. `npx`, `claude-code-acp`). */
  command: string;
  /** Arguments for the command. */
  args?: string[];
  /** Working directory the session runs in (the repo). Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment for the subprocess. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** A caller's decision on one permission request. */
export type PermissionDecision = 'allow' | 'deny';

/** The result of one prompt turn: an HONEST stop reason plus accumulated text. */
export interface AcpPromptResult {
  /** The real ACP stop reason the agent returned (never fabricated). */
  stopReason: StopReason;
  /** Text accumulated from streamed `agent_message_chunk` updates this turn. */
  text: string;
}

export interface AcpPromptOptions {
  /** When it fires, an ACP `session/cancel` is sent for this turn. */
  signal?: AbortSignal;
}

/**
 * The minimal client contract the executor depends on — implemented by
 * {@link AcpClient} and by test doubles (so the executor is unit-testable with
 * no subprocess).
 */
export interface AcpAgentClient {
  /** Spawn + `initialize`. An optional signal makes a hang during init abortable. */
  start(signal?: AbortSignal): Promise<void>;
  /** Open a session. An optional signal makes a hang during `newSession` abortable. */
  newSession(cwd?: string, signal?: AbortSignal): Promise<string>;
  prompt(text: string, opts?: AcpPromptOptions): Promise<AcpPromptResult>;
  dispose(): Promise<void>;
}

export interface AcpClientConfig extends AcpAgentLaunch {
  /** Injectable spawn (default: real `child_process.spawn`). */
  spawn?: typeof childProcess.spawn;
  /**
   * Permission policy. Called for each agent `requestPermission`. Return
   * `'allow'` / `'deny'`. Omitted ⇒ the CONSERVATIVE default: read-only tool
   * kinds allowed, everything mutating denied.
   */
  onPermission?: (req: RequestPermissionRequest) => PermissionDecision | Promise<PermissionDecision>;
  /** Observe every streamed `session/update` notification (tokens, tool calls). */
  onUpdate?: (n: SessionNotification) => void;
  /** Grace before SIGTERM escalates to SIGKILL on dispose (default 2000ms). */
  killGraceMs?: number;
  /** Client identity sent in `initialize`. */
  clientInfo?: { name: string; version: string };
}

/** Tool kinds that only READ — safe to allow under the conservative default. */
const READONLY_TOOL_KINDS: ReadonlyArray<ToolKind> = ['read', 'fetch', 'search', 'think'];

/** The conservative default: allow read-only tool calls, deny anything mutating. */
export function defaultPermissionPolicy(req: RequestPermissionRequest): PermissionDecision {
  const kind = req.toolCall.kind ?? undefined;
  return kind && READONLY_TOOL_KINDS.includes(kind) ? 'allow' : 'deny';
}

/** Pick a concrete permission option matching a decision, preferring the `_once` variant. */
function pickOption(
  options: PermissionOption[],
  decision: PermissionDecision
): PermissionOption | undefined {
  const want = decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
  for (const k of want) {
    const found = options.find((o) => o.kind === k);
    if (found) return found;
  }
  return undefined;
}

export class AcpClient implements AcpAgentClient {
  private readonly config: AcpClientConfig;
  private readonly spawn: typeof childProcess.spawn;
  private readonly killGraceMs: number;

  private child?: childProcess.ChildProcess;
  private conn?: ClientSideConnection;
  private sessionId?: string;
  /** Text accumulated from streamed chunks for the CURRENT turn. */
  private turnText = '';
  /**
   * Serializes prompt turns on THIS client. An ACP session is single-turn — its
   * `sessionId`/`turnText` are one-at-a-time instance state, so two overlapping
   * `prompt()` calls would corrupt each other. Every `prompt()` chains after the
   * prior turn on this promise, so concurrent callers run strictly one after
   * another (a queued turn that is aborted before it starts reports `cancelled`,
   * never a fabricated completion). Predecessor failures do not block successors.
   */
  private turnQueue: Promise<unknown> = Promise.resolve();

  constructor(config: AcpClientConfig) {
    this.config = config;
    this.spawn = config.spawn ?? childProcess.spawn;
    this.killGraceMs = config.killGraceMs ?? 2000;
  }

  /** The Client handler the agent talks back to: streaming + the permission gate. */
  private buildHandler(): Client {
    return {
      sessionUpdate: (params: SessionNotification): void => {
        const u = params.update;
        if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
          this.turnText += u.content.text;
        }
        this.config.onUpdate?.(params);
      },
      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        const decision = this.config.onPermission
          ? await this.config.onPermission(params)
          : defaultPermissionPolicy(params);
        const chosen =
          decision === 'allow'
            ? pickOption(params.options, 'allow')
            : pickOption(params.options, 'deny');
        // A conservative fallback: if we wanted to deny but the agent offered no
        // reject option, cancel the request rather than silently allowing.
        if (!chosen) {
          const denyFallback = decision === 'allow' ? pickOption(params.options, 'deny') : undefined;
          if (denyFallback) return { outcome: { outcome: 'selected', optionId: denyFallback.optionId } };
          return { outcome: { outcome: 'cancelled' } };
        }
        return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
      },
    };
  }

  /**
   * Race a pending SDK request against an abort signal so a hang during
   * `initialize`/`newSession` (before any prompt) is abortable. The underlying
   * subprocess is torn down by the caller's `dispose()`; this just stops the
   * await from blocking forever. Rejects with an `aborted` Error when the signal
   * fires (or is already aborted).
   */
  private static raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e as Error);
        }
      );
    });
  }

  /** Spawn the agent subprocess, wire ACP over its stdio, and negotiate `initialize`. */
  async start(signal?: AbortSignal): Promise<void> {
    if (this.conn) return;
    const child = this.spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd ?? process.cwd(),
      env: this.config.env ?? process.env,
      // stderr inherited so a crashing agent is visible; stdin/stdout carry ACP.
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.child = child;
    // Swallow spawn errors here — they surface as a failed initialize / closed
    // stream, and dispose() still cleans up.
    child.once('error', () => {});

    if (!child.stdin || !child.stdout) {
      throw new Error('ACP agent subprocess did not expose stdio pipes.');
    }
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );
    const handler = this.buildHandler();
    this.conn = new ClientSideConnection((_agent: Agent) => handler, stream);

    await AcpClient.raceAbort(
      this.conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: this.config.clientInfo ?? { name: '@sequence/acp', version: '0.1.0' },
      }),
      signal
    );
  }

  /** Open a fresh session in `cwd`. Replaces any prior session id (isolation). */
  async newSession(cwd?: string, signal?: AbortSignal): Promise<string> {
    if (!this.conn) throw new Error('AcpClient.start() must be called before newSession().');
    const res = await AcpClient.raceAbort(
      this.conn.newSession({
        cwd: cwd ?? this.config.cwd ?? process.cwd(),
        mcpServers: [],
      }),
      signal
    );
    this.sessionId = res.sessionId;
    return res.sessionId;
  }

  /** The active session id, if a session has been opened. */
  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Run ONE prompt turn in the active session, SERIALIZED behind any in-flight
   * turn on this client (see {@link turnQueue}). Concurrent `prompt()` calls
   * therefore never interleave — each turn's streamed text is captured cleanly,
   * and a turn queued behind another that is aborted before it starts reports a
   * real `cancelled` (no fabricated completion). A predecessor's failure does not
   * block this turn.
   */
  async prompt(text: string, opts: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    const prior = this.turnQueue;
    const run = (async (): Promise<AcpPromptResult> => {
      await prior.catch(() => undefined); // wait our turn; predecessor errors don't block us
      return this.runTurn(text, opts);
    })();
    // Keep the chain alive regardless of THIS turn's outcome so the next caller
    // still queues correctly after us.
    this.turnQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** The single-turn body — only ever entered one-at-a-time via {@link turnQueue}. */
  private async runTurn(text: string, opts: AcpPromptOptions): Promise<AcpPromptResult> {
    if (!this.conn) throw new Error('AcpClient.start() must be called before prompt().');
    if (!this.sessionId) await this.newSession();
    const sessionId = this.sessionId!;
    this.turnText = '';
    const signal = opts.signal;

    // Already aborted before we begin: cancel and report honestly.
    if (signal?.aborted) {
      await this.conn.cancel({ sessionId }).catch(() => {});
      return { stopReason: 'cancelled', text: this.turnText };
    }

    const onAbort = (): void => {
      // Notification — best-effort; the agent responds to prompt with 'cancelled'.
      this.conn?.cancel({ sessionId }).catch(() => {});
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.conn.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });
      return { stopReason: res.stopReason, text: this.turnText };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /** Cancel any in-flight turn and kill the subprocess (SIGTERM→SIGKILL). */
  async dispose(): Promise<void> {
    if (this.sessionId && this.conn) {
      await this.conn.cancel({ sessionId: this.sessionId }).catch(() => {});
    }
    await this.stopChild();
    this.conn = undefined;
    this.sessionId = undefined;
  }

  /** SIGTERM, then SIGKILL after the grace window; resolves once the child exits. */
  private stopChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return Promise.resolve();
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      child.once('exit', done);
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      const timer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, this.killGraceMs);
    });
  }
}
