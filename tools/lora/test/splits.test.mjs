/**
 * The leak test. A held-out repo that quietly appears in training makes the
 * Phase 0 pass rate meaningless — and it is the kind of mistake that produces a
 * *better* number, so nothing else would catch it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { groundTruthIds, loadManifest, loadSplits, resolveSplits } from '../lib/corpus.mjs';

const manifest = loadManifest();
const splits = loadSplits();

test('the shipped split covers every manifest row exactly once', () => {
  const { train, heldOut } = resolveSplits(manifest, splits);
  assert.equal(train.length + heldOut.length, manifest.repos.length);
  const ids = [...train, ...heldOut].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'a repo is on both sides');
  assert.deepEqual(new Set(ids), new Set(manifest.repos.map((r) => r.id)));
});

test('train and held-out never overlap', () => {
  const { train, heldOut } = resolveSplits(manifest, splits);
  const trainIds = new Set(train.map((r) => r.id));
  for (const r of heldOut) assert.ok(!trainIds.has(r.id), `${r.id} leaked into training`);
});

test('all four hand-ground-truthed repos are held out (guide §5)', () => {
  const gt = groundTruthIds(manifest);
  assert.equal(gt.length, 4, 'the manifest should still carry exactly four ground-truthed rows');
  const heldOutIds = new Set(splits.heldOut);
  for (const id of gt) assert.ok(heldOutIds.has(id), `${id} carries ground truth but is not held out`);
});

test('every held-out repo says WHY it is held out', () => {
  for (const id of splits.heldOut) {
    assert.equal(typeof splits.heldOutWhy?.[id], 'string', `${id} is held out with no stated reason`);
  }
});

test('a split that puts ground truth in training is refused', () => {
  const bad = {
    train: [...splits.train, 'robot-shop'],
    heldOut: splits.heldOut.filter((id) => id !== 'robot-shop'),
  };
  assert.throws(() => resolveSplits(manifest, bad), /reserved for the eval set/);
});

test('a split that names a repo twice is refused', () => {
  const bad = { train: [...splits.train, 'vite'], heldOut: splits.heldOut };
  assert.throws(() => resolveSplits(manifest, bad), /appears in both/);
});

test('a split that forgets a manifest row is refused', () => {
  const bad = { train: splits.train.slice(1), heldOut: splits.heldOut };
  assert.throws(() => resolveSplits(manifest, bad), /is in neither split/);
});

test('a split naming a repo the manifest does not have is refused', () => {
  const bad = { train: [...splits.train, 'not-a-repo'], heldOut: splits.heldOut };
  assert.throws(() => resolveSplits(manifest, bad), /not in the manifest/);
});
