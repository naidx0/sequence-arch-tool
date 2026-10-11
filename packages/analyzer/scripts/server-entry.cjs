/* ══════════════════════════════════════════════════════════════════════════
   THE BUNDLED SERVER'S ENTRY, WITH A V8 CODE CACHE
   packages/analyzer/scripts/server-entry.cjs  ->  dist/sequence-server-entry.cjs

   Runs dist/sequence-server.cjs (one esbuild bundle of the CLI and the
   workspace packages; third-party packages stay external) and keeps V8's
   compiled code between launches, so a second launch does not re-parse 2 MB:

     Node 22.1+      module.enableCompileCache(<dir>), then require
     older (Electron 33 runs Node 20.18 as the desktop's server)
                     vm.Script with cachedData, written a few seconds after
                     start so the functions boot compiled are in it

   The cache lives in SEQUENCE_COMPILE_CACHE, else <tmp>/sequence-v8-cache. A
   cache V8 rejects (another build, another Node) is rewritten, never trusted.
   SEQUENCE_COMPILE_CACHE=off disables it. Tests use two more knobs:
   SEQUENCE_COMPILE_CACHE_MODE=cachedData forces the Node 20 path, and
   SEQUENCE_COMPILE_CACHE_DELAY_MS sets when the cache is written (3000).

   process.argv[1] is pointed at the bundle, so the bundle's own "was I run
   directly" check sees itself.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const bundle = path.join(__dirname, 'sequence-server.cjs');
process.argv[1] = bundle;

/* The bundle's import() calls land here (bundle-server.mjs rewrites them to
   `__seqImport`). An import() written in THIS file is an ordinary one, which
   Node 20 refuses inside code compiled by vm.Script. Bare specifiers resolve
   from dist/, the bundle's own folder. */
globalThis.__sequenceImport = (specifier) => import(specifier);

const setting = process.env.SEQUENCE_COMPILE_CACHE;
const cacheDir = setting && setting !== 'off' ? setting : path.join(os.tmpdir(), 'sequence-v8-cache');

function plainRequire() {
  require(bundle);
}

function withCachedData() {
  /* A `#!` line is legal at the top of a file Node loads, not inside the
     function wrapper; it becomes a comment so line numbers stay put. */
  const source = fs.readFileSync(bundle, 'utf8').replace(/^#!/, '//');
  const stat = fs.statSync(bundle);
  /* The key names the build and the engine: a different bundle or a different
     V8 never reads this file. */
  const key = `${process.version}-${stat.size}-${Math.round(stat.mtimeMs)}`.replace(/[^\w.-]/g, '_');
  const cacheFile = path.join(cacheDir, `sequence-server-${key}.bin`);
  let cachedData;
  try {
    cachedData = fs.readFileSync(cacheFile);
  } catch {
    cachedData = undefined;
  }
  const script = new vm.Script(Module.wrap(source), {
    filename: bundle,
    cachedData,
  });
  const fn = script.runInThisContext();
  const mod = new Module(bundle, module);
  mod.filename = bundle;
  mod.paths = Module._nodeModulePaths(path.dirname(bundle));
  const req = Module.createRequire(bundle);
  globalThis.__sequenceCompileCache = { mode: 'cachedData', hit: cachedData !== undefined && !script.cachedDataRejected };
  if (cachedData === undefined || script.cachedDataRejected) {
    const delay = Number(process.env.SEQUENCE_COMPILE_CACHE_DELAY_MS ?? 3000);
    const write = setTimeout(() => {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        const tmp = `${cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, script.createCachedData());
        fs.renameSync(tmp, cacheFile);
      } catch {
        /* A cache that cannot be written costs the next launch a parse, nothing more. */
      }
    }, delay);
    write.unref();
  }
  fn.call(mod.exports, mod.exports, req, mod, bundle, path.dirname(bundle));
}

/* SEQUENCE_COMPILE_CACHE_MODE=cachedData forces the Node 20 path on a newer
   Node, so a test on any Node exercises what the desktop runs. */
const forceCachedData = process.env.SEQUENCE_COMPILE_CACHE_MODE === 'cachedData';

if (setting === 'off') {
  plainRequire();
} else if (!forceCachedData && typeof Module.enableCompileCache === 'function') {
  try {
    Module.enableCompileCache(cacheDir);
  } catch {
    /* no cache, same program */
  }
  globalThis.__sequenceCompileCache = { mode: 'enableCompileCache' };
  plainRequire();
  /* Node writes this cache at a clean exit; the desktop stops its server with
     a kill, so it is flushed once the boot is done instead. */
  if (typeof Module.flushCompileCache === 'function') {
    const flush = setTimeout(() => {
      try {
        Module.flushCompileCache();
      } catch {
        /* the next launch parses again, nothing more */
      }
    }, Number(process.env.SEQUENCE_COMPILE_CACHE_DELAY_MS ?? 3000));
    flush.unref();
  }
} else {
  withCachedData();
}
