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

import { prefStorage } from '../boot/prefStorage';
import { normalizeWorkspacePath } from '../sessions/workspaceEvents';
import { readSavedPicks, stateFromSaved, writeSavedPicks } from './chatConfig';
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

/** Words the person put into the turn while it ran (codex steer). Drawn as their message, marked as sent mid-turn. */
export interface RunSteer {
  kind: 'steer';
  id: string;
  text: string;
  at: number;
}

export type RunItem = RunMessage | RunSteer | RunTool | RunPlan | RunApprovalRef | RunThought | RunQuestionRef | RunNote;

export interface AgentRun {
  /** The workspace the run belongs to (`workspaceKeyOf(root)`: the normalised repo root, or the home key). Chat ids are only unique inside one workspace. Absent until the page has switched workspaces in place. */
  ws?: string;
  /** Server transcript id, used to avoid rendering restored prose beside the live run twice. */
  transcriptId?: string;
  /** The server's id for this turn (what Edit from here names); absent until the turn reached the server. */
  turnId?: string;
  lastEventAt?: number;
  /** The agent was given this chat so far ('full') or what it missed ('delta') with this prompt; saved with the turn, so a reload says it too. */
  handoff?: { chars: number; kind: 'full' | 'delta' };
  /** A Retry was pressed on this run; a new run took its question. */
  retried?: boolean;
  stalled?: { since: number; reason: string } | null;
  waiting?: RunWaiting | null;
  tokens?: RunTokens | null;
  answerComplete?: boolean;
  endedWithoutAnswer?: boolean;
  operation?: 'prompt' | 'compact';
  /** On a compaction: the turns of the chat that came before it, which its summary stands for (absent when not known). */
  summarizedTurns?: number;
  stopReason?: string;
  /** Repo files and folders the run's Read, search and map calls named (`svc:` ids from the map tool); the coverage line is computed from them. Absent when it read nothing. */
  readPaths?: string[];
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

/* The context ring's lines (chat/ContextRing.tsx CONTEXT_WARN_AT / CONTEXT_FULL_AT); a test holds them equal. */
export const AUTO_COMPACT_WARN_AT = 0.8;
export const AUTO_COMPACT_FULL_AT = 0.95;

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
  /** The app started this compaction itself because the window was full (percent of the window used): the run says so. */
  auto?: { percent: number };
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
  /** 0.1.5 G1: the agents registered on this machine (GET /api/acp/agents), once read; the picker offers each. */
  registered?: readonly string[];
  /** The label each registered agent was given (agents.json), by id: what the pickers and the pill call it. */
  agentLabels?: Readonly<Record<string, string>>;
  config?: Readonly<Record<string, { model?: string; effort?: string }>>;
  /** The model and effort each chat picked (chat id -> pick), kept apart so one chat's pick is never another's (chatConfig.ts). */
  chatConfig?: Readonly<Record<string, import('./chatConfig').ChatPick>>;
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
  /** Take back a chip pinNode added, once the run it was pinned for is over: a chip left behind rides along with every later prompt. */
  unpinNode?: (nodeId: string) => void;
}

