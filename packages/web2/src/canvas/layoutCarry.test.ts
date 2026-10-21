import { afterEach, describe, expect, it } from 'vitest';

import { carriedLayout, drawnLayout, forgetLayouts, rememberLayout, type CarriedLayout } from './layoutCarry';

afterEach(forgetLayouts);

const at = (key: string, ids: string[]): CarriedLayout => ({ key, positions: Object.fromEntries(ids.map((id, i) => [id, { x: i * 100, y: 40 }])) });

describe('0.1.8.4 audit: the board never falls back to the seed pile while a layout is computed', () => {
  it('draws the layout for the current key once it has landed', () => {
    const l = at('k1', ['a', 'b']);
    expect(drawnLayout(l, null, 'k1', ['a', 'b'])).toBe(l);
  });
  it('keeps the previous arrangement when the key changes (a pane resize, a direction choice) until the new one lands', () => {
    const old = at('k1', ['a', 'b']);
    expect(drawnLayout(old, null, 'k2', ['a', 'b'])).toBe(old);
  });
  it('a remounted board draws what was carried over, not the seed', () => {
    const l = at('k1', ['a', 'b', 'c']);
    rememberLayout(['c', 'b', 'a'], l);
    expect(carriedLayout(['a', 'b', 'c'])).toBe(l);
    expect(drawnLayout(null, carriedLayout(['a', 'b', 'c']), 'k9', ['a', 'b', 'c'])).toBe(l);
  });
  it('gives up (the seed) when the stand-in does not place every card that is drawn', () => {
    expect(drawnLayout(at('k1', ['a']), null, 'k2', ['a', 'b'])).toBeNull();
    expect(drawnLayout(null, null, 'k1', ['a'])).toBeNull();
  });
  it('keeps only a few arrangements', () => {
    for (let i = 0; i < 9; i++) rememberLayout([`n${i}`], at('k', [`n${i}`]));
    expect(carriedLayout(['n0'])).toBeNull();
    expect(carriedLayout(['n8'])).not.toBeNull();
  });
});
