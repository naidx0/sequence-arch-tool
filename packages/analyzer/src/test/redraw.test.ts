import assert from 'node:assert/strict';
import test from 'node:test';

import { redrawOf } from '../server/conceptChart.js';

const c = (title: string, labels: string[]) =>
  ({ version: 1, kind: 'data-flow', title, items: labels.map((label, i) => ({ id: `i${i}`, label })) }) as never;

test('the same title is the same picture, whatever the case or punctuation', () => {
  assert.equal(redrawOf([c('How an order moves', ['A'])], c('how an order moves!', ['Z'])), 0);
});

test('mostly the same boxes is the same picture, even retitled', () => {
  const first = c('Order flow', ['Gateway', 'Orders', 'Postgres']);
  assert.equal(redrawOf([first], c('Orders, end to end', ['gateway', 'orders', 'postgres', 'events'])), 0);
  /* 2 shared of 5 distinct labels is 40%, and 1 of 5 is 20%: different pictures. */
  assert.equal(redrawOf([first], c('Storage', ['Postgres', 'Orders', 'Tables', 'Migrations'])), undefined);
  assert.equal(redrawOf([first], c('Storage', ['Postgres', 'Tables', 'Migrations'])), undefined);
});

test('the latest matching chart is the one replaced, and nothing drawn yet means nothing to replace', () => {
  const a = c('Order flow', ['Gateway', 'Orders']);
  const b = c('Order flow', ['Gateway', 'Orders', 'Postgres']);
  assert.equal(redrawOf([a, c('Other', ['X']), b], c('Order flow', ['Gateway'])), 2);
  assert.equal(redrawOf([], a), undefined);
});
