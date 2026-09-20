import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';

import { substituteVars } from '../../test/support/css';
import { ZOOM_MAX, ZOOM_MIN } from './camera';
import {
  CARD_DRAWN_TO,
  KIND_CARRIED_TO,
  LOD_LADDER,
  rungFor,
  silhouetteSeparates,
  visibilityAt,
  visibilityAtWithSubtitleBoost,
} from './lod';
import type { LodRung } from '../state/types';

/** The live value of a token, in px, read out of the sheet rather than
 *  restated. This is what stops `lod.ts`'s derivation list becoming a second
 *  source of truth for the type ramp. */
function px(name: string): number {
  const raw = substituteVars(`var(${name})`, document.documentElement);
  const value = Number.parseFloat(raw);
  expect(Number.isFinite(value), `${name} did not resolve: "${raw}"`).toBe(true);
  return value;
}

/**
 * ITEM 3.8 — THE LEVEL-OF-DETAIL LADDER, AS SHEET 05.8 STATES IT.
 *
 * docs/brand/graphite/pages/05-the-canvas.html §05.8 prints the ladder as a
 * five-row table with a "Holds to" column:
 *
 *   .edgetag / .nd-k / .prov / .nd-ft   --t-10      --t-10 / --t-10   1.00
 *   .nd-s — the subtitle                --t-11      --t-10 / --t-11   0.91
 *   .nd-t — the title                   --t-12      --t-10 / --t-12   0.83
 *   the kind icon                       1.5 stroke  --w-hair / 1.5    0.67
 *   silhouette, border treatment, tone  geometry    none              0.25
 *
 * and draws the bottom card captioned "< 0.67 · silhouette only".
 *
 * THE ROW THIS FILE EXISTS TO LOCK IS THE LAST ONE. Its threshold column reads
 * **none** — the silhouette has no threshold of its own — and it holds to 0.25,
 * which is `ZOOM_MIN`, where the CAMERA stops. So at every zoom the camera can
 * reach there is a silhouette on the card and it is still carrying kind.
 *
 * An earlier revision of this file asserted the opposite: that the silhouette
 * died at 0.50 and that from 0.354 down "nothing on the card" carried kind.
 * Neither number is in either sheet — both were this module's own arithmetic,
 * and this test locked them in place. CANON §6: assert the invariant, not the
 * expression. The invariant is the sheet's table.
 */
