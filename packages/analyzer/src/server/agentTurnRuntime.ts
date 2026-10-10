/* ══════════════════════════════════════════════════════════════════════════
   ONE RUN-NODE TURN'S LIVE STATE: STATUS, ANSWERED, LOG, RECORD (round 9)
   packages/analyzer/src/server/agentTurnRuntime.ts

   The run-node handler hands every event of a turn to this object, which
   turns them into what the page shows and what the disk keeps:

     acp:turn { state: 'queued' }      another turn holds this chat's agent
     acp:status { phase, forMs, ... }  every few seconds and on each change
                                       of phase: never a silent stall
     acp:turn { state: 'answered' }    the agent has said its piece (acp
                                       turnStatus.ts); the page gives Send
                                       back while the bridge finishes
     acp:title { title }               the chat was named from this exchange
     acp:log { log }                   the turn's diagnostic record, once,
                                       at its end (also appended to disk)
     acp:usage { usage }               the tokens the agent reported for the
                                       turn (input, output, cache); sent as
                                       they change and once at the end

   and records the turn in the chat (agentChatStore.ts) when it is answered
   and again when it ends.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

import { TurnAnswerDetector, TurnLog, TurnStatusTracker, TurnUsageMeter, tickStatus, type StatusClock, type TurnStatus, type TurnUsage } from '@sequence/acp';

import { parseAskLine, stripAskLine, type AskLedgerResult } from '@sequence/schema';

import { recordTurn } from '../harness/refineSignals.js';
import { runSignalLoop } from '../harness/learningLoop.js';
import { appendTurnLog, liveTurnIds, ownerNow, recordAgentRun, titleChatFromAgent, type StoredAgentRun, type StoredAgentTool } from './agentChatStore.js';

export interface AgentTurnRuntimeOptions {
  clock: StatusClock;
  emit: (event: Record<string, unknown>) => void;
  agentRef: string;
  provider: string | null;
  chatId: string | null;
  /** The person's own question (never the node-context wrapping). */
  prompt: string;
  nodeId: string | null;
  /** Where the chat's files live, or null for no chat. */
  sessionsRoot: string | null;
  userConfigDir: string;
  /** A compaction turn: recorded and logged, never a title. */
  compact?: boolean;
  /** The ask ledger was on: the reply's closing line is read, and cut from what is shown, saved and titled. */
  askLedger?: boolean;
  /**
   * The refine loop (harness/refineSignals.ts): when set, a finished turn is
   * written to `<root>/.sequence/refine/log.jsonl` with the failure signals it
   * carries, whatever the provider. `auto` is the person's opt-in to accept new
   * notes without asking (off by default).
   */
  refine?: { root: string; auto: boolean } | null;
  /** Whether "answered" is decided from the stream (ACP bridges; codex ends its own turns). */
  detectAnswer: boolean;
  /** Called once when the turn is answered (the bridge may still hold the prompt open). */
  onAnswered?: () => void;
  statusEveryMs?: number;
  answerQuietMs?: number;
}

type Outcome = 'ended' | 'failed' | 'stopped' | 'hung';

export class AgentTurnRuntime {
  readonly turnId = crypto.randomUUID();
  private readonly o: AgentTurnRuntimeOptions;
  private readonly status: TurnStatusTracker;
  private readonly log: TurnLog;
  private readonly meter = new TurnUsageMeter();
  private finalUsage: TurnUsage | null = null;
  private readonly detector: TurnAnswerDetector | null;
  private stopTicker: (() => void) | null = null;
  private lastPhase: string | null = null;
  private text = '';
  private model: string | null = null;
  private readonly tools = new Map<string, StoredAgentTool>();
  private readonly startedAt = Date.now();
  private answeredAt: number | null = null;
  private finished = false;
  /** The prompt reached the provider (sent() ran). */
  private reached = false;
  private thread: string | null = null;
  private titled = false;

