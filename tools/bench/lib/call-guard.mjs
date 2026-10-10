/**
 * THE CALL GUARD — a hung request costs the card a minute, not five.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────
 *
 * On the night of 2026-09-06 seven requests to the local runtime hung. Each
 * answered 500 after 5m03s, and the bench waited for every one of them, because
 * its own deadline was 600_000 ms — ABOVE the server's five minutes, so it could
 * never fire first. A client deadline above the server's is not a deadline; it
 * is a comment. Thirty-five minutes of a held GPU card bought nothing.
 *
 * Two rules, and they are separate:
 *
 *   1. NEVER WAIT LONGER THAN THE SERVER DOES. The cap is 90 s, well under the
 *      runtime's ~300 s, so a hang is cut by us and reported as a timeout rather
 *      than absorbed as a five-minute 500. One retry follows, because a single
 *      hung request is usually just a hung request.
 *   2. TWO CONSECUTIVE FAILED CALLS END THE RUN. One hang is noise; two in a row
 *      is a runtime that has stopped answering, and every further call is card
 *      time spent on nothing. The run fails loudly instead of grinding.
 *
 * A success between two failures RESETS the counter — "consecutive" is the whole
 * point. A run that fails on two failures spread across an hour would be a
 * flakiness detector, not a stall detector.
 *
 * ── TESTABLE WITHOUT A MODEL ─────────────────────────────────────────────
 *
 * Everything here is injectable: the deadline, and the timer that enforces it.
 * The planted cases in `tools/ci/call-guard.test.mjs` run in milliseconds, which
 * is the only way a timeout guard ever gets a locking test — a case that has to
 * wait ninety real seconds to prove a ninety-second cap is a case nobody runs.
 */

/** Well under the runtime's ~300 s, which is the entire point of the number. */
export const CALL_TIMEOUT_MS = 90_000;

/** The server deadline this must stay below. Named so the test can compare. */
export const SERVER_TIMEOUT_MS = 300_000;

export class StalledRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StalledRuntimeError';
    this.stalled = true;
  }
}

export class CallTimeoutError extends Error {
  constructor(ms, label) {
    super(`call ${label} exceeded ${ms} ms (the client cap, below the server's)`);
    this.name = 'CallTimeoutError';
    this.timedOut = true;
  }
}

/**
 * Race `fn()` against a deadline.
 *
 * The losing call is NOT awaited further — it is abandoned. A guard that waited
 * for the hung request to settle before reporting the timeout would wait exactly
 * as long as the thing it is guarding against, which is the defect this replaces.
 */
export async function withDeadline(fn, ms, label, timer) {
  const wait = timer ?? ((n) => new Promise((resolve) => setTimeout(resolve, n).unref?.()));
  let done = false;
  const result = Promise.resolve()
    .then(fn)
    .then((v) => {
      done = true;
      return { ok: true, value: v };
    })
    .catch((e) => {
      done = true;
      return { ok: false, error: e };
    });
  const deadline = wait(ms).then(() => ({ late: true }));
  const first = await Promise.race([result, deadline]);
  if (first.late === true && done === false) throw new CallTimeoutError(ms, label);
  const settled = await result;
  if (settled.ok) return settled.value;
  throw settled.error;
}

/**
 * A guard shared by every call in one run.
 *
 * `run(fn, label)` resolves with the call's value, or throws — `CallTimeoutError`
 * for a call that hung through its retry, `StalledRuntimeError` once two calls in
 * a row have failed that way. The caller does not decide when to give up; the
 * counter does, which is what makes it a rule rather than a habit.
 */
export function makeCallGuard(options = {}) {
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const maxConsecutive = options.maxConsecutive ?? 2;
  const timer = options.timer;
  const onEvent = options.onEvent ?? (() => {});
  let consecutive = 0;
  const timeline = [];

  return {
    get consecutive() {
      return consecutive;
    },
    /** Every timeout, with its label — so the report can name them. */
    get timeline() {
      return timeline.slice();
    },
    async run(fn, label = 'call') {
      let lastTimeout = null;
      /* One retry, and only for a TIMEOUT. A call that failed for a real
         reason — a 400, a bad key — is not retried: repeating a request the
         server has already judged is card time spent on a decided question. */
      for (let attempt = 0; attempt <= 1; attempt += 1) {
        try {
          const value = await withDeadline(fn, timeoutMs, label, timer);
          consecutive = 0;
          return value;
        } catch (e) {
          if (e?.timedOut !== true) throw e;
          lastTimeout = e;
          timeline.push({ label, attempt, ms: timeoutMs });
          onEvent({ kind: 'timeout', label, attempt });
        }
      }
      consecutive += 1;
      if (consecutive >= maxConsecutive) {
        throw new StalledRuntimeError(
          `${consecutive} consecutive calls timed out at ${timeoutMs} ms ` +
            `(last: ${label}). The runtime has stopped answering; the run is ending ` +
            `rather than spending the card on it.`,
        );
      }
      throw lastTimeout;
    },
  };
}
