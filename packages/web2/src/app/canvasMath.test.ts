import { describe, expect, it } from 'vitest';

import { hasMath, splitMath } from './canvasMath';

/**
 * Owner, 2026-09-09: "really cool boards, math equations, and a lot of
 * different language in that sense." Equations were the one noun with nothing
 * behind it. docs/AI-CANVAS-IS-A-DOCUMENT.md §5 item 1.
 */
describe('splitMath', () => {
  it('finds an inline formula', () => {
    expect(splitMath('mass is $E = mc^2$ here')).toEqual([
      { kind: 'text', text: 'mass is ' },
      { kind: 'math', tex: 'E = mc^2', display: false },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('finds a display formula, and prefers it over the inline reading', () => {
    /*
     * `$$` is checked first because the one-character delimiter is a prefix of
     * it. The other order reads the first `$` of a block as an inline open and
     * never sees the block at all.
     */
    expect(splitMath('$$a + b$$')).toEqual([{ kind: 'math', tex: 'a + b', display: true }]);
  });

  it('A LONE DOLLAR IS NOT MATHS', () => {
    /*
     * The refusal that matters most. Prose on this canvas is full of costs and
     * shell snippets; a renderer that treated the first `$` as an opening
     * delimiter would swallow the rest of the sentence into a formula.
     */
    for (const prose of [
      'it cost $5 to run',
      'export $PATH now',
      'a $ alone',
      /*
       * THE CASE THAT WAS ACTUALLY BROKEN, and the reason the first three
       * passed vacuously: every one of them has a SINGLE dollar, so there was
       * never a second delimiter to close against. With two, the splitter
       * opened at `$5`, found `$PATH`, and swallowed the sentence between them
       * into a formula. Found by the component test, not by this one.
       */
      'it cost $5 to run and $PATH was set',
      'between $10 and $20 per month',
    ]) {
      expect(splitMath(prose)).toEqual([{ kind: 'text', text: prose }]);
      expect(hasMath(prose)).toBe(false);
    }
  });

  it('an empty or unclosed span stays literal', () => {
    expect(splitMath('$$')).toEqual([{ kind: 'text', text: '$$' }]);
    expect(splitMath('$ $')).toEqual([{ kind: 'text', text: '$ $' }]);
    expect(splitMath('open $x + 1')).toEqual([{ kind: 'text', text: 'open $x + 1' }]);
  });

  it('two formulas in one line both survive', () => {
    const out = splitMath('$a$ and $b$');
    expect(out.filter((s) => s.kind === 'math').map((s) => (s as { tex: string }).tex)).toEqual([
      'a',
      'b',
    ]);
  });

  it('text with no dollar at all is one segment', () => {
    expect(splitMath('plain prose')).toEqual([{ kind: 'text', text: 'plain prose' }]);
  });

  it('a formula that opens loose is not maths', () => {
    /* `$ x$` opens on a space — not a delimiter under the tight rule. */
    expect(splitMath('a $ x$ b')).toEqual([{ kind: 'text', text: 'a $ x$ b' }]);
  });

  it('display maths stays permissive, because $$ is unambiguous', () => {
    expect(splitMath('$$ a + b $$')).toEqual([
      { kind: 'math', tex: 'a + b', display: true },
    ]);
  });
});
