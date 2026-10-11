/**
 * Finding a runnable binary on this machine, and starting what a Windows npm
 * `.cmd` shim wraps. Pure fs/path code, no process spawning: the provider
 * probe, the sign-in launch, the agent launch and the bundled Claude bridge
 * (which esbuild folds into one file) all share it.
 */

import fs from 'node:fs';
import path from 'node:path';

export function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
}

/** The directories searched, in order: PATH, then the vendor install dirs. */
export function searchDirs(pathValue: string, extraDirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...pathValue.split(path.delimiter), ...extraDirs]) {
    const t = d.trim().replace(/^"(.*)"$/, '$1');
    /* A relative entry (`.`, `bin`) resolves against whatever the cwd is: the opened repo, for an agent. Never searched. */
    if (t === '' || !path.isAbsolute(t)) continue;
    const key = process.platform === 'win32' ? t.toLowerCase() : t;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The first runnable file named `bin` in `dirs`, or null. On Windows only
 * PATHEXT extensions count (an extensionless npm shim is a bash script that
 * cannot be started here, and `.ps1` needs PowerShell).
 */
export function resolveBinary(bin: string, dirs: readonly string[], env: NodeJS.ProcessEnv): string | null {
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e !== '' && e !== '.ps1')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}


/** Argv for running a Windows `.cmd`/`.bat` shim by its absolute path through cmd.exe (pass with windowsVerbatimArguments). */
export function cmdShimArgs(shim: string, args: readonly string[]): string[] {
  return ['/d', '/s', '/c', `""${shim}" ${args.join(' ')}"`];
}

/*
 * The shim templates Sequence will look inside, matched whole (CRLF or LF):
 * npm's cmd-shim (v3+, node script or native target) and pnpm's / npm's
 * older one. Anything else (a user's own wrapper with extra flags, a shim
 * passing node options) runs as written, through cmd.exe.
 */
const NPM_HEAD = String.raw`@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n`;
const SHIM_TEMPLATES: { re: RegExp; node: boolean }[] = [
  {
    re: new RegExp(
      '^' +
        NPM_HEAD +
        String.raw`\nIF EXIST "%dp0%\\node\.exe" \(\n  SET "_prog=%dp0%\\node\.exe"\n\) ELSE \(\n  SET "_prog=node"\n  SET PATHEXT=%PATHEXT:;\.JS;=;%\n\)\n\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%"  "%dp0%\\([^"%\n]+)" %\*\n?$`,
    ),
    node: true,
  },
  { re: new RegExp('^' + NPM_HEAD + String.raw`"%dp0%\\([^"%\n]+\.exe)"   %\*\n?$`), node: false },
  {
    re: new RegExp(
      String.raw`^(?:@SETLOCAL\n)?(?:@IF NOT DEFINED NODE_PATH \(\n  @SET "NODE_PATH=[^"\n]*"\n\) ELSE \(\n  @SET "NODE_PATH=[^"\n]*"\n\)\n)?` +
        String.raw`@IF EXIST "%~dp0\\node\.exe" \(\n  "%~dp0\\node\.exe"  "%~dp0\\([^"%\n]+)" %\*\n\) ELSE \(\n(?:  @SETLOCAL\n)?  @SET PATHEXT=%PATHEXT:;\.JS;=;%\n  node  "%~dp0\\\1" %\*\n\)\n?$`,
    ),
    node: true,
  },
];

/**
 * The node that runs a shim's script: the `node.exe` beside the shim (what the
 * shim itself prefers), else a node on the searched PATH (absolute entries
 * only), else this process's own executable. In the packaged app that last is
 * Sequence.exe, which runs as node only with ELECTRON_RUN_AS_NODE; the agent
 * spawn sets that flag for that process alone (acp's agentSpawnEnv).
 */
export function nodeForShim(shim: string, dirs: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): string {
  const beside = path.join(path.dirname(shim), process.platform === 'win32' ? 'node.exe' : 'node');
  try {
    if (fs.statSync(beside).isFile()) return beside;
  } catch {
    /* none beside it */
  }
  return resolveBinary('node', dirs, env) ?? process.execPath;
}

/**
 * What an npm or pnpm `.cmd` shim starts: node plus the package's own JS
 * entry, or the native binary it wraps, read from the shim when the shim is
 * EXACTLY one of the known templates ({@link SHIM_TEMPLATES}). Null otherwise,
 * or when the target is missing.
 *
 * S-new2: running a shim through `cmd /c <bare name>` lets cmd.exe find a
 * same-named .bat in the CURRENT directory first (the opened repo, for an
 * agent), and misses a bridge installed off the server's PATH. Starting the
 * target directly by absolute path does neither.
 */
export function windowsShimTarget(shim: string, dirs: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } | null {
  let text: string;
  try {
    text = fs.readFileSync(shim, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
  for (const t of SHIM_TEMPLATES) {
    const m = t.re.exec(text);
    if (!m) continue;
    const target = path.join(path.dirname(shim), ...m[1]!.split(/[\\/]/).filter(Boolean));
    if (!fs.existsSync(target)) return null;
    if (!t.node) return { command: target, args: [] };
    return { command: nodeForShim(shim, dirs, env), args: [target] };
  }
  return null;
}

/**
 * The launch for a resolved binary: itself, or for a `.cmd`/`.bat` shim the
 * shim's target ({@link windowsShimTarget}); failing that, cmd.exe running the
 * shim by its ABSOLUTE path, quoted for `/s /c` ({@link cmdShimArgs}; spawn it
 * with `windowsVerbatimArguments`, which `verbatim` says).
 */
export function launchForResolved(
  resolved: string,
  args: readonly string[],
  dirs: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; verbatim?: true } {
  if (!/\.(cmd|bat)$/i.test(resolved)) return { command: resolved, args: [...args] };
  const t = windowsShimTarget(resolved, dirs, env);
  if (t) return { command: t.command, args: [...t.args, ...args] };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: cmdShimArgs(resolved, args), verbatim: true };
}

