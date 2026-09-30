import assert from 'node:assert';
import { test } from 'node:test';
import {
  createDailyLimiter,
  createInMemoryDailyGate,
  createDurableDailyGate,
  dayUtcMinus,
  DAILY_USAGE_RETENTION_DAYS,
  FREE_TIER_LIMIT_UNAVAILABLE_MSG,
} from '../server/freeTierLimit.js';
import { createPgDailyUsageStore, type PgQuery, type PgQueryResult } from '../server/pgStore.js';

/**
 * DURABLE per-user DAILY free-tier cap.
 *
 * The gap this locks: the daily cap was an IN-MEMORY, PER-INSTANCE map. On the
 * hosted deploy that means (1) with N instances behind a load balancer the
 * effective cap is N× the intended one, and (2) every restart/redeploy zeroes
 * everyone — i.e. the ≈$0.25/day/user ceiling was unenforceable in exactly the
 * configuration it exists for. With DATABASE_URL set the counter now lives in
 * Postgres (`user_daily_usage`), charged by ONE atomic
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` so a read-then-write race
 * cannot hand two instances the same last slot.
 *
 * Same harness style as pg-store.test.ts: an INJECTED in-memory fake `PgQuery`
 * — no live Postgres, no `pg` driver import.
 */

interface Call {
  text: string;
  params: unknown[];
}

