import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { computeRisks } from '@sequence/schema';
import {
  directoryHeatMap,
  heatLevelFromScore,
  HEAT_DECAY,
  HEAT_WEIGHT,
} from '../lore/directoryHeat.js';

function node(
  id: string,
  kind: ArchNode['kind'],
  label: string,
  path?: string,
  parentId?: string,
): ArchNode {
  return { id, kind, label, ...(path ? { path } : {}), ...(parentId ? { parentId } : {}) };
}

function edge(srcId: string, dstId: string, file: string): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind: 'http',
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file, line: 1, snippet: 'x' }],
  };
}

function miniGraph(nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return {
    version: 1,
    scannedAt: '',
    repoRoot: '/repo',
    repoName: 'repo',
    nodes,
    edges,
    warnings: [],
  };
}

test('directoryHeatMap — empty graph yields empty map', () => {
  const g = miniGraph([], []);
  assert.strictEqual(directoryHeatMap(g, computeRisks([], [])).size, 0);
});

test('directoryHeatMap — high-risk file rolls up to its directory', () => {
  const g = miniGraph(
    [
      node('repo', 'repo', 'repo'),
      node('svc:a', 'service', 'A', undefined, 'repo'),
      node('f1', 'file', 'f1.ts', 'src/a/f1.ts', 'svc:a'),
      node('f2', 'file', 'f2.ts', 'src/a/f2.ts', 'svc:a'),
      node('svc:b', 'service', 'B', undefined, 'repo'),
      node('f3', 'file', 'f3.ts', 'src/b/f3.ts', 'svc:b'),
    ],
    [
      edge('svc:a', 'svc:b', 'src/a/f1.ts'),
      edge('svc:b', 'svc:a', 'src/b/f3.ts'),
    ],
  );
  const risks = computeRisks(g.edges, g.nodes);
  const heat = directoryHeatMap(g, risks);
  assert.ok(heat.get('src/a')! >= HEAT_WEIGHT.high, 'high-risk dir gets tier weight');
  assert.ok(heat.get('src')! >= heat.get('src/a')! * HEAT_DECAY, 'parent gets decayed child heat');
});

test('directoryHeatMap — cycle membership adds weight without fabricating files', () => {
  const g = miniGraph(
    [
      node('repo', 'repo', 'repo'),
      node('svc:a', 'service', 'A', undefined, 'repo'),
      node('f1', 'file', 'f1.ts', 'pkg/a.ts', 'svc:a'),
      node('svc:b', 'service', 'B', undefined, 'repo'),
      node('f2', 'file', 'f2.ts', 'pkg/b.ts', 'svc:b'),
    ],
    [edge('svc:a', 'svc:b', 'pkg/a.ts'), edge('svc:b', 'svc:a', 'pkg/b.ts')],
  );
  const heat = directoryHeatMap(g, []);
  assert.ok(heat.get('pkg')! >= HEAT_WEIGHT.low + HEAT_WEIGHT.cycle);
});

test('heatLevelFromScore — maps to discrete 0–3 bands', () => {
  assert.strictEqual(heatLevelFromScore(0), 0);
  assert.strictEqual(heatLevelFromScore(1.5), 1);
  assert.strictEqual(heatLevelFromScore(3), 2);
  assert.strictEqual(heatLevelFromScore(5), 3);
});
