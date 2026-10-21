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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildInfoVersion } from './build-info-version.mjs';

import { pnpmInvocation } from './pnpm-invocation.mjs';
import { createRequire } from 'node:module';

const { pruneAnalyzerBundle, pruneShippedServer } = createRequire(import.meta.url)('./prune-bundle.cjs');

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

// HOISTED, NOT SYMLINKED, AND THIS IS THE LINE THAT MADE THE INSTALLED APP
// START. Measured 2026-09-12 on the first install from a fresh build: the
// unpacked app ran, the installed one died on boot with
//
//   ERR_MODULE_NOT_FOUND: Cannot find package '@agentclientprotocol/sdk'
//   imported from .../node_modules/@sequence/acp/dist/client.js
//
// pnpm's default layout puts every package under node_modules/.pnpm/<id>/
// node_modules/ with its dependencies as SIBLINGS, and links node_modules/
// @sequence/acp to it. Node resolves a symlink to its real path, so from the
// real path the sibling sdk is found. The NSIS installer does not carry
// symlinks: it packs @sequence/acp as a plain directory copy, and from THAT
// path the sibling does not exist. `node-linker=hoisted` makes deploy write a
// flat, real node_modules with no links at all, which survives any copy.
// The isolation check below is what proves it, by copying the bundle the way
// an installer would and booting it from outside the repository.
const HOISTED = '--config.node-linker=hoisted';

