import { describe, expect, it } from 'vitest';

import { createScreen, resizeScreen, SCROLLBACK_LINES, viewScreen, writeScreen } from './terminalScreen';

const E = '\u001b';
const draw = (s: ReturnType<typeof createScreen>) => viewScreen(s).lines.join('\n');

describe('the terminal screen: what a shell does to its line', () => {
  it('writes text, CR LF starts a new line, CR alone overwrites', () => {
    const s = writeScreen(createScreen(40, 6), 'one\r\ntwo\rXY');
    expect(draw(s)).toBe('one\nXYo');
  });
  it('Backspace then erase-to-end removes the last character (what a shell sends for Backspace)', () => {
    const s = writeScreen(createScreen(40, 6), '$ abc');
    writeScreen(s, `\b${E}[K`);
    expect(draw(s)).toBe('$ ab');
    expect(s.col).toBe(4);
  });
  it('history recall: the shell erases the line and writes the older one, no leftovers', () => {
    const s = writeScreen(createScreen(40, 6), '$ echo hello');
    writeScreen(s, `\r${E}[K$ ls`);
    expect(draw(s)).toBe('$ ls');
    writeScreen(s, `${E}[5D${E}[3P`);
    expect(s.col).toBe(0);
  });
  it('left arrow then typing inserts mid-line with the shell redrawing the tail', () => {
    const s = writeScreen(createScreen(40, 6), '$ ac');
    writeScreen(s, `${E}[D`);
    writeScreen(s, `b${E}[K`);
    writeScreen(s, `c`);
    expect(draw(s)).toBe('$ abc');
  });
  it('insert and delete characters (@ and P) shift the rest of the line', () => {
    const s = writeScreen(createScreen(40, 6), 'abcdef');
    writeScreen(s, `\r${E}[2C${E}[2@`);
    expect(draw(s)).toBe('ab  cdef');
    writeScreen(s, `${E}[2P`);
    expect(draw(s)).toBe('abcdef');
  });
  it('clear: ESC[2J ESC[H leaves a blank screen with the cursor at home; ESC[3J drops scrollback', () => {
    const s = createScreen(20, 3);
    writeScreen(s, 'a\r\nb\r\nc\r\nd\r\ne');
    expect(s.top).toBeGreaterThan(0);
    writeScreen(s, `${E}[H${E}[2J${E}[3J`);
    expect(draw(s)).toBe('');
    expect([s.row, s.col, s.top, s.lines.length]).toEqual([0, 0, 0, 3]);
  });
  it('colour, modes and titles draw nothing, and a sequence split across chunks still parses', () => {
    const s = createScreen(40, 6);
    writeScreen(s, `${E}[32mgreen${E}[m ${E}]0;title\u0007${E}[?25h${E}[?2004hok`);
    expect(draw(s)).toBe('green ok');
    const t = createScreen(40, 6);
    writeScreen(t, `ab${E}[3`);
    writeScreen(t, `1mcd${E}]0;ti`);
    writeScreen(t, `tle\u0007ef`);
    expect(draw(t)).toBe('abcdef');
  });
  it('wraps at the right edge and scrolls at the bottom, keeping scrollback', () => {
    const s = writeScreen(createScreen(5, 2), '123456789\r\nxy');
    /* Three rows on the grid (the terminal's own wrap), drawn as two lines (the wrap is joined back). */
    expect(s.lines.filter(Boolean)).toEqual(['12345', '6789', 'xy']);
    expect(draw(s)).toBe('123456789\nxy');
    expect(s.top).toBe(1);
  });
  it('rows the terminal wrapped come back as ONE line, with the cursor counted along it (a long Git Bash prompt)', () => {
    const s = writeScreen(createScreen(10, 4), '0123456789ABCDEFGHIJxyz');
    writeScreen(s, '\r\nnext');
    const v = viewScreen(s);
    expect(v.lines).toEqual(['0123456789ABCDEFGHIJxyz', 'next']);
    expect(v.cursor).toEqual({ line: 1, col: 4 });
    /* A line feed is not a wrap: those stay two lines. */
    expect(viewScreen(writeScreen(createScreen(10, 4), 'aaaaaaaaaa\r\nbbbb')).lines).toEqual(['aaaaaaaaaa', 'bbbb']);
    const w = writeScreen(createScreen(10, 4), 'abcdefghijkl');
    expect(viewScreen(w).cursor).toEqual({ line: 0, col: 12 });
  });
  it('a shell that opens by painting blank rows still starts at the top of the pane', () => {
    const s = createScreen(20, 8);
    writeScreen(s, `${E}[2J${E}[H${'\r\n'.repeat(7)}${E}[H`);
    writeScreen(s, '\r\nmax@box:~$ ');
    const v = viewScreen(s);
    expect(v.lines[0]).toBe('max@box:~$ ');
    expect(v.cursor).toEqual({ line: 0, col: 11 });
  });
  it('scrollback is capped so a long build does not grow without bound', () => {
    const s = createScreen(20, 4);
    for (let i = 0; i < SCROLLBACK_LINES + 500; i++) writeScreen(s, `line ${i}\r\n`);
    expect(s.lines.length).toBeLessThanOrEqual(SCROLLBACK_LINES + s.rows);
    expect(s.lines.some((l) => l === `line ${SCROLLBACK_LINES + 499}`)).toBe(true);
    expect(s.lines.includes('line 0')).toBe(false);
    expect(s.top).toBe(s.lines.length - s.rows);
  });
  it('resize keeps the cursor inside the grid', () => {
    const s = writeScreen(createScreen(80, 24), 'x'.repeat(70));
    resizeScreen(s, 20, 5);
    expect(s.col).toBeLessThan(20);
    expect(s.row).toBeLessThan(5);
  });
});
