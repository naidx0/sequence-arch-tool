/**
 * The function-graph cache: what is proven, and what is only hardened.
 *
 * An adversarial pass raised this: `buildRepoFunctionGraphCached` catches a build
 * failure, substitutes `{nodes: [], edges: []}` — the same contract as the HTTP
 * path, so a parse error degrades rather than 500s — and then wrote that result to
 * `.sequence/functions.json` keyed on the graph's `scannedAt`. If the build ever
 * threw, the empty result would be cached and every later reader would get it from
 * disk, instantly, with no error, until something forced a rescan. That matters more
 * since `who_calls` began sharing the file: a failure inside the short-lived MCP
 * process would hand the long-lived app server an empty graph it has no reason to
 * distrust. An empty result is an honest answer; an empty result CACHED is a lie
 * told repeatedly.
 *
 * The guard is now in place — the write is skipped unless the build actually
 * completed.
 *
 * **HONEST LIMIT, stated rather than papered over: that guard has NO locking test,
 * because I could not make the catch branch fire.** Probed directly:
 *
 *     missing directory     -> succeeds, 0 nodes   (not a failure: nothing to parse)
 *     nodes not an array    -> succeeds, 0 nodes   (the builder tolerates it)
 *     archGraph null        -> throws, but at `archGraph.scannedAt`, BEFORE the try
 *
 * So the catch is defensive against a failure mode nothing reachable produces today.
 * The first draft of this file asserted that a missing directory proved the bug; it
 * did not — that is a successful build of an empty repo, and the cache write was
 * correct. Shipping that test would have locked in a false premise, which is worse
 * than shipping no test.
 *
 * What IS asserted below is the half that is reachable and that the guard could
 * plausibly have broken: a successful build must still be cached. If someone
 * "fixes" the guard by never writing, this fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoFunctionGraphCached } from '../server/functionGraphCache.js';

/** A minimal ArchGraph carrying only what the cache key needs. */
function graphStamped(scannedAt: string) {
  return {
    version: 1 as const,
    mode: 'scan' as const,
    scannedAt,
    repoRoot: '',
    repoName: 'fixture',
    nodes: [],
    edges: [],
    warnings: [],
  };
}

test('a successful build is cached, so the poisoning guard did not disable caching', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fncache-ok-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fixture"}\n');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'a.ts'),
      'export function alpha(): number { return 1; }\nexport const beta = () => alpha();\n',
    );

    await buildRepoFunctionGraphCached(dir, graphStamped('2026-08-19T00:00:00Z'));

    assert.equal(
      fs.existsSync(path.join(dir, '.sequence', 'functions.json')),
      true,
      'a successful build must still be cached — this module exists to avoid re-parsing ' +
        'every source file, and a guard that never writes would trade one bug for another',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty repo builds and caches without throwing', async () => {
  // Records the behaviour the first draft mistook for a failure: nothing to parse is
  // a successful build of nothing, and caching it is correct.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fncache-empty-'));
  try {
    const result = await buildRepoFunctionGraphCached(dir, graphStamped('2026-08-19T00:00:00Z'));
    assert.deepEqual(result.functionGraph, { nodes: [], edges: [] });
    assert.equal(fs.existsSync(path.join(dir, '.sequence', 'functions.json')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
