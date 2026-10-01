import assert from 'node:assert';
import { test } from 'node:test';

import { ROOT_REGION, unscannedRegions, unscannedSummary } from '../lang/unscanned.js';

/**
 * SOURCE THE WALK NEVER REACHED.
 *
 * Owner walk 2026-08-22: "Index is cool. It shows the files. Missing a couple,
 * actually." Measured: 59 tracked source files absent from the graph, none of
 * them a parse failure — all of them outside every discovered service.
 *
 * `unfollowed` reported `[]` throughout, which its own contract defines as
 * "looked, and everything was readable". The graph therefore asserted full
 * coverage over files it had never opened. This is the tally that makes that
 * sentence true.
 */

const SERVICES = ['packages/analyzer', 'packages/web2'];

const FILES = [
  'packages/analyzer/src/scan.ts',
  'packages/web2/src/app/App.tsx',
  'tools/ci/docs-catalog.test.mjs',
  'tools/ci/no-cron.test.mjs',
  'tools/bench/agent-context-bench.mjs',
  'examples/ticketing/api/main.py',
  'vitest.config.ts',
];

test('it names the regions holding source no service covers', () => {
  const regions = unscannedRegions(FILES, SERVICES);
  assert.deepStrictEqual(
    regions.map((r) => r.dir),
    /* Biggest first: the region with the most unread source is the one most
       likely to change what a reader concludes. */
    ['tools', ROOT_REGION, 'examples'],
  );
  assert.strictEqual(regions[0]!.files, 3);
});

test('files inside a scanned service are NOT reported', () => {
  const regions = unscannedRegions(FILES, SERVICES);
  assert.ok(!regions.some((r) => r.dir === 'packages'));
});

test('A PREFIX IS NOT CONTAINMENT — packages/webhooks is not inside packages/web', () => {
  /*
   * The bug this shape invites. `startsWith` says `packages/webhooks/x.ts` is
   * covered by a service at `packages/web`, which would silently remove a whole
   * package from the one report whose job is noticing what went missing.
   */
  const regions = unscannedRegions(['packages/webhooks/src/index.ts'], ['packages/web']);
  assert.strictEqual(regions.length, 1);
  assert.strictEqual(regions[0]!.dir, 'packages');
  assert.strictEqual(regions[0]!.files, 1);
});

test('a file at the repository root is named, not silently dropped', () => {
  const regions = unscannedRegions(['vitest.config.ts'], SERVICES);
  assert.strictEqual(regions[0]!.dir, ROOT_REGION);
});

test('it records WHICH extensions, so scripts read differently from sources', () => {
  const regions = unscannedRegions(FILES, SERVICES);
  const tools = regions.find((r) => r.dir === 'tools')!;
  assert.deepStrictEqual(tools.extensions, ['.mjs']);
});

test('a repository with everything covered reports NOTHING', () => {
  assert.deepStrictEqual(unscannedRegions(['packages/analyzer/src/scan.ts'], SERVICES), []);
  /* And the summary is null, not an empty sentence — a surface rendering an
     empty box to make a point about completeness is worse than silence. */
  assert.strictEqual(unscannedSummary([]), null);
});

test('a service directory of "." covers everything', () => {
  /* A single-service repo scanned from its root has nothing outside it, and
     reporting the whole tree as unscanned would be exactly backwards. */
  assert.deepStrictEqual(unscannedRegions(FILES, ['.']), []);
});

test('the summary counts files and names the biggest regions', () => {
  const line = unscannedSummary(unscannedRegions(FILES, SERVICES))!;
  assert.match(line, /5 source files/);
  assert.match(line, /were not read/);
  assert.match(line, /tools \(3\)/);
});

test('the summary does not list every region — it says how many more', () => {
  const many = unscannedRegions(
    ['a/1.ts', 'b/1.ts', 'c/1.ts', 'd/1.ts', 'e/1.ts'],
    ['packages/x'],
  );
  const line = unscannedSummary(many)!;
  assert.match(line, /and 2 more/);
});

test('the order is stable across two identical scans', () => {
  const a = unscannedRegions(FILES, SERVICES);
  const b = unscannedRegions([...FILES].reverse(), SERVICES);
  assert.deepStrictEqual(a, b);
});

test('trailing separators on a service dir do not un-cover it', () => {
  assert.deepStrictEqual(unscannedRegions(['packages/web2/a.ts'], ['packages/web2/']), []);
  assert.deepStrictEqual(unscannedRegions(['packages/web2/a.ts'], ['packages\\web2']), []);
});
