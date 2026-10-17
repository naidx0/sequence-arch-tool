/**
 * Runs a scan OFF the server's event loop, on a worker thread.
 *
 * Why: `scanRepo` is CPU-bound for 20-40 s on a big repo, and on every path but
 * the startup attach it ran on the HTTP thread, so `/api/status`, chat and every
 * other route queued behind it (measured 32-37 s, 0.1.9 audit P1-1). Yielding
 * inside the parse loop only slices that stall; the stringify and the writes
 * after it still block. A thread removes it.
 *
 * The worker is kept warm for 20 s after a scan (a retired heavy worker leaves none: prewarmScanWorker starts one when a scan is about to happen) and reused (see "the warm
 * worker" below). Where the worker file is not found (dev under tsx, a build
 * without the worker) the scan runs in-process exactly as before, so every
 * caller that reaches `scanRepo` directly is untouched. `SEQUENCE_SCAN_WORKER=0`
 * forces that path.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ArchGraph } from '@sequence/schema';
import type { LabelModel } from '../llm/label.js';
import { NoManifestsError, scanRepo, type ScanOptions } from '../scan.js';
import { recallParts, takeFileSnapshot, type PartSignatures } from '../server/graphCache.js';
import { persistScan } from './persistScan.js';
import type { PlainScanOptions, ScanWorkerData, ScanWorkerMessage } from './scanProtocol.js';

/**
 * The scan worker: `scanWorker.js` beside this module in a build
 * (dist/scan/), `sequence-scan-worker.cjs` beside the one-file server bundle.
 * `SEQUENCE_SCAN_WORKER_FILE` points elsewhere (test seam); `SEQUENCE_SCAN_WORKER=0`
 * turns the worker off.
 */
export function scanWorkerFile(from: string = import.meta.url): string | null {
  if (process.env.SEQUENCE_SCAN_WORKER === '0') return null;
  const override = process.env.SEQUENCE_SCAN_WORKER_FILE;
  if (override) return fs.existsSync(override) ? override : null;
  for (const name of ['./scanWorker.js', './sequence-scan-worker.cjs']) {
    try {
      const p = fileURLToPath(new URL(name, from));
      if (fs.existsSync(p)) return p;
    } catch {
      /* not a file URL */
    }
  }
  return null;
}

export interface FunctionsOutcome {
  /** True when the worker built and persisted `.sequence/functions.json` for this scan. */
  ok: boolean;
  warnings: string[];
}

export interface ScanRunRequest {
  root: string;
  /** The server's scan options. Callbacks never cross the boundary. */
  scan?: ScanOptions;
  /** The connected model for labels. Passed in `workerData` only, and only when `scan.llm` will use it. */
  labelModel?: LabelModel;
  /** The content signature to persist under (from `computeSignature`). */
  signature: string;
  /** `done` of `total` source files. May throw to cancel the scan. */
  onProgress?: (done: number, total: number) => void;
  /** Aborting terminates the worker; the promise rejects with `signal.reason`. */
  signal?: AbortSignal;
  /** Also build and persist the function graph in the worker (default true). */
  functions?: boolean;
  /** Override the located worker file. `null` forces the in-process path. */
  workerFile?: string | null;
}

export interface ScanRun {
  graph: ArchGraph;
  /** Settles when the worker has written `functions.json` (never rejects); `null` when none was asked for. */
  functions: Promise<FunctionsOutcome> | null;
  /** Stops the function-graph build (terminates the worker). A no-op once the build has finished. */
  cancelFunctions: () => void;
  /** Where it ran, and how long each stage took. */
  timing: {
    mode: 'worker' | 'in-process';
    scanMs?: number;
    persistMs?: number;
    stringifyMs?: number;
    parseMs?: number;
    /** the scan ran on a worker kept from an earlier scan */
    warmWorker?: boolean;
  };
}

function plain(scan: ScanOptions | undefined): PlainScanOptions {
  const out: PlainScanOptions = {};
  if (scan?.cluster !== undefined) out.cluster = scan.cluster;
  if (scan?.llm !== undefined) out.llm = scan.llm;
  if (scan?.maxFiles !== undefined) out.maxFiles = scan.maxFiles;
  return out;
}

/** The in-process path: what forceScan and the attach did before the worker existed. */
async function runInProcess(req: ScanRunRequest): Promise<ScanRun> {
  const opts: ScanOptions = { ...(req.scan ?? {}) };
  if (req.labelModel) opts.labelModel = req.labelModel;
  if (req.onProgress) opts.onProgress = req.onProgress;
  const t0 = performance.now();
  const graph = await scanRepo(req.root, opts);
  req.signal?.throwIfAborted();
  persistScan(req.root, req.signature, graph, recallParts(req.signature));
  return {
    graph,
    functions: null,
    cancelFunctions: () => {},
    timing: { mode: 'in-process', scanMs: performance.now() - t0 },
  };
}

