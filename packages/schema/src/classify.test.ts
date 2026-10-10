import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from './index.js';
import { classifyProject } from './classify.js';

/**
 * Unit lock for the deterministic product-type classifier (v9 Phase 3b).
 *
 * Schema has no analyzer dependency, so these are hand-built ArchGraphs that
 * replicate the shape/signal facts the real scanner emits (verified against the
 * six reference repos and the Phase-3a manifest-less fixtures). The analyzer's
 * classify.test.ts drives the same classifier over the REAL scanned graphs.
 */

let seq = 0;
function svc(name: string, meta?: ArchNode['meta']): ArchNode {
  return { id: `svc:${name}`, kind: 'service', label: name, parentId: 'repo', path: name, meta };
}
function ds(name: string, tech = 'postgres'): ArchNode {
  return { id: `ds:${name}`, kind: 'datastore', label: name, parentId: 'repo', meta: { tech } };
}
function edge(srcId: string, dstId: string, kind: ArchEdge['kind']): ArchEdge {
  return {
    id: `e${seq++}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'x', line: 1, snippet: '' }],
  };
}
function graph(nodes: ArchNode[], edges: ArchEdge[] = []): ArchGraph {
  return {
    version: 1,
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'r',
    nodes: [{ id: 'repo', kind: 'repo', label: 'r' }, ...nodes],
    edges,
    warnings: [],
  };
}

/* ----- the six reference (manifest) repos: typed from graph SHAPE ----- */

test('shopfront-shaped mesh (8 services + grpc/queue) → microservices', () => {
  const svcs = Array.from({ length: 8 }, (_, i) => svc(`s${i}`, { framework: 'express' }));
  const r = classifyProject(
    graph([...svcs, ds('pg'), ds('redis', 'redis')], [
      edge('svc:s0', 'svc:s1', 'grpc'),
      edge('svc:s0', 'ds:redis', 'queue_publish'),
      edge('svc:s0', 'ds:pg', 'db_read'),
    ])
  );
  assert.strictEqual(r.type, 'microservices');
  assert.ok(r.matchedSignals.includes('services:8'));
  assert.ok(r.matchedSignals.includes('edge:grpc'));
});

test('ticketing-shaped (3 services + queue) → microservices', () => {
  const r = classifyProject(
    graph([svc('gateway', { framework: 'express' }), svc('api', { framework: 'fastapi' }), svc('worker'), ds('pg')], [
      edge('svc:gateway', 'svc:api', 'http'),
      edge('svc:api', 'ds:pg', 'queue_publish'),
    ])
  );
  assert.strictEqual(r.type, 'microservices');
});

test('two-service repos (plainapp / shared-backend / dockerfile-env-mini shape) → microservices', () => {
  const r = classifyProject(graph([svc('web', { framework: 'next.js' }), svc('api', { framework: 'fastapi' }), ds('pg')]));
  assert.strictEqual(r.type, 'microservices');
  assert.ok(r.matchedSignals.includes('services:2'));
});

test('single server + datastore → server-web', () => {
  const r = classifyProject(graph([svc('api', { framework: 'django' }), ds('pg')], [edge('svc:api', 'ds:pg', 'db_write')]));
  assert.strictEqual(r.type, 'server-web');
  assert.ok(r.matchedSignals.includes('datastore'));
});

test('single server, JSON API only (no datastore) → monolith', () => {
  const r = classifyProject(graph([svc('api', { framework: 'express' })], [edge('svc:api', 'svc:api', 'http')]));
  assert.strictEqual(r.type, 'monolith');
  assert.ok(r.matchedSignals.includes('json-api'));
});

/* ----- the Phase-3a manifest-less fixtures: typed from SIGNALS ----- */

test('spa-dashboard signals (frontend/react, no backend) → spa', () => {
  const r = classifyProject(graph([svc('spa-dashboard', { framework: 'react', frameworks: ['react'], signals: ['js', 'frontend'] })]));
  assert.strictEqual(r.type, 'spa');
  assert.ok(r.matchedSignals.includes('signal:frontend'));
  assert.ok(r.matchedSignals.includes('framework:react'));
});

test('mobile-rn signals (react-native) → mobile', () => {
  const r = classifyProject(graph([svc('mobile-rn', { framework: 'react-native', frameworks: ['react-native'], signals: ['js', 'mobile'] })]));
  assert.strictEqual(r.type, 'mobile');
  assert.ok(r.matchedSignals.includes('framework:react-native'));
});

test('mobile-flutter signals (flutter) → mobile', () => {
  const r = classifyProject(graph([svc('mobile-flutter', { framework: 'flutter', frameworks: ['flutter'], signals: ['dart', 'mobile'] })]));
  assert.strictEqual(r.type, 'mobile');
});

test('cli-tool signals (cli, no backend) → cli', () => {
  const r = classifyProject(graph([svc('cli-tool', { framework: 'cli', frameworks: ['cli'], signals: ['js', 'cli'] })]));
  assert.strictEqual(r.type, 'cli');
  assert.ok(r.matchedSignals.includes('signal:cli'));
});

/* ----- precedence-cascade coverage for the signal-driven types ----- */

test('serverless signal → serverless (before backend/microservices)', () => {
  const r = classifyProject(graph([svc('fn', { framework: 'serverless', frameworks: ['serverless'], signals: ['js', 'serverless'] })]));
  assert.strictEqual(r.type, 'serverless');
});

test('pipeline signal → pipeline', () => {
  const r = classifyProject(graph([svc('etl', { framework: 'airflow', frameworks: ['airflow'], signals: ['py', 'pipeline'] })]));
  assert.strictEqual(r.type, 'pipeline');
});

test('ml signal → ml', () => {
  const r = classifyProject(graph([svc('model', { framework: 'pytorch', frameworks: ['pytorch'], signals: ['py', 'ml'] })]));
  assert.strictEqual(r.type, 'ml');
});

test('infra-only signal → infra', () => {
  const r = classifyProject(graph([svc('iac', { frameworks: ['terraform'], signals: ['infra'] })]));
  assert.strictEqual(r.type, 'infra');
});

test('library signal (no server) → library', () => {
  const r = classifyProject(graph([svc('lib', { frameworks: ['library'], signals: ['js', 'library'] })]));
  assert.strictEqual(r.type, 'library');
});

test('mobile precedence beats a co-present backend signal', () => {
  const r = classifyProject(graph([svc('app', { frameworks: ['react-native', 'express'], signals: ['js', 'mobile', 'backend'] })]));
  assert.strictEqual(r.type, 'mobile');
});

test('empty graph → generic with low confidence', () => {
  const r = classifyProject(graph([]));
  assert.strictEqual(r.type, 'generic');
  assert.strictEqual(r.confidence, 'low');
});

/* ----- confidence tier LOCK: shape rules are 'thin', signals are 'high' ----- */

test('LOCK: graph-SHAPE microservices verdict is confidence "thin"', () => {
  // ≥2 services, no meta.signals/frameworks — pure shape.
  const r = classifyProject(graph([svc('web', { framework: 'next.js' }), svc('api', { framework: 'fastapi' }), ds('pg')]));
  assert.strictEqual(r.type, 'microservices');
  assert.strictEqual(r.confidence, 'thin', 'shape-only microservices must not claim high confidence');
});

test('LOCK: graph-SHAPE server-web verdict is confidence "thin"', () => {
  const r = classifyProject(graph([svc('api', { framework: 'django' }), ds('pg')], [edge('svc:api', 'ds:pg', 'db_write')]));
  assert.strictEqual(r.type, 'server-web');
  assert.strictEqual(r.confidence, 'thin');
});

test('LOCK: graph-SHAPE monolith verdict is confidence "thin"', () => {
  const r = classifyProject(graph([svc('api', { framework: 'express' })], [edge('svc:api', 'svc:api', 'http')]));
  assert.strictEqual(r.type, 'monolith');
  assert.strictEqual(r.confidence, 'thin');
});

test('LOCK: SIGNAL-based verdicts keep confidence "high"', () => {
  const spa = classifyProject(graph([svc('spa', { framework: 'react', frameworks: ['react'], signals: ['js', 'frontend'] })]));
  assert.strictEqual(spa.type, 'spa');
  assert.strictEqual(spa.confidence, 'high');
  const mobile = classifyProject(graph([svc('m', { framework: 'react-native', frameworks: ['react-native'], signals: ['js', 'mobile'] })]));
  assert.strictEqual(mobile.type, 'mobile');
  assert.strictEqual(mobile.confidence, 'high');
  const cli = classifyProject(graph([svc('c', { framework: 'cli', frameworks: ['cli'], signals: ['js', 'cli'] })]));
  assert.strictEqual(cli.type, 'cli');
  assert.strictEqual(cli.confidence, 'high');
});

test('classifyProject is pure/deterministic — same input, same output', () => {
  const g = graph([svc('a'), svc('b'), ds('pg')], [edge('svc:a', 'svc:b', 'grpc')]);
  assert.deepStrictEqual(classifyProject(g), classifyProject(g));
});
