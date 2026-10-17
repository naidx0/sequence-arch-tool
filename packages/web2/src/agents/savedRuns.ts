/* ══════════════════════════════════════════════════════════════════════════
   AGENT CHATS COME BACK AFTER A RELAUNCH (round 9)
   packages/web2/src/agents/savedRuns.ts

   Jaden: "Chats aren't saved: his earlier chat in the workspace was lost."
   The server records every agent turn beside the chat (analyzer
   agentChatStore.ts); `GET /api/acp/runs?chatId=` reads them back, and this
   turns each into the run record the chat draws: the question, the answer,
   its tool rows, how it ended. The chat layer asks once per chat per page.

   Small and pure apart from `fetch`; the boot bundle carries it with the
   chat layer.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AskClosure, AskLedgerResult } from '@sequence/schema';
import type { AgentRun, RunItem } from './agentRuns';
import type { TokenUsage } from './agentTypes';
import { handoffNote } from './handoffNote';
import type { Fetch, TurnLogRecord } from './runNodeStream';

/** The window event a chat's new title travels on (agentRunner.ts sends it, AgentChatLayer.tsx takes it). */
export const CHAT_TITLE_EVENT = 'sequence:chat-title';

/** What Continue sends after a restart cut a turn off (the same words T3 Code uses). */
export const CONTINUE_PROMPT = 'Continue where you left off.';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A saved turn's ask-ledger report (the agent's own closing line), or null. */
function ledgerOf(raw: unknown): AskLedgerResult | null {
  const r = raw as { closures?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.closures)) return null;
  const closures: AskClosure[] = r.closures
    .filter((c): c is AskClosure => !!c && typeof (c as AskClosure).n === 'number' && typeof (c as AskClosure).done === 'boolean')
    .map((c) => ({ n: c.n, text: typeof c.text === 'string' ? c.text : '', done: c.done, reason: typeof c.reason === 'string' ? c.reason : null }));
  return closures.length ? { closures, open: closures.filter((c) => !c.done).map((c) => c.n) } : null;
}

/** A saved turn's token usage, or null when none was recorded (never an estimate). */
function usageOf(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const out = { input: num(u.input), output: num(u.output), cacheRead: num(u.cacheRead), cacheWrite: num(u.cacheWrite), thought: num(u.thought), total: num(u.total) };
  if (!out.total) out.total = out.input + out.output;
  return out.total || out.cacheRead ? out : null;
}

