import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ArchGraph } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { FUNCTIONS_FILE } from '../server/store.js';
import {
  buildRepoFunctionGraphCached,
  readCachedFunctionGraph,
  FUNCTION_GRAPH_CACHE_VERSION,
} from '../server/functionGraphCache.js';

/**
 * `.sequence/functions.json` used to be written and read in one place — inside
 * `GET /api/functions`. Lifting it into `functionGraphCache.ts` gave the MCP server
 * the same cache, which is what makes `who_calls <function>` usable at all:
 * `buildRepoFunctionGraph` re-parses the whole repo (3.1 s on this monorepo), the app
 * server hid that behind an in-process memo, and the MCP server is a fresh process
 * per client. Measured through the tool: **3,939 ms cold, 155 ms warm**.
 *
 * A cache is only allowed to be a speedup, so these pin the three things that would
 * make it something else: a hit must return the SAME graph, a rescan must be a MISS,
 * and a corrupt file must degrade to a rebuild rather than throw.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

/** Work on a COPY: the cache writes into the repo it scans, and fixtures are source. */
function fixtureCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-fn-cache-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  fs.rmSync(path.join(repo, '.sequence'), { recursive: true, force: true });
  return repo;
}

const cacheFile = (repo: string): string => path.join(repo, '.sequence', FUNCTIONS_FILE);

test('a second build of the same scan is served from disk, byte-identical', async () => {
  const repo = fixtureCopy();
  try {
    const graph: ArchGraph = await scanRepo(repo, { cluster: true });
    const first = await buildRepoFunctionGraphCached(repo, graph);
    assert.ok(first.functionGraph.nodes.length > 0, 'the fixture must yield real function nodes');
    assert.ok(fs.existsSync(cacheFile(repo)), 'the first build must persist the cache');

    const second = await buildRepoFunctionGraphCached(repo, graph);
    // Not "the same shape" — the same bytes. A cache that returns an equivalent-but-
    // different graph is a second implementation of the builder, and it will drift.
    assert.equal(JSON.stringify(second.functionGraph), JSON.stringify(first.functionGraph));
    // Warnings are read-and-clear at the source, so a cache hit that dropped them
    // would make a cached answer LESS qualified than a fresh one. Replayed instead.
    assert.deepEqual(second.warnings, first.warnings);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a rescan is a MISS — the cache can never serve a graph the code disproves', async () => {
  const repo = fixtureCopy();
  try {
    const before = await buildRepoFunctionGraphCached(repo, await scanRepo(repo, { cluster: true }));
    const target = path.join(repo, 'gateway', 'src', 'routes', 'orders.ts');
    assert.ok(fs.existsSync(target), 'fixture assumption: gateway/src/routes/orders.ts exists');
    assert.ok(!before.functionGraph.nodes.some((n) => n.name === 'aFunctionAddedByTheCacheTest'));

    fs.appendFileSync(
      target,
      '\nexport function aFunctionAddedByTheCacheTest(): number {\n  return 1;\n}\n',
    );
    // The assertion is about the OUTCOME — the graph knows about code that exists —
    // not about a key string having changed. A cache keyed correctly but returning a
    // stale graph would still pass a key-equality check.
    const after = await buildRepoFunctionGraphCached(repo, await scanRepo(repo, { cluster: true }));
    assert.ok(
      after.functionGraph.nodes.some((n) => n.name === 'aFunctionAddedByTheCacheTest'),
      'an edit + rescan must force a rebuild',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a corrupt or wrong-version cache degrades to a rebuild instead of throwing', async () => {
  const repo = fixtureCopy();
  try {
    const graph: ArchGraph = await scanRepo(repo, { cluster: true });
    const scannedAt = String((graph as { scannedAt?: string }).scannedAt ?? '');
    const good = await buildRepoFunctionGraphCached(repo, graph);
    assert.ok(readCachedFunctionGraph(repo, scannedAt), 'a matching read must hit');

    fs.writeFileSync(cacheFile(repo), '{ this is not json');
    assert.equal(readCachedFunctionGraph(repo, scannedAt), null, 'garbage reads as no cache');
    const afterGarbage = await buildRepoFunctionGraphCached(repo, graph);
    assert.equal(afterGarbage.functionGraph.nodes.length, good.functionGraph.nodes.length);

    fs.writeFileSync(
      cacheFile(repo),
      JSON.stringify({
        version: FUNCTION_GRAPH_CACHE_VERSION + 1,
        scannedAt,
        functionGraph: { nodes: [], edges: [] },
      }),
    );
    assert.equal(
      readCachedFunctionGraph(repo, scannedAt),
      null,
      'a future format version reads as no cache, not as an empty graph',
    );
    const afterVersion = await buildRepoFunctionGraphCached(repo, graph);
    assert.equal(afterVersion.functionGraph.nodes.length, good.functionGraph.nodes.length);

    // A stale key must miss too, or an edited repo is answered from the old parse.
    assert.equal(readCachedFunctionGraph(repo, 'some-other-scan'), null);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
