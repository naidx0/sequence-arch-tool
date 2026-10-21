import { describe, expect, it } from 'vitest';

import { scanFacts } from './scanFacts.js';

describe('scanFacts — the definition line a card falls back to', () => {
  it("says a service's language and framework, in the scan's words, two facts at most", () => {
    const gateway = {
      label: 'gateway',
      meta: { framework: 'express', files: 6, languages: [{ language: 'ts', files: 6, loc: 89, share: 1 }] },
    };
    expect(scanFacts(gateway, 'Gateway')).toBe('ts, express');
  });

  it("says a datastore's role and leaves out the technology its title already names", () => {
    const store = { label: 'kvstore', meta: { tech: 'kvstore', role: 'broker' } };
    expect(scanFacts(store, 'Kvstore')).toBe('broker');
  });

  it('matches whole words only: "ts" is not inside "Payments"', () => {
    const payments = { label: 'payments', meta: { files: 3, languages: [{ language: 'ts', share: 1 }] } };
    expect(scanFacts(payments, 'Payments service')).toBe('ts, 3 files');
  });

  it('invents nothing: no facts on the node, no line', () => {
    expect(scanFacts({ label: 'edge', meta: { files: 0 } }, 'Edge service')).toBeNull();
    expect(scanFacts({ label: 'order.created' }, 'Order Created messages')).toBeNull();
  });

  it('picks the language with the largest share', () => {
    const mixed = { label: 'web', meta: { languages: [{ language: 'js', share: 0.2 }, { language: 'ts', share: 0.8 }] } };
    expect(scanFacts(mixed)).toBe('ts');
  });
});
