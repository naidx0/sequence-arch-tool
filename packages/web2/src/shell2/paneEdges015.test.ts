import { describe, expect, it } from 'vitest';

import boardCssRaw from '../canvas/board.css?raw';
import wbCssRaw from '../whiteboard/whiteboard.css?raw';
import { PANE_MIN_PX } from './layoutPrefs';

const board = boardCssRaw.replace(/\r\n/g, '\n');
const wb = wbCssRaw.replace(/\r\n/g, '\n');

/*
 * ROUND 0.1.5, G2 (owner): "when you minimize too far, things fall outside of their borders... add rules, condense to
 * icons". The real-browser proof is e2e/surfaces-shots.mjs (it measures every button against its pane at 240 px a
 * pane); these lock the rules that proof found missing.
 */
describe('a pane held at its floor keeps its chrome inside its edge', () => {
  it('the floor is the width the rules below are written for', () => {
    expect(PANE_MIN_PX).toBe(240);
  });

  it('the whiteboard pill drops its separators and tightens before it can pass a narrow pane', () => {
    expect(wb).toMatch(/@container wb \(max-width: 300px\) \{[\s\S]*?\.wb-sep \{\s*display: none;[\s\S]*?\.wb-tool-solid \{\s*padding: 0 var\(--sp-8\)/);
    expect(wb).toMatch(/@container wb \(max-width: 230px\) \{\s*\.wb-furniture \{\s*padding-inline: var\(--sp-4\)/);
  });

  it('the whiteboard tag row keeps clear of the pane controls at the top right', () => {
    expect(wb).toMatch(/\.wb-boards > \.board-tabs \{\s*padding-right: calc\(var\(--target-min\) \* 2 \+ var\(--sp-16\)\)/);
  });

  it('a board folded to its one pill takes the pill width, so it cannot run over the view pill', () => {
    expect(board).toMatch(/@container boardstack \(max-width: 320px\) \{\s*\.board-scope \.board-controls \.board-tabs:not\(\[data-solo='true'\]\) \{ min-width: max-content; flex: none; \}/);
  });

  it('the find field leaves the architecture row at the floor, where it would meet the pane controls', () => {
    expect(board).toMatch(/@container boardstack \(max-width: 260px\) \{\s*\.board-scope \.board-controls \.bfind \{ display: none; \}/);
  });
});
