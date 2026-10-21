#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   ONE FILE FOR THE SERVER'S START
   packages/analyzer/scripts/bundle-server.mjs

   Node resolving and evaluating ~235 ESM modules is most of the server's
   start before it does any work (bootMarks `modulesLoaded`). esbuild folds the
   CLI and the @sequence/* workspace packages into dist/sequence-server.cjs;
   every third-party package stays external and is required from node_modules
   as before, so native modules (node-pty), wasm (tree-sitter) and their own
   asset lookups are untouched.

   CommonJS, not ESM, so dist/sequence-server-entry.cjs can compile it through
   vm.Script with V8 cachedData on Electron's Node 20, which has no
   module.enableCompileCache.

   THE PATHS THIS MOVES, CHECKED:
     import.meta.url   defined as the bundle's own file URL, so
                       createRequire(import.meta.url) resolves externals from
                       dist/, and findWebDist walks up from dist/ to
                       packages/web2/dist exactly as from dist/server/.
     tree-sitter wasm  located by require.resolve of its package, external,
                       so the .wasm files are read from node_modules.
     "run directly"    the CLI compares import.meta.url with argv[1]; the
                       entry sets argv[1] to the bundle.
   server-bundle.test.ts boots the bundle on a temp copy of a fixture and
   checks all three.

   Runs after `tsc` in the analyzer build; reads dist/, not src/.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, '..');
const DIST = path.join(PKG, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

/** Every non-workspace dependency, and the workspace packages' own third-party deps. */
function externals() {
  const out = new Set();
  const add = (deps) => {
    for (const d of Object.keys(deps ?? {})) {
      if (!d.startsWith('@sequence/')) out.add(d);
    }
  };
  add(pkg.dependencies);
  for (const d of Object.keys(pkg.dependencies ?? {})) {
    if (!d.startsWith('@sequence/')) continue;
    const p = path.join(PKG, '..', d.slice('@sequence/'.length), 'package.json');
    if (fs.existsSync(p)) add(JSON.parse(fs.readFileSync(p, 'utf8')).dependencies);
  }
  return [...out];
}

const outfile = path.join(DIST, 'sequence-server.cjs');
const result = await esbuild.build({
  entryPoints: [path.join(DIST, 'cli.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile,
  external: externals(),
  define: { 'import.meta.url': '__seqImportMetaUrl' },
  banner: { js: "const __seqImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'silent',
  metafile: true,
  legalComments: 'none',
});

/* An import.meta the define did not cover is emptied in CommonJS, which would
   be `undefined.dirname` at runtime. esbuild says so as a warning; any warning
   fails the build. */
if (result.warnings.length > 0) {
  for (const w of result.warnings) console.error(`bundle-server: ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ''}`);
  process.exit(1);
}
/* DYNAMIC IMPORTS GO THROUGH THE ENTRY. Code compiled by vm.Script cannot call
   import() on Node 20 without --experimental-vm-modules ("A dynamic import
   callback was invoked without --experimental-vm-modules"), and tree-sitter,
   the ACP SDK, node-pty and pg are all loaded that way. So each `import(` in
   the output calls `__seqImport`, which the entry defines as an import() made
   from its own, normally loaded, file. */
let text = fs.readFileSync(outfile, 'utf8');
let rewritten = 0;
text = text.replace(/(?<![\w$.])import\(/g, () => {
  rewritten += 1;
  return '__seqImport(';
});
text = text.replace(
  "const __seqImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  "const __seqImportMetaUrl = require('node:url').pathToFileURL(__filename).href;\nconst __seqImport = globalThis.__sequenceImport || ((s) => import(s));",
);
if (!text.includes('const __seqImport =')) {
  console.error('bundle-server: the banner was not found, so __seqImport is undefined');
  process.exit(1);
}
fs.writeFileSync(outfile, text);

/* Review B: the HTML converter worker, as one file BESIDE the bundle
   (netFetch htmlWorkerFile looks there), so a packaged build runs it in a
   worker with its hard timeout rather than in-process. */
await esbuild.build({
  entryPoints: [path.join(DIST, 'server', 'htmlMarkdownWorker.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(DIST, 'sequence-html-worker.cjs'),
  external: externals(),
  logLevel: 'silent',
  legalComments: 'none',
});
/* 0.1.9 2B-1: the scan worker, one file BESIDE the bundle (scan/scanRunner
   scanWorkerFile looks there). A worker thread loads it as an ordinary CommonJS
   file, so unlike the server bundle its dynamic imports stay `import()`; it
   still needs import.meta.url defined (tree-sitter's wasm is located from it).
   tree-sitter and graphology stay external, so the wasm is read from node_modules. */
const workerBuild = await esbuild.build({
  entryPoints: [path.join(DIST, 'scan', 'scanWorker.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(DIST, 'sequence-scan-worker.cjs'),
  external: externals(),
  define: { 'import.meta.url': '__seqImportMetaUrl' },
  banner: { js: "const __seqImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'silent',
  legalComments: 'none',
});
if (workerBuild.warnings.length > 0) {
  for (const w of workerBuild.warnings) console.error(`bundle-server: scan worker: ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ''}`);
  process.exit(1);
}
fs.copyFileSync(path.join(here, 'server-entry.cjs'), path.join(DIST, 'sequence-server-entry.cjs'));
const inputs = Object.keys(result.metafile.inputs).length;
console.log(`bundle-server: ${inputs} modules -> dist/sequence-server.cjs (${Math.round(text.length / 1024)} KB, ${rewritten} dynamic imports routed through the entry)`);
