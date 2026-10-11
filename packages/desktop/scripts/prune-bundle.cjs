// prune-bundle — take out of the server bundle what the packaged app never runs.
//
// MEASURED, NOT GUESSED. On Windows the deployed analyzer bundle was 130 MB,
// and about 69 MB of it was never executed by anybody:
//
//   node-pty prebuilds/*/*.pdb      ~57 MB  debug symbols for the native addon,
//                                           read only by a debugger
//   node-pty prebuilds/<other OS>          the macOS binaries on a Windows build
//                                           (and the reverse); node-pty loads
//                                           prebuilds/<process.platform>-<arch>
//   analyzer dist/**/*.test.js       3.4 MB  the analyzer's own compiled tests
//   *.map, *.d.ts                   ~3.6 MB  source maps and type declarations
//
// What stays is chosen by what loads at runtime, not by size: test HELPERS in
// dist/test (ask-honesty-corpus.js is imported by harness/m3m4Reporter.js) stay,
// only `*.test.js` files go; every arch for THIS platform stays, because the
// mac build packs arm64 and x64 from one bundle. prepare-server.mjs boots the
// pruned bundle from outside the repository afterwards, so a rule here that
// removed something the server needs fails packaging, not a person's launch.
//
// CommonJS so the desktop package's compiled tests (CommonJS) can require it.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEAD_FILE = /(\.map|\.d\.ts|\.d\.mts|\.d\.cts|\.pdb)$/i;

/**
 * Prune `analyzerDir` (a `pnpm deploy` output: dist + node_modules) in place.
 * Returns what went, for the log and for the tests.
 */
function pruneAnalyzerBundle(analyzerDir, platform = process.platform) {
  const removed = [];
  let bytes = 0;

  function size(p) {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of fs.readdirSync(p)) n += size(path.join(p, e));
    return n;
  }
  function drop(p) {
    bytes += size(p);
    removed.push(path.relative(analyzerDir, p).split(path.sep).join('/'));
    fs.rmSync(p, { recursive: true, force: true });
  }

  // 1. node-pty's prebuilds for other operating systems.
  const prebuilds = path.join(analyzerDir, 'node_modules', 'node-pty', 'prebuilds');
  if (fs.existsSync(prebuilds)) {
    for (const d of fs.readdirSync(prebuilds)) {
      if (!d.startsWith(platform + '-')) drop(path.join(prebuilds, d));
    }
  }

  // 2. Debug symbols, source maps, type declarations — anywhere in the bundle;
  //    and the analyzer's own compiled tests, under its dist only.
  const dist = path.join(analyzerDir, 'dist');
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (DEAD_FILE.test(e.name)) drop(p);
      else if (e.name.endsWith('.test.js') && p.startsWith(dist + path.sep)) drop(p);
    }
  })(analyzerDir);

  return { removed, bytes };
}

module.exports = { pruneAnalyzerBundle };
