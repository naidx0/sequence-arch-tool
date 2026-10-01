import { describe, expect, it } from 'vitest';

import { anatomyPanel, indexAnatomy, isAnatomyBucket } from './anatomy';
import type { ArchGraph } from '@sequence/schema';

/**
 * THE DRAWN CELLS PARTITION THE CONTAINER. EXACTLY. BOTH AXES.
 *
 * The panel header prints two numbers side by side — `${cells.length} ·
 * ${size.loc}`, "10 · 275,837" on this monorepo — and the whole reading of this
 * view depends on them describing THE SAME SET. If the cells summed to less
 * than the container, the treemap would be quietly omitting children while the
 * header reported the full total, and area-equals-lines would be a lie by the
 * amount of the gap.
 *
 * WRITTEN BECAUSE I CLAIMED THE OPPOSITE AND WAS WRONG. I reported — in a commit
 * message, to a peer lane, and to Max — that those two numbers were "at
 * different depths": `cells.length` counting direct children while `size.loc`
 * counted the whole subtree. It sounded right and it is false. Measured across
 * all eleven containers of a real scan, every one matches on BOTH axes:
 *
 *     repo          10 cells   275,837 = 275,837    1,059 = 1,059
 *     svc:analyzer   8 cells   130,881 = 130,881      438 =   438
 *     svc:web2      13 cells   107,845 = 107,845      441 =   441
 *     ... all 11, no exceptions
 *
 * The cells are not the direct children — they are the direct children AFTER
 * rollup, and the two operations that could have broken the partition both
 * preserve it deliberately: the loose-file bucket carries its members' true
 * combined size rather than a placeholder, and a child that rolls up to zero
 * lines goes to the zero band still carrying its own (zero) size instead of
 * being dropped. So the sum survives both.
 *
 * A RETRACTED FINDING IS WORTH A TEST, because the reason I believed it is that
 * nothing said otherwise. The invariant was true, undocumented and unlocked —
 * which is exactly the state in which a plausible wrong claim about it survives
 * three retellings. Now it fails if anyone breaks it.
 */

/** A container with every shape that could break the sum at once. */
const GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2026-09-10T00:00:00.000Z',
  repoRoot: '/fixtures/partition',
  repoName: 'partition',
  nodes: [
    { id: 'repo', kind: 'repo', label: 'partition' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api' },
    /* A module with a file inside it — size arrives by rollup, not directly. */
    { id: 'mod:api/0', kind: 'module', label: 'server', parentId: 'svc:api', path: 'api/src' },
    {
      id: 'file:api/src/a.ts',
      kind: 'file',
      label: 'a.ts',
      parentId: 'mod:api/0',
      path: 'api/src/a.ts',
      meta: { loc: 500 },
    },
    /* Three loose files, which BUCKET — the first thing that could lose lines. */
    { id: 'file:api/x.ts', kind: 'file', label: 'x.ts', parentId: 'svc:api', path: 'api/x.ts', meta: { loc: 30 } },
    { id: 'file:api/y.ts', kind: 'file', label: 'y.ts', parentId: 'svc:api', path: 'api/y.ts', meta: { loc: 20 } },
    { id: 'file:api/z.ts', kind: 'file', label: 'z.ts', parentId: 'svc:api', path: 'api/z.ts', meta: { loc: 10 } },
    /* A child holding nothing, which goes to the ZERO BAND — the second. */
    { id: 'mod:api/empty', kind: 'module', label: 'empty', parentId: 'svc:api', path: 'api/empty' },
  ],
  edges: [],
  warnings: [],
};

function panel() {
  return anatomyPanel(GRAPH, 'svc:api', indexAnatomy(GRAPH));
}

describe('the header’s two numbers describe the same set', () => {
  it('THE FIXTURE HAS BOTH HAZARDS: a bucket and a zero-band child', () => {
    /*
     * The vacuity guard. Every assertion below is about whether rollup and
     * banding preserve the sum, so a fixture that produced neither would pass
     * while checking nothing.
     */
    const p = panel();
    expect(p.cells.some((c) => isAnatomyBucket(c.id)), 'no bucket in the fixture').toBe(true);
    expect(p.zeroCount, 'no zero-band child in the fixture').toBeGreaterThan(0);
  });

  it('the drawn cells’ lines sum to the container’s lines', () => {
    const p = panel();
    const sum = p.cells.reduce((n, c) => n + c.loc, 0);
    expect(sum, 'the treemap is omitting lines the header still counts').toBe(p.size.loc);
    expect(p.size.loc, 'the fixture should hold 560 lines').toBe(560);
  });

  it('the drawn cells’ files sum to the container’s files', () => {
    /*
     * BOTH AXES, because they fail independently. A bucket that carried its
     * members' lines but reported one file would keep the loc sum intact and
     * silently lose three children from the count — and the header's left-hand
     * number is a count.
     */
    const p = panel();
    const files = p.cells.reduce((n, c) => n + c.files, 0);
    expect(files, 'the treemap is omitting files the header still counts').toBe(p.size.files);
    expect(p.size.files).toBe(4);
  });

  it('the bucket carries its members’ true combined size, not a placeholder', () => {
    /* The specific mechanism the partition depends on, asserted directly so a
       failure names the cause rather than only the symptom. */
    const bucket = panel().cells.find((c) => isAnatomyBucket(c.id))!;
    expect(bucket.loc, 'the bucket must carry 30 + 20 + 10').toBe(60);
    expect(bucket.files, 'the bucket must carry three files').toBe(3);
  });

  it('a child that holds nothing is still drawn, still counted, and adds nothing', () => {
    /* The other mechanism: banding must not DROP the child, or the count falls
       while the lines stay right. */
    const p = panel();
    const zero = p.cells.filter((c) => !c.toScale);
    expect(zero.length, 'the empty child must still be a cell').toBe(1);
    expect(zero[0]!.loc).toBe(0);
  });
});
