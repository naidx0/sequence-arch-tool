/* ══════════════════════════════════════════════════════════════════════════
   AGENT RUNS IN CHAT — one store for every run-node turn the page started
   packages/web2/src/agents/agentRuns.ts

   An agent run (POST /api/acp/run-node, streamed, interactive) is folded into
   ONE record here: the agent's text, its tool calls, its plan and its
   approval requests, in the order they arrived. The chat pane draws the
   record as a thread (chat/AgentRunThread.tsx); the bottom-right toasts
   (chat/AgentToasts.tsx) read the same record. Because both read one store,
   an approval answered in either place settles in both.

   A run belongs to the chat thread that was open when it started
   (`sessionId`), so switching threads does not move it.

   SMALL AT BOOT. This file is the store the page boots with: records,
   subscribers, the chat host. Reading the stream and answering
   (agentRunner.ts) and the fold (agentRunFold.ts, with codex's change
   parsing) load with the first run, so they cost nothing until someone asks
   an agent something. The record a run starts with is still written
   synchronously, so the chat shows it the moment it is asked for.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AskLedgerResult } from '@sequence/schema';
import type { CappedBody } from '../chat/cappedBody';
import type { CodexChange } from '../chat/codexChanges';
import type { SlashCommand } from '../chat/composerModel';
import type { AccessMode, PermissionMode } from '../state/types';
import type { TokenUsage } from './agentTypes';
import type { AgentApproval, AgentQuestion, ApprovalAnswer, Fetch, RunNodeEvent, TurnLogRecord } from './runNodeStream';

export type RunStatus = 'running' | 'done' | 'failed';
export type ToolStatus = 'running' | 'done' | 'failed';

export interface RunMessage {
  kind: 'message';
  id: string;
  text: string;
}

export interface RunTool {
  kind: 'tool';
  id: string;
  title: string;
  /** ACP tool kind: read, edit, execute… */
  toolKind: string | null;
  status: ToolStatus;
  startedAt: number;
  endedAt: number | null;
  /** Codex's change set, when the call is a file change. */
  changes: CodexChange[];
  /** ACP `diff` content blocks, as old/new text per path. */
  diffs: { path: string; oldText: string | null; newText: string }[];
  /** What the call printed, if the agent reported it as text. */
  output: string | null;
  /**
   * S6: strings the server cut to 8 KB in this call's latest update, and that
   * update (`capSource`), so "Show all" can put the whole body back at
   * `capped.at` and fold it again (chat/cappedBody.ts).
   */
  capped?: CappedBody[];
  capSource?: unknown;
  /** S2b: the subagent this call started (Claude's Task tool), for the strip. */
  subagent?: string | null;
  /** R10: the Task call this call ran inside (a subagent's own step), when the bridge says so. */
  parentId?: string | null;
}

export interface RunPlan {
  kind: 'plan';
  id: string;
  entries: { content: string; status: string }[];
  startedAt: number;
  endedAt: number | null;
}

export interface RunApprovalRef {
  kind: 'approval';
  id: string;
  /** When the question was put. */
  at: number;
  /** When it was settled. */
  settledAt: number | null;
}

/**
 * S2b: the agent thinking (ACP agent_thought_chunk; codex's reasoning items).
 * Open until the first answer token or tool call. `ms` is the agent's own
 * measure when it gave one (codex's start and end times), else the clock's.
 */
export interface RunThought {
  kind: 'thought';
  id: string;
  text: string;
  startedAt: number;
  endedAt: number | null;
  ms: number | null;
  /** The agent's own start time (codex), to measure `ms` against. */
  agentAt?: number | null;
}

/** The agent asked the person (codex requestUserInput); the run's `questions` hold it. */
export interface RunQuestionRef {
  kind: 'question';
  id: string;
  at: number;
  settledAt: number | null;
}

/** One quiet line from the mode, said once per run (Plan declining an edit). */
export interface RunNote {
  kind: 'note';
  id: string;
  text: string;
}

export type RunItem = RunMessage | RunTool | RunPlan | RunApprovalRef | RunThought | RunQuestionRef | RunNote;

