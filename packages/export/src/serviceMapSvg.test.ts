import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from '@sequence/schema';
import { renderServiceMapSvg } from './serviceMapSvg.js';

const graph: ArchGraph = {
  version: 1,
  scannedAt: '',
  repoRoot: '/r',
  repoName: 'shop',
  nodes: [
    { id: 'svc:api', kind: 'service', label: 'api' },
    { id: 'ds:postgres', kind: 'datastore', label: 'postgres' },
  ],
  edges: [
    {
      id: 'e:1',
      srcId: 'svc:api',
      dstId: 'ds:postgres',
      kind: 'db_read',
      confidence: 1,
      origin: 'deterministic',
      evidence: [],
    },
  ],
  warnings: [],
};

test('renderServiceMapSvg: grounded cards and edges', () => {
  const svg = renderServiceMapSvg(graph);
  assert.match(svg, /<svg/);
  assert.match(svg, /api/);
  assert.match(svg, /postgres/);
  assert.doesNotMatch(svg, /<script/);
});

test('renderServiceMapSvg: deterministic', () => {
  assert.strictEqual(renderServiceMapSvg(graph), renderServiceMapSvg(graph));
});
