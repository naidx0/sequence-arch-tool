/**
 * Tier-3 Layer 2 lock — every service-level impact edge that feeds the digest's
 * `risks` section must trace to scan evidence (file:line) that exists on disk.
 * See docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { evidenceExistsOnDisk, impactEvidenceChains } from './evidenceChains.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

/** Locked to shopfront/ground-truth.json service-level interaction count. */
const SHOPFRONT_IMPACT_EDGE_COUNT = 15;

test('shopfront — every impact edge in digest traces to file:line on disk', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);

  assert.ok(digest.risks, 'digest carries precomputed risks from the impact projection');
  assert.ok(digest.risks!.spofs.length > 0, 'shopfront surfaces at least one SPOF');

  const chains = impactEvidenceChains(graph);
  assert.strictEqual(
    chains.length,
    SHOPFRONT_IMPACT_EDGE_COUNT,
    'service-level impact edge count matches shopfront ground truth',
  );

  for (const { srcId, dstId, anchors } of chains) {
    const label = `${srcId} -> ${dstId}`;
    assert.ok(anchors.length > 0, `${label}: impact edge has no scan evidence`);
    for (const ev of anchors) {
      assert.ok(
        evidenceExistsOnDisk(SHOPFRONT, ev),
        `${label}: evidence ${ev.file}:${ev.line} must exist on disk`,
      );
    }
  }
});
