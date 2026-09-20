import assert from 'node:assert';
import { test } from 'node:test';

import { validateSystemBoard, type SystemBoardV0 } from './systemBoard.js';

function validDoc(): SystemBoardV0 {
  return {
    version: 0,
    title: 'Search fan-out',
    layoutProfile: 'lane',
    nodes: [
      {
        id: 'gw',
        role: 'component',
        track: '1-search',
        label: 'Gateway',
        bullets: ['routes /search'],
      },
      {
        id: 'fan',
        role: 'action',
        track: '1-search',
        label: 'Fan-out',
      },
      {
        id: 'idx',
        role: 'store',
        track: '2-focus',
        label: 'Index',
        evidence: { nodeId: 'svc:index' },
      },
    ],
    edges: [{ id: 'e1', from: 'gw', to: 'fan', pin: 'P1' }],
    issues: [{ id: 'i1', priority: 'P1', title: 'Missing cache', detail: 'No TTL' }],
  };
}

test('validateSystemBoard: valid doc passes', () => {
  const res = validateSystemBoard(validDoc());
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSystemBoard: unknown evidence.nodeId fails when known set provided', () => {
  const res = validateSystemBoard(validDoc(), {
    knownNodeIds: new Set(['svc:gateway']),
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown graph node svc:index')));
});

test('validateSystemBoard: known evidence.nodeId passes', () => {
  const res = validateSystemBoard(validDoc(), {
    knownNodeIds: new Set(['svc:index', 'svc:gateway']),
  });
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSystemBoard: orphan edge fails', () => {
  const doc = validDoc();
  doc.edges.push({ id: 'e2', from: 'missing', to: 'gw' });
  const res = validateSystemBoard(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown from-node missing')));
});

test('validateSystemBoard: invalid role fails', () => {
  const doc = validDoc();
  doc.nodes[0] = { ...doc.nodes[0]!, role: 'widget' as SystemBoardV0['nodes'][0]['role'] };
  const res = validateSystemBoard(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('invalid role')));
});
