import assert from 'node:assert';
import { test } from 'node:test';

import { buildWorkspaceIndex, resolveWorkspaceImport } from '../workspaceImports.js';
import type { WorkspacePackage } from '../workspaceImports.js';

/**
 * THE EDGES A MONOREPO SCAN COULD NOT FIND.
 *
 * Measured on this repository: 1,348 import edges, every one of them inside a
 * single service, ZERO crossing two — while 218 source files import
 * `@sequence/*`. The scan resolved imports per service against that service's
 * own files, so a cross-package target was never in the set being searched.
 *
 * Every fixture in the existing suite is one package, which is why nothing
 * caught it. CLAUDE.md: "Fixture scale proves logic; only a REAL repo proves
 * the result."
 */

const PACKAGES: WorkspacePackage[] = [
  { name: '@sequence/schema', dir: 'packages/schema', entry: 'dist/index.js' },
  { name: '@sequence/export', dir: 'packages/export' },
  /* The pair that makes ordering load-bearing. */
  { name: '@acme/core', dir: 'packages/core' },
  { name: '@acme/core-utils', dir: 'packages/core-utils' },
];

const FILES = new Set([
  'packages/schema/src/index.ts',
  'packages/schema/src/paths.ts',
  'packages/export/index.ts',
  'packages/core/src/index.ts',
  'packages/core-utils/src/index.ts',
  'packages/app/src/main.ts',
]);

const INDEX = buildWorkspaceIndex(PACKAGES);

test('a workspace package resolves to its SOURCE entry, not its declared dist', () => {
  /*
   * `main` says `dist/index.js`. Nothing walks built output, so resolving to
   * the declared path would produce an edge onto a file the scan never saw —
   * and the src twin is the file that actually exists.
   */
  assert.strictEqual(
    resolveWorkspaceImport('@sequence/schema', INDEX, FILES),
    'packages/schema/src/index.ts',
  );
});

test('a package with no declared entry resolves by convention', () => {
  assert.strictEqual(
    resolveWorkspaceImport('@sequence/export', INDEX, FILES),
    'packages/export/index.ts',
  );
});

test('a deep import names its own file', () => {
  assert.strictEqual(
    resolveWorkspaceImport('@sequence/schema/paths.js', INDEX, FILES),
    'packages/schema/src/paths.ts',
  );
});

test('THE LONGER PACKAGE NAME WINS — the wrong one cites a real file', () => {
  /*
   * `@acme/core-utils` starts with `@acme/core`. Matching the shorter name
   * first would resolve into packages/core and cite a file that genuinely
   * exists there — a wrong edge with a working citation, which is the exact
   * failure CANON's first non-negotiable names.
   */
  assert.strictEqual(
    resolveWorkspaceImport('@acme/core-utils', INDEX, FILES),
    'packages/core-utils/src/index.ts',
  );
  assert.strictEqual(
    resolveWorkspaceImport('@acme/core', INDEX, FILES),
    'packages/core/src/index.ts',
  );
});

test('a third-party package resolves to NOTHING', () => {
  /* `react` is a fact about somebody else's tree. An edge into node_modules
     puts the whole of npm on the board. */
  for (const raw of ['react', 'node:path', 'lodash/merge', '@types/node']) {
    assert.strictEqual(resolveWorkspaceImport(raw, INDEX, FILES), null, raw);
  }
});

test('relative specifiers are refused — the per-service resolver owns those', () => {
  /* Answering here as well would double every intra-package edge. */
  assert.strictEqual(resolveWorkspaceImport('./sibling.js', INDEX, FILES), null);
  assert.strictEqual(resolveWorkspaceImport('../up.js', INDEX, FILES), null);
});

test('a workspace package whose files are absent resolves to nothing, not a guess', () => {
  const empty = new Set<string>();
  /* Declared in the workspace and nothing on disk answers to it. A plausible
     path here would be an edge citing a file that may not exist. */
  assert.strictEqual(resolveWorkspaceImport('@sequence/schema', INDEX, empty), null);
});

test('a deep import at a path that is not there does NOT fall back to the entry', () => {
  /*
   * Falling back would silently redirect the citation to a file the importer
   * never mentioned — the reader would open the evidence and find an unrelated
   * line.
   */
  assert.strictEqual(resolveWorkspaceImport('@sequence/schema/nope.js', INDEX, FILES), null);
});

test('the .js specifier means the .ts file — TypeScript ESM writes the output name', () => {
  assert.strictEqual(
    resolveWorkspaceImport('@sequence/schema/paths.js', INDEX, FILES),
    'packages/schema/src/paths.ts',
  );
});

test('the index is stable regardless of the order packages were discovered in', () => {
  const a = buildWorkspaceIndex(PACKAGES);
  const b = buildWorkspaceIndex([...PACKAGES].reverse());
  assert.deepStrictEqual(a, b);
});
