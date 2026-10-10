import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fenceLanguage } from './CodeBlock';
import { ProseMessage } from './ProseMessage';
import { inlineSpans, proseBlocks } from './proseBlocks';

/* Round 9, Jaden: "allow for bold headers to be used" and "the overall chat
   interface is just hard to read". Full Markdown in answers, each new block
   with a guard that keeps code and shell text literal. */

describe('quotes: a paragraph whose every line starts with "> "', () => {
  it('is a quote, its body parsed by the same rules', () => {
    const [q] = proseBlocks('> **Note** the cache\n> is cold');
    expect(q!.kind).toBe('quote');
    const inner = (q as { blocks: { kind: string; spans: { text: string; strong?: boolean }[] }[] }).blocks;
    expect(inner[0]!.kind).toBe('para');
    expect(inner[0]!.spans[0]).toMatchObject({ text: 'Note', strong: true });
  });
  it('a redirect in a sentence or a mixed paragraph stays text (negative control)', () => {
    expect(proseBlocks('echo hi > out.txt')[0]!.kind).toBe('para');
    expect(proseBlocks('> quoted\nnot quoted')[0]!.kind).toBe('para');
  });
});

describe('tables: a header row, then a separator row', () => {
  it('is a table with alignment and inline spans in cells', () => {
    const [t] = proseBlocks('| File | Lines |\n|:---|---:|\n| `a.ts` | 12 |\n| **b.ts** | 4 |');
    expect(t!.kind).toBe('table');
    const table = t as Extract<ReturnType<typeof proseBlocks>[number], { kind: 'table' }>;
    expect(table.align).toEqual(['left', 'right']);
    expect(table.head.map((c) => c[0]!.text)).toEqual(['File', 'Lines']);
    expect(table.rows[0]![0]![0]).toMatchObject({ text: 'a.ts', code: true });
    expect(table.rows[1]![0]![0]).toMatchObject({ text: 'b.ts', strong: true });
  });
  it('a pipe without a separator row is a sentence (negative control)', () => {
    expect(proseBlocks('a | b\nc | d')[0]!.kind).toBe('para');
    expect(proseBlocks('cat x | grep y')[0]!.kind).toBe('para');
  });
  it('inside a fence a table is code', () => {
    expect(proseBlocks('```\n| a | b |\n|---|---|\n```')[0]!.kind).toBe('code');
  });
});

describe('tables need no blank line around them (the GitHub rule)', () => {
  const kinds = (t: string) => proseBlocks(t).map((b) => b.kind);
  it('a sentence directly above the header row, and a sentence directly below the last row, are each their own block', () => {
    expect(kinds('Results:\n| a | b |\n|---|---|\n| 1 | 2 |')).toEqual(['para', 'table']);
    expect(kinds('| a | b |\n|---|---|\n| 1 | 2 |\nThat is all.')).toEqual(['table', 'para']);
    expect(kinds('Before\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter')).toEqual(['para', 'table', 'para']);
  });
  it('the table keeps its rows when text sits against it', () => {
    const t = proseBlocks('Results:\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')[1] as Extract<ReturnType<typeof proseBlocks>[number], { kind: 'table' }>;
    expect(t.rows).toHaveLength(2);
    expect(t.head.map((c) => c[0]!.text)).toEqual(['a', 'b']);
  });
  it('renders as a real table with no pipes left in the text', () => {
    render(<ProseMessage text={'Results:\n| Name | Value |\n| --- | --- |\n| a | 1 |\nDone.'} />);
    expect(screen.getByTestId('chat-table').querySelectorAll('th')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/\|/);
  });
  it('the separator must have as many columns as the header (GitHub): a mismatch is text, whole or embedded', () => {
    expect(kinds('| a | b |\n|---|---|---|\n| 1 | 2 |')).toEqual(['para']);
    expect(kinds('Results:\n| a | b | c |\n|---|---|\n| 1 | 2 | 3 |')).toEqual(['para']);
    expect(kinds('Results:\n| a | b |\n|---|---|\n| 1 | 2 |')).toEqual(['para', 'table']);
  });
  it('negative controls: a pipe sentence under a sentence is still text; a quote is left whole', () => {
    expect(kinds('Results:\ncat x | grep y')).toEqual(['para']);
    expect(kinds('> Results:\n> | a | b |\n> |---|---|')).toEqual(['quote']);
  });
});

