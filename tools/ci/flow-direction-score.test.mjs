import assert from 'node:assert/strict';
import { test } from 'node:test';

import { score, sealedAsks } from '../bench/flow-direction-score.mjs';

const ids = sealedAsks().map((a) => a.id);

test('the sealed set is 40 distinct asks of 2 or 3 steps', () => {
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, 40);
  assert.ok(sealedAsks().every((a) => (a.steps === 2 || a.steps === 3) && new Set(a.labels).size === a.steps));
});

test('positive control: 30 TD wins, 10 LR wins is a TD win (z > 2)', () => {
  const j = ids.map((id, i) => ({ id, winner: i < 30 ? 'td' : 'lr' }));
  const r = score(j, ids);
  assert.equal(r.tdWins, 30);
  assert.ok(r.z > 2, `z=${r.z}`);
  assert.equal(r.verdict, 'td-wins');
});

test('negative controls: an even split, a TD edge inside 2 SE, and all ties all keep LR', () => {
  assert.equal(score(ids.map((id, i) => ({ id, winner: i % 2 ? 'td' : 'lr' })), ids).verdict, 'lr-stays');
  /* 24 vs 16: p=0.6, se~0.078, z~1.3. */
  const close = score(ids.map((id, i) => ({ id, winner: i < 24 ? 'td' : 'lr' })), ids);
  assert.ok(close.z < 2 && close.z > 1);
  assert.equal(close.verdict, 'lr-stays');
  assert.equal(score(ids.map((id) => ({ id, winner: 'tie' })), ids).verdict, 'lr-stays');
});

test('a missing, duplicated or malformed judgment is refused, not scored', () => {
  assert.throws(() => score(ids.slice(1).map((id) => ({ id, winner: 'td' })), ids), /missing/);
  assert.throws(() => score([...ids, ids[0]].map((id) => ({ id, winner: 'td' })), ids), /duplicate/);
  assert.throws(() => score(ids.map((id) => ({ id, winner: 'left' })), ids), /bad judgment/);
});
