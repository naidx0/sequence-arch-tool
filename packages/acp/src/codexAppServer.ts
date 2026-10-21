/* ══════════════════════════════════════════════════════════════════════════
   CODEX THROUGH `codex app-server` — so Ask can actually ask
   packages/acp/src/codexAppServer.ts

   Measured 2026-10-05 against codex-cli 0.153.4: under `codex exec` every mode
   reports `approval: never`. Ask (read-only) therefore never asks; it just
   cannot write, and the person is never shown the question. `codex app-server`
   is the same agent over JSON-RPC on stdio, and it sends the client a REQUEST
   before an edit or command the sandbox does not cover. That request is the
   approval this file turns into an ACP permission request, so it travels the
   exact path every ACP agent's request already travels: `onPermission` when the
   caller registered one, otherwise `allowsTool(mode, kind)`.

   PROTOCOL SOURCE. Every method and field below is from the installed binary's
   own bindings (`codex app-server generate-ts`), not from memory:
     client -> server  initialize, initialized (notification), thread/start,
                       turn/start, turn/interrupt
     server -> client  item/fileChange/requestApproval,
                       item/commandExecution/requestApproval,
                       item/tool/requestUserInput              (answered)
                       item/started, item/completed, item/agentMessage/delta,
                       turn/completed, error                    (notifications)

   FALLBACK. A codex without the subcommand exits before answering
   `initialize` (clap: "unrecognized subcommand"). Then, and only then, each
   turn runs as `codex exec <mode flags> <prompt>`, which cannot ask: the
   sandbox is the only guard, as it was before this file.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';
import readline from 'node:readline';
import type {
  PermissionOption,
  RequestPermissionRequest,
  SessionNotification,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { agentKindOf, cliArgsFor, codexThreadInstructionsFor, codexOptionsFor, type CodexOptions } from './accessMode.js';
import {
  AcpClient,
  ResumeUnavailableError,
  defaultPermissionPolicy,
  type AcpAgentClient,
  type AcpClientConfig,
  type AcpPromptOptions,
  type AcpPromptResult,
  type AgentCapabilities,
  type AgentModel,
  type AgentSkill,
  type AgentTurnConfig,
  type PermissionDecision,
} from './client.js';
import { allowsTool, type AgentMode } from './planMode.js';
import { AgentTurnError, isUsageLimit } from './recovery.js';
import { isCodexProgress } from './turnWatchdog.js';
import { codexUpdate } from './codexUpdates.js';
import { codexSteer, type SteerOutcome } from './steer.js';
import { codexInputItems, codexMcpConfig } from './promptContent.js';
import { codexQuestionRequestOf, codexQuestionResponse } from './questions.js';

type Json = Record<string, unknown>;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface Turn {
  threadId: string;
  turnId?: string;
  text: string;
  /** agentMessage items that streamed deltas, so their completed text is not added twice. */
  streamed: Set<string>;
  resolve: (r: AcpPromptResult) => void;
  reject: (e: Error) => void;
}

