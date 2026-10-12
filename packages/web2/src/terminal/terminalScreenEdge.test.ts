import { describe, expect, it } from 'vitest';

import { charWidth, createScreen, viewScreen, writeScreen } from './terminalScreen';

const E = '\u001b';
const draw = (s: ReturnType<typeof createScreen>) => viewScreen(s).lines.join('\n');
const SMILE = String.fromCodePoint(0x1f600);

describe('terminal screen edge cases (review of d9557247)', () => {
  it('a surrogate pair is never split at the wrap edge, and a wide character counts two columns', () => {
    const s = writeScreen(createScreen(4, 3), 'abc' + SMILE + 'z');
    /* The emoji is wide: it does not fit in the one column left, so it wraps whole. */
    expect(s.lines.slice(0, 2)).toEqual(['abc', SMILE + 'z']);
    expect(s.col).toBe(3);
    for (const row of s.lines) expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(row)).toBe(false);
    const cjk = writeScreen(createScreen(10, 2), '中X');
    expect(cjk.col).toBe(3);
    expect(charWidth(0x4e2d)).toBe(2);
    expect(charWidth(0x41)).toBe(1);
    expect(charWidth(0x301)).toBe(0);
  });

  it('a combining mark takes no column and the cursor maps to the drawn text', () => {
    const s = writeScreen(createScreen(10, 2), 'éx');
    expect(s.col).toBe(2);
    expect(draw(s)).toBe('éx');
    expect(viewScreen(s).cursor).toEqual({ line: 0, col: 3 });
    const w = writeScreen(createScreen(10, 2), '中x');
    expect(viewScreen(w).cursor).toEqual({ line: 0, col: 2 });
  });

  it('overwriting half of a wide character leaves no orphan half', () => {
    const s = writeScreen(createScreen(10, 2), '中');
    writeScreen(s, '\rX');
    expect(draw(s)).toBe('X ');
  });

  it('an unterminated OSC over 512 characters drops only its introducer, not the rest of the chunk', () => {
    const t = writeScreen(createScreen(40, 3), E + ']0;' + 'y'.repeat(600) + '\r\nafter');
    expect(draw(t)).toMatch(/after$/);
    /* Negative control: a terminated one swallows its payload. */
    const u = writeScreen(createScreen(40, 3), E + ']0;title\u0007ok');
    expect(draw(u)).toBe('ok');
  });

  it('DCS, SOS, PM and APC strings are consumed up to ST, like OSC', () => {
    for (const intro of ['P', 'X', '^', '_']) {
      const s = writeScreen(createScreen(40, 2), 'a' + E + intro + 'secret payload' + E + '\\b');
      expect(draw(s)).toBe('ab');
    }
    const split = createScreen(40, 2);
    writeScreen(split, 'a' + E + 'Pse');
    writeScreen(split, 'cret' + E + '\\b');
    expect(draw(split)).toBe('ab');
  });

  it('Backspace from the pending-wrap position lands on cols-2, like xterm', () => {
    const s = writeScreen(createScreen(5, 2), '12345');
    expect(s.col).toBe(5);
    writeScreen(s, '\b');
    expect(s.col).toBe(3);
    /* Negative controls: mid-line it is one column left. */
    expect(writeScreen(createScreen(5, 2), '12').col).toBe(2);
    expect(writeScreen(writeScreen(createScreen(5, 2), '12'), '\b').col).toBe(1);
    /* Erase-to-end from the pending position clears the last character. */
    expect(draw(writeScreen(createScreen(5, 2), '12345' + E + '[K'))).toBe('1234');
    /* A colour change does not cancel the pending wrap: the next character still wraps. */
    const c = writeScreen(createScreen(5, 2), '12345' + E + '[mX');
    expect(draw(c)).toBe('12345X');
    expect(c.row).toBe(1);
  });
});
