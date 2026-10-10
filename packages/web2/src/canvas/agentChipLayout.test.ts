import { describe, expect, it } from 'vitest';

import { CHIP_H, CHIP_MAX_LANES, chipWidth, placeChips } from './agentChipLayout';
import type { ChipInput } from './agentChipLayout';

const chip = (id: string, x0: number, y0: number, priority: number, w = 120): ChipInput => ({ id, x0, x1: x0 + w, y0, priority });

/** No two placed chips may touch: the invariant Jaden reported broken at low zoom. */
function boxes(items: ChipInput[]) {
  return placeChips(items)
    .filter((p) => !p.hidden)
    .map((p) => {
      const it = items.find((i) => i.id === p.id)!;
      const y0 = it.y0 - p.lane * (CHIP_H + 2);
      return { id: p.id, x0: it.x0, x1: it.x1, y0, y1: y0 + CHIP_H };
    });
}

describe('agent chips at low zoom (ask 25)', () => {
  it('chips far apart stay in their home lane', () => {
    const out = placeChips([chip('a', 0, 100, 1), chip('b', 400, 100, 2)]);
    expect(out.map((p) => [p.id, p.lane, p.hidden])).toEqual([['a', 0, false], ['b', 0, false]]);
  });

  it('chips stacked on top of each other take different lanes, newest at home', () => {
    const out = placeChips([chip('old', 10, 100, 1), chip('new', 30, 100, 5)]);
    const by = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(by.new!.lane).toBe(0);
    expect(by.old!.lane).toBe(1);
  });

  it('with no free lane the oldest yields (shown on hover) instead of overlapping', () => {
    const items = Array.from({ length: CHIP_MAX_LANES + 2 }, (_, i) => chip(`c${i}`, 10 + i, 100, i));
    const out = placeChips(items);
    expect(out.filter((p) => p.hidden)).toHaveLength(2);
    expect(out.find((p) => p.id === 'c0')!.hidden).toBe(true);
    const placed = boxes(items);
    for (const a of placed) {
      for (const b of placed) {
        if (a.id === b.id) continue;
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it('a dozen chips scattered over a zoomed-out board never overlap once placed', () => {
    const items = Array.from({ length: 12 }, (_, i) => chip(`n${i}`, 200 + (i % 4) * 25, 300 + Math.floor(i / 4) * 6, i));
    const placed = boxes(items);
    for (const a of placed) {
      for (const b of placed) {
        if (a.id === b.id) continue;
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
    }
  });

  it('chip width grows with its text', () => {
    expect(chipWidth('Main agent: editing a.ts')).toBeGreaterThan(chipWidth('Main agent'));
  });
});

describe('chips and cards (ask 25)', () => {
  it('a chip is not drawn across another card; its own card does not count', () => {
    const own = { id: 'a', x0: 0, x1: 100, y0: 100, y1: 140 };
    const neighbour = { id: 'b', x0: 20, x1: 140, y0: 60, y1: 98 }; // sits right where a's chip would hang (y 78..96)
    const [p] = placeChips([chip('a', 0, 78, 1, 100)], [own, neighbour]);
    expect(p!.lane).toBeGreaterThan(0);
    const [q] = placeChips([chip('a', 0, 78, 1, 100)], [own]);
    expect(q!.lane).toBe(0);
  });

  it('with cards in every lane the chip yields instead of covering one', () => {
    const wall = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, x0: 0, x1: 300, y0: i * 20, y1: 20 + i * 20 }));
    const [p] = placeChips([chip('a', 0, 100, 1, 100)], wall);
    expect(p!.hidden).toBe(true);
  });
});