/** The options an approval is answered with, as ACP agents offer them. Always is codex's session accept. */
const APPROVAL_OPTIONS: PermissionOption[] = [
  { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
  { optionId: 'acceptForSession', name: 'Always', kind: 'allow_always' },
  { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
];

/** Codex's sandbox mode as the `turn/start` policy object (v2 `SandboxPolicy`). */
function sandboxPolicy(sandbox: CodexOptions['sandbox']): Json {
  switch (sandbox) {
    case 'read-only':
      return { type: 'readOnly', networkAccess: false };
    case 'workspace-write':
      return { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    case 'danger-full-access':
      return { type: 'dangerFullAccess' };
  }
}

/**
 * S2a: whether each installed codex (its command line) offers the
 * experimental plan mode: true / false once asked, absent until then.
 * Process-wide, so the question is asked once, not once per chat.
 */
const CODEX_EXPERIMENTAL = new Map<string, boolean>();

/**
 * E3 (0.1.7): each installed codex's last model/list, process-wide. The picker asks on its own
 * short-lived client; the client that runs the turn reads it here, so a turn never runs on a
 * config.toml model the sign-in is not offered.
 */
const CODEX_LISTED = new Map<string, AgentModel[]>();

/** A sign-in change (disconnect, connect): the next turn must not use the old account's model list. */
export function forgetCodexModels(): void {
  CODEX_LISTED.clear();
}

/** Tests: forget what was learned about installed codexes. */
export function resetCodexExperimentalCache(): void {
  CODEX_EXPERIMENTAL.clear();
  CODEX_LISTED.clear();
}

/** The thread has fewer turns than the rollback asked to drop. */
export class RollbackShortError extends Error {
  constructor(asked: number) {
    super(`the thread has fewer than ${asked} turns to roll back`);
    this.name = 'RollbackShortError';
  }
}

export class CodexAppServerClient implements AcpAgentClient {
  private readonly config: AcpClientConfig;
  private readonly spawn: typeof childProcess.spawn;
  private readonly killGraceMs: number;
  private accessMode?: AgentMode;

  private child?: childProcess.ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Items seen in this turn, so an approval request (which names only an item id) can say what it is about. */
  private readonly items = new Map<string, Json>();
  private turn?: Turn;
  private threadId?: string;
  /** S2a: the model codex says the thread runs on (thread/start|resume), for plan mode's settings. */
  private threadModel?: string;
  private stderrTail: string[] = [];
  private exited?: string;
  /** 'exec' once `app-server` turned out not to exist on this codex. */
  private transport?: 'app-server' | 'exec';
  private turnQueue: Promise<unknown> = Promise.resolve();
  /**
   * The account's rate-limit windows codex last reported (account/rateLimits/updated),
   * by limit id: how full each is and when it resets (epoch s). A failed turn
   * that codex calls `usageLimitExceeded` names the fullest one's reset time.
   */
  private readonly limits = new Map<string, { usedPercent: number; resetsAt: number }>();
  /** S3 snapshot hooks, chained in the order codex sent their notifications. */
  private hookChain: Promise<unknown> = Promise.resolve();
  /**
   * Questions codex is waiting on (item/tool/requestUserInput), by codex's
   * request id. Aborting one answers it with no answer, at once: the turn
   * ending, a Stop, or teardown never leaves codex waiting on a person.
   */
  private readonly questions = new Map<string, AbortController>();

  /** End every waiting question: each is answered with no answer (onQuestion). */
  private endQuestions(): void {
    for (const ac of this.questions.values()) ac.abort();
    this.questions.clear();
  }

  private hook(fn: (h: NonNullable<AcpClientConfig['turnHooks']>) => unknown): void {
    const h = this.config.turnHooks;
    if (!h) return;
    this.hookChain = this.hookChain.then(() => fn(h)).catch(() => undefined);
  }

  constructor(config: AcpClientConfig) {
    this.config = config;
    this.spawn = config.spawn ?? childProcess.spawn;
    this.killGraceMs = config.killGraceMs ?? 2000;
    this.accessMode = config.accessMode;
  }

  /** Which transport this client ended up on (undefined before `start`). */
  get via(): 'app-server' | 'exec' | undefined {
    return this.transport;
  }

  get currentSessionId(): string | undefined {
    return this.threadId;
  }

  /** Plan's one developer instruction for the thread (accessMode.ts), as a thread/start|resume field. */
  private get developerInstructions(): { developerInstructions?: string } {
    return { developerInstructions: codexThreadInstructionsFor(this.accessMode ?? 'propose') };
  }

  private get codex(): CodexOptions {
    /* No mode given is the conservative default, Ask. */
    return codexOptionsFor(this.accessMode ?? 'propose');
  }

  /* ---------------------------------------------------------------- wire */

  private write(msg: Json): void {
    this.child?.stdin?.write(JSON.stringify(msg) + '\n');
  }

  private request(method: string, params: Json): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error(this.exited));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let m: Json;
    try {
      m = JSON.parse(line) as Json;
    } catch {
      return; // not ours (a stray log line); the protocol is one JSON object per line
    }
    const method = typeof m.method === 'string' ? m.method : undefined;
    if (method === undefined && m.id !== undefined) {
      const p = this.pending.get(m.id as number);
      if (!p) return;
      this.pending.delete(m.id as number);
      const err = m.error as { message?: string; code?: number } | undefined;
      if (err) p.reject(new Error(`codex app-server: ${err.message ?? 'error'} (${err.code ?? '?'})`));
      else p.resolve(m.result);
      return;
    }
    if (method && m.id !== undefined) {
      void this.onServerRequest(m.id, method, (m.params ?? {}) as Json);
      return;
    }
    if (method) this.onNotification(method, (m.params ?? {}) as Json);
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.config.onDiagnostic?.({ event: 'processExit', exitCode: code });
    const said = this.stderrTail.join('\n').trim();
    this.exited = `codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})${said ? `: ${said}` : ''}`;
    for (const p of this.pending.values()) p.reject(new Error(this.exited));
    this.pending.clear();
    this.turn?.reject(new Error(this.exited));
    this.turn = undefined;
    this.endQuestions();
  }

  /* ------------------------------------------------------------ lifecycle */

  async start(signal?: AbortSignal): Promise<void> {
    if (this.transport) return;
    const child = this.spawn(this.config.command, [...(this.config.args ?? []), 'app-server'], {
      cwd: this.config.cwd ?? process.cwd(),
      env: this.config.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    const spawnFailed = new Promise<never>((_, reject) => child.once('error', (e) => reject(e)));
    spawnFailed.catch(() => {});
    child.stderr?.on('data', (b: Buffer) => {
      this.config.onDiagnostic?.({ event: 'stderr', bytes: b.length });
      this.stderrTail.push(...String(b).split(/\r?\n/).filter(Boolean));
      if (this.stderrTail.length > 8) this.stderrTail = this.stderrTail.slice(-8);
    });
    child.once('exit', (code, sig) => this.onExit(code, sig));
    readline.createInterface({ input: child.stdout! }).on('line', (l) => this.onLine(l));

    const init = this.request('initialize', {
      clientInfo: { name: this.config.clientInfo?.name ?? 'sequence', title: 'Sequence', version: this.config.clientInfo?.version ?? '0.1.0' },
      /* S2a: plan mode (TurnStartParams.collaborationMode) is an experimental
         field; codex only accepts it from a client that opted in here. Not
         asked of a codex already known to lack it (experimentalPlan). */
      capabilities: { experimentalApi: CODEX_EXPERIMENTAL.get(this.codexKey) !== false, requestAttestation: false },
    });
    let aborted: (() => void) | undefined;
    const abort = new Promise<never>((_, reject) => {
      if (!signal) return;
      aborted = () => reject(new Error('aborted'));
      if (signal.aborted) aborted();
      else signal.addEventListener('abort', aborted, { once: true });
    });
    try {
      await Promise.race([init, spawnFailed, abort]);
    } catch (e) {
      if (aborted) signal?.removeEventListener('abort', aborted);
      /* The binary ran and quit without answering: no app-server here. Any
         other failure (spawn error, JSON-RPC error, abort) is a real failure. */
      if (this.exited && /unrecognized subcommand|unexpected argument|not found|invalid value/i.test(this.exited)) {
        this.child = undefined;
        this.transport = 'exec';
        return;
      }
      throw e;
    }
    if (aborted) signal?.removeEventListener('abort', aborted);
    this.write({ method: 'initialized' });
    this.transport = 'app-server';
  }

  async newSession(cwd?: string, _signal?: AbortSignal): Promise<string> {
    if (!this.transport) throw new Error('CodexAppServerClient.start() must be called before newSession().');
    const dir = cwd ?? this.config.cwd ?? process.cwd();
    if (this.transport === 'exec') {
      this.threadId = `exec:${dir}`;
      return this.threadId;
    }
    const c = this.codex;
    const mcp = codexMcpConfig(this.config.mcpServers);
    const res = (await this.request('thread/start', { cwd: dir, approvalPolicy: c.approvalPolicy, sandbox: c.sandbox, ...this.developerInstructions, ...(mcp ? { config: mcp } : {}) })) as {
      thread?: { id?: string };
      model?: unknown;
    };
    this.threadModel = typeof res?.model === 'string' ? res.model : undefined;
    const id = res?.thread?.id;
    if (typeof id !== 'string') throw new Error('codex app-server: thread/start returned no thread id');
    this.threadId = id;
    return id;
  }

  /**
   * Rejoin a thread codex kept on disk (`thread/resume`), in the current mode.
   * `excludeTurns`: the history stays with codex and is not sent back, so a
   * resumed chat never shows its past twice (codex's own load-replay gate).
   */
  async resumeSession(threadId: string, cwd?: string, _signal?: AbortSignal): Promise<string> {
    if (!this.transport) throw new Error('CodexAppServerClient.start() must be called before resumeSession().');
    if (this.transport === 'exec') throw new ResumeUnavailableError('codex exec keeps no thread to resume');
    const c = this.codex;
    const mcp = codexMcpConfig(this.config.mcpServers);
    const res = (await this.request('thread/resume', {
      threadId,
      cwd: cwd ?? this.config.cwd ?? process.cwd(),
      approvalPolicy: c.approvalPolicy,
      sandbox: c.sandbox,
      excludeTurns: true,
      ...this.developerInstructions,
      ...(mcp ? { config: mcp } : {}),
    })) as { thread?: { id?: string }; model?: unknown };
    this.threadModel = typeof res?.model === 'string' ? res.model : undefined;
    const id = res?.thread?.id;
    if (typeof id !== 'string') throw new Error('codex app-server: thread/resume returned no thread id');
    this.threadId = id;
    return id;
  }

  /**
   * Edit from here: drop the last `numTurns` turns of the active thread.
   * Newer app-servers replace count-based rollback with a boundary in paged
   * history (`thread/turns/list` newest first, then `thread/revert` before the
   * oldest turn to drop); older ones answer `thread/rollback { numTurns }`.
   * Ported from T3 Code's CodexThreadRevert.ts (MIT), reshaped for this client.
   */
  private lastTurn: string | undefined;

  lastTurnId(): string | undefined {
    return this.lastTurn;
  }

  async rollbackTo(beforeTurnId: string): Promise<void> {
    if (!this.transport || !this.threadId) throw new Error('CodexAppServerClient has no open thread to roll back.');
    if (this.transport === 'exec') throw new ResumeUnavailableError('codex exec keeps no thread to roll back');
    await this.request('thread/revert', { threadId: this.threadId, beforeTurnId });
  }

  async rollbackTurns(numTurns: number): Promise<void> {
    if (!this.transport || !this.threadId) throw new Error('CodexAppServerClient has no open thread to roll back.');
    if (this.transport === 'exec') throw new ResumeUnavailableError('codex exec keeps no thread to roll back');
    if (!Number.isInteger(numTurns) || numTurns <= 0) return;
    const threadId = this.threadId;
    try {
      let remaining = numTurns;
      let beforeTurnId: string | undefined;
      let cursor: string | null = null;
      const seen = new Set<string | null>();
      while (remaining > 0 && !seen.has(cursor)) {
        seen.add(cursor);
        const page = (await this.request('thread/turns/list', {
          threadId,
          cursor,
          limit: Math.min(remaining, 100),
          sortDirection: 'desc',
          itemsView: 'summary',
        })) as { data?: { id?: string }[]; nextCursor?: string | null } | null;
        for (const turn of page?.data ?? []) {
          if (typeof turn.id === 'string') beforeTurnId = turn.id;
          if (--remaining === 0) break;
        }
        cursor = page?.nextCursor ?? null;
        if (cursor === null) break;
      }
      /* Fewer turns than were asked to drop: the thread holds turns from before this chat's record of it. Reverting would empty it and say it forgot only some; refuse, and the caller starts over from the kept chat. */
      if (remaining > 0 || beforeTurnId === undefined) throw new RollbackShortError(numTurns);
      await this.request('thread/revert', { threadId, beforeTurnId });
    } catch (e) {
      if (this.exited || e instanceof RollbackShortError) throw e;
      /* An older app-server: count-based rollback. */
      await this.request('thread/rollback', { threadId, numTurns });
    }
  }

  /** The mode reaches codex on the next `turn/start` (approval policy + sandbox policy). */
  async setAccessMode(mode: AgentMode): Promise<void> {
    this.accessMode = mode;
  }

  /**
   * S2a: PLAN IS CODEX'S OWN PLAN MODE. From codex-cli 0.153.4's generated
   * types (`generate-ts --experimental`): TurnStartParams.collaborationMode
   * { mode: ModeKind 'plan' | 'default', settings: { model, reasoning_effort,
   * developer_instructions } }, null instructions meaning the mode's built-in
   * ones. Sent only in Plan, and only when the thread's model is known (the
   * settings require one). The read-only sandbox and the on-request approval
   * policy (Ask's dials, accessMode.ts) stay on the same turn either way, so a
   * codex that ignores the field still cannot write.
   */
  private async planMode(): Promise<{ collaborationMode?: { mode: 'plan'; settings: { model: string; reasoning_effort: string | null; developer_instructions: null } } }> {
    const model = this.activeModel();
    if (this.accessMode !== 'plan' || !model) return {};
    if (!(await this.experimentalPlan())) return {};
    return { collaborationMode: { mode: 'plan', settings: { model, reasoning_effort: this.turnConfig.effort ?? null, developer_instructions: null } } };
  }

  private offeredModels(): AgentModel[] {
    return CODEX_LISTED.get(this.codexKey) ?? [];
  }

  /** Which installed codex this is, for the experimental-API and model-list caches. */
  private get codexKey(): string {
    return [this.config.command, ...(this.config.args ?? [])].join(' ');
  }

  /**
   * S2a: DOES THIS CODEX OFFER PLAN MODE? Asked once per installed codex
   * (`collaborationMode/list`, experimental), the answer kept for every later
   * client: a codex that offers a `plan` preset gets collaborationMode on Plan
   * turns; one that refuses the method (an update that dropped the
   * experimental API, a build without it) gets the read-only plan, and the
   * next connection does not opt into the experimental API at all.
   */
  private async experimentalPlan(): Promise<boolean> {
    const known = CODEX_EXPERIMENTAL.get(this.codexKey);
    if (known !== undefined) return known;
    let ok = false;
    try {
      const res = (await this.request('collaborationMode/list', {})) as { data?: { mode?: unknown }[] } | null;
      ok = Array.isArray(res?.data) && res.data.some((m) => m?.mode === 'plan');
    } catch {
      ok = false;
    }
    CODEX_EXPERIMENTAL.set(this.codexKey, ok);
    return ok;
  }

  /** S5: put the person's words into the running turn (`turn/steer`); every refusal is an outcome, never a throw. */
  steer(text: string): Promise<SteerOutcome> {
    return codexSteer((m, p) => this.request(m, p), this.turn, text);
  }

  prompt(text: string, opts: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    const prior = this.turnQueue;
    const run = (async () => {
      await prior.catch(() => undefined);
      return this.transport === 'exec' ? this.runExec(text, opts) : this.runTurn(text, opts);
    })();
    this.turnQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The model and effort the next turns run with (turn/start overrides). */
  private turnConfig: AgentTurnConfig = {};

  async setTurnConfig(cfg: AgentTurnConfig): Promise<void> {
    this.turnConfig = { ...cfg };
  }

  /** Round 7 (A3): the turn's override, else the model thread/start|resume said the thread runs on. */
  activeModel(): string | undefined {
    return turnModel(this.turnConfig.model, this.threadModel, this.offeredModels()) ?? this.threadModel;
  }

  /**
   * What this codex offers the picker and the `/` menu: `model/list` (each
   * model with its reasoning efforts) and `skills/list` for the working
   * directory. Codex has no slash-command list on the wire; its skills are
   * what `/` offers (mentioned as `$name`).
   */
  async capabilities(): Promise<AgentCapabilities> {
    if (this.transport !== 'app-server') return { models: [], commands: [], skills: [], configOptions: [] };
    const listed = (await this.request('model/list', {})) as { data?: unknown[] };
    const models: AgentModel[] = (listed?.data ?? [])
      .map((m) => m as { id?: unknown; model?: unknown; displayName?: unknown; description?: unknown; hidden?: unknown; supportedReasoningEfforts?: unknown; defaultReasoningEffort?: unknown; isDefault?: unknown })
      .filter((m) => typeof m.id === 'string' && m.hidden !== true)
      .map((m) => ({
        id: typeof m.model === 'string' ? m.model : (m.id as string),
        name: typeof m.displayName === 'string' ? m.displayName : (m.id as string),
        ...(typeof m.description === 'string' ? { description: m.description } : {}),
        efforts: Array.isArray(m.supportedReasoningEfforts)
          ? (m.supportedReasoningEfforts as { reasoningEffort?: unknown }[]).map((e) => e.reasoningEffort).filter((e): e is string => typeof e === 'string')
          : [],
        ...(typeof m.defaultReasoningEffort === 'string' ? { defaultEffort: m.defaultReasoningEffort } : {}),
        ...(m.isDefault === true ? { isDefault: true } : {}),
      }));
    CODEX_LISTED.set(this.codexKey, models);
    let skills: AgentSkill[] = [];
    try {
      const res = (await this.request('skills/list', { cwds: [this.config.cwd ?? process.cwd()] })) as { data?: { skills?: unknown[] }[] };
      skills = (res?.data ?? [])
        .flatMap((e) => e.skills ?? [])
        .map((s) => s as { name?: unknown; description?: unknown; shortDescription?: unknown; enabled?: unknown })
        .filter((s) => typeof s.name === 'string' && s.enabled !== false)
        .map((s) => ({ name: s.name as string, description: typeof s.shortDescription === 'string' ? s.shortDescription : typeof s.description === 'string' ? s.description : '' }));
    } catch {
      skills = [];
    }
    return { models, commands: [], skills, configOptions: [] };
  }

  /** Compact the thread's context (`thread/compact/start`), as a turn: it streams and ends like one. */
  compact(opts: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    const prior = this.turnQueue;
    const run = (async () => {
      await prior.catch(() => undefined);
      return this.runTurn(null, opts);
    })();
    this.turnQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** `text` null: the turn is a compaction (thread/compact/start) rather than a prompt. */
  private async runTurn(text: string | null, opts: AcpPromptOptions): Promise<AcpPromptResult> {
    if (this.transport !== 'app-server') throw new Error('CodexAppServerClient.start() must be called before prompt().');
    if (!this.threadId) await this.newSession();
    const threadId = this.threadId!;
    const signal = opts.signal;
    if (signal?.aborted) return { stopReason: 'cancelled', text: '' };

    const done = new Promise<AcpPromptResult>((resolve, reject) => {
      this.turn = { threadId, text: '', streamed: new Set(), resolve, reject };
    });
    const turn = this.turn!;
    this.lastTurn = undefined;
    this.items.clear();
    const onAbort = (): void => {
      this.endQuestions();
      if (turn.turnId) void this.request('turn/interrupt', { threadId, turnId: turn.turnId }).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const c = this.codex;
      if (text === null) {
        await this.request('thread/compact/start', { threadId });
      } else {
        const params: Json = {
          threadId,
          /* S2a: images as localImage, files as mentions, board nodes inline. */
          input: codexInputItems(text, opts.attachments),
          approvalPolicy: c.approvalPolicy,
          sandboxPolicy: sandboxPolicy(c.sandbox),
          ...((m) => (m ? { model: m } : {}))(turnModel(this.turnConfig.model, this.threadModel, this.offeredModels())),
          ...(this.turnConfig.effort ? { effort: this.turnConfig.effort } : {}),
          ...(await this.planMode()),
        };
        let res: { turn?: { id?: string } };
        try {
          res = (await this.request('turn/start', params)) as { turn?: { id?: string } };
        } catch (e) {
          /* A codex that refuses plan mode on the turn itself: the turn goes
             again without it (the read-only plan), and this codex is not asked
             again. Any other refusal is the turn's own. */
          if (!('collaborationMode' in params)) throw e;
          CODEX_EXPERIMENTAL.set(this.codexKey, false);
          delete params.collaborationMode;
          res = (await this.request('turn/start', params)) as { turn?: { id?: string } };
        }
        turn.turnId = res?.turn?.id;
        this.lastTurn = turn.turnId;
      }
      if (signal?.aborted) onAbort();
      return await done;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (this.turn === turn) this.turn = undefined;
    }
  }

  /** The fallback: one `codex exec` per turn. It cannot ask, so nothing reaches `onPermission`. */
  private runExec(text: string, opts: AcpPromptOptions): Promise<AcpPromptResult> {
    const mode = this.accessMode ?? 'propose';
    const cwd = this.threadId?.startsWith('exec:') ? this.threadId.slice(5) : this.config.cwd ?? process.cwd();
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.config.command, [...(this.config.args ?? []), 'exec', ...cliArgsFor('codex-cli', mode), text], {
        cwd,
        env: this.config.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      let out = '';
      let err = '';
      child.stdout?.on('data', (b: Buffer) => (out += String(b)));
      child.stderr?.on('data', (b: Buffer) => (err += String(b)));
      const onAbort = (): void => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* gone */
        }
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      child.once('error', (e) => reject(e));
      child.once('exit', (code) => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (this.child === child) this.child = undefined;
        if (opts.signal?.aborted) return resolve({ stopReason: 'cancelled', text: out.trim() });
        if (code === 0) return resolve({ stopReason: 'end_turn', text: out.trim() });
        reject(new Error(`codex exec exited ${code}: ${err.trim().split(/\r?\n/).slice(-3).join(' ')}`));
      });
    });
  }

  /* ------------------------------------------------- server -> client */

  private onNotification(method: string, p: Json): void {
    const turn = this.turn;
    const sessionId = (p.threadId as string | undefined) ?? this.threadId ?? '';
    const update = (u: SessionNotification['update']): void => this.config.onUpdate?.({ sessionId, update: u });
    if (turn && isCodexProgress(method)) this.config.onProgress?.();
    const turnIdOf = (): string | undefined =>
      typeof p.turnId === 'string' ? p.turnId : typeof (p.turn as Json | undefined)?.id === 'string' ? ((p.turn as Json).id as string) : turn?.turnId;

    /* S3: snapshot the tree as the turn starts, note each file change before
       it lands, and union the turn's diff into the turn. */
    if (method === 'account/rateLimits/updated') this.noteLimits(p);
    if (method === 'turn/started') {
      const id = turnIdOf();
      /* A compaction's turn is named only here (thread/compact/start answers {}). */
      if (turn && !turn.turnId && id) {
        turn.turnId = id;
        this.lastTurn = id;
      }
      this.hook((h) => h.turnStarted?.(id));
    } else if (method === 'item/started' && (p.item as Json | undefined)?.type === 'fileChange') {
      const changes = Array.isArray((p.item as Json).changes) ? ((p.item as Json).changes as { path?: unknown }[]) : [];
      const paths = changes.map((c) => c.path).filter((x): x is string => typeof x === 'string');
      const id = turnIdOf();
      if (paths.length) this.hook((h) => h.willWrite?.(paths, id));
    } else if (method === 'turn/diff/updated' && typeof p.diff === 'string') {
      const diff = p.diff;
      const id = turnIdOf();
      this.hook((h) => h.turnDiff?.(diff, id));
    }

    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = typeof p.delta === 'string' ? p.delta : '';
        if (turn) {
          turn.text += delta;
          turn.streamed.add(String(p.itemId));
        }
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: delta } });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const item = (p.item ?? {}) as Json;
        const id = String(item.id ?? '');
        if (item.type === 'agentMessage') {
          if (method === 'item/completed' && turn && !turn.streamed.has(id) && typeof item.text === 'string') {
            turn.text += item.text;
            update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: item.text } });
          }
          if (method === 'item/completed' && item.phase === 'final_answer') {
            update({ sessionUpdate: 'session_info_update', _meta: { sequence: { answerComplete: true, evidence: 'codex.final_answer.completed' } } });
          }
          return;
        }
        /* S2b: a reasoning item is the agent thinking. Its start and end, in
           codex's own times, let the thread say "Thought for 12.2 s"; its
           summary (when codex sends one) is the thought's text. */
        if (item.type === 'reasoning') {
          const at = method === 'item/started' ? p.startedAtMs : p.completedAtMs;
          const summary = Array.isArray(item.summary) ? (item.summary as unknown[]).map((s) => (typeof s === 'string' ? s : typeof (s as Json)?.text === 'string' ? String((s as Json).text) : '')).filter(Boolean).join('\n') : '';
          update({
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: method === 'item/completed' ? summary : '' },
            _meta: { sequence: { thought: method === 'item/started' ? 'start' : 'end', id, ...(typeof at === 'number' ? { at } : {}) } },
          });
          return;
        }
        /* S2a: in plan mode codex writes its plan as a `plan` item; complete,
           it is the CLI's plan (the S2b plan card), in ACP's words. */
        if (item.type === 'plan') {
          if (method === 'item/completed' && typeof item.text === 'string' && item.text.trim()) {
            update({ sessionUpdate: 'plan_update', plan: { type: 'markdown', planId: `plan:${id}`, content: item.text } });
          }
          return;
        }
        const tool = toolCallOf(item);
        if (!tool) return;
        this.items.set(id, item);
        if (method === 'item/started') {
          update({ sessionUpdate: 'tool_call', toolCallId: id, title: tool.title, kind: tool.kind, status: 'in_progress', locations: tool.locations, rawInput: item });
        } else {
          const ok = item.status === 'completed';
          const out = mcpOutputOf(item);
          update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: ok ? 'completed' : 'failed', rawOutput: item, ...(out ? { content: [{ type: 'content', content: { type: 'text', text: out } }] } : {}) });
        }
        return;
      }
      case 'turn/completed': {
        const t = (p.turn ?? {}) as { id?: string; status?: string; error?: { message?: string; codexErrorInfo?: unknown } | null };
        if (!turn || (turn.turnId && t.id && t.id !== turn.turnId)) return;
        this.turn = undefined;
        /* A question still waiting when the turn ends is answered (with none) now. */
        this.endQuestions();
        /* The turn ends once its snapshot hooks have run: a turn that ended
           with its writes still untracked could not be reverted. */
        void this.hookChain.then(() => {
          if (t.status === 'failed') turn.reject(new AgentTurnError(`codex turn failed: ${t.error?.message ?? 'unknown error'}`, t.error?.codexErrorInfo ?? null, isUsageLimit(t.error?.codexErrorInfo) ? this.limitResetsAt() : undefined));
          else turn.resolve({ stopReason: t.status === 'interrupted' ? 'cancelled' : 'end_turn', text: turn.text });
        });
        return;
      }
      case 'serverRequest/resolved': {
        /* Codex settled one of its own requests (answered, or given up on):
           a question still shown for it is over, and is not answered again. */
        const ac = this.questions.get(String(p.requestId));
        if (ac) {
          this.questions.delete(String(p.requestId));
          ac.abort('resolved');
        }
        return;
      }
      default: {
        /* S2b: plan, goal, usage and rate limits, as ACP updates. */
        const u = codexUpdate(method, p);
        if (u) update(u);
        return;
      }
    }
  }

  /** Keep each rate-limit window codex reports (primary and secondary) under its limit id. */
  private noteLimits(p: Json): void {
    const r = (p.rateLimits ?? {}) as { limitId?: unknown; primary?: unknown; secondary?: unknown };
    const id = typeof r.limitId === 'string' ? r.limitId : '';
    for (const [slot, w] of [['primary', r.primary], ['secondary', r.secondary]] as const) {
      const key = `${id}:${slot}`;
      const win = w as { usedPercent?: unknown; resetsAt?: unknown } | null | undefined;
      if (win && typeof win.usedPercent === 'number' && typeof win.resetsAt === 'number') this.limits.set(key, { usedPercent: win.usedPercent, resetsAt: win.resetsAt });
      else this.limits.delete(key);
    }
  }

  /** When the fullest reported window resets (epoch ms), or undefined when codex reported none. */
  private limitResetsAt(): number | undefined {
    let best: { usedPercent: number; resetsAt: number } | undefined;
    for (const w of this.limits.values()) if (!best || w.usedPercent > best.usedPercent) best = w;
    return best ? best.resetsAt * 1000 : undefined;
  }

  private async onServerRequest(id: unknown, method: string, p: Json): Promise<void> {
    const answer = (result: Json): void => this.write({ id, result });
    /* S2a: AN MCP SERVER ASKING BEFORE A TOOL RUNS (McpServerElicitationRequest).
       Sequence's own board server ("sequence") only reads, so its question is
       accepted without a person; refusing it would mean the board tools never
       run in codex. Any other server's is declined (McpServerElicitationAction
       'decline'): Sequence has no surface to put it to a person yet. */
    if (method === 'mcpServer/elicitation/request') {
      const mine = p.serverName === 'sequence' && (this.config.mcpServers ?? []).some((s) => s.name === 'sequence');
      answer(mine ? { action: 'accept', content: {}, _meta: null } : { action: 'decline', content: null, _meta: null });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      await this.onQuestion(id, p);
      return;
    }
    if (method !== 'item/fileChange/requestApproval' && method !== 'item/commandExecution/requestApproval') {
      /* Requests this client has no surface for (extra sandbox permissions)
         are refused rather than left hanging: an unanswered request stalls
         the turn forever. */
      this.write({ id, error: { code: -32601, message: `Sequence does not handle ${method}` } });
      return;
    }
    /* The snapshot hooks (the file change being noted) finish before the
       person is asked, so an Allow never lets a write land untracked. */
    await this.hookChain;
    const itemId = String(p.itemId ?? '');
    const item = this.items.get(itemId) ?? (method === 'item/fileChange/requestApproval' ? { type: 'fileChange', id: itemId } : { type: 'commandExecution', id: itemId, command: p.command });
    const tool = toolCallOf(item) ?? { title: method, kind: 'other' as ToolKind, locations: [] };
    const req: RequestPermissionRequest = {
      sessionId: String(p.threadId ?? this.threadId ?? ''),
      toolCall: {
        toolCallId: itemId,
        title: tool.title,
        kind: tool.kind,
        status: 'pending',
        locations: tool.locations,
        rawInput: { ...item, ...(p.reason ? { reason: p.reason } : {}), ...(p.command ? { command: p.command } : {}) },
      },
      options: APPROVAL_OPTIONS,
    };
    let decision: PermissionDecision;
    try {
      decision = this.config.onPermission ? await this.config.onPermission(req) : this.defaultDecision(req);
    } catch {
      decision = 'deny';
    }
    answer({ decision: decision === 'always' ? 'acceptForSession' : decision === 'allow' ? 'accept' : 'decline' });
  }

  /**
   * CODEX ASKS THE PERSON (item/tool/requestUserInput). The caller's
   * `onQuestion` puts it to them; whatever it answers goes back in codex's
   * shape (questions.ts). It always gets an answer: no `onQuestion`, Cancel
   * (null), the turn ending or being stopped, or teardown, each answer with
   * none, so codex goes on rather than waits. Only a request codex itself
   * reported resolved (serverRequest/resolved) is not answered again.
   */
  private async onQuestion(id: unknown, p: Json): Promise<void> {
    const key = String(id);
    const q = codexQuestionRequestOf(p, this.threadId ?? '');
    const ac = new AbortController();
    this.questions.get(key)?.abort();
    this.questions.set(key, ac);
    let answers: Awaited<ReturnType<NonNullable<AcpClientConfig['onQuestion']>>> = null;
    if (this.config.onQuestion && !this.exited) {
      const ended = new Promise<null>((resolve) => ac.signal.addEventListener('abort', () => resolve(null), { once: true }));
      try {
        answers = await Promise.race([this.config.onQuestion(q, ac.signal), ended]);
      } catch {
        answers = null;
      }
    }
    if (this.questions.get(key) === ac) this.questions.delete(key);
    if (ac.signal.reason === 'resolved' || this.exited) return;
    this.write({ id, result: codexQuestionResponse(ac.signal.aborted ? null : answers, q.questions) });
  }

  private defaultDecision(req: RequestPermissionRequest): PermissionDecision {
    if (!this.accessMode) return defaultPermissionPolicy(req);
    return allowsTool(this.accessMode, req.toolCall.kind ?? undefined) ? 'allow' : 'deny';
  }

  /* ------------------------------------------------------------- teardown */

  async dispose(): Promise<void> {
    this.endQuestions();
    const turn = this.turn;
    if (turn?.turnId && !this.exited) await Promise.race([this.request('turn/interrupt', { threadId: turn.threadId, turnId: turn.turnId }).catch(() => {}), new Promise((r) => setTimeout(r, Math.min(500, this.killGraceMs)))]);
    const child = this.child;
    this.child = undefined;
    this.threadId = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          /* gone */
        }
      }, this.killGraceMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.stdin?.end();
        child.kill('SIGTERM');
      } catch {
        /* gone */
      }
    });
  }
}

