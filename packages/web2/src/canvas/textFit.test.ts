import { describe, expect, it } from 'vitest';

import { wrappedLineCount, type TextMeasurer } from './textFit';

/*
 * WRAPPING, WITH A MEASURER THAT CANNOT LIE.
 *
 * `boardRendered.test.ts` proves the model against a real Chromium, which is the
 * lock that matters. This file proves the ALGORITHM against a face whose metrics
 * are stated, so a break tells you whether the wrapping is wrong or the browser
 * moved — two failures that look identical from the Chromium test alone.
 *
 * Ten px per character, one px per space. Trivial, and that is the point: every
 * expectation below can be checked by counting characters.
 */
const tenPerChar: TextMeasurer = (text) =>
  [...text].reduce((w, ch) => w + (ch === ' ' ? 1 : 10), 0);

describe('wrappedLineCount', () => {
  it('is one line when the string fits', () => {
    expect(wrappedLineCount('abc', 100, 'f', tenPerChar)).toBe(1);
  });

  it('breaks on words, not on characters, when the words fit', () => {
    /* "aaa bbb" is 10*6 + 1 = 61 wide; in 35px each 30px word takes its own
       line and the space never starts one. */
    expect(wrappedLineCount('aaa bbb', 35, 'f', tenPerChar)).toBe(2);
    expect(wrappedLineCount('aaa bbb', 61, 'f', tenPerChar)).toBe(1);
  });

  it('CLAMPS, because -webkit-line-clamp truncates rather than growing', () => {
    /* Four 30px words in 35px would be four lines; `.nd-s` clamps at two, and
       reserving the other two would be dead ground under ink the browser never
       paints. */
    expect(wrappedLineCount('aaa bbb ccc ddd', 35, 'f', tenPerChar, 2)).toBe(2);
    expect(wrappedLineCount('aaa bbb ccc ddd', 35, 'f', tenPerChar)).toBe(4);
  });

  it('breaks INSIDE a word too long for the box — overflow-wrap: anywhere', () => {
    /* `.nd-t` licenses a mid-word break, and a long identifier is exactly the
       title this must not under-count. 100px of word in a 30px box is 4 rows. */
    expect(wrappedLineCount('aaaaaaaaaa', 30, 'f', tenPerChar)).toBe(4);
  });

  it('continues beside the remainder of a broken word, as the browser does', () => {
    /* THE ARITHMETIC, because my first expectation here was wrong and the test
       caught it. A 50px word in a 30px box fills one full row and leaves 20px
       used on a second. The next word needs 20 + 1 (the space) + 10 = 31, which
       does NOT fit 30 — so it starts a third line, and the code was right. */
    expect(wrappedLineCount('aaaaa b', 30, 'f', tenPerChar)).toBe(3);
    /* One pixel more and the same string is two lines: that is the
       continuation, shown rather than asserted by adjective. */
    expect(wrappedLineCount('aaaaa b', 31, 'f', tenPerChar)).toBe(2);
  });

  it('says ONE when it cannot measure, rather than inventing a number', () => {
    /* jsdom has no 2D context. Returning 1 keeps `cardHeight` byte-identical to
       the arithmetic it replaced there — a fabricated width would make the model
       disagree with a real browser in a way no jsdom test could ever see. */
    const blind: TextMeasurer = () => Number.NaN;
    expect(wrappedLineCount('anything at all, however long', 10, 'f', blind)).toBe(1);
  });

  it('treats an empty or blank line as one box, never zero', () => {
    expect(wrappedLineCount('', 100, 'f', tenPerChar)).toBe(1);
    expect(wrappedLineCount('   ', 100, 'f', tenPerChar)).toBe(1);
  });
});
