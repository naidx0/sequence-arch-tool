import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* jsdom has no layout, so this reads the contract off the sheet; the wheel and
   click measurements at 1440 and 1024 were taken in a real browser (see the
   commit). Audit round 2: an expanded tree was 2558px tall inside an
   overflow:hidden wrap, the wheel did nothing, and a click on a deep file
   scrolled the wrap and pushed the header off the top. */
const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the one rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  /* Split on braces rather than a regex, so a selector needs no escaping. */
  for (const chunk of css.split('}')) {
    const open = chunk.indexOf('{');
    if (open < 0) continue;
    const sel = chunk.slice(0, open).trim().split(' ').filter(Boolean).join(' ');
    if (sel === selector) return chunk.slice(open + 1);
  }
  throw new Error('no rule for ' + selector);
}

describe('the Files height chain: the tree is the scroller and the header never moves', () => {
  it('the grid row is pinned to the pane height, not sized by its tallest child', () => {
    expect(rule('.files-scope')).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.files-scope')).toMatch(/min-height:\s*0/);
    expect(rule('.files-container')).toMatch(/min-height:\s*0/);
  });

  it('.files-side is a flex column with min-height 0 (it had no rule at all)', () => {
    const side = rule('.files-scope .files-side');
    expect(side).toMatch(/display:\s*flex/);
    expect(side).toMatch(/flex-direction:\s*column/);
    expect(side).toMatch(/min-height:\s*0/);
  });

  it('.files-tree is the overflow container, min-height 0 all the way up', () => {
    expect(rule('.files-scope .files-tree')).toMatch(/overflow:\s*auto/);
    expect(rule('.files-scope .files-tree')).toMatch(/min-height:\s*0/);
    expect(rule('.files-scope .files-treewrap')).toMatch(/min-height:\s*0/);
    expect(rule('.files-scope .files-treewrap')).toMatch(/display:\s*flex/);
  });

  it('the filter strip sits outside the scroller and does not shrink', () => {
    expect(rule('.files-scope .files-top')).toMatch(/flex:\s*0 0 auto/);
  });

  it('the main column clips to the row, and its header is a non-shrinking sibling of the one body scroller', () => {
    expect(rule('.files-scope .files-main')).toMatch(/overflow:\s*hidden/);
    expect(rule('.files-scope .files-hd')).toMatch(/flex:\s*0 0 auto/);
    expect(rule('.files-scope .files-body')).toMatch(/overflow:\s*auto/);
  });

  it('an empty folder (is-bare) goes back to an auto row so it does not stretch', () => {
    expect(rule('.files-scope.is-bare')).toMatch(/grid-template-rows:\s*auto/);
  });
});

describe('the stray seam bar and the unreadable diagram', () => {
  it('a zero-width seam (drawer) and a shut tree draw no grip', () => {
    expect(css).toMatch(/\.files-scope\.is-narrow \.files-resizer::after[^{]*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.files-scope\.is-tree-shut \.files-resizer:not\(:hover\)[^{]*::after\s*\{[^}]*display:\s*none/);
  });

  it('a diagram never draws below its natural size: it scrolls sideways in its block instead', () => {
    const svg = rule(".files-scope .files-md .dgm[data-kind='mermaid'] .dgm-art svg");
    expect(svg).toMatch(/width:\s*max\(min\(100%, calc\(var\(--dgm-w\) \* 1\.15px\)\), calc\(var\(--dgm-w\) \* 1px\)\)/);
    expect(svg).toMatch(/max-width:\s*none/);
    const art = rule(".files-scope .files-md .dgm[data-kind='mermaid'] .dgm-art");
    expect(art).toMatch(/overflow-x:\s*auto/);
    expect(art).toMatch(/justify-content:\s*safe center/);
  });

  it('with no file open a drawer-width pane hides the toggle that would sit on the filter field', () => {
    expect(rule('.files-scope.is-narrow:not(.has-file) .files-treetoggle')).toMatch(/display:\s*none/);
    /* and with a file open the drawer still clears the toggle's row */
    expect(rule('.files-scope.is-narrow.has-file .files-side')).toMatch(/padding-top:\s*calc\(var\(--control-h\)/);
  });

  it('files-crumb and files-code have rules', () => {
    expect(css).toMatch(/\.files-scope \.files-crumb\s*\{/);
    expect(css).toMatch(/\.files-scope \.files-code\s*\{/);
  });
});
