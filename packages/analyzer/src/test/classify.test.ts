import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { classifyProject, type ProjectType } from '@sequence/schema';

/**
 * End-to-end classifier lock (v9 Phase 3b): scan the REAL fixtures and assert the
 * deterministic product-type classifier types each one sensibly. The manifest
 * reference repos are typed from graph SHAPE (they carry no framework signals);
 * the Phase-3a manifest-less fixtures are typed from their code-first SIGNALS.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const fx = (name: string) => path.join(FIXTURES, name);

async function classify(name: string): Promise<{ type: ProjectType; matchedSignals: string[] }> {
  const graph = await scanRepo(fx(name), { cluster: true });
  const { type, matchedSignals } = classifyProject(graph);
  return { type, matchedSignals };
}

/* ----- manifest reference repos: microservices or monolith, NOT mobile/spa ----- */

test('shopfront (8 services, grpc+queue mesh) → microservices', async () => {
  const r = await classify('shopfront');
  assert.strictEqual(r.type, 'microservices');
  assert.ok(r.matchedSignals.some((s) => s.startsWith('services:')));
});

test('plainapp (2 services) → microservices, not mobile/spa', async () => {
  const r = await classify('plainapp');
  assert.strictEqual(r.type, 'microservices');
  assert.ok(!['mobile', 'spa'].includes(r.type));
});

test('shared-backend (2 fastapi services) → microservices', async () => {
  const r = await classify('shared-backend');
  assert.strictEqual(r.type, 'microservices');
});

test('dockerfile-env-mini (2 services) → microservices', async () => {
  const r = await classify('dockerfile-env-mini');
  assert.strictEqual(r.type, 'microservices');
});

/* ----- Phase-3a manifest-less fixtures: typed from code-first signals ----- */

test('spa-dashboard → spa', async () => {
  const r = await classify('spa-dashboard');
  assert.strictEqual(r.type, 'spa');
  assert.ok(r.matchedSignals.includes('signal:frontend'));
});

test('mobile-rn → mobile', async () => {
  const r = await classify('mobile-rn');
  assert.strictEqual(r.type, 'mobile');
  assert.ok(r.matchedSignals.includes('framework:react-native'));
});

test('mobile-flutter → mobile', async () => {
  const r = await classify('mobile-flutter');
  assert.strictEqual(r.type, 'mobile');
});

test('cli-tool → cli', async () => {
  const r = await classify('cli-tool');
  assert.strictEqual(r.type, 'cli');
  assert.ok(r.matchedSignals.includes('signal:cli'));
});

test('classifyProject is deterministic on a real scan', async () => {
  const graph = await scanRepo(fx('shopfront'), { cluster: true });
  assert.deepStrictEqual(classifyProject(graph), classifyProject(graph));
});
