/**
 * LOCKING TEST for T1-f / U23 — `buildRepoFunctionGraph` must reuse `scanRepo`'s
 * parse output instead of re-parsing every source file.
 *
 * The small fixtures here finish in milliseconds either way, so wall-clock is
 * too noisy to lock. The metric is cache hits: after a scan, the first function-
 * graph build for that root must serve every eligible file from the capture; a
 * build with no capture (`clearSharedFacts`) must record zero hits; and a second
 * build after the capture was handed over must also record zero hits.
 *
 * Budget (documented, not timing-locked on these fixtures): on n8n the second
 * full re-parse was ~37s atop a ~45s scan once risks/digest quadratics were
 * fixed — see `parse/sharedFacts.ts`. These tests prove the sharing path is live;
 * regressions that drop back to always re-parsing fail on the hit counter first.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import {
  clearSharedFacts,
  resetSharedFactsMetrics,
  sharedFactsCacheHits,
} from '../parse/sharedFacts.js';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

const FIXTURE_IDS = [
  'shopfront',
  'monorepo-apps',
  'mixed-lang',
  'shared-backend',
  'plainapp',
];

test('LOCK: first build after scan reuses the shared parse capture', async () => {
  for (const id of FIXTURE_IDS) {
    const dir = path.join(FIXTURES, id);
    if (!fs.existsSync(dir)) continue;

    clearSharedFacts();
    const arch = await scanRepo(dir, { cluster: true });

    resetSharedFactsMetrics();
    const graph = await buildRepoFunctionGraph(dir, { cluster: true }, arch);
    const hits = sharedFactsCacheHits();

    assert.ok(graph.nodes.length > 0, `${id}: expected a non-empty function graph`);
    assert.ok(
      hits > 0,
      `${id}: warm build must reuse scan parse output (cache hits was ${hits})`
    );
  }
});

test('LOCK: cold build with no capture records zero cache hits', async () => {
  const dir = path.join(FIXTURES, 'shopfront');
  clearSharedFacts();
  const arch = await scanRepo(dir, { cluster: true });
  clearSharedFacts();

  resetSharedFactsMetrics();
  const graph = await buildRepoFunctionGraph(dir, { cluster: true }, arch);
  assert.ok(graph.nodes.length > 0);
  assert.strictEqual(
    sharedFactsCacheHits(),
    0,
    'without a live capture every file must be read and parsed again'
  );
});

test('LOCK: second build after the capture was handed over cannot reuse it', async () => {
  const dir = path.join(FIXTURES, 'shopfront');
  clearSharedFacts();
  const arch = await scanRepo(dir, { cluster: true });

  resetSharedFactsMetrics();
  await buildRepoFunctionGraph(dir, { cluster: true }, arch);
  const firstHits = sharedFactsCacheHits();
  assert.ok(firstHits > 0, 'first build should consume the capture');

  resetSharedFactsMetrics();
  await buildRepoFunctionGraph(dir, { cluster: true }, arch);
  assert.strictEqual(
    sharedFactsCacheHits(),
    0,
    'the capture is handed over once — a second build must re-parse'
  );
});
