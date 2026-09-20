import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEdge, EdgeKind } from './index.js';
import { computeRisks, type RiskNode, type SystemRisk } from './risks.js';
import { diffRisks, riskDeltaIsEmpty } from './riskDelta.js';

/**
 * G-D risk-delta lock. The one behaviour that must never bend: a delta is
 * derived, never manufactured. Two set-equal `computeRisks` outputs produce
 * `{ raised: [], lowered: [] }` — including when the two runs come from two
 * different but risk-equivalent graphs — and a real severity move is reported
 * with its real before/after rungs.
 */

function edge(srcId: string, dstId: string, kind: EdgeKind = 'db_access'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'f', line: 1, snippet: 's' }],
  };
}

function svc(id: string): RiskNode {
  return { id, kind: 'service', label: id };
}

function risk(nodeId: string, severity: SystemRisk['severity'], label = nodeId): SystemRisk {
  return {
    nodeId,
    label,
    kind: 'service',
    blastRadius: 1,
    impactedBy: [],
    directDependents: 1,
    total: 10,
    fraction: 0.1,
    severity,
    reason: `${label} is a single point of failure`,
  };
}

test('diffRisks: identical lists produce an empty delta (never a fabricated change)', () => {
  const list = [risk('ds:pg', 'critical'), risk('svc:api', 'moderate')];
  const delta = diffRisks(list, [...list]);
  assert.deepEqual(delta, { raised: [], lowered: [] });
  assert.equal(riskDeltaIsEmpty(delta), true);
});

test('diffRisks: two empty lists produce an empty delta', () => {
  assert.deepEqual(diffRisks([], []), { raised: [], lowered: [] });
});

test('diffRisks: order of the inputs does not create a delta', () => {
  const before = [risk('a', 'high'), risk('b', 'moderate')];
  const after = [risk('b', 'moderate'), risk('a', 'high')];
  assert.equal(riskDeltaIsEmpty(diffRisks(before, after)), true);
});

test('diffRisks: a severity climb is RAISED with its real rungs', () => {
  const delta = diffRisks([risk('ds:pg', 'moderate')], [risk('ds:pg', 'critical')]);
  assert.deepEqual(delta.lowered, []);
  assert.equal(delta.raised.length, 1);
  assert.deepEqual(delta.raised[0], {
    nodeId: 'ds:pg',
    label: 'ds:pg',
    from: 'moderate',
    to: 'critical',
  });
});

test('diffRisks: a newly reported node is RAISED from nothing; a dropped node is LOWERED to nothing', () => {
  const delta = diffRisks([risk('gone', 'high')], [risk('fresh', 'moderate')]);
  assert.deepEqual(delta.raised, [
    { nodeId: 'fresh', label: 'fresh', from: undefined, to: 'moderate' },
  ]);
  assert.deepEqual(delta.lowered, [
    { nodeId: 'gone', label: 'gone', from: 'high', to: undefined },
  ]);
});

test('diffRisks: entries sort by the louder end, then id — deterministic', () => {
  const delta = diffRisks(
    [],
    [risk('z', 'moderate'), risk('a', 'critical'), risk('m', 'critical')]
  );
  assert.deepEqual(delta.raised.map((r) => r.nodeId), ['a', 'm', 'z']);
});

test('diffRisks over REAL computeRisks output: adding an unrelated leaf moves nothing', () => {
  // Six services on one shared datastore — the classic SPOF fixture.
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(svc);
  const edges = nodes.map((n) => edge(n.id, 'ds:pg'));
  const universe = [...nodes, { id: 'ds:pg', kind: 'datastore', label: 'pg' } as RiskNode];
  const before = computeRisks(edges, universe);
  assert.ok(before.length > 0, 'fixture must actually report a risk to be meaningful');

  // The "proposal": a brand-new isolated service nothing depends on.
  const afterUniverse = [...universe, svc('svc:new')];
  const after = computeRisks(edges, afterUniverse);
  // The denominator moved, but no severity rung did.
  assert.equal(riskDeltaIsEmpty(diffRisks(before, after)), true);
});

test('diffRisks over REAL computeRisks output: a new dependency on the shared store raises it', () => {
  const nodes = ['a', 'b'].map(svc);
  const universe = [
    ...nodes,
    ...['c', 'd', 'e', 'f', 'g', 'h'].map(svc),
    { id: 'ds:pg', kind: 'datastore', label: 'pg' } as RiskNode,
  ];
  const beforeEdges = nodes.map((n) => edge(n.id, 'ds:pg'));
  const before = computeRisks(beforeEdges, universe);
  const afterEdges = [
    ...beforeEdges,
    ...['c', 'd', 'e', 'f'].map((id) => edge(id, 'ds:pg')),
  ];
  const after = computeRisks(afterEdges, universe);

  const delta = diffRisks(before, after);
  assert.deepEqual(delta.lowered, []);
  assert.equal(delta.raised.length, 1);
  assert.equal(delta.raised[0]!.nodeId, 'ds:pg');
  assert.equal(delta.raised[0]!.to, 'critical');
});
