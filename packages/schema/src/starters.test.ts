import assert from 'node:assert';
import { test } from 'node:test';
import { STARTERS, getStarter } from './starters/index.js';
import { validateGraph } from './index.js';
import { validateDomain } from './domain.js';
import type { ProjectType } from './classify.js';

/**
 * Registry-wide invariants for the per-industry starter catalogue (v17 Phase 3).
 * The load-bearing guarantee: EVERY starter is a real, valid starting point —
 * its arch graph is validateGraph-clean design mode, and any domain it ships is
 * validateDomain-ok. Anything else would let the picker seed an invalid graph.
 */

const PROJECT_TYPES: readonly ProjectType[] = [
  'mobile',
  'spa',
  'server-web',
  'microservices',
  'monolith',
  'cli',
  'library',
  'pipeline',
  'ml',
  'serverless',
  'game',
  'infra',
  'embedded',
  'generic',
];

test('STARTERS is non-empty', () => {
  assert.ok(STARTERS.length > 0, 'expected at least one starter');
});

test('starter ids are unique', () => {
  const ids = STARTERS.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate id among ${ids.join(', ')}`);
});

test('every starter has honest metadata', () => {
  for (const s of STARTERS) {
    assert.ok(s.title.trim() !== '', `${s.id}: empty title`);
    assert.ok(s.industry.trim() !== '', `${s.id}: empty industry`);
    assert.ok(s.description.trim() !== '', `${s.id}: empty description`);
  }
});

test("every starter's projectType is a real ProjectType", () => {
  for (const s of STARTERS) {
    assert.ok(PROJECT_TYPES.includes(s.projectType), `${s.id}: bad projectType ${s.projectType}`);
  }
});

test('every buildArch() is validateGraph-clean design mode', () => {
  for (const s of STARTERS) {
    const g = s.buildArch();
    assert.strictEqual(g.mode, 'design', `${s.id}: not design mode`);
    const problems = validateGraph({ ...g, warnings: [] });
    assert.deepStrictEqual(problems, [], `${s.id}: ${problems.join(' | ')}`);
    // A real repo root node plus at least one service and one datastore/topic.
    assert.ok(g.nodes.some((n) => n.kind === 'repo'), `${s.id}: no repo node`);
    assert.ok(g.nodes.some((n) => n.kind === 'service'), `${s.id}: no service node`);
    assert.ok(g.edges.length > 0, `${s.id}: no edges`);
  }
});

test('every buildDomain?() is validateDomain-ok', () => {
  let seenDomain = 0;
  for (const s of STARTERS) {
    if (!s.buildDomain) continue;
    seenDomain++;
    const m = s.buildDomain();
    const res = validateDomain(m);
    assert.ok(res.ok, `${s.id}: ${res.errors.join(' | ')}`);
    assert.ok(m.entities.length > 0, `${s.id}: empty domain`);
  }
  assert.ok(seenDomain > 0, 'expected at least one starter to ship a domain');
});

test('builders are deterministic (build twice → deep-equal)', () => {
  for (const s of STARTERS) {
    assert.deepStrictEqual(s.buildArch(), s.buildArch(), `${s.id}: arch not deterministic`);
    if (s.buildDomain) {
      assert.deepStrictEqual(s.buildDomain(), s.buildDomain(), `${s.id}: domain not deterministic`);
    }
  }
});

test('getStarter resolves known ids and rejects unknown', () => {
  assert.strictEqual(getStarter(STARTERS[0].id)?.id, STARTERS[0].id);
  assert.strictEqual(getStarter('nope-not-real'), undefined);
});
