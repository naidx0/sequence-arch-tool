import { describe, expect, it } from 'vitest';

import first from './onboarding.css?raw';

/* The skills pop-up opened from Settings: about 25% wider than the 420 px it was, so people have room to work. */
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (c: string) => [...strip(c).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const last = (rs: { sel: string; body: string }[], sel: string) => rs.filter((r) => r.sel === sel).pop();

describe('skills pop-up size', () => {
  const rs = rulesOf(first);

  it('the Settings card is at least 520 px wide (was 420)', () => {
    const card = last(rs, '.fr-finder .fr-skills')!;
    const max = Number(/max-width:\s*(\d+)px/.exec(card.body)![1]);
    expect(max).toBeGreaterThanOrEqual(520);
    const basis = Number(/flex:\s*0 1 (\d+)px/.exec(card.body)![1]);
    expect(basis).toBeGreaterThanOrEqual(520);
  });

  it('the checklist shows more rows before it scrolls', () => {
    const lines = last(rs, '.fr-skills .fr-lines')!;
    expect(Number(/max-height:\s*(\d+)px/.exec(lines.body)![1])).toBeGreaterThanOrEqual(220);
  });
});
