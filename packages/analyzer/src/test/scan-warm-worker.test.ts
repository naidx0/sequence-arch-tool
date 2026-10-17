/**
 * 019-P2C: the scan worker is kept warm between scans, and a rescan through it reflects the edit.
 *
 *   - the second scan of a repo runs on the worker the first one used (`timing.warmWorker`)
 *   - an edit made between the two shows in the second graph, and the graph equals a from-scratch scan
 *   - a scan that parsed a lot (a first scan) retires its worker and leaves an empty standby in its place:
 *     the next scan still finds a warm worker, and it is not the one that held the first scan's heap
 *   - a scan that carries a label model never shares a worker (the model travels only in `workerData`)
 *   - the warm worker does not keep the process alive
 */
import assert from 'node:assert';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { computeSignature } from '../server/graphCache.js';
import { prewarmScanWorker, runScan, stopWarmScanWorker, warmScanWorkerIdle } from '../scan/scanRunner.js';
import { scanWorkerFile } from '../scan/scanRunner.js';

// Every file of the fixture counts as "a lot": the first scan retires its worker.
process.env.SEQUENCE_SCAN_HEAVY_FILES = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.resolve(here, '..', '..', 'test', 'fixtures');

const sansTime = (g: object): string => {
  const { scannedAt: _s, ...rest } = g as { scannedAt?: string };
  void _s;
  return JSON.stringify(rest);
};

async function idle(): Promise<void> {
  const end = Date.now() + 20_000;
  while (!warmScanWorkerIdle()) {
    if (Date.now() > end) throw new Error('the worker never went back to the pool');
    await new Promise((r) => setTimeout(r, 25));
  }
}

after(() => stopWarmScanWorker());

test('the second scan runs on a warm worker, reflects an edit, and equals a fresh scan', async (t) => {
  if (!scanWorkerFile()) return t.skip('no scan worker in this build');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-warm-'));
  const dir = path.join(tmp, 'shopfront');
  fs.cpSync(path.join(EXAMPLES, 'shopfront'), dir, { recursive: true });
  try {
    const first = await runScan({ root: dir, signature: await computeSignature(dir, {}) });
    assert.strictEqual(first.timing.mode, 'worker');
    assert.strictEqual(first.timing.warmWorker, false, 'the first scan starts a worker');
    await first.functions;
    await idle(); // retired (heavy) and replaced by a standby, which is idle in the pool (the attach scan: the rescan is next)

    const target = path.join(dir, 'gateway', 'src', 'index.ts');
    const before = first.graph.nodes.find((n) => n.id === 'file:gateway/src/index.ts');
    assert.ok(before, 'the specimen has the file');
    fs.appendFileSync(target, '\n// edit one\n// edit two\n');

    const second = await runScan({ root: dir, signature: await computeSignature(dir, {}) });
    assert.strictEqual(second.timing.warmWorker, true, 'the second scan took the pooled worker');
    const after = second.graph.nodes.find((n) => n.id === 'file:gateway/src/index.ts');
    assert.strictEqual((after?.meta as { loc: number }).loc, (before!.meta as { loc: number }).loc + 3, 'the edit is in the rescanned graph');
    assert.strictEqual(sansTime(second.graph), sansTime(await scanRepo(dir, {})), 'and the graph equals a from-scratch scan');
    await second.functions;
    /* 019-P2D: a scan that ran on a pooled worker and retired it leaves NOTHING parked (an idle standby is ~40 MB the
       engine carries for nothing); a scan about to happen (a file changed, forceScan started) asks for one. */
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(warmScanWorkerIdle(), false, 'a retired pooled worker is not replaced by an idle standby');
    prewarmScanWorker();
    await idle();

    const third = await runScan({ root: dir, signature: await computeSignature(dir, {}) });
    assert.strictEqual(third.timing.warmWorker, true);
    assert.strictEqual(sansTime(third.graph), sansTime(second.graph), 'an unchanged tree rescans to the same graph');
    await third.functions;
  } finally {
    stopWarmScanWorker();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a scan that labels (carries a model) never runs on a pooled worker', async (t) => {
  if (!scanWorkerFile()) return t.skip('no scan worker in this build');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-warm-llm-'));
  const dir = path.join(tmp, 'shopfront');
  fs.cpSync(path.join(EXAMPLES, 'shopfront'), dir, { recursive: true });
  try {
    const warmUp = await runScan({ root: dir, signature: await computeSignature(dir, {}) });
    await warmUp.functions;
    await idle();
    assert.ok(warmScanWorkerIdle(), 'a warm worker is waiting');
    // llm:true with a model: the model must go in workerData of a worker of its own. (An unusable model makes the labelling
    // pass fall back to the heuristic names; the scan still succeeds.)
    const labelModel = { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9', model: 'none', apiKey: 'not-a-key' } as never;
    const run = await runScan({ root: dir, signature: await computeSignature(dir, { llm: true }), scan: { llm: true }, labelModel, functions: false });
    assert.strictEqual(run.timing.warmWorker, false, 'a labelling scan does not take the pooled worker');
    assert.ok(warmScanWorkerIdle(), 'and leaves it where it was');
  } finally {
    stopWarmScanWorker();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
