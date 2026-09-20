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
  it('renders **word** as STRONG and leaves globs alone', () => {
    /*
     * Owner 2026-08-26: asterisk soup (`**Hermes**`) made answers unreadable
     * because this surface did not render markdown bold, so the markers were
     * stripped. Decision 12 (2026-09-13) renders them instead: the text is the
     * same, and the span now says it is strong. Path globs that nest stars
     * (they contain `/` or `*` inside the pair) are still never emphasis.
     */
    const blocks = proseBlocks('match src/**/*.ts and **also** this');
    const spans = (blocks[0] as { spans: { text: string; strong?: boolean }[] }).spans;
    expect(spans.map((s) => s.text).join('')).toBe('match src/**/*.ts and also this');
    expect(spans.find((s) => s.text === 'also')?.strong).toBe(true);
    expect(spans.filter((s) => s.strong)).toHaveLength(1);
  });

  it('A SLASH BETWEEN TWO WORDS IS EMPHASIS, NOT A PATH', () => {
    /*
     * Owner's screen, 2026-09-13, in a lesson this product generated: a list
     * where `**Internal Reasoning Layer**` rendered bold and
     * `**Input/Request Stage**` printed its asterisks, one item above it. The
     * guard banned `/` inside the pair to protect globs, and caught ordinary
     * English instead. Both of his strings, verbatim.
     */
    for (const [source, expected] of [
      ['**Input/Request Stage**', 'Input/Request Stage'],
      ['**Read/Write Mix**: High read volume for queries.', 'Read/Write Mix'],
    ] as const) {
      const spans = (proseBlocks(source)[0] as { spans: { text: string; strong?: boolean }[] }).spans;
      expect(spans.some((s) => s.strong && s.text === expected), source).toBe(true);
      expect(spans.map((s) => s.text).join('')).not.toContain('**');
    }
  });

  it('TWO GLOBS IN ONE SENTENCE ARE STILL NOT EMPHASIS — the edge-space rule is what holds', () => {
    /*
     * The case the slash ban existed for, and the one the replacement has to
     * keep refusing. `src/** and dist/**` opens on the first pair; its inner
     * span would begin with a space, and markdown's own rule forbids that.
     */
    const spans = (proseBlocks('src/** and dist/** are built')[0] as {
      spans: { text: string; strong?: boolean }[];
    }).spans;
    expect(spans.some((s) => s.strong)).toBe(false);
    expect(spans.map((s) => s.text).join('')).toBe('src/** and dist/** are built');
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

  it('leaves > and | alone', () => {
    /* A redirect and a pipe. Still refused — see the header. */
    const text = '> not a quote\na | b';
    const spans = (proseBlocks(text)[0] as { spans: { text: string }[] }).spans;
    expect(spans.map((s) => s.text).join('')).toBe(text);
  });

  it('A # INSIDE A FENCE IS A COMMENT, and the same # outside it is a heading', () => {
    /*
     * The whole of the old guard, in one case. "# is a comment in shell" was
     * true and is still true — inside the fence, where shell lives. Outside a
     * fence, on the owner's screen (2026-09-13), it was the title of a lesson
     * painted as a hash mark.
     */
    const blocks = proseBlocks('## Design Proposal\n```sh\n# not a heading\nls\n```');
    expect(blocks[0]).toEqual({
      kind: 'heading',
      level: 2,
      spans: [{ text: 'Design Proposal', code: false }],
    });
    expect(blocks[1]).toEqual({ kind: 'code', text: '# not a heading\nls', language: 'sh' });
  });
});

describe('MARKDOWN-NATIVE — Decision 12', () => {
  it('a paragraph whose every line is an item is a list, in order', () => {
    const blocks = proseBlocks('1. User input is parsed.\n2. Context is retrieved.\n3. The model runs.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('list');
    const list = blocks[0] as { ordered: boolean; items: { text: string }[][] };
    expect(list.ordered).toBe(true);
    expect(list.items.map((item) => item.map((s) => s.text).join(''))).toEqual([
      'User input is parsed.',
      'Context is retrieved.',
      'The model runs.',
    ]);
  });

  it('a bulleted run is a list and a + is never a bullet', () => {
    const list = proseBlocks('- one\n* two\n• three')[0] as { kind: string; ordered: boolean; items: unknown[] };
    expect(list.kind).toBe('list');
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(3);
    /* `+ x` alone is not a list: it is an addition line. */
    expect(proseBlocks('+ added')[0]!.kind).toBe('para');
  });

  it('<details> becomes a disclosure whose body is parsed by the same rules', () => {
    const text = [
      '<details>',
      '<summary>Visual overview</summary>',
      '',
      '## Inside',
      '- a',
      '- b',
      '```',
      '# literal',
      '```',
      '</details>',
      'after',
    ].join('\n');
    const blocks = proseBlocks(text);
    expect(blocks).toHaveLength(2);
    const details = blocks[0] as { kind: string; summary: { text: string }[]; blocks: { kind: string }[] };
    expect(details.kind).toBe('details');
    expect(details.summary.map((s) => s.text).join('')).toBe('Visual overview');
    expect(details.blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'code']);
    expect(blocks[1]).toEqual({ kind: 'para', spans: [{ text: 'after', code: false }] });
  });

  it('an unclosed <details> is still a disclosure — a streaming answer is unclosed until it is not', () => {
    const blocks = proseBlocks('<details><summary>Steps</summary>\nfirst line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('details');
    const details = blocks[0] as { summary: { text: string }[]; blocks: { kind: string }[] };
    expect(details.summary[0]!.text).toBe('Steps');
    expect(details.blocks[0]!.kind).toBe('para');
  });

  it('a heading is not a list item and a fence in a list is not a bullet', () => {
    expect(proseBlocks('# Title')[0]!.kind).toBe('heading');
    /* A heading level is the number of hashes, capped by the regex at six. */
    expect((proseBlocks('### deep')[0] as { level: number }).level).toBe(3);
    expect(proseBlocks('####### seven')[0]!.kind).toBe('para');
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