/** The node detail a worker computed for a graph it returned, claimed once by whoever commits that graph. */
const precomputedDetail = new WeakMap<object, unknown>();
export function takePrecomputedNodeDetail(graph: object): unknown {
  const d = precomputedDetail.get(graph);
  precomputedDetail.delete(graph);
  return d;
}

/** `SEQUENCE_SCAN_TIMING=1`: one line per stage of each worker scan on stderr (a diagnostic, off by default). */
function timing(line: string): void {
  if (process.env.SEQUENCE_SCAN_TIMING) process.stderr.write(`[scan] ${line}`+String.fromCharCode(10));
}

/** Worker failures that mean "could not start", not "the scan failed": run it here instead. */
const COULD_NOT_START = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_WORKER_PATH', 'ERR_WORKER_INIT_FAILED']);

export async function runScan(req: ScanRunRequest): Promise<ScanRun> {
  const file = req.workerFile === undefined ? scanWorkerFile() : req.workerFile;
  // A callback on the options cannot be cloned into a worker; keep that rare caller in-process.
  if (!file || req.scan?.onServiceFacts) return runInProcess(req);
  req.signal?.throwIfAborted();

  const wantFunctions = req.functions !== false;
  const sigs: PartSignatures | undefined = recallParts(req.signature);
  const files = takeFileSnapshot(req.signature);
  /* The model is only ever read by the labelling pass (`scan.llm`). A scan that does not label sends none,
     and may share a warm worker; one that does runs on its own worker, with the model in `workerData` only. */
  const needsModel = !!req.labelModel && !!req.scan?.llm;
  const data: ScanWorkerData = {
    root: req.root,
    scan: plain(req.scan),
    ...(needsModel ? { labelModel: req.labelModel, oneShot: true } : {}),
    signature: req.signature,
    ...(sigs ? { sigs } : {}),
    ...(files ? { files } : {}),
    progress: !!req.onProgress,
    functions: wantFunctions,
  };

  const tStart = performance.now();
  return new Promise<ScanRun>((resolve, reject) => {
    const { worker, reused } = takeWorker(file, data, needsModel);
    let graphSeen = false;
    let settled = false;
    let finished = false;
    let functionsSettled = false;
    let resolveFunctions: (o: FunctionsOutcome) => void = () => {};
    const functions = wantFunctions
      ? new Promise<FunctionsOutcome>((r) => {
          resolveFunctions = r;
        })
      : null;
    const settleFunctions = (o: FunctionsOutcome): void => {
      if (functionsSettled) return;
      functionsSettled = true;
      resolveFunctions(o);
    };
    const detach = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    /** Stop this worker for good (cancel, failure). */
    const kill = (): void => {
      finished = true;
      detach();
      dropWorker(worker);
    };
    /** Stop the function-graph build. Once the build has finished there is nothing left to stop, and the worker is kept. */
    const cancelAll = (): void => {
      if (finished || functionsSettled) return;
      kill();
      settleFunctions({ ok: false, warnings: [] });
    };
    const signal = req.signal;
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      kill();
      settleFunctions({ ok: false, warnings: [] });
      reject(e);
    };
    const onAbort = (): void => {
      if (finished) return;
      if (settled) {
        // The graph is out; a cancel now stops the function graph and the cache writes after it.
        kill();
        settleFunctions({ ok: false, warnings: [] });
        return;
      }
      fail(signal!.reason instanceof Error ? signal!.reason : new Error('the scan was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    function onMessage(m: ScanWorkerMessage): void {
      if (m.type === 'progress') {
        try {
          req.onProgress?.(m.done, m.total);
        } catch (e) {
          // The caller's cancel signal (StartupSupersededError, server closed): stop the worker.
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      } else if (m.type === 'graph') {
        if (settled || graphSeen) return;
        graphSeen = true;
        void (async () => {
          const tp = performance.now();
          let graph: ArchGraph;
          let detail: unknown;
          try {
            if (m.parts) {
              // One member per tick: the loop that serves the UI is never held for the whole graph.
              const obj: Record<string, unknown> = {};
              for (const [k, text] of m.parts) {
                obj[k] = JSON.parse(text);
                await new Promise<void>((r) => setImmediate(r));
              }
              graph = obj as unknown as ArchGraph;
              if (m.detail !== undefined) detail = JSON.parse(m.detail);
            } else {
              graph = JSON.parse(m.text ?? '') as ArchGraph;
            }
          } catch (e) {
            fail(new Error(`the scan worker returned an unreadable graph: ${(e as Error).message}`));
            return;
          }
          if (settled) return; // cancelled while parsing
          const parseMs = performance.now() - tp;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          if (detail !== undefined) precomputedDetail.set(graph, detail);
          timing(`runScan ${(performance.now() - tStart).toFixed(0)} ms (worker scan ${m.scanMs.toFixed(0)}, persist ${m.persistMs.toFixed(0)}, stringify ${m.stringifyMs.toFixed(0)}, parse ${parseMs.toFixed(0)}, warm ${reused})`);
          resolve({
            graph,
            functions,
            cancelFunctions: cancelAll,
            timing: { mode: 'worker', scanMs: m.scanMs, persistMs: m.persistMs, stringifyMs: m.stringifyMs, parseMs, warmWorker: reused },
          });
        })();
      } else if (m.type === 'functions') {
        // The worker goes on to its cache writes; it ends itself or returns to the pool. Only a cancel terminates it.
        timing(`functions graph ready +${(performance.now() - tStart).toFixed(0)} ms`);
        settleFunctions({ ok: true, warnings: m.warnings });
      } else if (m.type === 'done') {
        timing(`worker done +${(performance.now() - tStart).toFixed(0)} ms (retire ${m.retire})`);
        finished = true;
        detach();
        settleFunctions({ ok: false, warnings: [] });
        releaseWorker(worker, m.retire, reused);
      } else if (m.type === 'error') {
        if (!graphSeen) {
          fail(m.code === 'no-manifests' ? new NoManifestsError(req.root) : Object.assign(new Error(m.message), { name: m.name }));
        } else {
          settleFunctions({ ok: false, warnings: [] });
          kill(); // whatever failed after the graph left the worker in an unknown state
        }
      }
    }
    function onError(err: Error & { code?: string }): void {
      if (graphSeen) {
        settleFunctions({ ok: false, warnings: [] });
        return;
      }
      if (!settled && err.code && COULD_NOT_START.has(err.code)) {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        kill();
        runInProcess(req).then(resolve, reject);
        return;
      }
      fail(new Error(`the scan worker crashed: ${err.message}`));
    }
    function onExit(code: number): void {
      finished = true;
      settleFunctions({ ok: false, warnings: [] });
      if (!settled) fail(new Error(`the scan worker exited before finishing (code ${code})`));
    }
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

/* ---- the warm worker ------------------------------------------------------------------------------------------
   One worker is kept after a scan and used for the next, until it has been idle for WARM_MS. What it keeps is
   what a one-file rescan is mostly made of once the scan index has removed the parsing: the loaded modules, the
   initialised parser and the optimised scan code (a cold worker spends ~0.4 s before it is useful; a warm one
   starts at once and runs the node build about twice as fast). It holds no facts between scans, so what it costs
   in memory is the thread itself. It goes after WARM_MS idle, or at once when its heap stays large after a scan
   (scanWorker.ts retires it). `SEQUENCE_SCAN_WORKER_WARM_MS=0` turns reuse off. */

interface Warm {
  worker: Worker;
  file: string;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
let warm: Warm | null = null;

function warmMs(): number {
  const v = process.env.SEQUENCE_SCAN_WORKER_WARM_MS;
  if (v === undefined || v === '') return 20_000;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 20_000;
}

function takeWorker(file: string, data: ScanWorkerData, oneShot: boolean): { worker: Worker; reused: boolean } {
  if (!oneShot && warm && warm.file === file && !warm.busy && warmMs() > 0) {
    if (warm.timer) clearTimeout(warm.timer);
    warm.timer = null;
    warm.busy = true;
    warm.worker.ref();
    warm.worker.postMessage({ type: 'run', data });
    return { worker: warm.worker, reused: true };
  }
  const worker = new Worker(file, { workerData: data });
  if (!oneShot && warmMs() > 0) {
    if (warm && !warm.busy) dropWorker(warm.worker); // an idle worker of another build
    if (!warm) {
      const mine: Warm = { worker, file, busy: true, timer: null };
      warm = mine;
      worker.once('exit', () => {
        if (mine.timer) clearTimeout(mine.timer);
        if (warm === mine) warm = null;
      });
    }
  }
  return { worker, reused: false };
}

/** The scan on `worker` finished cleanly: keep it for the next one, or let it go. */
function releaseWorker(worker: Worker, retire: boolean, wasPooled: boolean): void {
  if (!warm || warm.worker !== worker) {
    void worker.terminate(); // a one-shot, or a second concurrent scan's worker: nothing will ask it for more
    return;
  }
  if (retire) {
    /* The thread that held the peak goes. An empty replacement (~35-45 MB of RSS) is parked only after a scan that
       had to start its own worker (the attach scan): the first rescan is the likely next one, and a rescan on a
       standby is 0.84 s against 1.0-1.6 s on a cold worker. A scan that already ran on a pooled worker leaves
       none; the next one asks for a standby when it is about to happen (prewarmScanWorker: a file change, or the
       start of a scan, before the signature walk). So the engine at rest carries a worker for ~45 s after attach and never again. */
    const file = warm.file;
    dropWorker(worker);
    if (!wasPooled) spawnStandby(file, STANDBY_AFTER_ATTACH_MS);
    return;
  }
  warm.busy = false;
  warm.timer = setTimeout(() => dropWorker(worker), warmMs());
  warm.timer.unref();
  worker.unref(); // an idle worker must not keep a CLI or a test process alive

}

/**
 * Get a standby worker started, if none is: called when a scan is about to happen (a watched file changed, or a
 * scan was requested and is still walking the tree for its signature), so the worker's start-up (module load and
 * parser init, ~0.35 s) overlaps that work instead of adding to the scan. A standby that no scan takes ends itself
 * after the warm window.
 */
export function prewarmScanWorker(): void {
  const file = scanWorkerFile();
  if (file) spawnStandby(file);
}

/** An idle worker with its modules loaded and its parser initialised, waiting in the pool for a scan. */
/** How long the standby parked after the attach scan waits for the first rescan. */
const STANDBY_AFTER_ATTACH_MS = 45_000;

function spawnStandby(file: string, ms: number = warmMs()): void {
  if (warm || warmMs() === 0) return;
  let worker: Worker;
  try {
    worker = new Worker(file, { workerData: { standby: true } });
  } catch {
    return; // the next scan starts its own
  }
  const mine: Warm = { worker, file, busy: false, timer: null };
  mine.timer = setTimeout(() => dropWorker(worker), Math.max(ms, warmMs()));
  mine.timer.unref();
  worker.unref();
  warm = mine;
  const forget = (): void => {
    if (mine.timer) clearTimeout(mine.timer);
    if (warm === mine) warm = null;
  };
  worker.once('exit', forget);
  worker.once('error', forget);
}

function dropWorker(worker: Worker): void {
  if (warm && warm.worker === worker) {
    if (warm.timer) clearTimeout(warm.timer);
    warm = null;
  }
  void worker.terminate();
}

/* ---- function graphs on demand, off the loop --------------------------------------------------------------------- */

const functionJobs = new Map<string, Promise<boolean>>();

/**
 * Build and persist `.sequence/functions.json` for `graph` on a worker of its own, once per (root, scannedAt) however many
 * callers ask. Resolves true when the worker says it wrote it. Null when there is no worker file to run it on (the caller
 * then has no off-thread option). Never rejects. The server's loop is not involved beyond handing over the graph.
 */
export function buildFunctionsOffThread(root: string, graph: ArchGraph, scan?: ScanOptions, workerFile?: string | null, timeoutMs = 600_000): Promise<boolean> | null {
  const file = workerFile === undefined ? scanWorkerFile() : workerFile;
  if (!file) return null;
  const key = `${root}|${String((graph as { scannedAt?: string }).scannedAt ?? '')}`;
  const live = functionJobs.get(key);
  if (live) return live;
  const job = new Promise<boolean>((resolve) => {
    let worker: Worker;
    try {
      const data: ScanWorkerData = { root, scan: plain(scan), signature: '', progress: false, functions: false, functionsOnly: true, graph };
      worker = new Worker(file, { workerData: data });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => void worker.terminate(), timeoutMs);
    timer.unref();
    let ok = false;
    worker.on('message', (m: ScanWorkerMessage) => {
      if (m.type === 'functions') ok = true;
    });
    worker.on('error', () => resolve(ok));
    worker.on('exit', () => {
      clearTimeout(timer);
      resolve(ok);
    });
  }).finally(() => functionJobs.delete(key));
  functionJobs.set(key, job);
  return job;
}

/** Test seam: is a warm worker waiting for a scan right now? */
export function warmScanWorkerIdle(): boolean {
  return !!warm && !warm.busy;
}

/** Test seam: end the warm worker now, as the idle timer would. */
export function stopWarmScanWorker(): void {
  if (warm) dropWorker(warm.worker);
}
