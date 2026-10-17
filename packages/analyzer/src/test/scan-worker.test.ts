import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { computeSignature } from '../server/graphCache.js';
import { createRepoServer } from '../server/repoServer.js';
import { runScan, scanWorkerFile } from '../scan/scanRunner.js';
import { makeBigRepo as makeFiles } from './findFilesBigRepo.js';
import { bound } from './load-scale.js';

/** The generated repo has no manifest, which the scanner (rightly) refuses; give it one. */
function makeBigRepo(files: number): string {
  const dir = makeFiles(files);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bigrepo', version: '1.0.0' }));
  return dir;
}

/*
 * 0.1.9 2B-1: scans run in a worker thread, so the HTTP thread keeps answering.
 *   a  the loop stays responsive while a CPU-bound scan runs (the reported shape:
 *      POST /api/scan on a big attached repo, /api/status polled throughout)
 *   b  no worker file -> the scan runs in-process, same graph
 *   c  cancel / supersede terminates the worker and the result never commits
 *   d  the worker's graph equals the in-process graph on three fixtures
 *   f  a worker crash is an honest scan error, not a hang
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const EXAMPLES = path.join(REPO_ROOT, 'examples');

function fixtureCopy(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sw-')));
  fs.cpSync(path.join(EXAMPLES, name), dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.sequence`) });
  return dir;
}
const rm = (d: string): void => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

/** A worker script standing in for the real one (test seam: workerFile). */
function fakeWorker(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fakew-'));
  const f = path.join(dir, 'worker.cjs');
  fs.writeFileSync(f, body);
  return f;
}

/** Minus `scannedAt`, and as JSON: a graph that crossed the boundary (or the cache) has no `undefined`-valued keys. */
const sansTime = <T extends { scannedAt?: string }>(g: T): Omit<T, 'scannedAt'> => {
  const { scannedAt: _s, ...rest } = JSON.parse(JSON.stringify(g)) as T;
  return rest;
};

test('scanWorkerFile finds the worker beside this build, and none when absent', () => {
  const found = scanWorkerFile(new URL('../scan/scanRunner.js', import.meta.url).href);
  assert.ok(found?.endsWith('scanWorker.js'), `found ${found}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sw-none-'));
  try {
    assert.strictEqual(scanWorkerFile(new URL(`file://${tmp}/x.js`).href), null);
    fs.writeFileSync(path.join(tmp, 'sequence-scan-worker.cjs'), '');
    assert.strictEqual(scanWorkerFile(new URL(`file://${tmp}/x.js`).href), path.join(tmp, 'sequence-scan-worker.cjs'));
  } finally {
    rm(tmp);
  }
});

test('d: the worker graph deep-equals the in-process graph on three fixtures; cache and map are written', async () => {
  for (const name of ['ticketing-scaffold', 'makemore', 'generated']) {
    const dir = name === 'generated' ? makeBigRepo(60) : fixtureCopy(name);
    try {
      const signature = await computeSignature(dir, {});
      const run = await runScan({ root: dir, signature });
      assert.strictEqual(run.timing.mode, 'worker', `${name} ran on the worker`);
      const direct = await scanRepo(dir, {});
      assert.deepStrictEqual(sansTime(run.graph), sansTime(direct), `${name}: same graph`);
      const cached = JSON.parse(fs.readFileSync(path.join(dir, '.sequence', 'graph.json'), 'utf8'));
      assert.strictEqual(cached.signature, signature, 'the worker wrote graph.json under the signature');
      assert.strictEqual(cached.graph.scannedAt, run.graph.scannedAt);
      assert.ok(fs.existsSync(path.join(dir, '.sequence', 'map.md')), 'map.md written by the worker');
      const fns = await run.functions!;
      assert.strictEqual(fns.ok, true);
      const f = JSON.parse(fs.readFileSync(path.join(dir, '.sequence', 'functions.json'), 'utf8'));
      assert.strictEqual(f.scannedAt, run.graph.scannedAt, 'functions.json is keyed on this scan');
    } finally {
      rm(dir);
    }
  }
});

test('d: NoManifestsError crosses the boundary as itself', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sw-empty-'));
  try {
    const { NoManifestsError } = await import('../scan.js');
    await assert.rejects(runScan({ root: dir, signature: 'x' }), (e: Error) => e instanceof NoManifestsError);
  } finally {
    rm(dir);
  }
});

