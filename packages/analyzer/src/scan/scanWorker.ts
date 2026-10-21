/**
 * Worker thread entry: scans of repositories, off the server's event loop.
 *
 * A worker runs its first scan from `workerData` and then WAITS for more (`{type:'run'}`
 * messages): the runner keeps one warm for a minute after a scan (scan/scanRunner.ts),
 * because the loaded modules, the initialised parser and the JIT'd scan code are most of
 * what a one-file rescan costs once the scan index has made the rest cheap. Cancel is
 * still a `terminate()`. What a fresh worker gave for free is done here instead:
 * the scanner's module state is reset by each scan itself (edge sequence, profile
 * buckets, shared-facts capture), and a tree-sitter WASM abort (which the runtime cannot
 * recover from) or a heap that stays large after a scan RETIRES the worker (`done.retire`),
 * so no scan ever runs on a poisoned or bloated thread. A scan that carries a label
 * model is never run on a reused worker (`workerData.oneShot`): the model travels only in
 * `workerData`.
 *
 * Order matters for latency: the graph is on the wire the moment it is written;
 * the function graph (seconds more, from this scan's own parsed facts) follows as
 * a second message.
 *
 * THIS FILE IS ALSO THE PARSE POOL'S CHILD PROGRAM (`workerData.parseChild`):
 * the scan spawns copies of itself to run `extractFacts` on cache misses (see
 * `parse/parsePool.ts`), so the one-file bundle needs no second worker file.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { extractFacts } from '../parse/facts.js';
import { initParser, ParserAbortedError, parserAbortedWith } from '../parse/treesitter.js';
import { heavyLoadCount } from '../parse/lazyFacts.js';
import {
  WorkerParsePool,
  defaultPoolSize,
  type ChildRequest,
  type ChildResponse,
} from '../parse/parsePool.js';
import { cutGraphWire, releaseGraphWire } from './graphWire.js';
import { seqdNodeDetailFromStructuralTree } from '../explain/seqdEnrichment.js';
import { buildRepoFunctionGraphCached } from '../server/functionGraphCache.js';
import { scanRepo, type ScanOptions } from '../scan.js';
import { persistScan } from './persistScan.js';
import type { ScanWorkerData, ScanWorkerMessage } from './scanProtocol.js';
import { runAskIndexJob, type AskIndexJob } from '../explain/askIndexWorker.js';

const port = parentPort!;
const post = (m: ScanWorkerMessage): void => port.postMessage(m);
/** `SEQUENCE_SCAN_TIMING=1`: this worker's heap after a full collection, on stderr (a diagnostic; the collection is why it is off by default). */
function heapNote(label: string): void {
  if (!process.env.SEQUENCE_SCAN_TIMING) return;
  collect();
  process.stderr.write(`[scan] worker heap ${label}: ${(v8.getHeapStatistics().used_heap_size / 1048576).toFixed(0)} MB
`);
}

