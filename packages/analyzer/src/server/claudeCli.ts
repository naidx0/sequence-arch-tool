/**
 * CLAUDE WITHOUT AN INSTALL STEP.
 *
 * Sequence drives Claude Code over ACP through the `claude-agent-acp` bridge.
 * Asking people to `npm install -g` that bridge was the last step between a
 * signed-in `claude` and a Ready card, so the bridge ships inside the app as one
 * esbuild file (`claude-agent-acp.mjs`, about 2 MB; scripts/bundle-claude-bridge.mjs)
 * and runs under the app's own Node.
 *
 * It never carries a Claude login. Claude Code's own signed-in CLI does the work:
 * the bridge is told which `claude` to run (CLAUDE_CODE_EXECUTABLE, the variable
 * the bridge already reads) and that CLI uses the user's own session, the way
 * T3 Code points the Agent SDK at the user's CLI (apps/server .../ClaudeExecutable.ts,
 * MIT, pingdotgg/t3code). Nothing here opens a credential file or keychain item.
 *
 * Two pieces:
 *  - {@link bundledBridgePath}: where the packaged (or built) bridge file is.
 *  - {@link resolveClaudeExecutable}: the user's `claude` as an absolute path the
 *    SDK can spawn. A Windows npm `.cmd` shim cannot be spawned by the SDK, so it
 *    is followed to the package's real entry (the same shim templates the sign-in
 *    launch already reads).
 *
 * Pure fs/path code, so the bundle can fold it in without the server.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathKey, resolveBinary, searchDirs, windowsShimTarget } from './binResolve.js';

/** The bundle's file name. `agentKindOf` in @sequence/acp reads `claude-agent-acp` in a launch as the Claude bridge. */
export const BUNDLED_BRIDGE_FILE = 'claude-agent-acp.mjs';

/** Names the bridge file (an absolute path that exists) for tests and unusual installs; `none` says this install has none. */
export const BRIDGE_ENV = 'SEQUENCE_CLAUDE_BRIDGE';

/**
 * The bundled bridge, or null when this install has none (an unbuilt checkout, a
 * trimmed copy). Looked for beside the server's `dist/` (the packaged app puts it at
 * `<resources>/server/packages/analyzer/dist/claude-agent-acp.mjs`, and a build
 * writes it to the same place), walking up like the board server's entry.
 */
export function bundledBridgePath(env: NodeJS.ProcessEnv = process.env, from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  const named = env[BRIDGE_ENV]?.trim();
  if (named) return path.isAbsolute(named) && fs.existsSync(named) ? named : null;
  /* Two known places only: beside this file (the server bundle in dist/) and one up (dist/server/ in a build). */
  for (const file of [path.join(from, BUNDLED_BRIDGE_FILE), path.join(from, '..', BUNDLED_BRIDGE_FILE)]) if (fs.existsSync(file)) return path.resolve(file);
  return null;
}

/** The small launcher (our code only) that readies the environment and starts a downloaded bridge. Built with the analyzer. */
export const LAUNCHER_FILE = 'claude-agent-acp-launch.mjs';

export function launcherPath(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  for (const file of [path.join(from, LAUNCHER_FILE), path.join(from, '..', LAUNCHER_FILE)]) if (fs.existsSync(file)) return path.resolve(file);
  return null;
}

/** True when this install must not use a bundled or downloaded bridge at all (tests; SEQUENCE_CLAUDE_BRIDGE=none or a named file). */
export function bridgeSourceDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[BRIDGE_ENV]?.trim());
}

/**
 * The oldest `claude` the bundled and downloaded bridge is asked to drive. The Agent SDK in the bridge
 * speaks Claude Code's stream-json control protocol and pins 2.1.293; the old global bridge shipped its
 * own matching binary, this one runs the person's. 2.1.113 is the first release whose npm `claude` is a
 * native binary (`bin/claude.exe`); 2.1.112 and earlier ship a JS `cli.js`, which the SDK would start as a
 * bare `node` from the opened repo (a `node.exe` there would run on Windows). Below it the card says
 * "Update Claude Code", so no JS-entry claude is ever started. (`claude auth status --json`, which the
 * probe reads, first exists in 2.1.40, so older ones read as "update" as well.)
 */
export const MIN_CLAUDE_VERSION = '2.1.113';

/** `2.1.280` vs `2.1.0`: <0, 0, >0. Non-numeric parts count as 0; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const n = (v: string): number[] => v.split(/[-+]/)[0]!.split('.').map((x) => parseInt(x, 10) || 0);
  const x = n(a);
  const y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface ClaudeExecutable {
  /** Absolute path for CLAUDE_CODE_EXECUTABLE. */
  path: string;
}

export interface ClaudeResolveOptions {
  /** PATH value to search (defaults to the process's own). */
  pathValue?: string;
  /** Extra dirs searched after PATH. Defaults to the vendor install dirs. */
  extraDirs?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

/** Where `claude` lives when it is not on PATH: the native installer, the old local install, npm's global dir on Windows. */
export function defaultClaudeDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')];
  if (process.platform === 'win32' && env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  return dirs;
}

/**
 * The user's own `claude`, as a path the SDK can start, or null.
 * `CLAUDE_CODE_EXECUTABLE` already set (the user's, or a test's) is honoured as is when the file exists.
 */
export function resolveClaudeExecutable(opts: ClaudeResolveOptions = {}): ClaudeExecutable | null {
  const env = opts.env ?? process.env;
  const preset = env.CLAUDE_CODE_EXECUTABLE?.trim();
  if (preset && path.isAbsolute(preset) && fs.existsSync(preset)) return /\.(c|m)?js$/i.test(preset) ? null : { path: preset };
  const key = pathKey(env);
  const dirs = searchDirs(opts.pathValue ?? env[key] ?? '', opts.extraDirs ?? defaultClaudeDirs(env));
  const found = resolveBinary('claude', dirs, env);
  return found ? executableFromResolved(found, dirs, env) : null;
}

/** What the SDK can start for a resolved `claude`: itself, or for a Windows npm `.cmd` shim the package entry it wraps. Null when the shim is not a known template. */
export function executableFromResolved(found: string, dirs: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): ClaudeExecutable | null {
  if (!/\.(cmd|bat)$/i.test(found)) return { path: found };
  /* A Windows npm shim: the SDK cannot start a .cmd; start what it wraps. */
  const t = windowsShimTarget(found, dirs, env);
  if (!t) return null;
  /* A shim that starts node plus a JS entry is a claude older than the floor: not driven (see MIN_CLAUDE_VERSION). */
  return t.args.length === 0 ? { path: t.command } : null;
}

/**
 * Whether the bundled bridge can run here: the file exists AND there is a `claude` for it to drive.
 * A signed-in `claude` the SDK cannot start (an unknown .cmd wrapper) is not usable, so the
 * global-install path stays offered rather than showing Ready for a bridge that cannot launch.
 */
export function bundledBridgeUsable(opts: ClaudeResolveOptions & { bridge?: string | null } = {}): { bridge: string; claude: ClaudeExecutable } | null {
  const bridge = opts.bridge === undefined ? bundledBridgePath(opts.env) : opts.bridge;
  if (!bridge) return null;
  const claude = resolveClaudeExecutable(opts);
  return claude ? { bridge, claude } : null;
}
