/**
 * 019-P2C review fixes: a file that changes (or goes) between the scan's stat and the moment something reads it.
 *
 * The seam is deterministic: `onProgress(done === total)` fires once the parse pass has settled every file by
 * its stat and before the detectors run, so a write made there lands exactly in the window.
 *
 *   1. changed in the window, with the detectors' key changed this scan: the detections are those of the bytes
 *      verified, never stored under the old sha; after the file returns to that content a rescan == fresh
 *   2. removed in the window (or listed by a stale snapshot): the scan completes, the file is dropped with a warning
 *   3. nginx confs under dot directories (`.env/` is a common venv name) are not scanned, as before
 */
import assert from 'node:assert';
import { test, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { initParser, parsedFileCount } from '../parse/treesitter.js';
import { computePartSignatures, computeSignature, takeFileSnapshot } from '../server/graphCache.js';
import { RACY_MS } from '../parse/scanIndex.js';
import { runScan, scanWorkerFile, stopWarmScanWorker, takePrecomputedNodeDetail } from '../scan/scanRunner.js';
import { seqdNodeDetailFromStructuralTree } from '../explain/seqdEnrichment.js';

before(async () => {
  await initParser();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

function repo(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-race-'));
  const dir = path.join(tmp, 'shopfront');
  fs.cpSync(path.join(FIXTURES, 'shopfront'), dir, { recursive: true });
  const old = new Date(Date.now() - 10 * RACY_MS); // past the racy window: stat matches are trusted
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else fs.utimesSync(f, old, old);
    }
  };
  walk(dir);
  return dir;
}
const rm = (dir: string): void => fs.rmSync(path.dirname(dir), { recursive: true, force: true });
const strip = (g: object): string => {
  const { scannedAt: _s, ...rest } = g as { scannedAt?: string };
  void _s;
  return JSON.stringify(rest);
};
const addService = (dir: string): void => fs.appendFileSync(path.join(dir, 'docker-compose.yml'), '\n  mongo:\n    image: mongo:7\n');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

for (const keepFacts of [false, true]) {
  test(`changed in the window (facts.v8 ${keepFacts ? 'present' : 'absent'}): nothing is stored under the old sha`, async () => {
    const dir = repo();
    try {
      const F = path.join(dir, 'orders', 'app', 'db.py');
      const C2 = fs.readFileSync(F, 'utf8');
      const C1 = C2.replace(/FROM orders WHERE/, 'FROM ledger WHERE').replace(/INSERT INTO orders/, 'INSERT INTO ledger');
      assert.notStrictEqual(C1, C2, 'the specimen has SQL to change');
      await scanRepo(dir, { factsCache: true });
      await settle();
      addService(dir); // every service's detector key changes: the stub's file is read at detection time
      if (!keepFacts) fs.rmSync(path.join(dir, '.sequence', 'cache', 'facts.v8'), { force: true });
      let swapped = false;
      await scanRepo(dir, {
        factsCache: true,
        onProgress: (done, total) => {
          if (done === total && !swapped) {
            swapped = true;
            fs.writeFileSync(F, C1);
          }
        },
      });
      assert.ok(swapped, 'the write landed in the window');
      fs.writeFileSync(F, C2); // back to the content the record describes
      const fresh = strip(await scanRepo(dir, { factsCache: false }));
      for (let i = 0; i < 2; i++) {
        assert.strictEqual(strip(await scanRepo(dir, { factsCache: true })), fresh, `rescan ${i} after the file returned == fresh`);
        await settle();
      }
    } finally {
      rm(dir);
    }
  });
}

test('removed in the window, or listed by a stale snapshot: the scan completes and drops the file', async () => {
  const dir = repo();
  try {
    await scanRepo(dir, { factsCache: true });
    await settle();
    const target = path.join(dir, 'orders', 'app', 'db.py');
    // (a) the stat-trusted file goes between the stat and the detectors
    addService(dir);
    let removed = false;
    const g = await scanRepo(dir, {
      factsCache: true,
      onProgress: (done, total) => {
        if (done === total && !removed) {
          removed = true;
          fs.rmSync(target);
        }
      },
    });
    assert.ok(removed);
    assert.ok(g.warnings.some((w) => w.includes('orders/app/db.py')), 'dropped with a warning');
    assert.strictEqual(strip(await scanRepo(dir, { factsCache: true })), strip(await scanRepo(dir, { factsCache: false })), 'the next rescan == fresh');

    // (b) a snapshot taken before the file went still lists it
    fs.writeFileSync(target, 'import os\n');
    const old = new Date(Date.now() - 10 * RACY_MS);
    fs.utimesSync(target, old, old);
    await scanRepo(dir, { factsCache: true });
    await settle();
    const sigs = await computePartSignatures(dir, {});
    const snapshot = takeFileSnapshot(sigs.signature);
    assert.ok(snapshot);
    fs.rmSync(target);
    fs.appendFileSync(path.join(dir, 'docker-compose.yml'), '\n  redisx:\n    image: redis:7\n');
    await scanRepo(dir, { factsCache: true, fileSnapshot: snapshot });
    assert.strictEqual(strip(await scanRepo(dir, { factsCache: true })), strip(await scanRepo(dir, { factsCache: false })));
  } finally {
    rm(dir);
  }
});

test('nginx confs under a dot directory are not scanned (the shared walk keeps `.env`)', async () => {
  const dir = repo();
  try {
    const conf = fs.readFileSync(path.join(dir, 'edge', 'default.conf'), 'utf8');
    fs.mkdirSync(path.join(dir, 'edge', '.env'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'edge', '.env', 'extra.conf'), conf);
    const plain = strip(await scanRepo(dir, { factsCache: false }));
    assert.ok(!plain.includes('.env/extra.conf'), 'the plain scan skips it');
    assert.strictEqual(strip(await scanRepo(dir, { factsCache: true })), plain, 'and so does the cached scan');
  } finally {
    rm(dir);
  }
});

test('a worker cut between the index save and the facts save leaves a store that heals', async () => {
  const dir = repo();
  try {
    let p1: { index: () => void; facts: () => void } | undefined;
    await scanRepo(dir, { factsCache: true, deferCachePersist: (p) => (p1 = p) });
    p1!.index(); // the cut: the index is on disk, the facts never were
    const cache = path.join(dir, '.sequence', 'cache');
    assert.ok(fs.existsSync(path.join(cache, 'scan-index.v8')) && !fs.existsSync(path.join(cache, 'facts.v8')));

    // The next scan trusts the index; asking for the heavy facts of every file finds the store empty and must put them back.
    let p2: { index: () => void; facts: () => void } | undefined;
    const before = parsedFileCount();
    await scanRepo(dir, { factsCache: true, deferCachePersist: (p) => (p2 = p), onServiceFacts: () => undefined });
    const reparsed = parsedFileCount() - before;
    assert.ok(reparsed > 5, `every stub re-parsed once (${reparsed})`);
    p2!.facts();
    p2!.index();
    assert.ok(fs.statSync(path.join(cache, 'facts.v8')).size > 10_000, 'facts.v8 was rewritten with what the re-parse produced');

    const again = parsedFileCount();
    await scanRepo(dir, { factsCache: true, onServiceFacts: () => undefined });
    assert.strictEqual(parsedFileCount() - again, 0, 'the next scan re-parses nothing');
  } finally {
    rm(dir);
  }
});

test('temp files a killed writer left in the cache are swept; fresh ones and our own are not', async () => {
  const dir = repo();
  try {
    const cache = path.join(dir, '.sequence', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    const stale = path.join(cache, 'facts.v8.424242.1700000000000.tmp');
    const fresh = path.join(cache, 'facts.v8.424243.1700000000001.tmp');
    const own = path.join(cache, `scan-index.v8.${process.pid}.1700000000002.tmp`);
    for (const f of [stale, fresh, own]) fs.writeFileSync(f, 'x');
    const old = new Date(Date.now() - 60 * 60_000);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(own, old, old);
    await scanRepo(dir, { factsCache: true });
    assert.ok(!fs.existsSync(stale), 'the hour-old temp file of another process is gone');
    assert.ok(fs.existsSync(fresh), 'a recent one may be a live writer');
    assert.ok(fs.existsSync(own), 'our own is never swept');
  } finally {
    rm(dir);
  }
});

test('the signature walk hands the event loop back while it runs (it used to hold it for the whole walk)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sigyield-'));
  try {
    for (let d = 0; d < 40; d++) {
      const sub = path.join(tmp, `d${d}`);
      fs.mkdirSync(sub);
      for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(sub, `f${i}.txt`), 'x');
    }
    /* Runs `work` under a 0 ms timer; returns how often the loop turned, its longest single stall and the whole time. */
    const watched = async (work: () => Promise<unknown>): Promise<{ ticks: number; longest: number; ms: number }> => {
      let ticks = 0;
      let longest = 0;
      const t0 = performance.now();
      let last = t0;
      const timer = setInterval(() => {
        const now = performance.now();
        longest = Math.max(longest, now - last);
        last = now;
        ticks += 1;
      }, 0);
      try {
        await work();
      } finally {
        clearInterval(timer);
      }
      const end = performance.now();
      return { ticks, longest: Math.max(longest, end - last), ms: end - t0 };
    };
    let a!: Awaited<ReturnType<typeof computePartSignatures>>;
    const walk = await watched(async () => { a = await computePartSignatures(tmp, {}); });
    /* The stall is judged against the walk: one that held the loop for the whole walk has a longest stall of about its whole duration, at any load. */
    assert.ok(walk.ticks >= 2, `the loop turned ${walk.ticks} times during a 4,000-file walk`);
    assert.ok(walk.longest < walk.ms / 2, `no single stall of ${walk.longest.toFixed(0)} ms in a ${walk.ms.toFixed(0)} ms walk`);
    /* Control: the same tree walked synchronously reads as one stall of about the whole walk, and the loop does not turn. */
    const syncWalk = await watched(async () => {
      await new Promise((r) => setTimeout(r, 5)); // let the timer start
      for (const d of fs.readdirSync(tmp)) for (const f of fs.readdirSync(path.join(tmp, d))) fs.statSync(path.join(tmp, d, f));
    });
    assert.ok(syncWalk.longest > syncWalk.ms / 2, `control: a synchronous walk read as ${syncWalk.ticks} ticks, longest ${syncWalk.longest.toFixed(0)} of ${syncWalk.ms.toFixed(0)} ms`);
    const b = await computePartSignatures(tmp, {});
    assert.strictEqual(a.signature, b.signature, 'and the signature is still a pure function of the tree');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the worker hands back the graph in parts and the node detail with it, equal to what the main thread would compute', async (t) => {
  if (!scanWorkerFile()) return t.skip('no scan worker in this build');
  const dir = repo();
  try {
    const run = await runScan({ root: dir, signature: await computeSignature(dir, {}), functions: false });
    assert.strictEqual(run.timing.mode, 'worker');
    assert.strictEqual(strip(run.graph), strip(await scanRepo(dir, {})), 'the parts re-assemble to the graph, key order included');
    const detail = takePrecomputedNodeDetail(run.graph);
    assert.ok(detail, 'the node detail came with the graph');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(detail)), JSON.parse(JSON.stringify(seqdNodeDetailFromStructuralTree(run.graph))));
    assert.strictEqual(takePrecomputedNodeDetail(run.graph), undefined, 'and is claimed once');
  } finally {
    stopWarmScanWorker();
    rm(dir);
  }
});
