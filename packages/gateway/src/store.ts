/**
 * The authoritative global-spend store — an injectable seam so tests use an
 * in-memory fake and production uses a durable backend.
 *
 * The interface is deliberately tiny: `read(monthYear)` returns the running USD
 * spend for that month bucket, `add(monthYear, usd)` increments it. It is the
 * gateway's ONLY source of truth for the global backstop.
 *
 * Durability note (see README): the default `FileSpendStore` persists to
 * `$GATEWAY_STATE_DIR/spend.json`. On Render the container disk is EPHEMERAL —
 * a redeploy resets the counter. For true durability, implement this same
 * interface over Postgres (`DATABASE_URL`) or a mounted volume and inject it at
 * the `createGateway` call site. That seam is intentionally left open here; no
 * `pg` dependency is pulled in during this phase.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SpendStore {
  /** Running USD spend for the given `YYYY-MM` bucket (0 if unknown). */
  read(monthYear: string): number;
  /** Add `usd` to the given bucket and persist. */
  add(monthYear: string, usd: number): void;
}

/** Non-durable in-process counter. Used by tests and as a last-resort fallback. */
export class InMemorySpendStore implements SpendStore {
  private readonly buckets = new Map<string, number>();

  constructor(seed?: Record<string, number>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.buckets.set(k, v);
  }

  read(monthYear: string): number {
    return this.buckets.get(monthYear) ?? 0;
  }

  add(monthYear: string, usd: number): void {
    this.buckets.set(monthYear, this.read(monthYear) + usd);
  }
}

/**
 * File-backed counter at `<dir>/spend.json` (`{ "YYYY-MM": number }`). Reads are
 * served from an in-memory cache primed at construction and kept in sync on
 * write; writes are persisted synchronously and atomically (tmp + rename).
 *
 * NOT durable across container replacement on ephemeral disks — see the module
 * note. Adequate for a single long-lived instance / dev.
 */
export class FileSpendStore implements SpendStore {
  private readonly file: string;
  private cache: Record<string, number>;

  constructor(dir?: string) {
    const base = dir && dir.trim() !== '' ? dir : os.tmpdir();
    fs.mkdirSync(base, { recursive: true });
    this.file = path.join(base, 'spend.json');
    this.cache = this.load();
  }

  private load(): Record<string, number> {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
        }
        return out;
      }
    } catch {
      /* missing/corrupt ⇒ start empty */
    }
    return {};
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  read(monthYear: string): number {
    return this.cache[monthYear] ?? 0;
  }

  add(monthYear: string, usd: number): void {
    this.cache[monthYear] = this.read(monthYear) + usd;
    this.persist();
  }
}
