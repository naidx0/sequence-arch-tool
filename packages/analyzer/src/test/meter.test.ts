import assert from 'node:assert';
import { test } from 'node:test';
import {
  decide,
  normalizeUsage,
  recordUse,
  currentMonthYear,
  DEFAULT_METER_POLICY,
  EST_COST_PER_CALL,
  type MeterPolicy,
  type MeterUsage,
} from '../server/meter.js';

/**
 * Pure, deterministic locks for the FREE metered default's meter (v9 Phase 2).
 * The load-bearing property: the soft cap is a NUDGE, never a hard block — only
 * the global spend backstop ever returns allow:false. Plus a month-rollover
 * reset and the record/increment math.
 */

const POLICY: MeterPolicy = { monthlyAllotment: 100, globalSpendBackstop: 50 };

function usage(used: number, spend = 0, monthYear = '2026-07'): MeterUsage {
  return { usedThisMonth: used, monthYear, globalSpendToDate: spend };
}

test('decide: below the monthly allotment → ok, with remaining', () => {
  const d = decide(usage(10), POLICY);
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.reason, 'ok');
  assert.strictEqual(d.remaining, 90);
});

test('decide: AT the monthly allotment → soft-cap, but STILL allow:true (a nudge, not a wall)', () => {
  const d = decide(usage(100), POLICY);
  assert.strictEqual(d.allow, true, 'the soft cap must NOT hard-block');
  assert.strictEqual(d.reason, 'soft-cap');
  assert.strictEqual(d.remaining, 0);
});

test('decide: ABOVE the monthly allotment → soft-cap is not a hard block (still allow:true)', () => {
  const d = decide(usage(250), POLICY);
  assert.strictEqual(d.allow, true, 'far past the allotment is still allowed until the backstop');
  assert.strictEqual(d.reason, 'soft-cap');
  assert.strictEqual(d.remaining, 0);
});

test('decide: at/over the global spend backstop → allow:false, backstop (the ONLY hard block)', () => {
  const atBackstop = decide(usage(5, 50), POLICY);
  assert.strictEqual(atBackstop.allow, false);
  assert.strictEqual(atBackstop.reason, 'backstop');

  const overBackstop = decide(usage(5, 73.2), POLICY);
  assert.strictEqual(overBackstop.allow, false);
  assert.strictEqual(overBackstop.reason, 'backstop');
});

test('decide: backstop takes precedence over the soft cap when both are exceeded', () => {
  const d = decide(usage(300, 90), POLICY);
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'backstop');
});

test('normalizeUsage: a month rollover resets usedThisMonth (cumulative spend PERSISTS)', () => {
  const prior: MeterUsage = { usedThisMonth: 88, monthYear: '2026-06', globalSpendToDate: 12.5 };
  const rolled = normalizeUsage(prior, '2026-07');
  assert.strictEqual(rolled.usedThisMonth, 0, 'new month zeroes the monthly counter');
  assert.strictEqual(rolled.monthYear, '2026-07');
  assert.strictEqual(rolled.globalSpendToDate, 12.5, 'the backstop axis is all-time, not monthly');
});

test('normalizeUsage: same month is preserved; missing/garbage yields a fresh zeroed record', () => {
  const same = normalizeUsage({ usedThisMonth: 7, monthYear: '2026-07', globalSpendToDate: 1 }, '2026-07');
  assert.strictEqual(same.usedThisMonth, 7);
  const fresh = normalizeUsage(undefined, '2026-07');
  assert.deepStrictEqual(fresh, { usedThisMonth: 0, monthYear: '2026-07', globalSpendToDate: 0 });
});

test('recordUse: increments the monthly counter by 1 and advances cumulative spend', () => {
  const next = recordUse(usage(4, 1.0), '2026-07');
  assert.strictEqual(next.usedThisMonth, 5);
  assert.ok(Math.abs(next.globalSpendToDate - (1.0 + EST_COST_PER_CALL)) < 1e-9);
});

test('recordUse: across a month boundary charges into the NEW month from zero', () => {
  const next = recordUse({ usedThisMonth: 99, monthYear: '2026-06', globalSpendToDate: 2 }, '2026-07');
  assert.strictEqual(next.usedThisMonth, 1, 'first call of the new month');
  assert.ok(next.globalSpendToDate > 2, 'spend still accumulates across months');
});

test('currentMonthYear: YYYY-MM in UTC', () => {
  assert.strictEqual(currentMonthYear(new Date('2026-07-15T00:00:00Z')), '2026-07');
  assert.strictEqual(currentMonthYear(new Date('2026-01-01T00:00:00Z')), '2026-01');
});

test('DEFAULT_METER_POLICY is generous (no gate wall) with a spend backstop', () => {
  assert.ok(DEFAULT_METER_POLICY.monthlyAllotment >= 50);
  assert.ok(DEFAULT_METER_POLICY.globalSpendBackstop > 0);
});
