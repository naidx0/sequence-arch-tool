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
  it('derives the one shipped row from the live ramp (Decision 49)', () => {
    const sp2 = px('--sp-2');
    const sp10 = px('--sp-10');
    const lh11 = px('--lh-11');
    const lh14 = px('--lh-14');
    const hair = px('--w-hair');

    const chassis = sp10 * 2 + hair * 2;
    /* `.nd-tx`: two reserved title lines (Decision 48), the --sp-2 gap and the
       one-line definition (Decision 49). The 30px chip beside it is shorter
       than the column, so it is no row of its own. */
    const card = chassis + lh14 * 2 + sp2 + lh11;

    expect(card).toBe(81);
    expect(CARD_FLOOR).toBe(card);
    expect(cardHeight(base, 1)).toBe(card);
    /* The definition lives in its reserved line, so a summary adds nothing. */
    expect(cardHeight({ ...base, subtitle: 'Charges an order.' }, 1)).toBe(card);
    /* Provenance waits for select — rest layout stays first-glance tall. */
    expect(cardHeight({ ...base, subtitle: 'Charges an order.', provenance: 'traced' }, 1)).toBe(card);
  });

  /**
   * EVERY CARD IS ONE HEIGHT AT A RUNG (Decision 48, S4 review 4b, and
   * Decision 49's definition line): a title takes at most two lines and the
   * definition always has its line, so a row of boxes is one height whether
   * its names wrap or its summary is missing. Stated in the ramp's units.
   */
  it('gives a card with nothing to say the same box as one with a summary', () => {
    const chassis = px('--sp-10') * 2 + px('--w-hair') * 2;
    const column = px('--lh-14') * 2 + px('--sp-2') + px('--lh-11');
    expect(cardHeight(base, 1)).toBe(chassis + column);
    expect(cardHeight(base, 1)).toBe(cardHeight({ ...base, subtitle: 'Charges an order.' }, 1));
  });

  it('does not use --arch-card-min-h as the floor', () => {
    // THE DEFECT, NAMED. The substrate declares the floor at 96, which is
    // within a hair of the FULLEST old card. The floor is the card that ships
    // (81: the chassis and the two-title-line-plus-definition column), 15
    // under it.
    const declared = px('--arch-card-min-h');
    expect(declared).toBe(96);
    expect(CARD_FLOOR).toBeLessThan(declared);
    expect(declared - CARD_FLOOR).toBe(15);
  });

  it('keeps the width fixed, because a board reads as a board when columns line up', () => {
    expect(CARD_W).toBe(px('--arch-card-w'));
  });

  it('never grows as the camera pulls back, and the mark rung is a dot', () => {
    // Sheet 08.2: "a dropped rung takes its room with it." Decision 49 draws
    // the whole row at every card rung, so no card rung is taller than the one
    // nearer it, and the mark is a dot, not a card.
    const full: BoardNode = { ...base, subtitle: 'Charges an order.', provenance: 'traced' };
    const heights = [1, 2, 3, 4, 5, 6, 7].map((rung) => cardHeight(full, rung as 1));

    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]!, `rung ${i + 1} is not shorter than rung ${i}`).toBeLessThanOrEqual(
        heights[i - 1]!,
      );
    }
    expect(heights[0]).toBe(81);
    expect(heights[6]).toBe(px('--dot'));
  });

  it('reserves the far row at the board scale on the far rungs', () => {
    /* The row is counter-scaled as one piece, so its column is reserved at
       the board's far scale: two units of scale, twice the column. */
    const column = px('--lh-14') * 2 + px('--sp-2') + px('--lh-11');
    const chassis = px('--sp-10') * 2 + px('--w-hair') * 2;
    expect(cardHeight(base, 5, false, null, undefined, 2)).toBe(chassis + Math.ceil(column * 2));
  });

  it('gives every kind the same chassis height (P2.6 — no folder-tab margin)', () => {
    /* Owner: kinds are icons, not competing silhouettes. Module no longer
       reserves --arch-tab-h above the body. */
    const module: BoardNode = { ...base, present: { kind: 'module', entry: false }, schemaKind: 'module' };
    const store: BoardNode = { ...base, present: { kind: 'storage', entry: false }, schemaKind: 'datastore' };
    expect(cardHeight(module, 1)).toBe(cardHeight(base, 1));
    expect(cardHeight(store, 1)).toBe(cardHeight(base, 1));
  });

  it('costs an annotation no room: it takes the definition line the card already holds', () => {
    // /api/annotate's English outranks the scan's summary as the definition,
    // in the line every card reserves (Decision 49), at every rung.
    for (const rung of [1, 3, 4] as const) {
      expect(cardHeight({ ...base, annotation: 'Reads a repository.' }, rung)).toBe(cardHeight(base, rung));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FINDING F6 — the layout key counted annotated cards at EVERY rung while
   `cardHeight` reserved their room only where the subtitle showed, so
   annotations arriving while zoomed out spent an ELK relayout on boxes that
   had not changed. The count must obey the same rule as the room, and since
   Decision 49 an annotation takes no room at any rung.
   ══════════════════════════════════════════════════════════════════════════ */
describe('finding F6 — the annotated-card count follows the room', () => {
  const nodes: BoardNode[] = [base, { ...base, id: 'svc:other', annotation: 'Reads a repository.' }];

  it('counts no annotated card at any rung, because none is taller for it', () => {
    for (const rung of [1, 2, 3, 4, 5] as const) {
      expect(annotatedCountForLayout(nodes, rung)).toBe(0);
      expect(cardHeight(nodes[1]!, rung)).toBe(cardHeight(nodes[0]!, rung));
    }
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
