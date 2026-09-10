/**
 * TypeScript ESM specifiers must resolve.
 *
 * Under `"module": "NodeNext"` — this repo, and every modern TS ESM project —
 * `import { X } from './Thing.js'` refers to `Thing.ts` or `Thing.tsx` on disk. The
 * `.js` file does not exist and never will: the specifier names the OUTPUT the
 * compiler will emit, not the source.
 *
 * `resolveImport` did not know that. It tried `Thing.js` (absent) and then
 * `Thing.js.ts` (nonsense), so every such import resolved to nothing and produced no
 * edge. Measured on this monorepo before the fix:
 *
 *   packages/web/src relative imports          1545
 *   ...ending in `.js`                         1545  (100%)
 *   edges touching svc:web                       51
 *   whole-repo edges                             87   (0.069 per file)
 *
 * After:
 *
 *   whole-repo edges                           2307   (1.832 per file)
 *   import edges                          79 -> 2299
 *
 * This is not a cosmetic gap in a side feature. The grounded graph IS the product,
 * and the MCP `who_calls` tool answered "nothing in this scan" for almost every
 * question worth asking — an authoritative-sounding empty answer, which is worse than
 * no tool at all. `who_calls ProductComposer` returned zero before, and now returns
 * its real caller and eight callees, each cited to a file and line.
 *
 * These tests use a synthetic file set rather than the real repo so they state the
 * RULE (specifier extension vs on-disk extension) rather than a snapshot of this
 * codebase, which would rot the moment a file moved.
 *
 * PATHS ARE POSIX ON BOTH SIDES, ON EVERY PLATFORM.
 *
 * This file used to build its fixture with `path.join` and said so: "the scanner
 * works in native separators". That was true and it was the bug. A repo-relative
 * path in the graph is an IDENTIFIER — a node id, an evidence ref, an export key
 * — so a scan on Windows and a scan on Linux were producing different identities
 * for the same repo. `scanRepo` now emits POSIX everywhere (see relPosix.ts) and
 * `resolveImport` builds its candidates with `path.posix`, so the fixture below
 * is POSIX too. The RULE under test is untouched: a specifier's extension names
 * the compiler's OUTPUT, not the file on disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImport } from '../scan.js';

const p = (...parts: string[]) => parts.join('/');

/** Files as they exist ON DISK — note there is no bare .js source except `plain.js`. */
const FILES = new Set([
  p('src', 'ProductComposer.tsx'),
  p('src', 'chatMemory.ts'),
  p('src', 'legacy.jsx'),
  p('src', 'native.mts'),
  p('src', 'old.cts'),
  p('src', 'plain.js'),
  p('src', 'nested', 'index.ts'),
  p('src', 'widget', 'index.tsx'),
  p('src', 'caller.ts'),
]);

const resolve = (raw: string) => resolveImport(p('src', 'caller.ts'), raw, 'ts', 'svc', FILES);

test('a .js specifier resolves to the .ts source it will compile from', () => {
  assert.equal(resolve('./chatMemory.js'), p('src', 'chatMemory.ts'));
});

test('a .js specifier resolves to a .tsx source', () => {
  // The case that mattered most: 100% of packages/web's relative imports look like
  // this, and every one of them produced no edge.
  assert.equal(resolve('./ProductComposer.js'), p('src', 'ProductComposer.tsx'));
});

test('.jsx, .mjs and .cjs specifiers resolve to their TS sources', () => {
  assert.equal(resolve('./legacy.jsx'), p('src', 'legacy.jsx'));
  assert.equal(resolve('./native.mjs'), p('src', 'native.mts'));
  assert.equal(resolve('./old.cjs'), p('src', 'old.cts'));
});

test('a REAL .js file still wins over the rewrite', () => {
  // The rewrite must not shadow plain JavaScript. `plain.js` exists on disk, so it
  // resolves to itself — a project mixing .js and .ts must not have its .js imports
  // silently redirected at a same-named .ts sitting beside them.
  assert.equal(resolve('./plain.js'), p('src', 'plain.js'));
});

test('directory imports resolve to index.ts AND index.tsx', () => {
  // index.tsx was missing from the candidate list entirely, so a React barrel
  // directory resolved to nothing for the same class of reason.
  assert.equal(resolve('./nested'), p('src', 'nested', 'index.ts'));
  assert.equal(resolve('./widget'), p('src', 'widget', 'index.tsx'));
});

test('an unresolvable specifier still returns undefined', () => {
  // The fix must not invent edges. A specifier with no file behind it stays
  // unresolved — a fabricated edge is worse than a missing one in a graph whose
  // entire claim is that every edge traces to real evidence.
  assert.equal(resolve('./does-not-exist.js'), undefined);
  assert.equal(resolve('./nested/missing.js'), undefined);
});

test('bare package specifiers are still ignored', () => {
  // Only relative imports describe intra-repo structure; node_modules edges would
  // swamp the graph without saying anything about this system.
  assert.equal(resolve('react'), undefined);
  assert.equal(resolve('@sequence/schema'), undefined);
});
