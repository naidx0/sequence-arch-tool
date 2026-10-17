import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GLYPHS } from '../src/chat/Icon';

/**
 * THE BOOK LOCK — Icon.tsx exposes exactly what the brand book defines.
 *
 * The icon set is transcribed from docs/brand/graphite/_core.html, not drawn.
 * This test is the mechanism that keeps that sentence true: every `ic-*`
 * symbol in the sprite must be exposed under its own name minus the prefix,
 * and nothing may be exposed that the book does not define. A missing entry
 * means a surface ships words where the book has a drawing; an invented one
 * means somebody extended the design language outside a numbered decision
 * (GRAPHITE-DECISIONS.md — sheets change only through this file).
 *
 * No exists-guards, no skips: the book path is resolved from the repo root
 * and a miss fails loudly.
 */
const BOOK = resolve(process.cwd(), '..', '..', 'docs', 'brand', 'graphite', '_core.html');

const bookNames = [
  ...readFileSync(BOOK, 'utf8').matchAll(/<symbol id="ic-([^"]+)"/g),
].map((m) => m[1]);

const exposedNames = Object.keys(GLYPHS);

describe('the book lock — Icon.tsx vs _core.html', () => {
  it('finds the book sprite', () => {
    expect(bookNames.length).toBeGreaterThan(0);
  });

  it('exposes every glyph the book defines', () => {
    const missing = bookNames.filter((n) => !exposedNames.includes(n));
    expect(missing).toEqual([]);
  });

  it('invents no names the book does not define', () => {
    const extra = exposedNames.filter((n) => !bookNames.includes(n));
    expect(extra).toEqual([]);
  });

  it('agrees with the book, one entry per symbol, no duplicates', () => {
    expect(new Set(bookNames).size).toBe(bookNames.length);
    expect(exposedNames.length).toBe(bookNames.length);
  });
});

describe('ic-thread — left edge (Decision 10)', () => {
  /*
   * Owner 2026-08-26: Chat icon looked cut off on the left. The path had the
   * top-left arc and tail but no left vertical — at 14px it read as clipping.
   * Done when: the path closes the bubble body along x=4 back to the start.
   */
  it('closes the bubble left wall after the tail', () => {
    const d = GLYPHS.thread[0];
    expect('p' in d).toBe(true);
    if (!('p' in d)) return;
    expect(d.p).toMatch(/V16\.5H4V6\.2$/);
  });

  it('matches the book sprite path byte-for-byte', () => {
    const book = readFileSync(BOOK, 'utf8');
    const m = book.match(/<symbol id="ic-thread"[^>]*><path d="([^"]+)"/);
    expect(m).not.toBeNull();
    const bookPath = m![1];
    const exposed = GLYPHS.thread.map((shape) => ('p' in shape ? shape.p : '')).join('');
    expect(exposed).toBe(bookPath);
  });
});
