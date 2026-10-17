/**
 * START CLAUDE CODE WITH SEQUENCE'S HOOKS, AS A LAUNCH (round 7, A5).
 *
 * Jaden: "Click to start Claude Code with hooks. Could not start it." The
 * Agents panel used to type `claude --settings "<file>" --mcp-config "<file>"`
 * into the Terminal tab's interactive shell. That shell is refused when no
 * project is attached (the home workspace, where he was), so nothing ran
 * while the panel said it was running; and a typed line also depends on the
 * shell (PowerShell picks the .ps1 shim, which an execution policy blocks)
 * and on quoting paths that hold spaces.
 *
 * Now the POST that writes the settings also records a launch, and the panel
 * opens its own terminal on `?launch=<id>`: the server starts Claude Code
 * itself, with argv (no shell line to quote), in the project or, with none,
 * the home folder, the way first-run sign-in starts `claude auth login`.
 *
 * How claude is started:
 *   - a real executable (the native installer's claude.exe, a posix bin):
 *     directly, the paths as separate arguments;
 *   - an npm `claude.cmd` shim on Windows: a one-line batch file written into
 *     the session's own temp dir that `call`s the shim with the paths quoted
 *     there, run as `cmd.exe /d /c <file>`. cmd keeps the one quoted path
 *     intact (no /s), so no argument passes through cmd's quote stripping.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { defaultExtraDirs, pathKey, resolveBinary, searchDirs, type ProbeOptions } from './providerProbe.js';

export interface HooksLaunch {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** The launch for Claude Code with these files, or null when claude is not on this machine. */
export function claudeHooksLaunch(
  files: { settingsFile: string; mcpConfigFile: string | null },
  search: Pick<ProbeOptions, 'pathValue' | 'extraDirs'> = {},
  platform: NodeJS.Platform = process.platform,
): HooksLaunch | null {
  const baseEnv = { ...process.env };
  const key = pathKey(baseEnv);
  const dirs = searchDirs(search.pathValue ?? baseEnv[key] ?? '', search.extraDirs ?? defaultExtraDirs());
  const env: NodeJS.ProcessEnv = { ...baseEnv, [key]: dirs.join(path.delimiter) };
  /* The board server's own Electron flag must not reach claude or its tools. */
  delete env.ELECTRON_RUN_AS_NODE;
  const resolved = resolveBinary('claude', dirs, env);
  if (!resolved) return null;
  const args = ['--settings', files.settingsFile, ...(files.mcpConfigFile ? ['--mcp-config', files.mcpConfigFile] : [])];
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const bat = path.join(path.dirname(files.settingsFile), 'start-claude.cmd');
    const q = (s: string) => `"${s.replace(/"/g, '')}"`;
    fs.writeFileSync(bat, `@echo off\r\ncall ${q(resolved)} ${args.map(q).join(' ')}\r\n`);
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/c', bat], env };
  }
  return { file: resolved, args, env };
}

/** The launches the panel may open, by id; a few at most, the oldest dropped first. */
export class HooksLaunches {
  private readonly byId = new Map<string, { settingsFile: string; mcpConfigFile: string | null }>();
  add(files: { settingsFile: string; mcpConfigFile: string | null }): string {
    const id = crypto.randomBytes(9).toString('base64url');
    this.byId.set(id, files);
    while (this.byId.size > 16) this.byId.delete(this.byId.keys().next().value as string);
    return id;
  }
  get(id: string): { settingsFile: string; mcpConfigFile: string | null } | null {
    return this.byId.get(id) ?? null;
  }
}
