import { describe, expect, it } from 'vitest';

import cssRaw from './shell2.css?raw';

/* On touch :hover sticks after a tap, so the surface bar's drag grip stayed drawn over the tab labels (390 and
   1024 when the bar overflows). The grip's hover rule belongs to pointers that hover, as the lift's does. */
const css = cssRaw.replace(/\r\n/g, '\n');

describe('the surface bar drag grip', () => {
  it('is revealed on :hover only inside @media (hover: hover)', () => {
    const rule = css.indexOf(".s2-surfaces-wrap:hover[data-more='start']::before");
    expect(rule, 'the grip reveal rule').toBeGreaterThan(-1);
    const media = css.lastIndexOf('@media', rule);
    expect(css.slice(media, media + 24)).toBe('@media (hover: hover) {\n');
    /* the media block is still open at the rule: no closing brace at column 0 between them */
    expect(css.slice(media, rule)).not.toMatch(/\n\}/);
  });

  it('every :hover reveal of the grip is inside it (negative control: the resting rule is not)', () => {
    const all = [...css.matchAll(/\.s2-surfaces-wrap:hover\[data-more=[^\n]*::(?:before|after)/g)];
    expect(all.length).toBe(4);
    for (const m of all) {
      const media = css.lastIndexOf('@media', m.index);
      expect(css.slice(media, media + 22)).toBe('@media (hover: hover) ');
    }
    const resting = css.indexOf('.s2-surfaces-wrap::before,');
    expect(css.lastIndexOf('@media', resting)).toBeLessThan(css.lastIndexOf('\n}', resting));
  });
});
