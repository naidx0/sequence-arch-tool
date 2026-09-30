import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * EVERY STYLESHEET COMMENT CLOSES — found 2026-09-22.
 *
 * `app/aiCanvas.css` carried a comment cut off mid-sentence, never closed. A
 * browser reads everything after an unclosed `/*` as comment, so every rule
 * below it — the SVG sizing, the story navigation — had been dead in the app,
 * while every test that reads CSS with a lazy `/\*[\s\S]*?\*\/` stripper saw
 * the rules as live (no terminator, no match, nothing stripped). It surfaced
 * only when a later comment's `*\/` closed it and the class-coverage count
 * jumped. A `/*` inside an open comment is the same fault, one step earlier.
 */
function sheets(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sheets(p, out);
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

describe('stylesheet comments', () => {
  it('every comment in every stylesheet closes, and none opens inside another', () => {
    const faults: string[] = [];
    const files = sheets(path.join(__dirname));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const raw = fs.readFileSync(f, 'utf8');
      let open: number | null = null;
      for (const m of raw.matchAll(/\/\*|\*\//g)) {
        const line = raw.slice(0, m.index).split('\n').length;
        if (m[0] === '/*') {
          if (open !== null) faults.push(`${path.relative(__dirname, f)}:${line} opens inside a comment`);
          open = m.index ?? 0;
        } else open = null;
      }
      if (open !== null) {
        faults.push(`${path.relative(__dirname, f)}:${raw.slice(0, open).split('\n').length} never closes`);
      }
    }
    expect(faults).toEqual([]);
  });
});
