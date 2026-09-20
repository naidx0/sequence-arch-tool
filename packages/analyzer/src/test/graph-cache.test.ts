import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { scanRepo } from '../scan.js';
import {
  computeSignature,
  readCachedGraph,
  writeCachedGraph,
  GRAPH_CACHE_FILE,
} from '../server/graphCache.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * The PERSISTENCE MOAT lock (graphCache.ts + attachRepo wiring). Scan a repo once
 * into a persisted grounded graph; on re-open of unchanged content load the
 * cached graph verbatim (same `scannedAt` ⇒ scanRepo was skipped) instead of
 * re-crawling. Every test runs against a real fixture copied to a tmp dir so it
 * can be mutated. Mirrors the fixture-copy + server-start style of
 * file-write.test.ts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

/** A throwaway copy of the shopfront fixture — mutations never touch the fixture. */
function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-graphcache-'));
  const repo = path.join(dir, 'repo');
  // EXCLUDE `.sequence`. It is cache, not fixture source — `.gitignore` carries
  // `**/.sequence/graph.json` precisely because it is generated — but anyone who has
  // ever scanned the fixture has one sitting in their working tree, invisible to
  // `git status`, and a recursive copy brought it along.
  //
  // That quietly falsified this whole file. Every test here that says "no cache yet"
  // was in fact starting from a FOREIGN cache, written for a different absolute path;
  // the server found its content signature valid and served it, so
  // `attachAndReadGraph` returned a graph whose `repoRoot` and `repoName` still named
  // the original fixture directory rather than the temp copy. The drift test then
  // compared a graph describing one directory against a fresh scan of another and
  // reported real, correct drift about a situation the test never meant to create.
  //
  // Worth stating separately, because excluding the directory hides it: a cached
  // graph DOES carry the `repoRoot` and `repoName` of wherever it was built, so a
  // repo that is copied or moved is served its old identity from cache. That is a
  // product question — should the signature include the path, or should the loader
  // overwrite identity with the attach path? — and it is deliberately not answered
  // here.
  fs.cpSync(SHOPFRONT, repo, {
    recursive: true,
    filter: (src) => path.basename(src) !== '.sequence',
  });
  return repo;
}

function cacheFilePath(repo: string): string {
  return path.join(repo, '.sequence', GRAPH_CACHE_FILE);
}

