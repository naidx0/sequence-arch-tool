import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { scanRepo } from '../scan.js';
import {
  computeSignature,
  computePartSignatures,
  readCachedGraph,
  writeCachedGraph,
  scanRepoCached,
  readCachedPart,
  slicePart,
  clearCachedGraph,
  ROOT_PART,
} from '../server/graphCache.js';

/**
 * ITEM 1.4 LOCK — incremental cache invalidation.
 *
 * The defect this file locks: `computeSignature` folded the WHOLE tree into ONE
 * string, so a write anywhere invalidated the cache everywhere. In a monorepo
 * that means editing `packages/mcp` throws away everything the cache knew about
 * `packages/web` and the next question about `packages/web` pays a full
 * `scanRepo` — measured on this repository at **3,275 ms** (of which
 * `extractFacts` is 2,600 ms), against ripgrep's ~40 ms.
 *
 * The invariant asserted here is NOT a millisecond number (that flakes on a
 * loaded machine). It is that the **`packages/web` cache entry survives a
 * `packages/mcp` write** — and, crucially, that the surviving entry is not
 * merely fast but CORRECT: it is compared, node for node and edge for edge,
 * against a fresh `scanRepo` performed AFTER the write. A cache that survives
 * by serving stale facts would be worse than no cache at all, so the survival
 * assertion and the no-drift assertion are always made together.
 */

/** Repo-relative POSIX path, so an assertion reads the same on Windows and macOS. */
const rel = (p: string): string => p.split(path.sep).join('/');

/**
 * A throwaway two-package monorepo: `packages/web` (three files, two internal
 * imports) and `packages/mcp` (two files, one internal import). Small on
 * purpose — the property under test is which PART invalidates, and that is
 * independent of size. The measured cost of getting it wrong is pinned from the
 * real repository in the header comment above, not from this fixture.
 */
function monorepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-cache-inc-'));
  const repo = path.join(dir, 'monorepo');
  const w = (r: string, body: string): void => {
    const p = path.join(repo, r);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf8');
  };
  w('package.json', JSON.stringify({ name: 'monorepo', private: true, workspaces: ['packages/*'] }));
  w('README.md', 'a repo-root file that belongs to no package\n');
  w('packages/web/package.json', JSON.stringify({ name: '@x/web', version: '0.0.0' }));
  w(
    'packages/web/src/store.ts',
    'export function makeStore() {\n  return { count: 0 };\n}\nexport function bumpStore(s) {\n  s.count += 1;\n  return s;\n}\n'
  );
  w(
    'packages/web/src/index.ts',
    "import { makeStore, bumpStore } from './store.js';\nexport function boot() {\n  const s = makeStore();\n  return bumpStore(s);\n}\n"
  );
  w(
    'packages/web/src/panel.ts',
    "import { bumpStore } from './store.js';\nexport function onClick(s) {\n  return bumpStore(s);\n}\n"
  );
  w('packages/mcp/package.json', JSON.stringify({ name: '@x/mcp', version: '0.0.0' }));
  w('packages/mcp/src/index.ts', "export function listTools() {\n  return ['who_calls'];\n}\n");
  w(
    'packages/mcp/src/graphQuery.ts',
    "import { listTools } from './index.js';\nexport function whoCalls(name) {\n  return listTools().filter((t) => t === name);\n}\n"
  );
  return repo;
}

const OPTS = { cluster: true } as const;

/** The question the locking test asks of `packages/web`: who imports `store.ts`? */
function importersOfStore(edges: { srcId: string; dstId: string; kind: string }[]): string[] {
  return edges
    .filter((e) => e.kind === 'import' && rel(e.dstId).endsWith('packages/web/src/store.ts'))
    .map((e) => rel(e.srcId))
    .sort();
}

