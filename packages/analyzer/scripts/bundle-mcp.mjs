#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   SEQUENCE'S BOARD SERVER (packages/mcp) AS ONE FILE FOR THE PACKAGED APP
   packages/analyzer/scripts/bundle-mcp.mjs

   S2a: every agent session Sequence starts gets the board's MCP server
   (analyzer server/sequenceMcp.ts). In the workspace that is
   packages/mcp/dist/server.js; the packaged app has no packages/mcp, so the
   desktop's prepare-server writes this bundle beside the analyzer's:

     <resources>/server/packages/analyzer/dist/sequence-mcp.cjs

   esbuild folds packages/mcp, the MCP SDK and zod, and the @sequence/*
   workspace code into it; the analyzer's own third-party dependencies stay
   external and are required from the deployed analyzer node_modules beside it
   (tree-sitter wasm, graphology, yaml…), exactly as the server bundle does.
   sequenceMcp.ts finds the file there.

   Here (not in packages/mcp) because esbuild is the analyzer's dev dependency;
   adding it to packages/mcp would change the lockfile for one packaging step.
   Reads packages/mcp/dist, so packages/mcp must be built first.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER = path.resolve(here, '..');
const MCP_ENTRY = path.resolve(ANALYZER, '..', 'mcp', 'dist', 'server.js');

/** The analyzer's third-party dependencies (and its workspace packages'): present in the deployed node_modules. */
function analyzerExternals() {
  const out = new Set();
  const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const add = (deps) => {
    for (const d of Object.keys(deps ?? {})) if (!d.startsWith('@sequence/')) out.add(d);
  };
  const pkg = read(path.join(ANALYZER, 'package.json'));
  add(pkg.dependencies);
  for (const d of Object.keys(pkg.dependencies ?? {})) {
    if (!d.startsWith('@sequence/')) continue;
    const p = path.join(ANALYZER, '..', d.slice('@sequence/'.length), 'package.json');
    if (fs.existsSync(p)) add(read(p).dependencies);
  }
  return [...out];
}

/** Write the bundle to `outfile`; answers its size. Throws when packages/mcp is not built or esbuild warns. */
export async function bundleMcp(outfile) {
  if (!fs.existsSync(MCP_ENTRY)) throw new Error(`packages/mcp is not built (${MCP_ENTRY} missing)`);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const result = await esbuild.build({
    entryPoints: [MCP_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    external: analyzerExternals(),
    /* server.js runs main() only when it is the entry (import.meta.url vs argv[1]); the bundle is. */
    define: { 'import.meta.url': '__seqImportMetaUrl' },
    banner: { js: "const __seqImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
    logLevel: 'silent',
    legalComments: 'none',
  });
  if (result.warnings.length > 0) {
    throw new Error(`bundle-mcp: ${result.warnings.map((w) => `${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ''}`).join('; ')}`);
  }
  return fs.statSync(outfile).size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(ANALYZER, 'dist', 'sequence-mcp.cjs'));
  const bytes = await bundleMcp(out);
  console.log(`bundle-mcp: packages/mcp -> ${out} (${Math.round(bytes / 1024)} KB)`);
}
