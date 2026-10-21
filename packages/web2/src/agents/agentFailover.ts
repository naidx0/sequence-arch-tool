/* ══════════════════════════════════════════════════════════════════════════
   PRIMARY / BACKUP WHEN A SUBSCRIPTION RUNS OUT
   packages/web2/src/agents/agentFailover.ts

   Usage lives in the status bar. This is the format beside it: which agent is
   main, which subscription takes over when that one is spent, and that the
   main agent is tried again every five hours after we switch off.

   Claude hits its limit → Codex (ChatGPT) takes the stopped turn. Five hours
   later we try Claude again; if it is still spent we stay on the backup and
   wait another five hours. One backup only: a spent backup does not bounce
   back, which would loop.
   ══════════════════════════════════════════════════════════════════════════ */

export const FAILOVER_KEY = 'sequence.agentFailover.v1';
export const RETRY_PRIMARY_MS = 5 * 60 * 60 * 1000;

export interface FailoverFormat {
  primary: string;
  backup: string | null;
}

export interface FailoverOff {
  from: string;
  at: number;
  chats: string[];
}

export interface FailoverState {
  format: FailoverFormat;
  off: FailoverOff | null;
}

export type FailoverDecision =
  | { action: 'use-backup'; agent: string; retryPrimaryAt: number }
  | { action: 'retry-primary'; agent: string }
  | { action: 'wait' };

const empty: FailoverState = { format: { primary: '', backup: null }, off: null };

function agentId(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(v) ? v : null;
}

export function readFailover(raw: unknown): FailoverState {
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const fmt = r.format && typeof r.format === 'object' ? (r.format as Record<string, unknown>) : r;
  const primary = agentId(fmt.primary) ?? '';
  const backup = agentId(fmt.backup);
  const offRaw = r.off && typeof r.off === 'object' ? (r.off as Record<string, unknown>) : null;
  const from = offRaw ? agentId(offRaw.from) : null;
  const at = offRaw && typeof offRaw.at === 'number' && Number.isFinite(offRaw.at) ? offRaw.at : null;
  const chats = offRaw && Array.isArray(offRaw.chats) ? offRaw.chats.filter((c): c is string => typeof c === 'string' && c.length > 0).slice(0, 64) : [];
  return {
    format: { primary, backup: backup && backup !== primary ? backup : null },
    off: from && at !== null ? { from, at, chats } : null,
  };
}

export function loadFailover(storage: Pick<Storage, 'getItem'> | null): FailoverState {
  try {
    const raw = storage?.getItem(FAILOVER_KEY);
    return readFailover(raw ? JSON.parse(raw) : null);
  } catch {
    return empty;
  }
}

export function saveFailover(storage: Pick<Storage, 'setItem'> | null, state: FailoverState): void {
  try {
    storage?.setItem(FAILOVER_KEY, JSON.stringify(state));
  } catch {
    /* a full store keeps the format for this page only */
  }
}

export function writeFormat(state: FailoverState, format: FailoverFormat): FailoverState {
  const next = readFailover({ format, off: state.off });
  if (state.off && next.format.primary && state.off.from !== next.format.primary) return { ...next, off: null };
  return next;
}

/** A spent primary with a ready backup: switch now, try the primary again in five hours. */
export function decideOnLimit(input: {
  limitedAgent: string;
  readyAgents: readonly string[];
  state: FailoverState;
  now: number;
  chatId?: string | null;
}): { decision: FailoverDecision; state: FailoverState } {
  const { limitedAgent, readyAgents, state, now, chatId } = input;
  const { primary, backup } = state.format;
  if (!primary || !backup || limitedAgent !== primary) return { decision: { action: 'wait' }, state };
  if (!readyAgents.includes(backup)) return { decision: { action: 'wait' }, state };
  const chats = chatId && !state.off?.chats.includes(chatId) ? [...(state.off?.chats ?? []), chatId] : (state.off?.chats ?? []);
  const off: FailoverOff = { from: primary, at: state.off?.from === primary ? state.off.at : now, chats };
  const retryPrimaryAt = off.at + RETRY_PRIMARY_MS;
  return {
    decision: { action: 'use-backup', agent: backup, retryPrimaryAt },
    state: { ...state, off },
  };
}

/** Five hours after switching off: try the main agent again. Still spent → wait another five hours. */
export function decideOnTick(input: {
  primaryReady: boolean;
  state: FailoverState;
  now: number;
}): { decision: FailoverDecision; state: FailoverState } {
  const { primaryReady, state, now } = input;
  const off = state.off;
  const primary = state.format.primary;
  if (!off || !primary || off.from !== primary) return { decision: { action: 'wait' }, state };
  if (now < off.at + RETRY_PRIMARY_MS) return { decision: { action: 'wait' }, state };
  if (primaryReady) return { decision: { action: 'retry-primary', agent: primary }, state: { ...state, off: null } };
  return { decision: { action: 'wait' }, state: { ...state, off: { ...off, at: now } } };
}

export function retryPrimaryAt(state: FailoverState): number | null {
  return state.off ? state.off.at + RETRY_PRIMARY_MS : null;
}

export function failoverLine(primaryLabel: string, backupLabel: string): string {
  return `Using ${backupLabel}. ${primaryLabel} is tried again every 5 hours.`;
}

export function agentLabel(id: string): string {
  if (id === 'claude') return 'Claude';
  if (id === 'codex') return 'Codex';
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'the agent';
}
