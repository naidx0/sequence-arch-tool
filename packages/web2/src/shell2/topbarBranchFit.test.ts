import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * With no surface open the branch pill sits at the bar's left edge (absolute) and the surface tabs are centred over
 * the main column. The chat overview narrows that column, so a pill at its full width ran under the "Agents" tab
 * (1280x800: pill 252..429, tabs from 396). The pill takes only its half of the column, less the tabs' half, and
 * its name ends in an ellipsis inside that.
 */
const css = readFileSync(resolve(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (sel: string) => {
  const at = css.indexOf(sel + ' {');
  expect(at, sel).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('the top bar branch pill gives way to the centred surface tabs', () => {
  it('is capped to the room between the bar edge and the tabs, and clips its name', () => {
    const r = rule(".s2-row[data-stage='none'] .s2-topb > .s2-branch");
    expect(r).toMatch(/max-width:[^;]*var\(--wrap-w/);
    expect(r).toMatch(/overflow:\s*hidden/);
  });

  it('the name inside it truncates with an ellipsis and may shrink', () => {
    const r = rule('.s2-branch-l');
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    expect(r).toMatch(/min-width:\s*0/);
  });
});

describe('the pill name is not fade-masked when cut', () => {
  it('a cut name in the top bar pill ends in an ellipsis with no mask', () => {
    const hits = [...css.matchAll(/\.s2-topb > \.s2-branch \.s2-branch-l\[data-cut='true'\]\s*\{([^}]*)\}/g)];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[hits.length - 1]![1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(hits[hits.length - 1]![1]).toMatch(/mask-image:\s*none/);
  });
});
