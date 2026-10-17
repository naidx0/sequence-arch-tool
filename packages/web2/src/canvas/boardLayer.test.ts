import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * THE BOARD STAYS ON ITS OWN COMPOSITED LAYER.
 *
 * Measured with Chrome's trace on the expanded board beside the 203-row sessions rail: without this rule 25 zoom
 * steps spent 885 ms in Layerize (the page's paint chunks re-layerized every frame) and ran at 36 fps; with it, 303 ms
 * and 51 fps. The rule is a promotion, so the lock is on the rule and on what it must not become: `transform` would
 * make the board a containing block for its `position: fixed` menus.
 */
const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');

describe('board layer promotion', () => {
  it('promotes .react-flow with will-change: opacity', () => {
    expect(css).toMatch(/\.board-scope \.react-flow\s*\{[^}]*will-change:\s*opacity;/);
  });
  it('never promotes it with transform, which would re-anchor the fixed menus', () => {
    const rule = css.match(/\.board-scope \.react-flow\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toMatch(/transform|filter|perspective|contain\s*:/);
  });
});