export interface AgentRun {
  /** Server transcript id, used to avoid rendering restored prose beside the live run twice. */
  transcriptId?: string;
  /** The server's id for this turn (what Edit from here names); absent until the turn reached the server. */
  turnId?: string;
  lastEventAt?: number;
  /** A Retry was pressed on this run; a new run took its question. */
  retried?: boolean;
  stalled?: { since: number; reason: string } | null;
  waiting?: RunWaiting | null;
  tokens?: RunTokens | null;
  answerComplete?: boolean;
  endedWithoutAnswer?: boolean;
  operation?: 'prompt' | 'compact';
  stopReason?: string;
  /** The ask ledger (t3gap/asks): the asks of a multi-ask message and the ones the agent's closing line left open. */
  askLedger?: AskLedgerResult | null;
  /** The run was sent with the ask ledger on: only then is a closing line cut from its text. */
  askLedgerOn?: boolean;
  /** Its "Not done" requests were asked again (by the button or by auto): the button is spent. */
  askedAgain?: boolean;
  id: string;
  /** The chat thread it belongs to. */
  sessionId: string | null;
  agentRef: string | null;
  /** The board node it was started from, pinned as context. */
  nodeId: string | null;
  nodeLabel: string | null;
  prompt: string;
  /** What the person pointed at on a board (askInPlace/): shown as chips; the blocks go to the agent after the prompt. */
  refs?: RunRef[];
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  items: RunItem[];
  approvals: AgentApproval[];
  /** The agent's questions to the person, oldest first (written by the lazy fold; absent until one is asked). */
  questions?: AgentQuestion[];
  /** The failure, in the server's or the stream's words. */
  error: string | null;
  /** What the run may do without asking (the composer's chip shows it). */
  access?: AccessMode;
  /**
   * S1, written by the lazy runner and fold (never at boot):
   * `turn`      ended (the agent said so), settled (the server is done), or
   *             hung (no progress for the idle limit; the turn was stopped).
   * `resumed`   whether the agent rejoined this chat's earlier thread, and
   *             why not when it could not (`resumeNote`).
   * `recovery`  what the person can do about a failure.
   * `retry`     how to run the same question again (it resumes the thread).
   */
  turn?: 'ended' | 'settled' | 'hung';
  resumed?: boolean;
  resumeNote?: string | null;
  /** Edit from here ran before this turn: the agent's thread was rolled back, or started again from the kept chat. */
  rewound?: 'rolled-back' | 'reseeded';
  recovery?: RunRecovery | null;
  retry?: StartRunOptions;
  /**
   * S2b, written by the lazy fold (never at boot):
   * `cliPlan`   the CLI's own plan (codex's goal, an ACP markdown plan)
   * `usage`     context used of the window, and the cost when the agent says
   * `limits`    the account's rate-limit windows (codex)
   * `mode`      the session mode the agent says it is in
   * `intent`    Plan or Build, as the run was asked
   */
  cliPlan?: { id: string; content: string; status: string | null } | null;
  usage?: { used: number; size: number; cost: { amount: number; currency: string } | null } | null;
  /** Round 9 (ask 30): the tokens the agent reported for this turn (input, output, cache). Kept with the saved run. */
  turnUsage?: TokenUsage | null;
  limits?: RunLimits | null;
  mode?: string | null;
  intent?: PermissionMode;
  /** Round 7: the model the agent said this run's turn runs on (acp:model). */
  model?: string | null;
  /**
   * Round 9, written by the lazy fold:
   * `live`      what the turn is doing now and for how long (acp:status)
   * `queued`    another turn holds this chat's agent; this one waits
   * `answered`  the agent said its piece while its bridge held the turn:
   *             the run is done for the person, Send is back
   * `stopped`   the person pressed Stop; later events are ignored
   * `log`       the turn's diagnostic record (no words)
   * `restored`  read back from disk after a relaunch
   */
  live?: RunLive | null;
  queued?: boolean;
  answered?: boolean;
  stopped?: boolean;
  log?: TurnLogRecord | null;
  restored?: boolean;
  /** A restart cut this turn off before it ended (read back from disk); Continue resumes the agent and sends "Continue where you left off." */
  interrupted?: boolean;
  /** The person pressed Don't on this chat's automatic rerun after a usage limit (kept in the run, so a remount keeps it). */
  autoDeclined?: boolean;
}

/** Round 9: the turn's live status (acp turnStatus.ts TurnStatus). */
export interface RunLive {
  phase: string;
  forMs: number;
  quietMs: number;
  openTools: number;
  tool: { kind: string | null; title: string | null } | null;
  /** When the server said it (the page's clock), so the seconds keep counting between reports. */
  at: number;
}

