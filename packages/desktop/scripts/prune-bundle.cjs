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

/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.1 D2 (audit M1): what the INSTALLED server never loads, by rule.

   Measured on Windows before this pass: resources/server 90.4 MB, of it
     analyzer src/ (TypeScript sources)              11.0 MB
     10 tree-sitter grammars the scanner never loads ~16 MB
     the unbundled dist/ beside the one-file bundle    ~8 MB
     zod/src (TypeScript sources)                      3.1 MB
     node-pty deps/ third_party/ src/ (C++ sources)    3.5 MB
     pg and its closure (Postgres, a deploy-only store)
   The desktop runs dist/sequence-server-entry.cjs (main.ts serverPaths), so
   the bundle is what ships and the unbundled dist goes, except the files the
   bundle finds beside itself (the board MCP server, the Claude launcher).
   prepare-server.mjs then boots and scans from the pruned, copied-out shape,
   so a rule here that takes something the server needs fails packaging.
   ══════════════════════════════════════════════════════════════════════════ */

/** The dist/ files the shipped server runs or finds beside itself. Everything else in dist/ goes. */
const SHIPPED_DIST = new Set([
  'sequence-server-entry.cjs',
  'sequence-server.cjs',
  'sequence-mcp.cjs',
  /* review B: the HTML converter worker the bundle runs beside itself */
  'sequence-html-worker.cjs',
  'claude-agent-acp-launch.mjs',
  'claude-agent-acp.mjs',
  'claude-agent-acp.LICENSE.txt',
]);

/** Packages the desktop never loads, with every dependency only they need. */
const UNSHIPPED_PACKAGES = ['pg'];

function readDeps(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}), ...(pkg.peerDependencies || {}) });
  } catch {
    return [];
  }
}

/** name -> dependency names, for every package in a hoisted node_modules (scoped ones included). */
function packageGraph(nodeModules) {
  const graph = new Map();
  if (!fs.existsSync(nodeModules)) return graph;
  for (const e of fs.readdirSync(nodeModules)) {
    if (e.startsWith('.')) continue;
    if (e.startsWith('@')) {
      for (const s of fs.readdirSync(path.join(nodeModules, e))) graph.set(`${e}/${s}`, readDeps(path.join(nodeModules, e, s)));
    } else {
      graph.set(e, readDeps(path.join(nodeModules, e)));
    }
  }
  return graph;
}

/**
 * The packages to drop: `roots` and their dependency closure, minus anything a
 * package OUTSIDE that set still depends on (repeated until stable). The
 * analyzer's own package.json counts as a dependent only for what it names
 * besides the roots.
 */
function exclusiveClosure(graph, roots, ownDeps) {
  const drop = new Set();
  const stack = roots.filter((r) => graph.has(r));
  while (stack.length) {
    const n = stack.pop();
    if (drop.has(n)) continue;
    drop.add(n);
    for (const d of graph.get(n) || []) if (graph.has(d)) stack.push(d);
  }
  let changed = true;
  while (changed) {
    changed = false;
    const needed = new Set(ownDeps.filter((d) => !roots.includes(d)));
    for (const [name, deps] of graph) if (!drop.has(name)) for (const d of deps) needed.add(d);
    for (const n of [...drop]) {
      if (!roots.includes(n) && needed.has(n)) {
        drop.delete(n);
        changed = true;
      }
    }
  }
  return [...drop].sort();
}

/**
 * Prune the deployed analyzer down to what the installed server loads.
 * `keepGrammars`: the tree-sitter grammar files the scanner loads (analyzer
 * parse/treesitter.ts WASM_BY_LANG); every other `tree-sitter-*.wasm` goes.
 */
function pruneShippedServer(analyzerDir, opts) {
  const keepGrammars = new Set((opts && opts.keepGrammars) || []);
  if (keepGrammars.size === 0) throw new Error('pruneShippedServer: keepGrammars is empty; refusing to drop every grammar');
  const removed = [];
  let bytes = 0;
  function size(p) {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of fs.readdirSync(p)) n += size(path.join(p, e));
    return n;
  }
  function drop(p) {
    if (!fs.existsSync(p)) return;
    bytes += size(p);
    removed.push(path.relative(analyzerDir, p).split(path.sep).join('/'));
    fs.rmSync(p, { recursive: true, force: true });
  }

  // 1. The analyzer's sources, tests and the stray tree pnpm deploy leaves.
  for (const rel of ['src', 'test', 'tsconfig.json', 'packages']) drop(path.join(analyzerDir, rel));

  // 2. The unbundled dist: the bundle is what runs.
  const dist = path.join(analyzerDir, 'dist');
  if (!fs.existsSync(path.join(dist, 'sequence-server-entry.cjs')) || !fs.existsSync(path.join(dist, 'sequence-server.cjs'))) {
    throw new Error('pruneShippedServer: dist/ has no server bundle; the unbundled dist would be the only server, so it stays');
  }
  for (const e of fs.readdirSync(dist)) if (!SHIPPED_DIST.has(e)) drop(path.join(dist, e));

  // 3. Grammars the scanner never loads.
  const nm = path.join(analyzerDir, 'node_modules');
  const wasmDir = path.join(nm, '@vscode', 'tree-sitter-wasm', 'wasm');
  if (fs.existsSync(wasmDir)) {
    for (const keep of keepGrammars) {
      if (!fs.existsSync(path.join(wasmDir, keep))) throw new Error(`pruneShippedServer: the scanner loads ${keep}, which the package does not have`);
    }
    for (const e of fs.readdirSync(wasmDir)) {
      if (/^tree-sitter-.+\.wasm$/.test(e) && !keepGrammars.has(e)) drop(path.join(wasmDir, e));
    }
  }

  // 4. Sources inside dependencies.
  drop(path.join(nm, 'zod', 'src'));
  for (const rel of ['deps', 'third_party', 'src']) drop(path.join(nm, 'node-pty', rel));

  // 5. Packages the desktop never loads, and what only they need.
  const own = readDeps(analyzerDir);
  for (const name of exclusiveClosure(packageGraph(nm), UNSHIPPED_PACKAGES, own)) drop(path.join(nm, ...name.split('/')));

  return { removed, bytes };
}

module.exports = { pruneAnalyzerBundle, pruneShippedServer, exclusiveClosure, SHIPPED_DIST };
