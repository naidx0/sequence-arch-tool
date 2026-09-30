import { describe, expect, it } from 'vitest';

import { farLabelsToYield, type FarLabelInput } from './farLabels';

/* Photo 2, 2026-09-22 — measured on this repository's board at 25%: the
   "Desktop" and "Gateway" label centres sat 58 screen px apart and their far labels,
   counter-scaled to screen size, rendered as "DesktopGateway". */
const at = (id: string, cx: number, cy: number, degree = 0, selected = false): FarLabelInput => ({
  id,
  cx,
  cy,
  text: id,
  degree,
  selected,
});

describe('far labels yield when they collide', () => {
  it('two labels that overlap on screen: the less-connected one yields', () => {
    /* 232 flow units = the measured 58 screen px at 25%; each label is ~63px wide. */
    const hidden = farLabelsToYield([at('Desktop', 0, 0, 1), at('Gateway', 232, 0, 5)], 0.25);
    expect([...hidden]).toEqual(['Desktop']);
  });

  it('the same two cards at a nearer zoom both keep their names', () => {
    expect(farLabelsToYield([at('Desktop', 0, 0, 1), at('Gateway', 232, 0, 5)], 0.6).size).toBe(0);
  });

  it('a selected card always keeps its label', () => {
    const hidden = farLabelsToYield([at('Desktop', 0, 0, 1, true), at('Gateway', 232, 0, 5)], 0.25);
    expect(hidden.has('Desktop')).toBe(false);
    expect(hidden.has('Gateway')).toBe(true);
  });

  it('labels far apart never yield, whatever the zoom', () => {
    expect(farLabelsToYield([at('A', 0, 0), at('B', 5000, 5000)], 0.25).size).toBe(0);
  });

  it('is stable: the same board gives the same answer', () => {
    const board = [at('A', 0, 0), at('B', 100, 0), at('C', 200, 0), at('D', 300, 0)];
    expect([...farLabelsToYield(board, 0.25)]).toEqual([...farLabelsToYield([...board], 0.25)]);
  });

  it('no two KEPT labels overlap — the property, over a dense grid', () => {
    const grid: FarLabelInput[] = [];
    for (let i = 0; i < 12; i++) grid.push(at(`Service${i}`, (i % 4) * 180, Math.floor(i / 4) * 90, i % 3));
    const zoom = 0.25;
    const hidden = farLabelsToYield(grid, zoom);
    const kept = grid.filter((g) => !hidden.has(g.id));
    const w = (t: string) => (t.length * 8.2) / zoom;
    const h = 21 / zoom;
    for (let a = 0; a < kept.length; a++) {
      for (let b = a + 1; b < kept.length; b++) {
        const A = kept[a]!;
        const B = kept[b]!;
        const overlapX = Math.abs(A.cx - B.cx) < (w(A.text) + w(B.text)) / 2;
        const overlapY = Math.abs(A.cy - B.cy) < h;
        expect(overlapX && overlapY, `${A.id} vs ${B.id}`).toBe(false);
      }
    }
    expect(kept.length).toBeGreaterThan(0);
  });
});