export interface RunLimitWindow {
  usedPercent: number;
  windowMins: number | null;
  resetsAt: number | null;
}

/** The account's rate-limit windows, as codex reports them (acp codexUpdates.ts). */
export interface RunLimits {
  plan: string | null;
  primary: RunLimitWindow | null;
  secondary: RunLimitWindow | null;
}

/** What an agent offers the picker and the `/` menu (GET /api/acp/capabilities). */
export interface AgentCaps {
  models: { id: string; name: string; description?: string; efforts: string[]; defaultEffort?: string; isDefault?: boolean }[];
  efforts: string[];
  commands: { name: string; description: string; hint?: string }[];
  skills: { name: string; description: string }[];
  /** The `/` rows for these commands and skills, built in the lazy runner (agentSlash) so the composer only appends them. */
  slash?: SlashCommand[];
}

/** A failed run's next step: sign in to the vendor again, retry (resume), install, or wait for a usage limit to reset. */
export interface RunRecovery {
  kind: 'signIn' | 'retry' | 'install' | 'wait' | 'settings';
  /** The vendor whose login to run (`codex`, `claude`), for signIn; whose limit it is, for wait. */
  provider?: string;
  /** For wait: when the limit resets (epoch ms), when the agent said. */
  resetsAt?: number;
  /** Why it failed, finer than what to do about it (acp recovery.ts FailureCause). */
  cause?: 'notInstalled' | 'signedOut' | 'usageLimit' | 'bridgeExit' | 'timeout' | 'network' | 'localServer' | 'unknown';
}

export const DEFAULT_NODE_QUESTION =
  'Explain this part of the system: what it does, what depends on it, and what would break if it changed. Cite file:line.';

/** A board selection riding on a run: the chip's words and the block the agent receives. */
export interface RunRef {
  label: string;
  block: string;
}

export interface StartRunOptions {
  /** askInPlace/: the board items the question is about. */
  refs?: RunRef[];
  /** The board node the run is about; the server cuts its map slice into the prompt. */
  nodeId?: string | null;
  nodeLabel?: string | null;
  question?: string;
  agentRef?: string;
  intent?: PermissionMode;
  access?: AccessMode;
  sessionId?: string | null;
  /** S2b: compact the conversation's context instead of asking anything. */
  compact?: boolean;
  /** S2a: images, files and board nodes for the agent; the server resolves each (run-node `attachments`). */
  attachments?: RunAttachment[];
}

/** S2a: what a turn carries beside its text. */
export type RunAttachment = { kind: 'image'; id: string } | { kind: 'text'; id: string } | { kind: 'file'; path: string } | { kind: 'node'; nodeId: string };

export interface AgentRunsState {
  /** Turns kept in a chat's archive and not on the page yet, per chat: how many remain and how many were fetched from its end. Kept here so a re-mounted layer (virtual layout, chat switch) still shows the pager. */
  older?: Readonly<Record<string, { remaining: number; loaded: number }>>;
  /** A chat's saved-file notice (damaged, restored from backup), per chat. */
  notes?: Readonly<Record<string, string>>;
  tokensBySession?: Readonly<Record<string, RunTokenCounts>>;
  /** Usage restored from disk; kept apart from retained live records to avoid counting a turn twice. */
  persistedTokenRuns?: readonly TokenRun[];
  runs: readonly AgentRun[];
  /** Toasts the person dismissed (`<runId>:<what>`). */
  dismissed: ReadonlySet<string>;
  /**
   * S2b. `agents`: the agent each chat talks to (chat id -> agent id), set
   * when a run starts there, cleared when the person picks a model. `caps`:
   * what each agent offers. `config`: the model and effort picked per agent.
   */
  agents?: Readonly<Record<string, string>>;
  caps?: Readonly<Record<string, AgentCaps>>;
  /** Round 7: why an agent's capabilities could not be read, until a person asks again. */
  capsError?: Readonly<Record<string, string>>;
  config?: Readonly<Record<string, { model?: string; effort?: string }>>;
}

/**
 * Where a run lands in the page: the chat pane registers itself here, so a run
 * started from the board can pin its node as a context chip and belong to the
 * open thread.
 */
export interface ChatHost {
  sessionId: () => string | null;
  /** Pin the node the run is about as a composer context chip. */
  pinNode?: (nodeId: string) => string | null;
}

