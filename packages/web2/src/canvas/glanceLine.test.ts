import { describe, expect, it } from 'vitest';

import { glanceLine, isGlanceNoise } from './glanceLine';

describe('isGlanceNoise — path and inventory dumps are not first-glance English', () => {
  it('rejects path + line-count dumps', () => {
    expect(isGlanceNoise('frontend/src/lib/engine/client.ts (ts, 563 lines)')).toBe(true);
  });

  it('rejects inventory lists', () => {
    expect(isGlanceNoise('lib · build · types · 2 more')).toBe(true);
    expect(isGlanceNoise('18 ts files in frontend, defining App.')).toBe(true);
  });

  it('keeps short role English', () => {
    expect(isGlanceNoise('Charges an order and records the receipt.')).toBe(false);
  });
});

describe('glanceLine — one line, annotate preferred', () => {
  it('prefers annotation over subtitle', () => {
    expect(glanceLine('Charges an order.', 'Takes payment for a checkout.')).toBe(
      'Takes payment for a checkout.',
    );
  });

  it('falls back to a clean subtitle', () => {
    expect(glanceLine('Charges an order.', null)).toBe('Charges an order.');
  });

  it('returns null when both are noise or absent', () => {
    expect(glanceLine('frontend/src/App.tsx (ts, 12 lines)', null)).toBeNull();
    expect(glanceLine(null, null)).toBeNull();
  });
});
