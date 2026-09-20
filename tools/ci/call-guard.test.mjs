import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import {
  CALL_TIMEOUT_MS,
  CallTimeoutError,
  SERVER_TIMEOUT_MS,
  StalledRuntimeError,
  makeCallGuard,
  withDeadline,
} from '../bench/lib/call-guard.mjs';

/**
 * THE CALL GUARD'S PLANTED CASES.
 *
 * Every one runs in milliseconds with an injected timer. A case that waited
 * ninety real seconds to prove a ninety-second cap is a case that gets skipped,
 * and a skipped case is not a gate.
 */
const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
/** A timer that fires immediately, so "the deadline wins" is deterministic. */
const instant = () => new Promise((r) => setTimeout(r, 1));
const never = () => new Promise(() => {});

test('the cap is below the server deadline — the defect that cost seven requests', () => {
  /*
   * THE WHOLE BUG IN ONE ASSERTION. The bench's deadline was 600_000 against a
   * server that gave up at ~300_000, so the client deadline could never fire and
   * every hang cost the full five minutes. A cap above the server's is not a cap.
   */
  assert.ok(
    CALL_TIMEOUT_MS < SERVER_TIMEOUT_MS,
    `the client cap ${CALL_TIMEOUT_MS} must be below the server's ${SERVER_TIMEOUT_MS}`,
  );
  assert.ok(CALL_TIMEOUT_MS <= 90_000, 'a hung call must cost about a minute, not five');
});

test('teach-eval asks for the cap rather than the old ten minutes', () => {
  /*
   * Source-scanned, because the constant being right is worthless if the bench
   * still passes 600_000 to the provider. This is the line that actually spends
   * the card.
   */
  const src = fs.readFileSync(path.join(REPO, 'tools', 'bench', 'teach-eval.mjs'), 'utf8');
  assert.ok(!/600_000/.test(src), 'the ten-minute default must be gone from teach-eval');
  assert.match(src, /CALL_TIMEOUT_MS/, 'teach-eval must take its deadline from the guard');
});

test('a hung call is cut by the deadline and does not wait for the call to settle', async () => {
  const started = Date.now();
  await assert.rejects(
    () => withDeadline(never, 5, 'hung', instant),
    (e) => e instanceof CallTimeoutError && e.timedOut === true,
  );
  /* It returned while the call was still hanging — the point of the guard. */
  assert.ok(Date.now() - started < 2_000, 'the guard returned without awaiting the hung call');
});

test('a call that beats the deadline returns its value untouched', async () => {
  const v = await withDeadline(async () => 'answer', 50, 'fast');
  assert.strictEqual(v, 'answer');
});

test('a real error is not swallowed as a timeout, and is not retried', async () => {
  /*
   * Retrying a 400 is card time spent on a question the server has already
   * decided. Only a TIMEOUT earns the retry.
   */
  let calls = 0;
  const guard = makeCallGuard({ timeoutMs: 5, timer: instant });
  await assert.rejects(
    () =>
      guard.run(async () => {
        calls += 1;
        throw new Error('400 bad request');
      }, 'bad'),
    /400 bad request/,
  );
  assert.strictEqual(calls, 1, 'a real error is not retried');
  assert.strictEqual(guard.consecutive, 0, 'and it is not counted as a stall');
});

test('one retry: a call that hangs once then answers succeeds', async () => {
  let attempt = 0;
  const guard = makeCallGuard({ timeoutMs: 5, timer: instant });
  const v = await guard.run(() => {
    attempt += 1;
    return attempt === 1 ? never() : Promise.resolve('second time');
  }, 'flaky');
  assert.strictEqual(v, 'second time');
  assert.strictEqual(attempt, 2, 'exactly one retry');
  assert.strictEqual(guard.consecutive, 0, 'a success clears the counter');
});

test('two consecutive failed calls end the run instead of grinding on the card', async () => {
  const guard = makeCallGuard({ timeoutMs: 5, timer: instant });
  /* First failed call: reported, run continues. */
  await assert.rejects(() => guard.run(never, 'one'), (e) => e.timedOut === true);
  assert.strictEqual(guard.consecutive, 1);
  /* Second in a row: the runtime has stopped answering. */
  await assert.rejects(
    () => guard.run(never, 'two'),
    (e) => e instanceof StalledRuntimeError && /2 consecutive/.test(e.message),
  );
  /* Four timeouts across two calls, each named — the report can list them. */
  assert.strictEqual(guard.timeline.length, 4);
  assert.deepStrictEqual(
    guard.timeline.map((t) => t.label),
    ['one', 'one', 'two', 'two'],
  );
});

test('a success between two failures resets the counter — consecutive means consecutive', async () => {
  /*
   * THE HALF THAT PROVES THE OTHER HALF. Without this the guard would be a
   * flakiness detector that ends a healthy run after two unlucky calls an hour
   * apart. Two hangs around a working call is a runtime that is answering.
   */
  const guard = makeCallGuard({ timeoutMs: 5, timer: instant });
  await assert.rejects(() => guard.run(never, 'a'), (e) => e.timedOut === true);
  await guard.run(async () => 'fine', 'b');
  assert.strictEqual(guard.consecutive, 0);
  /* So the next failure is the FIRST again, not the second — no stall. */
  await assert.rejects(
    () => guard.run(never, 'c'),
    (e) => e.timedOut === true && !(e instanceof StalledRuntimeError),
  );
});
