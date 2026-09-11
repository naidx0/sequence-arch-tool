import { describe, expect, it } from 'vitest';

import { inlineSpans, proseBlocks } from './proseBlocks';

/**
 * BOUNDED STRUCTURE — fences and inline code, and nothing else.
 *
 * The transcript renders every answer this product exists to give, and it
 * showed a fenced code block as literal backticks in an unindented paragraph.
 *
 * `paragraphs()`' guard is the reason this is bounded rather than a markdown
 * renderer: "a half-implemented markdown pass is how a diff, a path or a `**`
 * in a filename starts rendering as emphasis in the one surface whose job is to
 * reproduce what the engine said."
 *
 * The refusals below are therefore as load-bearing as the features.
 */

describe('fenced code', () => {
  it('becomes a code block, kept verbatim', () => {
    const blocks = proseBlocks('Here:\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nDone.');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'code', 'para']);
    const code = blocks[1] as { text: string; language: string | null };
    expect(code.text).toBe('const a = 1;\nconst b = 2;');
    expect(code.language).toBe('ts');
  });

  it('a fence with no language says null, rather than guessing one', () => {
    /* A fence tagged nothing is not a fence tagged `text`. Highlighting it as
       some language on a guess is a claim about code the model did not make. */
    const blocks = proseBlocks('```\nplain\n```');
    expect((blocks[0] as { language: string | null }).language).toBeNull();
  });

  it('A BLANK LINE INSIDE A FENCE DOES NOT SPLIT IT', () => {
    /* The whole reason scanning is stateful rather than a paragraph split with
       a regex pass afterwards. */
    const blocks = proseBlocks('```py\ndef a():\n\n    return 1\n```');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toBe('def a():\n\n    return 1');
  });

  it('a backtick inside a fence is content, not inline code', () => {
    const blocks = proseBlocks('```sh\necho `date`\n```');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toBe('echo `date`');
  });

  it('AN UNCLOSED FENCE IS STILL A CODE BLOCK', () => {
    /*
     * A streaming answer is unclosed for as long as it is arriving. Re-flowing
     * half of it as prose and then snapping it into a block when the closing
     * fence lands is a visible jump on every answer containing code.
     */
    const blocks = proseBlocks('Here:\n\n```ts\nconst half = ');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'code']);
    expect((blocks[1] as { text: string }).text).toBe('const half = ');
  });

  it('a ``` inside a ~~~ block is content', () => {
    /* Which is how a fenced example OF markdown survives being rendered. */
    const blocks = proseBlocks('~~~md\n```ts\nx\n```\n~~~');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toBe('```ts\nx\n```');
  });
});

describe('inline code', () => {
  it('a paired backtick becomes a code span', () => {
    const spans = inlineSpans('open `src/scan.ts` and look');
    expect(spans).toEqual([
      { text: 'open ', code: false },
      { text: 'src/scan.ts', code: true },
      { text: ' and look', code: false },
    ]);
  });

  it('AN UNPAIRED BACKTICK STAYS A BACKTICK', () => {
    /*
     * A lone backtick in prose is far more likely to be punctuation the model
     * typed than the start of a span it forgot to close. Swallowing the rest of
     * the paragraph into a code style would be a much louder error than showing
     * the character.
     */
    const spans = inlineSpans('a lone ` backtick here');
    expect(spans).toEqual([{ text: 'a lone ` backtick here', code: false }]);
  });

  it('an empty pair is two literal backticks, not an empty chip', () => {
    /* A zero-width code span is a mark with no content in it. */
    const spans = inlineSpans('see `` here');
    expect(spans.every((s) => !s.code)).toBe(true);
  });

  it('plain prose is one literal span', () => {
    expect(inlineSpans('nothing special')).toEqual([{ text: 'nothing special', code: false }]);
  });
});

describe('WHAT IT REFUSES TO PARSE, which is the point', () => {
  it('strips decorative **word** but leaves globs alone', () => {
    /*
     * Owner 2026-08-26: asterisk soup (`**Hermes**`) made answers unreadable
     * because this surface does not render markdown bold. Strip the markers;
     * keep path globs that nest stars (they contain `/` or `*` inside the pair).
     */
    const blocks = proseBlocks('match src/**/*.ts and **also** this');
    const spans = (blocks[0] as { spans: { text: string }[] }).spans;
    expect(spans.map((s) => s.text).join('')).toBe('match src/**/*.ts and also this');
  });

  it('does not strip ** that look like path/glob fragments', () => {
    const blocks = proseBlocks('see `src/**/*.ts` in the tree');
    const spans = (blocks[0] as { spans: { text: string; code: boolean }[] }).spans;
    expect(spans.some((s) => s.code && s.text === 'src/**/*.ts')).toBe(true);
  });

  it('LEAVES A DIFF ALONE — a removal line is not a bullet', () => {
    /*
     * A markdown bullet is "- " and a diff removal line is "- " just as often.
     * This product's answers are full of diffs, so a list pass would turn
     * deleted code into bullets, silently, in the one surface whose job is
     * fidelity.
     */
    const diff = '- const old = 1;\n+ const next = 2;';
    const blocks = proseBlocks(diff);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('para');
    const spans = (blocks[0] as { spans: { text: string }[] }).spans;
    expect(spans.map((s) => s.text).join('')).toBe(diff);
  });

  it('leaves # and > and | alone', () => {
    /* A comment in shell and Python, a redirect, and a pipe. */
    const text = '# not a heading\n> not a quote\na | b';
    const spans = (proseBlocks(text)[0] as { spans: { text: string }[] }).spans;
    expect(spans.map((s) => s.text).join('')).toBe(text);
  });
});

describe('paragraphs still work as they always did', () => {
  it('blank lines separate paragraphs', () => {
    const blocks = proseBlocks('one\n\ntwo');
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === 'para')).toBe(true);
  });

  it('a single line is a single paragraph', () => {
    expect(proseBlocks('just this')).toHaveLength(1);
  });

  it('empty text produces no blocks, rather than one empty paragraph', () => {
    expect(proseBlocks('')).toEqual([]);
    expect(proseBlocks('   \n\n  ')).toEqual([]);
  });

  it('CRLF is handled — core.autocrlf checks files out that way', () => {
    const blocks = proseBlocks('one\r\n\r\n```ts\r\nx\r\n```');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'code']);
    expect((blocks[1] as { text: string }).text).toBe('x');
  });
});
