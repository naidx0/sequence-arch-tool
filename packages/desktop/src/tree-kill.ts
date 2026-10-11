import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * End a process AND every descendant it has right now, by pid only.
 *
 * WHY (measured 2026-10-06, lab/codex-live-gate.md). On quit the desktop app
 * stopped the server with `child.kill('SIGTERM')` on the server pid. On
 * Windows that is TerminateProcess on that one pid: the server's children
 * (codex app-server, its MCP servers and plugins) died only because their
 * pipes closed. A descendant that does not read those pipes (a detached
 * grandchild, the computer-use chain under node_repl) was left running.
 *
 * WINDOWS. `taskkill /PID <root> /T /F`, the same call the analyzer's
 * killWindowsTree makes (packages/analyzer/src/server/ptyShell.ts): by pid,
 * never by image name, with taskkill named by its absolute System32 path. It
 * must run while the root is ALIVE, because taskkill walks the tree by parent
 * pid from the root; once the root is gone, its children are unreachable from
 * its pid. So on Windows there is no graceful SIGTERM first: SIGTERM there is
 * already TerminateProcess on the root alone, and it would orphan the tree.
 *
 * NOT SHARED AS AN IMPORT, deliberately. This package compiles only its own
 * src/ to CommonJS and ships only dist/ and package.json in the asar, with no
 * node_modules; the analyzer is ESM and reaches the packaged app as a separate
 * server bundle. Importing it here would break the packaged app, so the one
 * call is repeated, with the analyzer's function named as its source.
 *
 * NOT CARRIED OVER: killWindowsTree's sweep after the kill. It exists for a
 * pty console closing under a forking bash, and its process listing took a
 * median 9.5 s, far past the 3 s quit budget.
 *
 * Resolves when taskkill has returned (or after `timeoutMs`); never rejects.
 */
export function killTreeWindows(pid: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!(Number.isInteger(pid) && pid > 0)) return resolve();
    const sys32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    try {
      execFile(path.join(sys32, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: timeoutMs }, () =>
        resolve(),
      );
    } catch {
      resolve();
    }
  });
}

/**
 * POSIX: signal the child's whole process group. Only meaningful when the
 * child was spawned `detached` (it then leads its own group, pgid = pid);
 * otherwise the group is the caller's own and must never be signalled.
 * Returns false when the signal could not be sent.
 */
export function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (!(Number.isInteger(pid) && pid > 0)) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}
