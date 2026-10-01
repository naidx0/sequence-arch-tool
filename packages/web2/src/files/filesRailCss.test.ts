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

  it('names are shown whole and the tree scrolls to them', () => {
    expect(css).toMatch(/\.files-tree \.files-row\s*\{[^}]*width:\s*max-content/);
    expect(css).not.toMatch(/\.files-scope \.files-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('the header wraps rather than overlaps, and the view pair never outgrows it', () => {
    expect(css).toMatch(/\.files-scope \.files-hd\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.files-scope \.files-modes\s*\{[^}]*max-width:\s*100%/);
  });
});