test('b: without a worker file the scan runs in-process, with the same graph and files', async () => {
  const dir = fixtureCopy('ticketing-scaffold');
  try {
    const signature = await computeSignature(dir, {});
    const run = await runScan({ root: dir, signature, workerFile: null });
    assert.strictEqual(run.timing.mode, 'in-process');
    assert.strictEqual(run.functions, null);
    assert.deepStrictEqual(sansTime(run.graph), sansTime(await scanRepo(dir, {})));
    assert.ok(fs.existsSync(path.join(dir, '.sequence', 'graph.json')));
    // A path that does not exist behaves like none (the SEQUENCE_SCAN_WORKER_FILE seam).
    process.env.SEQUENCE_SCAN_WORKER_FILE = path.join(dir, 'nope.cjs');
    try {
      assert.strictEqual(scanWorkerFile(), null);
    } finally {
      delete process.env.SEQUENCE_SCAN_WORKER_FILE;
    }
  } finally {
    rm(dir);
  }
});

test('f: a worker that throws, exits or crashes is an honest scan error, not a hang', async () => {
  const dir = fixtureCopy('ticketing-scaffold');
  try {
    const cases: Array<[string, RegExp]> = [
      ["require('node:worker_threads').parentPort.postMessage({type:'error',name:'Error',message:'boom from worker'});", /boom from worker/],
      ['process.exit(3);', /exited before finishing \(code 3\)/],
      ["setImmediate(() => { throw new Error('kaboom'); });", /scan worker crashed: kaboom/],
      ['', /exited before finishing/],
    ];
    for (const [body, re] of cases) {
      await assert.rejects(
        Promise.race([
          runScan({ root: dir, signature: 'x', workerFile: fakeWorker(body) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 20_000)),
        ]),
        re,
      );
    }
  } finally {
    rm(dir);
  }
});

test('c: aborting terminates the worker and the scan rejects with the reason', async () => {
  const dir = fixtureCopy('ticketing-scaffold');
  const marker = path.join(dir, 'worker-ran');
  // Runs forever unless terminated; writes a marker proving it started.
  const slow = fakeWorker(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1'); setInterval(() => {}, 1000);`);
  try {
    const ac = new AbortController();
    const p = runScan({ root: dir, signature: 'x', workerFile: slow, signal: ac.signal });
    const settled = assert.rejects(p, /superseded-by-test/);
    await new Promise((r) => setTimeout(r, 300));
    ac.abort(new Error('superseded-by-test'));
    await settled;
    // already aborted: never starts
    await assert.rejects(runScan({ root: dir, signature: 'x', workerFile: slow, signal: ac.signal }), /superseded-by-test/);
    // onProgress throwing (the startup supersede) stops the worker too
    const ticking = fakeWorker(`const {parentPort}=require('node:worker_threads'); setInterval(()=>parentPort.postMessage({type:'progress',done:1,total:2}),20);`);
    await assert.rejects(
      runScan({
        root: dir,
        signature: 'x',
        workerFile: ticking,
        onProgress: () => {
          throw new Error('stand down');
        },
      }),
      /stand down/,
    );
  } finally {
    rm(dir);
  }
});

/* ── the server ── */

function portOf(server: http.Server): number {
  const a = server.address();
  return typeof a === 'object' && a ? a.port : 0;
}
const closeServer = (s: http.Server): Promise<void> => new Promise((r) => s.close(() => r()));

test('c: a newer startup attach terminates the startup scan worker; its graph never commits', async () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sw-race-')));
  const big = makeBigRepo(1500);
  const small = path.join(top, 'small');
  fs.cpSync(path.join(EXAMPLES, 'ticketing-scaffold'), small, { recursive: true, filter: (s) => !s.includes(`${path.sep}.sequence`) });
  const server = await createRepoServer(big, {
    deferStartupAttach: true,
    userConfigDir: top,
    recentStoreDir: top,
    browseRoot: top,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    const { startDeferredAttach } = await import('../server/repoServer.js');
    const run = startDeferredAttach(server);
    await new Promise((r) => setTimeout(r, 500)); // the big scan is on its worker
    const res = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: small }),
    });
    assert.strictEqual(res.status, 200, await res.clone().text());
    await run;
    const st = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean; repoRoot?: string; repo?: string };
    assert.strictEqual(st.attached, true);
    const g = (await (await fetch(`${base}/archgraph.json`)).json()) as { repoRoot: string };
    assert.strictEqual(fs.realpathSync(g.repoRoot), fs.realpathSync(small), 'the person\'s attach won; the startup graph never committed');
    assert.ok(!fs.existsSync(path.join(big, '.sequence', 'graph.json')), 'the terminated scan wrote no cache');
  } finally {
    await closeServer(server);
    rm(big);
    rm(top);
  }
});

