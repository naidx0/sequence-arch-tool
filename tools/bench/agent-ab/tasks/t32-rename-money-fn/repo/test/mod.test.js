import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../src/money.js';
import { line } from '../src/invoice.js';
test('formatMoney is exported and used', () => {
  assert.equal(formatMoney(1234), '$12.34');
  assert.equal(line('Pen', 250), 'Pen: $2.50');
});
