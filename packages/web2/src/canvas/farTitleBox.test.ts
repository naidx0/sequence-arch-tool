/* ══════════════════════════════════════════════════════════════════════════
   S4 REVIEW, ITEM 1 — THE FAR TITLE FITS THE BOX THE LAYOUT GAVE IT.
   On the far rungs the condensed title is counter-scaled (board.css --far-s)
   and may take two lines. The box (cardHeight with the board's far scale) must
   hold the painted title block at EVERY far zoom, for every name on the board.
   The measurer is injected (a fixed advance per character, wider for capitals)
   so the arithmetic is tested without a browser; board-legibility.mjs checks
   the same thing in the real face on real repos.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { boardFarScale, cardBox, cardHeight, cardWidth, CARD_TEXT_H, CHIP_INSET, farTitleScaleMax, FAR_FIT_ZOOM } from './cardBox';
import { rungFor, visibilityAt } from './lod';
import type { BoardNode } from './NodeCard';
import { wordLines } from './titleFit';

/* ~ Archivo 14px at 450: 7.4 px a lower-case letter, 9.4 a capital, 3.6 a space. */
const measure = (text: string): number =>
  [...text].reduce((n, ch) => n + (ch === ' ' ? 3.6 : /[A-Z]/.test(ch) ? 9.4 : 7.4), 0);
const measurer = (text: string) => measure(text);

const node = (label: string): BoardNode =>
  ({ id: label, label, subtitle: null, present: { kind: 'service' } }) as unknown as BoardNode;

/* The shopfront board, whose two-line names broke, and a board of shapes that
   stress it: one letter, a word too wide for a line, a long module path. */
const SHOP = ['Notifications service', 'Order Created messages', 'Postgres database', 'Redis', 'Gateway',
  'Edge service', 'Inventory service', 'Invoices service', 'Orders service', 'Payments service', 'Shipping service'].map(node);
const STRESS = [...SHOP, ...['packages/web2 test harness', 'Authentication and session broker', 'x',
  'Supercalifragilisticexpialidocious'].map(node)];

/** The far scale board.css paints at (`--far-s`). */
function farScale(zoom: number, cap: number): number {
  const z = Math.max(zoom, 0.25);
  return Math.min(Math.max(Math.min(1 / z, cap), 9 / (14 * z)), cap);
}

/** What board.css paints (Decision 49): the chassis, and the row (chip and
 *  the words' column, CARD_TEXT_H tall) counter-scaled as one piece. */
function paintedBlock(_label: string, zoom: number, cap: number): number {
  return 22 + CARD_TEXT_H * farScale(zoom, cap);
}

/** How many lines the title takes beside the chip at that scale, in the far
 *  box the layout gave the card (the near card at the board's far scale). */
function titleLines(label: string, zoom: number, cap: number): number {
  const s = farScale(zoom, cap);
  const box = cardBox(node(label), { x: 0, y: 0 }, rungFor(zoom), false, null, measurer, cap);
  /* The chip keeps its size; the words are scaled in the room it leaves. */
  return wordLines(label, (box.w - 22 - CHIP_INSET) / s, measure);
}

const FAR_ZOOMS = Array.from({ length: 43 }, (_, i) => 0.25 + i * 0.01).filter((z) => !visibilityAt(rungFor(z)).title);

describe('far title box', () => {
  const cap = boardFarScale(SHOP, measurer)!;

  it('the board scale is the two-line fit, never past 1/FAR_FIT_ZOOM', () => {
    /* The chip shares the row and the card is the picked mix's 168-184
       (Decision 49), so the fit is under the old title-only 1.5: the widest
       word ("Notifications") beside the chip in a 184 card. It still lifts
       the far row above the camera's own scale. */
    expect(cap).toBeGreaterThan(1.1);
    expect(cap).toBeLessThanOrEqual(1 / FAR_FIT_ZOOM);
    expect(farTitleScaleMax(9)).toBeCloseTo(1 / FAR_FIT_ZOOM, 6);
    expect(FAR_ZOOMS.length).toBeGreaterThan(30);
  });

  it("every name's painted title block fits its box at every far zoom, on both boards", () => {
    const over: string[] = [];
    for (const board of [SHOP, STRESS]) {
      const s = boardFarScale(board, measurer)!;
      for (const n of board) {
        for (const z of FAR_ZOOMS) {
          const box = cardHeight(n, rungFor(z), false, null, measurer, s);
          const block = paintedBlock(n.label, z, s);
          if (block > box + 0.01) over.push(`${n.label} @${z.toFixed(2)}: ${block.toFixed(1)} > ${box}`);
          /* And the title stays in its two lines beside the chip at that scale. */
          if (titleLines(n.label, z, s) > 2 && n.label !== 'Supercalifragilisticexpialidocious')
            over.push(`${n.label} @${z.toFixed(2)}: ${titleLines(n.label, z, s)} lines`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it('control: the box without the far reservation does not hold a two-line far title', () => {
    const two = node('Notifications service');
    const z = 0.4;
    expect(paintedBlock(two.label, z, cap)).toBeGreaterThan(cardHeight(two, rungFor(z), false, null, measurer));
  });

  it('the near rungs ignore the far scale', () => {
    for (const n of STRESS) expect(cardHeight(n, 1, false, null, measurer, cap)).toBe(cardHeight(n, 1, false, null, measurer));
  });

  /* DECISION 48 (S4 review 4b): every box reserves the two-line title, so
     within a kind every box on the board is one height, at every rung, with
     no coupling between neighbours. Read off the layout's own input — the
     boxes ConnectedBoard hands ELK (cardBox at rung 1, far height in the far
     band) — on shopfront's names and on the stress board, whose names wrap
     one, two and (shortened) more lines. */
  it('within a kind, every box on the board is one height, near and far', () => {
    for (const board of [SHOP, STRESS]) {
      const s = boardFarScale(board, measurer)!;
      for (const z of [1, 0.8, 0.56, 0.4, 0.31, 0.25]) {
        const heights = new Set(
          board.map((n) => {
            const near = cardBox(n, { x: 0, y: 0 }, 1, false, null, measurer).h;
            const far = visibilityAt(rungFor(z)).title ? near : Math.max(near, cardHeight(n, rungFor(z), false, null, measurer, s));
            return far;
          }),
        );
        expect([...heights], `zoom ${z}`).toHaveLength(1);
      }
    }
    /* Control: the old rule, lines as measured at the far scale (where the
       review's shot was, 56%), gives shopfront two heights. */
    const s = boardFarScale(SHOP, measurer)!;
    const lines = new Set(SHOP.map((n) => Math.min(2, wordLines(n.label, (cardWidth(n.label, measurer) - 22 - CHIP_INSET) / s, measure))));
    expect(lines.size).toBe(2);
  });
});
