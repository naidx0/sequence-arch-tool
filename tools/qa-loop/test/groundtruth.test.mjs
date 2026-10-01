/**
 * Locking test for the ground-truth wiring.
 *
 * `docs/ground-truth/{robot-shop,online-boutique,spring-petclinic,microrealestate}.json`
 * are four hand-verified edge truths that, before this harness, were consumed by
 * NOTHING. This test proves the join is real: a graph is scored against the
 * committed robot-shop truth through the shipped `scoreGraph`, and the result is
 * a score object with true positives — not a throw, and not a vacuous 0/0 that
 * would also "pass" if the wiring were broken.
 *
 * It deliberately uses a SYNTHETIC graph rather than a scan of the real repo:
 * this test must run in the correctness gate with no network and no clone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { REPO_ROOT, loadManifest } from '../lib/manifest.mjs';

const { scoreGraph } = await import(path.join(REPO_ROOT, 'packages/analyzer/dist/score.js'));

const TRUTH = path.join(REPO_ROOT, 'docs/ground-truth/robot-shop.json');

function svc(id, label) {
  return { id, kind: 'service', label };
}
function store(id, label) {
  return { id, kind: 'datastore', label };
}
function edge(id, srcId, dstId, kind) {
  return {
    id,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'synthetic.js', line: 1 }],
  };
}

/**
 * A graph that reproduces three of robot-shop's real service-level edges plus
 * one edge the truth does not contain, so precision and recall are both
 * partial — the shape a live scan actually produces.
 */
const SYNTHETIC = {
  mode: 'live',
  nodes: [
    svc('svc:cart', 'cart'),
    svc('svc:catalogue', 'catalogue'),
    svc('svc:user', 'user'),
    svc('svc:payment', 'payment'),
    store('ds:redis', 'redis'),
    store('ds:mongodb', 'mongodb'),
    { id: 'file:cart/server.js', kind: 'file', label: 'server.js', parentId: 'svc:cart', path: 'cart/server.js' },
  ],
  edges: [
    // in the truth
    edge('e1', 'file:cart/server.js', 'svc:catalogue', 'http'),
    edge('e2', 'svc:cart', 'ds:redis', 'db_read'),
    edge('e3', 'svc:user', 'ds:mongodb', 'db_write'),
    // NOT in the truth — a false positive, on purpose
    edge('e4', 'svc:payment', 'ds:mongodb', 'db_read'),
  ],
  warnings: [],
};

function writeTemp(graph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-loop-gt-'));
  const file = path.join(dir, 'graph.json');
  fs.writeFileSync(file, JSON.stringify(graph));
  return file;
}

test('scoreGraph consumes the committed robot-shop ground truth and returns a score', () => {
  const file = writeTemp(SYNTHETIC);
  const result = scoreGraph(file, TRUTH);
  assert.equal(typeof result.precision, 'number');
  assert.equal(typeof result.recall, 'number');
  assert.equal(typeof result.report, 'string');
  assert.ok(result.precision > 0, 'the truth file must actually match real edges — 0 precision means the wiring is dead');
  assert.ok(result.recall > 0);
  assert.equal(result.precision, 3 / 4, 'three of four predicted service-level edges are in the truth');
  assert.match(result.report, /cart -> catalogue \[http\]/);
});

test('db_read and db_write both lift to the truth\'s db_access family', () => {
  const file = writeTemp(SYNTHETIC);
  const { report } = scoreGraph(file, TRUTH);
  assert.match(report, /✓ cart -> redis \[db_access\]/);
  assert.match(report, /✓ user -> mongodb \[db_access\]/);
});

test('a file-level edge is lifted to its owning service before scoring', () => {
  // e1 is FILE -> service. If the lift ever broke, this edge would vanish from
  // the projection and recall would silently drop — which is exactly the class
  // of regression the harness watches for.
  const file = writeTemp(SYNTHETIC);
  const { report } = scoreGraph(file, TRUTH);
  assert.match(report, /✓ cart -> catalogue \[http\]/);
  assert.doesNotMatch(report, /file:cart/);
});

test('every ground-truthed manifest row points at a truth file scoreGraph can read', () => {
  const file = writeTemp(SYNTHETIC);
  for (const row of loadManifest().repos.filter((r) => r.groundTruth)) {
    const truth = path.resolve(REPO_ROOT, row.groundTruth);
    const result = scoreGraph(file, truth);
    assert.equal(typeof result.precision, 'number', `${row.id}: ${row.groundTruth} did not score`);
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(truth, 'utf8')).edges), `${row.id}: truth has no edges array`);
  }
});