/** One GET /api/status, in ms. */
async function statusMs(base: string): Promise<number> {
  const t = performance.now();
  const r = await fetch(`${base}/api/status`);
  assert.strictEqual(r.status, 200);
  await r.json();
  return performance.now() - t;
}

test('a: the loop keeps answering /api/status while POST /api/scan runs a CPU-bound scan', async () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sw-lag-')));
  const big = makeBigRepo(3000);
  const server = await createRepoServer(big, { userConfigDir: top, recentStoreDir: top, browseRoot: path.dirname(big) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    // The same-run baseline: how long /api/status takes on this machine, in this process, with no scan running.
    // The bound below is judged against it, so a loaded box moves the baseline and the bound together.
    const idle: number[] = [];
    for (let i = 0; i < 25; i++) {
      idle.push(await statusMs(base));
      await new Promise((res) => setTimeout(res, 10));
    }
    idle.sort((a, b) => a - b);
    const idleP95 = idle[Math.floor(idle.length * 0.95)]!;
    // Control: the same probe DOES see a blocked loop. A 600 ms synchronous stall begun while the request is in flight reads far above the limit.
    const limit = Math.min(500, Math.max(bound(100, 500), idleP95 * 4 + 50));
    /* The stall starts synchronously once the request is issued, so it always overlaps it. On a 0 ms timer the
       localhost round trip could finish before the timer fired, and the control read 1 ms. */
    const stallT0 = performance.now();
    const pending = fetch(`${base}/api/status`).then(async (r) => {
      assert.strictEqual(r.status, 200);
      await r.json();
    });
    const end = performance.now() + 600;
    while (performance.now() < end);
    await pending;
    const stalled = performance.now() - stallT0;
    assert.ok(stalled > limit, `the probe must see a 600 ms stall (${Math.round(stalled)} ms vs limit ${Math.round(limit)})`);
    // Two ways to see a stall: how late 1 ms timers fire, and how long /api/status takes.
    const gaps: number[] = [];
    let last = performance.now();
    const timer = setInterval(() => {
      const n = performance.now();
      gaps.push(n - last);
      last = n;
    }, 1);
    // The sampler shares THIS process's loop, so a stalled server stalls the sampler too:
    // the lag below is the server's own lag as seen from the same thread.
    const lat: number[] = [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        lat.push(await statusMs(base));
        await new Promise((res) => setTimeout(res, 10));
      }
    })();
    const t0 = performance.now();
    const scan = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.strictEqual(scan.status, 200, await scan.clone().text());
    const body = (await scan.json()) as { nodes: unknown[] };
    const scanMs = performance.now() - t0;
    polling = false;
    await poll;
    clearInterval(timer);
    assert.ok(body.nodes.length > 0);
    assert.ok(scanMs > 1500, `the scan must be long enough to mean something (${Math.round(scanMs)} ms)`);
    gaps.sort((a, b) => a - b);
    lat.sort((a, b) => a - b);
    const maxGap = gaps[gaps.length - 1]!;
    const p95 = lat[Math.floor(lat.length * 0.95)] ?? 0;
    // Bounds, load-robust by construction: a blocked loop shows ONE gap of ~the scan time
    // (>= 100 %), so 25 % of it is far from both; the p95 limit is 4x this run's own idle p95
    // (floored by the load-scaled 100 ms, capped at 500 ms) while a blocked loop is 1000+ ms.
    assert.ok(lat.length >= 5, `status was polled during the scan (${lat.length} samples)`);
    assert.ok(maxGap < scanMs * 0.25, `max loop gap ${Math.round(maxGap)} ms vs scan ${Math.round(scanMs)} ms`);
    assert.ok(p95 < limit, `/api/status p95 ${Math.round(p95)} ms vs limit ${Math.round(limit)} ms (idle p95 ${Math.round(idleP95)} ms)`);
  } finally {
    await closeServer(server);
    rm(big);
    rm(top);
  }
});
