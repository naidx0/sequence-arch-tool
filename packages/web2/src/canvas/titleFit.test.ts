import { describe, expect, it } from 'vitest';

import { TITLE_LINES, boardTitleFit, titleFit, twoLineText, wordLines } from './titleFit';

/* A monospace measurer: 8 units a character, so the arithmetic is exact. */
const mono = (t: string) => t.length * 8;

describe('a title wraps at word breaks to two lines, then is shortened in the middle', () => {
  it('counts lines at word breaks, and a word wider than the line cannot be placed', () => {
    expect(wordLines('Postgres database', 200, mono)).toBe(1); /* 136 */
    expect(wordLines('Postgres database', 100, mono)).toBe(2);
    expect(wordLines('Order Created messages', 100, mono)).toBe(3);
    expect(wordLines('graphQueryDepthTest', 100, mono)).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps a name that fits two lines, and shortens one that does not, keeping both ends', () => {
    expect(twoLineText('Postgres database', 100, mono)).toBe('Postgres database');
    const t = twoLineText('Order Created messages', 100, mono);
    expect(t).toMatch(/^Order .*….*messages$/);
    expect(wordLines(t, 100, mono)).toBeLessThanOrEqual(TITLE_LINES);
    const long = twoLineText('graphQueryDepthTest', 100, mono);
    expect(long).toContain('…');
    expect(wordLines(long, 100, mono)).toBeLessThanOrEqual(TITLE_LINES);
  });
});

describe('one title size for every card on the board', () => {
  it('a card\'s fit is the largest scale at which its name takes two lines at word breaks', () => {
    /* "Postgres database" on 218 of content: one line up to 218/136 = 1.6;
       two lines ("Postgres" 64, "database" 64) up to 218/64 = 3.406. */
    const f = titleFit('Postgres database', 218, mono)!;
    expect(f).toBeGreaterThan(3.3);
    expect(f).toBeLessThanOrEqual(218 / 64);
    expect(wordLines('Postgres database', 218 / f, mono)).toBeLessThanOrEqual(2);
    /* One word: one line, 218 / 56. */
    expect(titleFit('Shipping', 218, mono)).toBe(Math.floor((218 / 64) * 1000) / 1000);
  });

  it('the board shares the smallest fit, whatever the kind; unmeasurable names take no part', () => {
    const cards = [
      { text: 'Shipping', contentW: 146 },
      { text: 'Notifications', contentW: 218 },
      { text: 'Order Created messages', contentW: 218 },
    ];
    const each = cards.map((c) => titleFit(c.text, c.contentW, mono)!);
    expect(boardTitleFit(cards, mono)).toBe(Math.min(...each));
    const nan = (t: string) => (t === 'x' ? Number.NaN : mono(t));
    expect(boardTitleFit([{ text: 'x', contentW: 100 }, { text: 'ab', contentW: 100 }], nan)).toBe(titleFit('ab', 100, mono));
    expect(boardTitleFit([{ text: 'x', contentW: 100 }], nan)).toBeUndefined();
  });
});