/** One saved turn as a run record, or null for a record that is not one. */
export function fromSavedRun(raw: unknown, sessionId: string): AgentRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const prompt = str(r.prompt);
  if (!id || prompt === null) return null;
  const startedAt = num(r.startedAt);
  const endedAt = num(r.endedAt) || startedAt;
  const tools: RunItem[] = (Array.isArray(r.tools) ? r.tools : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string')
    .map((t) => {
      /* Per-step times and the subagent link are newer fields; an old record has neither and gets the turn's span. */
      const at = num(t.startedAt) || startedAt;
      const end = num(t.endedAt) || (num(t.startedAt) ? at : endedAt);
      const subagent = str(t.subagent);
      const parentId = str(t.parentId);
      return {
        kind: 'tool' as const,
        id: t.id as string,
        title: str(t.title) ?? 'Tool',
        toolKind: str(t.toolKind),
        status: t.status === 'failed' || t.status === 'running' ? ('failed' as const) : ('done' as const),
        startedAt: at,
        endedAt: Math.max(at, end),
        changes: [],
        diffs: [],
        output: null,
        ...(subagent ? { subagent } : {}),
        ...(parentId ? { parentId } : {}),
      };
    });
  const text = str(r.text) ?? '';
  /* Where in the text each call began, as the server saw it. The live chat drew the prose before a call, the call, then the
     prose after it; a record that knows the offsets is drawn the same way. An older record has none: its calls come first. */
  const offsets = (Array.isArray(r.tools) ? r.tools : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string')
    .map((t) => (typeof t.at === 'number' && Number.isFinite(t.at) && t.at >= 0 ? Math.floor(t.at) : null));
  const placed = offsets.length > 0 && offsets.every((o) => o !== null);
  const body: RunItem[] = [];
  if (placed) {
    let pos = 0;
    tools.forEach((tool, i) => {
      const cut = Math.min(text.length, Math.max(pos, offsets[i]!));
      if (cut > pos) body.push({ kind: 'message' as const, id: `m${body.length}`, text: text.slice(pos, cut) });
      body.push(tool);
      pos = cut;
    });
    if (pos < text.length) body.push({ kind: 'message' as const, id: `m${body.length}`, text: text.slice(pos) });
  } else {
    body.push(...tools, ...(text ? [{ kind: 'message' as const, id: `m${tools.length}`, text }] : []));
  }
  /* THE WORDS THE PERSON STEERED IN come back where they were sent: after the last step that had begun by then (before any
     step, at the front), in the order they were sent. */
  const steers = (Array.isArray(r.steers) ? r.steers : [])
    .filter((s): s is { text: string; at: number } => !!s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string' && (s as { text: string }).text.trim() !== '' && typeof (s as { at?: unknown }).at === 'number')
    .map((s, i) => ({ text: s.text.trim(), at: s.at, i }))
    .sort((a, c) => a.at - c.at || a.i - c.i);
  if (steers.length > 0) {
    const after = new Map<string, RunItem[]>();
    const front: RunItem[] = [];
    steers.forEach((s, k) => {
      const item: RunItem = { kind: 'steer', id: `steer${k}`, text: s.text, at: s.at };
      const owner = [...tools].reverse().find((t) => t.kind === 'tool' && t.startedAt <= s.at);
      if (!owner) front.push(item);
      else after.set(owner.id, [...(after.get(owner.id) ?? []), item]);
    });
    const placedBody: RunItem[] = [...front];
    for (const item of body) placedBody.push(item, ...(after.get(item.id) ?? []));
    body.splice(0, body.length, ...placedBody);
  }
  const ho = (r as { handoff?: { chars?: unknown; kind?: unknown } }).handoff;
  const handoff = ho && typeof ho.chars === 'number' && ho.chars > 0 ? { chars: ho.chars, kind: ho.kind === 'delta' ? ('delta' as const) : ('full' as const) } : null;
  const items: RunItem[] = [...(handoff ? [{ kind: 'note' as const, id: 'note0', text: handoffNote(str(r.agentRef), handoff.kind) }] : []), ...body];
  const stopped = r.status === 'stopped';
  /* A restart cut this turn off (the server never saw it end). The newest one can be continued. */
  const interrupted = r.status === 'interrupted';
  /* Still running on the server (the page was reloaded mid-turn): shown as live, not as a finished answer. */
  const running = r.status === 'running';
  const failed = r.status === 'failed' || stopped || interrupted;
  const agentRef = str(r.agentRef);
  return {
    id: `saved-${id}`,
    turnId: id,
    sessionId,
    agentRef: str(r.agentRef),
    nodeId: str(r.nodeId),
    nodeLabel: null,
    prompt,
    status: failed ? 'failed' : running ? 'running' : 'done',
    startedAt,
    endedAt: running ? null : endedAt,
    items,
    approvals: [],
    error: failed ? (str(r.error) ?? (stopped ? 'Stopped.' : interrupted ? 'Interrupted by a restart.' : 'The agent run failed.')) : null,
    model: str(r.model),
    turnUsage: usageOf(r.usage),
    /* The ask ledger's report, saved with the turn: "Not done" survives a relaunch. */
    ...(ledgerOf(r.askLedger) ? { askLedger: ledgerOf(r.askLedger) } : {}),
    ...(Array.isArray(r.readPaths) && r.readPaths.some((x) => typeof x === 'string') ? { readPaths: r.readPaths.filter((x): x is string => typeof x === 'string') } : {}),
    restored: true,
    ...(handoff ? { handoff } : {}),
    ...(stopped ? { stopped: true } : {}),
    ...(interrupted
      ? {
          interrupted: true,
          recovery: { kind: 'retry' as const },
          ...(r.continuable === true ? { retry: { ...(agentRef ? { agentRef } : {}), ...(str(r.nodeId) ? { nodeId: str(r.nodeId) } : {}), sessionId, question: CONTINUE_PROMPT } } : {}),
        }
      : {}),
  };
}

/** What a person is told when the chat's saved file was damaged, or older turns are kept off screen. */
export function savedNotice(body: { damaged?: { restored?: boolean } }): string | null {
  if (body.damaged) return body.damaged.restored ? 'This chat\'s saved file was damaged. It was restored from the last backup, so the newest turn may be missing. The damaged file is kept beside it.' : 'This chat\'s saved history could not be read. The damaged file is kept in the chat\'s folder (.sequence/sessions), and nothing was overwritten.';
  return null;
}

/** The chat's recent turn logs (no words: ids, times, counts), by turn id; empty when the server cannot say. */
export async function loadTurnLogs(sessionId: string, f: Fetch): Promise<Map<string, TurnLogRecord>> {
  const out = new Map<string, TurnLogRecord>();
  try {
    const r = await f(`/api/acp/turn-log?chatId=${encodeURIComponent(sessionId)}`);
    if (!r.ok) return out;
    const body = (await r.json()) as { turns?: unknown };
    for (const t of Array.isArray(body.turns) ? body.turns : []) {
      const rec = t as TurnLogRecord | null;
      if (rec && typeof rec === 'object' && typeof rec.turnId === 'string') out.set(rec.turnId, rec);
    }
  } catch {
    /* no log: the run simply has no "Turn details" */
  }
  return out;
}

/** A restored turn that ended carries its log again, so "Turn details" reads the same after a reload as it did live. */
export function withTurnLogs(runs: AgentRun[], logs: ReadonlyMap<string, TurnLogRecord>): AgentRun[] {
  return runs.map((run) => {
    const log = run.turnId ? logs.get(run.turnId) : undefined;
    return log && run.status !== 'running' ? { ...run, log } : run;
  });
}

/** The chat's saved agent turns and a notice about the file they came from; null when the server cannot say. */
export async function loadSavedRunsChecked(sessionId: string, f: Fetch = (u, i) => fetch(u, i)): Promise<{ runs: AgentRun[]; notice: string | null; archived: number } | null> {
  try {
    const r = await f(`/api/acp/runs?chatId=${encodeURIComponent(sessionId)}`);
    if (!r.ok) return null;
    const body = (await r.json()) as { runs?: unknown; damaged?: { restored?: boolean }; archived?: number };
    const runs = Array.isArray(body.runs) ? body.runs.map((x) => fromSavedRun(x, sessionId)).filter((x): x is AgentRun => x !== null) : [];
    return { runs, notice: savedNotice(body), archived: typeof body.archived === 'number' ? body.archived : 0 };
  } catch {
    return null;
  }
}

/** A page of the chat's older turns (kept in its archive): `loaded` already read from the archive's end. */
export async function loadOlderRuns(sessionId: string, loaded: number, f: Fetch = (u, i) => fetch(u, i)): Promise<{ runs: AgentRun[]; remaining: number } | null> {
  try {
    const r = await f(`/api/acp/runs?chatId=${encodeURIComponent(sessionId)}&older=${Math.max(0, Math.floor(loaded))}`);
    if (!r.ok) return null;
    const body = (await r.json()) as { runs?: unknown; remaining?: unknown };
    const runs = Array.isArray(body.runs) ? body.runs.map((x) => fromSavedRun(x, sessionId)).filter((x): x is AgentRun => x !== null) : [];
    return { runs, remaining: typeof body.remaining === 'number' ? body.remaining : 0 };
  } catch {
    return null;
  }
}

/** The chat's saved agent turns, oldest first; empty when there are none or the server cannot say. */
export async function loadSavedRuns(sessionId: string, f: Fetch = (u, i) => fetch(u, i)): Promise<AgentRun[] | null> {
  return (await loadSavedRunsChecked(sessionId, f))?.runs ?? null;
}
