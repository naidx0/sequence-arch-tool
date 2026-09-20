/**
 * A best-effort per-caller sliding-window rate limiter.
 *
 * In-memory and per-instance: it is an abuse speed-bump, NOT a distributed
 * quota. Behind multiple replicas each instance keeps its own window, so the
 * effective ceiling is `limit × replicas`. The authoritative money guard is the
 * global spend backstop (the store), not this.
 */

export interface RateLimiter {
  /** Record a hit for `key`; return `true` if allowed, `false` if over the window limit. */
  allow(key: string): boolean;
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  allow(key: string): boolean {
    if (this.limit <= 0) return true; // disabled
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