/**
 * The client for a registered agent: a plain `codex` goes through
 * `codex app-server` (falling back to `codex exec` where that subcommand does
 * not exist); everything else speaks ACP.
 */
export function createAgentClient(config: AcpClientConfig): AcpAgentClient {
  const kind = config.agentKind ?? agentKindOf(config);
  const c = config.env ? config : { ...config, env: agentSpawnEnv(config.command) };
  return kind === 'codex-cli' ? new CodexAppServerClient(c) : new AcpClient(c);
}

/**
 * The environment an agent process starts with. The packaged app's server runs
 * as node inside Sequence.exe with ELECTRON_RUN_AS_NODE=1; an agent (and every
 * tool it runs: an Electron app's CLI would start as plain node) must not
 * inherit that. The flag stays only when the agent's command IS this Electron
 * binary (no real node was found for an npm shim's script), and then only for
 * that process tree: it cannot be taken from the agent's own tools without
 * breaking the agent's re-spawns of its own executable.
 */
export function agentSpawnEnv(command: string, base: NodeJS.ProcessEnv = process.env, execPath = process.execPath, electron = Boolean(process.versions.electron)): NodeJS.ProcessEnv {
  if (base.ELECTRON_RUN_AS_NODE === undefined) return base;
  const same = process.platform === 'win32' ? command.toLowerCase() === execPath.toLowerCase() : command === execPath;
  if (electron && same) return base;
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** What an item is, in ACP's terms: a file change is an `edit`, a command is `execute`. */
function toolCallOf(item: Json): { title: string; kind: ToolKind; locations: { path: string }[] } | null {
  if (item.type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? (item.changes as { path?: unknown }[]) : [];
    const paths = changes.map((c) => c.path).filter((x): x is string => typeof x === 'string');
    return { title: paths.length ? `Edit ${paths.join(', ')}` : 'Edit files', kind: 'edit', locations: paths.map((path) => ({ path })) };
  }
  if (item.type === 'commandExecution') {
    const command = typeof item.command === 'string' ? item.command : 'a command';
    return { title: `Run ${command}`, kind: 'execute', locations: [] };
  }
  /* S2a: an MCP tool call (Sequence's board server among them): `sequence.map`. */
  if (item.type === 'mcpToolCall') {
    return { title: `${String(item.server ?? 'mcp')}.${String(item.tool ?? 'tool')}`, kind: item.readOnlyHint === true ? 'read' : 'other', locations: [] };
  }
  return null;
}

/** What an MCP tool call answered, as text (its text content blocks), or its error. */
function mcpOutputOf(item: Json): string | null {
  if (item.type !== 'mcpToolCall') return null;
  const result = item.result as { content?: unknown } | null | undefined;
  const text = Array.isArray(result?.content)
    ? (result!.content as Json[]).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => String(c.text)).join('\n')
    : '';
  if (text) return text;
  const err = item.error as { message?: unknown } | null | undefined;
  return typeof err?.message === 'string' ? err.message : null;
}

/**
 * The model a turn/start names. The user's pick wins. Otherwise codex runs the thread on its own
 * default (config.toml), which can be a model this sign-in is not offered (a ChatGPT account told to
 * use an API-only model): when model/list is known and leaves the thread's model out, name the
 * listed default instead. Nothing known, nothing sent: codex keeps its own choice.
 */
export function turnModel(picked: string | undefined, thread: string | undefined, listed: readonly AgentModel[]): string | undefined {
  if (picked) return picked;
  if (!thread || listed.length === 0 || listed.some((m) => m.id === thread)) return undefined;
  return (listed.find((m) => m.isDefault) ?? listed[0])!.id;
}