function deploy(extraFlags) {
  const run = pnpmInvocation(process.platform, [
    '--filter',
    '@sequence/analyzer',
    'deploy',
    '--prod',
    HOISTED,
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

if (!fs.existsSync(path.join(ANALYZER_OUT, 'dist', 'sequence-server-entry.cjs'))) {
  fail(`deploy did not produce ${path.join(ANALYZER_OUT, 'dist', 'sequence-server-entry.cjs')} — run \`pnpm --filter @sequence/analyzer build\` and inspect the deploy output.`);
}
if (!fs.existsSync(path.join(ANALYZER_OUT, 'node_modules'))) {
  fail('deploy did not produce a node_modules in the analyzer bundle — the child process would have no deps.');
}
/* Bundled components (packages/analyzer/components) are data the server reads at
   runtime via bundledCatalogRoot(); a deploy that drops them ships an empty catalog. */
if (!fs.existsSync(path.join(ANALYZER_OUT, 'components', 'groups.json'))) {
  fail(`deploy did not carry packages/analyzer/components into ${ANALYZER_OUT} — the app would ship no components.`);
}
/* Built-in skills (packages/analyzer/builtin-skills, e.g. be-ambitious) are data the server reads at runtime via
   builtinSkillsRoot(); a deploy that drops them ships an app whose built-in skills are missing. */
if (!fs.existsSync(path.join(ANALYZER_OUT, 'builtin-skills', 'be-ambitious', 'SKILL.md'))) {
  fail(`deploy did not carry packages/analyzer/builtin-skills into ${ANALYZER_OUT} — the app would ship no built-in skills.`);
}
/* A four-part release (v0.1.7.1) writes its build number to packages/analyzer/app-build.json
   (release.yml). It is untracked, so copy it explicitly; absent means build 0. */
const APP_BUILD = path.join(REPO_ROOT, 'packages', 'analyzer', 'app-build.json');
if (fs.existsSync(APP_BUILD)) {
  fs.copyFileSync(APP_BUILD, path.join(ANALYZER_OUT, 'app-build.json'));
  log(`copied app-build.json (${fs.readFileSync(APP_BUILD, 'utf8').trim()})`);
}

// 3b. THE BUNDLE MUST BOOT FROM OUTSIDE THE REPOSITORY, WITH EVERY LINK
//     FLATTENED. This is the shape the installer ships and the shape the smoke
//     test cannot see: `release/win-unpacked` keeps pnpm's symlinks, so Node
//     resolves through them and the unpacked app runs even when the installed
//     one cannot. Copying with `dereference: true` into the OS temp dir does
//     to the bundle exactly what NSIS does, and then the analyzer's CLI has to
//     answer `--help` from there or packaging stops here.
import os from 'node:os';
import { spawnSync } from 'node:child_process';
{
  // ── .bin IS DELETED, NOT EXEMPTED ──────────────────────────────────────
  //
  // MEASURED ON A macOS RUNNER, 2026-09-20, cutting 0.1.1: the very first mac
  // build this project ever ran died here —
  //
  //   ERROR: the analyzer bundle still contains 1 symlink(s) ...
  //   First: .../node_modules/.bin/yaml
  //
  // and it had never fired on Windows because pnpm writes `.bin` entries as
  // `.CMD`/`.ps1` FILES there and as SYMLINKS everywhere else. A guard that
  // can only fail on the platform the project does not build on is a guard
  // that ships broken releases.
  //
  // The guard is right and its reason is narrower than its rule. Its reason is
  // MODULE RESOLUTION — "an installer flattens them and resolution breaks" —
  // and `.bin` plays no part in module resolution: Node never looks there to
  // resolve an import. So exempting the directory would have been correct and
  // would have left a directory of shims that are broken the moment an
  // installer flattens them.
  //
  // Deleting it is better, because then the guard's claim is simply TRUE. The
  // packaged app spawns `node cli.js` and nothing else; nothing in
  // `packages/analyzer/src` references `node_modules/.bin`, and any tool the
  // server does shell out to (git, for one) comes from PATH. A shim nobody
  // execs is weight, and weight that breaks silently is worse than weight.
  const binDir = path.join(ANALYZER_OUT, 'node_modules', '.bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
    log('removed node_modules/.bin — command shims, not resolvable packages');
  }

  /* What the packaged app never runs: debug symbols, other platforms' native
     prebuilds, source maps, type declarations, compiled tests. See
     prune-bundle.cjs. Done BEFORE the isolation boot below, so that boot is
     the proof nothing the server needs went with them. */
  const pruned = pruneAnalyzerBundle(ANALYZER_OUT);
  log(`pruned ${pruned.removed.length} non-runtime entries (${(pruned.bytes / 1e6).toFixed(1)} MB)`);
  /* 0.1.8.1 D2: sources, the unbundled dist (the bundle runs), unused grammars,
     dependency sources, pg. The grammar list is the scanner's own table. */
  const { LOADED_GRAMMARS } = await import(pathToFileURL(path.join(ANALYZER_DIST_SRC, 'parse', 'treesitter.js')).href);
  const shipped = pruneShippedServer(ANALYZER_OUT, { keepGrammars: [...LOADED_GRAMMARS] });
  log(`pruned ${shipped.removed.length} entries the installed server never loads (${(shipped.bytes / 1e6).toFixed(1)} MB): ${shipped.removed.join(', ')}`);

  const links = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) links.push(p);
      else if (e.isDirectory()) walk(p);
    }
  })(path.join(ANALYZER_OUT, 'node_modules'));
  if (links.length) {
    fail(`the analyzer bundle still contains ${links.length} symlink(s); an installer flattens them and resolution breaks. First: ${links[0]}`);
  }
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-bundle-probe-'));
  fs.cpSync(ANALYZER_OUT, path.join(probe, 'analyzer'), { recursive: true, dereference: true });
  /* The entry the desktop runs (D2: the unbundled dist/cli.js is not shipped). */
  const r = spawnSync(process.execPath, [path.join(probe, 'analyzer', 'dist', 'sequence-server-entry.cjs'), '--help'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  fs.rmSync(probe, { recursive: true, force: true });
  if (r.status !== 0) {
    fail(
      [
        'the analyzer bundle does not boot once copied out of the repository, which is what the installed app is:',
        r.stderr || r.stdout || String(r.error),
      ].join(os.EOL),
    );
  }
  log('bundle boots in isolation (copied out of the repo, symlinks flattened): ok');
}

// 3c. THE BOARD'S MCP SERVER GOES WITH IT (S2a). Every agent session the app
//     starts gets Sequence's own MCP server (analyzer server/sequenceMcp.ts);
//     the installed app has no packages/mcp, so it ships as one file beside
//     the analyzer's bundle, its third-party needs met by the analyzer's own
//     node_modules above. Booted from the installed shape in step 5.
{
  const MCP_OUT = path.join(ANALYZER_OUT, 'dist', 'sequence-mcp.cjs');
  if (!fs.existsSync(path.join(REPO_ROOT, 'packages', 'mcp', 'dist', 'server.js'))) {
    fail('packages/mcp is not built (packages/mcp/dist/server.js missing). Run `pnpm build` first.');
  }
  const { bundleMcp } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'scripts', 'bundle-mcp.mjs')).href);
  const bytes = await bundleMcp(MCP_OUT);
  log(`board MCP server bundled → ${MCP_OUT} (${Math.round(bytes / 1024)} KB)`);
}