export interface AgentRunStore {
  get(): AgentRunsState;
  subscribe(fn: () => void): () => void;
  start(opts: StartRunOptions, f?: Fetch): Promise<AgentRun>;
  /** Answer one approval; both the chat card and the toast call this. */
  answer(runId: string, requestId: string, decision: ApprovalAnswer, f?: Fetch): Promise<void>;
  dismiss(key: string): void;
  setHost(host: ChatHost | null): void;
  /** The agent the open chat is set to talk to; null when the chat is on a built-in model (or no chat is mounted). */
  chatAgent(): string | null;
  /** Pin a board node as a context chip in the open chat's composer (returns its label), or null with no chat mounted. */
  pinNode(nodeId: string): string | null;
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
  /**
   * Offer the chat a compaction once its window is full (the agent's own usage_update at or past the FULL line of the
   * context ring). At most once per fill: it is not repeated until a later turn showed the window had room again.
   * Null when nothing was started.
   */
  autoCompact(sessionId: string | null): Promise<AgentRun> | null;
  /**
   * A run for this chat is about to start (a follow-up sent a tick later, the ask ledger's ask-again) but its `start` has
   * not landed, so no run shows yet. While held, the auto compaction offer starts nothing, so a compaction and a turn
   * never run on one session. Returns the release; calling it twice is harmless.
   */
  holdStart(sessionId: string | null): () => void;
  /** The person asked to run this failed or stopped run again: its Retry is spent (kept in the run, so it survives a remount). */
  markRetried(runId: string): void;
  /** The person steered this running turn: their words join the transcript where they were sent. */
  addSteer(runId: string, text: string): void;
  /**
   * Round 9: put a chat's saved runs back (GET /api/acp/runs after a
   * relaunch). Ignored when the chat already has runs on the page.
   */
  hydrate(sessionId: string, runs: AgentRun[]): void;
  /**
   * The page moved to another workspace without reloading (sessions/workspaceSwitch.ts). Runs of every workspace are
   * kept and keep streaming, but `get()` shows only the current one's, so two workspaces' chats can never meet by id.
   * `from` is the workspace being left: runs not yet stamped belong to it.
   */
  setWorkspace(key: string, from?: string): void;
  /**
   * Which workspace each chat id lives in (`workspaceKeyOf` keys), read from the sessions catalog at the moment of a
   * switch. A page that reloaded into B follows A's live turns too (`followLiveTurns`: every chat of every workspace),
   * so runs of several workspaces sit unstamped together; the first switch stamps each with ITS workspace, not all of
   * them with the one being left.
   */
  setChatOwners(owners: ReadonlyMap<string, string>): void;
  /** Every workspace's runs, not only the one shown, with the key of the shown one (null until a switch). For the sidebar's per-workspace marks. */
  everyRun(): { runs: readonly AgentRun[]; shown: string | null };
  /** Take the chat picks now in storage (restored from the server after a port change) under the ones already on the page. */
  adoptSavedPicks(): void;
  /**
   * Follow a chat turn the server is running that this page did not start
   * (reloaded mid-turn, or another workspace opened): its run becomes live and
   * streams again (GET /api/acp/attach). A turn this page is already streaming
   * or following is left alone.
   */
  follow(turn: LiveTurn, f?: Fetch): void;
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

export function createAgentRunStore(opts: { clock?: () => number; fetch?: Fetch; picks?: Pick<Storage, 'getItem' | 'setItem'> | null } = {}): AgentRunStore {
  const clock = opts.clock ?? (() => Date.now());
  let state: AgentRunsState = { runs: [], dismissed: new Set(), ...(opts.picks ? stateFromSaved(readSavedPicks(opts.picks)) : {}) };
  /* The agent and model each chat picked are kept in the browser, so a pick no turn has carried yet survives a reload. */
  const savePicks = (): void => {
    if (opts.picks) writeSavedPicks(opts.picks, state);
  };
  /* The workspace the page is in, once it has switched in place; null until then (every run is visible). */
  let wsKey: string | null = null;
  let owners: ReadonlyMap<string, string> = new Map();
  /* A run of the workspace being shown. Every write that looks runs up by chat id goes through this, so a chat id that
     two workspaces share can never reach across. */
  const mineOf = (r: AgentRun): boolean => wsKey === null || r.ws === undefined || r.ws === wsKey;
  const listeners = new Set<() => void>();
  let host: ChatHost | null = null;
  let seq = 0;
  /** Chats the app offered a compaction for, by when: held until a later turn showed the window had room again. */
  const autoCompacted = new Map<string, number>();
  /** Chats with a run on its way (see `holdStart`): counted, not just flagged, so two holds do not release each other. */
  const pendingStarts = new Map<string, number>();
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
    /* The run pinned its node as a context chip; the run being over is the chip's end. */
    if (next.nodeId && state.runs[at].status === 'running' && next.status !== 'running') host?.unpinNode?.(next.nodeId);
    const runs = state.runs.slice();
    runs[at] = next;
    state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs.filter(mineOf)) };
    emit();
  };
  const find = (id: string): AgentRun | undefined => state.runs.find((r) => r.id === id);
  const stamp = (): { ws?: string } => (wsKey === null ? {} : { ws: wsKey });
  let everyView: { of: AgentRunsState; ws: string | null; out: { runs: readonly AgentRun[]; shown: string | null } } | null = null;
  let view: { of: AgentRunsState; ws: string; out: AgentRunsState } | null = null;
  const visible = (): AgentRunsState => {
    if (wsKey === null) return state;
    if (view && view.of === state && view.ws === wsKey) return view.out;
    const ws = wsKey;
    const out: AgentRunsState = { ...state, runs: state.runs.filter((r) => r.ws === undefined || r.ws === ws) };
    view = { of: state, ws, out };
    return out;
  };

  /** Whether the chat should be offered a compaction right now; marks the fill as tried when it says yes. */
  const decideAutoCompact = (sessionId: string | null): StartRunOptions | null => {
    if (!sessionId) return null;
    const mine = state.runs.filter((r) => mineOf(r) && r.sessionId === sessionId && !r.nodeId);
    if (mine.some((r) => r.status === 'running') || (pendingStarts.get(sessionId) ?? 0) > 0) return null;
    const last = mine.filter((r) => r.operation !== 'compact').sort((a, b) => a.startedAt - b.startedAt).at(-1);
    const u = last?.usage;
    if (!last || last.status !== 'done' || !u || !(u.size > 0) || !(u.used > 0)) return null;
    const fraction = u.used / u.size;
    const held = autoCompacted.get(sessionId);
    if (held !== undefined) {
      /* Tried for this fill: only a later turn that showed room (under the warn line) clears it, so a compaction that did not help is not repeated. */
      if (last.startedAt > held && fraction < AUTO_COMPACT_WARN_AT) autoCompacted.delete(sessionId);
      else return null;
    }
    if (fraction < AUTO_COMPACT_FULL_AT) return null;
    autoCompacted.set(sessionId, clock());
    return {
      agentRef: last.agentRef ?? undefined,
      sessionId,
      compact: true,
      question: 'Compact the conversation',
      auto: { percent: Math.min(100, Math.round(fraction * 100)) },
      ...(last.access ? { access: last.access } : {}),
      ...(last.intent ? { intent: last.intent } : {}),
    };
  };
  const store: AgentRunStore = {
    get: () => visible(),
    everyRun: () => (everyView && everyView.of === state && everyView.ws === wsKey ? everyView.out : (everyView = { of: state, ws: wsKey, out: { runs: state.runs, shown: wsKey } }).out),
    setChatOwners(next) {
      owners = next;
    },
    setWorkspace(rawKey, rawFrom) {
      /* One spelling on every path, whoever calls: the same folder given two ways is one workspace. */
      const key = normalizeWorkspacePath(rawKey);
      const from = rawFrom === undefined ? undefined : normalizeWorkspacePath(rawFrom);
      if (from !== undefined && wsKey === null) state = { ...state, runs: state.runs.map((r) => (r.ws === undefined ? { ...r, ws: (r.sessionId ? owners.get(r.sessionId) : undefined) ?? from } : r)) };
      if (wsKey === key) return;
      wsKey = key;
      state = { ...state, tokensBySession: tokenTotalsForState(state, state.runs.filter(mineOf)) };
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    chatAgent() {
      const sid = host?.sessionId() ?? null;
      return sid ? (state.agents?.[sid] || null) : null;
    },
    pinNode(nodeId) {
      return host?.pinNode ? host.pinNode(nodeId) : null;
    },
    setHost(next) {
      host = next;
    },
    patch(fn) {
      const prev = state;
      state = fn(prev);
      if (state.agents !== prev.agents || state.chatConfig !== prev.chatConfig) savePicks();
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
    autoCompact(sessionId) {
      const first = decideAutoCompact(sessionId);
      if (!first || !sessionId) return null;
      /* One macrotask later, decide again from what the chat looks like then: a follow-up the chat sends the moment this
         turn settles (the composer's queue drains from an effect) lands after the offer was decided. If one did, it has
         the chat; if it ran and showed room, nothing is compacted. */
      return new Promise<AgentRun>((resolve, reject) => {
        setTimeout(() => {
          autoCompacted.delete(sessionId);
          const busy = state.runs.find((r) => mineOf(r) && r.sessionId === sessionId && !r.nodeId && r.status === 'running');
          const again = decideAutoCompact(sessionId);
          if (!again) {
            if (busy) resolve(busy);
            else reject(new Error('compaction no longer needed'));
            return;
          }
          store.start(again).then(resolve, reject);
        }, 0);
      });
    },
    holdStart(sessionId) {
      if (!sessionId) return () => {};
      pendingStarts.set(sessionId, (pendingStarts.get(sessionId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (pendingStarts.get(sessionId) ?? 1) - 1;
        if (n <= 0) pendingStarts.delete(sessionId);
        else pendingStarts.set(sessionId, n);
      };
    },
    async start(o, f = defaultFetch) {
      const id = `run-${++seq}-${clock().toString(36)}`;
      const label = o.nodeId && host?.pinNode ? host.pinNode(o.nodeId) : null;
      const sessionId = o.sessionId !== undefined ? o.sessionId : (host?.sessionId() ?? null);
      /* ONE COMPACTION AT A TIME: a second ask (the menu, the button, the auto offer) while one runs, or while a turn of the chat runs, starts nothing. */
      if (o.compact && sessionId) {
        const busy = state.runs.find((r) => mineOf(r) && r.sessionId === sessionId && !r.nodeId && r.status === 'running');
        if (busy) return busy;
      }
      /* A run the chat did not name an agent for (a board node's menu) goes to the agent THIS chat is set to, never to the
         first one registered: the composer would switch to it without a word. */
      const agentRef = o.agentRef ?? (sessionId ? (state.agents?.[sessionId] || undefined) : undefined);
      if (agentRef && !o.agentRef) o = { ...o, agentRef };
      const run: AgentRun = {
        id,
        sessionId,
        agentRef: agentRef ?? null,
        nodeId: o.nodeId ?? null,
        nodeLabel: o.nodeLabel ?? label ?? null,
        prompt: o.question ?? DEFAULT_NODE_QUESTION,
        ...(o.refs?.length ? { refs: o.refs } : {}),
        operation: o.compact ? 'compact' : 'prompt',
        status: 'running',
        startedAt: clock(),
        endedAt: null,
        items: o.auto ? [{ kind: 'note', id: 'note0', text: `The context window was ${o.auto.percent}% full, so the conversation was compacted.` }] : [],
        approvals: [],
        error: null,
        lastEventAt: clock(), stalled: null, waiting: null,
        ...stamp(),
      };
      /* An earlier run of this chat that answered may still hold its stream (the bridge keeps the prompt open): a new send ends it. */
      if (run.sessionId && !run.nodeId) {
        for (const r of state.runs) if (mineOf(r) && r.sessionId === run.sessionId && !r.nodeId && r.status === 'done' && r.answered) void import('./agentRunner').then((m) => m.stopRun(r.id)).catch((err) => console.warn('stop failed', err));
      }
      /* S2b: the chat talks to this agent from now on (the runner names it when it had to look one up). */
      const sid = run.sessionId;
      state = { ...state, runs: [...state.runs, run], ...(o.agentRef && sid ? { agents: { ...state.agents, [sid]: o.agentRef } } : {}) };
      emit();
      const { streamRun } = await import('./agentRunner');
      const done = await streamRun({ store, update, find, defaultFetch }, run, o, f);
      /* A compaction that failed changed nothing: the chat is whole, and the line says so rather than leaving a bare error. */
      if (o.compact && done.status === 'failed' && !done.stopped && done.error && !/conversation is unchanged/i.test(done.error)) {
        update(id, (r) => ({ ...r, error: `Compaction failed: ${(r.error ?? done.error ?? '').replace(/[.\s]+$/, '')}. The conversation is unchanged.` }));
      }
      return find(id) ?? done;
    },
    markRetried(runId) {
      update(runId, (r) => (r.retried ? r : { ...r, retried: true }));
    },
    addSteer(runId, text) {
      const words = text.trim();
      if (words === '') return;
      update(runId, (r) => ({ ...r, items: [...r.items, { kind: 'steer', id: `steer${r.items.length}`, text: words, at: clock() }] }));
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
    adoptSavedPicks() {
      if (!opts.picks) return;
      const saved = stateFromSaved(readSavedPicks(opts.picks));
      state = { ...state, agents: { ...saved.agents, ...state.agents }, chatConfig: { ...saved.chatConfig, ...state.chatConfig } };
      emit();
    },
    hydrate(sessionId, saved) {
      const have = new Set(state.runs.map((r) => r.id));
      /* A turn this page is streaming is not drawn a second time from its saved record. */
      const live = new Set(state.runs.map((r) => r.turnId).filter(Boolean));
      const runs = saved.filter((r) => !have.has(r.id) && !(r.turnId && live.has(r.turnId))).map((r) => ({ ...r, sessionId, restored: true, ...stamp() }));
      if (runs.length === 0) return;
      const last = runs[runs.length - 1]!;
      /* A chat the reader put on a built-in model has an EMPTY agent: that is a choice, and the last run's agent is history. */
      const agents = last.agentRef && state.agents?.[sessionId] === undefined ? { agents: { ...state.agents, [sessionId]: last.agentRef } } : {};
      /* Saved history goes ahead of the runs already live in this chat. */
      state = { ...state, runs: [...runs, ...state.runs], ...agents };
      savePicks();
      emit();
      /* A turn still running on the server (the page reloaded mid-turn): follow it live. */
      for (const r of runs) {
        if (r.status === 'running' && r.turnId) store.follow({ turnId: r.turnId, chatId: sessionId, agentRef: r.agentRef ?? '', prompt: r.prompt, startedAt: r.startedAt });
      }
    },
    follow(turn, f = defaultFetch) {
      const id = `saved-${turn.turnId}`;
      const mine = state.runs.find((r) => r.turnId === turn.turnId && r.id !== id);
      if (mine) return; /* this page started it and streams it */
      const at = state.runs.findIndex((r) => r.id === id);
      if (at !== -1 && !state.runs[at]!.restored) return; /* followed already */
      const run: AgentRun = {
        id,
        turnId: turn.turnId,
        sessionId: turn.chatId,
        agentRef: turn.agentRef || null,
        nodeId: null,
        nodeLabel: null,
        prompt: turn.prompt,
        status: 'running',
        startedAt: turn.startedAt,
        endedAt: null,
        /* The attach replays the turn from its start, so the run is folded again from nothing. */
        items: [],
        approvals: [],
        error: null,
        lastEventAt: clock(),
        stalled: null,
        waiting: null,
        /* A live turn of ANOTHER workspace (the server runs them all) belongs to that workspace, not to the one shown. */
        ...(wsKey === null ? {} : { ws: (turn.chatId ? owners.get(turn.chatId) : undefined) ?? wsKey }),
      };
      const runs = state.runs.slice();
      if (at === -1) runs.push(run);
      else runs[at] = run;
      const sid = turn.chatId;
      state = { ...state, runs, ...(turn.agentRef && sid && state.agents?.[sid] === undefined ? { agents: { ...state.agents, [sid]: turn.agentRef } } : {}) };
      emit();
      void import('./agentRunner').then((m) => m.followTurn({ store, update, find, defaultFetch }, id, turn.turnId, f)).catch((err) => console.warn('follow failed', err));
    },
    truncateFrom(runId) {
      const at = state.runs.find((r) => r.id === runId && mineOf(r));
      if (!at || !at.sessionId || at.status === 'running') return null;
      const mine = state.runs.filter((r) => mineOf(r) && r.sessionId === at.sessionId);
      const index = mine.findIndex((r) => r.id === runId);
      if (mine.slice(index).some((r) => r.status === 'running')) return null;
      const gone = new Set(mine.slice(index).map((r) => r.id));
      const runs = state.runs.filter((r) => !gone.has(r.id));
      state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs.filter(mineOf)) };
      emit();
      return { sessionId: at.sessionId, keep: index, removed: mine.slice(index) };
    },
    restore(back) {
      const first = back[0];
      if (!first?.sessionId) return;
      const have = new Set(state.runs.map((r) => r.id));
      const add = back.filter((r) => !have.has(r.id));
      if (add.length === 0) return;
      const at = state.runs.reduce((n, r, i) => (mineOf(r) && r.sessionId === first.sessionId ? i : n), -1);
      const runs = at < 0 ? [...state.runs, ...add] : [...state.runs.slice(0, at + 1), ...add, ...state.runs.slice(at + 1)];
      state = { ...state, runs, tokensBySession: tokenTotalsForState(state, runs.filter(mineOf)) };
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
export const agentRuns: AgentRunStore = createAgentRunStore({ picks: typeof localStorage === 'undefined' ? null : prefStorage });

/** A chat turn the server is running now (GET /api/acp/live). */
export interface LiveTurn {
  turnId: string;
  chatId: string | null;
  agentRef: string;
  prompt: string;
  startedAt: number;
}

/**
 * After a reload (or opening another workspace, which reloads): follow every
 * chat turn the server is still running, in every chat and workspace, so a
 * background chat keeps streaming and its row keeps saying so. Quiet when the
 * server cannot say (an older server, no ACP).
 */
export async function followLiveTurns(store: AgentRunStore = agentRuns, f: Fetch = (u, i) => fetch(u, i)): Promise<number> {
  try {
    const r = await f('/api/acp/live');
    if (!r.ok) return 0;
    const turns = (((await r.json()) as { turns?: LiveTurn[] }).turns ?? []).filter((t) => t && typeof t.turnId === 'string' && t.turnId);
    for (const t of turns) store.follow(t, f);
    return turns.length;
  } catch {
    return 0;
  }
}

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
