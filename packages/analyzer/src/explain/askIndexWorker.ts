/**
 * The ask file index, built on a worker thread.
 *
 * WHY. Building the index tokenises every tracked file: on the main thread that is
 * ~130 MB of garbage and seconds of CPU, and V8 keeps the pages it grew for that
 * peak committed for minutes (three one-file rescans left the engine at 400 MB). A
 * worker's garbage dies with the worker. The main thread receives only the final
 * structure, as plain data (typed arrays and strings) that {@link indexFromWire}
 * turns back into the same classes.
 *
 * SHAPE. The worker (the scan worker's own program, `workerData.askIndex`: no second
 * bundle file) posts `index` as soon as the text stage is built, then `ltr` (the
 * history, definitions and import stage, plus the grep trigram postings) when that
 * is done, then `done`. The main side resolves with the index at `index`, exactly as
 * {@link buildAskFileIndexAsync} does, and fills `ltr` / settles `ltrPending` later.
 * Cancelling terminates the worker. A worker that cannot start or dies before `index`
 * rejects, and the caller builds in-process instead.
 *
 * One difference from the in-process build: the worker reads files through a jail
 * that refuses `.git` and `.sequence` outright (the server's resolver also admits
 * decision records, plans and diagrams under `.sequence`; those are not indexed here).
 */

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { resolveInRepo } from '../server/jail.js';
import { AskGrepIndex, type AskGrepWire } from './askGrepIndex.js';
import { askLtrEnabled, buildAskFileIndexAsync, type AskFileIndex, type AskIndexBuildOptions } from './askFileIndex.js';
import type { AskLtrData } from './askLtr.js';
import { AskDocFreq, AskTermCounts, AskTermStore, type AskTermStoreWire } from './askTermCounts.js';

/** An index without its `ltr` stage, as structured-cloneable data. */
export interface AskIndexWire {
  files: string[];
  store: AskTermStoreWire;
  docStart: Int32Array;
  docSize: Int32Array;
  docLen: Int32Array;
  pathStart: Int32Array;
  pathSize: Int32Array;
  n: number;
  avgdl: number;
  churn: Map<string, number>;
  maxChurn: number;
  hist?: AskFileIndex['hist'];
  grep: AskGrepWire;
  textCapped?: boolean;
}

export function indexToWire(index: AskFileIndex): AskIndexWire {
  const files = index.files;
  const n = files.length;
  const docStart = new Int32Array(n);
  const docSize = new Int32Array(n);
  const docLen = new Int32Array(n);
  const pathStart = new Int32Array(n);
  const pathSize = new Int32Array(n);
  let store: AskTermStore | undefined;
  for (let i = 0; i < n; i++) {
    const d = index.docs.get(files[i]!)!;
    const tf = d.tf as AskTermCounts;
    store ??= tf.termStore;
    [docStart[i], docSize[i]] = tf.span;
    docLen[i] = d.len;
    [pathStart[i], pathSize[i]] = (index.pathDocs.get(files[i]!) as AskTermCounts).span;
  }
  return {
    files,
    store: (store ?? new AskTermStore()).toWire(),
    docStart,
    docSize,
    docLen,
    pathStart,
    pathSize,
    n: index.n,
    avgdl: index.avgdl,
    churn: index.churn,
    maxChurn: index.maxChurn,
    ...(index.hist ? { hist: index.hist } : {}),
    grep: index.grep.toWire(),
    ...(index.textCapped ? { textCapped: true } : {}),
  };
}

export function indexFromWire(w: AskIndexWire): AskFileIndex {
  const store = AskTermStore.fromWire(w.store);
  const docs: AskFileIndex['docs'] = new Map();
  const pathDocs: AskFileIndex['pathDocs'] = new Map();
  for (let i = 0; i < w.files.length; i++) {
    const f = w.files[i]!;
    docs.set(f, { tf: new AskTermCounts(store, w.docStart[i]!, w.docSize[i]!), len: w.docLen[i]! });
    pathDocs.set(f, new AskTermCounts(store, w.pathStart[i]!, w.pathSize[i]!));
  }
  const index: AskFileIndex = { docs, pathDocs, df: new AskDocFreq(store), n: w.n, avgdl: w.avgdl, churn: w.churn, maxChurn: w.maxChurn, files: w.files, grep: AskGrepIndex.fromWire(w.grep) };
  if (w.hist) index.hist = w.hist;
  if (w.textCapped) index.textCapped = true;
  return index;
}

