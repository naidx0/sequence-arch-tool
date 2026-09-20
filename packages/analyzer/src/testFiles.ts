/**
 * Is this file part of the test suite rather than the product?
 *
 * A single source of truth, for the reason `ignoreDirs.ts` is one: the rule was
 * previously half-written inside `isGenerated`, whose comment already stated the
 * policy — "test files are not part of the service's runtime graph" — while its
 * regex implemented it for exactly one language (`_test.go`).
 *
 * WHY IT MATTERS, measured on ml-harness (2026-08-21):
 *
 *   test files            158 of 292 file nodes   (54%)
 *   edges cast by tests   576 of 969 import edges (59%)
 *
 * The clusterer runs a community detection over that import graph, so on this
 * repository the test suite outweighed the product roughly 4:1 and decided what
 * the modules WERE. The module holding `app/main.py` and `app/db.py` — the
 * 51-route HTTP app and the only door to the database — came back labelled
 * "tests", as did three others, because the label is a plurality vote over the
 * members' directories and the test files outnumbered the source.
 *
 * WHAT THIS DOES NOT DO. Test files are still scanned, still become file nodes,
 * still carry their import edges and still answer `who_calls`. "What calls this?"
 * SHOULD name a test caller. They are excluded only from the ARCHITECTURE view —
 * the clustering and the anchor ranking that decide the boxes and their names —
 * because a box diagram of a system is not a picture of its test suite.
 */

/** `test_x.py`, `x_test.py`, `x.test.ts`, `x.spec.tsx`, `conftest.py`. */
const TEST_FILENAME =
  /(^test_[^/]*\.(py|rb)$)|(_test\.(py|go|rb|ts|js)$)|(\.(test|spec)\.[cm]?[jt]sx?$)|(^conftest\.py$)/;

/** A path segment that is a test directory by convention. */
const TEST_DIRECTORY = /(^|\/)(tests?|__tests__|spec|specs|testing)(\/|$)/;

/**
 * True for a file the architecture view should not be shaped by.
 *
 * Accepts a repo-relative POSIX path (see `relPosix.ts`) or a bare basename; the
 * directory rule only fires when it is given a path. Both rules are needed:
 * on ml-harness 152 of 157 test files match by FILENAME, and the remaining five
 * — `support.py`, `diagnosis_fixtures.py` and three harvested corpora — are
 * ordinary module names that only the DIRECTORY identifies. `support.py` is 882
 * lines and imported by 88 of the test files, so by import degree alone it looks
 * like one of the most important files in the repository.
 */
export function isTestFile(relPath: string): boolean {
  if (!relPath) return false;
  const posix = relPath.replace(/\\/g, '/');
  const base = posix.slice(posix.lastIndexOf('/') + 1);
  return TEST_FILENAME.test(base) || TEST_DIRECTORY.test(posix);
}
