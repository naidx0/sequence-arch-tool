/* ══════════════════════════════════════════════════════════════════════════
   RUN-NODE'S EVENT STREAM, AND THE APPROVALS IN IT
   packages/web2/src/agents/runNodeStream.ts

   `POST /api/acp/run-node?stream=1` answers with server-sent events, one JSON
   object per `data:` line (analyzer repoServer.ts):

     acp:update      { update }                  the agent's own session/update
     acp:permission  { title, toolKind, mode, decision, toolCallId,
                       requestId?, pending?, proposal?, answeredBy? }
     acp:question    { requestId, pending, questions?, answers?, answeredBy? }
                                                 the agent asks the person (codex
                                                 requestUserInput); answered with
                                                 POST /api/acp/question
     acp:result      { stopReason, text }        the turn's honest end
     acp:error       { error, refused? }

   With `interactivePermissions: true` a request the mode would refuse arrives
   as `acp:permission { pending: true, requestId, proposal }` and the turn
   WAITS until `POST /api/acp/permission { requestId, decision }` answers it
   (or the server's timeout does, or the stream closes). The settling event is
   `{ pending: false, decision, answeredBy: 'person' | 'timeout' | 'disconnect' }`.
   `proposal` is the edit approval card's own prop shape.

   Pure apart from `fetch`, so the parser and the fold are testable with a
   stubbed body.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AskLedgerResult } from '@sequence/schema';
import type { TokenUsage } from './agentTypes';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Round 9: one turn's diagnostic record, as the server keeps it (no message text). */
export interface TurnLogRecord {
  turnId?: string;
  outcome?: string;
  ms?: number;
  stopReason?: string;
  error?: string;
  tools?: number;
  approvals?: number;
  updates?: number;
  entries?: { t: number; ev: string; [k: string]: unknown }[];
}

export interface ApprovalProposalFile {
  path: string;
  diff: string | null;
  /** Codex's change kind (add / delete / update), when the server passed it. */
  kind?: string | null;
}

export interface ApprovalProposal {
  proposalId: string;
  title: string | null;
  rationale: string | null;
  files: ApprovalProposalFile[];
  /** S2b: the plan an agent asks to leave Plan mode with (Claude ExitPlanMode). */
  plan?: string;
}

export type ApprovalDecision = 'allow' | 'deny';
/**
 * What a person can answer: allow once, deny, or allow ALWAYS for the
 * command's prefix in this chat thread (the server keeps the rule; the agent
 * is told acceptForSession / allow_always). Settles as an `allow`.
 */
export type ApprovalAnswer = ApprovalDecision | 'always';
/** `rule`: an Always rule in this chat answered it, nobody was asked. */
export type AnsweredBy = 'person' | 'timeout' | 'disconnect' | 'rule';

/** One approval the agent asked for, as the cards draw it. */
export interface AgentApproval {
  requestId: string;
  title: string | null;
  /** ACP tool kind: `edit` for a file change, `execute` for a command. */
  toolKind: string | null;
  /** The tool call it is about, when the server named one. */
  toolCallId?: string | null;
  proposal: ApprovalProposal;
  /** Null while it waits for an answer. */
  decision: ApprovalDecision | null;
  answeredBy: AnsweredBy | null;
  /** The answer the person gave here, before the server confirmed it. */
  sending: ApprovalAnswer | null;
  /** The prefix Always would cover (`npm test`); absent when Always is not offered. */
  always?: string | null;
  /** The Always rule this answer made, or the rule that answered it (`answeredBy: 'rule'`). */
  rule?: string | null;
}

/** One option of an agent's question. */
export interface QuestionOption {
  label: string;
  description: string;
}

/** One question the agent asks (codex ToolRequestUserInputQuestion). */
export interface QuestionItem {
  id: string;
  header: string;
  question: string;
  /** The person may answer in their own words. */
  isOther: boolean;
  /** Typed hidden, never shown back. */
  isSecret: boolean;
  options: QuestionOption[];
}

/** Question id -> the answers given (an option's label, or the person's words). */
export type QuestionAnswers = Record<string, string[]>;

/** Who settled a question: the person (answered or cancelled), the timeout, the stream closing, or the turn ending. */
export type QuestionAnsweredBy = 'person' | 'cancel' | 'timeout' | 'disconnect' | 'ended';

/** One request from the agent, as the question card draws it. */
export interface AgentQuestion {
  requestId: string;
  toolCallId: string | null;
  questions: QuestionItem[];
  /** False while it waits. */
  settled: boolean;
  /** What went back to the agent; null for none. */
  answers: QuestionAnswers | null;
  answeredBy: QuestionAnsweredBy | null;
  /** Being answered here, before the server confirmed it. */
  sending: boolean;
}

