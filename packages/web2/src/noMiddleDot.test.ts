import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* DECISION 49: no "·" separator anywhere in the UI (lab/specs/reskin-mix.md,
   "Everywhere"). The subject set is DERIVED: every non-test source file under
   src/, comments removed, so a file added tomorrow is scanned without anyone
   listing it. settings/noMiddleDot.test.ts keeps its narrower scan. */

function uiText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/testSupport/.test(f));
}

describe('no middle-dot separators in the UI (Decision 49)', () => {
  it('the scan finds a planted one, ignores comments, and sees the whole tree', () => {
    expect(uiText('const a = `x · y`;')).toContain('·');
    expect(uiText('/* x · y */ const a = 1; // z · w')).not.toContain('·');
    /* Anti-vacuity: the tree it reads is the real one. */
    expect(sources(__dirname).length).toBeGreaterThan(300);
  });

  it('none in any source file', () => {
    const dotted = sources(__dirname).filter((f) => uiText(readFileSync(join(__dirname, f), 'utf8')).includes('·'));
    expect(dotted).toEqual([]);
  });
});
