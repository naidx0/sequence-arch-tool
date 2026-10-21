/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT A TURN CARRIES, BUILT ON THE SERVER (item 019-10, audit P1-3)
   packages/analyzer/src/server/askHistory.ts

   THE DEFECT. Context silently forgot after 20 turns: the client sent its last
   20 turns as `body.history`, the server sliced to 20 again, and anything
   older was gone with only an "omitted" header to show for it. Two windows on
   one chat could send different histories, because each sent what IT held.

   WHAT THIS DOES INSTEAD.

   1. SOURCE. When the request names its thread and that thread has a stored
      transcript (`.sequence/sessions/<id>/chat.json`), the history is built
      from the STORED turns and `body.history` is ignored. Two windows on one
      chat therefore send byte-identical history. `body.history` is used only
      for a thread with no stored transcript (a fresh chat that has not been
      saved yet, a client with no thread id, the test harnesses): there is
      nothing to be inconsistent with. The trade is a lagging save: a turn the
      client has not flushed yet is not in the stored transcript, so it is
      absent from the next prompt. The client saves when a turn settles, well
      before a person types the next question, and agreement between windows
      was the requirement.

      The thread id counts only when the REQUEST named it. `resolveAskThreadId`
      also falls back to the workspace's active session, which is a guess
      (askSession.ts says so) and would let a stale guess replace a history the
      client holds correctly.

   2. BUDGET. Turns are kept newest first until the history budget is spent,
      and the budget is a share of the model's real window (a local model's
      probed `num_ctx`, a hosted model's published window from
      `llm/modelWindows.ts`), sized with the script-aware `estimateTokens`.
      There is no fixed turn count.

   3. SUMMARY. What does not fit is not dropped: it is condensed into a rolling
      summary by the model the app already uses for small tasks (the chat's own
      model, reasoning off, exactly as `nameThreadFromPrompt` does), through
      `llm/compaction.ts`. The summary is cached on disk next to the chat,
      keyed by the hash of the turns it covers, so it is computed once and
      every window and every later turn reuses it. When no model is available,
      or the call fails, a deterministic extractive summary is used. The
      boundary moves in steps of {@link DROP_STEP} turns, so a summary is made
      once per few turns rather than on every turn.

   PURE EXCEPT the cache file. The summarizer is injected.
   ══════════════════════════════════════════════════════════════════════════ */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ASK_HISTORY_ASSISTANT_CHARS,
  ASK_HISTORY_WINDOW_SHARE,
  LOCAL_DEFAULT_CONTEXT_WINDOW,
  parseAskHistoryTurns,
  renderAskHistorySection,
} from '../explain/explain.js';
import { approxTokens, cutTextToBudget, estimateTokens } from '../llm/tokenBudget.js';
import { hostedContextWindow, UNKNOWN_HOSTED_WINDOW } from '../llm/modelWindows.js';
import { compactSessionTurns, hashTurn, type SessionTurn, type TurnSummarizer } from '../llm/compaction.js';
import { readSessionChat, type ChatMemoryShape } from './sessionsStore.js';

/** The share of the window prior chat may take, hosted or local (same share the local path always used). */
export const HISTORY_WINDOW_SHARE = ASK_HISTORY_WINDOW_SHARE;
/** A very large window (1M) is not a reason to resend 250k tokens of chat on every turn. */
export const HISTORY_TOKEN_CAP = 64_000;
/**
 * The boundary between summarized and verbatim turns moves in steps of this many messages (a message is one
 * user or assistant turn, so two per exchange). 12 messages is 6 exchanges: the boundary, and with it the
 * summary, changes at most once per {@link SUMMARY_REFRESH_TURNS} exchanges. Measured on a real chat, the old
 * step of 6 messages (3 exchanges), plus chunked summary calls, made a summary call on nearly every turn, one
 * extra provider round trip each. The cost of a wider step is that up to a step's worth of the oldest
 * verbatim turns ride in the summary a little earlier than the budget strictly requires.
 */
