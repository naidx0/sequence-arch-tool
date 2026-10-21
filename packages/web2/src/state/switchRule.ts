/** Stored with the chat pick, including the completion receipts: restoring history cannot replay it. */
export interface SwitchRule {
  target: string;
  remaining: number;
  createdAt: number;
  counted: string[];
  error?: string;
}

export type SwitchCommand = { kind: 'now'; target: string } | { kind: 'schedule'; target: string; turns: number } | { kind: 'cancel' } | { kind: 'invalid' };
export const SWITCH_USAGE = 'Use /switch <agent>, /switch <agent> <turns>, or /switch cancel.';

export function parseSwitchCommand(text: string): SwitchCommand | null {
  if (!/^\s*\/switch(?=\s|$)/i.test(text)) return null;
  const words = text.trim().split(/\s+/).slice(1);
  if (words.length === 1 && words[0]?.toLowerCase() === 'cancel') return { kind: 'cancel' };
  const target = words[0]?.toLowerCase();
  if (!target || target === 'cancel' || !/^[a-z0-9][a-z0-9._-]*$/.test(target)) return { kind: 'invalid' };
  if (words.length === 1) return { kind: 'now', target };
  if (words.length === 2 && /^[1-9]\d*$/.test(words[1]!) && Number(words[1]) <= 10000) return { kind: 'schedule', target, turns: Number(words[1]) };
  return { kind: 'invalid' };
}

export function readSwitchRule(raw: unknown): SwitchRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as SwitchRule;
  if (typeof r.target !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(r.target) || !Number.isInteger(r.remaining) || r.remaining < 0 || r.remaining > 10000 || !Number.isFinite(r.createdAt) || !Array.isArray(r.counted) || r.counted.length > 10000 || !r.counted.every(x => typeof x === 'string')) return undefined;
  return { target: r.target, remaining: r.remaining, createdAt: r.createdAt, counted: [...r.counted], ...(typeof r.error === 'string' ? { error: r.error } : {}) };
}

export interface SwitchCompletion {
  id: string;
  startedAt: number;
  status: string;
  restored?: boolean;
  stopped?: boolean;
  operation?: string;
}

/** Called only for a live running -> terminal transition, never for a transcript snapshot. */
export function advanceSwitchRule(rule: SwitchRule, turn: SwitchCompletion): SwitchRule {
  if (rule.remaining === 0 || turn.status !== 'done' || turn.restored || turn.stopped || turn.operation === 'compact' || turn.startedAt < rule.createdAt || rule.counted.includes(turn.id)) return rule;
  return { ...rule, remaining: rule.remaining - 1, counted: [...rule.counted, turn.id] };
}
