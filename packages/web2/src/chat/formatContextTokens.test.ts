import { describe, expect, it } from 'vitest';

import { formatContextWindowTokens } from './ContextRing';

describe('formatContextWindowTokens', () => {
  it('agrees with the locale formatter for every whole number below a thousand', () => {
    for (let n = 0; n < 1000; n++) expect(formatContextWindowTokens(n)).toBe(n.toLocaleString('en-US'));
  });

  it('keeps the compact forms', () => {
    expect(formatContextWindowTokens(1000)).toBe('1k');
    expect(formatContextWindowTokens(1500)).toBe('1.5k');
    expect(formatContextWindowTokens(200_000)).toBe('200k');
    expect(formatContextWindowTokens(1_000_000)).toBe('1M');
    expect(formatContextWindowTokens(1_250_000)).toBe('1.3M');
  });

  it('still formats a fraction through the locale', () => {
    expect(formatContextWindowTokens(12.5)).toBe((12.5).toLocaleString('en-US'));
  });
});