async function startServer(
  repoRoot: string | null
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Attach the repo (constructor attach), read the served graph, and shut down. */
async function attachAndReadGraph(repo: string): Promise<ArchGraph> {
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/archgraph.json`);
    assert.strictEqual(res.status, 200);
    return (await res.json()) as ArchGraph;
  } finally {
    await close();
  }
}

test('cache hit: re-attaching unchanged content skips scanRepo (same scannedAt) and deep-equals', async () => {
  const repo = shopfrontRepo();
  // First attach: no cache yet ⇒ scans and persists graph.json.
  const first = await attachAndReadGraph(repo);
  assert.ok(fs.existsSync(cacheFilePath(repo)), 'graph.json must be written on first attach');
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8'));
  assert.strictEqual(typeof stored.signature, 'string');
  assert.ok(stored.signature.length > 0, 'cache file carries a signature');

  // Second attach: content unchanged ⇒ MUST load from cache, NOT re-scan. A real
  // re-scan mints a fresh scannedAt, so an identical scannedAt proves the skip.
  const second = await attachAndReadGraph(repo);
  assert.strictEqual(
    second.scannedAt,
    first.scannedAt,
    'cache hit must preserve scannedAt (proves scanRepo was skipped)'
  );
  assert.deepStrictEqual(second, first, 'cache-loaded graph must be identical');
});

test('cache equals scan: cache-loaded graph deep-equals a fresh scanRepo (no drift)', async () => {
  const repo = shopfrontRepo();
  const cachedGraph = await attachAndReadGraph(repo); // populates + reads cache (JSON form)
  // Compare against the JSON-normalized fresh scan — the graph is always
  // persisted/served as JSON, so that is its canonical form (JSON drops explicit
  // `undefined` props; comparing a raw in-memory object would flag those as false
  // drift). scannedAt legitimately differs (fresh scan mints a new one).
  const freshGraph = JSON.parse(JSON.stringify(await scanRepo(repo, {}))) as ArchGraph;
  const normRoot = (g: ArchGraph) => ({ ...g, repoRoot: fs.realpathSync(g.repoRoot) });
  // `nodeDetail` is an HTTP ENVELOPE field, not graph content, so it is dropped from
  // the served side to compare like with like. `GET /archgraph.json` sends
  // `{ ...currentGraph, nodeDetail: currentNodeDetail ?? {} }` (repoServer.ts, two
  // sites), and `currentNodeDetail` is DERIVED at serve time from the graph by
  // `seqdNodeDetailFromStructuralTree`. It is absent from the ArchGraph schema and
  // never written to `.sequence/graph.json`, so a raw `scanRepo()` result has no such
  // key and the comparison could never pass.
  //
  // This does not soften the invariant. Cache drift is a difference in what was
  // PERSISTED versus what a fresh scan produces; a field computed from the graph on
  // its way out of the server cannot carry drift the graph itself does not already
  // have — and any drift in the graph still fails below. Everything else is compared
  // strictly and deeply, exactly as before.
  const { scannedAt: _a, nodeDetail: _envelope, ...cachedRest } = normRoot(cachedGraph) as
    ReturnType<typeof normRoot> & { nodeDetail?: unknown };
  const { scannedAt: _b, ...freshRest } = normRoot(freshGraph);
  assert.deepStrictEqual(cachedRest, freshRest, 'cache must not drift from a fresh scan');
});

test('invalidation: editing a source file changes the signature and forces a re-scan', async () => {
  const repo = shopfrontRepo();
  const first = await attachAndReadGraph(repo);
  const sigBefore = await computeSignature(repo, {});
  const storedSigBefore = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8')).signature;
  assert.strictEqual(storedSigBefore, sigBefore, 'persisted signature matches computed');

  // Mutate a real source file (append a line — changes size + mtime).
  const target = path.join(repo, 'orders', 'app', 'main.py');
  fs.appendFileSync(target, '\n# persistence-moat test edit\n');

  const sigAfter = await computeSignature(repo, {});
  assert.notStrictEqual(sigAfter, sigBefore, 'a source edit must change the signature');

  // Re-attach ⇒ signature mismatch ⇒ real re-scan (new scannedAt) + rewritten cache.
  const second = await attachAndReadGraph(repo);
  assert.notStrictEqual(
    second.scannedAt,
    first.scannedAt,
    'a changed repo must re-scan (new scannedAt)'
  );
  const storedSigAfter = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8')).signature;
  assert.strictEqual(storedSigAfter, sigAfter, 'cache rewritten with the new signature');
});

test('signature stability: two computes with no change are equal', async () => {
  const repo = shopfrontRepo();
  const a = await computeSignature(repo, {});
  const b = await computeSignature(repo, {});
  assert.strictEqual(a, b, 'signature must be stable across calls with no change');
});

test('.sequence ignored: writing graph.json does not change the signature (no self-invalidation)', async () => {
  const repo = shopfrontRepo();
  const before = await computeSignature(repo, {});
  // Write the cache INTO .sequence, exactly as attach does.
  const graph = await scanRepo(repo, {});
  writeCachedGraph(repo, before, graph);
  assert.ok(fs.existsSync(cacheFilePath(repo)), 'graph.json now exists under .sequence');
  const after = await computeSignature(repo, {});
  assert.strictEqual(after, before, 'the cache file must not be an input to its own signature');
});

test('signature reflects scan options: changing opts invalidates', async () => {
  const repo = shopfrontRepo();
  const a = await computeSignature(repo, { cluster: true });
  const b = await computeSignature(repo, { cluster: false });
  assert.notStrictEqual(a, b, 'a scan-relevant option change must change the signature');
});

test('robustness: a corrupt graph.json returns null and attach falls back to a scan', async () => {
  const repo = shopfrontRepo();
  // Seed garbage where the cache lives.
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(cacheFilePath(repo), 'this is not json {{{');
  assert.strictEqual(readCachedGraph(repo), null, 'corrupt cache reads as null (never throws)');

  // Attach must not throw — it falls back to a real scan and rewrites the cache.
  const graph = await attachAndReadGraph(repo);
  assert.ok(graph.nodes.length > 0, 'attach produced a real graph despite the corrupt cache');
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8'));
  assert.strictEqual(typeof stored.signature, 'string', 'corrupt cache was overwritten with a valid one');
});

test('wrong-version cache is ignored (re-scan)', async () => {
  const repo = shopfrontRepo();
  await attachAndReadGraph(repo); // valid cache
  const good = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8'));
  fs.writeFileSync(cacheFilePath(repo), JSON.stringify({ ...good, version: 9999 }));
  assert.strictEqual(readCachedGraph(repo), null, 'a wrong-version cache reads as null');
});

test('force scan: POST /api/scan re-scans even on a cache hit (new scannedAt) and rewrites the cache', async () => {
  const repo = shopfrontRepo();
  const { base, close } = await startServer(repo);
  try {
    const before = (await (await fetch(`${base}/archgraph.json`)).json()) as ArchGraph;
    const storedSigBefore = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8')).signature;

    // No content change ⇒ signature identical ⇒ a cache-aware path would skip.
    // POST /api/scan MUST force a fresh scan anyway.
    const res = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const rescanned = (await res.json()) as ArchGraph;
    assert.notStrictEqual(
      rescanned.scannedAt,
      before.scannedAt,
      'POST /api/scan must always re-scan (new scannedAt)'
    );
    // Cache rewritten (signature unchanged since content is unchanged, but the
    // stored graph now carries the new scannedAt).
    const storedAfter = JSON.parse(fs.readFileSync(cacheFilePath(repo), 'utf8'));
    assert.strictEqual(storedAfter.signature, storedSigBefore, 'signature unchanged (no content change)');
    assert.strictEqual(
      storedAfter.graph.scannedAt,
      rescanned.scannedAt,
      'cache rewritten with the freshly scanned graph'
    );
  } finally {
    await close();
  }
});

test('PUT /api/file invalidates the persisted cache so the next attach re-scans', async () => {
  const repo = shopfrontRepo();
  const first = await attachAndReadGraph(repo);
  assert.ok(fs.existsSync(cacheFilePath(repo)), 'cache exists after first attach');

  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: path.join('gateway', 'src', 'index.ts'),
        content: 'export const moatEdit = 1;\n',
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.ok(!fs.existsSync(cacheFilePath(repo)), 'PUT /api/file must invalidate the on-disk cache');
  } finally {
    await close();
  }

  // Next attach re-scans the changed content (new scannedAt) and re-persists.
  const second = await attachAndReadGraph(repo);
  assert.notStrictEqual(second.scannedAt, first.scannedAt, 'edited repo re-scans on next attach');
  assert.ok(fs.existsSync(cacheFilePath(repo)), 'cache re-persisted after the re-scan');
});