export const DROP_STEP = 12;
/** Exchanges (a question and its answer) between two summary refreshes: {@link DROP_STEP} messages. */
export const SUMMARY_REFRESH_TURNS = DROP_STEP / 2;
/** The summary is cut to this many characters, whoever wrote it. */
export const SUMMARY_MAX_CHARS = 8_000;
/** A summary call that has not answered by now is abandoned for the extractive one. */
export const HISTORY_SUMMARY_TIMEOUT_MS = 25_000;
/** At most this much transcript is handed to the summarizer in one call, in tokens. */
const SUMMARY_INPUT_TOKENS = 24_000;
const SUMMARY_OUTPUT_TOKENS = 1_500;
/** Each turn is clipped to this many characters in the summarizer's input. */
const SUMMARY_TURN_CHARS = 3_000;

export type HistoryTurn = ReturnType<typeof parseAskHistoryTurns>[number];

/** Asks a model to answer one prompt with plain text; null when no model is available. */
export type HistorySummarizer = (prompt: string, signal?: AbortSignal) => Promise<string | null>;

export interface BuiltAskHistory {
  /** The PRIOR CHAT section lines, summary included. Empty when there is no history. */
  lines: string[];
  /** Turns carried verbatim. */
  keptTurns: number;
  /** Earlier turns carried as a summary. */
  summarizedTurns: number;
  /** Where the turns came from. */
  source: 'stored' | 'request' | 'merged' | 'none';
  /** How the summary was made; 'none' when nothing was summarized. */
  summaryKind: 'none' | 'model' | 'cache' | 'extractive';
}

export interface BuildAskHistoryInput {
  /** The repo (or workspace) root the sessions live under, or null. */
  sessionsRoot: string | null;
  /** The thread the request NAMED (never the active-session guess), or undefined. */
  threadId: string | undefined;
  /** `body.history` as sent: used when the thread has no stored transcript, or when it strictly extends the stored one (see reconcileStored). */
  requestHistory: unknown;
  /** `body.historyDropped`: how many turns the client already cut (request fallback only). */
  requestDropped: number;
  /** The question being asked now; a trailing stored copy of it is not history. */
  question: string;
  /** A local model's window (null = the Ollama default), or undefined for a hosted model. */
  contextWindow: number | null | undefined;
  /** The hosted model id, to look its window up. */
  model: string;
  summarize?: HistorySummarizer;
  signal?: AbortSignal;
}

/* ── the source ───────────────────────────────────────────────────────── */

const WORK_CAP = 12;

/** A stored turn's `work` rows (opaque on disk) as the compact verb strings the wire carries. */
function workStrings(work: unknown): string[] {
  if (!Array.isArray(work)) return [];
  const out: string[] = [];
  for (const row of work) {
    if (typeof row === 'string') {
      if (row.trim()) out.push(row);
    } else if (row && typeof row === 'object') {
      const r = row as { verb?: unknown; identifier?: unknown; status?: unknown };
      if (r.status === 'running' || typeof r.verb !== 'string' || !r.verb.trim()) continue;
      const id = typeof r.identifier === 'string' ? r.identifier.trim() : '';
      out.push(id ? `${r.verb.trim()} (${id})` : r.verb.trim());
    }
    if (out.length >= WORK_CAP) break;
  }
  return out;
}

function evidenceOf(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as { filesRead?: unknown; tools?: unknown; proposals?: unknown };
  const strings = (v: unknown, pick: (x: unknown) => unknown): string[] =>
    Array.isArray(v) ? v.map(pick).filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];
  return {
    filesRead: strings(e.filesRead, (x) => x),
    tools: strings(e.tools, (x) => (x && typeof x === 'object' ? (x as { name?: unknown }).name : x)),
    proposals: strings(e.proposals, (x) => x),
  };
}

