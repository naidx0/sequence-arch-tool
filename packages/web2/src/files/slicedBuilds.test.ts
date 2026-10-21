import { describe, expect, it } from 'vitest';
import type { GetFunctionsResponse } from '@sequence/api-types';

import { buildFunctionIndex } from '../rail/railModel';
import { buildFunctionIndexSliced } from '../rail/railModelSliced';
import { buildFileTree, buildFileTreeSliced } from './filesModel';

/* A clock that costs 1 ms per read: every resume of a build reads it once, so "ms of work between yields" is counted in resumes. */
function fakeClock() {
  let t = 0;
  let sinceYield = 0;
  const yields: number[] = [];
  return {
    now: () => {
      t += 1;
      sinceYield += 1;
      return t;
    },
    yieldFn: async () => {
      yields.push(sinceYield);
      sinceYield = 0;
    },
    yields,
  };
}

const paths = Array.from({ length: 3000 }, (_, i) => `packages/p${i % 40}/src/d${i % 7}/f${i}.ts`).concat(['README.md', './src/a.ts', 'src/a.ts', 'dir/']);
const functions = {
  functionGraph: {
    nodes: Array.from({ length: 6000 }, (_, i) => ({ id: `fn${i}`, name: `n${i}`, file: `packages\p${i % 40}\f${i % 3000}.ts`, startLine: (i * 7) % 500, endLine: 0 })),
    edges: [],
  },
  warnings: [],
} as unknown as GetFunctionsResponse;

describe('opening Files never blocks a frame: the builds yield', () => {
  it('buildFileTree on 3,000 files yields at least every 8 ms of work and returns the sync result', async () => {
    const clock = fakeClock();
    const sliced = await buildFileTreeSliced(paths, ['empty/dir'], { budgetMs: 8, now: clock.now, yieldFn: clock.yieldFn });
    expect(sliced).toEqual(buildFileTree(paths, ['empty/dir']));
    expect(clock.yields.length).toBeGreaterThan(3);
    /* Each slice is the budget plus at most the one step that crossed it. */
    expect(Math.max(...clock.yields)).toBeLessThanOrEqual(9);
  });
  it('buildFunctionIndex on a large payload yields at least every 8 ms of work and returns the sync result', async () => {
    const clock = fakeClock();
    const sliced = await buildFunctionIndexSliced(functions, { budgetMs: 8, now: clock.now, yieldFn: clock.yieldFn });
    expect(sliced).toEqual(buildFunctionIndex(functions));
    expect(clock.yields.length).toBeGreaterThan(1);
    expect(Math.max(...clock.yields)).toBeLessThanOrEqual(9);
  });
  it('an abort between slices stops the build', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const run = buildFileTreeSliced(paths, [], {
      budgetMs: 8,
      now: clock.now,
      yieldFn: async () => {
        controller.abort();
      },
      signal: controller.signal,
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