export interface AgentRunStore {
  get(): AgentRunsState;
  subscribe(fn: () => void): () => void;
  start(opts: StartRunOptions, f?: Fetch): Promise<AgentRun>;
  /** Answer one approval; both the chat card and the toast call this. */
  answer(runId: string, requestId: string, decision: ApprovalAnswer, f?: Fetch): Promise<void>;
  dismiss(key: string): void;
  setHost(host: ChatHost | null): void;
  /** Fold an event into a run (the runner, tests, replays). */
  apply(runId: string, e: RunNodeEvent): void;
  /**
   * S6: run `fn` (several `apply`s) and tell subscribers once, so a frame's
   * worth of stream events is one commit (frameQueue.ts).
   */
  batch(fn: () => void): void;
  /** S2b: change the store-wide part of the state (which agent a chat talks to, caps, config). */
  patch(fn: (s: AgentRunsState) => AgentRunsState): void;
  /** S2b: stop a running run (its stream is dropped, so the server cancels the turn). */
  stop(runId: string): void;
  /** The person asked to run this failed or stopped run again: its Retry is spent (kept in the run, so it survives a remount). */
  markRetried(runId: string): void;
  /**
   * Round 9: put a chat's saved runs back (GET /api/acp/runs after a
   * relaunch). Ignored when the chat already has runs on the page.
   */
  hydrate(sessionId: string, runs: AgentRun[]): void;
  /**
   * Edit from here: drop `runId` and every later run of its chat from the page.
   * Returns how many runs of the chat stay (the server keeps the same number)
   * and what was removed, or null for an unknown run or one still running.
   */
  truncateFrom(runId: string): { sessionId: string; keep: number; removed: AgentRun[] } | null;
  /** Edit undone: put the removed runs back after what the chat still holds. */
  restore(runs: readonly AgentRun[]): void;
}

/** What the runner (agentRunner.ts) is handed: the store's own write path. */
export interface RunWriter {
  store: AgentRunStore;
  update(id: string, fn: (r: AgentRun) => AgentRun): void;
  find(id: string): AgentRun | undefined;
  defaultFetch: Fetch;
}

type Fold = (run: AgentRun, e: RunNodeEvent, now: number) => AgentRun;
let fold: Fold | null = null;

/** agentRunFold.ts registers itself here when it loads. */
export function registerFold(f: Fold): void {
  fold = f;
}

