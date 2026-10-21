/**
   THE TOKEN MAP, AS NUMBERS
   packages/web2/src/settings/tokenUsageModel.ts

   A GitHub-style year: 53 week columns ending with the current week, Sunday
   first, one cell per local day. The server sends only days that have usage;
   this fills the silent days and buckets the intensity against the busiest
   day in the window, the way the contribution graph does.

   Pure and clock-injected, so the gate can pin a date instead of hoping the
   test runs in the right week.
   ------------------------------------------------ */

import type { GetTokenUsageResponse, TokenUsageDay } from '@sequence/api-types';

export type TokenLevel = 0 | 1 | 2 | 3 | 4;

export interface TokenCell {
  date: string;
  total: number;
  level: TokenLevel;
  /** After today: drawn as an empty slot, never as a zero day. */
  future: boolean;
  label: string;
}

export interface TokenWeek {
  cells: TokenCell[];
  /** Three-letter month at the first week of a month, when it does not crowd the last label. */
  month: string | null;
}

export interface TokenMap {
  weeks: TokenWeek[];
  /** The busiest day in the window (the top of the scale). */
  max: number;
  from: string;
  to: string;
  /** Tokens inside the window only. */
  windowTotal: number;
  activeDays: number;
}

export const MAP_WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/** "12,345" with no locale surprises in tests. */
export function exactTokens(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 999, 12.3k, 1.2m: the header's short form, trailing .0 dropped. */
export function compactTokens(n: number): string {
  const drop = (s: string) => s.replace(/\.0$/, '');
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${drop((n / 1000).toFixed(n < 10_000 ? 1 : 0))}k`;
  return `${drop((n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0))}m`;
}

export function dayLabel(key: string): string {
  const d = fromKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function levelOf(total: number, max: number): TokenLevel {
  if (total <= 0 || max <= 0) return 0;
  const share = total / max;
  if (share >= 0.75) return 4;
  if (share >= 0.5) return 3;
  if (share >= 0.25) return 2;
  return 1;
}

/**
 * The year ending today. `days` is whatever the server sent (oldest first,
 * gaps allowed); `today` is a local date.
 */
export function buildTokenMap(days: readonly TokenUsageDay[], today = new Date()): TokenMap {
  const byDate = new Map<string, number>();
  for (const day of days) {
    if (typeof day?.date === 'string') byDate.set(day.date, (byDate.get(day.date) ?? 0) + Math.max(0, day.total));
  }
  const lastSunday = startOfWeek(today);
  const first = addDays(lastSunday, -(MAP_WEEKS - 1) * 7);
  const todayKey = keyOf(today);
  let max = 0;
  let windowTotal = 0;
  let activeDays = 0;
  for (const [date, total] of byDate) {
    if (date < keyOf(first) || date > todayKey) continue;
    if (total > max) max = total;
    windowTotal += total;
    if (total > 0) activeDays += 1;
  }
  const weeks: TokenWeek[] = [];
  let lastMonthAt = -10;
  let lastMonth = -1;
  for (let w = 0; w < MAP_WEEKS; w++) {
    const sunday = addDays(first, w * 7);
    const cells: TokenCell[] = [];
    for (let r = 0; r < 7; r++) {
      const d = addDays(sunday, r);
      const key = keyOf(d);
      const total = byDate.get(key) ?? 0;
      const future = key > todayKey;
      cells.push({
        date: key,
        total: future ? 0 : total,
        level: future ? 0 : levelOf(total, max),
        future,
        label: future ? '' : `${exactTokens(total)} tokens on ${dayLabel(key)}`,
      });
    }
    const month = sunday.getMonth();
    let label: string | null = null;
    if (month !== lastMonth) {
      if (w - lastMonthAt >= 4) {
        label = MONTHS[month];
        lastMonthAt = w;
      }
      lastMonth = month;
    }
    weeks.push({ cells, month: label });
  }
  return {
    weeks,
    max,
    from: keyOf(first),
    to: todayKey,
    windowTotal,
    activeDays,
  };
}

/** The line under the total: what was counted, and what "not reported" means. */
export function describeUsage(report: GetTokenUsageResponse, map: TokenMap): string {
  if (report.total <= 0) return 'No tokens reported yet.';
  const turns = report.turns === 1 ? '1 turn' : `${exactTokens(report.turns)} turns`;
  const since = report.since ? ` since ${dayLabel(report.since)}` : '';
  const quiet = report.turns > map.activeDays ? ' Days with no agent work are blank.' : '';
  return `${turns}${since}. Only turns where the agent reported usage are counted.${quiet}`;
}