export type RunNodeEvent =
  | { type: 'acp:transcript'; turnId: string }
  /** The server's id for this turn, sent first (what Edit from here cuts by). */
  | { type: 'acp:turn-id'; turnId: string }
  /** On a page that comes back to a long turn: the server no longer kept its oldest `dropped` events (turnChannels.ts). */
  | { type: 'acp:replay-truncated'; dropped?: number }
  | { type: 'acp:tokens'; tokens: import('./agentRuns').RunTokens }
  | ({ type: 'acp:waiting'; lastEventAt: number; stalled: boolean } & import('./agentRuns').RunWaiting)
  | { type: 'acp:update'; update: unknown }
  | {
      type: 'acp:permission';
      title?: string;
      toolKind?: string;
      decision: ApprovalDecision | null;
      /** The tool call the request is about (its `acp:update` carried the raw input). */
      toolCallId?: string;
      requestId?: string;
      pending?: boolean;
      proposal?: Partial<ApprovalProposal> & { files?: Partial<ApprovalProposalFile>[] };
      answeredBy?: AnsweredBy;
      /** Pending: the prefix Always would cover. Settled: the rule the answer made. */
      always?: string;
      /** Settled by a rule: which one. */
      rule?: string;
      /** Decided by the mode with a word for the chat (Plan declining an edit). */
      note?: string;
    }
  | {
      type: 'acp:question';
      requestId?: string;
      pending?: boolean;
      toolCallId?: string;
      questions?: unknown;
      answers?: QuestionAnswers | null;
      answeredBy?: QuestionAnsweredBy;
      /** Local, never on the wire: the person's answer is being sent (true) or came back refused (false). */
      sending?: boolean;
    }
  | { type: 'acp:result'; stopReason?: string; text?: string; operation?: 'prompt' | 'compact'; askLedger?: AskLedgerResult }
  | { type: 'acp:error'; error?: string; recovery?: { kind?: string; provider?: string; resetsAt?: number; cause?: string } }
  /**
   * S1: ended (the agent's stop reason), settled (the server is done), hung (no progress for `idleMs`).
   * Round 9: queued (another turn holds this chat's agent), answered (the agent has said its
   * piece while its bridge still holds the turn; `text` is the answer so far).
   */
  | { type: 'acp:turn'; state?: string; stopReason?: string; idleMs?: number; text?: string; askLedger?: AskLedgerResult }
  /** Round 9: what the turn is doing now and for how long, sent every few seconds (acp turnStatus.ts). */
  | { type: 'acp:status'; phase?: string; forMs?: number; quietMs?: number; elapsedMs?: number; openTools?: number; tool?: { kind?: string | null; title?: string | null } }
  /** Round 9: the chat was named from this exchange. */
  | { type: 'acp:title'; title?: string; error?: string }
  /** Round 9: the turn's diagnostic record (no words), once, at its end. */
  | { type: 'acp:log'; log?: TurnLogRecord }
  /** S1: the agent rejoined this chat's thread, or opened a new one (`reason` says why). */
  | { type: 'acp:session'; resumed?: boolean; threadId?: string; reason?: string; rewound?: 'rolled-back' | 'reseeded' }
  /** The prompt going out carries the chat: 'full' to an agent new to it, 'delta' to one catching up on what it missed. */
  | { type: 'acp:handoff'; agentRef?: string; chars?: number; kind?: 'full' | 'delta' }
  /** Round 7: the model the turn runs on, as the agent stated it. */
  | { type: 'acp:model'; model?: string }
  /** Round 9 (ask 30): the tokens the agent reported for this turn, as they change and at its end. */
  | { type: 'acp:usage'; usage?: Partial<TokenUsage> | null };

/** Split SSE text into events. Returns the events and the unparsed remainder. */
export function parseSse(buffer: string): { events: RunNodeEvent[]; rest: string } {
  const events: RunNodeEvent[] = [];
  const text = buffer.replace(/\r\n/g, '\n');
  let start = 0;
  for (;;) {
    const cut = text.indexOf('\n\n', start);
    if (cut === -1) break;
    for (const line of text.slice(start, cut).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(line.slice(6)) as RunNodeEvent;
        if (e && typeof e === 'object' && typeof (e as { type?: unknown }).type === 'string') events.push(e);
      } catch {
        /* a malformed frame is skipped, never fatal to the run */
      }
    }
    start = cut + 2;
  }
  return { events, rest: text.slice(start) };
}

function proposalOf(e: Extract<RunNodeEvent, { type: 'acp:permission' }>, requestId: string): ApprovalProposal {
  const p = e.proposal ?? {};
  return {
    proposalId: typeof p.proposalId === 'string' ? p.proposalId : requestId,
    title: typeof p.title === 'string' ? p.title : e.title ?? null,
    rationale: typeof p.rationale === 'string' ? p.rationale : null,
    ...(typeof p.plan === 'string' ? { plan: p.plan } : {}),
    files: (p.files ?? [])
      .filter((f): f is ApprovalProposalFile => typeof f?.path === 'string')
      .map((f) => ({
        path: f.path,
        diff: typeof f.diff === 'string' ? f.diff : null,
        ...(typeof f.kind === 'string' ? { kind: f.kind } : {}),
      })),
  };
}

/**
 * Fold one event into the approvals list. Only interactive requests (those
 * with a `requestId`) become cards; a request the mode answered on its own is
 * not a question anybody was asked.
 */
