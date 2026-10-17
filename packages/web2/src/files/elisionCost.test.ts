import { describe, expect, it } from 'vitest';

import { elideNameEnds } from './FileTree';

/* ══════════════════════════════════════════════════════════════════════════
   A GROUP'S NAMES ARE CUT ONCE, NOT ONCE PER TOGGLE (perf, 019)
   packages/web2/src/files/elisionCost.test.ts

   Opening every group of a 1,225-row list took 5.4 s, almost all of it measuring text: the group's
   cuts were remembered by the identity of its names array, and the array is rebuilt (same names, new
   array) on every toggle, filter and refresh, so each rebuild re-decided every name of the group.
   The cuts are now also remembered by the names' content. What is locked: the same names in a new
   array cost no measuring beyond the row's own, and the answer is the same.
   ══════════════════════════════════════════════════════════════════════════ */

const NAMES = Array.from({ length: 300 }, (_, i) => `ask-${String(i).padStart(3, '0')}-history-server-handler-extra.test.ts`);

function counted() {
  let calls = 0;
  return { measure: (s: string) => { calls += 1; return s.length * 7; }, calls: () => calls };
}

describe('the cuts of a group are decided once per room, whatever array carries the names', () => {
  it('a rebuilt list of the same names is not decided again, and reads the same', () => {
    const first = counted();
    const a = elideNameEnds(NAMES[7]!, 160, first.measure, [...NAMES]);
    expect(first.calls()).toBeGreaterThan(300); /* the whole group was decided */
    const second = counted();
    const b = elideNameEnds(NAMES[7]!, 160, second.measure, [...NAMES]);
    expect(b).toEqual(a);
    expect(second.calls()).toBeLessThan(10); /* the row's own width and the font check only */
  });

  it('a different room is its own decision, and every name of the group still reads differently in it', () => {
    const m = counted();
    const texts = new Set(NAMES.map((n) => { const c = elideNameEnds(n, 150, m.measure, NAMES); return c.head + c.tail; }));
    expect(texts.size).toBe(NAMES.length);
  });
});
