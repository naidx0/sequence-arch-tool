/**
 * v12 Phase 3 — the DEPLOYED per-user {@link UsageStore}, backed by Postgres.
 *
 * This is the swap-in for the LOCAL per-identity FILE store (repoServer.ts): same
 * `{read, write}` shape, keyed by the `identity` string (the userId, e.g.
 * `github:123`), constructed ONLY when `DATABASE_URL` is set. With it unset the
 * file store is used and local behaviour is byte-identical. meter.ts is untouched:
 * `normalizeUsage`/`currentMonthYear` are imported and applied here exactly as the
 * file store applies them, so month rollover + zeroing behave identically.
 *
 * ── The sync-contract problem, and how it's resolved ────────────────────────
 * The {@link UsageStore} interface is SYNCHRONOUS (`read`/`write` return values,
 * not Promises) because meter.ts's decide/recordUse pipeline in repoServer is
 * synchronous. Postgres is asynchronous. We reconcile the two with an
 * **async-write-through over a synchronous in-memory cache**:
 *
 *   • A `Map<identity, MeterUsage>` holds the authoritative in-process value.
 *   • `read(identity)` returns the cached value (re-normalized to the current
 *     month, so a rollover between load and read still zeroes correctly). On a
 *     cache MISS it returns a normalized-ZERO immediately and fires an async load
 *     that fills the cache from the DB row — but only if the identity is still
 *     absent when the load resolves, so a concurrent `write` always wins (never
 *     clobbered by a slower SELECT). No startup preload is required.
 *   • `write(identity, usage)` updates the cache SYNCHRONOUSLY (so a back-to-back
 *     metered request sees the just-incremented `usedThisMonth`) and fires an
 *     await-less UPSERT, logging — never throwing — on failure.
 *
 * This keeps meter.ts's synchronous contract intact while persisting durably:
 * the charge is reflected in-process at once and flushed to Postgres in the
 * background. A process restart re-loads each identity lazily from its row on the
 * first cache-miss read. (The tiny window where an in-flight UPSERT is lost to a
 * crash is acceptable for a soft usage counter; the authoritative money backstop
 * lives at the gateway, not here.)
 *
 * ── Testability ─────────────────────────────────────────────────────────────
 * The query executor is INJECTABLE (`opts.query`). Tests pass an in-memory fake
 * implementing `(text, params) => Promise<{rows}>`, so the whole read/write/
 * rollover/UPSERT surface is verified with NO live Postgres. The real path
 * lazy-connects a pooled `pg.Pool` from `connectionString` on first use.
 */

import { normalizeUsage, currentMonthYear, type MeterUsage } from './meter.js';

/** The minimal shape of a `pg` query result this store relies on. */
export interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}

/** The injectable query executor — matches `pg.Pool#query(text, params)`. */
export type PgQuery = (text: string, params?: unknown[]) => Promise<PgQueryResult>;

export interface PgUsageStoreOptions {
  /** `DATABASE_URL`. Used to lazy-connect a pooled client when `query` is absent. */
  connectionString?: string;
  /**
   * Injectable query executor. Tests pass an in-memory fake so no live Postgres
   * is required. When omitted, a `pg.Pool` is lazy-connected from
   * {@link connectionString} on the first query.
   */
  query?: PgQuery;
  /** Where async-write-through / load failures are reported. Defaults to `console.error`. */
  logger?: (message: string, err?: unknown) => void;
}

/** The single-row shape of `user_usage` (see schema.sql). */
const SELECT_SQL =
  'SELECT month_year, used_this_month, global_spend_to_date FROM user_usage WHERE user_id = $1';

/**
 * Idempotent per-user UPSERT. On a repeated `user_id` the whole row is replaced
 * with the latest counters — the caller always writes the fully-computed next
 * usage (from meter.ts's recordUse), so last-write-wins is correct.
 */
const UPSERT_SQL =
  'INSERT INTO user_usage (user_id, month_year, used_this_month, global_spend_to_date) ' +
  'VALUES ($1, $2, $3, $4) ' +
  'ON CONFLICT (user_id) DO UPDATE SET ' +
  'month_year = EXCLUDED.month_year, ' +
  'used_this_month = EXCLUDED.used_this_month, ' +
  'global_spend_to_date = EXCLUDED.global_spend_to_date';

