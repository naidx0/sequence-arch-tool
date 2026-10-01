import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';

import { substituteVars } from '../../test/support/css';
import { annotatedCountForLayout, CARD_FLOOR, CARD_W, cardHeight } from './cardBox';
import { VISUAL_STRIP_H, VISUAL_STRIP_WORDS_H, visualExtraHeight } from './visualMeta';
import type { BoardNode } from './NodeCard';

function px(name: string): number {
  const raw = substituteVars(`var(${name})`, document.documentElement);
  const value = Number.parseFloat(raw);
  expect(Number.isFinite(value), `${name} did not resolve: "${raw}"`).toBe(true);
  return value;
}

const base: BoardNode = {
  id: 'svc:checkout',
  label: 'checkout',
  subtitle: null,
  present: { kind: 'service', entry: false },
  schemaKind: 'service',
  provenance: null,
  count: null,
};

/**
 * ITEM 3.3 — HEIGHT IS CONTENT, AND THE FLOOR IS ONLY A FLOOR.
 *
 * THESE ARE THE RAMP'S OWN NUMBERS, AND THEY ARE NOT THE SHEET'S LITERALS.
 * Sheet 02.3 derives 56 / 75 / 99 from an anatomy that has not shipped since
 * P2.6 — a `.nd-hd` row above a `.nd-t` at --lh-12 — so this file re-derives
 * the rows the card ACTUALLY renders, from the LIVE tokens: the chassis, the
 * `.nd-body` padding-top variant that the rendered class picks, one --lh-14
 * title line box and, when a glance line shows, the body's own --sp-4 gap and
 * one --lh-11 line box. See `cardBox.ts`'s header for the full account.
 *
 * AND THESE ASSERTIONS ARE NOT THE LOCK — `cardPainted.test.tsx` IS. Everything
 * here compares `cardBox.ts` to the token ramp, which is the same ramp
 * `cardBox.ts` is written from; the rows themselves are only proved right by
 * measuring a card that rendered. That is why this file was green for a whole
 * wave while every declared box was seven units short of its card.
 *
 * IT IS ALSO WHERE THE ROUTER'S GEOMETRY IS LOCKED. v1 routes every edge and
 * computes every hit region against a hardcoded 160 x 96 — over-tall by up to
 * 58px on a one-line card — so edges terminate on air.
 */