/** What the worker is asked to build. */
export interface AskIndexJob {
  root: string;
  paths: string[];
  maxFiles?: number;
  maxTextBytes?: number;
  ltr: boolean;
}

export type AskIndexWorkerMessage =
  | { type: 'index'; wire: AskIndexWire }
  | { type: 'ltr'; ltr: AskLtrData; tri: { triStart: Int32Array; triRuns: Int32Array } | null }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** The plain jail the worker reads through: inside the repo, and not `.git` or `.sequence`. */
export function workerResolver(root: string): (rel: string) => string | null {
  const real = fs.realpathSync(root);
  return (rel) => {
    const abs = resolveInRepo(real, rel);
    if (abs === null) return null;
    let canon: string;
    try {
      canon = fs.realpathSync(abs);
    } catch {
      return null;
    }
    const top = path.relative(real, canon).split(path.sep)[0]!.toLowerCase();
    return top === '.git' || top === '.sequence' || top === '..' ? null : abs;
  };
}

/** Worker side: build, post, return. */
export async function runAskIndexJob(job: AskIndexJob, post: (m: AskIndexWorkerMessage, transfer?: ArrayBuffer[]) => void): Promise<void> {
  try {
    const index = await buildAskFileIndexAsync(job.root, job.paths, workerResolver(job.root), { maxFiles: job.maxFiles, maxTextBytes: job.maxTextBytes, ltr: job.ltr, yieldEvery: 1000 });
    if (!index) {
      post({ type: 'error', message: 'cancelled' });
      return;
    }
    /* Copies, not transfers: the LTR stage below still reads this index. */
    post({ type: 'index', wire: indexToWire(index) });
    await index.ltrPending;
    if (index.ltr) {
      const L = index.ltr;
      post({ type: 'ltr', ltr: L, tri: index.grep.trigramWire() }, [L.postStart.buffer as ArrayBuffer, L.postData.buffer as ArrayBuffer, L.plen.buffer as ArrayBuffer]);
    }
    post({ type: 'done' });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

/** The build holds the repo's text and its postings (~60 MB here); a cap keeps a runaway tokenise from taking the machine. A worker that hits it fails and the caller builds in-process. */
export const ASK_INDEX_WORKER_LIMITS = { maxOldGenerationSizeMb: 1024 } as const;

/**
 * Main side: build `repoRoot`'s index on a worker running `file` (the scan worker program). Resolves with the
 * index once its text stage arrives; rejects when the worker fails first (the caller then builds in-process);
 * null when `cancelled` turned true.
 */
export function buildAskFileIndexInWorker(repoRoot: string, paths: readonly string[], file: string, opts: AskIndexBuildOptions = {}): Promise<AskFileIndex | null> {
  const job: AskIndexJob = { root: repoRoot, paths: [...paths], maxFiles: opts.maxFiles, maxTextBytes: opts.maxTextBytes, ltr: opts.ltr ?? askLtrEnabled() };
  return new Promise((resolve, reject) => {
    const worker = new Worker(file, { workerData: { askIndex: job }, resourceLimits: ASK_INDEX_WORKER_LIMITS });
    let index: AskFileIndex | null = null;
    let settleLtr: () => void = () => undefined;
    let finished = false;
    const poll = opts.cancelled
      ? setInterval(() => {
          if (opts.cancelled!()) finish('cancel');
        }, 100)
      : null;
    poll?.unref();
    function finish(why: 'cancel' | 'fail' | 'done', err?: Error): void {
      if (finished) return;
      finished = true;
      if (poll) clearInterval(poll);
      void worker.terminate();
      settleLtr();
      if (!index) {
        if (why === 'fail') reject(err ?? new Error('ask index worker failed'));
        else resolve(null);
      }
    }
    worker.on('message', (m: AskIndexWorkerMessage) => {
      if (finished) return;
      if (m.type === 'index') {
        const made = indexFromWire(m.wire);
        index = made;
        if (job.ltr)
          made.ltrPending = new Promise<void>((r) => {
            settleLtr = r;
          });
        resolve(made);
      } else if (m.type === 'ltr' && index) {
        index.ltr = m.ltr;
        if (m.tri) index.grep.setTrigrams(m.tri);
      } else if (m.type === 'done') finish('done');
      else if (m.type === 'error') finish(index ? 'done' : m.message === 'cancelled' ? 'cancel' : 'fail', new Error(m.message));
    });
    worker.on('error', (e) => finish(index ? 'done' : 'fail', e));
    worker.on('exit', () => finish(index ? 'done' : 'fail', new Error('ask index worker exited')));
  });
}
