import { describe, expect, it } from 'vitest';

import { proseBlocks } from '../chat/proseBlocks';
import { normaliseDiagramFences, prepareMarkdown, splitFrontMatter } from './mdPrepare';

const MADR = `---
status: accepted
date: 2026-10-10
deciders: [Max, "Sequence team"]
tags:
  - queue
  - local
---

# 0007: Use a local queue

## Status

Accepted
`;

describe('front-matter is read as data, not as a rule and a paragraph', () => {
  it('splits the keys off and leaves the heading first', () => {
    const { meta, rest } = splitFrontMatter(MADR);
    expect(meta).toEqual([
      { key: 'status', value: 'accepted' },
      { key: 'date', value: '2026-10-10' },
      { key: 'deciders', value: 'Max, Sequence team' },
      { key: 'tags', value: 'queue, local' },
    ]);
    expect(rest.startsWith('# 0007')).toBe(true);
    expect(proseBlocks(rest)[0]).toMatchObject({ kind: 'heading' });
  });
  it('base behaviour: the renderer alone turns the block into a rule and a paragraph (why this exists)', () => {
    expect(proseBlocks(MADR).slice(0, 2).map((b) => b.kind)).toEqual(['rule', 'para']);
  });
  it('handles CRLF and a BOM', () => {
    expect(splitFrontMatter('\uFEFF' + MADR.replace(/\n/g, '\r\n')).meta).toHaveLength(4);
  });
  it('negative controls: a thematic break that opens a doc, an unclosed block, prose between rules', () => {
    for (const t of ['---\n\nHello there\n\n---\n', '---\nstatus: accepted\n\n# no close', '# Title\n\n---\na: b\n---\n']) {
      expect(splitFrontMatter(t)).toEqual({ meta: [], rest: t });
    }
  });
});

describe('diagram fences', () => {
  it('reduces mermaid with extra info and the mmd alias to the bare language', () => {
    const t = '```mermaid title="x"\ngraph LR\nA-->B\n```\n\n~~~mmd\ngraph LR\n~~~';
    expect(proseBlocks(t).map((b: { kind: string; language?: string | null }) => b.language ?? b.kind)).not.toContain('mermaid');
    expect(proseBlocks(normaliseDiagramFences(t)).map((b: { kind: string; language?: string | null }) => b.language)).toEqual(['mermaid', 'mermaid']);
  });
  it('leaves other fences, and anything written inside one, alone', () => {
    const t = '```ts\n```mermaid title="x"\n```\n\n```text\nhello\n```';
    expect(normaliseDiagramFences(t)).toBe(t);
  });
  it('does not touch a plain mermaid fence', () => {
    const t = '```mermaid\ngraph LR\n```';
    expect(normaliseDiagramFences(t)).toBe(t);
  });
});

describe('prepareMarkdown', () => {
  it('returns both halves', () => {
    const p = prepareMarkdown(MADR + '\n```mmd\ngraph LR\n```\n');
    expect(p.meta[0]).toEqual({ key: 'status', value: 'accepted' });
    expect(p.body).toContain('```mermaid');
  });
});

describe('a fence closes on its own line even with spaces or an indent (review B6)', () => {
  it('a later mermaid alias is still normalised after a trailing-space or indented close; "ss```" inside a fence does not close it', () => {
    expect(normaliseDiagramFences('```ts\ncode\n``` \n\n```mmd\ngraph LR\n```')).toContain('```mermaid\ngraph LR');
    expect(normaliseDiagramFences('- item\n  ```ts\n  code\n  ```\n\n```mmd\ngraph LR\n```')).toContain('```mermaid\ngraph LR');
    expect(normaliseDiagramFences('```ts\nss```\n```mmd\n```\n```mmd\ngraph LR\n```')).toContain('```mmd\n```\n```mermaid');
  });
});
