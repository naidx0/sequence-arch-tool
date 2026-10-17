import { describe, expect, it } from 'vitest';

import cssRaw from './shell2.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');

/* 0.1.8 C2 (owner: "the spacing between the icons and the names of the surfaces ... just make sure you're not condensing
   those too much"). The subject set is every rule in the stylesheet that sets the pill's gap, narrow container rules
   included, not the one we know of. */
describe('the surface pill keeps the space between its icon and its name (C2)', () => {
  const gaps = [...css.matchAll(/\.s2-sp-main \{([^}]*)\}/g)]
    .map((m) => /gap:\s*var\(--sp-(\d+)\)/.exec(m[1]!)?.[1])
    .filter((g): g is string => g !== undefined)
    .map(Number);

  it('has gap rules to hold to (positive control)', () => {
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });
  it('no rule, at any width, gives the icon less than 6 px from its name', () => {
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(6);
  });
  it('the narrow rules still fade rather than fold: names stay, only side padding shrinks', () => {
    expect(css).not.toMatch(/\.s2-surfaces\.is-compact \.s2-seg-l \{[^}]*display: none/);
  });
});
