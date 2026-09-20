/**
 * Tier-3 Layer 3 lock — weak topology (read-heavy postgres, no cache) surfaces
 * grounded read-cache advisory with node/edge evidence refs only.
 * See docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOPFRONT_GRAPH } from '@sequence/schema/dist/moat/moatFixtures.js';
import { patternAdvisor } from './patternAdvisor.js';

test('shopfront weak read path — read-cache advisory cites pattern id and evidence refs', () => {
  const findings = patternAdvisor(SHOPFRONT_GRAPH);

  const readCache = findings.filter((f) => f.patternId === 'read-cache');
  assert.ok(readCache.length > 0, 'shopfront postgres reads without cache must surface read-cache');

  const dbEdges = SHOPFRONT_GRAPH.edges.filter(
    (e) =>
      (e.kind === 'db_read' || e.kind === 'db_access') &&
      SHOPFRONT_GRAPH.nodes.some((n) => n.id === e.dstId && n.kind === 'datastore'),
  );
  assert.ok(dbEdges.length >= 3, 'shopfront fixture is read-heavy to postgres');

  const hasRedis = SHOPFRONT_GRAPH.nodes.some(
    (n) => n.kind === 'datastore' && n.meta?.tech === 'redis',
  );
  assert.equal(hasRedis, false, 'fixture has no cache hop');

  for (const finding of readCache) {
    assert.match(finding.ruleId, /^edge:|^node:|^meta:|^evidence:/);
    assert.ok(finding.evidenceRefs.length > 0, 'finding must cite evidence refs');
    for (const ref of finding.evidenceRefs) {
      assert.ok(ref.kind === 'node' || ref.kind === 'edge');
      assert.ok(ref.id.trim().length > 0);
      if (ref.kind === 'edge') {
        assert.ok(
          SHOPFRONT_GRAPH.edges.some((e) => e.id === ref.id),
          `edge ref ${ref.id} must exist in graph`,
        );
      } else {
        assert.ok(
          SHOPFRONT_GRAPH.nodes.some((n) => n.id === ref.id),
          `node ref ${ref.id} must exist in graph`,
        );
      }
    }
    const citedEdgeIds = finding.evidenceRefs.filter((r) => r.kind === 'edge').map((r) => r.id);
    assert.ok(
      citedEdgeIds.some((id) => dbEdges.some((e) => e.id === id)),
      'read-cache finding must cite at least one db read edge',
    );
  }

  const serialized = JSON.stringify(findings);
  assert.doesNotMatch(serialized, /you should|consider using|redis cache/i);
});
