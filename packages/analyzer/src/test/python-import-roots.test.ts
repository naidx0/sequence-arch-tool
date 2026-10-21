import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveImportAll } from '../scan.js';

/**
 * THE IMPORT-ROOT ORDERING MUST NOT RE-SPLIT THE PATHS FOR EVERY COMPARISON.
 *
 * An absolute Python import that the service directory cannot answer is
 * resolved against every import root of the file set, nearest root first. The
 * ordering that decides "nearest" used to score each root ONCE PER
 * COMPARISON, and each score split the root's path and the importer's path
 * again - so one answer cost O(roots x log roots) path splits.
 *
 * MEASURED on the real Projects parent (C:/Users/dev/Projects, 219)
 * services): the comparator alone spent 2,741 ms of the scan thread's 61 s.
 *
 * The work is counted here by counting `String.prototype.split`, so the lock
 * needs nothing from the implementation: the old ordering splits thousands of
 * times for a handful of roots, the new one splits once per root.
 */

/** Count the path splits a function makes. */
function countSplits(fn: () => void): number {
  const real = String.prototype.split;
  let splits = 0;
  String.prototype.split = function (this: string, ...args: unknown[]): string[] {
    splits += 1;
    return (real as (...a: unknown[]) => string[]).apply(this, args);
  } as typeof String.prototype.split;
  try {
    fn();
    return splits;
  } finally {
    String.prototype.split = real;
  }
}

/** A file set with `roots` top-most python packages, each one directory deep. */
function fileSetWithRoots(roots: number): Set<string> {
  const files = new Set<string>();
  for (let i = 0; i < roots; i++) {
    /* `pkgN/inner` is a top-most package, so its PARENT is the import root:
       one root per `pkgN`, and the roots are not all the same directory. */
    files.add(`pkg${i}/inner/__init__.py`);
    files.add(`pkg${i}/inner/mod.py`);
  }
  return files;
}

test('the import-root ordering does not re-split the paths for every comparison', () => {
  const roots = 64;
  const fileSet = fileSetWithRoots(roots);
  // An import nothing resolves: the resolver then walks every import root,
  // which is where the ordering does its work.
  const splits = countSplits(() => {
    resolveImportAll('deep/nested/importer.py', 'nothing_here', 'py', '.', fileSet);
  });
  assert.ok(
    splits <= roots + 16,
    `${roots} import roots cost ${splits} path splits; the ordering must split each root once, not once per comparison`,
  );
});

test('the import-root ordering still resolves to the same file', () => {
  const fileSet = fileSetWithRoots(4);
  // The nearest root to the importer wins: `pkg3` shares a first segment with
  // `pkg3/deep/importer.py`, every other root shares none.
  const hit = resolveImportAll('pkg3/deep/importer.py', 'inner.mod', 'py', 'other', fileSet);
  assert.deepEqual(hit, ['pkg3/inner/mod.py'], `the import resolved to ${JSON.stringify(hit)}`);
  const far = resolveImportAll('elsewhere/importer.py', 'inner.mod', 'py', 'other', fileSet);
  assert.deepEqual(far, ['pkg0/inner/mod.py'], `the import resolved to ${JSON.stringify(far)}`);
});
