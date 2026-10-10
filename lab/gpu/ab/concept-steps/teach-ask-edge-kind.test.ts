import assert from 'node:assert/strict';
import test from 'node:test';

import { askedEdgeKinds, buildQueue } from '../server/lessonState.js';

/**
 * SEQUENCE_TEACH_ASK_EDGE_KIND=1: an ask that names a kind of connection and no
 * file seeds its lesson from the files on edges of that kind.
 */

const GRAPH = {
  nodes: [
    { id: 'f:http.ts', kind: 'file', label: 'http.ts', path: 'gw/http.ts' },
    { id: 'f:orders.ts', kind: 'file', label: 'orders.ts', path: 'gw/orders.ts' },
    { id: 'f:events.py', kind: 'file', label: 'events.py', path: 'orders/events.py' },
    { id: 'f:worker.py', kind: 'file', label: 'worker.py', path: 'notify/worker.py' },
  ],
  edges: [
    { srcId: 'f:orders.ts', dstId: 'f:http.ts', kind: 'import' },
    { srcId: 'f:events.py', dstId: 'f:worker.py', kind: 'queue_publish' },
  ],
} as never;

const ASK = 'Teach me message queues using the real queue edges in this repo.';

function withFlag<T>(value: string | undefined, run: () => T): T {
  const before = process.env.SEQUENCE_TEACH_ASK_EDGE_KIND;
  if (value === undefined) delete process.env.SEQUENCE_TEACH_ASK_EDGE_KIND;
  else process.env.SEQUENCE_TEACH_ASK_EDGE_KIND = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_TEACH_ASK_EDGE_KIND;
    else process.env.SEQUENCE_TEACH_ASK_EDGE_KIND = before;
  }
}

test('flag off: a queue ask seeds from every file, so it starts on http.ts, as before', () => {
  const q = withFlag(undefined, () => buildQueue(GRAPH, ASK));
  assert.equal(q[0]!.nodeId, 'f:http.ts');
});

test('flag on: a queue ask starts on the files a queue edge joins', () => {
  const q = withFlag('1', () => buildQueue(GRAPH, ASK));
  assert.deepEqual(q.slice(0, 2).map((c) => c.nodeId), ['f:events.py', 'f:worker.py']);
});

test('kinds come back in the order the ask names them', () => {
  const kinds = withFlag('1', () => askedEdgeKinds('how do the services here talk, queues vs HTTP'));
  assert.deepEqual(kinds.slice(0, 3), ['queue_publish', 'queue_consume', 'http']);
  assert.deepEqual(withFlag(undefined, () => askedEdgeKinds('queues vs HTTP')), []);
});

test('a named file still wins, and an ask with no repo reference still gets nothing', () => {
  const named = withFlag('1', () => buildQueue(GRAPH, 'Teach me how events.py uses the queue in this repo.'));
  assert.equal(named[0]!.nodeId, 'f:events.py');
  assert.deepEqual(withFlag('1', () => buildQueue(GRAPH, 'Teach me what a message queue is.')), []);
});