export function foldApproval(list: AgentApproval[], e: RunNodeEvent): AgentApproval[] {
  if (e.type !== 'acp:permission' || typeof e.requestId !== 'string') return list;
  const requestId = e.requestId;
  const at = list.findIndex((a) => a.requestId === requestId);
  const fresh = (): AgentApproval => ({
    requestId,
    title: e.title ?? null,
    toolKind: e.toolKind ?? null,
    ...(typeof e.toolCallId === 'string' ? { toolCallId: e.toolCallId } : {}),
    proposal: proposalOf(e, requestId),
    decision: null,
    answeredBy: null,
    sending: null,
    ...(typeof e.always === 'string' ? { always: e.always } : {}),
  });
  if (e.pending === true) {
    if (at !== -1) return list;
    return [...list, fresh()];
  }
  /* Answered by a rule: nobody was asked, but the record says what ran and why. */
  if (at === -1 && e.answeredBy === 'rule') {
    return [...list, { ...fresh(), decision: 'allow', answeredBy: 'rule', rule: typeof e.rule === 'string' ? e.rule : null }];
  }
  if (at === -1) return list;
  const next = list.slice();
  next[at] = {
    ...next[at],
    decision: e.decision === 'allow' || e.decision === 'deny' ? e.decision : 'deny',
    answeredBy: e.answeredBy ?? 'person',
    sending: null,
    ...(typeof e.always === 'string' ? { rule: e.always } : {}),
  };
  return next;
}

function questionsOf(raw: unknown): QuestionItem[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof (q as { id?: unknown }).id === 'string')
    .map((q) => ({
      id: q.id as string,
      header: str(q.header),
      question: str(q.question),
      isOther: q.isOther === true,
      isSecret: q.isSecret === true,
      options: Array.isArray(q.options)
        ? (q.options as Record<string, unknown>[]).filter((o) => typeof o?.label === 'string').map((o) => ({ label: o.label as string, description: str(o.description) }))
        : [],
    }));
}

/** Fold one `acp:question` event into a run's questions. */
export function foldQuestion(list: AgentQuestion[], e: RunNodeEvent): AgentQuestion[] {
  if (e.type !== 'acp:question' || typeof e.requestId !== 'string') return list;
  const at = list.findIndex((q) => q.requestId === e.requestId);
  if (e.pending === true) {
    if (at !== -1) return list;
    return [
      ...list,
      { requestId: e.requestId, toolCallId: typeof e.toolCallId === 'string' ? e.toolCallId : null, questions: questionsOf(e.questions), settled: false, answers: null, answeredBy: null, sending: false },
    ];
  }
  if (at === -1) return list;
  const was = list[at]!;
  const next = list.slice();
  if (typeof e.sending === 'boolean' && e.pending === undefined) {
    if (was.settled || was.sending === e.sending) return list;
    next[at] = { ...was, sending: e.sending };
    return next;
  }
  if (e.pending !== false) return list;
  next[at] = { ...was, settled: true, sending: false, answers: e.answers ?? null, answeredBy: e.answeredBy ?? 'person' };
  return next;
}

/** Answer one question (`answers`), or cancel it (null). False when the server no longer holds it. */
export async function answerQuestion(requestId: string, answers: QuestionAnswers | null, f: Fetch = fetch): Promise<boolean> {
  try {
    const r = await f('/api/acp/question', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answers ? { requestId, answers } : { requestId, cancel: true }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Mark an approval as being answered here (the card shows it until the server confirms). */
export function markSending(list: AgentApproval[], requestId: string, decision: ApprovalAnswer): AgentApproval[] {
  return list.map((a) => (a.requestId === requestId && a.decision === null ? { ...a, sending: decision } : a));
}

/** Answer one pending approval. False when the server no longer holds it (404) or refused. */
export async function answerApproval(requestId: string, decision: ApprovalAnswer, f: Fetch = fetch): Promise<boolean> {
  try {
    const r = await f('/api/acp/permission', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, decision }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export interface RunNodeOutcome {
  ok: boolean;
  text: string;
  stopReason?: string;
}

/**
 * Run one streamed, interactive run-node turn. `onEvent` sees every event as it
 * arrives (that is where approvals appear). Resolves with the turn's result or
 * its error; a non-streamed error response (400/403/409) is read as JSON.
 */
export async function streamRunNode(
  body: Record<string, unknown>,
  opts: { onEvent?: (e: RunNodeEvent) => void; signal?: AbortSignal } = {},
  f: Fetch = fetch,
): Promise<RunNodeOutcome> {
  const r = await f('/api/acp/run-node?stream=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ ...body, interactivePermissions: true }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, text: j.error ?? `the agent run failed (${r.status})` };
  }
  let outcome: RunNodeOutcome = { ok: false, text: 'the agent run ended without a result' };
  const take = (e: RunNodeEvent): void => {
    opts.onEvent?.(e);
    if (e.type === 'acp:result') outcome = { ok: true, text: e.text ?? '', stopReason: e.stopReason };
    if (e.type === 'acp:error') outcome = { ok: false, text: e.error ?? 'the agent run failed' };
  };
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buf);
    buf = rest;
    for (const e of events) take(e);
  }
  for (const e of parseSse(buf + '\n\n').events) take(e);
  return outcome;
}
