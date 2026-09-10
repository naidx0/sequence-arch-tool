import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE ASSUMPTION THAT MAKES A WIDTH KNOWABLE BEFORE LAYOUT.
 *
 * `AnatomyPanel.tsx` decides whether a treemap cell may carry its name with
 * `rect.w >= label.length * MONO_ADVANCE + LABEL_INSET * 2`, where
 * `MONO_ADVANCE = 6`. That arithmetic is only valid for a MONOSPACE face at
 * `--t-10`; its own comment says so outright — "if the label face ever stops
 * being mono this has to become a real measurement."
 *
 * NOTHING CHECKED THAT, AND THE EXISTING TEST CANNOT. `anatomyRendered` asserts
 * "never draws a label wider than the cell it names" by recomputing
 * `length * 6 + 6` — the same constant the predicate uses. Predicate and test
 * therefore agree with each other by construction: swap `--font-mono` for a
 * proportional face, or move `--t-10`, and every label on the board overflows
 * its cell onto its neighbour while both stay green. The label and the content
 * of a rule are two different things, and this file checks the content.
 *
 * WHAT IT READS, BEFORE WHAT IT PROVES. jsdom does not load `board.css` and
 * computes no font metrics, so this reads the STYLESHEET SOURCE and proves the
 * two declarations the 6px advance depends on are still there. It does not
 * measure a glyph — no test here can. What it buys is that the advance stops
 * being an unstated assumption and becomes a checked one: the day someone
 * changes the face, this fails and names the reason.
 */
const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');

/** The rule body for a selector, comments stripped so quoted CSS cannot split it. */
function ruleBody(selector: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of bare.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    if (block.slice(0, brace).includes(selector)) return block.slice(brace + 1);
  }
  return '';
}

describe('the anatomy label’s 6px advance rests on a face this locks', () => {
  it('READS THE STYLESHEET: the label is mono, which is why its width is predictable', () => {
    const body = ruleBody('.ana-label');
    expect(body, 'no rule for .ana-label at all').not.toBe('');
    expect(body, 'a proportional face makes MONO_ADVANCE a fiction').toContain(
      'font-family: var(--font-mono)',
    );
  });

  it('READS THE STYLESHEET: the label is at --t-10, the size 6px was measured at', () => {
    /*
     * The advance is per-character AND per-size. A mono face at --t-12 advances
     * more than 6px, so the size is half of what makes the arithmetic true and
     * changing it overflows exactly as a proportional face would.
     */
    const body = ruleBody('.ana-label');
    expect(body, 'the 6px advance was measured at --t-10').toContain('font-size: var(--t-10)');
  });

  it('names the one place the constant lives, so a reader can find the other half', () => {
    /*
     * NOT DECORATION — a guard against the fix that passes this file while
     * breaking the thing it protects. If `MONO_ADVANCE` is ever re-derived from
     * a real measurement, the two assertions above stop being load-bearing and
     * should go with it. This pins the coupling so that removal is a decision
     * rather than an oversight.
     */
    /*
     * RE-POINTED 2026-09-09, and this assertion is why it was noticed. The
     * predicate moved from `visual/AnatomyPanel.tsx` into `anatomy.ts` so the
     * card-height model could ask the same question the painter asks — see
     * `bucketUnnamed`. The lock failed on the move, which is exactly the
     * decision-rather-than-oversight it was written to force.
     */
    const model = readFileSync(resolve(__dirname, 'anatomy.ts'), 'utf8');
    expect(model, 'the predicate moved again; re-point this lock or retire it').toContain(
      'const MONO_ADVANCE = 6',
    );
    expect(model, 'the predicate itself moved').toContain('export function anatomyLabelFits');
  });
});