  constructor(o: AgentTurnRuntimeOptions) {
    this.o = o;
    this.status = new TurnStatusTracker({ clock: o.clock });
    this.log = new TurnLog({ turnId: this.turnId, chatId: o.chatId, agentRef: o.agentRef, provider: o.provider }, o.clock);
    this.detector = o.detectAnswer ? new TurnAnswerDetector({ clock: o.clock, onAnswered: () => this.onAnswered(), ...(o.answerQuietMs !== undefined ? { quietMs: o.answerQuietMs } : {}) }) : null;
    this.log.add('asked', { chars: o.prompt.length });
    liveTurnIds.add(this.turnId);
    this.stopTicker = tickStatus(this.status, o.clock, (s) => this.emitStatus(s, true), o.statusEveryMs ?? 5_000);
  }

  get answered(): boolean {
    return this.answeredAt !== null;
  }

  private emitStatus(s: TurnStatus = this.status.snapshot(), tick = false): void {
    if (this.finished) return;
    if (!tick && s.phase === this.lastPhase) return;
    this.lastPhase = s.phase;
    this.o.emit({ type: 'acp:status', ...s });
  }

  /** Another turn holds this chat's agent: this one waits, and says so. */
  queued(): void {
    this.o.emit({ type: 'acp:turn', state: 'queued' });
    this.log.add('queued');
    this.status.queued();
    this.emitStatus();
  }

  /** The turn has the agent (out of the queue). */
  started(): void {
    this.status.started();
    this.log.add('started');
    this.emitStatus();
  }

  /** The prompt is with the agent. */
  /** The provider's id for this turn; null when the client names turns and none was accepted. */
  private pturn: string | null | undefined;

  setProviderTurn(id: string | null): void {
    this.pturn = id;
  }

  sent(): void {
    this.reached = true;
    /* From here a restart would lose the turn: record it as running so the chat can offer Continue. */
    this.persist('running', null, null);
    this.status.sent();
    this.log.add('sent');
    this.emitStatus();
  }

  session(resumed: boolean): void {
    this.log.add('session', { resumed });
  }

  /** The provider thread this turn runs on (recorded with the turn). */
  setThread(id: string): void {
    this.thread = id;
  }

  setModel(model: string): void {
    this.model = model;
    this.log.add('model', { model });
  }