test('1.4 — a packages/mcp write does not invalidate the packages/web cache entry', async () => {
  const repo = monorepo();

  // --- cold: one full scan populates the cache -------------------------------
  const cold = await scanRepoCached(repo, OPTS);
  const coldScannedAt = cold.scannedAt;
  const cachedCold = readCachedGraph(repo);
  assert.ok(cachedCold, 'the cold scan must have persisted a cache file');
  assert.ok(cachedCold.parts, 'the cache file must carry PER-PART signatures, not one whole-tree hash');
  assert.ok(
    Object.keys(cachedCold.parts).includes('packages/web') &&
      Object.keys(cachedCold.parts).includes('packages/mcp'),
    `both workspace packages must be their own cache part; got ${Object.keys(cachedCold.parts).join(', ')}`
  );

  // --- the write, in packages/mcp and ONLY in packages/mcp -------------------
  fs.writeFileSync(
    path.join(repo, 'packages/mcp/src/newTool.ts'),
    "import { listTools } from './index.js';\nexport function describeTools() {\n  return listTools().join(',');\n}\n",
    'utf8'
  );

  // The whole-repo signature still changes — that is correct and must not
  // regress: SOMETHING in this repo did change.
  const wholeAfter = await computeSignature(repo, OPTS);
  assert.notStrictEqual(
    wholeAfter,
    cachedCold.signature,
    'the whole-repo signature must still notice a write anywhere (no false cache hit)'
  );

  // --- the invariant: which parts changed ------------------------------------
  const partsAfter = await computePartSignatures(repo, OPTS);
  assert.notStrictEqual(
    partsAfter.parts['packages/mcp'],
    cachedCold.parts['packages/mcp'],
    'the written package MUST invalidate'
  );
  assert.strictEqual(
    partsAfter.parts['packages/web'],
    cachedCold.parts['packages/web'],
    'THE INVARIANT: a write in packages/mcp must leave the packages/web signature untouched'
  );
  assert.strictEqual(
    partsAfter.parts[ROOT_PART],
    cachedCold.parts[ROOT_PART],
    'a write inside a package must not invalidate the repo-root part either'
  );

  // --- the query: answer a packages/web question WITHOUT a rescan ------------
  const t0 = performance.now();
  const web = readCachedPart(repo, 'packages/web', partsAfter);
  const ms = performance.now() - t0;
  assert.ok(web, 'the packages/web cache entry must SURVIVE the packages/mcp write');
  assert.strictEqual(
    web.scannedAt,
    coldScannedAt,
    'the surviving entry must be served from the cold scan verbatim — a different scannedAt means scanRepo ran'
  );
  assert.deepStrictEqual(
    importersOfStore(web.edges),
    ['packages/web/src/index.ts', 'packages/web/src/panel.ts'].map((p) => `file:${p}`),
    'the surviving entry must still answer "who imports store.ts" with both importers'
  );
  // Reported, never asserted: the number is evidence, the survival is the lock.
  console.log(`[1.4] packages/web answered from cache in ${ms.toFixed(1)} ms after a packages/mcp write`);

  // --- no drift: the surviving entry equals a FRESH scan of the same bytes ---
  const fresh = await scanRepo(repo, OPTS);
  const byId = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
  // Membership first, against the RAW fresh scan: exactly the same nodes, no more, no fewer.
  assert.deepStrictEqual(
    byId(slicePart(fresh, 'packages/web', partsAfter).nodes).map((n) => n.id),
    byId(web.nodes).map((n) => n.id),
    'the surviving packages/web entry must hold exactly the nodes a fresh scan produces'
  );
  // Then every field. Compared through ONE `JSON.parse(JSON.stringify(...))` because
  // that is precisely the transformation the persisted cache applies, and JSON drops
  // explicitly-`undefined` keys (`meta.framework` is set to `undefined` at
  // `scan.ts`'s service-node build). That is a pre-existing property of the cache, not
  // of this change, and it is the only difference: the id comparison above is made
  // against the un-round-tripped graph, so a genuinely missing or extra node fails
  // before this line is reached.
  const freshWeb = slicePart(JSON.parse(JSON.stringify(fresh)) as typeof fresh, 'packages/web', partsAfter);
  assert.deepStrictEqual(
    byId(web.nodes),
    byId(freshWeb.nodes),
    'the surviving packages/web entry must contain exactly the nodes a fresh scan produces — every field, not just the ids'
  );
  // Edges are compared on every field EXCEPT `id`, and the reason is itself locked
  // below: `ArchEdge.id` for an import is `imp${++importSeq}` (`scan.ts:789`), a
  // counter over the WHOLE scan. Adding a file to packages/mcp renumbers every import
  // edge discovered after it, so the fresh scan calls these edges imp3/imp4 where the
  // cache calls them imp2/imp3 — with byte-identical src, dst, kind, confidence,
  // origin and evidence. That is scan ordinality, not drift, and asserting on the
  // ordinal would lock in a number that means nothing.
  const edgeFacts = (es: typeof web.edges): unknown[] =>
    [...es]
      .map(({ id: _ordinal, ...rest }) => rest)
      .sort((a, b) => (`${a.srcId}->${a.dstId}` < `${b.srcId}->${b.dstId}` ? -1 : 1));
  assert.deepStrictEqual(
    edgeFacts(web.edges),
    edgeFacts(freshWeb.edges),
    'the surviving packages/web entry must contain exactly the edges a fresh scan produces — evidence included'
  );
  assert.notDeepStrictEqual(
    byId(web.edges).map((e) => e.id),
    byId(freshWeb.edges).map((e) => e.id),
    'LOCKED FINDING: ArchEdge.id is a whole-scan ordinal, so an unrelated write renumbers it. ' +
      'If this ever starts matching, edge ids have become content-derived and the exclusion above should go.'
  );
  assert.strictEqual(
    web.omittedCrossPart,
    freshWeb.omittedCrossPart,
    'the surviving entry must report the same number of cross-part omissions as a fresh scan'
  );

  // --- the written package correctly does NOT survive ------------------------
  assert.strictEqual(
    readCachedPart(repo, 'packages/mcp', partsAfter),
    null,
    'the WRITTEN package must miss — an incremental cache that keeps the changed part is a stale-serve bug'
  );

  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('1.4 — an unchanged repo is still a verbatim whole-graph hit', async () => {
  const repo = monorepo();
  const first = await scanRepoCached(repo, OPTS);
  const second = await scanRepoCached(repo, OPTS);
  assert.strictEqual(
    second.scannedAt,
    first.scannedAt,
    'an unchanged repo must serve the cached graph verbatim (same scannedAt ⇒ scanRepo was skipped)'
  );
  const parts = await computePartSignatures(repo, OPTS);
  for (const key of Object.keys(parts.parts)) {
    assert.ok(readCachedPart(repo, key, parts), `every part must be fresh on an unchanged repo; ${key} was not`);
  }
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('1.4 — invalidating one part leaves the others readable', async () => {
  const repo = monorepo();
  await scanRepoCached(repo, OPTS);
  // The PUT /api/file invalidation path, scoped to the file it wrote.
  clearCachedGraph(repo, path.join(repo, 'packages/mcp/src/index.ts'));
  const parts = await computePartSignatures(repo, OPTS);
  assert.strictEqual(
    readCachedPart(repo, 'packages/mcp', parts),
    null,
    'the explicitly invalidated part must be gone'
  );
  assert.ok(
    readCachedPart(repo, 'packages/web', parts),
    'invalidating packages/mcp must not take packages/web with it'
  );
  // …and the unscoped call still nukes everything, unchanged for existing callers.
  clearCachedGraph(repo);
  assert.strictEqual(readCachedGraph(repo), null, 'an unscoped clear still removes the whole cache');
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('1.4 — the three-argument writeCachedGraph still persists per-part signatures', async () => {
  // `repoServer.attachRepo` and `forceScan` call `computeSignature(root)` and then
  // `writeCachedGraph(root, signature, graph)` with no part map. If that path wrote a
  // partless cache, the app server would populate `graph.json` and every part read
  // would miss forever — the failure would be silent and would look like "the cache
  // works" because the WHOLE-graph hit still works. This is the seam that guards it.
  const repo = monorepo();
  const signature = await computeSignature(repo, OPTS);
  const graph = await scanRepo(repo, OPTS);
  writeCachedGraph(repo, signature, graph);
  const cached = readCachedGraph(repo);
  assert.ok(cached, 'the three-argument write must persist a readable cache');
  assert.strictEqual(cached.signature, signature, 'and tag it with the signature it was given');
  assert.deepStrictEqual(
    Object.keys(cached.parts).sort(),
    ['packages/mcp', 'packages/web', ROOT_PART].sort(),
    'a three-argument write must still carry every part, recovered from the signature it was handed'
  );
  const parts = await computePartSignatures(repo, OPTS);
  assert.ok(readCachedPart(repo, 'packages/web', parts), 'and the parts it wrote must be readable');
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('1.4 — a repo with no sub-packages is one part, exactly as before', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-cache-single-'));
  const repo = path.join(dir, 'single');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'single' }), 'utf8');
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export function a() {\n  return 1;\n}\n', 'utf8');
  const parts = await computePartSignatures(repo, OPTS);
  assert.deepStrictEqual(
    Object.keys(parts.parts),
    [ROOT_PART],
    'a single-package repo must degrade to exactly one part — no behaviour change'
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
