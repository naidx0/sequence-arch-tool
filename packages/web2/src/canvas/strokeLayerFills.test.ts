/**
 * THE PENCIL WORKED. IT JUST DID NOT WORK ANYWHERE A READER WOULD DRAW.
 *
 * Owner, 2026-09-21: "we want to draw on the board, but it, in reality, like,
 * it doesn't let you draw. It doesn't work. So I guess remove it for the time
 * being, and let's come back to that."
 *
 * Twelve tests in `drawRendered.test.tsx` said the opposite, and they were
 * honest about what they asked: they toggle Draw, dispatch pointer events AT
 * the capture layer, and watch a service appear. Every one of those passed
 * while the product was unusable, because the thing that was broken is the one
 * property jsdom does not have — SIZE.
 *
 * `.strokelayer` is an `<svg>`. An `<svg>` is a REPLACED element with an
 * intrinsic size of 300x150, and `position: absolute; inset: 0` does not
 * stretch a replaced element the way it stretches a plain box: the intrinsic
 * size wins, `left` and `top` are honoured, and `right`/`bottom` are dropped.
 * So the surface that accepts ink was a 300x150 patch pinned to the board's
 * top-left corner. Measured in Chrome against a 678x887 board, the layer came
 * back `[922, 113, 300, 150]` — about an eighth of the board, in the corner
 * furthest from where anyone draws.
 *
 * That is why he read it as dead. It toggled, it went crosshair, and it
 * ignored him, which is worse than a control that visibly does nothing:
 * it tells the reader the fault is theirs.
 *
 * THIS TEST READS THE STYLESHEET, because the defect is not reachable from a
 * rendered tree in jsdom — `getBoundingClientRect` there returns zeros whether
 * the rule is right or wrong, so a render-based assertion would pass on the
 * broken CSS exactly as the twelve did. The declaration is the only evidence
 * available at this level, so the declaration is what it asserts, and it names
 * the measurement that a browser gave so the next reader does not have to
 * rediscover it.
 *
 * Verified in a real Chromium after the fix: the layer measures 678x887, and a
 * box drawn at (418, 627) — deep in the quadrant that was dead — adds a
 * service.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');

/** The body of the one `.strokelayer` rule, without the braces. */
function strokeLayerRule(): string {
  const at = css.indexOf('.board-scope .strokelayer {');
  expect(at, '.board-scope .strokelayer must exist in board.css').toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('the capture surface covers the whole board', () => {
  it('declares its own width and height — `inset: 0` cannot size an <svg>', () => {
    const rule = strokeLayerRule();

    /*
     * Both, and both explicitly. `width` alone leaves a 150px-tall band; the
     * two are one fact and a test that accepted either would go green on half
     * a fix. See `derive-the-subject-set`: the pair is the property.
     */
    expect(rule, 'an <svg> keeps its 300px intrinsic width unless told otherwise').toMatch(
      /width:\s*100%/,
    );
    expect(rule, 'an <svg> keeps its 150px intrinsic height unless told otherwise').toMatch(
      /height:\s*100%/,
    );
  });

  it('still fills its positioned parent rather than flowing somewhere else', () => {
    const rule = strokeLayerRule();

    /*
     * The width and height above only mean "the board" while the layer is
     * still absolutely positioned against `.board`, which is `position:
     * relative`. If a later change makes this static, `100%` starts measuring
     * something else and the corner comes back in a new shape.
     */
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
  });

  it('is reachable — the pencil was not removed', () => {
    /*
     * His instruction was "remove it for the time being", and the premise under
     * it was that drawing could not be made to work. It could: one declaration,
     * measured before and after in a real browser. Removing a working feature
     * because a two-line fault made it look broken is how `fe6f644e` deleted
     * 5,615 lines of CSS, so the control stays and this test says why.
     *
     * `drawRendered.test.tsx` owns the behaviour of the button. This owns the
     * fact that there is one.
     */
    const board = readFileSync(resolve(__dirname, 'Board.tsx'), 'utf8');
    expect(board).toContain('data-testid="board-draw-toggle"');
  });
});
