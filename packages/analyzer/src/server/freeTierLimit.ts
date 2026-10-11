/**
 * Per-user DAILY rate limit for the FREE DeepSeek-backed default (U6 fix round —
 * "make the free assistant work on first run"). The free default now routes to a
 * funded DeepSeek key server-side (see provider.ts / repoServer loadAiConfig), so
 * a per-user daily cap is what keeps the owner's bill bounded.
 *
 * ── COST MATH (budget target: ≤ $0.25 / day / user) ─────────────────────────────
 * deepseek-chat pricing ≈ $0.27 per 1M INPUT tokens + $1.10 per 1M OUTPUT tokens.
 * A repo-grounded ask (the structure digest + question in, a short answer out) is
 * roughly ~5k input + ~1k output tokens:
 *     input  : 5000 / 1e6 * $0.27 ≈ $0.00135
 *     output : 1000 / 1e6 * $1.10 ≈ $0.00110
 *     total  ≈ $0.0025 per request (round up ~$0.003 for headroom).
 * At the DEFAULT cap of 100 requests/user/day:  100 * ~$0.0025 ≈ $0.25/day/user.
 * Hence {@link DEFAULT_FREE_TIER_DAILY_LIMIT} = 100 holds the ≤ $0.25/day budget;
 * `FREE_TIER_DAILY_LIMIT` overrides it per deploy.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────────
 * Two backings, one behaviour, chosen by whether a durable store is configured:
 *
 *   • NO store (local / single instance / no `DATABASE_URL`) — {@link createDailyLimiter},
 *     an IN-MEMORY, PER-INSTANCE counter keyed by identity + UTC day. Unchanged.
 *   • Durable store (`DATABASE_URL` set) — {@link createDurableDailyGate} over the
 *     Postgres `user_daily_usage` table (pgStore.ts). N instances behind a load
 *     balancer share ONE cap, and a restart/redeploy does not zero anyone. Without
 *     this the effective cap is N× the intended one and resets on every deploy —
 *     i.e. unenforceable in exactly the configuration it exists for.
 *
 * Only the FREE default is limited — api-key (BYO) mode is never metered or
 * capped, exactly as before.
 */

import { type DailyUsageStore } from './pgStore.js';

/** The default daily cap: 100 req/user/day ⇒ ≈ $0.25/day/user (see cost math above). */
export const DEFAULT_FREE_TIER_DAILY_LIMIT = 100;

/**
 * Resolve the per-user daily cap from the environment. `FREE_TIER_DAILY_LIMIT`
 * overrides {@link DEFAULT_FREE_TIER_DAILY_LIMIT}; a blank/garbage/negative value
 * falls back to the default. `0` is honored (disables the free default entirely).
 */
export function freeTierDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.FREE_TIER_DAILY_LIMIT ?? '').trim();
  if (raw === '') return DEFAULT_FREE_TIER_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_FREE_TIER_DAILY_LIMIT;
}

/** The current UTC day bucket (`YYYY-MM-DD`). The only clock; injectable for tests. */
export function currentDayUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export interface DailyLimiter {
  /** True if `identity` may make one more call today (used < limit). */
  allow(identity: string): boolean;
  /** Record one charged call for `identity` today. Call ONLY on a successful request. */
  record(identity: string): void;
  /** Give back one charge for `identity` today (never below 0). */
  release(identity: string): void;
  /** Calls used today by `identity` (0 after a day rollover). */
  used(identity: string): number;
  /** The configured cap. */
  readonly limit: number;
}

/**
 * A minimal per-instance daily limiter. Keyed by identity; each entry auto-resets
 * on a UTC day rollover. Pure aside from the injected clock — trivially unit-tested.
 */
export function createDailyLimiter(limit: number, now: () => Date = () => new Date()): DailyLimiter {
  const counts = new Map<string, { day: string; count: number }>();
  const cur = (identity: string): { day: string; count: number } => {
    const day = currentDayUtc(now());
    const e = counts.get(identity);
    if (!e || e.day !== day) {
      const fresh = { day, count: 0 };
      counts.set(identity, fresh);
      return fresh;
    }
    return e;
  };
  return {
    limit,
    allow: (identity) => cur(identity).count < limit,
    record: (identity) => {
      cur(identity).count += 1;
    },
    release: (identity) => {
      const e = cur(identity);
      e.count = Math.max(0, e.count - 1);
    },
    used: (identity) => cur(identity).count,
  };
}

/* ───────────────────────────── the request gate ──────────────────────────────
 * The limiter above answers "may this identity go?"; the GATE is what a request
 * actually calls. It exists because the durable backing is asynchronous and,
 * more importantly, because "check then increment" is a RACE across instances:
 * two instances can both read `limit-1` and both charge. So the gate's primitive
 * is `consume` — ONE atomic charge-and-check — with `refund` for the request
 * that never reached the provider (so a failed call still costs nothing, exactly
 * as the pre-durable `record`-only-on-success flow behaved).
 */

/** Honest message when the durable counter is configured but unreachable. */
export const FREE_TIER_LIMIT_UNAVAILABLE_MSG =
  "The free tier's daily usage counter is unavailable right now, so free requests are paused rather than run uncounted — add your own API key in Settings to keep working (BYO keys are never capped), or try again shortly.";

/** Why a {@link DailyGate.consume} was refused. */
export type DailyGateDenial = 'over-limit' | 'store-unavailable';

