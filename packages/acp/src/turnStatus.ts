/* ══════════════════════════════════════════════════════════════════════════
   A TURN IS ANSWERED WHEN THE AGENT HAS SAID ITS PIECE, AND NEVER SILENT
   packages/acp/src/turnStatus.ts

   Round 9 (Jaden's walkthrough, from his real logs):
     · the Claude bridge (claude-agent-acp) holds `session/prompt` open after
       Claude has answered while background helpers finish, so the chat kept
       showing Stop with the answer already on screen;
     · a stall said nothing: no reason, no retry, no record.

   Three small, pure pieces, each on an injectable clock:

   TurnAnswerDetector  decides when the turn is ANSWERED: the agent wrote
                       text, every tool call it started has settled, and
                       nothing moved for `quietMs` (shorter once the bridge
                       has reported the turn's cost, which it does when
                       Claude's reply is complete). `session/prompt`
                       returning is still the turn's END; answered only lets
                       the person carry on while the bridge finishes.
   TurnStatusTracker   what the turn is doing now, in one phrase, with how
                       long: queued, waiting for the agent, thinking,
                       writing, running a tool, waiting on the person, quiet.
                       The server sends it every few seconds, so a stall
                       always reads as one.
   TurnLog             the turn's diagnostic record: phases, tool kinds,
                       approvals, the stop reason, the error. Never the
                       person's words or the agent's, never a tool's input.
   ══════════════════════════════════════════════════════════════════════════ */

export interface StatusClock {
  now?(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const nowOf = (c: StatusClock): number => (typeof c.now === 'function' ? c.now() : Date.now());

/** The parts of an ACP `session/update` these pieces read. */
export interface UpdateLike {
  sessionUpdate: string;
  toolCallId?: string;
  status?: string | null;
  kind?: string | null;
  title?: string | null;
  content?: unknown;
  cost?: unknown;
}

function updateOf(n: unknown): UpdateLike | null {
  const u = (n as { update?: unknown } | null)?.update ?? n;
  if (!u || typeof u !== 'object' || typeof (u as { sessionUpdate?: unknown }).sessionUpdate !== 'string') return null;
  return u as UpdateLike;
}

function hasText(u: UpdateLike): boolean {
  const c = u.content as { type?: unknown; text?: unknown } | undefined;
  return !!c && c.type === 'text' && typeof c.text === 'string' && c.text.trim() !== '';
}

const SETTLED = new Set(['completed', 'failed', 'cancelled']);

/* ── answered ───────────────────────────────────────────────────────────── */

/** Quiet after the last words before the turn counts as answered. */
export const ANSWER_QUIET_MS = 6_000;
/** The same, once the bridge has reported the turn's cost (its reply is complete). */
export const ANSWER_QUIET_AFTER_COST_MS = 1_200;

export interface TurnAnswerDetectorOptions {
  clock: StatusClock;
  onAnswered: () => void;
  quietMs?: number;
  quietAfterCostMs?: number;
}

export class TurnAnswerDetector {
  private readonly clock: StatusClock;
  private readonly onAnswered: () => void;
  private readonly quietMs: number;
  private readonly quietAfterCostMs: number;
  private readonly open = new Set<string>();
  private wrote = false;
  private costSeen = false;
  private timer: unknown = null;
  private done = false;
  private pauses = 0;

  constructor(opts: TurnAnswerDetectorOptions) {
    this.clock = opts.clock;
    this.onAnswered = opts.onAnswered;
    this.quietMs = opts.quietMs ?? ANSWER_QUIET_MS;
    this.quietAfterCostMs = opts.quietAfterCostMs ?? ANSWER_QUIET_AFTER_COST_MS;
  }

  get answered(): boolean {
    return this.done;
  }

  /** Feed one `session/update` notification (or its `update`). */
  update(n: unknown): void {
    if (this.done) return;
    const u = updateOf(n);
    if (!u) return;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        if (hasText(u)) {
          this.wrote = true;
          this.costSeen = false;
        }
        break;
      case 'agent_thought_chunk':
      case 'plan':
        /* Still working: the words so far were not the answer. */
        this.wrote = false;
        this.costSeen = false;
        break;
      case 'tool_call':
        if (u.toolCallId && !SETTLED.has(String(u.status ?? ''))) this.open.add(u.toolCallId);
        this.wrote = false;
        this.costSeen = false;
        break;
      case 'tool_call_update':
        if (u.toolCallId && SETTLED.has(String(u.status ?? ''))) this.open.delete(u.toolCallId);
        else if (u.toolCallId && u.status) this.open.add(u.toolCallId);
        break;
      case 'usage_update':
        if (u.cost !== undefined && u.cost !== null) this.costSeen = true;
        break;
      default:
        break;
    }
    this.rearm();
  }

  /** A person is being asked something: not answered while they decide. */
  pause(): () => void {
    this.pauses += 1;
    this.disarm();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pauses -= 1;
      this.rearm();
    };
  }

