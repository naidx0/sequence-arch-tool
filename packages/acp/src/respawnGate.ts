/**
 * THE RESPAWN GATE (round 7, A1).
 *
 * Jaden saw the installed app "infinitely opening and closing different
 * terminals". Part of that was a window per spawn (fixed with windowsHide);
 * part was that a failing agent was started again by every caller that wanted
 * something from it: each model-menu open, each composer mount asked for the
 * agent's capabilities, and a failed answer cached nothing, so the next ask
 * spawned the agent again, with no wait and no end.
 *
 * The gate sits in front of any automatic start of an agent process. After a
 * failure the next automatic start waits `baseMs`, doubling to `maxMs`; after
 * `cap` failures in a row it stops starting the agent at all and answers with
 * the last error until a person asks again (`reset`, a Retry button). A
 * success clears the record.
 */

export interface RespawnGateOptions {
  /** Wait after the first failure (default 2 s), doubled per failure. */
  baseMs?: number;
  /** The longest wait (default 60 s). */
  maxMs?: number;
  /** Failures in a row before the gate stops starting it (default 3). */
  cap?: number;
  /** Test seam. */
  now?: () => number;
}

export type RespawnVerdict =
  | { allowed: true }
  | { allowed: false; gaveUp: boolean; retryInMs: number; failures: number; lastError: string };

export interface RespawnGate {
  /** May the agent be started automatically now? */
  check(key: string): RespawnVerdict;
  /** A start (or what it was for) failed. */
  fail(key: string, error: unknown): void;
  /** It worked: forget the failures. */
  succeed(key: string): void;
  /** A person asked again: the next start goes ahead and the count restarts. */
  reset(key: string): void;
}

export function createRespawnGate(opts: RespawnGateOptions = {}): RespawnGate {
  const baseMs = opts.baseMs ?? 2000;
  const maxMs = opts.maxMs ?? 60_000;
  const cap = Math.max(1, opts.cap ?? 3);
  const now = opts.now ?? Date.now;
  const records = new Map<string, { failures: number; at: number; lastError: string }>();

  return {
    check(key) {
      const r = records.get(key);
      if (!r) return { allowed: true };
      if (r.failures >= cap) return { allowed: false, gaveUp: true, retryInMs: 0, failures: r.failures, lastError: r.lastError };
      const wait = Math.min(maxMs, baseMs * 2 ** (r.failures - 1));
      const left = r.at + wait - now();
      if (left <= 0) return { allowed: true };
      return { allowed: false, gaveUp: false, retryInMs: left, failures: r.failures, lastError: r.lastError };
    },
    fail(key, error) {
      const prev = records.get(key);
      const lastError = error instanceof Error ? error.message : String(error);
      records.set(key, { failures: (prev?.failures ?? 0) + 1, at: now(), lastError });
    },
    succeed(key) {
      records.delete(key);
    },
    reset(key) {
      records.delete(key);
    },
  };
}
