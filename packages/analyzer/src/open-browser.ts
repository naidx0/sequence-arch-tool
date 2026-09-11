import childProcess from 'node:child_process';

/**
 * Cross-platform "open the default browser" helper for the launchable app shell.
 *
 * Zero dependencies: it shells out to the OS's own URL opener via
 * `child_process.spawn`, detached, with stdio ignored. It is intentionally
 * best-effort — if the opener binary is missing or errors, we swallow it and do
 * nothing further, because the launcher has ALREADY printed the URL to the
 * terminal. Opening a browser is a convenience, never a hard requirement, so it
 * must never crash the server that has just started listening.
 */

export interface BrowserCommand {
  command: string;
  args: string[];
}

/**
 * Resolve the platform-specific command + args that open `url` in the default
 * browser. Pure and side-effect free so it can be unit-tested per platform
 * without spawning anything.
 *
 *  - macOS   → `open <url>`
 *  - Windows → `cmd /c start "" <url>`  (the empty `""` is start's window-title
 *              argument; without it a quoted URL would be swallowed as the title)
 *  - other   → `xdg-open <url>`  (Linux / BSD desktops)
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Open `url` in the default browser. Never throws and never blocks the caller:
 * the child is spawned detached + unref'd so the parent process can exit
 * independently, and every failure mode (missing opener, spawn error, async
 * 'error' event) is swallowed. The URL is expected to have been printed already.
 */
export function openBrowser(url: string): void {
  try {
    const { command, args } = browserCommand(url);
    const child = childProcess.spawn(command, args, { stdio: 'ignore', detached: true });
    // A missing opener surfaces asynchronously as an 'error' event, not a throw —
    // attach a no-op handler so it does not become an unhandled error.
    if (child && typeof child.on === 'function') {
      child.on('error', () => {
        /* opener missing or failed — the URL was already printed, so ignore */
      });
    }
    if (child && typeof child.unref === 'function') child.unref();
  } catch {
    /* synchronous spawn failure — swallow; the URL was already printed */
  }
}
