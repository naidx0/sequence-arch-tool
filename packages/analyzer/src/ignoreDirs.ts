/**
 * ONE definition of the directories the scanner never descends into.
 *
 * This module exists because there were two. `scan.ts` exported an `IGNORE_DIRS`, and
 * `detectors/nginx.ts` declared a private copy of the same name for its own conf walk.
 * The copy shadowed the export, so a directory added to the scanner's list was still
 * walked by the nginx detector — silently, because the two lists agreed on everything
 * that already mattered and nothing compared them.
 *
 * That is how a test fixture ended up asserting facts about production. Measured on
 * this monorepo: `svc:gateway`, the node standing for the real `packages/gateway`, had
 * exactly two inbound edges and BOTH came from nginx confs inside fixtures —
 * `test/fixtures/shopfront/edge/default.conf` and its mutated twin — each carrying
 * `origin: 'deterministic'`. Everything the graph claimed about that service was false,
 * and `who_calls gateway` reported it with file:line. `CLAUDE.md` makes "grounded, not
 * guessed (every edge/claim traces to real evidence)" a non-negotiable.
 *
 * Both walks now import this. Adding a name here covers every walk at once, which is
 * the property the duplicate destroyed.
 */

/**
 * Directory NAMES that are never descended into, matched per directory entry as the
 * walk goes down — never against an ancestor path.
 *
 * That distinction is what makes the fixture entries safe. Every analyzer suite points
 * `scanRepo` straight at a fixture directory; because the check runs on child names, a
 * scan rooted AT `test/fixtures/shopfront` never presents a child called `fixtures` and
 * skips nothing. Only a fixtures directory NESTED inside a larger repository
 * disappears, which is the case that was lying. Both directions are locked by
 * `test/fixture-exclusion.test.ts`.
 */
export const IGNORE_DIRS = new Set([
  // build output and dependency trees
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  'vendor',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  '.gradle',
  /*
   * PACKAGED OUTPUT. `electron-builder` writes its installers and the unpacked
   * app into `release/` by default, and `packages/desktop/scripts/prepare-server.mjs`
   * assembles `server-bundle/` — a `pnpm deploy` of the analyzer, which is to
   * say a complete second copy of this repository's own source, with a real
   * package.json and real imports.
   *
   * MEASURED the first time packaging succeeded: `packages/schema/src/index.ts`
   * went from 78 importers to 352, every analyzer file appeared three times,
   * and `who_calls` on the busiest target silently dropped 152 callers because
   * two thirds of what fitted under the cap were duplicates. The board would
   * have drawn three of every service.
   *
   * `.gitignore` lists both. The scanner does not read it — a scan is not a
   * checkout, and some repositories gitignore things a reader still wants
   * drawn — so the names are declared here, where every walk sees them.
   */
  'release',
  'server-bundle',
  // test material. A fixture is not the system it sits inside.
  'fixtures',
  '__fixtures__',
  'testdata',
]);
