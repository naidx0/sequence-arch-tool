/**
 * NO TWO SOURCE MODULES MAY DIFFER ONLY IN CASE.
 *
 * On 2026-10-09 the first Windows build of rounds 9 to 13 failed in tsc:
 * `activity/WorkflowGraph.tsx` and `activity/workflowGraph.ts` were both
 * imported, as `./WorkflowGraph` and `./workflowGraph`. Linux, where CI and the
 * cloud builders run, keeps them apart; Windows and macOS file systems do not,
 * so one import silently resolved to the other file. Every gate was green.
 *
 * A module specifier drops the extension, so the check is on the path WITHOUT
 * its extension: `Foo.tsx` beside `foo.ts` collides, `Foo.tsx` beside
 * `foo.test.tsx` does not (a test file is never imported by that name).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', 'packages', 'tools'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(f) && !/\.test\.[a-z]+$/.test(f) && !f.includes('/node_modules/'));

export function caseCollisions(paths) {
  const byKey = new Map();
  for (const f of paths) {
    const spec = f.replace(/\.[a-z]+$/, '');
    const key = spec.toLowerCase();
    const seen = byKey.get(key) ?? new Set();
    seen.add(spec);
    byKey.set(key, seen);
  }
  return [...byKey.values()].filter((s) => s.size > 1).map((s) => [...s].sort());
}

test('found the source files at all', () => {
  assert.ok(files.length > 500, `only ${files.length} files`);
});

test('the check catches the shape that broke the Windows build', () => {
  assert.deepEqual(caseCollisions(['a/WorkflowGraph.tsx', 'a/workflowGraph.ts']), [['a/WorkflowGraph', 'a/workflowGraph']]);
  assert.deepEqual(caseCollisions(['a/Foo.tsx', 'a/bar.ts']), []);
});

test('no two source modules differ only in case (Windows and macOS would merge them)', () => {
  assert.deepEqual(caseCollisions(files), []);
});
