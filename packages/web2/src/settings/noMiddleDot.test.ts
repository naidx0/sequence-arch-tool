import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* DECISION 49: no "·" separators in UI text (lab/specs/reskin-mix.md,
   "Everywhere"). The subject set is derived, not listed: every component
   source in this folder and the board's, with comments removed, so a new
   file cannot slip past the scan. */
function uiText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function dotted(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => uiText(readFileSync(join(dir, f), 'utf8')).includes('·'))
    .map((f) => join(dir, f));
}

describe('no middle-dot separators in Settings or on the board (Decision 49)', () => {
  it('finds one in a planted line, and none outside comments', () => {
    expect(uiText('const a = `x · y`;')).toContain('·');
    expect(uiText('/* x · y */ const a = 1;')).not.toContain('·');
    expect(dotted(__dirname)).toEqual([]);
  });

  it('none in the board components either', () => {
    expect(dotted(join(__dirname, '..', 'canvas'))).toEqual([]);
  });
});
