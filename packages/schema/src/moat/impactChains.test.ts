import test from 'node:test';
import assert from 'node:assert/strict';
import { computeImpact } from '../impact.js';
import { computeRisks } from '../risks.js';
import {
  SHOPFRONT_EDGES,
  SHOPFRONT_IMPACT_GOLDEN,
  SHOPFRONT_IMPACT_LINKS,
  SHOPFRONT_POSTGRES_SPOF,
  SHOPFRONT_RISK_NODES,
} from './moatFixtures.js';

test('shopfront fixture — multi-hop dependsOn matches golden downstream closure', () => {
  for (const [nodeId, golden] of Object.entries(SHOPFRONT_IMPACT_GOLDEN)) {
    const r = computeImpact(SHOPFRONT_IMPACT_LINKS, nodeId);
    assert.strictEqual(r.exists, true, nodeId);
    assert.deepStrictEqual(r.dependsOn, golden.dependsOn, `${nodeId} dependsOn`);
  }
});

test('shopfront fixture — multi-hop impactedBy matches golden blast-radius closure', () => {
  for (const [nodeId, golden] of Object.entries(SHOPFRONT_IMPACT_GOLDEN)) {
    const r = computeImpact(SHOPFRONT_IMPACT_LINKS, nodeId);
    assert.deepStrictEqual(r.impactedBy, golden.impactedBy, `${nodeId} impactedBy`);
  }
});

test('shopfront fixture — ArchEdge array and bare links yield identical closures', () => {
  for (const nodeId of Object.keys(SHOPFRONT_IMPACT_GOLDEN)) {
    const fromLinks = computeImpact(SHOPFRONT_IMPACT_LINKS, nodeId);
    const fromEdges = computeImpact(SHOPFRONT_EDGES, nodeId);
    assert.deepStrictEqual(fromEdges.dependsOn, fromLinks.dependsOn, nodeId);
    assert.deepStrictEqual(fromEdges.impactedBy, fromLinks.impactedBy, nodeId);
  }
});

test('shopfront fixture — postgres SPOF fraction matches grounded blast radius', () => {
  const { nodeId, blastRadius, total, fraction, severity } = SHOPFRONT_POSTGRES_SPOF;
  const impact = computeImpact(SHOPFRONT_EDGES, nodeId);
  assert.strictEqual(impact.impactedBy.length, blastRadius);
  assert.deepStrictEqual(impact.impactedBy, SHOPFRONT_IMPACT_GOLDEN.postgres.impactedBy);

  const risks = computeRisks(SHOPFRONT_EDGES, SHOPFRONT_RISK_NODES);
  assert.ok(risks.length > 0, 'shopfront should surface at least one SPOF');
  const top = risks[0];
  assert.strictEqual(top.nodeId, nodeId);
  assert.strictEqual(top.blastRadius, blastRadius);
  assert.strictEqual(top.total, total);
  assert.strictEqual(top.fraction, fraction);
  assert.strictEqual(top.severity, severity);
  assert.strictEqual(top.blastRadius, computeImpact(SHOPFRONT_EDGES, top.nodeId).impactedBy.length);
});

test('shopfront fixture — topic consumer branch does not pollute postgres blast radius', () => {
  const notifications = computeImpact(SHOPFRONT_EDGES, 'notifications');
  assert.deepStrictEqual(notifications.dependsOn, ['topic:order.created']);
  const postgres = computeImpact(SHOPFRONT_EDGES, 'postgres');
  assert.ok(!postgres.impactedBy.includes('notifications'));
});
