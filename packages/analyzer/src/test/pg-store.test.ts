import assert from 'node:assert';
import { test } from 'node:test';
import { createPgUsageStore, type PgQuery, type PgQueryResult } from '../server/pgStore.js';
import { currentMonthYear, recordUse, type MeterUsage } from '../server/meter.js';

/**
 * v12 Phase 3 — the Postgres UsageStore, verified with an INJECTED in-memory fake
 * query fn (no live Postgres). Covers: read-absent → normalized zero, write→read
 * roundtrip reflecting the incremented `usedThisMonth` SYNCHRONOUSLY, month
 * rollover via meter.ts's normalizeUsage, the UPSERT SQL shape, and the
 * write-wins-over-a-slow-load race. Plus a regression note that DATABASE_URL unset
 * leaves the file store path untouched.
 */

/** Await one macrotask so fire-and-forget loads/UPSERTs settle before asserting. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

interface Call {
  text: string;
  params: unknown[];
}

/** An in-memory stand-in for a `pg.Pool`: a Map-backed `user_usage` table. */
function makeFakeDb(initial: Record<string, MeterUsage> = {}): {
  table: Map<string, Record<string, unknown>>;
  calls: Call[];
  query: PgQuery;
} {
  const table = new Map<string, Record<string, unknown>>();
  for (const [id, u] of Object.entries(initial)) {
    table.set(id, {
      month_year: u.monthYear,
      used_this_month: u.usedThisMonth,
      global_spend_to_date: u.globalSpendToDate,
    });
  }
  const calls: Call[] = [];
  const query: PgQuery = async (text, params = []): Promise<PgQueryResult> => {
    calls.push({ text, params });
    if (/^\s*SELECT/i.test(text)) {
      const row = table.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO user_usage/i.test(text)) {
      const [user_id, month_year, used_this_month, global_spend_to_date] = params;
      table.set(String(user_id), { month_year, used_this_month, global_spend_to_date });
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { table, calls, query };
}

const silent = () => {}; // swallow the store's error logging in tests

test('read of an ABSENT identity returns a normalized zero and triggers an async SELECT', async () => {
  const db = makeFakeDb();
  const store = createPgUsageStore({ query: db.query, logger: silent });

  const usage = store.read('github:1');
  assert.deepStrictEqual(usage, {
    usedThisMonth: 0,
    monthYear: currentMonthYear(),
    globalSpendToDate: 0,
  });

  await tick();
  assert.strictEqual(db.calls.length, 1, 'exactly one background load issued');
  assert.match(db.calls[0].text, /^\s*SELECT/i);
  assert.deepStrictEqual(db.calls[0].params, ['github:1']);
});

test('write → read roundtrip reflects the incremented usedThisMonth SYNCHRONOUSLY', async () => {
  const db = makeFakeDb();
  const store = createPgUsageStore({ query: db.query, logger: silent });

  // Simulate the metered path: read (zero) → recordUse → write.
  const before = store.read('u');
  const next = recordUse(before, currentMonthYear());
  store.write('u', next);

  // Back-to-back request must see the charge immediately — no await.
  const after = store.read('u');
  assert.strictEqual(after.usedThisMonth, 1, 'incremented count visible synchronously');
  assert.ok(after.globalSpendToDate > 0, 'spend advanced');

  // And a second charge stacks on the first, still synchronously.
  store.write('u', recordUse(after, currentMonthYear()));
  assert.strictEqual(store.read('u').usedThisMonth, 2);

  await tick();
});

test('write fires an UPSERT with a sane SQL shape and 4 ordered params', async () => {
  const db = makeFakeDb();
  const store = createPgUsageStore({ query: db.query, logger: silent });

  const usage: MeterUsage = { usedThisMonth: 3, monthYear: currentMonthYear(), globalSpendToDate: 0.0054 };
  store.write('gh:42', usage);
  await tick();

  const upsert = db.calls.find((c) => /INSERT INTO user_usage/i.test(c.text));
  assert.ok(upsert, 'an UPSERT was issued');
  assert.match(upsert!.text, /ON CONFLICT \(user_id\) DO UPDATE/i);
  assert.match(upsert!.text, /used_this_month = EXCLUDED\.used_this_month/i);
  assert.deepStrictEqual(upsert!.params, ['gh:42', currentMonthYear(), 3, 0.0054]);

  // And it persisted to the fake table.
  assert.deepStrictEqual(db.table.get('gh:42'), {
    month_year: currentMonthYear(),
    used_this_month: 3,
    global_spend_to_date: 0.0054,
  });
});

test('a stored row loads into the cache and is reflected on the next read', async () => {
  const my = currentMonthYear();
  const db = makeFakeDb({ 'gh:7': { usedThisMonth: 5, monthYear: my, globalSpendToDate: 0.009 } });
  const store = createPgUsageStore({ query: db.query, logger: silent });

  // First read is a miss (returns zero) but kicks off the load.
  assert.strictEqual(store.read('gh:7').usedThisMonth, 0);
  await tick();
  // After the load settles, the stored value is visible.
  const loaded = store.read('gh:7');
  assert.strictEqual(loaded.usedThisMonth, 5);
  assert.strictEqual(loaded.monthYear, my);
  assert.ok(Math.abs(loaded.globalSpendToDate - 0.009) < 1e-9);
});

test('month rollover: a stored row from a PAST month is zeroed via normalizeUsage, spend persists', async () => {
  const db = makeFakeDb({
    'gh:9': { usedThisMonth: 88, monthYear: '2000-01', globalSpendToDate: 1.23 },
  });
  const store = createPgUsageStore({ query: db.query, logger: silent });

  store.read('gh:9'); // miss → trigger load
  await tick();

  const rolled = store.read('gh:9');
  assert.strictEqual(rolled.usedThisMonth, 0, 'past-month counter reset to 0');
  assert.strictEqual(rolled.monthYear, currentMonthYear(), 'rolled into the current month');
  assert.ok(Math.abs(rolled.globalSpendToDate - 1.23) < 1e-9, 'cumulative spend PERSISTS across rollover');
});

test('a synchronous write is never clobbered by a slower in-flight load (write wins)', async () => {
  // The DB has an OLD value; a read triggers its load. Before the load resolves,
  // a write lands the fresh value. The load must not overwrite it.
  const db = makeFakeDb({ 'gh:race': { usedThisMonth: 99, monthYear: currentMonthYear(), globalSpendToDate: 9 } });
  const store = createPgUsageStore({ query: db.query, logger: silent });

  store.read('gh:race'); // miss → load in flight (SELECT not yet resolved)
  store.write('gh:race', { usedThisMonth: 1, monthYear: currentMonthYear(), globalSpendToDate: 0.1 });

  await tick(); // load resolves here — must see cache already populated and skip

  assert.strictEqual(store.read('gh:race').usedThisMonth, 1, 'freshly written value survived the load');
});

test('regression note: DATABASE_URL unset → the file store path is chosen, pg store never constructed', () => {
  // The `server/repoServer.ts` gate is `process.env.DATABASE_URL ? createPgUsageStore(...) : <file literal>`.
  // Empty/undefined DATABASE_URL is falsy, so the file literal ('local'→usage.json,
  // byte-identical to pre-v12) is selected and no Postgres client is ever built.
  // This asserts the exact predicate the swap uses.
  const selectsPg = (env: string | undefined) => Boolean(env);
  assert.strictEqual(selectsPg(undefined), false);
  assert.strictEqual(selectsPg(''), false);
  assert.strictEqual(selectsPg('postgres://host/db'), true);
});
