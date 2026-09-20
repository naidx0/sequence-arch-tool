-- v12 Phase 3 — Postgres schema for the DEPLOYED per-user free tier.
--
-- Idempotent: safe to run on every deploy / boot (all statements are
-- CREATE ... IF NOT EXISTS). Applied by the app server when DATABASE_URL is set;
-- with DATABASE_URL unset none of this is touched and the local file store runs.
--
-- Split of metering (see docs/v12-plan.md): the PER-USER monthly soft cap lives
-- here (keyed by user_id, driven by the untouched meter.ts). The GLOBAL funded
-- spend backstop lives at the gateway, which holds the key. No double-counting.

-- Per-user metering row (the pgStore UsageStore reads/UPSERTs this).
-- Mirrors MeterUsage {usedThisMonth, monthYear, globalSpendToDate}, keyed by userId.
CREATE TABLE IF NOT EXISTS user_usage (
  user_id               text PRIMARY KEY,
  month_year            text NOT NULL,
  used_this_month       integer NOT NULL DEFAULT 0,
  global_spend_to_date  double precision NOT NULL DEFAULT 0
);

-- Per-user DAILY free-tier counter (the durable half of freeTierLimit.ts).
-- One row per (user_id, UTC day); `used_count` is incremented atomically by a
-- single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so N app instances
-- behind a load balancer share ONE cap instead of one cap each, and a restart
-- does not zero anyone. `day` is the UTC `YYYY-MM-DD` bucket (currentDayUtc) —
-- text, so the reset boundary is the app's, not the database server's timezone.
-- Rows older than the retention window are pruned by the app (see pgStore.ts).
CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id     text    NOT NULL,
  day         text    NOT NULL,
  used_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Authenticated users (populated by the OAuth callback in auth.ts/session.ts).
-- user_id is the stable identity string (e.g. `github:123`) also used as the
-- user_usage key, so metering joins cleanly to the account.
CREATE TABLE IF NOT EXISTS users (
  user_id      text PRIMARY KEY,
  provider     text,
  provider_id  text,
  email        text,
  name         text,
  created_at   timestamptz DEFAULT now()
);
