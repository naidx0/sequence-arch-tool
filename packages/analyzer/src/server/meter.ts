/**
 * Per-user metering for the FREE metered default model (v9 Phase 2).
 *
 * The honesty problem this solves: a bundled "we pay" default must never (a)
 * rate-limit a user at the gate, nor (b) let a bug or abuse run up our bill. The
 * research doc's scheme, made concrete here as PURE, deterministic logic:
 *
 *   1. A GENEROUS monthly soft allotment. There is NO per-minute rate limit.
 *   2. Exceeding the monthly allotment is a SOFT cap: the request is STILL
 *      allowed (`allow:true`, flagged `'soft-cap'`) — a nudge to add a key, not
 *      a 429 wall — right up until…
 *   3. …the GLOBAL spend backstop, an org-wide $ ceiling on our funded account.
 *      Only there does the meter HARD-block (`allow:false`, `'backstop'`).
 *
 * This module holds no I/O and no clock of its own beyond the tiny
 * {@link currentMonthYear} helper — everything it decides is a pure function of
 * its inputs, so it is trivially and deterministically unit-tested. Persistence
 * (usage.json) and wiring live in repoServer; api-key mode is never metered.
 */

/** Tunable policy. `monthlyAllotment` is a soft cap; `globalSpendBackstop` is the hard $ ceiling. */
export interface MeterPolicy {
  /** Generous monthly soft allotment of calls, per user. Exceeding it is a nudge, not a block. */
  monthlyAllotment: number;
  /** Org-wide cumulative $ spend on our funded account beyond which the default HARD-blocks. */
  globalSpendBackstop: number;
}

/** Persisted per-user usage (usage.json). `monthYear` scopes `usedThisMonth`; spend is cumulative. */
export interface MeterUsage {
  /** Calls charged in `monthYear`. Reset to 0 on a month rollover (see {@link normalizeUsage}). */
  usedThisMonth: number;
  /** The month `usedThisMonth` belongs to, `YYYY-MM`. */
  monthYear: string;
  /** Cumulative estimated $ spent through the default gateway, all-time (the backstop axis). */
  globalSpendToDate: number;
}

export interface MeterDecision {
  /** false ONLY at the global spend backstop. Soft-cap still allows. */
  allow: boolean;
  reason: 'ok' | 'soft-cap' | 'backstop';
  /** Calls left in the monthly allotment (0 once soft-capped). */
  remaining: number;
}

/**
 * The default policy. 100 explains/month (research: a light user does 20–50; at
 * ~$0.0018 each the monthly cost is pennies) and a $50 cumulative spend backstop
 * on our funded account. Both are deliberately generous — the point is that
 * nobody hits a wall at the gate; the backstop only guards against runaway abuse.
 */
export const DEFAULT_METER_POLICY: MeterPolicy = {
  monthlyAllotment: 100,
  globalSpendBackstop: 50,
};

/**
 * Estimated $ cost of a single default-model call (one "repo explained"), from
 * docs/AI_CONNECT_RESEARCH.md: 5k in / 4k out on deepseek-v4-flash ≈ $0.0018.
 * Used only to advance the cumulative backstop axis; it is an estimate, not a bill.
 */
export const EST_COST_PER_CALL = 0.0018;

/** The current `YYYY-MM` bucket. The only clock in this module; injectable for tests. */
export function currentMonthYear(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Roll `usage` into `monthYear`: when the stored month differs (a rollover), the
 * monthly counter resets to 0 while the cumulative `globalSpendToDate` PERSISTS
 * (the backstop is all-time, not monthly). A missing/garbage usage yields a
 * fresh zeroed record for `monthYear`. Pure — never mutates its input.
 */
export function normalizeUsage(usage: Partial<MeterUsage> | undefined, monthYear: string): MeterUsage {
  const globalSpendToDate =
    usage && typeof usage.globalSpendToDate === 'number' && usage.globalSpendToDate >= 0
      ? usage.globalSpendToDate
      : 0;
  if (!usage || usage.monthYear !== monthYear) {
    return { usedThisMonth: 0, monthYear, globalSpendToDate };
  }
  const usedThisMonth = typeof usage.usedThisMonth === 'number' && usage.usedThisMonth >= 0 ? usage.usedThisMonth : 0;
  return { usedThisMonth, monthYear, globalSpendToDate };
}

/**
 * The core decision. Backstop takes precedence over the soft cap: once the
 * global spend ceiling is reached the default HARD-blocks regardless of the
 * monthly counter. Below the backstop, exceeding the monthly allotment is a soft
 * cap that STILL allows the call. Pure; `usage` is assumed already normalized to
 * the current month.
 */
export function decide(usage: MeterUsage, policy: MeterPolicy): MeterDecision {
  const remaining = Math.max(0, policy.monthlyAllotment - usage.usedThisMonth);
  if (usage.globalSpendToDate >= policy.globalSpendBackstop) {
    return { allow: false, reason: 'backstop', remaining };
  }
  if (usage.usedThisMonth >= policy.monthlyAllotment) {
    return { allow: true, reason: 'soft-cap', remaining: 0 };
  }
  return { allow: true, reason: 'ok', remaining };
}

/**
 * Record one charged call: normalize to `monthYear`, then advance the monthly
 * counter and the cumulative spend by `costPerCall`. Pure — returns the next
 * usage; the caller persists it. Called ONLY after a successful default-mode
 * request (a blocked or api-key call never touches the meter).
 */
export function recordUse(
  usage: Partial<MeterUsage> | undefined,
  monthYear: string,
  costPerCall: number = EST_COST_PER_CALL
): MeterUsage {
  const cur = normalizeUsage(usage, monthYear);
  return {
    usedThisMonth: cur.usedThisMonth + 1,
    monthYear,
    globalSpendToDate: cur.globalSpendToDate + costPerCall,
  };
}

/**
 * Advance cumulative spend by an arbitrary reconciled USD amount (ADR-013 Phase D).
 * Does not increment the monthly call counter — use {@link recordUse} for that path.
 */
export function recordSpend(
  usage: Partial<MeterUsage> | undefined,
  monthYear: string,
  costUsd: number,
): MeterUsage {
  const cur = normalizeUsage(usage, monthYear);
  const delta = Math.max(0, costUsd);
  return {
    usedThisMonth: cur.usedThisMonth,
    monthYear,
    globalSpendToDate: cur.globalSpendToDate + delta,
  };
}

/** True when `usage` is at or past the global spend backstop. */
export function isSpendBackstopped(usage: MeterUsage, policy: MeterPolicy): boolean {
  return usage.globalSpendToDate >= policy.globalSpendBackstop;
}
