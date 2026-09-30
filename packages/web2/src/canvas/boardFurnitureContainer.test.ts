import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * THE FURNITURE WRAPS ON THE BOARD'S WIDTH — photo 2, 2026-09-22.
 *
 * Measured in a 1100px window: the board pane was 338px wide, the viewport
 * rule (`@media (max-width: 720px)`) never fired, `.boardtools` was shrunk to
 * 179px and its buttons overflowed left onto the Kinds pill — eleven
 * overlapping pairs. jsdom has no layout, so this reads the stylesheet the
 * browser reads; the measurement is in docs/OWNER-WALK-2026-09-22.md.
 */
const css = readFileSync(join(__dirname, 'board.css'), 'utf8');

function containerBlock(): string {
  const at = css.indexOf('@container board (max-width: 720px)');
  expect(at, 'the container query exists').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) return css.slice(at, i + 1);
  }
  throw new Error('unclosed @container block');
}

describe('board furniture in a narrow board', () => {
  it('the board is a named inline-size container', () => {
    expect(css).toMatch(/\.board\.board-scope\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*board;/);
  });

  it('the wrap rule is at least as specific as the base rule it overrides', () => {
    /* It first shipped as `.boardfurniture` (0,1,0) under the container and
       lost to `.board-scope .boardfurniture` (0,2,0) — built, served, and
       doing nothing. */
    const block = containerBlock();
    expect(block).toMatch(/\.board-scope \.boardfurniture\s*\{[^}]*flex-wrap:\s*wrap-reverse/);
    expect(block).toMatch(/\.boardtools\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('the toolbar never shrinks below its buttons', () => {
    expect(css).toMatch(/\.board-scope \.boardtools \{[^}]*flex-shrink:\s*0;/);
  });
});