  /** The turn ended by itself; nothing left to decide. */
  stop(): void {
    this.done = true;
    this.disarm();
  }

  private rearm(): void {
    this.disarm();
    if (this.done || this.pauses > 0 || !this.wrote || this.open.size > 0) return;
    const ms = this.costSeen ? this.quietAfterCostMs : this.quietMs;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (this.done || this.pauses > 0 || !this.wrote || this.open.size > 0) return;
      this.done = true;
      this.onAnswered();
    }, ms);
  }

  private disarm(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/* ── live status ────────────────────────────────────────────────────────── */

export type TurnPhase = 'queued' | 'starting' | 'waiting' | 'thinking' | 'writing' | 'tool' | 'approval' | 'quiet' | 'answered';

export interface TurnStatus {
  phase: TurnPhase;
  /** How long it has been in this phase. */
  forMs: number;
  /** Since anything real last happened (text, a tool, a plan step). */
  quietMs: number;
  /** The whole turn so far. */
  elapsedMs: number;
  /** The tool running, by kind and title, in the `tool` phase. */
  tool?: { kind: string | null; title: string | null };
  /** Tool calls still open (background helpers after the answer). */
  openTools: number;
}

/** No progress this long, outside a tool or a question, reads as quiet. */
export const QUIET_AFTER_MS = 20_000;

export class TurnStatusTracker {
  private readonly clock: StatusClock;
  private readonly quietAfterMs: number;
  private readonly startedAt: number;
  private phase: TurnPhase;
  private phaseAt: number;
  private lastProgress: number;
  private readonly tools = new Map<string, { kind: string | null; title: string | null; at: number }>();
  private asking = 0;
  private answeredFlag = false;

  constructor(opts: { clock: StatusClock; queued?: boolean; quietAfterMs?: number }) {
    this.clock = opts.clock;
    this.quietAfterMs = opts.quietAfterMs ?? QUIET_AFTER_MS;
    this.startedAt = nowOf(this.clock);
    this.phase = opts.queued ? 'queued' : 'starting';
    this.phaseAt = this.startedAt;
    this.lastProgress = this.startedAt;
  }

  private set(p: TurnPhase): void {
    if (p === this.phase) return;
    this.phase = p;
    this.phaseAt = nowOf(this.clock);
  }

  /** Another turn holds the agent: this one waits. */
  queued(): void {
    this.set('queued');
  }

  /** The turn left the queue and the agent is being started (or reused). */
  started(): void {
    if (this.phase === 'queued') this.set('starting');
    this.lastProgress = nowOf(this.clock);
  }

  /** The prompt is with the agent; nothing has come back yet. */
  sent(): void {
    if (this.phase === 'starting' || this.phase === 'queued') this.set('waiting');
    this.lastProgress = nowOf(this.clock);
  }

  answered(): void {
    this.answeredFlag = true;
    this.set('answered');
  }

  asked(): () => void {
    this.asking += 1;
    this.set('approval');
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.asking -= 1;
      this.lastProgress = nowOf(this.clock);
      if (this.asking === 0) this.set(this.openTool() ? 'tool' : this.answeredFlag ? 'answered' : 'waiting');
    };
  }

  private openTool(): { kind: string | null; title: string | null; at: number } | undefined {
    let last: { kind: string | null; title: string | null; at: number } | undefined;
    for (const t of this.tools.values()) last = t;
    return last;
  }

  update(n: unknown): void {
    const u = updateOf(n);
    if (!u) return;
    const now = nowOf(this.clock);
    const real = ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(u.sessionUpdate);
    if (!real) return;
    this.lastProgress = now;
    if (u.sessionUpdate === 'tool_call' && u.toolCallId) {
      if (!SETTLED.has(String(u.status ?? ''))) this.tools.set(u.toolCallId, { kind: u.kind ?? null, title: typeof u.title === 'string' ? u.title : null, at: now });
    } else if (u.sessionUpdate === 'tool_call_update' && u.toolCallId) {
      const had = this.tools.get(u.toolCallId);
      if (SETTLED.has(String(u.status ?? ''))) this.tools.delete(u.toolCallId);
      else if (had && typeof u.title === 'string') had.title = u.title;
    }
    if (this.answeredFlag || this.asking > 0) return;
    if (u.sessionUpdate === 'agent_thought_chunk') this.set('thinking');
    else if (u.sessionUpdate === 'agent_message_chunk') this.set('writing');
    else if (this.tools.size > 0) {
      /* A new tool restarts the phase clock so "for N s" is this tool's time. */
      const t = this.openTool()!;
      if (this.phase !== 'tool' || this.phaseAt < t.at) {
        this.phase = 'tool';
        this.phaseAt = t.at;
      }
    } else this.set('waiting');
  }

  /** The status now. Quiet overrides writing/thinking/waiting after `quietAfterMs`. */
  snapshot(): TurnStatus {
    const now = nowOf(this.clock);
    const quietMs = Math.max(0, now - this.lastProgress);
    const t = this.openTool();
    let phase = this.phase;
    let forMs = now - this.phaseAt;
    if ((phase === 'writing' || phase === 'thinking' || phase === 'waiting' || phase === 'starting') && quietMs >= this.quietAfterMs) {
      phase = 'quiet';
      forMs = quietMs;
    }
    return {
      phase,
      forMs: Math.max(0, forMs),
      quietMs,
      elapsedMs: Math.max(0, now - this.startedAt),
      ...(phase === 'tool' && t ? { tool: { kind: t.kind, title: t.title } } : {}),
      openTools: this.tools.size,
    };
  }
}

