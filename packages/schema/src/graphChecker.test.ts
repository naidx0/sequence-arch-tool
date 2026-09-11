import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from './index.js';
import { checkGraphMutation, parseClaimedNodeIds, verifyLoop } from './graphChecker.js';

const real: ArchGraph = {
  version: 1,
  scannedAt: '',
  repoRoot: '/r',
  repoName: 'r',
  warnings: [],
  nodes: [
    { id: 'repo', kind: 'repo', label: 'r' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
  ],
  edges: [],
};

test('checkGraphMutation passes grounded ids', () => {
  assert.deepEqual(checkGraphMutation(real, { claimedNodeIds: ['svc:api'] }), { ok: true });
});

test('checkGraphMutation rejects ungrounded ids', () => {
  const v = checkGraphMutation(real, { claimedNodeIds: ['svc:ghost'] });
  assert.equal(v.ok, false);
  if (!v.ok) assert.ok(v.violations.some((x) => x.includes('svc:ghost')));
});

test('verifyLoop stops early on pass', () => {
  const r = verifyLoop(real, [
    { claimedNodeIds: ['svc:ghost'] },
    { claimedNodeIds: ['svc:api'] },
  ]);
  assert.equal(r.verdict.ok, true);
  assert.equal(r.attemptsUsed, 2);
});

test('parseClaimedNodeIds accepts arrays, JSON, and objects', () => {
  assert.deepEqual(parseClaimedNodeIds(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseClaimedNodeIds('["x"]'), ['x']);
  assert.deepEqual(parseClaimedNodeIds({ claimedNodeIds: ['z'] }), ['z']);
  assert.deepEqual(parseClaimedNodeIds('solo'), ['solo']);
});
