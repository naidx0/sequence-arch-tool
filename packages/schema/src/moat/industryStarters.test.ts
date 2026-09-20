import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRY_STARTERS, validateIndustryStarters } from './index.js';

const COMPOSE_KEY = /^[a-z][a-z0-9_-]*$/;

test('industry starters — validator passes', () => {
  assert.deepEqual(validateIndustryStarters(INDUSTRY_STARTERS), []);
});

test('industry starters — at least two starters ship', () => {
  assert.ok(INDUSTRY_STARTERS.length >= 2);
});

test('industry starters — each starter has id, title, fragmentIds[]', () => {
  for (const s of INDUSTRY_STARTERS) {
    assert.ok(s.id?.trim(), 'id');
    assert.ok(s.title?.trim(), `${s.id} title`);
    assert.ok(Array.isArray(s.fragmentIds), `${s.id} fragmentIds array`);
    assert.ok(s.fragmentIds.length > 0, `${s.id} fragmentIds non-empty`);
  }
});

test('industry starters — groundedOnly starters use compose-valid fragment ids', () => {
  for (const s of INDUSTRY_STARTERS) {
    if (!s.groundedOnly) continue;
    for (const frag of s.fragmentIds) {
      assert.match(
        frag,
        COMPOSE_KEY,
        `${s.id} fragment ${frag} must be a compose service key`
      );
    }
  }
});

test('industry starters — monolith-api and event-driven are present', () => {
  const ids = new Set(INDUSTRY_STARTERS.map((s) => s.id));
  assert.ok(ids.has('monolith-api'));
  assert.ok(ids.has('event-driven'));
});