/** The stored transcript as history turns, minus a trailing copy of the question being asked now. */
export function storedHistoryTurns(chat: Pick<ChatMemoryShape, 'turns'>, question: string): HistoryTurn[] {
  const wire: unknown[] = [];
  for (const t of chat.turns) {
    if ((t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string' || t.text.trim() === '') continue;
    wire.push({
      role: t.role,
      text: t.text,
      ...(t.role === 'assistant' && t.agentTurn ? { agent: t.agentTurn.agentRef } : {}),
      ...(t.role === 'assistant' ? { work: workStrings(t.work), evidence: evidenceOf(t.evidence) } : {}),
    });
  }
  const turns = parseAskHistoryTurns(wire);
  const last = turns[turns.length - 1];
  if (last && last.role === 'user' && last.text.trim() === question.trim()) turns.pop();
  return turns;
}

/* ── the budget ───────────────────────────────────────────────────────── */

/** The tokens prior chat may take: a share of the window the model will actually run. */
export function historyBudgetTokens(contextWindow: number | null | undefined, model: string): number {
  const window =
    contextWindow !== undefined ? (contextWindow ?? LOCAL_DEFAULT_CONTEXT_WINDOW) : (hostedContextWindow(model) ?? UNKNOWN_HOSTED_WINDOW);
  return Math.max(256, Math.min(HISTORY_TOKEN_CAP, Math.floor(window * HISTORY_WINDOW_SHARE)));
}

/** What a turn costs once rendered: the user's words whole, an assistant reply cut as the renderer cuts it, plus its evidence lines. */
function turnTokens(t: HistoryTurn): number {
  const text = t.text.trim();
  if (t.role === 'user') return estimateTokens(`User: ${text}\n`);
  const body = text.length > ASK_HISTORY_ASSISTANT_CHARS ? text.slice(0, ASK_HISTORY_ASSISTANT_CHARS) : text;
  const ev = [...(t.work ?? []), ...(t.evidence?.filesRead ?? []), ...(t.evidence?.tools ?? []), ...(t.evidence?.proposals ?? [])].join(', ');
  return estimateTokens(`Assistant: ${body}\n${ev.slice(0, 600)}\n`);
}

/**
 * How many of the OLDEST turns go to the summary. Newest turns are kept until
 * the budget is spent, then the count is rounded up to a multiple of
 * {@link DROP_STEP} (never past leaving one turn), so the boundary, and with it
 * the summary, changes once per few turns instead of on every turn.
 */
export function droppedCount(costs: readonly number[], budgetTokens: number): number {
  const n = costs.length;
  let used = 0;
  let kept = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (kept > 0 && used + costs[i]! > budgetTokens) break;
    used += costs[i]!;
    kept += 1;
  }
  const needed = n - kept;
  if (needed <= 0) return 0;
  return Math.min(n - 1, Math.ceil(needed / DROP_STEP) * DROP_STEP);
}

/* ── the summary ──────────────────────────────────────────────────────── */

function digest(parts: string[]): string {
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex').slice(0, 24);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)} …`;
}

/**
 * A summary that needs no model: the person's first ask whole, then each other
 * user message and the opening sentence of each reply, clipped. The first ask
 * and the newest of the rest are kept when it must be cut. Deterministic.
 */
export function extractiveSummary(turns: readonly Pick<SessionTurn, 'role' | 'content'>[], maxChars = 4_000): string {
  if (turns.length === 0) return '';
  const first = turns.findIndex((t) => t.role === 'user');
  const head = first >= 0 ? `The person first asked: ${clip(turns[first]!.content, 600)}` : '';
  const rest: string[] = [];
  turns.forEach((t, i) => {
    if (i === first) return;
    if (t.role === 'user') rest.push(`The person said: ${clip(t.content, 240)}`);
    else {
      const s = /^[\s\S]{1,200}?(?:[.!?](?=\s)|\n|$)/.exec(t.content.trim());
      rest.push(`The assistant replied: ${clip(s ? s[0] : t.content, 200)}`);
    }
  });
  const budget = Math.max(0, maxChars - head.length - 1 - 48); /* room for the "not shown" line */
  const kept: string[] = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (used + rest[i]!.length + 1 > budget) break;
    kept.unshift(rest[i]!);
    used += rest[i]!.length + 1;
  }
  const cut = rest.length - kept.length;
  return [head, ...(cut > 0 ? [`(${cut} middle messages not shown)`] : []), ...kept].filter(Boolean).join('\n');
}

