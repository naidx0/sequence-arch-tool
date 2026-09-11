import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P2.6 — CSS contracts jsdom cannot paint.
 * Owner photo 2026-08-26: clumped cards, invisible hover, interior bar overlap.
 */
describe('P2.6 — board CSS contracts', () => {
  const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');

  it('anchors furniture to board-stack, not the window', () => {
    expect(css).toContain('.board-scope.board-stack');
    expect(css).toMatch(/\.board-scope\.board-stack[\s\S]*?position:\s*relative/);
  });

  it('places the interior bar bottom-left above furniture', () => {
    const block = css.match(/\.board-scope\.interiorbar[\s\S]*?\}/)?.[0] ?? '';
    expect(block).toContain('bottom: calc(var(--sp-16) + 128px)');
    expect(block).toContain('top: auto');
    expect(block).toContain('left: var(--sp-12)');
  });

  it('resting cards carry kind accent inset; hover lifts mid-air', () => {
    expect(css).toMatch(/\.board-scope \.node:hover[\s\S]*?translateY\(-5px\)/);
    expect(css).toMatch(/\.board-scope \.node \{[\s\S]*?inset 5px 0 0 0 var\(--arch-kind-accent\)/);
  });

  it('styles the expand-into control on the card header', () => {
    expect(css).toContain('.board-scope .node .nd-expand');
  });

  it('lifts an open kind key above the proposal bar', () => {
    const block =
      css.match(
        /\.board-scope \.boardfurniture > \.kindlegend\[data-kindlegend-open='true'\][\s\S]*?\}/,
      )?.[0] ?? '';
    expect(block).toContain('margin-bottom: calc(var(--sp-16) + 52px)');
    expect(block).toContain('z-index: 40');
  });

  it('does not paint a folder tab on module cards (P2.6)', () => {
    expect(css).not.toMatch(/\.board-scope \.n-module::before/);
    expect(css).not.toMatch(/\.board-scope \.n-module \{[\s\S]*?margin-top:\s*var\(--arch-tab-h\)/);
  });

  it('styles a live drag preview on the node being moved', () => {
    expect(css).toMatch(/\.board-scope \.react-flow__node\.dragging \.node[\s\S]*?opacity:/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL META STRIP MUST NOT PAINT OUTSIDE THE CARD
   docs/decisions/visual-board-mode-madr.md §0 (A1 — Visual is the default).

   WHAT THIS EXISTS BECAUSE OF, measured in the shipped bundle on this
   monorepo at rung 1: `.nd-meta` on `svc:web` had clientWidth 118 against
   scrollWidth 149 and on `svc:gateway` 118 against 143. Entry and Topic cards
   take --sp-20 side padding for their silhouettes, so their content box is 118
   where every other kind gets 138 — and 138 is exactly what the three-item row
   already needs, so every node the entry heuristic matches overflowed. `.node`
   computes `overflow: visible`, so the count numeral was painted on the dot
   grid outside the card's own border: the legibility gate's first rule
   ("nothing overflows its box") failing on the repository the gate runs
   against, with no reader action beyond opening the board.

   THIS IS A DECLARATION LOCK, NOT A MEASUREMENT, and the difference is stated
   rather than glossed: jsdom does not lay out flex, so it cannot reproduce the
   118-against-149. What it can hold is the four declarations that decide the
   outcome — the row clips, the two WORDS may shrink and ellipsise, and the two
   chips that no other channel carries may not. Remove any one of them and the
   overflow is back; the browser measurement belongs in an e2e.
   ══════════════════════════════════════════════════════════════════════════ */
describe('MADR A1 — the Visual strip stays inside the card', () => {
  const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
  /** The rule whose selector list STARTS with this text, body included. Sliced
   *  rather than matched: a regexp over a selector full of dots and braces is
   *  its own escaping bug, and this only has to find one literal prefix. */
  const block = (selectorPrefix: string): string => {
    const at = css.indexOf(selectorPrefix);
    expect(at, `no rule in board.css starts "${selectorPrefix}"`).toBeGreaterThan(-1);
    const end = css.indexOf('}', at);
    return css.slice(at, end + 1);
  };

  it('clips the row itself, so nothing can reach the board ground', () => {
    expect(block('.board-scope .node .nd-meta {')).toContain('overflow: hidden');
  });

  it('lets the two words give way — min-width: 0 is what unlocks a nowrap item', () => {
    /* A flex item's default `min-width: auto` is its content width, so
       `white-space: nowrap` text refuses to shrink and the ROW grows instead. */
    const words = block('.board-scope .node .nd-meta-kind,');
    expect(words).toContain('min-width: 0');
    expect(words).toContain('text-overflow: ellipsis');
    expect(words).toContain('white-space: nowrap');
  });

  it('never shrinks the provenance chip or the count', () => {
    /* Decision 2 gives kind four non-chromatic carriers and the flag silhouette
       carries Entry, so the words are the redundant items on this row. The
       chip and the count are carried by nothing else on a resting card. */
    expect(block('.board-scope .node .nd-meta .prov,')).toContain('flex: none');
  });
});
