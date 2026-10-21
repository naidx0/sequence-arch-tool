import fs from 'node:fs';

/**
 * Remove a test's temp folder, waiting out a moment when Windows still holds it.
 *
 * Measured 2026-10-09 on Windows under a parallel run: after an agent process
 * that worked in the folder has exited and the server has settled, the folder
 * can stay busy for under 1.5 s (EPERM), then removes cleanly, with no process
 * left. Node 24's rmSync does not retry EPERM, so `maxRetries` does not help.
 * The run root is removed at exit regardless (isolate-user-store.ts); this only
 * keeps that moment from failing a test that checks something else.
 */
export function rmTree(dir: string, waitMs = 5000): void {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') || Date.now() > until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
