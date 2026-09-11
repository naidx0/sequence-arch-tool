#!/usr/bin/env node
// prepare-server — assemble the self-contained server bundle that the packaged
// desktop app spawns as a child process.
//
// The Electron app does NOT import the analyzer; it runs `analyzer/dist/cli.js`
// as a child Node process. So the packaged app must ship a working `cli.js` PLUS
// a real (de-symlinked) node_modules and the web dist. In a pnpm workspace the
// analyzer's deps — including the `workspace:*` packages @sequence/schema and
// @sequence/export — are symlinks, which electron-builder cannot follow reliably.
// `pnpm deploy` resolves that: it produces a folder with real, flattened deps.
//
// Output layout (consumed by electron-builder.yml `extraResources` and by
// src/main.ts `serverPaths()`):
//
//   server-bundle/
//     packages/
//       analyzer/            <- `pnpm deploy` output (dist + real node_modules)
//         dist/cli.js
//         node_modules/...
//       web2/
//         dist/              <- copied web2 viewer build (`packages/web` is gone)
//
// RUN AND FIXED ON WINDOWS. This step was broken on the one platform the
// installer config targets, in two different ways, and both failures blamed
// the user's pnpm install rather than this file. See README → "The two things
// that were actually broken". The platform branch is locked by
// tools/ci/desktop-packaging.test.mjs.
//
// It is intentionally NOT part of `pnpm build` / `pnpm test` — only `pnpm dist`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pnpmInvocation } from './pnpm-invocation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(here, '..'); // packages/desktop
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..', '..');
const BUNDLE = path.join(DESKTOP_DIR, 'server-bundle');
const ANALYZER_OUT = path.join(BUNDLE, 'packages', 'analyzer');
const WEB_OUT = path.join(BUNDLE, 'packages', 'web2', 'dist');

const WEB_DIST_SRC = path.join(REPO_ROOT, 'packages', 'web2', 'dist');
const ANALYZER_DIST_SRC = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist');

function log(msg) {
  console.log(`[prepare-server] ${msg}`);
}

function fail(msg) {
  console.error(`[prepare-server] ERROR: ${msg}`);
  process.exit(1);
}

// 1. Preconditions: the workspace must be built first.
if (!fs.existsSync(path.join(ANALYZER_DIST_SRC, 'cli.js'))) {
  fail(`analyzer is not built (${path.join(ANALYZER_DIST_SRC, 'cli.js')} missing). Run \`pnpm build\` first.`);
}
if (!fs.existsSync(path.join(WEB_DIST_SRC, 'index.html'))) {
  fail(`web viewer is not built (${path.join(WEB_DIST_SRC, 'index.html')} missing). Run \`pnpm build\` first.`);
}

// 2. Clean slate.
log(`cleaning ${BUNDLE}`);
fs.rmSync(BUNDLE, { recursive: true, force: true });
fs.mkdirSync(path.dirname(ANALYZER_OUT), { recursive: true });

// 3. `pnpm deploy` the analyzer into the bundle with real, flattened deps.
//    Run from the workspace root; target must be empty/nonexistent.
//
//    TWO ATTEMPTS, AND THE SECOND ONE IS NOT A GUESS. pnpm 10 refuses to deploy
//    from a workspace that has not opted into injected dependencies:
//
//      ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE — "By default, starting from pnpm
//      v10, we only deploy from workspaces that have inject-workspace-packages
//      =true set … run with the --legacy flag or set force-legacy-deploy"
//
//    Measured on a real machine; it is what stopped packaging after the Windows
//    spawn fix. `--legacy` is taken rather than `inject-workspace-packages`
//    because the latter is an .npmrc setting that changes how EVERY install in
//    this workspace links its local packages — a repo-wide change to fix one
//    packaging step. The flag is scoped to this command and produces exactly
//    what the bundle needs: a flattened, real node_modules.
//
//    The plain form is still tried FIRST, so a workspace that later opts in
//    stops needing the fallback without anybody editing this file.
log('running `pnpm deploy` for @sequence/analyzer (real node_modules)…');

function deploy(extraFlags) {
  const run = pnpmInvocation(process.platform, [
    '--filter',
    '@sequence/analyzer',
    'deploy',
    '--prod',
    ...extraFlags,
    ANALYZER_OUT,
  ]);
  return execFileSync(run.command, run.args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: run.shell,
    encoding: 'utf8',
  });
}

/** Everything pnpm said, however it said it — the detail is in stderr. */
function saidBy(e) {
  return [e.message, e.stdout, e.stderr].filter(Boolean).join('\n');
}

try {
  deploy([]);
} catch (first) {
  const said = saidBy(first);
  if (!said.includes('ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE')) {
    fail(
      'pnpm deploy failed. This step needs pnpm 10 and a populated store.\n' +
        '  Try: `pnpm install` then re-run.\n' +
        `  Underlying error: ${said}`
    );
  }
  log('this pnpm requires --legacy for a non-injected workspace; retrying…');
  /* The target must be empty for a second attempt — the refused one may have
     left a partial tree behind, and `pnpm deploy` will not write into it. */
  fs.rmSync(ANALYZER_OUT, { recursive: true, force: true });
  try {
    deploy(['--legacy']);
  } catch (second) {
    fail(
      'pnpm deploy failed even with --legacy.\n' +
        '  Try: `pnpm install` then re-run.\n' +
        `  Underlying error: ${saidBy(second)}`
    );
  }
}

if (!fs.existsSync(path.join(ANALYZER_OUT, 'dist', 'cli.js'))) {
  fail(`deploy did not produce ${path.join(ANALYZER_OUT, 'dist', 'cli.js')} — inspect the deploy output.`);
}
if (!fs.existsSync(path.join(ANALYZER_OUT, 'node_modules'))) {
  fail('deploy did not produce a node_modules in the analyzer bundle — the child process would have no deps.');
}

// 4. Copy the web viewer dist alongside (findWebDist resolves `../web2/dist`, and
//    main.ts also passes it explicitly as --web).
log(`copying web dist → ${WEB_OUT}`);
fs.mkdirSync(WEB_OUT, { recursive: true });
fs.cpSync(WEB_DIST_SRC, WEB_OUT, { recursive: true });

log(`done. server bundle ready at ${BUNDLE}`);
log('  analyzer: ' + path.join(ANALYZER_OUT, 'dist', 'cli.js'));
log('  web:      ' + path.join(WEB_OUT, 'index.html'));
