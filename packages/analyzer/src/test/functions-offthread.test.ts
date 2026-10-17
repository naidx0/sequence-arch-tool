/**
 * 019-P2C: GET /api/functions never builds a function graph on the server's loop.
 *
 * The scan's worker builds and persists the function graph after it posts the graph. When that result is not there for the
 * graph being served (a newer scan cancelled the worker mid-build, it failed, or the file was lost), the route used to
 * build it itself on the main thread: ~19 s of an engine that answered nothing, not even /api/status, on a 5,000-file
 * repo, after every auto-refresh. It now has a worker build it and waits for the file; the loop stays free.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { scanWorkerFile, stopWarmScanWorker } from '../scan/scanRunner.js';
import { makeBigRepo as makeFiles } from './findFilesBigRepo.js';

const portOf = (s: http.Server): number => {
  const a = s.address();
  return typeof a === 'object' && a ? a.port : 0;
};

/** Polls /api/status every 20 ms while `work` runs; returns work's result and the gap before every answer (from the previous answer, or from the start), so a stall in the poller's own timer counts too. */
async function whileStatusPolled<T>(base: string, work: () => Promise<T>): Promise<{ result: T; lat: number[]; ms: number }> {
  const lat: number[] = [];
  let polling = true;
  let last = performance.now();
  const poll = (async () => {
    while (polling) {
      const r = await fetch(`${base}/api/status`);
      assert.strictEqual(r.status, 200);
      await r.arrayBuffer();
      const now = performance.now();
      lat.push(now - last);
      last = now;
      await new Promise((res) => setTimeout(res, 20));
    }
  })();
  const t1 = performance.now();
  try {
    const result = await work();
    return { result, lat, ms: performance.now() - t1 };
  } finally {
    polling = false;
    await poll;
  }
}

test('a missing function graph is built by a worker: /api/status keeps answering, and /api/functions returns the new revision', async (t) => {
  if (!scanWorkerFile()) return t.skip('no scan worker in this build');
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fn-off-')));
  const big = makeFiles(2500);
  fs.writeFileSync(path.join(big, 'package.json'), JSON.stringify({ name: 'bigrepo', version: '1.0.0' }));
  const server = await createRepoServer(big, { userConfigDir: top, recentStoreDir: top, browseRoot: path.dirname(big) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    const scan = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.strictEqual(scan.status, 200);
    const scannedAt = ((await scan.json()) as { scannedAt: string }).scannedAt;
    // The scan's worker has to finish its own function graph first (the route waits for it), then it is deleted:
    // the state after a cancelled worker.
    const warm = await fetch(`${base}/api/functions`);
    assert.strictEqual(warm.status, 200);
    await warm.arrayBuffer();
    const file = path.join(big, '.sequence', 'functions.json');
    assert.ok(fs.existsSync(file), 'the worker wrote the function graph');
    fs.rmSync(file);

    const {
      result: { fn, body },
      lat,
      ms: fnMs,
    } = await whileStatusPolled(base, async () => {
      const fn = await fetch(`${base}/api/functions`);
      return { fn, body: (await fn.json()) as { functionGraph: { nodes: unknown[] } } };
    });

    assert.strictEqual(fn.status, 200);
    assert.ok(body.functionGraph.nodes.length > 0, 'the function graph is the real one, not an empty fallback');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')) as { scannedAt: string };
    assert.strictEqual(persisted.scannedAt, scannedAt, 'and it is the graph being served');
    assert.ok(fnMs > 800, `the build must be long enough to mean something (${Math.round(fnMs)} ms)`);
    /*
     * THE STALL IS JUDGED AGAINST THE BUILD, NOT AGAINST A CLOCK. A build on the server's loop blocks every answer for the whole of it,
     * so the slowest /api/status answer is about as long as the build; an off-thread build leaves it a small fraction of it, at any
     * load (both stretch together). The control below shows a block of known length reads as itself.
     */
    const max = Math.max(...lat);
    assert.ok(lat.length >= 10, `status was polled during the build (${lat.length} samples)`);
    assert.ok(max < fnMs / 2, `/api/status longest gap ${max.toFixed(0)} ms during a ${Math.round(fnMs)} ms build`);

    /* Control: the same poll over a synchronous block of 600 ms reads it. Without this a loose bound could pass a build on the loop. */
    const blockMs = 600;
    const blocked = await whileStatusPolled(base, async () => {
      await new Promise((r) => setTimeout(r, 30)); // let a poll be in flight
      const end = performance.now() + blockMs;
      while (performance.now() < end) { /* the server's loop is this thread's loop */ }
      await new Promise((r) => setTimeout(r, 30));
    });
    const blockedMax = Math.max(...blocked.lat);
    assert.ok(blockedMax >= blockMs * 0.8 && blockedMax >= blocked.ms / 2, `control: a ${blockMs} ms block read as a ${blockedMax.toFixed(0)} ms stall in a ${Math.round(blocked.ms)} ms window`);
  } finally {
    stopWarmScanWorker();
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    fs.rmSync(big, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
