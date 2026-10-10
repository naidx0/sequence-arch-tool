/**
 * Phase timers for the scanner — opt-in, zero-cost when off.
 *
 * H12 exists because "a large repo takes over fifteen minutes" was a wall-clock
 * observation with no breakdown behind it: nobody could say whether the cost was
 * the file walk, tree-sitter, call resolution, clustering or graph assembly, so
 * every proposed fix was a guess. This makes the question answerable in one run.
 *
 * Enabled ONLY when `SEQUENCE_SCAN_PROFILE` is set in the environment. When it
 * is not (every product run, every test), `phase()` is a straight call-through
 * and `bump()` does nothing, so instrumenting a hot loop cannot itself become
 * the cost it is measuring.
 */

const enabled = typeof process !== 'undefined' && !!process.env?.SEQUENCE_SCAN_PROFILE;

interface Bucket {
  ms: number;
  n: number;
}

const buckets = new Map<string, Bucket>();

export function profileEnabled(): boolean {
  return enabled;
}

/** Time a synchronous phase under `name`. Returns the body's own value. */
export function phase<T>(name: string, body: () => T): T {
  if (!enabled) return body();
  const t0 = performance.now();
  try {
    return body();
  } finally {
    bump(name, performance.now() - t0);
  }
}

/** Time an async phase under `name`. */
export async function phaseAsync<T>(name: string, body: () => Promise<T>): Promise<T> {
  if (!enabled) return body();
  const t0 = performance.now();
  try {
    return await body();
  } finally {
    bump(name, performance.now() - t0);
  }
}

/** Add `ms` to a bucket directly (for loops that time their own inner work). */
export function bump(name: string, ms: number): void {
  if (!enabled) return;
  const b = buckets.get(name);
  if (b) {
    b.ms += ms;
    b.n += 1;
  } else {
    buckets.set(name, { ms, n: 1 });
  }
}

/** Count an event without timing it (file counts, node counts, …). */
export function count(name: string, n = 1): void {
  if (!enabled) return;
  const b = buckets.get(name);
  if (b) b.n += n;
  else buckets.set(name, { ms: 0, n });
}

export function snapshot(): { name: string; ms: number; n: number }[] {
  return [...buckets.entries()]
    .map(([name, b]) => ({ name, ms: b.ms, n: b.n }))
    .sort((a, b) => b.ms - a.ms);
}

export function reset(): void {
  buckets.clear();
}

/** Human-readable table on stderr — never stdout, which carries scan output. */
export function report(label: string): void {
  if (!enabled) return;
  const rows = snapshot();
  const width = Math.max(...rows.map((r) => r.name.length), 12);
  process.stderr.write(`\n=== scan profile: ${label} ===\n`);
  for (const r of rows) {
    process.stderr.write(
      `${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(2).padStart(9)}s  n=${r.n}\n`
    );
  }
  process.stderr.write('\n');
}
