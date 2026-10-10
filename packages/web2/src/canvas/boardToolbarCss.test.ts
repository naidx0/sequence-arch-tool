import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* BOARD 2 (owner, after the round screenshots): "the top is just super polluted with map, grid, diff, hotspots ... Should
   always be a drop down option." The views are ONE dropdown pill at every width; there is no row of view pills to fold. */
describe('the views are one dropdown pill at every width', () => {
  const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
  const block = (query: string) => {
    const at = css.indexOf(`@container boardstack (${query})`);
    expect(at).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
    }
    return '';
  };

  it('no rule folds, hides or restyles view pills any more, and the dropdown is not hidden at any width', () => {
    expect(css).not.toContain('.vtabs');
    expect(css).not.toContain('.vt:not(.on)');
    expect(css).not.toMatch(/\.bview-menu-wrap \{[^}]*display: none;/);
    expect(css).toMatch(/\.bview-menu-wrap \{[^}]*display: inline-flex;/);
    expect(block('max-width: 760px')).not.toContain('.vt');
  });

  it('under 360px of board the pill drops its word and keeps its icon and chevron', () => {
    expect(block('max-width: 360px')).toContain('.bview-menu .bview-menu-t { display: none; }');
  });

  it('the pill and the controls beside it share the strips 26px height', () => {
    expect(css).toMatch(/\.board-controls \.bview-menu \{[^}]*height: var\(--row-h-tool\);[^}]*min-width: var\(--row-h-tool\);/);
  });

  it('round 12: the toolbar is a notch smaller (26px pills and Find, 26px round buttons, one height for the whole strip)', () => {
    expect(css).toMatch(/\.board-scope \.board-controls \.vt,\s*\.board-scope \.board-controls \.bfind \{\s*height: var\(--row-h-tool\);\s*font-size: var\(--t-11-5\);/);
    expect(css).toContain('.board-scope .board-controls .bbtn { min-width: var(--row-h-tool); height: var(--row-h-tool); }');
    expect(css).toContain('justify-content: center; width: var(--row-h-tool); padding: 0; }');
    expect(css).not.toMatch(/board-controls \.vt \.i \{ width: \d+px/);
  });
});
