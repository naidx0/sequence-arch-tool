/* ══════════════════════════════════════════════════════════════════════════
   RUNNING git AND gh BY ABSOLUTE PATH
   packages/analyzer/src/server/toolPath.ts

   A bare `spawn('gh')` with a cwd lets Windows look in the cwd first, and a
   chat's cwd is a folder the agent writes in: a `gh.exe` it drops there would
   run with the person's GitHub login. So a tool is resolved the way providers
   are (providerProbe.ts: absolute PATH entries and the vendor install dirs
   only, PATHEXT on Windows), and a result inside the repository or the
   worktree is refused rather than run.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

import { defaultExtraDirs, launchForResolved, pathKey, resolveBinary, searchDirs } from './providerProbe.js';

export type ToolPath = { ok: true; path: string } | { ok: false; error: string };

const cache = new Map<string, string | null>();

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The absolute path of `name`, or why there is none. `refuseInside`: folders a tool must not come from. */
export function resolveTool(name: string, refuseInside: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): ToolPath {
  const key = pathKey(env);
  const pathValue = env[key] ?? '';
  const cacheKey = `${name}\0${pathValue}`;
  let found = cache.get(cacheKey);
  if (found === undefined) {
    found = resolveBinary(name, searchDirs(pathValue, defaultExtraDirs()), env);
    /* Only a hit is remembered: a tool installed after a miss is found on the next try. */
    if (found) {
      cache.set(cacheKey, found);
      if (cache.size > 64) cache.delete(cache.keys().next().value as string);
    }
  }
  if (!found) return { ok: false, error: `${name} was not found on PATH or in its usual install folders.` };
  const abs = real(found);
  for (const dir of refuseInside) {
    if (dir && inside(abs, real(dir))) return { ok: false, error: `Refusing to run ${name} from inside the project (${abs}): an agent could have put it there.` };
  }
  return { ok: true, path: abs };
}

/** For tests: forget what was resolved. */
export function forgetResolvedTools(): void {
  cache.clear();
}

/**
 * The project folder a working directory belongs to: itself, or, for a linked
 * worktree (whose `.git` is a file naming `<repo>/.git/worktrees/<name>`), the
 * repository it hangs off. Read from the file; nothing is run.
 */
export function projectRootOf(cwd: string): string {
  try {
    const dotGit = path.join(cwd, '.git');
    if (fs.statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      const at = m ? m[1]!.replace(/\\/g, '/').lastIndexOf('/.git/') : -1;
      if (m && at > 0) return m[1]!.slice(0, at);
    }
  } catch {
    /* no .git here: the folder itself */
  }
  return cwd;
}

/** What to spawn for a resolved tool: a Windows .cmd/.bat shim goes through its target or cmd.exe by absolute path, never by bare name. */
export function launchTool(resolved: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[]; verbatim: boolean } {
  const l = launchForResolved(resolved, args, searchDirs(env[pathKey(env)] ?? '', defaultExtraDirs()), env);
  return { command: l.command, args: l.args, verbatim: l.verbatim === true };
}