/** One short line per turn the model summary has not seen yet, newest last. */
function extractiveTail(turns: readonly Pick<SessionTurn, 'role' | 'content'>[]): string {
  return turns
    .map((t) => {
      if (t.role === 'user') return `The person said: ${clip(t.content, 160)}`;
      const s = /^[\s\S]{1,120}?(?:[.!?](?=\s)|\n|$)/.exec(t.content.trim());
      return `The assistant replied: ${clip(s ? s[0] : t.content, 120)}`;
    })
    .join(String.fromCharCode(10));
}

/** What one summarizer call may read and write, sized to the summarizing model's window. */
export interface SummaryLimits {
  inputTokens: number;
  outputTokens: number;
}

/**
 * The summarizer's budgets from the window of the model that will summarize: its prompt (instructions,
 * the summary so far, the turns to add) plus its reply must fit, with the estimate's error to spare.
 * A 4k local model reads about 2k tokens at a time; a 200k one is held to 24k.
 */
export function summaryLimits(contextWindow: number | null | undefined, model: string): SummaryLimits {
  const window = contextWindow !== undefined ? (contextWindow ?? LOCAL_DEFAULT_CONTEXT_WINDOW) : (hostedContextWindow(model) ?? UNKNOWN_HOSTED_WINDOW);
  const outputTokens = Math.min(SUMMARY_OUTPUT_TOKENS, Math.max(200, Math.floor(window * 0.15)));
  const inputTokens = Math.max(300, Math.min(SUMMARY_INPUT_TOKENS, Math.floor((window - outputTokens - 400) * 0.7)));
  return { inputTokens, outputTokens };
}

function perTurnChars(limits: SummaryLimits): number {
  return Math.max(400, Math.min(SUMMARY_TURN_CHARS, Math.floor((limits.inputTokens * 3.2) / 2)));
}

export function summaryPrompt(previous: string, turns: readonly Pick<SessionTurn, 'role' | 'content'>[], limits: SummaryLimits = { inputTokens: SUMMARY_INPUT_TOKENS, outputTokens: SUMMARY_OUTPUT_TOKENS }): string {
  const per = perTurnChars(limits);
  const NL = String.fromCharCode(10);
  const input = turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${clip(t.content, per)}`).join(NL + NL);
  const words = Math.max(60, Math.floor(limits.outputTokens * 0.6));
  return [
    'You are condensing the EARLIER part of a conversation so an assistant can carry on without re-reading it.',
    `Write a faithful summary in plain text, under ${words} words, no preamble and no markdown headings.`,
    'Keep every concrete fact the user stated exactly as stated: names, numbers, dates, decisions, preferences, constraints, file paths, identifiers, and anything still unresolved.',
    'Do not add anything that is not in the conversation.',
    ...(previous ? ['', 'SUMMARY SO FAR (fold it into the new summary, keeping its facts):', previous] : []),
    '',
    'CONVERSATION TO ADD:',
    input,
  ].join(NL);
}

/** Groups turns so each summarizer call (with the summary so far) stays inside the input budget. */
function chunkTurns(base: string, turns: readonly SessionTurn[], limits: SummaryLimits): SessionTurn[][] {
  const per = perTurnChars(limits);
  const chunks: SessionTurn[][] = [];
  let cur: SessionTurn[] = [];
  const baseCost = Math.min(limits.outputTokens, estimateTokens(base));
  let used = baseCost;
  for (const t of turns) {
    const cost = estimateTokens(clip(t.content, per)) + 6;
    if (cur.length > 0 && used + cost > limits.inputTokens) {
      chunks.push(cur);
      cur = [];
      used = baseCost;
    }
    cur.push(t);
    used += cost;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

interface SummaryEntry {
  count: number;
  summary: string;
  at: string;
}
interface SummaryFile {
  version: 1;
  entries: Record<string, SummaryEntry>;
}

const MAX_CACHED = 12;
const memory = new Map<string, SummaryEntry>();
const inflight = new Map<string, Promise<string | null>>();

export function cacheFile(root: string | null, threadId: string | undefined, leaf = 'history-summary.json'): string | null {
  return root && threadId ? path.join(root, '.sequence', 'sessions', threadId, leaf) : null;
}

function readCache(file: string | null): SummaryFile {
  if (!file) return { version: 1, entries: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SummaryFile;
    if (raw && raw.version === 1 && raw.entries && typeof raw.entries === 'object') return raw;
  } catch {
    /* absent or unreadable: a miss */
  }
  return { version: 1, entries: {} };
}

function writeCache(file: string | null, key: string, entry: SummaryEntry): void {
  memory.set(`${file ?? ''}#${key}`, entry);
  if (!file) return;
  try {
    const cur = readCache(file);
    cur.entries[key] = entry;
    const keys = Object.keys(cur.entries).sort((a, b) => cur.entries[b]!.count - cur.entries[a]!.count);
    for (const k of keys.slice(MAX_CACHED)) delete cur.entries[k];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cur), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    /* a cache that cannot be written is recomputed next time */
  }
}