// 3d. THE CLAUDE BRIDGE. Claude Code is driven over ACP through claude-agent-acp, whose dependency closure
//     includes Anthropic's Agent SDK (all rights reserved). So by default the installer carries only our
//     4 KB launcher (dist/claude-agent-acp-launch.mjs); the app downloads the pinned, checksummed bridge into
//     the user-data folder on first use (analyzer src/server/claudeBridgeInstall.ts).
//     SEQUENCE_BUNDLE_CLAUDE_BRIDGE=1 ALSO folds the bridge + SDK JS (about 2 MB) into the installer, with
//     generated third-party notices; leave it off until the redistribution terms are settled.
const BUNDLE_BRIDGE = process.env.SEQUENCE_BUNDLE_CLAUDE_BRIDGE === '1';
{
  const { bundleLauncher, bundleClaudeBridge } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'scripts', 'bundle-claude-bridge.mjs')).href);
  const launcherBytes = await bundleLauncher(path.join(ANALYZER_OUT, 'dist', 'claude-agent-acp-launch.mjs'));
  log(`Claude bridge launcher → dist/claude-agent-acp-launch.mjs (${(launcherBytes / 1024).toFixed(1)} KB)`);
  if (BUNDLE_BRIDGE) {
    const bytes = await bundleClaudeBridge(path.join(ANALYZER_OUT, 'dist', 'claude-agent-acp.mjs'));
    log(`Claude bridge BUNDLED (SEQUENCE_BUNDLE_CLAUDE_BRIDGE=1) → dist/claude-agent-acp.mjs (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    fs.rmSync(path.join(ANALYZER_OUT, 'dist', 'claude-agent-acp.mjs'), { force: true });
    fs.rmSync(path.join(ANALYZER_OUT, 'dist', 'claude-agent-acp.LICENSE.txt'), { force: true });
    log('Claude bridge not bundled: downloaded on first use');
  }
}

// 4. Copy the web viewer dist alongside (findWebDist resolves `../web2/dist`, and
//    main.ts also passes it explicitly as --web).
log(`copying web dist → ${WEB_OUT}`);
fs.mkdirSync(WEB_OUT, { recursive: true });
fs.cpSync(WEB_DIST_SRC, WEB_OUT, { recursive: true });

// 4b. WHAT THE SETTINGS PAGE SHOWS ABOUT THIS BUILD (G7). `build-info.json` says which commit
//     the bundle was made from (an installed app has no git), and docs/releases/*.md are the
//     release notes the "What's new" list reads; the server finds both at the bundle root
//     (analyzer/src/server/appUpdate.ts).
{
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    commit = null;
  }
  /* The release workflow's app-build.json supplies the fourth part while package.json stays semver.
     An explicit sequenceVersion still takes precedence when a package provides one. */
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
  let appBuild = null;
  try {
    appBuild = JSON.parse(fs.readFileSync(APP_BUILD, 'utf8'));
  } catch {
    /* Development builds and three-part releases may have no app-build.json. */
  }
  const version = buildInfoVersion(pkg, appBuild);
  fs.writeFileSync(path.join(BUNDLE, 'build-info.json'), JSON.stringify({ version, commit, builtAt: new Date().toISOString() }));
  const notes = path.join(REPO_ROOT, 'docs', 'releases');
  if (fs.existsSync(notes)) {
    fs.mkdirSync(path.join(BUNDLE, 'docs'), { recursive: true });
    fs.cpSync(notes, path.join(BUNDLE, 'docs', 'releases'), { recursive: true });
  }
  log(`build-info.json: ${version} ${commit ?? '(no git)'}; release notes copied`);
}

// 5. THE BUNDLED SERVER SERVES FROM THE INSTALLED SHAPE. main.ts runs
//    dist/sequence-server-entry.cjs (one esbuild bundle, V8 code cache) when it
//    is there. Copied out of the repository with links flattened, booted with
//    Electron's own Node when this machine has it (that is the Node the app
//    runs it with), it must attach and scan a fixture (tree-sitter wasm via a
//    routed dynamic import), have required graphology, serve the web app's
//    index.html, and write its V8 cache. See analyzer scripts/check-server-bundle.mjs.
{
  const entry = path.join(ANALYZER_OUT, 'dist', 'sequence-server-entry.cjs');
  if (!fs.existsSync(entry)) {
    fail(`the analyzer build did not write ${entry}; run \`pnpm --filter @sequence/analyzer build\` (tsc, then scripts/bundle-server.mjs).`);
  }
  const { checkServerBundle } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'scripts', 'check-server-bundle.mjs')).href
  );
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-server-probe-'));
  fs.cpSync(BUNDLE, probe, { recursive: true, dereference: true });
  const pathTxt = path.join(DESKTOP_DIR, 'node_modules', 'electron', 'path.txt');
  const electronBin = fs.existsSync(pathTxt)
    ? path.join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', fs.readFileSync(pathTxt, 'utf8').trim())
    : null;
  const useElectron = electronBin !== null && fs.existsSync(electronBin);
  const cacheDir = path.join(probe, 'v8-cache');
  const r = await checkServerBundle({
    entry: path.join(probe, 'packages', 'analyzer', 'dist', 'sequence-server-entry.cjs'),
    webDist: path.join(probe, 'packages', 'web2', 'dist'),
    fixture: path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront'),
    nodeBin: useElectron ? electronBin : process.execPath,
    env: useElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
    cacheDir,
  });
  /* S2a: the board server, from the same copied-out shape and Node: started
     once as a session would start it, it lists its tools and answers map. */
  const { checkMcpBundle } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'scripts', 'check-mcp-bundle.mjs')).href);
  const mcpRepo = path.join(probe, 'mcp-fixture');
  fs.cpSync(path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront'), mcpRepo, { recursive: true });
  const m = await checkMcpBundle({
    entry: path.join(probe, 'packages', 'analyzer', 'dist', 'sequence-mcp.cjs'),
    repo: mcpRepo,
    nodeBin: useElectron ? electronBin : process.execPath,
    env: useElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  });
  /* The Claude bridge, from the same copied-out shape and Node: the launcher starts the workspace's own
     (devDependency) bridge, which must answer initialize and, on session/new, run a fake `claude` that
     sees CLAUDE_CODE_EXECUTABLE and NOT ELECTRON_RUN_AS_NODE. The full bundle gets the same check when built. */
  const { checkClaudeBridge, bridgeCheckProblem } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'scripts', 'check-claude-bridge.mjs')).href);
  const bridgeEntry = path.join(REPO_ROOT, 'packages', 'analyzer', 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js');
  const nodeFor = { nodeBin: useElectron ? electronBin : process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  const bridgeProblems = [];
  const l = await checkClaudeBridge({ ...nodeFor, args: [path.join(probe, 'packages', 'analyzer', 'dist', 'claude-agent-acp-launch.mjs'), bridgeEntry] });
  const lp = bridgeCheckProblem(l);
  if (lp) bridgeProblems.push(`launcher: ${lp}`);
  if (BUNDLE_BRIDGE) {
    const f = await checkClaudeBridge({ ...nodeFor, entry: path.join(probe, 'packages', 'analyzer', 'dist', 'claude-agent-acp.mjs') });
    const fp = bridgeCheckProblem(f);
    if (fp) bridgeProblems.push(`bundle: ${fp}`);
  }
  fs.rmSync(probe, { recursive: true, force: true });
  if (bridgeProblems.length) fail(`the Claude bridge does not start from the installed shape: ${bridgeProblems.join(' | ')}\n${l.stderr}`);
  log(`Claude bridge launcher${BUNDLE_BRIDGE ? ' and bundle start' : ' starts'} in isolation, answer initialize and hand claude the right environment: ok`);
  if (!r.ok) fail(`the bundled server does not serve from the installed shape: ${r.problems.join('; ')}\n${r.output.slice(-2000)}`);
  log(`bundled server serves in isolation under ${useElectron ? "Electron's Node" : 'this Node'} (scan, wasm, require, web dist, V8 cache): ok`);
  if (!m.ok) fail(`the board MCP server does not start from the installed shape: ${m.problems.join('; ')}\n${m.stderr.slice(-2000)}`);
  log(`board MCP server starts in isolation: tools ${m.tools.join(', ')}; map answered: ok`);
}

log(`done. server bundle ready at ${BUNDLE}`);
log('  analyzer: ' + path.join(ANALYZER_OUT, 'dist', 'sequence-server-entry.cjs'));
log('  web:      ' + path.join(WEB_OUT, 'index.html'));
log('  bridge:   launcher ' + path.join(ANALYZER_OUT, 'dist', 'claude-agent-acp-launch.mjs') + (BUNDLE_BRIDGE ? ' + full bundle' : ' (bridge downloaded on first use)'));
log('  board:    ' + path.join(ANALYZER_OUT, 'dist', 'sequence-mcp.cjs'));
