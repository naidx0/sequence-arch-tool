import assert from 'node:assert';
import { test } from 'node:test';
import {
  defaultTaskCardDocProps,
  emptySequenceBoardDoc,
  parseSequenceBoardDoc,
  reconcileRunningBoardNodes,
  type SequenceBoardDoc,
} from './sequenceBoard.js';

test('sequenceBoard: defaultTaskCardDocProps fills every field', () => {
  const p = defaultTaskCardDocProps({ title: 'Ship it' });
  assert.strictEqual(p.title, 'Ship it');
  assert.strictEqual(p.status, 'idle');
  assert.strictEqual(p.kind, 'command');
  assert.strictEqual(p.aiIntent, 'ask');
});

test('sequenceBoard: parseSequenceBoardDoc round-trips a valid doc', () => {
  const doc: SequenceBoardDoc = {
    version: 1,
    nodes: [
      {
        id: 'card-1',
        kind: 'task-card',
        x: 80,
        y: 120,
        w: 260,
        h: 148,
        props: defaultTaskCardDocProps({ title: 'Wire native board', owner: 'Ada' }),
      },
    ],
    edges: [{ id: 'e1', source: 'card-1', target: 'card-2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const parsed = parseSequenceBoardDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepStrictEqual(parsed, doc);
});

test('sequenceBoard: parseSequenceBoardDoc rejects bad version', () => {
  assert.strictEqual(parseSequenceBoardDoc({ version: 2, nodes: [], edges: [] }), undefined);
});

test('sequenceBoard: reconcileRunningBoardNodes resets running cards to idle', () => {
  const nodes = reconcileRunningBoardNodes([
    {
      id: 'a',
      kind: 'task-card',
      x: 0,
      y: 0,
      w: 260,
      h: 148,
      props: defaultTaskCardDocProps({ status: 'running' }),
    },
  ]);
  assert.strictEqual(nodes[0].props.status, 'idle');
  assert.ok(nodes[0].props.result.includes('reload'));
});

test('sequenceBoard: parseSequenceBoardDoc round-trips ink strokes', () => {
  const doc: SequenceBoardDoc = {
    version: 1,
    nodes: [],
    edges: [],
    ink: [{ id: 'ink-1', points: [{ x: 0, y: 0 }, { x: 40, y: 12 }] }],
  };
  const parsed = parseSequenceBoardDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepStrictEqual(parsed?.ink, doc.ink);
});

test('sequenceBoard: emptySequenceBoardDoc is version 1 with no nodes', () => {
  const doc = emptySequenceBoardDoc();
  assert.strictEqual(doc.version, 1);
  assert.deepStrictEqual(doc.nodes, []);
  assert.deepStrictEqual(doc.edges, []);
});