describe('item 3.8 — the LOD ladder', () => {
  const floorOf = (rung: LodRung) => LOD_LADDER.find((step) => step.rung === rung)!.floor;

  it('derives every type threshold from the live ramp, not from a literal', () => {
    const floor = px('--t-10');
    const subtitle = px('--t-11');
    const title = px('--t-12');
    const hair = px('--w-hair');

    expect(floorOf(1)).toBeCloseTo(floor / floor, 10);
    expect(floorOf(2)).toBeCloseTo(floor / subtitle, 10);
    expect(floorOf(3)).toBeCloseTo(floor / title, 10);
    // The same rule applied to a stroke instead of a glyph: at this zoom the
    // icon's 1.5 stroke has fallen to one device pixel, "and below that the
    // renderer is guessing. It goes."
    expect(floorOf(4)).toBeCloseTo(hair / 1.5, 10);
  });

  it('is the five rungs sheet 05.8 prints, at the numbers it prints', () => {
    // The sheet's own "Holds to" column, to the two decimals it is written in.
    // A sixth entry here would be a rung no sheet states.
    expect(LOD_LADDER.map((step) => Number(step.floor.toFixed(2)))).toEqual([
      1.0, 0.91, 0.83, 0.67, 0.25,
    ]);
    expect(LOD_LADDER.map((step) => step.rung)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives the silhouette NO threshold — 0.25 is where the camera stops, not the shape', () => {
    // §05.8's last row: threshold "none", holds to 0.25. §05.9 assertion 5:
    // "Zoom is clamped to 0.25 … 4.00 on every path." The two numbers are the
    // same number, and that is the whole content of the row: the silhouette
    // outlives the camera.
    expect(ZOOM_MIN).toBe(0.25);
    expect(floorOf(5)).toBe(ZOOM_MIN);
    expect(KIND_CARRIED_TO).toBe(ZOOM_MIN);
    expect(CARD_DRAWN_TO).toBe(ZOOM_MIN);
  });

  /**
   * THE INVARIANT, SWEPT RATHER THAN SAMPLED.
   *
   * "< 0.67 · silhouette only" is a claim about every zoom below 0.67, not
   * about one of them. Sampling 0.30 would have caught this defect, but the
   * sweep is what states the rule: there is no zoom in the camera's range at
   * which the board stops naming a kind on the card.
   */
  it('carries kind on the card at EVERY zoom the camera can reach', () => {
    for (let zoom = ZOOM_MIN; zoom <= ZOOM_MAX + 1e-9; zoom = Number((zoom + 0.01).toFixed(2))) {
      const show = visibilityAt(rungFor(zoom));
      expect(show.card, `zoom ${zoom} draws no card`).toBe(true);
      expect(silhouetteSeparates(zoom), `zoom ${zoom} claims no silhouette`).toBe(true);
    }
  });

  it('draws a silhouette and condensed title at the camera floor — icon already yielded', () => {
    // At 25%, rung 5: shortTitle stays, icon is gone (yielded at rung 4).
    expect(rungFor(ZOOM_MIN)).toBe(5);
    expect(visibilityAt(rungFor(ZOOM_MIN))).toMatchObject({
      card: true,
      icon: false,
      shortTitle: true,
    });
    expect(silhouetteSeparates(ZOOM_MIN)).toBe(true);
  });

  it('yields icon before condensed title (owner Option A — icons hide first)', () => {
    const titleFloor = floorOf(3);
    expect(visibilityAt(rungFor(titleFloor)).title).toBe(true);
    expect(visibilityAt(rungFor(titleFloor - 0.01)).title).toBe(false);
    expect(visibilityAt(rungFor(titleFloor - 0.01)).shortTitle).toBe(true);
    expect(visibilityAt(rungFor(titleFloor - 0.01)).icon).toBe(false);

    const iconCeiling = floorOf(3);
    expect(visibilityAt(rungFor(iconCeiling)).icon).toBe(true);
    expect(visibilityAt(rungFor(iconCeiling - 0.01)).icon).toBe(false);
    expect(visibilityAt(rungFor(iconCeiling - 0.01)).shortTitle).toBe(true);

    for (let zoom = ZOOM_MIN; zoom <= ZOOM_MAX + 1e-9; zoom = Number((zoom + 0.01).toFixed(2))) {
      const show = visibilityAt(rungFor(zoom));
      expect(show.shortTitle || show.title, `zoom ${zoom} dropped every name`).toBe(true);
      expect(show.card, `zoom ${zoom} has given up the silhouette`).toBe(true);
    }
  });

  it('never puts the camera on a rung below the silhouette', () => {
    // `visibilityAt` stays total over the LodRung type — rungs 6 and 7 are
    // still defined, and NodeCard.test.tsx renders one directly — but under
    // §05.8 no ZOOM reaches them. If a later ruling ever gives the card box a
    // threshold of its own, this goes red, and the sheet citation is what has
    // to change first.
    for (let zoom = ZOOM_MIN; zoom <= ZOOM_MAX + 1e-9; zoom = Number((zoom + 0.01).toFixed(2))) {
      expect(rungFor(zoom), `zoom ${zoom}`).toBeLessThanOrEqual(5);
    }
    // Clamped-out zooms too: `rungFor` is pure and a caller can hand it one.
    expect(rungFor(0.1)).toBe(5);
    expect(rungFor(0)).toBe(5);
  });

  it('drops detail in the sheet’s order and never adds anything back', () => {
    // Sheet 08.2: "each rung is a strict subset of the one before it." Asserted
    // as a PROPERTY over the whole ladder rather than by reading the table,
    // because a table can be edited into agreeing with itself.
    const rungs: LodRung[] = [1, 2, 3, 4, 5, 6, 7];
    for (let i = 1; i < rungs.length; i += 1) {
      const above = visibilityAt(rungs[i - 1]!);
      const here = visibilityAt(rungs[i]!);
      for (const key of Object.keys(here) as Array<keyof typeof here>) {
        if (here[key]) {
          expect(above[key], `rung ${rungs[i]} shows ${key} but rung ${rungs[i - 1]} does not`).toBe(
            true,
          );
        }
      }
    }
  });

  it('drops the rungs in the named order — icon yields before shortTitle at far zoom', () => {
    expect(visibilityAt(1)).toMatchObject({ kindTag: false, footer: true, subtitle: true, title: true, shortTitle: true, icon: true, card: true });
    expect(visibilityAt(2)).toMatchObject({ kindTag: false, footer: false, subtitle: true });
    expect(visibilityAt(3)).toMatchObject({ subtitle: false, title: true, icon: true });
    expect(visibilityAt(4)).toMatchObject({ title: false, shortTitle: true, icon: false });
    expect(visibilityAt(5)).toMatchObject({ shortTitle: true, icon: false, card: true });
  });

  it('maps a zoom to exactly one rung, monotonically', () => {
    expect(rungFor(4)).toBe(1);
    expect(rungFor(1)).toBe(1);
    expect(rungFor(0.95)).toBe(2);
    expect(rungFor(0.87)).toBe(3);
    expect(rungFor(0.7)).toBe(4);
    expect(rungFor(0.55)).toBe(5);
    // The three the invention got wrong. §05.8 says silhouette at all of them.
    expect(rungFor(0.4)).toBe(5);
    expect(rungFor(0.3)).toBe(5);
    expect(rungFor(0.25)).toBe(5);

    let previous = 0;
    for (let zoom = ZOOM_MAX; zoom >= ZOOM_MIN; zoom -= 0.01) {
      const rung = rungFor(Number(zoom.toFixed(2)));
      expect(rung).toBeGreaterThanOrEqual(previous);
      previous = rung;
    }
  });

  it('never hides anything at 1:1 — the whole point of the floor', () => {
    const show = visibilityAt(rungFor(1));
    expect(show.footer && show.subtitle && show.title && show.icon && show.card).toBe(true);
  });

  it('keeps a real subtitle one rung longer for detailed cards (A5.2)', () => {
    expect(visibilityAt(3).subtitle).toBe(false);
    expect(visibilityAtWithSubtitleBoost(3, true).subtitle).toBe(true);
    expect(visibilityAtWithSubtitleBoost(3, false).subtitle).toBe(false);
    expect(visibilityAtWithSubtitleBoost(4, true).subtitle).toBe(false);
  });
});
