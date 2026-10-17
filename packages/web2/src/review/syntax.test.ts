import { describe, expect, it } from 'vitest';

import { SYNTAX_CLASSES, highlight, languageOf } from './syntax';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.1 — "RESTRAINED SYNTAX HIGHLIGHTING", TAKEN LITERALLY.

   GRAPHITE LAW 1: "Every hue on screen is a claim about the world, and there
   are never more hues than claims." A conventional highlighter spends five to
   nine hues on a distinction that is a claim about GRAMMAR, not about the
   world — and it spends them on a surface whose two real hues, the add and
   remove washes, are the whole point of looking at it. Sheet 12.7 counts five
   coloured objects in an entire two-turn conversation; a rainbow of keywords
   inside the diff would put more than that on one LINE.

   So the separation here is carried by the INK RAMP and by weight, which are
   the two axes the book already spends on hierarchy everywhere else:

     comment   --ink-4   the dimmest ink, italic — present, and never competing
     keyword   --ink-1   the brightest ink, --fw-solid
     string    --ink-2
     number    --ink-2
     everything else inherits, which is --ink-1 at the diff's own weight

   HUE BUDGET FOR THIS MODULE: ZERO. That is asserted below, because the way
   this rule dies is a later paste of a Prism theme, and a paste is caught by a
   test naming the class list and by nothing else.

   The tokenizer is deliberately small and deliberately NOT a parser. It reads
   one line at a time with no cross-line state, because a diff hunk starts in
   the middle of a file: there is no way to know whether line 40 is inside a
   block comment or a template literal, and a highlighter that guesses paints
   half a screen as a comment the moment a hunk opens after a `/*`.
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 5.1 — the highlighter spends no hue', () => {
  it('has exactly four token classes and they are the ink ramp, not a palette', () => {
    expect([...SYNTAX_CLASSES].sort()).toEqual(['com', 'kw', 'num', 'str']);
  });

  it('emits plain text as one untagged span', () => {
    expect(highlight('const', 'txt')).toEqual([{ text: 'const', cls: null }]);
  });
});

describe('item 5.1 — the tokenizer', () => {
  it('marks a keyword, and only where it is a whole word', () => {
    const spans = highlight('const reconstant = 1;', 'ts');
    expect(spans.filter((s) => s.cls === 'kw').map((s) => s.text)).toEqual(['const']);
  });

  it('marks a string and keeps its quotes', () => {
    const spans = highlight('const a = "hi there";', 'ts');
    expect(spans.filter((s) => s.cls === 'str').map((s) => s.text)).toEqual(['"hi there"']);
  });

  it('does not read a keyword out of the inside of a string', () => {
    const spans = highlight('const a = "return null";', 'ts');
    expect(spans.filter((s) => s.cls === 'kw').map((s) => s.text)).toEqual(['const']);
  });

  it('marks a line comment to the end of the line', () => {
    const spans = highlight('call(); // return early', 'ts');
    expect(spans.filter((s) => s.cls === 'com').map((s) => s.text)).toEqual(['// return early']);
  });

  it('does not read a comment out of a URL inside a string', () => {
    const spans = highlight('const u = "https://example.test/x";', 'ts');
    expect(spans.some((s) => s.cls === 'com')).toBe(false);
  });

  it('marks a number', () => {
    const spans = highlight('const n = 42;', 'ts');
    expect(spans.filter((s) => s.cls === 'num').map((s) => s.text)).toEqual(['42']);
  });

  it('is lossless — the spans rejoin to the exact input', () => {
    /* THE INVARIANT, and the reason it is stated as one. A tokenizer that
       drops a character renders a line of code that is not the line in the
       file, on the surface whose entire job is to show what changed. Every
       case above could pass while a stray brace vanished. */
    const samples = [
      'const a = "x"; // note',
      '  if (!claims) throw new AuthError("expired");',
      'def handle(self, n=3):  # python',
      '',
      '\t\tconst x = 0x1f;',
      'a /* not a line comment */ b',
    ];
    for (const line of samples) {
      expect(highlight(line, 'ts').map((s) => s.text).join('')).toBe(line);
    }
  });

  it('never emits an empty span', () => {
    for (const line of ['const a = 1;', '// only a comment', '   ']) {
      for (const span of highlight(line, 'ts')) expect(span.text.length).toBeGreaterThan(0);
    }
  });

  it('carries no cross-line state — a hunk that opens mid-block-comment is not swallowed', () => {
    const a = highlight('  return claims;', 'ts');
    const opened = highlight('/* an unterminated block', 'ts');
    const b = highlight('  return claims;', 'ts');
    expect(b).toEqual(a);
    expect(opened.length).toBeGreaterThan(0);
  });
});

describe('item 5.1 — language selection is by extension and refuses to guess', () => {
  it('reads the usual suspects', () => {
    expect(languageOf('src/a.ts')).toBe('ts');
    expect(languageOf('src/a.tsx')).toBe('ts');
    expect(languageOf('src/a.py')).toBe('py');
    expect(languageOf('a/b.css')).toBe('css');
    expect(languageOf('x.json')).toBe('json');
  });

  it('falls back to plain text rather than highlighting a file it cannot name', () => {
    expect(languageOf('LICENSE')).toBe('txt');
    expect(languageOf('a.wat')).toBe('txt');
    /* A dotfile is not an extension. `.gitignore` is not a file of type
       "gitignore" that this module knows how to colour. */
    expect(languageOf('.gitignore')).toBe('txt');
  });

  it('marks a python comment with # and not with //', () => {
    const spans = highlight('x = 1  # note', 'py');
    expect(spans.filter((s) => s.cls === 'com').map((s) => s.text)).toEqual(['# note']);
    expect(highlight('x = 1  # note', 'ts').some((s) => s.cls === 'com')).toBe(false);
  });
});
