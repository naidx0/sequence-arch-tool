/**
 * A synthesized request that names something the repo does not have teaches the
 * model to hallucinate. That is the single property this file exists to lock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertGrounded,
  candidatesByKind,
  eligibleRecipes,
  loadRecipes,
  synthesizeRequests,
  validateRecipes,
} from '../lib/requests.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'graph.json'), 'utf8'));
const recipes = loadRecipes();
const nodeIds = new Set(graph.nodes.map((n) => n.id));

test('the shipped recipe file is valid — every family declared, every slot addressable, every row justified', () => {
  assert.ok(recipes.recipes.length >= 10, 'the mix should be broad enough to be worth curating');
  // Every family named in `families` is actually used, and vice versa.
  const used = new Set(recipes.recipes.map((r) => r.family));
  for (const f of Object.keys(recipes.families)) assert.ok(used.has(f), `family "${f}" is declared but unused`);
  // The families the guide names by name must all be present.
  for (const f of ['cache', 'split', 'events']) assert.ok(used.has(f), `guide §7 names "${f}" as part of a realistic mix`);
  // removeCardIds must be exercised by at least one recipe.
  assert.ok(used.has('retire'), 'without a removal family the model learns removeCardIds is always empty');
});

test('every synthesized request cites ONLY real node ids', () => {
  const out = synthesizeRequests({ graph, repoId: 'fixture-shop', recipes, count: 40 });
  assert.ok(out.length > 0);
  for (const r of out) {
    for (const id of r.citedIds) assert.ok(nodeIds.has(id), `${r.id} cites unreal id ${id}`);
    for (const m of r.text.matchAll(/`([^`]+)`/g)) {
      assert.ok(nodeIds.has(m[1]), `${r.id} quotes unreal id ${m[1]} in: ${r.text}`);
    }
    assert.ok(r.text.includes('`'), 'a request that cites no id cannot be proven grounded');
  }
});

test('synthesis is deterministic for a repo id + seed, and different across seeds', () => {
  const a = synthesizeRequests({ graph, repoId: 'fixture-shop', recipes, count: 8, seed: 'phase0' });
  const b = synthesizeRequests({ graph, repoId: 'fixture-shop', recipes, count: 8, seed: 'phase0' });
  assert.deepEqual(a, b, 'the same repo at the same seed must rebuild byte-identically');
  const c = synthesizeRequests({ graph, repoId: 'fixture-shop', recipes, count: 8, seed: 'other' });
  assert.notDeepEqual(a.map((r) => r.text), c.map((r) => r.text));
  const d = synthesizeRequests({ graph, repoId: 'another-repo', recipes, count: 8, seed: 'phase0' });
  assert.notDeepEqual(a.map((r) => r.recipeId), d.map((r) => r.recipeId));
});

test('no duplicate requests, and slots within one request are distinct nodes', () => {
  const out = synthesizeRequests({ graph, repoId: 'fixture-shop', recipes, count: 40 });
  assert.equal(new Set(out.map((r) => r.text)).size, out.length);
  for (const r of out) assert.equal(new Set(r.citedIds).size, r.citedIds.length, `${r.recipeId} reused one node for two slots`);
});

test('a repo with no datastore never draws a recipe that needs one', () => {
  const noStore = { nodes: graph.nodes.filter((n) => n.kind !== 'datastore'), edges: [] };
  const byKind = candidatesByKind(noStore);
  const eligible = eligibleRecipes(recipes.recipes, byKind);
  assert.ok(eligible.length > 0);
  for (const r of eligible) assert.ok(!r.needs.includes('datastore'));
  const out = synthesizeRequests({ graph: noStore, repoId: 'nostore', recipes, count: 20 });
  for (const r of out) {
    for (const id of r.citedIds) assert.ok(!id.startsWith('ds:'), 'drew a datastore that was not there');
  }
});

test('an empty graph yields no requests rather than an ungrounded one', () => {
  assert.deepEqual(synthesizeRequests({ graph: { nodes: [], edges: [] }, repoId: 'empty', recipes, count: 5 }), []);
});

test('slot ordering is by degree then id, so it does not drift between runs', () => {
  const byKind = candidatesByKind(graph);
  // checkout has 3 edges, catalog 2, payments 1.
  assert.deepEqual(byKind.get('service').map((n) => n.id), ['svc:checkout', 'svc:catalog', 'svc:payments']);
});

test('assertGrounded throws on an id the scan does not have', () => {
  assert.throws(
    () => assertGrounded({ text: 'add a cache to `svc:ghost`', citedIds: ['svc:ghost'] }, nodeIds, 'fx'),
    /not a node in the scan/
  );
  // ...and on prose that hard-codes an id even when citedIds looks clean.
  assert.throws(
    () => assertGrounded({ text: 'front `svc:ghost` with a limiter', citedIds: ['svc:checkout'] }, nodeIds, 'fx'),
    /svc:ghost/
  );
});

test('a recipe with no {n.id} citation is rejected by the validator', () => {
  assert.throws(
    () =>
      validateRecipes({
        families: { cache: 'x' },
        recipes: [{ id: 'a', family: 'cache', needs: ['service'], weight: 1, why: 'x', text: 'add a cache somewhere' }],
      }),
    /must cite at least one real node id/
  );
});

test('a recipe addressing a slot it did not ask for is rejected', () => {
  assert.throws(
    () =>
      validateRecipes({
        families: { cache: 'x' },
        recipes: [{ id: 'a', family: 'cache', needs: ['service'], weight: 1, why: 'x', text: 'cache `{1.id}` please' }],
      }),
    /references slot \{1\}/
  );
});