export function createAgentRunStore(opts: { clock?: () => number; fetch?: Fetch } = {}): AgentRunStore {
  const clock = opts.clock ?? (() => Date.now());
  let state: AgentRunsState = { runs: [], dismissed: new Set() };
  const listeners = new Set<() => void>();
  let host: ChatHost | null = null;
  let seq = 0;
  const defaultFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  /* Inside `batch`, a change is noted and told once at the end. */
  let batching = 0;
  let changed = false;
  const emit = (): void => {
    if (batching > 0) {
      changed = true;
      return;
    }
    for (const l of [...listeners]) l();
  };
  const update = (id: string, fn: (r: AgentRun) => AgentRun): void => {
    const at = state.runs.findIndex((r) => r.id === id);
    if (at === -1) return;
    const next = fn(state.runs[at]);
    if (next === state.runs[at]) return;
    const runs = state.runs.slice();
    runs[at] = next;
    state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs) };
    emit();
  };
  const find = (id: string): AgentRun | undefined => state.runs.find((r) => r.id === id);

  const store: AgentRunStore = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setHost(next) {
      host = next;
    },
    patch(fn) {
      state = fn(state);
      emit();
    },
    dismiss(key) {
      if (state.dismissed.has(key)) return;
      state = { ...state, dismissed: new Set([...state.dismissed, key]) };
      emit();
    },
    batch(fn) {
      batching += 1;
      try {
        fn();
      } finally {
        batching -= 1;
        if (batching === 0 && changed) {
          changed = false;
          emit();
        }
      }
    },
    apply(runId, e) {
      const now = clock();
      if (fold) {
        const f = fold;
        update(runId, (r) => f(r, e, now));
        return;
      }
      void import('./agentRunFold').then(() => store.apply(runId, e)).catch((err) => console.warn('agent run fold failed to load', err));
    },
    async start(o, f = defaultFetch) {
      const id = `run-${++seq}-${clock().toString(36)}`;
      const label = o.nodeId && host?.pinNode ? host.pinNode(o.nodeId) : null;
      const run: AgentRun = {
        id,
        sessionId: o.sessionId !== undefined ? o.sessionId : (host?.sessionId() ?? null),
        agentRef: o.agentRef ?? null,
        nodeId: o.nodeId ?? null,
        nodeLabel: o.nodeLabel ?? label ?? null,
        prompt: o.question ?? DEFAULT_NODE_QUESTION,
        ...(o.refs?.length ? { refs: o.refs } : {}),
        operation: o.compact ? 'compact' : 'prompt',
        status: 'running',
        startedAt: clock(),
        endedAt: null,
        items: [],
        approvals: [],
        error: null,
        lastEventAt: clock(), stalled: null, waiting: null,
      };
      /* An earlier run of this chat that answered may still hold its stream (the bridge keeps the prompt open): a new send ends it. */
      if (run.sessionId && !run.nodeId) {
        for (const r of state.runs) if (r.sessionId === run.sessionId && !r.nodeId && r.status === 'done' && r.answered) void import('./agentRunner').then((m) => m.stopRun(r.id)).catch((err) => console.warn('stop failed', err));
      }
      /* S2b: the chat talks to this agent from now on (the runner names it when it had to look one up). */
      const sid = run.sessionId;
      state = { ...state, runs: [...state.runs, run], ...(o.agentRef && sid ? { agents: { ...state.agents, [sid]: o.agentRef } } : {}) };
      emit();
      const { streamRun } = await import('./agentRunner');
      return streamRun({ store, update, find, defaultFetch }, run, o, f);
    },
    markRetried(runId) {
      update(runId, (r) => (r.retried ? r : { ...r, retried: true }));
    },
    stop(runId) {
      /* Round 9: the chat is free at once, whatever the agent does with its cancel. */
      update(runId, (r) => {
        if (r.status !== 'running') return r;
        const at = clock();
        const items = r.items.map((i): RunItem =>
          i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'failed', endedAt: at } : i.kind === 'thought' && i.endedAt === null ? { ...i, endedAt: at, ms: at - i.startedAt } : i,
        );
        return { ...r, items, status: 'failed', stopped: true, endedAt: at, error: 'Stopped.', recovery: { kind: 'retry' }, live: null, queued: false };
      });
      void import('./agentRunner').then((m) => m.stopRun(runId)).catch((err) => console.warn('stop failed', err));
    },
    hydrate(sessionId, saved) {
      const have = new Set(state.runs.map((r) => r.id));
      const runs = saved.filter((r) => !have.has(r.id)).map((r) => ({ ...r, sessionId, restored: true }));
      if (runs.length === 0) return;
      const last = runs[runs.length - 1]!;
      const agents = last.agentRef && !state.agents?.[sessionId] ? { agents: { ...state.agents, [sessionId]: last.agentRef } } : {};
      /* Saved history goes ahead of the runs already live in this chat. */
      state = { ...state, runs: [...runs, ...state.runs], ...agents };
      emit();
    },
    truncateFrom(runId) {
      const at = state.runs.find((r) => r.id === runId);
      if (!at || !at.sessionId || at.status === 'running') return null;
      const mine = state.runs.filter((r) => r.sessionId === at.sessionId);
      const index = mine.findIndex((r) => r.id === runId);
      if (mine.slice(index).some((r) => r.status === 'running')) return null;
      const gone = new Set(mine.slice(index).map((r) => r.id));
      const runs = state.runs.filter((r) => !gone.has(r.id));
      state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs) };
      emit();
      return { sessionId: at.sessionId, keep: index, removed: mine.slice(index) };
    },
    restore(back) {
      const first = back[0];
      if (!first?.sessionId) return;
      const have = new Set(state.runs.map((r) => r.id));
      const add = back.filter((r) => !have.has(r.id));
      if (add.length === 0) return;
      const at = state.runs.reduce((n, r, i) => (r.sessionId === first.sessionId ? i : n), -1);
      const runs = at < 0 ? [...state.runs, ...add] : [...state.runs.slice(0, at + 1), ...add, ...state.runs.slice(at + 1)];
      state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs) };
      emit();
    },
    async answer(runId, requestId, decision, f = defaultFetch) {
      /* The runner marks it as being answered, on the card and the toast, and
         sends it. It is loaded already: a run had to start to ask anything. */
      const { sendAnswer } = await import('./agentRunner');
      await sendAnswer({ store, update, find, defaultFetch }, runId, requestId, decision, f);
    },
  };
  return store;
}