describe('italics hug a word', () => {
  it('*word* and _word_ are emphasis', () => {
    expect(inlineSpans('a *quiet* b')).toEqual([
      { text: 'a ', code: false },
      { text: 'quiet', code: false, em: true },
      { text: ' b', code: false },
    ]);
    expect(inlineSpans('an _aside_.').find((s) => s.em)?.text).toBe('aside');
  });
  it('snake_case, a * b * c, globs and code are left alone (negative controls)', () => {
    for (const t of ['snake_case_name here', 'a * b * c', 'src/*.ts and lib/*.js', 'x_1 and y_2']) {
      expect(inlineSpans(t).some((s) => s.em)).toBe(false);
      expect(inlineSpans(t).map((s) => s.text).join('')).toBe(t);
    }
    expect(inlineSpans('`*not*`')).toEqual([{ text: '*not*', code: true }]);
  });
  it('emphasis and bold that span a soft line break are still emphasis (no literal asterisks)', () => {
    const em = inlineSpans('*"two\nline quote"* after');
    expect(em.find((s) => s.em)?.text).toBe('"two\nline quote"');
    expect(em.map((s) => s.text).join('')).not.toContain('*');
    const strong = inlineSpans('a **wrapped\nbold** b');
    expect(strong.find((s) => s.strong)?.text).toBe('wrapped\nbold');
    expect(inlineSpans('an _under\nscored_ aside').find((s) => s.em)?.text).toBe('under\nscored');
    /* negative control: a lone star across a break pairs with nothing */
    expect(inlineSpans('a * b\nc * d').some((s) => s.em)).toBe(false);
  });
  it('bold still wins over its own stars', () => {
    expect(inlineSpans('**bold**')).toEqual([{ text: 'bold', code: false, strong: true }]);
  });
});

describe('rules', () => {
  it('a line of --- between paragraphs is a rule, inside a fence it is text', () => {
    expect(proseBlocks('one\n\n---\n\ntwo').map((b) => b.kind)).toEqual(['para', 'rule', 'para']);
    expect(proseBlocks('```\n---\n```')[0]!.kind).toBe('code');
  });
});

describe('the rendered answer', () => {
  afterEach(() => vi.restoreAllMocks());

  const answer = [
    '## Why it stalls',
    '',
    'The gateway *retries* forever. **Fix it** in `server.ts`:',
    '',
    '```ts',
    'const limit = 3; // stop',
    '```',
    '',
    '> Measured on the real repo.',
    '',
    '| Step | Time |',
    '|---|---|',
    '| read | 2 s |',
    '',
    '- one',
    '- two',
    '',
    'See [the docs](https://example.test/docs).',
  ].join('\n');

  it('draws headings, bold, italics, code, quote, table, list and link as elements', () => {
    render(<ProseMessage text={answer} />);
    expect(screen.getByTestId('chat-heading').tagName).toBe('H2');
    expect(screen.getByTestId('chat-strong').textContent).toBe('Fix it');
    expect(screen.getByTestId('chat-em').textContent).toBe('retries');
    expect(screen.getByTestId('chat-tick').textContent).toBe('server.ts');
    expect(screen.getByTestId('chat-quote').tagName).toBe('BLOCKQUOTE');
    expect(screen.getByTestId('chat-table').querySelectorAll('th')).toHaveLength(2);
    expect(screen.getByTestId('chat-list').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'the docs' }).getAttribute('href')).toBe('https://example.test/docs');
    /* No marker survives as text. */
    expect(document.body.textContent).not.toMatch(/##|\*\*|\|---/);
  });

  it('a code block has its language, a Copy button that copies, and highlighted tokens', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ProseMessage text={answer} />);
    const block = screen.getByTestId('chat-code-block');
    expect(block.getAttribute('data-language')).toBe('ts');
    expect(block.textContent).toContain('const limit = 3; // stop');
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-code-copy'));
    });
    expect(writeText).toHaveBeenCalledWith('const limit = 3; // stop');
    expect(screen.getByTestId('chat-code-copy').textContent).toBe('Copied');
    /* The highlighter loads with the first block; then the keyword is a token. */
    await vi.waitFor(() => expect(block.querySelector('.r9-t-kw')?.textContent).toBe('const'));
    expect(block.querySelector('.r9-t-com')?.textContent).toBe('// stop');
  });

  it('fence names map onto the highlighter, unknown ones stay plain', () => {
    expect(fenceLanguage('typescript')).toBe('ts');
    expect(fenceLanguage('Python')).toBe('py');
    expect(fenceLanguage('bash')).toBe('sh');
    expect(fenceLanguage('haskell')).toBe('txt');
    expect(fenceLanguage(null)).toBe('txt');
  });
});
