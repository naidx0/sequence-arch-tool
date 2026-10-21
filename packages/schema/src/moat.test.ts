import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INDUSTRY_STARTERS,
  RESILIENCE_PATTERNS,
  validateIndustryStarters,
  validateResilienceCatalog,
} from './moat/index.js';

describe('moat catalog validators (r204)', () => {
  it('resilience catalog is non-empty and validates', () => {
    assert.ok(RESILIENCE_PATTERNS.length >= 3);
    assert.deepEqual(validateResilienceCatalog(RESILIENCE_PATTERNS), []);
  });

  it('industry starters are non-empty and validate', () => {
    assert.ok(INDUSTRY_STARTERS.length >= 2);
    assert.deepEqual(validateIndustryStarters(INDUSTRY_STARTERS), []);
  });
});