describe('item 3.3 — how tall a card actually is', () => {
  it('derives the shipped rows from the live ramp', () => {
    const sp2 = px('--sp-2');
    const sp4 = px('--sp-4');
    const sp6 = px('--sp-6');
    const sp10 = px('--sp-10');
    const lh11 = px('--lh-11');
    const lh14 = px('--lh-14');
    const hair = px('--w-hair');

    const chassis = sp10 * 2 + hair * 2;
    /* `.nd-body.title-only` — --sp-2 of lid over one `.nd-t` line box. */
    const minimum = chassis + sp2 + lh14;
    /* `.nd-body.with-sub` — a DIFFERENT lid (--sp-6), plus the body's own
       column gap and the `.nd-s` line box. The lid step is four units and it
       was missing from every earlier version of this arithmetic. */
    const withSubtitle = chassis + sp6 + lh14 + sp4 + lh11;

    expect(minimum).toBe(45);
    expect(withSubtitle).toBe(68);

    expect(CARD_FLOOR).toBe(minimum);
    expect(cardHeight(base, 1)).toBe(minimum);
    expect(cardHeight({ ...base, subtitle: 'Charges an order.' }, 1)).toBe(withSubtitle);
    /* Provenance waits for select — rest layout stays first-glance tall. */
    expect(
      cardHeight({ ...base, subtitle: 'Charges an order.', provenance: 'traced' }, 1),
    ).toBe(withSubtitle);
  });

  /**
   * THE LOCK THE BRIEF NAMES: a subtitle-less card is one text line tall.
   *
   * It is stated in the ramp's own units rather than in pixels: a card with no
   * subtitle holds ONE row, the title, because the icon is absolutely
   * positioned and takes none. Its ink is --lh-14 and its box is that plus the
   * body's --sp-2 lid plus the chassis. Anything taller is room being held for
   * a rung the card does not have.
   */
  it('keeps a subtitle-less card to one text line of ink', () => {
    const chassis = px('--sp-10') * 2 + px('--w-hair') * 2;

    expect(cardHeight(base, 1)).toBe(chassis + px('--sp-2') + px('--lh-14'));
    // And it is genuinely SHORTER than the card beside it that says more —
    // "that difference is a reading of the graph rather than noise in it."
    expect(cardHeight(base, 1)).toBeLessThan(
      cardHeight({ ...base, subtitle: 'Charges an order.' }, 1),
    );
  });

  it('does not use --arch-card-min-h as the floor', () => {
    // THE DEFECT, NAMED. The substrate declares the floor at 96, which is
    // within a hair of the FULLEST card, so a card with no subtitle becomes
    // 45px of card and 51px of dead ground — and the emptiest kinds, the ones
    // that never had a subtitle, get the most of it.
    const declared = px('--arch-card-min-h');
    expect(declared).toBe(96);
    expect(CARD_FLOOR).toBeLessThan(declared);
    expect(declared - CARD_FLOOR).toBe(51);
  });

  it('keeps the width fixed, because a board reads as a board when columns line up', () => {
    expect(CARD_W).toBe(px('--arch-card-w'));
  });

  it('gives a dropped rung its room back', () => {
    // Sheet 08.2: "a dropped rung takes its room with it. The height floor
    // governs the resting card, not a card that has already given something
    // up." A card that dropped its subtitle and kept the space is a block box
    // with one line at the top and dead ground under it.
    const full: BoardNode = { ...base, subtitle: 'Charges an order.', provenance: 'traced' };
    const heights = [1, 2, 3, 4, 5, 6, 7].map((rung) => cardHeight(full, rung as 1));

    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]!, `rung ${i + 1} is not shorter than rung ${i}`).toBeLessThanOrEqual(
        heights[i - 1]!,
      );
    }
    expect(heights[0]).toBe(68);
    // The mark rung is a dot, not a card.
    expect(heights[6]).toBe(px('--dot'));
  });

  it('gives every kind the same chassis height (P2.6 — no folder-tab margin)', () => {
    /* Owner: kinds are icons, not competing silhouettes. Module no longer
       reserves --arch-tab-h above the body. */
    const module: BoardNode = { ...base, present: { kind: 'module', entry: false }, schemaKind: 'module' };
    const store: BoardNode = { ...base, present: { kind: 'storage', entry: false }, schemaKind: 'datastore' };
    expect(cardHeight(module, 1)).toBe(cardHeight(base, 1));
    expect(cardHeight(store, 1)).toBe(cardHeight(base, 1));
  });

  it('reserves one more line for an annotation, and only where the subtitle shows', () => {
    // Wave 2, Decision 6: /api/annotate's English is ONE extra --lh-11 line,
    // shown at the rungs the subtitle shows — so its room follows the same
    // ladder rule: a dropped rung takes its room with it.
    //
    // WHAT THE LINE COSTS IS NOT ONLY THE LINE. Adding it moves `.nd-body` from
    // the `title-only` class to `with-sub`, and board.css gives those two
    // different padding-tops (--sp-2 / --sp-6). So the step is the lid's four
    // units as well as the gap and the line box — measured on a rendered card,
    // not assumed.
    const sp4 = px('--sp-4');
    const lh11 = px('--lh-11');
    const lid = px('--sp-6') - px('--sp-2');
    const step = lid + sp4 + lh11;
    const withAnnotation = cardHeight({ ...base, annotation: 'Reads a repository.' }, 1);
    expect(withAnnotation).toBe(cardHeight(base, 1) + step);
    // A5.2 — annotation/subtitle still show at rung 3; drop at rung 4.
    expect(cardHeight({ ...base, annotation: 'Reads a repository.' }, 3)).toBe(
      cardHeight(base, 3) + step,
    );
    expect(cardHeight({ ...base, annotation: 'Reads a repository.' }, 4)).toBe(
      cardHeight(base, 4),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FINDING F6 — the layout key counted annotated cards at EVERY rung while
   `cardHeight` reserves their room only where the subtitle shows, so
   annotations arriving while zoomed out spent an ELK relayout on boxes that
   had not changed. The count must obey the same ladder rule as the room.
   ══════════════════════════════════════════════════════════════════════════ */
describe('finding F6 — the annotated-card count follows the subtitle ladder', () => {
  const nodes: BoardNode[] = [base, { ...base, id: 'svc:other', annotation: 'Reads a repository.' }];

  it('counts annotated cards only where cardHeight reserves their room', () => {
    expect(annotatedCountForLayout(nodes, 1)).toBe(1);
    expect(annotatedCountForLayout(nodes, 2)).toBe(1);
    expect(annotatedCountForLayout(nodes, 3)).toBe(1);
  });

  it('counts none once the A5.2 subtitle boost has dropped', () => {
    expect(annotatedCountForLayout(nodes, 4)).toBe(0);
    expect(annotatedCountForLayout(nodes, 5)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   MADR A4 / A2 — THE ROOM VISUAL MODE RESERVES IS THE ROW VISUAL MODE PAINTS
   docs/decisions/visual-board-mode-madr.md §0.

   WHAT THIS EXISTS BECAUSE OF. `cardBox(node, pos, rung, visual)` gained a
   fourth argument in the Visual wave and NOTHING asserted on it: the wave's own
   determinism lock renders `<Board>` with seed positions, so deleting `visual`
   from the `cardBox` call site in `ConnectedBoard` left every test green while
   ELK and the edge router were handed boxes shorter than the cards.

   AND THE HEIGHT ITSELF WAS WRONG IN ONE DIRECTION. `visualExtraHeight` tested
   `visualMetaFor(node).kind`, and `silhouetteLabel` is a total Record with no
   empty value, so the test could never be false and every card reserved the
   16px .prov chip's row — including a card with no provenance, whose strip is
   one 10px line of words. Six pixels of dead ground under one line is sheet
   08.2's "block box with one line at the top and dead ground under it".
   ══════════════════════════════════════════════════════════════════════════ */
describe('MADR A4 — the Visual strip is reserved at the height it paints', () => {
  const sp4 = px('--sp-4');
  const hair = px('--w-hair');
  const t10 = px('--t-10');
  /* `.board-scope .prov` declares `height: 16px`; every other item on the row
     is --t-10 at `line-height: 1`. Both are read here rather than restated so
     the reservation cannot drift from the ramp. */
  const provRow = 16;

  it('derives both strip heights from the live ramp', () => {
    // the column gap + the rule + the row's own padding-top + the row itself
    expect(VISUAL_STRIP_H).toBe(sp4 + hair + sp4 + provRow);
    expect(VISUAL_STRIP_WORDS_H).toBe(sp4 + hair + sp4 + t10);
    /* The whole point of the second constant: a row with no chip on it is
       SHORTER, and reserving the taller one for it is dead ground. */
    expect(VISUAL_STRIP_WORDS_H).toBeLessThan(VISUAL_STRIP_H);
  });

  it('adds the chip row to a card that HAS provenance', () => {
    const traced = { ...base, provenance: 'traced' as const };
    expect(cardHeight(traced, 1, true)).toBe(cardHeight(traced, 1, false) + VISUAL_STRIP_H);
  });

  it('adds only the words row to a card that has none — no dead ground', () => {
    // `base.provenance` is null: a node the reader drew, with no evidenceRef.
    expect(cardHeight(base, 1, true)).toBe(cardHeight(base, 1, false) + VISUAL_STRIP_WORDS_H);
    expect(visualExtraHeight(base)).toBe(VISUAL_STRIP_WORDS_H);
    expect(visualExtraHeight({ ...base, provenance: 'declared' })).toBe(VISUAL_STRIP_H);
  });

  it('reserves nothing at a rung that does not draw the strip', () => {
    /* `show.footer` is rung 1 only. A zoomed-out board that reserved the row
       would hold room for ink it is not drawing — the same rule the plain
       footer already obeys. */
    for (const rung of [2, 3, 4, 5] as const) {
      expect(cardHeight(base, rung, true), `rung ${rung}`).toBe(cardHeight(base, rung, false));
    }
  });
});
