/* ══════════════════════════════════════════════════════════════════════════
   THE FOLD: ONE STREAM EVENT INTO ONE RUN RECORD
   packages/web2/src/agents/agentRunFold.ts

   Pure. Split out of agentRuns.ts so the run store the page boots with
   carries none of it: the fold, codex's change parsing and the stream reader
   load with the first run (agentRunner.ts), not at boot.
   ══════════════════════════════════════════════════════════════════════════ */

import { cappedOf } from '../chat/cappedBody';
import { codexChangesOf, type CodexChange } from '../chat/codexChanges';
import { parseRunTokens, registerFold, type AgentRun, type RunItem, type RunLimits, type RunPlan, type RunRecovery, type RunThought, type RunTool, type ToolStatus } from './agentRuns';
import { foldApproval, foldQuestion, type AgentApproval, type AgentQuestion, type RunNodeEvent } from './runNodeStream';

interface AcpUpdate {
  sessionUpdate?: string;
  content?: unknown;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  entries?: unknown;
}

function updateOf(e: Extract<RunNodeEvent, { type: 'acp:update' }>): AcpUpdate | null {
  const n = e.update as { update?: unknown } | null;
  if (!n || typeof n !== 'object') return null;
  /* The server sends the ACP notification whole ({ sessionId, update }); a bare update is read too. */
  const u = (n.update && typeof n.update === 'object' ? n.update : n) as AcpUpdate;
  return typeof u.sessionUpdate === 'string' ? u : null;
}

function textOf(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const c = content as { type?: unknown; text?: unknown };
  return c.type === 'text' && typeof c.text === 'string' ? c.text : '';
}

function toolStatus(s: unknown, was: ToolStatus): ToolStatus {
  if (s === 'completed') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'in_progress' || s === 'pending') return 'running';
  return was;
}

function diffsOf(content: unknown): RunTool['diffs'] {
  if (!Array.isArray(content)) return [];
  const out: RunTool['diffs'] = [];
  for (const c of content) {
    const d = c as { type?: unknown; path?: unknown; oldText?: unknown; newText?: unknown };
    if (d?.type === 'diff' && typeof d.path === 'string' && typeof d.newText === 'string') {
      out.push({ path: d.path, oldText: typeof d.oldText === 'string' ? d.oldText : null, newText: d.newText });
    }
  }
  return out;
}

function outputOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const c of content) {
    const b = c as { type?: unknown; content?: unknown };
    if (b?.type === 'content') {
      const t = textOf(b.content);
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join('\n') : null;
}

/** S6: an update that carries a call's bodies (its output, diffs or input) replaces what was cut before. */
function carriesBodies(u: AcpUpdate): boolean {
  const o = u as { content?: unknown; rawOutput?: unknown; rawInput?: unknown };
  return o.content !== undefined || o.rawOutput !== undefined || o.rawInput !== undefined;
}

function subagentOf(raw: unknown): string | null {
  const r = raw as { subagent_type?: unknown; description?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.subagent_type !== 'string') return null;
  return typeof r.description === 'string' && r.description ? `${r.subagent_type}: ${r.description}` : r.subagent_type;
}

/** The Task call a tool call belongs to: claude-agent-acp tags a subagent's own steps with it. */
function parentOf(u: unknown): string | null {
  const m = (u as { _meta?: { claudeCode?: { parentToolUseId?: unknown }; sequence?: { parentToolCallId?: unknown } } } | null)?._meta;
  const id = m?.claudeCode?.parentToolUseId ?? m?.sequence?.parentToolCallId;
  return typeof id === 'string' && id ? id : null;
}

function upsertTool(items: RunItem[], id: string, make: (was: RunTool | null) => RunTool): RunItem[] {
  const at = items.findIndex((i) => i.kind === 'tool' && i.id === id);
  if (at === -1) return [...items, make(null)];
  const next = items.slice();
  next[at] = make(items[at] as RunTool);
  return next;
}

/**
 * S2b: the open thought ends with the first answer token or tool call (or
 * the run's end). Its time is the agent's own when it gave both ends.
 */
function closeThought(items: RunItem[], now: number, agentEnd?: number): RunItem[] {
  const at = items.findIndex((i) => i.kind === 'thought' && i.endedAt === null);
  if (at === -1) return items;
  const t = items[at] as RunThought;
  const next = items.slice();
  next[at] = { ...t, endedAt: now, ms: typeof agentEnd === 'number' && typeof t.agentAt === 'number' ? agentEnd - t.agentAt : now - t.startedAt };
  return next;
}

/** A run that ends (or is stopped) ends its thinking and every call still shown as running. */
function settleItems(items: RunItem[], now: number, status: ToolStatus): RunItem[] {
  const closed = closeThought(items, now);
  return closed.some((i) => i.kind === 'tool' && i.status === 'running')
    ? closed.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status, endedAt: now } : i))
    : closed;
}

