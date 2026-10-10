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
import fs from 'node:fs';
import { Readable, Writable } from 'node:stream';
import type {
  Agent,
  Client,
  ClientSideConnection,
  McpServer,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  StopReason,
  ToolKind,
} from '@agentclientprotocol/sdk';

/**
 * THE SDK LOADS WHEN AN AGENT STARTS, NOT WHEN THIS PACKAGE IS IMPORTED.
 *
 * Measured 2026-10-05 on the analyzer server's boot: the SDK and the zod it
 * validates with were 88 of the 335 files Node loaded before the server could
 * answer, and the server imports this package for pure helpers (access modes,
 * permission policy) long before anyone drives an agent. Only `start()` needs
 * the runtime classes, so only `start()` loads them; the import is cached by
 * Node after the first agent.
 */
const loadSdk = () => import('@agentclientprotocol/sdk');
import {
  AccessModeRefusedError,
  BYPASS_UNAVAILABLE_HINT,
  agentErrorReason,
  agentKindOf,
  DRAW_INSTRUCTION,
  claudeOptionsFor,
  cliArgsFor,
  sessionModeIdsFor,
  type AgentKind,
} from './accessMode.js';
import { allowsTool, type AgentMode } from './planMode.js';
import { acpMcpServers, acpPromptBlocks, type AgentMcpServer, type PromptAttachment, type PromptCaps } from './promptContent.js';
import { isAcpProgress } from './turnWatchdog.js';
import { usageFromPrompt, type TurnUsage } from './turnUsage.js';
import type { AgentQuestionAnswers, AgentQuestionRequest } from './questions.js';

/**
 * The agent cannot reopen a session it opened before (no `session/resume`,
 * no `session/load`, or a transport with no threads). The caller opens a new
 * one and says so; it never pretends the old context came back.
 */
/**
 * The agent process ended (or never started) before it answered. Its message
 * names the exit code and the agent's own last words on stderr (round 7, A2).
 */
export class AgentExitedError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentExitedError';
  }
}

/**
 * The agent was killed because it ignored a cancel. The client is closed: its
 * conversation went with the process, and a silent fresh agent would answer the
 * next turn with none of it. Reopen the thread (a new client + resumeSession).
 */
export class AgentSessionClosedError extends Error {
  constructor(why = 'The agent was stopped and its session is closed; reopen the thread to continue.') {
    super(why);
    this.name = 'AgentSessionClosedError';
  }
}

export class ResumeUnavailableError extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'ResumeUnavailableError';
  }
}

/** See {@link AcpClientConfig.turnHooks}. */
export interface AgentTurnHooks {
  turnStarted?(turnId: string | undefined): unknown;
  willWrite?(paths: string[], turnId: string | undefined): unknown;
  turnDiff?(diff: string, turnId: string | undefined): unknown;
}

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

/**
 * A caller's decision on one permission request. `always` allows this one and
 * asks the agent not to ask again for the same thing this session (ACP
 * `allow_always`, codex `acceptForSession`).
 */
export type PermissionDecision = 'allow' | 'deny' | 'always';

/** The result of one prompt turn: an HONEST stop reason plus accumulated text. */
export interface AcpPromptResult {
  /** The real ACP stop reason the agent returned (never fabricated). */
  stopReason: StopReason;
  /** Text accumulated from streamed `agent_message_chunk` updates this turn. */
  text: string;
  /** Round 9: the token usage the agent reported for this turn (ACP `usage`), when it did. */
  usage?: TurnUsage;
}

