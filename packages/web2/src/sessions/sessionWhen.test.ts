import { describe, expect, it } from 'vitest';

import { sessionWhenLabel } from './sessionWhen';

describe('sessionWhenLabel', () => {
  it('renders coarse relative tokens', () => {
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    expect(sessionWhenLabel('2026-08-26T11:59:00.000Z', now)).toBe('1m');
    expect(sessionWhenLabel('2026-08-26T11:00:00.000Z', now)).toBe('1h');
    expect(sessionWhenLabel('2026-08-18T12:00:00.000Z', now)).toBe('8d');
  });

  it('returns empty for missing or invalid input', () => {
    expect(sessionWhenLabel(undefined)).toBe('');
    expect(sessionWhenLabel('not-a-date')).toBe('');
  });
});