/** @returns how many files the scan had to parse: the weight of the scan, which decides whether this worker is kept */
async function main(wd: ScanWorkerData): Promise<number> {
  const scanOpts: ScanOptions = { ...wd.scan };
  // Unchanged files are not parsed again: facts come from <repo>/.sequence/cache/facts.v8.
  scanOpts.factsCache = true;
  if (wd.labelModel) scanOpts.labelModel = wd.labelModel;
  if (wd.files) scanOpts.fileSnapshot = wd.files;
  let lastTick = 0;
  if (wd.progress) {
    scanOpts.onProgress = (done, total) => {
      const now = Date.now();
      if (done >= total || now - lastTick >= 100) {
        lastTick = now;
        post({ type: 'progress', done, total });
      }
    };
  }
  const t0 = performance.now();
  const size = defaultPoolSize();
  const pool = size >= 2 ? new WorkerParsePool(fileURLToPath(import.meta.url), size) : undefined;
  if (pool) scanOpts.parsePool = pool;
  // The cache writes wait until the graph is on the wire: they cost more than the edit they record.
  let persist: { index: () => void; facts: () => void; readonly parsed: number } | undefined;
  scanOpts.deferCachePersist = (p) => {
    persist = p;
  };
  let graph;
  try {
    graph = await scanRepo(wd.root, scanOpts);
  } finally {
    await pool?.close();
  }
  const t1 = performance.now();
  persistScan(wd.root, wd.signature, graph, wd.sigs);
  const t2 = performance.now();
  /* The main thread parses this. One 4 MB JSON.parse is one 40-70 ms stall of the loop that answers the UI; the same
     text as its members (nodes, edges, ...) is a handful of ticks of 10 ms. The node detail the server derives from the
     graph right after is computed here too, for the same reason. */
  const wire = cutGraphWire(graph, seqdNodeDetailFromStructuralTree);
  const t3 = performance.now();
  post({ type: 'graph', parts: wire.parts, detail: wire.detail, scanMs: t1 - t0, persistMs: t2 - t1, stringifyMs: t3 - t2 });
  releaseGraphWire(wire); // posted (copied): the function graph below is built with the texts gone
  heapNote('after the graph left');
  // The index says which files' facts are in the store, so the store is written first: a worker killed in
  // between (a newer scan cancels it; so does quitting) leaves facts nobody points at, never an index that points
  // at facts that were not written.
  persist?.facts();
  persist?.index();
  if (wd.functions) {
    const f0 = performance.now();
    // Never carries the label key: the function graph needs the structural options only.
    const { warnings } = await buildRepoFunctionGraphCached(wd.root, graph, wd.scan);
    post({ type: 'functions', warnings, ms: performance.now() - f0 });
  }
  // Again, if the function graph had to re-parse a file the store lacked (it puts the result back): the store heals.
  persist?.facts();
  return persist?.parsed ?? 0;
}

/** Parse-pool child: answer each `{id, src, rel, lang}` with its facts (minus `lines`, which the scan rebuilds). */
async function childMain(): Promise<void> {
  await initParser();
  const reply = (m: ChildResponse): void => port.postMessage(m);
  port.on('message', (req: ChildRequest) => {
    try {
      const { lines: _lines, ...facts } = extractFacts(req.src, req.rel, req.lang);
      void _lines;
      reply({ id: req.id, facts });
    } catch (e) {
      const err = e as Error & { detail?: string };
      reply({
        id: req.id,
        error: {
          name: e instanceof ParserAbortedError ? 'ParserAbortedError' : (err?.name ?? 'Error'),
          message: err?.message ?? String(e),
          detail: err?.detail,
        },
      });
    }
  });
}

const failure = (e: unknown): ScanWorkerMessage => {
  const err = e as { name?: string; code?: string; message?: string; stack?: string };
  return {
    type: 'error',
    name: err?.name ?? 'Error',
    code: err?.code,
    message: err?.message ?? String(e),
    stack: err?.stack,
  };
};

/** Heap kept after a scan and a full GC, above which this worker is not reused. */
const RETIRE_HEAP_BYTES = 256 * 1024 * 1024;
/** Scans after which a reused worker is replaced regardless (bounds slow growth). */
const RETIRE_AFTER_SCANS = 100;
/**
 * A scan that parsed this many files, or whose function graph then read this many files' heavy facts back from
 * `facts.v8` (every rescan does: the graph is built from all of them), grew this worker's heap to hundreds of
 * megabytes, and V8 gives pages back to the OS tens of seconds later, not at once. Such a worker is retired and
 * the runner starts a fresh, empty one in its place: what a warm worker is worth (loaded modules, an initialised
 * parser) is all in the new one, and the thread that held the peak is gone.
 */
const HEAVY_SCAN_PARSED_FILES = Math.max(1, Number(process.env.SEQUENCE_SCAN_HEAVY_FILES) || 200);
let scans = 0;

