import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* jsdom has no layout; the measurements are in the commit that added this. */
const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('files.css after the 2026-09-22 photo', () => {
  it('the seam is never hidden: the narrow pane has a rule for the reader’s width instead', () => {
    expect(css).not.toMatch(/\.files-resizer\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.files-scope\.is-tree-wide\s*\{[^}]*--files-tree-w/);
  });

  /* Round 7 replaces the 2026-09-22 rule (names whole, the tree scrolling
     sideways): in the shots, "docker-comp" and "ground-trut" sat cut at the
     edge. A row is the column's width and a long name gives way in the
     middle, keeping its end; the full path is the row's title. */
  it('a long name gives way in the middle, keeping its end; nothing scrolls sideways', () => {
    expect(css).toMatch(/\.files-scope \.files-tree \.files-row\s*\{[^}]*width:\s*auto;/);
    expect(css).not.toMatch(/\.files-tree \.files-row\s*\{[^}]*max-content/);
    expect(css).toMatch(/\.files-scope \.files-name-head\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.files-scope \.files-name-end\s*\{[^}]*flex:\s*none/);
  });

  it('with a file open the tree keeps about 30 percent of the card, 180 to 320 px (it was a 120 px rail)', () => {
    expect(css).toMatch(/--files-tree-open:\s*clamp\(calc\(var\(--row-h\) \* 6\), 30%, calc\(var\(--sp-32\) \* 10\)\)/);
    expect(css).toMatch(/\.files-scope\.is-tree-rail\s*\{[^}]*var\(--files-tree-open\)/);
  });

  /* Round 8 integration: the open tree's 180 px floor beat the narrow pane's
     rail (same selector weight, later in the sheet), leaving the preview 61 px
     in a 1024 window with two surfaces. The narrow rule for an open tree must
     come after the open rule, and give the rail. */
  it('in a narrow pane an open tree is the rail, after the open rule so it wins', () => {
    const open = css.search(/\.files-scope\.is-tree-rail\s*\{[^}]*var\(--files-tree-open\)/);
    const narrow = [...css.matchAll(/@container files-pane \(max-width: 420px\)\s*\{([\s\S]*?\n)\}/g)];
    const narrowOpen = narrow.find((m) => /\.files-scope\.is-tree-rail\s*\{[^}]*var\(--files-tree-rail\)/.test(m[1]!));
    expect(open).toBeGreaterThan(-1);
    expect(narrowOpen, 'a narrow-pane rule gives an open tree the rail').toBeTruthy();
    expect(narrowOpen!.index!).toBeGreaterThan(open);
  });

  /* Owner, 2026-10-09: one line, never a second row. The breadcrumb gives (front
     ellipsis), the view pair folds to icons by pane width, neither wraps. */
  it('the header never wraps: the breadcrumb shrinks, the view pair does not', () => {
    expect(css).toMatch(/\.files-scope \.files-hd\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).not.toMatch(/\.files-scope \.files-hd\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.files-scope \.files-hd-path\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.files-scope \.files-modes\s*\{[^}]*flex:\s*0 0 auto/);
  });

  /* Owner, 2026-10-09: the inner rail was a hairline nobody could find. */
  it('the tree seam is a visible strip with a drawn grip, lit on hover and while dragged', () => {
    expect(css).toMatch(/\.files-scope \.files-resizer\s*\{[^}]*width:\s*var\(--sp-8\)/);
    expect(css).not.toMatch(/\.files-scope \.files-resizer\s*\{[^}]*width:\s*var\(--w-hair\)/);
    expect(css).toMatch(/\.files-resizer::after\s*\{[^}]*height:\s*var\(--sp-32\)/);
    expect(css).toMatch(/\.files-resizer\.is-dragging::after/);
  });

  it('every button on the Files header and editor row clears the 28px control rung (none sits on the 24px floor)', () => {
    expect(css).toMatch(/\.files-scope \.files-treetoggle\s*\{[^}]*width:\s*var\(--control-h\)[^}]*height:\s*var\(--control-h\)/);
    expect(css).toMatch(/\.files-scope \.files-ed-ib\s*\{[^}]*width:\s*var\(--control-h\)/);
    expect(css).toMatch(/\.files-scope \.files-ed-pill\s*\{[^}]*height:\s*var\(--control-h\)/);
  });

  it('in a narrow pane the header toggle stays above the drawer it closes', () => {
    expect(css).toMatch(/\.files-scope\.is-narrow \.files-treetoggle\s*\{[^}]*z-index:\s*5/);
  });

  it('the drawer leaves the toggle row clear, and a dragged tree can never squeeze the file to nothing', () => {
    expect(css).toMatch(/\.files-scope\.is-narrow\.has-file \.files-side\s*\{[^}]*padding-top:\s*calc\(var\(--control-h\)/);
    /* Every tree track is capped to leave the file room (measured: a 300px drag in a 460px pane left the file 0px). */
    const tracks = [...css.matchAll(/grid-template-columns:\s*minmax\(0, ([^;]*?)\) auto minmax\(0, 1fr\)/g)].map((m) => m[1]!);
    const dragged = tracks.filter((t) => t.includes('--files-tree-w'));
    expect(dragged.length).toBeGreaterThan(0);
    for (const t of dragged) expect(t).toMatch(/min\(var\(--files-tree-w\), calc\(100% - /);
  });
});