/** Map a raw `user_usage` row to the partial usage `normalizeUsage` expects. */
function rowToUsage(row: Record<string, unknown> | undefined): Partial<MeterUsage> | undefined {
  if (!row) return undefined;
  const usedThisMonth = typeof row.used_this_month === 'number' ? row.used_this_month : Number(row.used_this_month);
  const globalSpendToDate =
    typeof row.global_spend_to_date === 'number' ? row.global_spend_to_date : Number(row.global_spend_to_date);
  return {
    monthYear: typeof row.month_year === 'string' ? row.month_year : undefined,
    usedThisMonth: Number.isFinite(usedThisMonth) ? usedThisMonth : 0,
    globalSpendToDate: Number.isFinite(globalSpendToDate) ? globalSpendToDate : 0,
  };
}

/**
 * Resolve the query executor for a store: the injected fake when tests supply
 * one, else a lazily-constructed pooled `pg.Pool` built from `connectionString`
 * on the FIRST query. Shared by the monthly {@link createPgUsageStore} and the
 * daily {@link createPgDailyUsageStore} so both stores speak to Postgres exactly
 * the same way (one style, not two).
 */
function resolveQuery(opts: PgUsageStoreOptions): PgQuery {
  if (opts.query) return opts.query;
  let pool: import('pg').Pool | undefined;
  return async (text, params) => {
    if (!pool) {
      const pg = await import('pg');
      // `pg` is CJS; the Pool constructor is on default or the namespace.
      const Pool = (pg as unknown as { Pool: typeof import('pg').Pool }).Pool ?? (pg as any).default?.Pool;
      pool = new Pool({ connectionString: opts.connectionString });
    }
    const result = await pool.query(text, params);
    return { rows: result.rows as Array<Record<string, unknown>> };
  };
}

/**
 * Build a Postgres-backed {@link import('./repoServer.js').UsageStore} — a
 * `{read, write}` pair with the sync-cache / async-write-through model documented
 * in this file's header.
 */
export function createPgUsageStore(opts: PgUsageStoreOptions): {
  read(identity: string): MeterUsage;
  write(identity: string, usage: MeterUsage): void;
} {
  const log = opts.logger ?? ((message: string, err?: unknown) => console.error(message, err));

  // Synchronous authoritative in-process view; the DB is the durable mirror.
  const cache = new Map<string, MeterUsage>();
  // Identities with an in-flight async load, so a cache-miss read never stacks
  // duplicate SELECTs for the same identity.
  const loading = new Set<string>();

  // Lazy pooled `pg` client. Only constructed the first time the REAL query path
  // runs (never when a `query` fake is injected, so tests import no live driver).
  const query: PgQuery = resolveQuery(opts);

  /** Fire an async load that fills the cache from the DB row — write always wins. */
  function loadInto(identity: string): void {
    if (loading.has(identity)) return;
    loading.add(identity);
    void (async () => {
      try {
        const result = await query(SELECT_SQL, [identity]);
        // A concurrent write may have populated the cache while the SELECT was in
        // flight; never clobber a fresher, synchronously-written value.
        if (!cache.has(identity)) {
          cache.set(identity, normalizeUsage(rowToUsage(result.rows[0]), currentMonthYear()));
        }
      } catch (err) {
        log(`[pgStore] load failed for identity=${identity}`, err);
      } finally {
        loading.delete(identity);
      }
    })();
  }

  /** Fire the await-less UPSERT; log (never throw) on failure. */
  function flush(identity: string, usage: MeterUsage): void {
    void query(UPSERT_SQL, [
      identity,
      usage.monthYear,
      usage.usedThisMonth,
      usage.globalSpendToDate,
    ]).catch((err) => log(`[pgStore] write-through failed for identity=${identity}`, err));
  }

  return {
    read(identity: string): MeterUsage {
      const my = currentMonthYear();
      const cached = cache.get(identity);
      if (cached) {
        // Re-normalize in case the month rolled over since it was cached.
        const normalized = normalizeUsage(cached, my);
        if (normalized !== cached) cache.set(identity, normalized);
        return normalized;
      }
      // Cache miss: return a normalized zero NOW (sync contract) and load in bg.
      loadInto(identity);
      return normalizeUsage(undefined, my);
    },
    write(identity: string, usage: MeterUsage): void {
      // Synchronous so a back-to-back metered request sees the incremented count.
      cache.set(identity, usage);
      flush(identity, usage);
    },
  };
}

