#!/usr/bin/env node
/**
 * Build the single-file Sequence CLI that the Claw-SWE-Bench adapter mounts.
 *
 *   node tools/bench/claw/build-bundle.mjs [outDir]      (default: ./seqbundle)
 *
 * WHY A BUNDLE AND NOT THE CHECKOUT. A pnpm workspace resolves through a symlink
 * farm rooted at absolute host paths. Bind-mounted into a Linux container from a
 * Windows or macOS host, those links do not resolve and the CLI dies at
 * "Cannot find package '@sequence/schema'" before it reads a line of the repo.
 * `pnpm deploy` does not help: it emits the same absolute symlinks, and
 * dereferencing them flattens the nested layout pnpm needs, which then fails one
 * level deeper on a transitive dependency.
 *
 * So: one esbuild bundle (~2.4 MB), plus the handful of packages that are
 * require()d at RUNTIME and therefore cannot be inlined — cluster.ts loads
 * graphology through createRequire for CJS/ESM interop, and the parser loads its
 * tree-sitter wasm the same way. Those are copied next to the bundle.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '../../..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'seqbundle'));

/* Required at runtime rather than imported, so esbuild cannot inline them. */
const RUNTIME_REQUIRED = [
  'graphology',
  'graphology-communities-louvain',
  'graphology-utils',
  'graphology-indices',
  'obliterator',
  'mnemonist',
  'events',
  'pandemonium',
  '@vscode/tree-sitter-wasm',
];

const esbuildDir = fs
  .readdirSync(path.join(REPO, 'node_modules/.pnpm'))
  .find((d) => d.startsWith('esbuild@'));
if (!esbuildDir) throw new Error('esbuild not found in the pnpm store — run pnpm install');
/* pathToFileURL, because a bare `C:\…` absolute path is not a URL on Windows
   and dynamic import() refuses it with ERR_UNSUPPORTED_ESM_URL_SCHEME. */
const esbuild = await import(
  pathToFileURL(
    path.join(REPO, 'node_modules/.pnpm', esbuildDir, 'node_modules/esbuild/lib/main.js'),
  ).href
);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'node_modules'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(REPO, 'packages/analyzer/dist/cli.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(OUT, 'sequence-cli.mjs'),
  /* Native and optional: the ask path loads these lazily or never, and inlining a
     .node binary would pin the bundle to one OS. */
  external: ['node-pty', 'better-sqlite3', 'fsevents', '@napi-rs/*'],
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: 'warning',
});

for (const pkg of RUNTIME_REQUIRED) {
  const hit = fs
    .readdirSync(path.join(REPO, 'node_modules/.pnpm'))
    .map((d) => path.join(REPO, 'node_modules/.pnpm', d, 'node_modules', pkg))
    .find((p) => fs.existsSync(p));
  if (!hit) {
    console.warn(`  ! ${pkg} not found in the store — the bundle may fail at runtime`);
    continue;
  }
  fs.cpSync(hit, path.join(OUT, 'node_modules', pkg), { recursive: true, dereference: true });
}

const bytes = fs.statSync(path.join(OUT, 'sequence-cli.mjs')).size;
console.log(`bundle: ${OUT}/sequence-cli.mjs  (${bytes.toLocaleString()} bytes)`);
console.log(`runtime packages: ${RUNTIME_REQUIRED.length}`);
console.log('');
console.log('Verify it runs on linux/amd64 before benchmarking:');
console.log(`  docker run --rm -v <node>:/opt/n:ro -v ${OUT}:/opt/s:ro debian:bookworm-slim \\`);
console.log('    /opt/n/bin/node /opt/s/sequence-cli.mjs --help');