/** Every `everyMs`, and on demand, hand the status to `emit`. Stop with the returned function. */
export function tickStatus(tracker: TurnStatusTracker, clock: StatusClock, emit: (s: TurnStatus) => void, everyMs = 5_000): () => void {
  let handle: unknown = null;
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    emit(tracker.snapshot());
    handle = clock.setTimeout(tick, everyMs);
    (handle as { unref?: () => void } | null)?.unref?.();
  };
  handle = clock.setTimeout(tick, everyMs);
  (handle as { unref?: () => void } | null)?.unref?.();
  return () => {
    stopped = true;
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  };
}

/* ── the turn log ───────────────────────────────────────────────────────── */

export interface TurnLogEntry {
  /** ms since the turn was asked for. */
  t: number;
  ev: string;
  [k: string]: string | number | boolean | null | undefined;
}

export interface TurnLogRecord {
  turnId: string;
  chatId: string | null;
  agentRef: string;
  provider: string | null;
  startedAt: string;
  ms: number;
  /** answered | ended | stopped | hung | failed */
  outcome: string;
  stopReason?: string;
  error?: string;
  tools: number;
  approvals: number;
  updates: number;
  entries: TurnLogEntry[];
}

/** At most this many entries; the rest are counted, not kept. */
const LOG_MAX = 80;

export class TurnLog {
  private readonly clock: StatusClock;
  private readonly t0: number;
  private readonly entries: TurnLogEntry[] = [];
  private dropped = 0;
  private tools = 0;
  private approvals = 0;
  private updates = 0;
  private readonly startedAt: string;

  constructor(
    private readonly meta: { turnId: string; chatId: string | null; agentRef: string; provider: string | null },
    clock: StatusClock,
  ) {
    this.clock = clock;
    this.t0 = nowOf(clock);
    this.startedAt = new Date(this.t0 > 1e11 ? this.t0 : Date.now()).toISOString();
  }

  /** Record one event. Strings are cut to 300 characters; callers never pass words from the chat. */
  add(ev: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
    if (ev === 'approval') this.approvals += 1;
    if (this.entries.length >= LOG_MAX) {
      this.dropped += 1;
      return;
    }
    const e: TurnLogEntry = { t: Math.max(0, nowOf(this.clock) - this.t0), ev };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      e[k] = typeof v === 'string' ? v.slice(0, 300) : v;
    }
    this.entries.push(e);
  }

  /** Count an update; tool starts are logged by kind only (a title can carry a command or a path). */
  update(n: unknown): void {
    const u = updateOf(n);
    if (!u) return;
    this.updates += 1;
    if (u.sessionUpdate === 'tool_call') {
      this.tools += 1;
      this.add('tool', { kind: u.kind ?? 'other', status: u.status ?? 'pending' });
    } else if (u.sessionUpdate === 'tool_call_update' && SETTLED.has(String(u.status ?? ''))) {
      this.add('tool-end', { status: String(u.status) });
    }
  }

  finish(outcome: string, extra: { stopReason?: string; error?: string } = {}): TurnLogRecord {
    if (this.dropped) this.entries.push({ t: Math.max(0, nowOf(this.clock) - this.t0), ev: 'dropped', count: this.dropped });
    return {
      ...this.meta,
      startedAt: this.startedAt,
      ms: Math.max(0, nowOf(this.clock) - this.t0),
      outcome,
      ...(extra.stopReason ? { stopReason: extra.stopReason } : {}),
      ...(extra.error ? { error: extra.error.slice(0, 500) } : {}),
      tools: this.tools,
      approvals: this.approvals,
      updates: this.updates,
      entries: this.entries.slice(),
    };
  }
}