/** An in-memory stand-in for `user_daily_usage`, honoring the real SQL semantics. */
function makeFakeDailyDb(): {
  table: Map<string, number>;
  calls: Call[];
  query: PgQuery;
  fail: { on: boolean };
} {
  const table = new Map<string, number>();
  const calls: Call[] = [];
  const fail = { on: false };
  const key = (user: unknown, day: unknown) => `${String(user)}\u0000${String(day)}`;
  const query: PgQuery = async (text, params = []): Promise<PgQueryResult> => {
    calls.push({ text, params });
    if (fail.on) {
      // Shaped like a real pg connection failure — including a `message` that
      // carries host/credentials, so the "never log a connection string" rule
      // is exercised against a realistic error, not a bland one.
      const err = Object.assign(
        new Error('connect ECONNREFUSED postgres://user:hunter2@db.internal:5432/sequence'),
        { code: 'ECONNREFUSED' }
      );
      throw err;
    }
    if (/^\s*INSERT INTO user_daily_usage/i.test(text)) {
      const k = key(params[0], params[1]);
      const next = (table.get(k) ?? 0) + 1;
      table.set(k, next);
      return { rows: [{ used_count: next }] };
    }
    if (/^\s*UPDATE user_daily_usage/i.test(text)) {
      const k = key(params[0], params[1]);
      const next = Math.max(0, (table.get(k) ?? 0) - 1);
      table.set(k, next);
      return { rows: [{ used_count: next }] };
    }
    if (/^\s*SELECT used_count/i.test(text)) {
      const k = key(params[0], params[1]);
      return table.has(k) ? { rows: [{ used_count: table.get(k) }] } : { rows: [] };
    }
    if (/^\s*DELETE FROM user_daily_usage/i.test(text)) {
      const cutoff = String(params[0]);
      for (const k of [...table.keys()]) {
        if (k.split('\u0000')[1] < cutoff) table.delete(k);
      }
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { table, calls, query, fail };
}

const silent = () => {};

/** (a) THE MULTI-INSTANCE BUG: N instances, ONE shared cap. */
test('durable daily cap: two independent limiter instances sharing one store enforce ONE cap', async () => {
  const db = makeFakeDailyDb();
  const day = new Date('2026-07-31T10:00:00Z');
  const mk = () =>
    createDurableDailyGate({
      limit: 3,
      store: createPgDailyUsageStore({ query: db.query }),
      now: () => day,
      logger: silent,
    });
  // Two SEPARATE gates = two app instances behind the load balancer. Nothing is
  // shared in process; only the database is.
  const instanceA = mk();
  const instanceB = mk();

  assert.strictEqual((await instanceA.consume('github:1')).allowed, true);
  assert.strictEqual((await instanceB.consume('github:1')).allowed, true);
  const third = await instanceA.consume('github:1');
  assert.strictEqual(third.allowed, true);
  assert.strictEqual(third.used, 3, 'the third charge is the cap, counted across BOTH instances');

  // The 4th call must be refused NO MATTER which instance receives it — this is
  // the assertion the pre-fix in-memory limiter cannot satisfy (each instance
  // would have counted only its own 1-2 calls and let this through).
  for (const instance of [instanceA, instanceB]) {
    const over = await instance.consume('github:1');
    assert.strictEqual(over.allowed, false);
    assert.strictEqual(over.reason, 'over-limit');
  }
  assert.strictEqual(await instanceB.used('github:1'), 3, 'a refused call does not inflate the row');

  // Contrast: the pre-fix construction (per-instance memory) gives 2× the cap.
  const memA = createInMemoryDailyGate(3, () => day);
  const memB = createInMemoryDailyGate(3, () => day);
  let allowedAcrossTwoInstances = 0;
  for (let i = 0; i < 4; i += 1) {
    if ((await memA.consume('github:1')).allowed) allowedAcrossTwoInstances += 1;
    if ((await memB.consume('github:1')).allowed) allowedAcrossTwoInstances += 1;
  }
  assert.strictEqual(allowedAcrossTwoInstances, 6, 'per-instance memory = N× the intended cap');

  // A different identity is still independent.
  assert.strictEqual((await instanceA.consume('github:2')).allowed, true);
});

/** (b) restart/redeploy does not zero the count. */
test('durable daily cap: a restarted instance does not reset a user count', async () => {
  const db = makeFakeDailyDb();
  const day = new Date('2026-07-31T23:59:00Z');
  const mk = () =>
    createDurableDailyGate({
      limit: 2,
      store: createPgDailyUsageStore({ query: db.query }),
      now: () => day,
      logger: silent,
    });

  const before = mk();
  assert.strictEqual((await before.consume('github:1')).allowed, true);
  assert.strictEqual((await before.consume('github:1')).allowed, true);

  // Redeploy: a brand-new process with an empty heap, same database.
  const afterRestart = mk();
  assert.strictEqual(await afterRestart.used('github:1'), 2, 'the count survived the restart');
  const over = await afterRestart.consume('github:1');
  assert.strictEqual(over.allowed, false);
  assert.strictEqual(over.reason, 'over-limit');
});

/** (c) no store configured ⇒ today's in-memory behavior, unchanged. */
test('no durable store: the in-memory gate behaves exactly as createDailyLimiter does today', async () => {
  let day = new Date('2026-07-31T12:00:00Z');
  const now = () => day;
  const gate = createInMemoryDailyGate(2, now);
  const limiter = createDailyLimiter(2, now); // today's code, side by side

  assert.strictEqual((await gate.consume('a')).allowed, limiter.allow('a'));
  limiter.record('a');
  assert.strictEqual((await gate.consume('a')).allowed, true);
  limiter.record('a');
  assert.strictEqual((await gate.consume('a')).allowed, false, 'a is over the cap');
  assert.strictEqual(limiter.allow('a'), false);
  assert.strictEqual((await gate.consume('b')).allowed, true, 'b is independent');
  assert.strictEqual(await gate.used('a'), limiter.used('a'));

  // A failed request costs nothing — the pre-durable "record only on success" rule.
  await gate.refund('b');
  assert.strictEqual(await gate.used('b'), 0);

  // UTC day rollover resets, same boundary as before.
  day = new Date('2026-08-01T00:00:00Z');
  assert.strictEqual(await gate.used('a'), 0);
  assert.strictEqual((await gate.consume('a')).allowed, true);
});

/** (d) store configured but FAILING ⇒ fail closed, honestly — never a permissive fallback. */
test('durable daily cap: a store failure DENIES with an honest message and never leaks a connection string', async () => {
  const db = makeFakeDailyDb();
  const logs: string[] = [];
  const gate = createDurableDailyGate({
    limit: 100,
    store: createPgDailyUsageStore({ query: db.query }),
    now: () => new Date('2026-07-31T10:00:00Z'),
    logger: (m) => logs.push(m),
  });

  assert.strictEqual((await gate.consume('github:1')).allowed, true);

  db.fail.on = true;
  const denied = await gate.consume('github:1');
  assert.strictEqual(denied.allowed, false, 'a DB outage must NOT fall through to a permissive count');
  assert.strictEqual(denied.reason, 'store-unavailable');
  assert.strictEqual(denied.used, -1, 'the count is honestly reported as unknown');

  // Repeated attempts stay denied — an outage can never become free uncapped spend.
  for (let i = 0; i < 200; i += 1) {
    assert.strictEqual((await gate.consume('github:1')).allowed, false);
  }

  // The honest, actionable message the server surfaces (503, not a fake 429).
  assert.match(FREE_TIER_LIMIT_UNAVAILABLE_MSG, /unavailable/i);
  assert.match(FREE_TIER_LIMIT_UNAVAILABLE_MSG, /API key/i);

  // No log line carries the connection string, its password, or its host.
  assert.ok(logs.length > 0, 'the failure is reported, not swallowed');
  for (const line of logs) {
    assert.doesNotMatch(line, /postgres:\/\//);
    assert.doesNotMatch(line, /hunter2/);
    assert.doesNotMatch(line, /db\.internal/);
    assert.match(line, /ECONNREFUSED/, 'the code IS reported, so the outage is diagnosable');
  }

  // Recovery: once the store answers again the exact stored count resumes.
  db.fail.on = false;
  const back = await gate.consume('github:1');
  assert.strictEqual(back.allowed, true);
  assert.strictEqual(back.used, 2, 'the durable count resumed where it left off');
});

/** (e) a new UTC day resets the count — same boundary as the in-memory limiter. */
test('durable daily cap: a new UTC day resets the count (and prunes stale days)', async () => {
  const db = makeFakeDailyDb();
  let clock = new Date('2026-07-31T23:59:59Z');
  const gate = createDurableDailyGate({
    limit: 1,
    store: createPgDailyUsageStore({ query: db.query }),
    now: () => clock,
    logger: silent,
    retentionDays: 2,
  });

  assert.strictEqual((await gate.consume('github:1')).allowed, true);
  assert.strictEqual((await gate.consume('github:1')).allowed, false, 'capped for 2026-07-31');

  // One second later it is a new UTC day.
  clock = new Date('2026-08-01T00:00:00Z');
  assert.strictEqual(await gate.used('github:1'), 0, 'the new UTC day starts at zero');
  const fresh = await gate.consume('github:1');
  assert.strictEqual(fresh.allowed, true);
  assert.strictEqual(fresh.used, 1);

  // The rows are per (user, day) — yesterday's row is untouched by today's charge.
  assert.strictEqual(db.table.get('github:1\u00002026-07-31'), 1);
  assert.strictEqual(db.table.get('github:1\u00002026-08-01'), 1);

  // Pruning ran once for each UTC day seen, with a cutoff `retentionDays` back.
  const deletes = db.calls.filter((c) => /^\s*DELETE FROM user_daily_usage/i.test(c.text));
  assert.deepStrictEqual(
    deletes.map((c) => c.params[0]),
    ['2026-07-29', '2026-07-30'],
    'one prune per UTC day, cutoff = day - retentionDays'
  );
});

/** Old days really do disappear, so the table cannot grow without bound. */
test('durable daily cap: prune deletes rows for days older than the retention cutoff', async () => {
  const db = makeFakeDailyDb();
  const store = createPgDailyUsageStore({ query: db.query });
  await store.charge('github:1', '2026-07-01');
  await store.charge('github:1', '2026-07-30');
  await store.prune(dayUtcMinus('2026-07-31', DAILY_USAGE_RETENTION_DAYS));
  assert.strictEqual(db.table.has('github:1\u00002026-07-01'), false, 'a stale day is pruned');
  assert.strictEqual(db.table.get('github:1\u00002026-07-30'), 1, 'a recent day is kept');
  assert.strictEqual(dayUtcMinus('2026-01-01', 1), '2025-12-31', 'the cutoff walks UTC calendars');
});

/** The charge is ONE atomic statement — a read-then-write would race across instances. */
test('durable daily cap: a charge is a single atomic increment-and-return, not a read-then-write', async () => {
  const db = makeFakeDailyDb();
  const gate = createDurableDailyGate({
    limit: 5,
    store: createPgDailyUsageStore({ query: db.query }),
    now: () => new Date('2026-07-31T10:00:00Z'),
    logger: silent,
  });
  await gate.consume('github:1');
  const charge = db.calls.find((c) => /INSERT INTO user_daily_usage/i.test(c.text));
  assert.ok(charge, 'the charge is an INSERT ... ON CONFLICT');
  assert.match(charge!.text, /ON CONFLICT \(user_id, day\) DO UPDATE SET used_count = user_daily_usage\.used_count \+ 1/i);
  assert.match(charge!.text, /RETURNING used_count/i);
  assert.deepStrictEqual(charge!.params, ['github:1', '2026-07-31']);
  assert.strictEqual(
    db.calls.filter((c) => /^\s*SELECT/i.test(c.text)).length,
    0,
    'no SELECT precedes the charge — nothing to race on'
  );

  // Concurrent charges (the load-balancer case) never hand out the same slot twice.
  const results = await Promise.all(
    Array.from({ length: 8 }, () => gate.consume('github:2'))
  );
  assert.strictEqual(results.filter((r) => r.allowed).length, 5, 'exactly the cap, under concurrency');
  assert.deepStrictEqual(
    results.filter((r) => r.allowed).map((r) => r.used).sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
    'every allowed charge got a DISTINCT slot number'
  );
});

/** A cap of 0 disables the free default outright, without touching the database. */
test('durable daily cap: FREE_TIER_DAILY_LIMIT=0 denies without a query', async () => {
  const db = makeFakeDailyDb();
  const gate = createDurableDailyGate({
    limit: 0,
    store: createPgDailyUsageStore({ query: db.query }),
    now: () => new Date('2026-07-31T10:00:00Z'),
    logger: silent,
  });
  const denied = await gate.consume('github:1');
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.reason, 'over-limit');
  assert.strictEqual(db.calls.length, 0, 'a disabled free tier never touches Postgres');
});
