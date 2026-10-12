import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESILIENCE_PATTERNS,
  validateResilienceCatalog,
  type ResiliencePatternId,
} from './index.js';

const REQUIRED_IDS: ResiliencePatternId[] = [
  'read-cache',
  'circuit-breaker',
  'idempotent-consumer',
];

test('resilience catalog — validator passes', () => {
  assert.deepEqual(validateResilienceCatalog(RESILIENCE_PATTERNS), []);
});

test('resilience catalog — at least three grounded patterns ship', () => {
  assert.ok(RESILIENCE_PATTERNS.length >= 3);
});

test('resilience catalog — each pattern has id, domain, appliesWhen, checkerRules[]', () => {
  for (const p of RESILIENCE_PATTERNS) {
    assert.ok(p.id?.trim(), 'id');
    assert.ok(p.domain?.trim(), `${p.id} domain`);
    assert.ok(p.appliesWhen?.trim(), `${p.id} appliesWhen`);
    assert.ok(Array.isArray(p.checkerRules) && p.checkerRules.length > 0, `${p.id} checkerRules`);
    for (const rule of p.checkerRules) {
      assert.ok(rule.id?.trim(), `${p.id} rule id`);
      assert.ok(rule.description?.trim(), `${p.id} rule ${rule.id} description`);
    }
  }
});

test('resilience catalog — core pattern ids are present', () => {
  const ids = new Set(RESILIENCE_PATTERNS.map((p) => p.id));
  for (const id of REQUIRED_IDS) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});