export interface DailyGateResult {
  /** True ⇒ one call has been CHARGED and the request may proceed. */
  allowed: boolean;
  /** Calls used today AFTER this decision (`-1` when the count is unknown). */
  used: number;
  /** Set only when `allowed` is false. */
  reason?: DailyGateDenial;
}

export interface DailyGate {
  /** The configured cap. */
  readonly limit: number;
  /** Atomically charge one call for `identity` today, or refuse with a reason. */
  consume(identity: string): Promise<DailyGateResult>;
  /** Give back a charge whose request never reached the provider. Best-effort. */
  refund(identity: string): Promise<void>;
  /** Calls used today by `identity`. Rejects if a configured durable store fails. */
  used(identity: string): Promise<number>;
}

/**
 * The NO-store gate: the in-memory {@link DailyLimiter}, wrapped in the async
 * gate shape. Semantics are exactly today's — a denied or failed request costs
 * nothing, a successful one costs one — so local / single-instance / no-DB
 * behaviour is unchanged.
 */
export function createInMemoryDailyGate(
  limit: number,
  now: () => Date = () => new Date()
): DailyGate {
  const limiter = createDailyLimiter(limit, now);
  return {
    limit,
    async consume(identity) {
      if (!limiter.allow(identity)) {
        return { allowed: false, used: limiter.used(identity), reason: 'over-limit' };
      }
      limiter.record(identity);
      return { allowed: true, used: limiter.used(identity) };
    },
    async refund(identity) {
      limiter.release(identity);
    },
    async used(identity) {
      return limiter.used(identity);
    },
  };
}

/** How many days of counter rows to keep before pruning (bounded table growth). */
export const DAILY_USAGE_RETENTION_DAYS = 7;

/** The `YYYY-MM-DD` bucket `days` before `day` (UTC, no local-time drift). */
export function dayUtcMinus(day: string, days: number): string {
  return currentDayUtc(new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000));
}

export interface DurableDailyGateOptions {
  limit: number;
  store: DailyUsageStore;
  /** Injectable clock — the SAME UTC day boundary as the in-memory limiter. */
  now?: () => Date;
  /** Where store failures are reported. Never receives a key or connection string. */
  logger?: (message: string) => void;
  /** Days of history to keep. Defaults to {@link DAILY_USAGE_RETENTION_DAYS}. */
  retentionDays?: number;
}

/**
 * The DURABLE gate: one shared cap across every instance, surviving restarts.
 *
 * ── Failure posture: FAIL CLOSED (deny), honestly ────────────────────────────
 * If the store is configured but a counter query FAILS we do NOT fall back to an
 * in-memory count. A per-instance memory count during a DB outage is a permissive
 * count — it forgets everything the user already spent and hands every instance a
 * fresh full cap, which is precisely the uncapped spend this limiter exists to
 * prevent (an outage would become the cheapest way to blow the budget). So a
 * store error denies the FREE default with {@link FREE_TIER_LIMIT_UNAVAILABLE_MSG}.
 * This is not a wall: BYO-key mode is never metered or capped and is named in the
 * message, and everything local-first keeps working — only the owner-funded free
 * model pauses, which is the one thing that costs money. Errors are logged by
 * NAME/CODE only; the connection string and any key never touch a log line.
 */
export function createDurableDailyGate(opts: DurableDailyGateOptions): DailyGate {
  const { limit, store } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.logger ?? ((message: string) => console.error(message));
  const retentionDays = opts.retentionDays ?? DAILY_USAGE_RETENTION_DAYS;

  /** Describe a failure WITHOUT echoing anything that could carry a secret. */
  const describe = (err: unknown): string => {
    const e = err as { name?: unknown; code?: unknown } | null;
    const name = e && typeof e.name === 'string' ? e.name : 'Error';
    const code = e && (typeof e.code === 'string' || typeof e.code === 'number') ? String(e.code) : 'none';
    return `${name} (code=${code})`;
  };

  // Prune at most once per process per UTC day: one DELETE of whole stale days.
  let prunedDay: string | undefined;
  function maybePrune(day: string): void {
    if (prunedDay === day) return;
    prunedDay = day;
    void store.prune(dayUtcMinus(day, retentionDays)).catch((err) => {
      log(`[freeTierLimit] daily-usage prune failed: ${describe(err)}`);
    });
  }

  return {
    limit,
    async consume(identity) {
      const day = currentDayUtc(now());
      // A cap of 0 disables the free default outright — never touch the DB for it.
      if (limit <= 0) return { allowed: false, used: 0, reason: 'over-limit' };
      let used: number;
      try {
        used = await store.charge(identity, day);
      } catch (err) {
        log(`[freeTierLimit] durable daily counter unavailable: ${describe(err)}`);
        return { allowed: false, used: -1, reason: 'store-unavailable' };
      }
      maybePrune(day);
      if (used > limit) {
        // The charge overshot the cap: give it straight back so a user hammering
        // a closed door cannot inflate the row, and refuse.
        try {
          await store.refund(identity, day);
        } catch (err) {
          log(`[freeTierLimit] daily counter refund failed: ${describe(err)}`);
        }
        return { allowed: false, used: used - 1, reason: 'over-limit' };
      }
      return { allowed: true, used };
    },
    async refund(identity) {
      const day = currentDayUtc(now());
      try {
        await store.refund(identity, day);
      } catch (err) {
        // Losing a refund over-counts the user by one — the SAFE direction (it can
        // never exceed the ceiling), so this is logged, never thrown at the user.
        log(`[freeTierLimit] daily counter refund failed: ${describe(err)}`);
      }
    },
    async used(identity) {
      return store.used(identity, currentDayUtc(now()));
    },
  };
}
