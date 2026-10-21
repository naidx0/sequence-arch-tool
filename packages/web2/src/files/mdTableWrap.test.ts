import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * Owner-seat review (420 px, docs/adr/README.md in Files): table cells broke words mid-token ("AD R", "Accept ed",
 * "Pha se 1"). A table is wider than a phone's column: it scrolls sideways inside its own wrapper, and a cell wraps
 * only at spaces, never inside a word. This reads the sheet because jsdom has no layout.
 */
const css = fs.readFileSync(path.join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarationsFor(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((x) => x.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out.join('\n');
}

describe('the markdown preview table', () => {
  it('scrolls sideways inside its own wrapper', () => {
    const wrap = declarationsFor('.files-scope .files-md .prose-table-wrap');
    expect(wrap).toMatch(/overflow-x:\s*auto/);
    expect(wrap).toMatch(/max-width:\s*100%/);
  });

  it('wraps a cell only at spaces: never mid-word', () => {
    for (const cell of ['.files-scope .files-md .prose-table th', '.files-scope .files-md .prose-table td']) {
      const d = declarationsFor(cell);
      expect(d, cell).toMatch(/overflow-wrap:\s*normal/);
      expect(d, cell).toMatch(/word-break:\s*normal/);
      expect(d, cell).not.toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-all|break-word/);
    }
  });

  it('the table fills the column but is never squeezed under its longest word: the wrapper scrolls instead', () => {
    const d = declarationsFor('.files-scope .files-md .prose-table');
    expect(d).toMatch(/width:\s*100%/);
    expect(d).not.toMatch(/table-layout:\s*fixed/);
  });
});