function lookup(file: string | null, key: string): SummaryEntry | undefined {
  return memory.get(`${file ?? ''}#${key}`) ?? readCache(file).entries[key];
}

/** Test seam: forget the in-process caches (the disk cache is per session folder). */
export function resetHistorySummaryMemory(): void {
  memory.clear();
  inflight.clear();
}

export interface SummaryOutcome {
  summary: string;
  kind: 'model' | 'cache' | 'extractive';
  /**
   * Turns the cached `summary` does not cover yet, rolled in WITHOUT a model call (extractive lines).
   * Kept apart so a length cut trims the older model summary and never these newest lines.
   */
  tail?: string;
}

/**
 * The summary of the oldest `dropped.length` turns: from the cache when this
 * exact set was summarized before; otherwise by the model, folding in the
 * nearest cached shorter prefix (so the summary rolls forward instead of being
 * rebuilt from the start); otherwise extractive.
 */
async function summaryFor(
  dropped: readonly SessionTurn[],
  file: string | null,
  summarize: HistorySummarizer | undefined,
  signal: AbortSignal | undefined,
  limits: SummaryLimits,
): Promise<SummaryOutcome> {
  const hashes = dropped.map((t) => hashTurn(t));
  const keyOf = (n: number): string => digest(hashes.slice(0, n));
  const hit = lookup(file, keyOf(dropped.length));
  if (hit) return { summary: hit.summary, kind: 'cache' };
  const fallback = (): SummaryOutcome => ({ summary: extractiveSummary(dropped), kind: 'extractive' });
  if (!summarize) return fallback();

  let baseCount = 0;
  let base = '';
  /* The longest cached summary that covers a prefix of exactly these turns. */
  const known = new Map<string, SummaryEntry>(Object.entries(readCache(file).entries));
  for (const [k, e] of memory) if (k.startsWith(`${file ?? ''}#`)) known.set(k.slice(`${file ?? ''}#`.length), e);
  for (const [k, e] of known) {
    if (e.count < dropped.length && e.count > baseCount && k === keyOf(e.count)) {
      baseCount = e.count;
      base = e.summary;
    }
  }
  /*
   * ROLL FORWARD WITHOUT A MODEL CALL. A small window moves the boundary on nearly every turn (one exchange
   * is most of the budget), and a model call per move was one extra provider round trip per turn (28 calls
   * in 29 turns, measured). While the newest cached summary is less than DROP_STEP messages behind, it is
   * kept and the turns it does not cover are added as extractive lines; the model is called again only
   * once the gap reaches DROP_STEP, i.e. at most once per SUMMARY_REFRESH_TURNS exchanges.
   */
  if (baseCount > 0 && dropped.length - baseCount < DROP_STEP) {
    return { summary: base, kind: 'cache', tail: extractiveTail(dropped.slice(baseCount)) };
  }
  const key = `${file ?? ''}#${keyOf(dropped.length)}`;
  let pending = inflight.get(key);
  if (!pending) {
    const fresh = dropped.slice(baseCount);
    /* Folded in chunks that each fit the summarizing model's window, the summary so far riding along. */
    pending = (async (): Promise<string | null> => {
      let cur = base;
      for (const chunk of chunkTurns(base, fresh, limits)) {
        const raw = await summarize(summaryPrompt(cur, chunk, limits), signal);
        const text = raw?.trim() ?? '';
        if (text === '') return null;
        cur = text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)} …` : text;
      }
      return cur === '' ? null : cur;
    })()
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const text = await pending;
  if (text === null) return fallback();
  writeCache(file, keyOf(dropped.length), { count: dropped.length, summary: text, at: new Date().toISOString() });
  return { summary: text, kind: 'model' };
}

/* ── the whole thing ──────────────────────────────────────────────────── */

/**
 * The summary of the oldest `d` of `session`, through llm/compaction.ts: it calls the summarizer once,
 * bounds its input and output, and checks the summary plus the kept tail is smaller than what they replace.
 * Never throws: any failure is the extractive summary.
 */
export async function summarizeEarliest(
  session: readonly SessionTurn[],
  d: number,
  file: string | null,
  summarize: HistorySummarizer | undefined,
  signal?: AbortSignal,
  limits: SummaryLimits = summaryLimits(undefined, ''),
): Promise<SummaryOutcome> {
  let outcome: SummaryOutcome | undefined;
  const summarizer: TurnSummarizer = async ({ turns: eligible }) => {
    outcome = await summaryFor(eligible, file, summarize, signal, limits);
    return { summary: outcome.summary };
  };
  try {
    /* Compaction is told to fire (its threshold sits one below the transcript's size) because the
       budget decision is already made by the caller; its job here is the bounded summarizer call and
       the post-check that summary plus kept tail is smaller than what it replaces. */
    await compactSessionTurns({
      turns: [...session],
      recentTailCount: session.length - d,
      contextThresholdTokens: Math.max(1, approxTokens(session.map((t) => `${t.role}: ${t.content}`).join('\n')) - 1),
      budgets: { summaryOutputTokens: SUMMARY_OUTPUT_TOKENS, summaryInputTokens: 4_000_000 } /* chunking is ours: compaction must not cut the input */,
      summarizer,
    });
  } catch {
    /* ContextLimitError and friends: the outcome below stands. */
  }
  return outcome ?? { summary: extractiveSummary(session.slice(0, d)), kind: 'extractive' };
}

/**
 * Which turns go to the summary, with the summary counted INSIDE the budget: when anything is dropped,
 * the verbatim turns get the budget minus a reserve (a quarter of it, at most one full summary), and
 * the summary is cut to that reserve. Prior chat as a whole never exceeds the budget.
 */
export function planDrop(costs: readonly number[], budget: number): { d: number; verbatimBudget: number; summaryChars: number } {
  if (droppedCount(costs, budget) === 0) return { d: 0, verbatimBudget: budget, summaryChars: 0 };
  const reserve = Math.min(Math.floor(budget * 0.25), Math.floor(SUMMARY_MAX_CHARS * 0.3125));
  const verbatimBudget = Math.max(1, budget - reserve);
  return { d: droppedCount(costs, verbatimBudget), verbatimBudget, summaryChars: Math.max(300, Math.floor(reserve / 0.3125)) };
}

/** A summary cut to `maxChars`, marked when cut. */
export function capSummary(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 2))} …`;
}

const sameTurn = (a: HistoryTurn, b: HistoryTurn): boolean => a.role === b.role && a.text.trim() === b.text.trim();

/**
 * The client's history when it only EXTENDS what is stored, else null.
 *
 * Nothing on the server records a finished turn: the client saves it with a PUT that can land after the
 * queued follow-up is sent, so the stored transcript can be one exchange behind a request that is
 * complete. The request is the full transcript's tail (`dropped` turns precede it). If the stored turns
 * are a strict prefix of that (the turns they share equal, at least one shared, the request longer),
 * the request adds only what the save has not caught up on and is used. A request that disagrees with
 * the stored turns is a stale or other window: the stored copy wins, which is what keeps two windows
 * on one chat identical.
 */
export function reconcileStored(stored: readonly HistoryTurn[], request: readonly HistoryTurn[], dropped: number): HistoryTurn[] | null {
  const s = stored.length;
  if (s === 0 || dropped > s - 1 || dropped < 0) return null;
  const overlap = s - dropped;
  if (request.length <= overlap) return null;
  for (let i = 0; i < overlap; i++) if (!sameTurn(stored[dropped + i]!, request[i]!)) return null;
  return [...stored, ...request.slice(overlap)];
}

export async function buildAskHistory(input: BuildAskHistoryInput): Promise<BuiltAskHistory> {
  const none: BuiltAskHistory = { lines: [], keptTurns: 0, summarizedTurns: 0, source: 'none', summaryKind: 'none' };
  let turns: HistoryTurn[] = [];
  let source: BuiltAskHistory['source'] = 'none';
  let clientDropped = 0;
  if (input.sessionsRoot && input.threadId) {
    const stored = storedHistoryTurns(readSessionChat(input.sessionsRoot, input.threadId), input.question);
    if (stored.length > 0) {
      const req = parseAskHistoryTurns(input.requestHistory).filter((t) => t.text.trim() !== '');
      const merged = reconcileStored(stored, req, Math.max(0, Math.floor(input.requestDropped || 0)));
      turns = merged ?? stored;
      source = merged ? 'merged' : 'stored';
    }
  }
  if (source === 'none') {
    turns = parseAskHistoryTurns(input.requestHistory).filter((t) => t.text.trim() !== '');
    clientDropped = Math.max(0, Math.floor(input.requestDropped || 0));
    if (turns.length > 0) source = 'request';
  }
  if (turns.length === 0) return none;

  const budget = historyBudgetTokens(input.contextWindow, input.model);
  const plan = planDrop(turns.map(turnTokens), budget);
  const d = plan.d;
  const kept = turns.slice(d);
  const hostedChars = Math.floor(plan.verbatimBudget / 0.3125);
  /* The local renderer sizes itself to a share of the window it is told: tell it the verbatim share. */
  const renderWindow = input.contextWindow === undefined ? undefined : Math.floor((input.contextWindow ?? LOCAL_DEFAULT_CONTEXT_WINDOW) * (plan.verbatimBudget / budget));
  const rendered = renderAskHistorySection(kept, kept.length, {
    droppedTurns: d === 0 ? clientDropped : 0,
    ...(renderWindow !== undefined ? { contextWindow: renderWindow } : { userChars: hostedChars }),
  });

  let summaryLines: string[] = [];
  let summaryKind: BuiltAskHistory['summaryKind'] = 'none';
  if (d > 0) {
    const session: SessionTurn[] = turns.map((t, i) => ({ id: String(i), role: t.role as 'user' | 'assistant', content: t.text.trim() }));
    const outcome = await summarizeEarliest(session, d, cacheFile(input.sessionsRoot, input.threadId), input.summarize, input.signal, summaryLimits(input.contextWindow, input.model));
    summaryKind = outcome.kind;
    const tail = outcome.tail ? capSummary(outcome.tail, Math.max(150, Math.floor(plan.summaryChars / 2))) : '';
    const whole = tail ? `${capSummary(outcome.summary, Math.max(100, plan.summaryChars - tail.length - 1))}${String.fromCharCode(10)}${tail}` : capSummary(outcome.summary, plan.summaryChars);
    const body = whole.split(String.fromCharCode(10)).map((l) => `  ${l}`);
    summaryLines = [`--- EARLIER IN THIS CHAT: ${d} turn${d === 1 ? '' : 's'} summarized (details may be lost; the person's exact words were not kept) ---`, ...body];
  }
  const lines = [...rendered];
  if (summaryLines.length > 0) lines.splice(1, 0, ...summaryLines);
  return { lines, keptTurns: kept.length, summarizedTurns: d, source, summaryKind };
}

/** What the response says about the history it was given: the context ring's "N early turns summarized". */
export function historyMetaOf(h: BuiltAskHistory): { keptTurns: number; summarizedTurns: number } {
  return { keptTurns: h.keptTurns, summarizedTurns: h.summarizedTurns };
}
