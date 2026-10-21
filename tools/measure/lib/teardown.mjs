/* ══════════════════════════════════════════════════════════════════════════
   TEARDOWN THAT CANNOT TURN A GOOD MEASUREMENT RED
   tools/measure/lib/teardown.mjs

   On Windows a temp directory a browser or a child process just used can
   refuse removal for a moment (EBUSY, EPERM, ENOTEMPTY) after every handle
   is closed. Removing it is housekeeping: it retries with backoff, and if
   the directory still stays it warns loudly and goes on. A measurement
   failure is the only thing that fails the gate (exitCode).
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

export const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Remove dir, retrying on EBUSY/EPERM/ENOTEMPTY with doubling backoff.
 * Never throws. Returns { removed, attempts, code }.
 */
export async function removeDirPatiently(dir, { rm = fs.rmSync, retries = 8, delayMs = 200, sleep = sleepMs, warn = console.warn } = {}) {
  let code;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      rm(dir, { recursive: true, force: true });
      return { removed: true, attempts: attempt, code: undefined };
    } catch (e) {
      code = e?.code ?? String(e?.message ?? e);
      if (!RETRY_CODES.has(code)) {
        warn(`board-legibility: WARNING could not remove ${dir} (${code}); it was not retried. Remove it by hand.`);
        return { removed: false, attempts: attempt, code };
      }
      if (attempt <= retries) await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  warn(`board-legibility: WARNING could not remove ${dir} after ${retries + 1} tries (${code}). The measurements are valid; remove the directory by hand.`);
  return { removed: false, attempts: retries + 1, code };
}

/** The gate's exit code: red only when a measurement failed. Teardown never counts. */
export function exitCode({ failed }) {
  return failed ? 1 : 0;
}
