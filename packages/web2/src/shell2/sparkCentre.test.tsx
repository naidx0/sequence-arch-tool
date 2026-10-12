import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { S2Icon } from './icons';

/* The audit measured one chat `.r9-kindicon` (the spark) 1.17px above its box: the glyph's ink was centred
   at y=10 of a 24 grid. WHAT THIS READS: the path's own coordinates (M/L/l/z only), not a layout. */
function inkBox(d: string): { x: number; y: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const m of d.matchAll(/([MLl])([^MLlz]*)/g)) {
    const n = (m[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const rel = m[1] === 'l';
    cx = rel ? cx + n[0]! : n[0]!;
    cy = rel ? cy + n[1]! : n[1]!;
    xs.push(cx);
    ys.push(cy);
  }
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

describe('the spark glyph is centred in its 24 grid', () => {
  it('ink centre within a quarter unit of (12, 12)', () => {
    const { container } = render(<S2Icon name="spark" small className="r9-kindicon" />);
    const c = inkBox(container.querySelector('path')!.getAttribute('d')!);
    expect(Math.abs(c.x - 12)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(c.y - 12)).toBeLessThanOrEqual(0.25);
  });
  it('negative control: the parser sees the old off-centre path as off-centre', () => {
    expect(inkBox('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z').y).toBeCloseTo(10, 5);
  });
});