/** A full collection, if the runtime lets us ask for one; the heap number below is only honest after it. */
function collect(): void {
  try {
    v8.setFlagsFromString('--expose-gc');
    (vm.runInNewContext('gc') as () => void)();
  } catch {
    /* no gc handle: the retire check then sees a heap that may still hold garbage, and errs towards retiring */
  }
}

/**
 * The function graph for an arch graph nobody has built one for (the scan's own worker was cancelled by a newer scan,
 * or failed). The scan below only fills the shared-facts capture from the index, which is cheap once an index exists;
 * the build then reads those facts instead of parsing the repo. Nothing it scans is persisted or returned.
 */
async function runFunctionsOnly(wd: ScanWorkerData): Promise<void> {
  const f0 = performance.now();
  const opts: ScanOptions = { ...wd.scan, factsCache: true, deferCachePersist: () => {} };
  const size = defaultPoolSize();
  const pool = size >= 2 ? new WorkerParsePool(fileURLToPath(import.meta.url), size) : undefined;
  if (pool) opts.parsePool = pool;
  try {
    await scanRepo(wd.root, opts);
  } finally {
    await pool?.close();
  }
  const { warnings } = await buildRepoFunctionGraphCached(wd.root, wd.graph as Parameters<typeof buildRepoFunctionGraphCached>[1], wd.scan);
  post({ type: 'functions', warnings, ms: performance.now() - f0 });
}

async function runOne(wd: ScanWorkerData): Promise<void> {
  scans += 1;
  let parsed = 0;
  const loadsBefore = heavyLoadCount();
  try {
    parsed = await main(wd);
  } catch (e) {
    post(failure(e));
    // The runner discards a worker whose scan failed; nothing more to do on this thread.
    return;
  }
  if (wd.oneShot) {
    post({ type: 'done', retire: true });
    return;
  }
  // One turn to let this scan's locals go (the graph, the facts), then a full collection: the heap number
  // below is only honest after both, and a warm worker should not sit on the last scan's garbage.
  await new Promise<void>((r) => setTimeout(r, 20));
  collect();
  const retire =
    parserAbortedWith() !== undefined ||
    scans >= RETIRE_AFTER_SCANS ||
    parsed >= HEAVY_SCAN_PARSED_FILES ||
    heavyLoadCount() - loadsBefore >= HEAVY_SCAN_PARSED_FILES ||
    v8.getHeapStatistics().used_heap_size > RETIRE_HEAP_BYTES;
  post({ type: 'done', retire });
  if (retire) process.exit(0);
  // The heap this scan grew is free now, but V8 hands pages back to the OS only on later collections. Ask
  // for a few while the worker idles, so a warm worker costs its modules and not its last scan's peak.
  for (const ms of [500, 1500, 4000, 9000]) setTimeout(collect, ms).unref();
}

if ((workerData as { askIndex?: AskIndexJob } | null)?.askIndex) {
  // The ask file index, built here so its garbage dies with this thread (explain/askIndexWorker.ts).
  void runAskIndexJob((workerData as { askIndex: AskIndexJob }).askIndex, (m, transfer) => port.postMessage(m, transfer ?? []));
} else if ((workerData as { parseChild?: boolean } | null)?.parseChild) {
  // A child that cannot start must die loudly: the pool sees 'error'/'exit' and the scan parses inline.
  childMain().catch((e: unknown) => {
    setImmediate(() => {
      throw e;
    });
  });
} else {
  const first = workerData as ScanWorkerData;
  if (first.functionsOnly) {
    runFunctionsOnly(first).catch((e: unknown) => post(failure(e)));
  } else {
  // A standby does the start-up a scan would (the parser's WASM), and nothing else, until it is given one.
  let chain: Promise<void> = first.standby ? initParser().catch(() => undefined) : runOne(first);
  if (!first.oneShot) {
    port.on('message', (m: { type?: string; data?: ScanWorkerData }) => {
      if (m?.type === 'run' && m.data) {
        const data = m.data;
        chain = chain.then(() => runOne(data));
      }
    });
  }
  }
}