/* ─────────────────────────── DAILY free-tier counter ────────────────────────
 * The per-user DAILY cap (freeTierLimit.ts) was in-memory/per-instance, which
 * on a multi-instance deploy multiplies the intended cap by the instance count
 * and zeroes every user on each restart/redeploy. This store is its durable
 * mirror, following the SAME conventions as the monthly store above: the same
 * injectable {@link PgQuery} executor (tests pass a fake — no live Postgres),
 * the same lazy pooled `pg` client, and a table in the same
 * `packages/analyzer/schema.sql`.
 *
 * The one deliberate difference: this store is ASYNC end-to-end and the charge
 * is a SINGLE atomic statement. A read-then-write ("SELECT count, then UPDATE")
 * races across instances — two instances can both read `limit-1` and both
 * write `limit`. `INSERT ... ON CONFLICT DO UPDATE SET used_count =
 * used_count + 1 RETURNING used_count` increments and reports the post-increment
 * value in one round trip, so N instances sharing one database enforce ONE cap.
 */

/** Atomic increment-and-report. The returned `used_count` INCLUDES this charge. */
const DAILY_CHARGE_SQL =
  'INSERT INTO user_daily_usage (user_id, day, used_count) VALUES ($1, $2, 1) ' +
  'ON CONFLICT (user_id, day) DO UPDATE SET used_count = user_daily_usage.used_count + 1 ' +
  'RETURNING used_count';

/** Give a charge back (request never reached the provider). Never goes below 0. */
const DAILY_REFUND_SQL =
  'UPDATE user_daily_usage SET used_count = GREATEST(used_count - 1, 0) ' +
  'WHERE user_id = $1 AND day = $2 RETURNING used_count';

/** Read-only view of today's count (diagnostics/tests; never gates a request). */
const DAILY_SELECT_SQL = 'SELECT used_count FROM user_daily_usage WHERE user_id = $1 AND day = $2';

/** Prune: whole days older than the retention cutoff. Keeps the table bounded. */
const DAILY_PRUNE_SQL = 'DELETE FROM user_daily_usage WHERE day < $1';

/**
 * The durable daily-counter seam. Deliberately tiny and async: every method is a
 * single SQL statement, and a FAILURE REJECTS rather than resolving to a
 * permissive value — the caller (freeTierLimit.ts) decides the safe posture.
 */
export interface DailyUsageStore {
  /** Atomically charge one call for `identity` on UTC `day`; resolves to the new count. */
  charge(identity: string, day: string): Promise<number>;
  /** Give one charge back; resolves to the count after the refund. */
  refund(identity: string, day: string): Promise<number>;
  /** Calls used by `identity` on `day` (0 when there is no row). */
  used(identity: string, day: string): Promise<number>;
  /** Delete every row for a day strictly BEFORE `cutoffDay` (`YYYY-MM-DD`). */
  prune(cutoffDay: string): Promise<void>;
}

/** Coerce a `used_count` cell (pg may hand back a string for some numerics). */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Build the Postgres-backed {@link DailyUsageStore} against `user_daily_usage`
 * (schema.sql). Same options object as {@link createPgUsageStore}: pass `query`
 * in tests, `connectionString` in production.
 */
export function createPgDailyUsageStore(opts: PgUsageStoreOptions): DailyUsageStore {
  const query = resolveQuery(opts);
  return {
    async charge(identity, day) {
      const result = await query(DAILY_CHARGE_SQL, [identity, day]);
      return toCount(result.rows[0]?.used_count);
    },
    async refund(identity, day) {
      const result = await query(DAILY_REFUND_SQL, [identity, day]);
      return toCount(result.rows[0]?.used_count);
    },
    async used(identity, day) {
      const result = await query(DAILY_SELECT_SQL, [identity, day]);
      return toCount(result.rows[0]?.used_count);
    },
    async prune(cutoffDay) {
      await query(DAILY_PRUNE_SQL, [cutoffDay]);
    },
  };
}
