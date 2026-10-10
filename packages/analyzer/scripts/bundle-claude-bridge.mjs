#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE CLAUDE BRIDGE: A SMALL LAUNCHER ALWAYS, THE FULL BUNDLE ONLY ON A FLAG
   packages/analyzer/scripts/bundle-claude-bridge.mjs

   Sequence drives Claude Code through @agentclientprotocol/claude-agent-acp. Its
   dependency closure includes Anthropic's Agent SDK ("All rights reserved"), so by
   default the installer does NOT carry it: the app downloads the pinned closure on
   first use (src/server/claudeBridgeInstall.ts) and starts it through

     dist/claude-agent-acp-launch.mjs   our code only (bundleLauncher), always built.

   SEQUENCE_BUNDLE_CLAUDE_BRIDGE=1 additionally folds bridge + SDK JS (about 2 MB; the SDK's
   native binaries are not needed because the bridge runs the person's own `claude`) into
     dist/claude-agent-acp.mjs          (bundleClaudeBridge), with third-party notices
     dist/claude-agent-acp.LICENSE.txt  generated from what esbuild actually folded in.
   Use that flag only once the redistribution terms are settled.

   The name claude-agent-acp matters: `agentKindOf` (acp) reads it in a launch as the Claude bridge.
   ESM because the bridge uses top-level await; a createRequire banner serves CommonJS dependencies.
   Run after `tsc` (entries import dist/server/claudeBoot.js).
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER = path.resolve(here, '..');
export const BRIDGE_FILE = 'claude-agent-acp.mjs';
export const LAUNCHER_FILE = 'claude-agent-acp-launch.mjs';
const BANNER = "import { createRequire as __seqCreateRequire } from 'node:module'; const require = __seqCreateRequire(import.meta.url);";

function common(entry, outfile) {
  if (!fs.existsSync(path.join(ANALYZER, 'dist', 'server', 'claudeBoot.js'))) throw new Error('packages/analyzer is not compiled (dist/server/claudeBoot.js missing); run tsc first');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  return { entryPoints: [entry], bundle: true, platform: 'node', target: 'node20', format: 'esm', outfile, minify: true, legalComments: 'none', logLevel: 'silent', metafile: true, banner: { js: BANNER } };
}

function noWarnings(result, who) {
  if (result.warnings.length > 0) throw new Error(`${who}: ${result.warnings.map((w) => `${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ''}`).join('; ')}`);
}

/** Package roots (dir holding the package.json) of every node_modules input in an esbuild metafile. */
export function bundledPackageDirs(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const abs = path.resolve(ANALYZER, input);
    if (!abs.split(path.sep).includes('node_modules')) continue;
    for (let d = path.dirname(abs); d !== path.dirname(d); d = path.dirname(d)) {
      if (path.basename(path.dirname(d)) === 'node_modules' || path.basename(path.dirname(d)).startsWith('@') && path.basename(path.dirname(path.dirname(d))) === 'node_modules') {
        if (fs.existsSync(path.join(d, 'package.json'))) dirs.add(d);
        break;
      }
    }
  }
  return [...dirs].sort();
}

/** One notice per bundled package: name, version, licence id, and the licence file's text verbatim. */
export function thirdPartyNotices(metafile) {
  const parts = ['Third-party software folded into claude-agent-acp.mjs. Each package is listed with the licence text it ships.\n'];
  for (const dir of bundledPackageDirs(metafile)) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const lic = fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying|notice)/i.test(f));
    const text = lic ? fs.readFileSync(path.join(dir, lic), 'utf8') : null;
    const id = typeof meta.license === 'string' ? meta.license : meta.license?.type ?? 'see package';
    const own = /@anthropic-ai\/claude-agent-sdk$/.test(meta.name) ? '\nNOTE: the Claude Agent SDK is (c) Anthropic PBC, all rights reserved, used under Anthropic\'s Commercial Terms. Redistribution needs Anthropic\'s agreement.\n' : '';
    parts.push(`==== ${meta.name}@${meta.version} (${id}) ====${own}\n${text ?? '(this package ships no licence file; see its package.json and repository)'}\n`);
  }
  return parts.join('\n');
}

/** dist/claude-agent-acp-launch.mjs: our launcher only, nothing third-party. Answers its size in bytes. */
export async function bundleLauncher(outfile) {
  const result = await esbuild.build(common(path.join(here, 'claude-launch-entry.mjs'), outfile));
  noWarnings(result, 'bundle-claude-launcher');
  const foreign = bundledPackageDirs(result.metafile);
  if (foreign.length) throw new Error(`the launcher must hold only our code, but folded in: ${foreign.join(', ')}`);
  return fs.statSync(outfile).size;
}

/** Write the FULL bridge bundle (flag builds only) and its generated notices; answers its size in bytes. */
export async function bundleClaudeBridge(outfile) {
  const result = await esbuild.build(common(path.join(here, 'claude-bridge-entry.mjs'), outfile));
  noWarnings(result, 'bundle-claude-bridge');
  fs.writeFileSync(outfile.replace(/\.mjs$/, '.LICENSE.txt'), thirdPartyNotices(result.metafile));
  return fs.statSync(outfile).size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.join(ANALYZER, 'dist');
  const l = await bundleLauncher(path.join(dist, LAUNCHER_FILE));
  console.log(`bundle-claude-bridge: launcher -> dist/${LAUNCHER_FILE} (${(l / 1024).toFixed(1)} KB)`);
  if (process.env.SEQUENCE_BUNDLE_CLAUDE_BRIDGE === '1') {
    const bytes = await bundleClaudeBridge(path.join(dist, BRIDGE_FILE));
    console.log(`bundle-claude-bridge: FULL bridge -> dist/${BRIDGE_FILE} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    fs.rmSync(path.join(dist, BRIDGE_FILE), { force: true });
    fs.rmSync(path.join(dist, BRIDGE_FILE.replace(/\.mjs$/, '.LICENSE.txt')), { force: true });
    console.log('bundle-claude-bridge: full bridge not bundled (SEQUENCE_BUNDLE_CLAUDE_BRIDGE=1 to bundle); it is downloaded on first use');
  }
}
