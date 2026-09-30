import { describe, expect, it } from 'vitest';

import { saysMoreThan } from './naming';

/**
 * THE CARD MUST NOT SPEND THREE LINES SAYING ONE THING.
 *
 * Measured on ml-harness in the running app: a service card rendered the kind
 * chip "SERVICE", the title "Ml Harness service" and the subtitle "Ml Harness
 * service" — while `ml-harness`, the name a reader can actually search for, was
 * nowhere on it. Both the title and the subtitle come from `whatItIs`, which
 * over all 300 nodes of that repo was an exact echo of the label 293 times and
 * informative zero times.
 */
describe('saysMoreThan', () => {
  it('refuses an exact echo — the 293-node case', () => {
    expect(saysMoreThan('db.py', 'db.py')).toBe(false);
    expect(saysMoreThan('main.py', 'main.py')).toBe(false);
  });

  it('refuses a re-casing or re-punctuation', () => {
    expect(saysMoreThan('tests', 'Tests')).toBe(false);
    expect(saysMoreThan('api-types', 'Api Types')).toBe(false);
    expect(saysMoreThan('ml-harness', 'ml harness')).toBe(false);
  });

  it('refuses the label with its own kind appended — what the chip already says', () => {
    expect(saysMoreThan('ml-harness', 'Ml Harness service')).toBe(false);
    expect(saysMoreThan('Database', 'Database data store')).toBe(false);
    expect(saysMoreThan('analyzer', 'Analyzer service')).toBe(false);
    expect(saysMoreThan('orders', 'Orders topic')).toBe(false);
    expect(saysMoreThan('web2', 'Web2 component')).toBe(false);
  });

  it('KEEPS a summary that says something new — the rule is not "drop whatItIs"', () => {
    expect(saysMoreThan('payments', 'Charges an order and records the receipt.')).toBe(true);
    expect(saysMoreThan('analyzer', 'Reads a repository into a grounded graph.')).toBe(true);
  });

  it('keeps a summary that opens with the label but goes on to say more', () => {
    // The reader learns something after the first two words, so this is not a
    // restatement — the rule must not quietly eat real prose.
    expect(saysMoreThan('orders', 'Orders are validated here before billing.')).toBe(true);
  });

  it('is false for nothing at all, and never throws', () => {
    expect(saysMoreThan('thing', undefined)).toBe(false);
    expect(saysMoreThan('thing', null)).toBe(false);
    expect(saysMoreThan('thing', '   ')).toBe(false);
    expect(saysMoreThan('', 'Some real summary')).toBe(true);
  });
});