  update(n: unknown): void {
    const u = (n as { update?: Record<string, unknown> } | null)?.update;
    if (u && typeof u.sessionUpdate === 'string') {
      if (u.sessionUpdate === 'agent_message_chunk') {
        const c = u.content as { type?: unknown; text?: unknown } | undefined;
        if (c?.type === 'text' && typeof c.text === 'string') this.text += c.text;
      } else if ((u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') && typeof u.toolCallId === 'string') {
        const was = this.tools.get(u.toolCallId);
        const st = String(u.status ?? '');
        const status: StoredAgentTool['status'] = st === 'completed' ? 'done' : st === 'failed' || st === 'cancelled' ? 'failed' : (was?.status ?? 'running');
        const input = u.rawInput as { subagent_type?: unknown; description?: unknown } | null | undefined;
        const subagent =
          input && typeof input === 'object' && typeof input.subagent_type === 'string'
            ? typeof input.description === 'string' && input.description ? `${input.subagent_type}: ${input.description}` : input.subagent_type
            : was?.subagent;
        const meta = (u as { _meta?: { claudeCode?: { parentToolUseId?: unknown }; sequence?: { parentToolCallId?: unknown } } })._meta;
        const parent = meta?.claudeCode?.parentToolUseId ?? meta?.sequence?.parentToolCallId;
        const parentId = typeof parent === 'string' && parent ? parent : was?.parentId;
        const at = Date.now();
        const startedAt = was?.startedAt ?? at;
        const endedAt = status === 'running' ? undefined : (was?.endedAt ?? at);
        this.tools.set(u.toolCallId, {
          id: u.toolCallId,
          title: typeof u.title === 'string' && u.title ? u.title : (was?.title ?? 'Tool'),
          toolKind: typeof u.kind === 'string' ? u.kind : (was?.toolKind ?? null),
          status,
          ...(subagent ? { subagent } : {}),
          ...(parentId ? { parentId } : {}),
          startedAt,
          ...(endedAt !== undefined ? { endedAt } : {}),
        });
      }
    }
    this.persistProgress();
    if (this.meter.update(n)) this.emitUsage(this.meter.current());
    this.status.update(n);
    this.log.update(n);
    this.detector?.update(n);
    this.emitStatus();
  }

  /** The tokens the agent has reported for this turn so far (its final report when it gave one), or null. */
  usage(): TurnUsage | null {
    return this.meter.current(this.finalUsage);
  }

  /** The usage to put on the tree's stop event: the agent's final report if it gave one, else the running sum. */
  usageFor(final: TurnUsage | null | undefined): TurnUsage | null {
    return this.meter.current(final ?? null);
  }

  /** The person pressed Stop (the stream closed): nothing after this makes the turn answered. */
  stopping(): void {
    if (this.finished || this.answeredAt !== null) return;
    this.detector?.stop();
    this.log.add('stop');
  }

  /** A person is asked something (an approval or a question). Returns the release. */
  asked(what: 'approval' | 'question'): () => void {
    const a = this.status.asked();
    const b = this.detector?.pause();
    this.log.add(what);
    this.emitStatus();
    return () => {
      a();
      b?.();
      this.emitStatus();
    };
  }

  /** The text as the person sees it: on a ledger turn, without the closing line. */
  private shown(raw: string = this.text): string {
    return this.o.askLedger ? stripAskLine(raw) : raw;
  }

  /** The closing line's report, on a ledger turn whose reply ended on one. */
  ledger(raw: string = this.text): AskLedgerResult | null {
    return this.o.askLedger ? parseAskLine(raw) : null;
  }

  private onAnswered(): void {
    if (this.finished || this.answeredAt !== null) return;
    this.answeredAt = Date.now();
    this.status.answered();
    this.log.add('answered', { openTools: this.status.snapshot().openTools });
    const ledger = this.ledger();
    this.o.emit({ type: 'acp:turn', state: 'answered', text: this.shown(), ...(ledger ? { askLedger: ledger } : {}) });
    this.emitStatus();
    this.persist('done', null, null);
    this.title();
    this.o.onAnswered?.();
  }

  private title(): void {
    if (this.titled || !this.o.sessionsRoot || !this.o.chatId || this.o.nodeId || this.o.compact) return;
    this.titled = true;
    try {
      const title = titleChatFromAgent(this.o.sessionsRoot, this.o.chatId, this.o.prompt, this.shown());
      if (title) this.o.emit({ type: 'acp:title', title });
    } catch {
      /* An unwritable index costs the title, never the turn. */
    }
  }

  private lastProgressWrite = 0;
  private wroteRunning = false;
  /** The running record keeps up with the turn (text so far, tool rows) at most every two seconds. */
  private persistProgress(): void {
    if (this.finished || this.answeredAt !== null) return;
    const now = Date.now();
    if (now - this.lastProgressWrite < 2_000) return;
    this.persist('running', null, null);
  }

  private persist(status: StoredAgentRun['status'], error: string | null, stopReason: string | null, finalText?: string): boolean {
    if (!this.o.sessionsRoot || !this.o.chatId) return true;
    /* A compaction turn is saved when it ends (the rewind counts it); a running record would make the chat read as cut off. */
    if (this.o.compact && status === 'running') return true;
    const first = !this.wroteRunning;
    if (status === 'running') {
      this.lastProgressWrite = Date.now();
      this.wroteRunning = true;
    }
    try {
      const raw = finalText && finalText.length >= this.text.length ? finalText : this.text;
      const ledger = this.ledger(raw);
      return recordAgentRun(this.o.sessionsRoot, this.o.chatId, {
        id: this.turnId,
        agentRef: this.o.agentRef,
        prompt: this.o.prompt,
        text: this.shown(raw),
        status,
        error,
        stopReason,
        startedAt: this.startedAt,
        endedAt: Date.now(),
        model: this.model,
        nodeId: this.o.nodeId,
        tools: [...this.tools.values()].map((t) => (status === 'done' || t.status !== 'running' ? t : { ...t, status: 'failed' })),
        ...(this.usage() ? { usage: this.usage()! } : {}),
        ...(status === 'running' ? { owner: ownerNow() } : {}),
        ...(this.o.compact ? { compact: true } : {}),
        ...(this.reached ? {} : { reached: false }),
        ...(this.pturn !== undefined ? { pturn: this.pturn } : {}),
        ...(this.thread ? { thread: this.thread } : {}),
        ...(ledger ? { askLedger: ledger } : {}),
      }, new Date(), { touch: status !== 'running' || first });
    } catch {
      /* A chat that cannot be written is still answered on screen. */
      return false;
    }
  }

  /** The closing write is tried a few times: a record left `running` would read as an interrupted turn after a reload. */
  private persistFinal(status: StoredAgentRun['status'], error: string | null, stopReason: string | null, finalText?: string): boolean {
    for (let i = 0; i < 3; i++) {
      if (this.persist(status, error, stopReason, finalText)) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
    return false;
  }

  /**
   * The turn is over: stop the ticker, record it, write its log, and send
   * the log to the page. `text` is the agent's final text when it gave one.
   */
  finish(outcome: Outcome, extra: { stopReason?: string; error?: string; text?: string; usage?: TurnUsage | null } = {}): void {
    if (this.finished) return;
    if (extra.usage) this.finalUsage = extra.usage;
    this.detector?.stop();
    this.stopTicker?.();
    this.stopTicker = null;
    const status: StoredAgentRun['status'] = outcome === 'ended' || this.answered ? 'done' : outcome === 'stopped' ? 'stopped' : 'failed';
    const error = status === 'done' ? null : (extra.error ?? (outcome === 'stopped' ? 'Stopped.' : null));
    const saved = this.persistFinal(status, error, extra.stopReason ?? null, extra.text);
    if (outcome === 'ended') {
      if (typeof extra.text === 'string' && extra.text.length > this.text.length) this.text = extra.text;
      this.title();
    }
    const record = this.log.finish(this.answered && outcome === 'ended' ? 'answered-then-ended' : outcome, {
      ...(extra.stopReason ? { stopReason: extra.stopReason } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    });
    const final = this.usage();
    if (final) this.emitUsage(final);
    appendTurnLog(this.o.sessionsRoot, this.o.chatId, this.o.userConfigDir, record);
    this.o.emit({ type: 'acp:log', log: record });
    this.finished = true;
    this.learn(status);
    /* If the closing record could not be written the id stays: the turn is not called cut off while this process lives. */
    if (saved) liveTurnIds.delete(this.turnId);
  }

  /** What the notes block added to this turn's prompt, for the diagnostic log (counts only, never the words). */
  injected(tokens: number, notes: number): void {
    this.log.add('notes', { tokens, notes });
  }

  /**
   * Hand a finished turn to the refine loop. After the answer is saved and
   * sent, off the request path; a failure here costs a signal, never the turn.
   * A turn that failed (provider error, usage limit) says nothing about the
   * repo's notes and is not logged; a compaction is not a request.
   */
  private learn(status: StoredAgentRun['status']): void {
    const refine = this.o.refine;
    if (!refine || this.o.compact || (status !== 'done' && status !== 'stopped')) return;
    const ledger = this.ledger();
    setImmediate(() => {
      try {
        recordTurn(refine.root, {
          id: this.turnId,
          chat: this.o.chatId ?? 'adhoc',
          agent: this.o.agentRef,
          at: this.startedAt,
          text: this.o.prompt,
          status,
          ledger,
        });
        runSignalLoop(refine.root, { auto: refine.auto });
      } catch {
        /* the loop is best-effort */
      }
    });
  }

  private sentUsage = '';
  /** Usage goes out when it changes, so the turn's closing total does not repeat the last update. */
  private emitUsage(usage: unknown): void {
    const key = JSON.stringify(usage);
    if (key === this.sentUsage) return;
    this.sentUsage = key;
    this.o.emit({ type: 'acp:usage', usage });
  }
}
