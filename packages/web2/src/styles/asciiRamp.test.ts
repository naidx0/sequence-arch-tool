/* S4 review item 7: the empty-board ASCII is a RAMP — dense at the bottom edge,
   nothing by mid-height, ink at 6% or less, still. Read off the stylesheet. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'asciiField.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = /\.ascii-field::before,\s*\.startup::before \{([^}]*)\}/.exec(css)?.[1] ?? '';
const rows = (/content:\s*"((?:[^"\\]|\\.)*)"/.exec(rule)?.[1] ?? '').split('\\A ');
const DENSE = /[#%@*+=]/g;
const density = (row: string) => (row.match(DENSE) ?? []).length / Math.max(1, row.length);

describe('the ASCII ramp', () => {
  it('is dense at the bottom edge and empty at its top', () => {
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]!.trim()).toBe('');
    expect(density(rows.at(-1)!)).toBeGreaterThan(0.5);
    /* Rising: the lower half of the block is denser than the upper half. */
    const half = Math.floor(rows.length / 2);
    const mean = (rs: string[]) => rs.reduce((n, r) => n + density(r), 0) / rs.length;
    expect(mean(rows.slice(half))).toBeGreaterThan(mean(rows.slice(0, half)) * 3);
  });

  it('sits on the bottom edge, no taller than half the pane, in ink at 6% or less, still', () => {
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/height:\s*50%/);
    expect(rule).toMatch(/justify-content:\s*flex-end/);
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(rule)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.06);
    expect(css).not.toMatch(/animation/);
  });
});