export interface AcpPromptOptions {
  /** When it fires, an ACP `session/cancel` is sent for this turn. */
  signal?: AbortSignal;
  /** S2a: images, files and board nodes sent with the text (promptContent.ts). */
  attachments?: PromptAttachment[];
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
  /**
   * Reopen a session this agent opened before (ACP session/resume or
   * session/load, codex thread/resume) and make it the active one. Throws
   * {@link ResumeUnavailableError} when the agent cannot. Optional so test
   * doubles need not implement it.
   */
  resumeSession?(sessionId: string, cwd?: string, signal?: AbortSignal): Promise<string>;
  /**
   * Drop the last `numTurns` turns of the active thread (codex thread/revert,
   * or thread/rollback on an older app-server). Throws when the agent cannot;
   * the caller then opens a fresh thread seeded with the kept transcript.
   * Absent on ACP bridges, which have no rollback. Optional for test doubles.
   */
  rollbackTurns?(numTurns: number): Promise<void>;
  /** Roll the thread back so the turn with this provider id, and every later one, is gone. Throws when it cannot. */
  rollbackTo?(beforeTurnId: string): Promise<void>;
  /**
   * The provider's own id for the turn the last prompt (or compaction) started,
   * or undefined when the provider never accepted one. Set only by clients that
   * can name their turns; callers use it to know which saved turns are in the thread.
   */
  lastTurnId?(): string | undefined;
  prompt(text: string, opts?: AcpPromptOptions): Promise<AcpPromptResult>;
  dispose(): Promise<void>;
  /**
   * True once this client can no longer take a turn (the agent was force-killed
   * after ignoring a cancel, or disposed). A session cache treats a closed
   * client as dead: it disposes the entry and reopens the thread. Optional so
   * test doubles need not implement it.
   */
  isClosed?(): boolean;
  /**
   * Switch the live session's access mode (session/set_mode where the agent
   * offers it). Optional so test doubles need not implement it.
   */
  setAccessMode?(mode: AgentMode): Promise<void>;
  /**
   * S2b. What the agent offers the model picker and the `/` menu (ACP
   * configOptions and available commands; codex model/list and skills/list).
   */
  capabilities?(signal?: AbortSignal): Promise<AgentCapabilities>;
  /** S2b. The model and effort later turns run with (ACP set_config_option; codex turn/start overrides). */
  setTurnConfig?(cfg: AgentTurnConfig): Promise<void>;
  /**
   * Round 7 (A3). The model the session runs on, as the agent stated it: codex's
   * thread/start|resume `model` (or the turn's override), an ACP agent's model
   * config option's current value. Undefined until the agent has said.
   */
  activeModel?(): string | undefined;
  /** S2b. Compact the conversation's context (ACP `/compact`; codex thread/compact/start), as a turn. */
  compact?(opts?: AcpPromptOptions): Promise<AcpPromptResult>;
}

/** A model the agent can run, with the reasoning efforts it accepts. */
export interface AgentModel {
  id: string;
  name: string;
  description?: string;
  efforts: string[];
  defaultEffort?: string;
  isDefault?: boolean;
}

/** A slash command the CLI itself offers (ACP available_commands_update). */
export interface AgentCommand {
  name: string;
  description: string;
  hint?: string;
}

export interface AgentSkill {
  name: string;
  description: string;
}

export interface AgentCapabilities {
  models: AgentModel[];
  /** The model's reasoning levels when the agent lists them apart from the models (ACP thought_level). */
  efforts?: string[];
  commands: AgentCommand[];
  skills: AgentSkill[];
  /** ACP's own config options, verbatim. */
  configOptions: SessionConfigOption[];
}

export interface AgentTurnConfig {
  model?: string;
  effort?: string;
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
  /**
   * The agent asks the person a question (codex's item/tool/requestUserInput,
   * questions.ts). Resolve with the answers, or null for none. `signal`
   * aborts when the question is over without an answer (the turn ended, was
   * stopped, or codex resolved it); the adapter answers codex itself then.
   * Omitted ⇒ every question is answered with none, at once.
   */
  onQuestion?: (q: AgentQuestionRequest, signal: AbortSignal) => Promise<AgentQuestionAnswers | null>;
  /** Observe every streamed `session/update` notification (tokens, tool calls). */
  onUpdate?: (n: SessionNotification) => void;
  /**
   * Called when the agent makes real progress on a turn (text, a tool call, a
   * plan step), never for bookkeeping (usage, modes, status). Feeds the idle
   * watchdog (turnWatchdog.ts).
   */
  onProgress?: () => void;
  /** Metadata only: never sends stderr prose, prompts or tool bodies to the ledger. */
  onDiagnostic?: (e: { event: 'stderr' | 'processExit'; bytes?: number; exitCode?: number | null }) => void;
  /**
   * S3 turn snapshots, called in-process by the codex bridge: a turn started
   * (`turn/started`), the agent is about to write these paths (`item/started`
   * fileChange; a file-change approval is not answered until this has
   * resolved), and the turn's diff so far (`turn/diff/updated`). Calls are
   * chained in arrival order; a hook that throws is ignored.
   */
  turnHooks?: AgentTurnHooks;
  /** Grace before SIGTERM escalates to SIGKILL on dispose (default 2000ms). */
  killGraceMs?: number;
  /**
   * Stop must stop: after a cancel, the agent has this long (default 5000ms) to
   * end the turn. If it does not, its process is killed and the turn is
   * reported `cancelled`, so an uncooperative bridge cannot keep a chat busy.
   */
  cancelGraceMs?: number;
  /** Client identity sent in `initialize`. */
  clientInfo?: { name: string; version: string };
  /**
   * The Sequence access mode this agent runs under (`accessMode.ts`). When set it
   * reaches the agent unchanged: as `_meta.claudeCode.options` on session/new, as
   * session/set_mode where the agent advertises modes, and as argv for plain CLIs
   * and codex-acp. It also becomes the default permission policy (`allowsTool`),
   * so Full access answers every permission request with allow. Omitted ⇒ the
   * pre-existing behaviour, byte for byte.
   */
  accessMode?: AgentMode;
  /** Override the launch classification (default: `agentKindOf(command, args)`). */
  agentKind?: AgentKind;
  /**
   * S2a: MCP servers put into every session this client opens (Sequence's
   * board server). ACP: `mcpServers` on session/new|resume|load; codex: a
   * per-thread config override. The user's own config is never written.
   */
  mcpServers?: AgentMcpServer[];
}