/** The page's one run store. */
export const agentRuns: AgentRunStore = createAgentRunStore();

export interface RunTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
}
export interface RunTokens extends RunTokenCounts {
  scope: 'turn' | 'thread';
  threadId?: string;
  totalTokens?: number;
}
export interface RunWaiting {
  reason: 'queued' | 'approval' | 'tool' | 'quiet';
  quietMs: number;
  toolMs?: number;
  toolKind?: string;
}

/** Cumulative thread samples are counted once per thread, alongside per-turn ACP usage. */
type TokenRun = Pick<AgentRun, 'id' | 'agentRef' | 'sessionId' | 'tokens'>;
export function tokenTotalsBySession(runs: readonly TokenRun[]): Record<string, RunTokenCounts> {
  const sums: Record<string, RunTokenCounts> = {}, threads = new Map<string, { sid: string; tokens: RunTokens }>();
  const add = (sid: string, t: RunTokenCounts) => {
    const s = sums[sid] ??= { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 };
    s.inputTokens += t.inputTokens; s.outputTokens += t.outputTokens;
    for (const key of ['cachedReadTokens', 'cachedWriteTokens'] as const) s[key] = s[key] === null || t[key] === null ? null : s[key]! + t[key]!;
  };
  for (const r of runs) {
    if (!r.tokens || !r.sessionId) continue;
    if (r.tokens.scope === 'turn') add(r.sessionId, r.tokens);
    else {
      const key = JSON.stringify([r.sessionId, r.agentRef, r.tokens.threadId ?? r.id]);
      const prior = threads.get(key);
      if (!prior || r.tokens.inputTokens + r.tokens.outputTokens >= prior.tokens.inputTokens + prior.tokens.outputTokens) threads.set(key, { sid: r.sessionId, tokens: r.tokens });
    }
  }
  for (const { sid, tokens } of threads.values()) add(sid, tokens);
  return sums;
}

/** Saved agent rows are already rendered by a retained live run in this browser. A fresh page keeps every row. */
export function transcriptForRestore(raw: unknown, runs: readonly AgentRun[]): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const doc = raw as { sessionId?: string; turns?: unknown[] };
  if (!Array.isArray(doc.turns)) return raw;
  const live = new Set(runs.filter(r => r.sessionId === doc.sessionId && r.transcriptId).map(r => r.transcriptId));
  return { ...doc, turns: doc.turns.filter(t => !live.has((t as { agentTurn?: { id?: string } } | null)?.agentTurn?.id)) };
}

function tokenTotalsForState(state: AgentRunsState, runs = state.runs): Record<string, RunTokenCounts> {
  return tokenTotalsBySession([...(state.persistedTokenRuns ?? []).filter(s => !runs.some(r => r.transcriptId === s.id && r.sessionId === s.sessionId && r.tokens)), ...runs]);
}

export function parseRunTokens(raw: unknown): RunTokens | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as RunTokens;
  if (t.scope !== 'turn' && t.scope !== 'thread') return null;
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!valid(t.inputTokens) || !valid(t.outputTokens)) return null;
  return { ...t, cachedReadTokens: valid(t.cachedReadTokens) ? t.cachedReadTokens : null, cachedWriteTokens: valid(t.cachedWriteTokens) ? t.cachedWriteTokens : null };
}

/** Both hydration paths call this: restore usage, then omit prose already shown by a retained run. */
export function restoreAgentTranscript(raw: unknown, store: AgentRunStore = agentRuns): unknown {
  const doc = raw as { sessionId?: string; turns?: { role?: string; agentTurn?: { id?: string; agentRef?: string; tokens?: unknown } }[] } | null;
  if (!doc || typeof doc.sessionId !== 'string' || !Array.isArray(doc.turns)) return raw;
  const saved: TokenRun[] = doc.turns.flatMap(t => {
    const tokens = parseRunTokens(t?.agentTurn?.tokens);
    return t?.role === 'assistant' && tokens && t.agentTurn?.id ? [{ id: t.agentTurn.id, agentRef: t.agentTurn.agentRef ?? null, sessionId: doc.sessionId!, tokens }] : [];
  });
  store.patch(state => {
    const next = { ...state, persistedTokenRuns: [...(state.persistedTokenRuns ?? []).filter(t => t.sessionId !== doc.sessionId), ...saved] };
    return { ...next, tokensBySession: tokenTotalsForState(next) };
  });
  return transcriptForRestore(raw, store.get().runs);
}