function foldThought(run: AgentRun, u: AcpUpdate, now: number): AgentRun {
  const text = textOf(u.content);
  const meta = (u as { _meta?: { sequence?: { thought?: unknown; at?: unknown } } })._meta?.sequence;
  const at = typeof meta?.at === 'number' ? meta.at : undefined;
  const open = run.items.findIndex((i) => i.kind === 'thought' && i.endedAt === null);
  if (meta?.thought === 'end') {
    const items = open === -1 ? run.items : run.items.map((i, k) => (k === open ? { ...(i as RunThought), text: (i as RunThought).text + text } : i));
    return { ...run, items: closeThought(items, now, at) };
  }
  if (open !== -1 && meta?.thought !== 'start') {
    const t = run.items[open] as RunThought;
    if (!text) return run;
    const items = run.items.slice();
    items[open] = { ...t, text: t.text + text };
    return { ...run, items };
  }
  const items = closeThought(run.items, now);
  return { ...run, items: [...items, { kind: 'thought', id: `t${items.length}`, text, startedAt: now, endedAt: null, ms: null, agentAt: at ?? null }] };
}

/** Fold one stream event into a run. Pure: the same events give the same run. */
export function foldRunEvent(run: AgentRun, e: RunNodeEvent, now: number): AgentRun {
  /* Round 9: a stopped run is over for the person; whatever the agent still sends is not shown. */
  if (run.stopped) return run;
  /* Answered: the person has the answer; a late failure of the bridge's background work is a note, not a failed run. */
  if (run.answered && e.type === 'acp:error') {
    const text = `The agent's background work ended: ${e.error ?? 'it failed'}`;
    if (run.items.some((i) => i.kind === 'note' && i.text === text)) return run;
    return { ...run, items: [...run.items, { kind: 'note', id: `note${run.items.length}`, text }] };
  }
  if (e.type === 'acp:waiting') return run.status === 'running' ? { ...run, lastEventAt: now - Math.max(0, e.quietMs), stalled: e.stalled ? { since: now - Math.max(0, e.quietMs), reason: `${e.reason === 'tool' ? 'Tool running without new events' : 'No agent events'} for ${Math.floor(e.quietMs / 1000)}s` } : null, waiting: { reason: e.reason, quietMs: e.quietMs, ...(e.toolMs !== undefined ? { toolMs: e.toolMs } : {}), ...(e.toolKind ? { toolKind: e.toolKind } : {}) } } : run;
  if (e.type === 'acp:tokens') { const tokens = parseRunTokens(e.tokens); return tokens ? { ...run, tokens } : run; }
  if (e.type === 'acp:turn-id') return typeof e.turnId === 'string' && e.turnId ? { ...run, turnId: e.turnId } : run;
  if (e.type === 'acp:transcript') return { ...run, transcriptId: e.turnId };
  if (e.type === 'acp:update' || e.type === 'acp:permission' || e.type === 'acp:question') run = { ...run, lastEventAt: now, stalled: null, waiting: null };
  switch (e.type) {
    case 'acp:update': {
      const u = updateOf(e);
      if (!u) return run;
      /* The first answer token or tool call ends the thinking. */
      if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'tool_call') {
        const items = closeThought(run.items, now);
        if (items !== run.items) run = { ...run, items };
      }
      switch (u.sessionUpdate) {
        case 'agent_thought_chunk':
          return foldThought(run, u, now);
        case 'agent_message_chunk': {
          const text = textOf(u.content);
          if (!text) return run;
          const last = run.items[run.items.length - 1];
          if (last?.kind === 'message') {
            const items = run.items.slice(0, -1);
            return { ...run, items: [...items, { ...last, text: last.text + text }] };
          }
          return { ...run, items: [...run.items, { kind: 'message', id: `m${run.items.length}`, text }] };
        }
        case 'tool_call':
        case 'tool_call_update': {
          if (typeof u.toolCallId !== 'string') return run;
          const id = u.toolCallId;
          const items = upsertTool(run.items, id, (was) => {
            const status = toolStatus(u.status, was?.status ?? 'running');
            const changes = u.rawInput !== undefined ? codexChangesOf(u.rawInput) : [];
            const diffs = diffsOf(u.content);
            const output = outputOf(u.content);
            return {
              kind: 'tool',
              id,
              title: typeof u.title === 'string' && u.title ? u.title : (was?.title ?? 'Tool call'),
              toolKind: typeof u.kind === 'string' ? u.kind : (was?.toolKind ?? null),
              status,
              startedAt: was?.startedAt ?? now,
              endedAt: status === 'running' ? null : (was?.endedAt ?? now),
              changes: changes.length ? changes : (was?.changes ?? []),
              diffs: diffs.length ? diffs : (was?.diffs ?? []),
              output: output ?? was?.output ?? null,
              /* S6: a call update that carries bodies says which of them were cut. */
              ...(carriesBodies(u) ? (cappedOf(e).length ? { capped: cappedOf(e), capSource: e } : {}) : was?.capped?.length ? { capped: was.capped, capSource: was.capSource } : {}),
              /* Claude's Task tool starts a subagent: the strip shows it. */
              subagent: subagentOf(u.rawInput) ?? was?.subagent ?? null,
              parentId: parentOf(u) ?? was?.parentId ?? null,
            };
          });
          return { ...run, items };
        }
        case 'plan': {
          const entries = Array.isArray(u.entries)
            ? (u.entries as { content?: unknown; status?: unknown }[])
                .filter((x) => typeof x?.content === 'string')
                .map((x) => ({ content: x.content as string, status: typeof x.status === 'string' ? x.status : 'pending' }))
            : [];
          const at = run.items.findIndex((i) => i.kind === 'plan');
          const allDone = entries.length > 0 && entries.every((x) => x.status === 'completed');
          if (at === -1) {
            return { ...run, items: [...run.items, { kind: 'plan', id: 'plan', entries, startedAt: now, endedAt: allDone ? now : null }] };
          }
          const was = run.items[at] as RunPlan;
          const items = run.items.slice();
          items[at] = { ...was, entries, endedAt: allDone ? (was.endedAt ?? now) : null };
          return { ...run, items };
        }
        /* S2b: what the CLI is doing, as the adapter states it in ACP's words. */
        case 'plan_update': {
          const p = (u as { plan?: { type?: unknown; planId?: unknown; content?: unknown } }).plan;
          if (!p || p.type !== 'markdown' || typeof p.content !== 'string') return run;
          const goal = ((u as { _meta?: { codex?: { goal?: { status?: unknown } } } })._meta?.codex?.goal ?? null) as { status?: unknown } | null;
          return { ...run, cliPlan: { id: String(p.planId ?? 'plan'), content: p.content, status: typeof goal?.status === 'string' ? goal.status : null } };
        }
        case 'usage_update': {
          const x = u as { used?: unknown; size?: unknown; cost?: { amount?: unknown; currency?: unknown } | null };
          if (typeof x.used !== 'number' || typeof x.size !== 'number') return run;
          const cost = x.cost && typeof x.cost.amount === 'number' ? { amount: x.cost.amount, currency: typeof x.cost.currency === 'string' ? x.cost.currency : 'USD' } : null;
          return { ...run, usage: { used: x.used, size: x.size, cost } };
        }
        case 'session_info_update': {
          const sequence = (u as { _meta?: { sequence?: { answerComplete?: boolean; evidence?: string } } })._meta?.sequence;
          if (sequence?.answerComplete === true && sequence.evidence === 'codex.final_answer.completed') return { ...run, answerComplete: true };
          const limits = (u as { _meta?: { sequence?: { rateLimits?: RunLimits } } })._meta?.sequence?.rateLimits;
          return limits ? { ...run, limits } : run;
        }
        case 'current_mode_update': {
          const mode = (u as { currentModeId?: unknown }).currentModeId;
          return typeof mode === 'string' ? { ...run, mode } : run;
        }
        default:
          return run;
      }
    }
    case 'acp:permission': {
      /* The mode declined it and says why: one quiet line, once per run. */
      if (typeof e.note === 'string' && e.note && typeof e.requestId !== 'string') {
        if (run.items.some((i) => i.kind === 'note' && i.text === e.note)) return run;
        return { ...run, items: [...run.items, { kind: 'note', id: `note${run.items.length}`, text: e.note }] };
      }
      const approvals = foldApproval(run.approvals, e);
      if (approvals === run.approvals) return run;
      const id = e.requestId as string;
      const has = run.items.some((i) => i.kind === 'approval' && i.id === id);
      const items = has
        ? run.items.map((i) => (i.kind === 'approval' && i.id === id && e.pending !== true ? { ...i, settledAt: now } : i))
        : [...run.items, { kind: 'approval' as const, id, at: now, settledAt: null }];
      return { ...run, approvals, items };
    }
    case 'acp:question': {
      const was = run.questions ?? [];
      const questions = foldQuestion(was, e);
      if (questions === was) return run;
      const id = e.requestId as string;
      const has = run.items.some((i) => i.kind === 'question' && i.id === id);
      const items = has
        ? run.items.map((i) => (i.kind === 'question' && i.id === id && e.pending === false ? { ...i, settledAt: now } : i))
        : [...run.items, { kind: 'question' as const, id, at: now, settledAt: null }];
      return { ...run, questions, items };
    }
    case 'acp:result': {
      /* Answered already: the end of the bridge's hold changes nothing the person sees. */
      /* Claude's bridge holds the turn after answering: the ask ledger's report may come only now. */
      if (run.answered) return { ...run, live: null, ...(e.askLedger ? { askLedger: e.askLedger } : {}) };
      const text = e.text ?? '';
      const said = run.items.some((i) => i.kind === 'message' && i.text.trim() !== '');
      const operation = e.operation ?? run.operation ?? 'prompt';
      const empty = operation === 'prompt' && !text.trim() && !said;
      const failed = empty || (!!e.stopReason && e.stopReason !== 'end_turn');
      const closed = settleItems(run.items, now, failed ? 'failed' : 'done');
      const items = !said && text ? [...closed, { kind: 'message' as const, id: `m${closed.length}`, text }] : closed;
      const ledger = e.askLedger ? { askLedger: e.askLedger } : {};
      if (!failed) return { ...run, ...ledger, items, status: 'done', endedAt: now, live: null, queued: false, stopReason: e.stopReason, endedWithoutAnswer: false, operation, answerComplete: operation === 'prompt' && (!!run.answerComplete || e.stopReason === 'end_turn') };
      const error = e.stopReason === 'cancelled' ? 'Stopped.' : e.stopReason === 'refusal' ? 'The agent refused this request.' : empty ? `The agent ended without an answer (${e.stopReason ?? 'unknown'}).` : `The agent stopped (${e.stopReason}).`;
      return { ...run, items, status: 'failed', endedAt: now, live: null, queued: false, error, stopReason: e.stopReason, endedWithoutAnswer: empty, operation, answerComplete: false };
    }
    case 'acp:error': {
      const k = e.recovery?.kind;
      const recovery: RunRecovery | null =
        k === 'signIn' || k === 'retry' || k === 'install' || k === 'wait' || k === 'settings'
          ? {
              kind: k,
              ...(e.recovery?.provider ? { provider: e.recovery.provider } : {}),
              ...(typeof e.recovery?.cause === 'string' ? { cause: e.recovery.cause as RunRecovery['cause'] } : {}),
              ...(k === 'wait' && typeof e.recovery?.resetsAt === 'number' ? { resetsAt: e.recovery.resetsAt } : {}),
            }
          : null;
      return { ...run, items: settleItems(run.items, now, 'failed'), status: 'failed', endedAt: now, error: e.error ?? 'The agent run failed.', recovery, live: null, queued: false };
    }
    case 'acp:turn': {
      if (e.state === 'queued') return { ...run, queued: true };
      if (e.state === 'answered') {
        if (run.status !== 'running') return run;
        const said = run.items.some((i) => i.kind === 'message');
        const closed = closeThought(run.items, now);
        const items = !said && e.text ? [...closed, { kind: 'message' as const, id: `m${closed.length}`, text: e.text }] : closed;
        const ledger = e.askLedger;
        return { ...run, items, status: 'done', endedAt: now, answered: true, queued: false, ...(ledger ? { askLedger: ledger } : {}) };
      }
      return e.state === 'ended' || e.state === 'settled' || e.state === 'hung' ? { ...run, turn: e.state } : run;
    }
    case 'acp:status': {
      const live = {
        phase: typeof e.phase === 'string' ? e.phase : 'waiting',
        forMs: typeof e.forMs === 'number' ? e.forMs : 0,
        quietMs: typeof e.quietMs === 'number' ? e.quietMs : 0,
        openTools: typeof e.openTools === 'number' ? e.openTools : 0,
        tool: e.tool ? { kind: e.tool.kind ?? null, title: e.tool.title ?? null } : null,
        at: now,
      };
      return { ...run, live, queued: live.phase === 'queued' };
    }
    case 'acp:usage': {
      const u = e.usage;
      if (!u) return run;
      const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
      const turnUsage = { input: n(u.input), output: n(u.output), cacheRead: n(u.cacheRead), cacheWrite: n(u.cacheWrite), thought: n(u.thought), total: n(u.total) };
      if (!turnUsage.total) turnUsage.total = turnUsage.input + turnUsage.output;
      return turnUsage.total || turnUsage.cacheRead ? { ...run, turnUsage } : run;
    }
    case 'acp:log':
      return e.log ? { ...run, log: e.log } : run;
    case 'acp:session':
      return { ...run, resumed: e.resumed === true, resumeNote: e.resumed === true ? null : (e.reason ?? null), ...(e.rewound ? { rewound: e.rewound } : {}) };
    case 'acp:model':
      return typeof e.model === 'string' && e.model ? { ...run, model: e.model } : run;
    default:
      return run;
  }
}

/** A run's approvals still waiting for an answer. */
export function pendingApprovals(run: AgentRun): AgentApproval[] {
  return run.approvals.filter((a) => a.decision === null);
}

/** A run's questions still waiting for an answer. */
export function pendingQuestions(run: AgentRun): AgentQuestion[] {
  return (run.questions ?? []).filter((q) => !q.settled);
}

/** The change set the stream carried for the tool call an approval is about. */
export function changesForApproval(run: AgentRun, approval: AgentApproval): CodexChange[] {
  const id = approval.toolCallId;
  if (!id) return [];
  const tool = run.items.find((i): i is RunTool => i.kind === 'tool' && i.id === id);
  return tool?.changes ?? [];
}


/* The store applies events through this once the module is loaded. */
registerFold(foldRunEvent);