/** Tool kinds that only READ — safe to allow under the conservative default. */
const READONLY_TOOL_KINDS: ReadonlyArray<ToolKind> = ['read', 'fetch', 'search', 'think'];

/** The conservative default: allow read-only tool calls, deny anything mutating. */
export function defaultPermissionPolicy(req: RequestPermissionRequest): PermissionDecision {
  const kind = req.toolCall.kind ?? undefined;
  return kind && READONLY_TOOL_KINDS.includes(kind) ? 'allow' : 'deny';
}

/**
 * Pick a concrete permission option matching a decision: the `_once` variant
 * for allow and deny, `allow_always` for always (falling back to once when the
 * agent offers no always).
 */
function pickOption(
  options: PermissionOption[],
  decision: PermissionDecision
): PermissionOption | undefined {
  const want =
    decision === 'always' ? ['allow_always', 'allow_once'] : decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
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
  /** The agent's last stderr lines, kept so an early exit can say why (round 7, A2). */
  private stderrTail: string[] = [];
  /** Set once the subprocess has exited and its pipes have closed. */
  private closed?: { code: number | null; signal: NodeJS.Signals | null };
  /** The agent was killed after a cancel it ignored: the next prompt() starts a new one. */
  /** Set when a cancel went unanswered and the agent was killed: no further turn runs on this client. */
  private forceKilled = false;
  private closedWaiters: (() => void)[] = [];
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
  /** The access mode in force (see {@link AcpClientConfig.accessMode}). */
  private accessMode?: AgentMode;
  /** The session modes the agent advertised on session/new, if any. */
  private sessionModes?: { current: string; available: string[] };
  /** What the agent said it can do in `initialize` (resume / load). */
  private canResume = false;
  private canLoad = false;
  /** S2a: what initialize said a prompt may carry (images, embedded resources). */
  private promptCaps: PromptCaps = { image: false, embeddedContext: false };
  /**
   * THE LOAD-REPLAY GATE (after Synara's acp/AcpLoadReplayGate.ts, MIT). While
   * session/load runs, the agent streams the session's whole history back as
   * session/update notifications. That history is not this turn's: it is held
   * back here (counted, not forwarded), so a resumed chat never shows its past
   * twice and the watchdog never reads it as progress.
   */
  private loadingSessionId?: string;
  /** Replayed history notifications held back by the gate, for tests. */
  heldReplay = 0;
  /** S2b: the session's config options (model, effort, mode) as the agent last stated them. */
  private configOptions: SessionConfigOption[] = [];
  /** S2b: the CLI's own slash commands, as the agent last listed them. */
  private commands: AgentCommand[] = [];
  private commandsSeen: (() => void)[] = [];

  constructor(config: AcpClientConfig) {
    this.config = config;
    this.spawn = config.spawn ?? childProcess.spawn;
    this.killGraceMs = config.killGraceMs ?? 2000;
    this.accessMode = config.accessMode;
  }

  /** The permission decision when the caller registered no `onPermission`. */
  private defaultDecision(params: RequestPermissionRequest): PermissionDecision {
    if (!this.accessMode) return defaultPermissionPolicy(params);
    return allowsTool(this.accessMode, params.toolCall.kind ?? undefined) ? 'allow' : 'deny';
  }

  /** The Client handler the agent talks back to: streaming + the permission gate. */
  private buildHandler(): Client {
    return {
      sessionUpdate: (params: SessionNotification): void => {
        if (this.loadingSessionId !== undefined && params.sessionId === this.loadingSessionId) {
          this.heldReplay += 1;
          return;
        }
        const u = params.update;
        if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
          this.turnText += u.content.text;
        }
        if (isAcpProgress(u.sessionUpdate)) this.config.onProgress?.();
        if (u.sessionUpdate === 'config_option_update') this.configOptions = u.configOptions;
        if (u.sessionUpdate === 'available_commands_update') {
          this.commands = u.availableCommands.map((c) => ({
            name: c.name,
            description: c.description,
            ...(c.input && typeof (c.input as { hint?: unknown }).hint === 'string' ? { hint: (c.input as { hint: string }).hint } : {}),
          }));
          for (const f of this.commandsSeen.splice(0)) f();
        }
        this.config.onUpdate?.(params);
      },
      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        const decision = this.config.onPermission
          ? await this.config.onPermission(params)
          : this.defaultDecision(params);
        const chosen = pickOption(params.options, decision);
        // A conservative fallback: if we wanted to deny but the agent offered no
        // reject option, cancel the request rather than silently allowing.
        if (!chosen) {
          const denyFallback = decision !== 'deny' ? pickOption(params.options, 'deny') : undefined;
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
    const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } = await loadSdk();
    /* Re-checked after the await: a concurrent start() that got here first has
       already spawned, and a second subprocess would be an orphan. */
    if (this.conn) return;
    const modeArgs = this.accessMode
      ? cliArgsFor(this.config.agentKind ?? agentKindOf(this.config), this.accessMode)
      : [];
    const child = this.spawn(this.config.command, [...(this.config.args ?? []), ...modeArgs], {
      cwd: this.config.cwd ?? process.cwd(),
      env: this.config.env ?? process.env,
      /* stdin/stdout carry ACP. stderr is read, not inherited: the packaged app
         has no console to inherit, and an agent that dies early must be able to
         say why (its last lines go into the error). It is still echoed to ours. */
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.stderrTail = [];
    this.closed = undefined;
    this.forceKilled = false; // an explicit start() is a deliberate new process
    child.stderr?.on('data', (b: Buffer) => {
      this.config.onDiagnostic?.({ event: 'stderr', bytes: b.length });
      const s = String(b);
      try {
        process.stderr.write(s);
      } catch {
        /* no stderr to echo to */
      }
      this.stderrTail.push(...s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      if (this.stderrTail.length > 12) this.stderrTail = this.stderrTail.slice(-12);
    });
    child.once('close', (code: number | null, sig: NodeJS.Signals | null) => {
      this.config.onDiagnostic?.({ event: 'processExit', exitCode: code });
      /* A killed agent's late exit must not mark its replacement closed. */
      if (!this.child || this.child === child) this.closed = { code, signal: sig };
      for (const f of this.closedWaiters.splice(0)) f();
    });
    // Spawn errors surface as a failed initialize / closed stream (explained
    // below), and dispose() still cleans up.
    let spawnError: Error | undefined;
    child.once('error', (e) => {
      spawnError = e;
      this.closed ??= { code: null, signal: null };
      for (const f of this.closedWaiters.splice(0)) f();
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('ACP agent subprocess did not expose stdio pipes.');
    }
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );
    const handler = this.buildHandler();
    this.conn = new ClientSideConnection((_agent: Agent) => handler, stream);

    let init: Awaited<ReturnType<ClientSideConnection['initialize']>>;
    try {
      init = await AcpClient.raceAbort(
        this.conn.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: this.config.clientInfo ?? { name: '@sequence/acp', version: '0.1.0' },
        }),
        signal
      );
    } catch (e) {
      throw await this.explainFailure(e, spawnError);
    }
    const caps = init?.agentCapabilities;
    this.canResume = Boolean(caps?.sessionCapabilities?.resume);
    this.canLoad = caps?.loadSession === true;
    this.promptCaps = { image: caps?.promptCapabilities?.image === true, embeddedContext: caps?.promptCapabilities?.embeddedContext === true };
  }

  /** S2a: the session's MCP servers in ACP's shape (McpServerStdio). */
  private mcpServers(): McpServer[] {
    return acpMcpServers(this.config.mcpServers) as unknown as McpServer[];
  }

  /**
   * `_meta.claudeCode.options` for session/new: the access mode's, and (S2a)
   * Sequence's board tools allowed without asking (they only read). Undefined
   * when there is nothing to say, so a plain config sends what it always did.
   */
  private claudeOptions(): Record<string, unknown> | undefined {
    const mode = this.accessMode ? claudeOptionsFor(this.accessMode) : undefined;
    const board = this.config.mcpServers?.some((s) => s.name === 'sequence') ? { allowedTools: ['mcp__sequence__*'] } : undefined;
    return mode || board ? { ...mode, ...board } : undefined;
  }

  /**
   * The `_meta` for session/new. Claude's options as before, and (lane visual) for claude-agent-acp
   * one appended system-prompt line saying a fenced svg or html block is drawn in the chat.
   */
  private sessionMeta(promptOnly = false): { _meta?: Record<string, unknown> } {
    /* A resume/load carries only the drawing line: claude-agent-acp rebuilds its system prompt from each call's _meta. */
    const options = promptOnly ? undefined : this.claudeOptions();
    const claude = (this.config.agentKind ?? agentKindOf(this.config)) === 'claude-acp';
    if (!options && !claude) return {};
    return { _meta: { ...(options ? { claudeCode: { options } } : {}), ...(claude ? { systemPrompt: { append: DRAW_INSTRUCTION } } : {}) } };
  }

  /**
   * Reopen `sessionId`: session/resume where the agent offers it (no history
   * comes back), otherwise session/load behind the load-replay gate. Under an
   * access mode the session is put in that mode before it is adopted, as
   * {@link newSession} does.
   */
  async resumeSession(sessionId: string, cwd?: string, signal?: AbortSignal): Promise<string> {
    if (!this.conn) throw new Error('AcpClient.start() must be called before resumeSession().');
    if (!this.canResume && !this.canLoad) throw new ResumeUnavailableError('the agent offers neither session/resume nor session/load');
    const dir = cwd ?? this.config.cwd ?? process.cwd();
    let res: { modes?: { currentModeId: string; availableModes: { id: string }[] } | null; configOptions?: SessionConfigOption[] | null };
    if (this.canResume) {
      res = await AcpClient.raceAbort(this.conn.resumeSession({ sessionId, cwd: dir, mcpServers: this.mcpServers(), ...this.sessionMeta(true) }), signal);
    } else {
      this.loadingSessionId = sessionId;
      try {
        res = (await AcpClient.raceAbort(this.conn.loadSession({ sessionId, cwd: dir, mcpServers: this.mcpServers(), ...this.sessionMeta(true) }), signal)) ?? {};
      } finally {
        this.loadingSessionId = undefined;
      }
    }
    this.sessionId = undefined;
    this.sessionModes = res.modes
      ? { current: res.modes.currentModeId, available: res.modes.availableModes.map((m) => m.id) }
      : undefined;
    if (this.accessMode) await this.applySessionMode(sessionId, this.accessMode);
    this.sessionId = sessionId;
    this.adoptConfigOptions(res.configOptions);
    return sessionId;
  }

  /**
   * Open a fresh session in `cwd`. Replaces any prior session id (isolation).
   *
   * Under an access mode the session is only adopted once the agent is IN that
   * mode: a refusal (the agent rejects bypass, or offers no bypass mode) throws
   * {@link AccessModeRefusedError} with the agent's reason and leaves no session
   * behind, so a later prompt cannot quietly run in a weaker mode.
   */
  async newSession(cwd?: string, signal?: AbortSignal): Promise<string> {
    if (!this.conn) throw new Error('AcpClient.start() must be called before newSession().');
    const mode = this.accessMode;
    let res: Awaited<ReturnType<ClientSideConnection['newSession']>>;
    try {
      res = await AcpClient.raceAbort(
        this.conn.newSession({
          cwd: cwd ?? this.config.cwd ?? process.cwd(),
          mcpServers: this.mcpServers(),
          ...this.sessionMeta(),
        }),
        signal
      );
    } catch (e) {
      const why = await this.explainFailure(e);
      if (why instanceof AgentExitedError) throw why;
      if (mode === 'full' && !signal?.aborted) throw new AccessModeRefusedError(mode, agentErrorReason(e));
      throw e;
    }
    this.sessionId = undefined;
    this.sessionModes = res.modes
      ? { current: res.modes.currentModeId, available: res.modes.availableModes.map((m) => m.id) }
      : undefined;
    if (mode) await this.applySessionMode(res.sessionId, mode);
    this.sessionId = res.sessionId;
    this.adoptConfigOptions(res.configOptions);
    return res.sessionId;
  }

  /**
   * Switch the live session to `mode`. Later sessions open in it too. A no-op on
   * the wire when the agent advertises no session modes (the mode still governs
   * this client's permission answers).
   */
  async setAccessMode(mode: AgentMode): Promise<void> {
    this.accessMode = mode;
    if (this.sessionId) await this.applySessionMode(this.sessionId, mode);
  }

  /** session/set_mode to the advertised id for `mode`, when it differs from the current one. */
  private async applySessionMode(sessionId: string, mode: AgentMode): Promise<void> {
    const modes = this.sessionModes;
    if (!modes || !this.conn) return;
    const target = sessionModeIdsFor(mode).find((id) => modes.available.includes(id));
    if (!target) {
      if (mode === 'full') {
        throw new AccessModeRefusedError(
          mode,
          `the agent offers no bypass mode (it offers: ${modes.available.join(', ') || 'none'}). ${BYPASS_UNAVAILABLE_HINT}`
        );
      }
      return;
    }
    if (modes.current === target) return;
    try {
      await this.conn.setSessionMode({ sessionId, modeId: target });
    } catch (e) {
      throw new AccessModeRefusedError(mode, agentErrorReason(e));
    }
    modes.current = target;
  }

  /** The active session id, if a session has been opened. */
  /**
   * The session's config options, from session/new (or resume/load). Passed
   * on as a config_option_update, so the stream carries them like any update
   * the agent sends itself.
   */
  private adoptConfigOptions(opts: SessionConfigOption[] | null | undefined): void {
    if (!opts || opts.length === 0 || !this.sessionId) return;
    this.configOptions = opts;
    this.config.onUpdate?.({ sessionId: this.sessionId, update: { sessionUpdate: 'config_option_update', configOptions: opts } });
  }

  /**
   * What the agent offers the picker and the `/` menu. Opens a session when
   * there is none (an agent states its options and commands per session),
   * and waits up to `waitMs` for the commands, which arrive just after
   * session/new.
   */
  async capabilities(signal?: AbortSignal, waitMs = 1500): Promise<AgentCapabilities> {
    if (!this.sessionId) await this.newSession(undefined, signal);
    if (this.commands.length === 0 && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, waitMs);
        this.commandsSeen.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    const pick = (cats: string[]) => this.configOptions.find((o) => cats.includes(o.category ?? '') || cats.includes(o.id)) as { options?: unknown[] } | undefined;
    const flat = (o: { options?: unknown[] } | undefined): { value: string; name: string; description?: string | null }[] =>
      (o?.options ?? []).flatMap((x) => {
        const g = x as { options?: unknown[] };
        return (Array.isArray(g.options) ? g.options : [x]) as { value: string; name: string; description?: string | null }[];
      });
    const efforts = flat(pick(['thought_level', 'effort'])).map((x) => x.value);
    const models: AgentModel[] = flat(pick(['model'])).map((m) => ({
      id: m.value,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      efforts,
    }));
    return { models, ...(efforts.length ? { efforts } : {}), commands: this.commands, skills: [], configOptions: this.configOptions };
  }

  /** Model and effort through session/set_config_option, on the options the agent offers. */
  async setTurnConfig(cfg: AgentTurnConfig): Promise<void> {
    if (!this.conn || !this.sessionId) return;
    const want: [string[], string | undefined][] = [
      [['model'], cfg.model],
      [['thought_level', 'effort'], cfg.effort],
    ];
    for (const [cats, value] of want) {
      if (!value) continue;
      const opt = this.configOptions.find((o) => cats.includes(o.category ?? '') || cats.includes(o.id)) as { id: string; currentValue?: unknown } | undefined;
      if (!opt || opt.currentValue === value) continue;
      const res = (await this.conn.setSessionConfigOption({ sessionId: this.sessionId, configId: opt.id, value })) as { configOptions?: SessionConfigOption[] } | undefined;
      if (res?.configOptions) this.configOptions = res.configOptions;
    }
  }

  /** The model config option's current value, as the agent last stated it. */
  activeModel(): string | undefined {
    const opt = this.configOptions.find((o) => o.category === 'model' || o.id === 'model') as { currentValue?: unknown } | undefined;
    return typeof opt?.currentValue === 'string' && opt.currentValue ? opt.currentValue : undefined;
  }

  /** Compact the conversation: the CLI's own `/compact`, as a turn. */
  compact(opts: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    return this.prompt('/compact', opts);
  }

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
    if (this.forceKilled) throw new AgentSessionClosedError();
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

    let forcedKill = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      // Notification — best-effort; the agent responds to prompt with 'cancelled'.
      this.conn?.cancel({ sessionId }).catch(() => {});
      /* The agent did not confirm in time: kill it. The prompt then rejects
         with a closed connection, which is reported as the stop it was. */
      killTimer = setTimeout(() => {
        forcedKill = true;
        /* Nothing of this connection is usable any more. The client is closed rather than quietly
           restarted: a fresh agent would start a new, empty conversation under the old thread's name. */
        this.conn = undefined;
        this.sessionId = undefined;
        this.forceKilled = true;
        void this.stopChild();
      }, this.config.cancelGraceMs ?? 5000);
      (killTimer as { unref?: () => void }).unref?.();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.conn.prompt({
        sessionId,
        /* S2a: images, files and board nodes as the agent's capabilities allow. */
        prompt: acpPromptBlocks(text, opts.attachments, this.promptCaps, (p) => fs.readFileSync(p).toString('base64')) as unknown as Parameters<ClientSideConnection['prompt']>[0]['prompt'],
      });
      const usage = usageFromPrompt((res as { usage?: unknown }).usage);
      return { stopReason: res.stopReason, text: this.turnText, ...(usage ? { usage } : {}) };
    } catch (e) {
      if (forcedKill) return { stopReason: 'cancelled', text: this.turnText };
      throw await this.explainFailure(e);
    } finally {
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * THE REAL REASON (round 7, A2). When the agent process dies, the SDK only
   * knows its pipe closed ("ACP connection closed"), which tells the person
   * nothing. If the subprocess is gone (or goes within a moment), the error
   * names its exit code and its last stderr lines instead: a missing module, a
   * sign-in prompt, a usage limit (which recoveryOf maps to wait-until-reset).
   * An error from an agent that is still running is returned unchanged.
   */
  private async explainFailure(e: unknown, spawnError?: Error): Promise<Error> {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.message === 'aborted') return err;
    if (spawnError) return new AgentExitedError(`The agent could not be started: ${spawnError.message}`, null, '', { cause: spawnError });
    if (!this.closed && this.child) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500);
        this.closedWaiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (!this.closed) return err;
    const { code, signal } = this.closed;
    const how = code !== null ? `code ${code}` : signal ? `signal ${signal}` : 'no exit code';
    const said = this.stderrTail.slice(-4).join('\n').slice(-800);
    const what = said || (!/connection closed/i.test(err.message) ? err.message : 'it printed nothing');
    return new AgentExitedError(`The agent process exited (${how}): ${what}`, code, said, { cause: err });
  }

  /** Cancel any in-flight turn and kill the subprocess (SIGTERM→SIGKILL). */
  async dispose(): Promise<void> {
    if (this.sessionId && this.conn) {
      void this.conn.cancel({ sessionId: this.sessionId }).catch(() => {});
    }
    await this.stopChild();
    this.conn = undefined;
    this.sessionId = undefined;
  }

  /** See {@link AcpAgentClient.isClosed}. */
  isClosed(): boolean {
    return this.forceKilled || this.closed !== undefined;
  }

  /** SIGTERM, then SIGKILL after the grace window; resolves once the child exits. */
  private stopChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return Promise.resolve();
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
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
      timer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, this.killGraceMs);
    });
  }
}
