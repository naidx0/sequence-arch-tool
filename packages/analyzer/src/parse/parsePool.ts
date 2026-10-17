/**
 * A small pool of worker threads that run `extractFacts`, for the scan to fan
 * parsing out while it keeps ownership of ORDER.
 *
 * The pool only computes. It never decides what a scan emits: `scanRepo` submits
 * files in `walkFiles` order, gets each file's facts back as a promise, and
 * commits them in that same order, so `importSeq` ordinals, first-declaration-wins
 * and the order of `facts`/`warnings` are the serial scan's, whatever order the
 * threads finish in. scan-oracle.test.ts runs every fixture through a pool and
 * compares with the serial golden.
 *
 * The worker program is the scan worker's own file (see `scan/scanWorker.ts`,
 * `workerData.parseChild`), so a packaged build needs no extra bundle: the
 * one-file `sequence-scan-worker.cjs` is its own child.
 *
 * Failure policy: anything that is the POOL's fault (a worker that cannot start,
 * dies, or exits with work queued) rejects the affected jobs with
 * `PoolUnavailableError`, and the scan parses those files itself. A failure that
 * is the FILE's fault (including a WASM abort inside a worker) is returned as the
 * same error the serial path would have thrown.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { FileFacts, Lang } from '../types.js';
import { ParserAbortedError } from './treesitter.js';

export type PooledFacts = Omit<FileFacts, 'lines'>;

/** What `scanRepo` needs from a pool. */
export interface FactsParsePool {
  /** Misses the scan parses on its own thread before it uses the pool at all. */
  readonly inlineFirst: number;
  /** Maximum files in flight; the scan stops submitting past this. */
  readonly inflightLimit: number;
  parse(src: string, rel: string, lang: Lang): Promise<PooledFacts>;
}

export class PoolUnavailableError extends Error {
  constructor(detail: string) {
    super(`parse pool unavailable: ${detail}`);
    this.name = 'PoolUnavailableError';
  }
}

export type ChildRequest = { id: number; src: string; rel: string; lang: Lang };
export type ChildResponse =
  | { id: number; facts: PooledFacts }
  | { id: number; error: { name: string; message: string; detail?: string } };

/** Worker count for this machine: leave cores for the scan thread and the server. */
export function defaultPoolSize(): number {
  const env = process.env.SEQUENCE_PARSE_POOL;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    return Number.isInteger(n) && n >= 0 ? Math.min(n, 16) : 0;
  }
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(0, Math.min(4, cores - 2));
}

interface Slot {
  worker: Worker;
  busy: Map<number, { resolve: (f: PooledFacts) => void; reject: (e: Error) => void }>;
  dead: boolean;
}

export class WorkerParsePool implements FactsParsePool {
  readonly inlineFirst: number;
  readonly inflightLimit: number;
  private readonly slots: Slot[] = [];
  private nextId = 1;
  private closed = false;

  /**
   * @param file the worker program: the scan worker (`scanWorker.js` or the bundled `.cjs`)
   * @param size workers to run at most; they start lazily, one per outstanding job
   * @param inlineFirst misses the scan parses itself before the pool is touched
   */
  constructor(
    private readonly file: string,
    private readonly size: number,
    inlineFirst = 8,
  ) {
    this.inlineFirst = inlineFirst;
    this.inflightLimit = Math.max(1, size) * 3;
  }

  parse(src: string, rel: string, lang: Lang): Promise<PooledFacts> {
    if (this.closed) return Promise.reject(new PoolUnavailableError('closed'));
    const slot = this.pick();
    if (!slot) return Promise.reject(new PoolUnavailableError('no worker could start'));
    const id = this.nextId++;
    return new Promise<PooledFacts>((resolve, reject) => {
      slot.busy.set(id, { resolve, reject });
      const req: ChildRequest = { id, src, rel, lang };
      try {
        slot.worker.postMessage(req);
      } catch (e) {
        slot.busy.delete(id);
        reject(new PoolUnavailableError((e as Error).message));
      }
    });
  }

  /** The least-loaded live worker, starting a new one while there is room and every worker is busy. */
  private pick(): Slot | undefined {
    let best: Slot | undefined;
    for (const s of this.slots) {
      if (!s.dead && (!best || s.busy.size < best.busy.size)) best = s;
    }
    if ((!best || best.busy.size > 0) && this.liveCount() < this.size) {
      const fresh = this.spawn();
      if (fresh) return fresh;
    }
    return best;
  }

  private liveCount(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  private spawn(): Slot | undefined {
    let worker: Worker;
    try {
      worker = new Worker(this.file, { workerData: { parseChild: true } });
    } catch {
      return undefined;
    }
    const slot: Slot = { worker, busy: new Map(), dead: false };
    const fail = (why: string): void => {
      slot.dead = true;
      for (const [, job] of slot.busy) job.reject(new PoolUnavailableError(why));
      slot.busy.clear();
    };
    worker.on('message', (m: ChildResponse) => {
      const job = slot.busy.get(m.id);
      if (!job) return;
      slot.busy.delete(m.id);
      if ('facts' in m) {
        job.resolve(m.facts);
      } else if (m.error.name === 'ParserAbortedError') {
        job.reject(new ParserAbortedError(m.error.detail ?? m.error.message));
      } else {
        job.reject(new Error(m.error.message));
      }
    });
    worker.on('error', (e) => fail(e.message));
    worker.on('exit', (code) => fail(`worker exited (${code})`));
    this.slots.push(slot);
    return slot;
  }

  /** Stop every worker. Jobs still queued reject with `PoolUnavailableError`. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.slots.map((s) => s.worker.terminate().catch(() => 0)));
  }
}
