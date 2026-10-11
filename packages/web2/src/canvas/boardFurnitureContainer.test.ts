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

  it('the narrow rule is at least as specific as the base rule it overrides', () => {
    /* It first shipped as `.boardfurniture` (0,1,0) under the container and lost to a (0,2,0) base rule: built, served, and
       doing nothing. The dock never wraps (coordinator, 2026-10-06: at ~360px it broke into two rows); under 480px its
       optional buttons fold into the ⋯ menu. */
    const block = containerBlock();
    expect(block).toMatch(/\.board-scope \.bdock\s*\{[^}]*flex-wrap:\s*nowrap/);
    const narrow = css.slice(css.indexOf('@container board (max-width: 480px)'));
    expect(narrow).toMatch(/\.board-scope \.bdock \.bdock-opt \{ display: none; \}/);
    expect(narrow).toMatch(/\.board-scope \.bdock \.bdock-more \{ display: inline-grid; \}/);
  });

  it('the dock sits on the panes centre line at every width, alone: no key, no spacer, nothing at the bottom-left', () => {
    /* A flex row with justify-content: center, whatever the pane's width; the grid that balanced a key against the dock is gone. */
    expect(css).toMatch(/\.board-scope \.boardfurniture \{[^}]*display: flex;[^}]*align-items: flex-end;[^}]*justify-content: center;/);
    expect(css).not.toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/bfurn-/);
    const board = readFileSync(join(__dirname, 'Board.tsx'), 'utf8');
    expect(board).not.toMatch(/bfurn-/);
    /* The furniture holds the dock and nothing else. */
    const at = board.indexOf('className="boardfurniture"');
    const open = board.indexOf('>', at) + 1;
    expect(board.slice(open, open + 160)).toMatch(/^\s*<div className="bdock"/);
    expect(css).toMatch(/\.board-scope \.bdock \{[^}]*flex:\s*none;/);
  });
});
